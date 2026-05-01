/**
 * planner.ts — LLM 창의적 장면 계획 생성기
 *
 * 역할: StateExtractor가 확정한 결정론적 제약 위에서,
 * LLM이 "무슨 일이 어떻게 벌어지는가"만 계획한다.
 *
 * LLM 담당:
 *   - scene_beats (2~4개 장면 비트 순서)
 *   - world_rule (어떤 세계관 규칙이 어떻게 사건화)
 *   - carryover_effects (직전 화 여파의 구체적 묘사 방향)
 *   - hook_type + hook_payload + hook_concrete_event
 *
 * LLM 미담당 (StateExtractor 확정):
 *   - 인물 위치·부상·소지품·POV·분량
 *
 * 파싱 실패 시: 결정론적 fallback 계획으로 대체 (파이프라인 계속 진행).
 */

import { getLLMClient, getPlannerModel, getActiveProvider } from "../lib/llm.js";
import { resolveTaskRoute, runLLMTask } from "../services/model_router.js";
import { logInfo, logWarn } from "../lib/logger.js";
import type { EffectiveContext } from "../types/canonical.js";
import { HOOK_TYPES } from "../types/planner.js";
import type {
  CreativePlan, CarryoverEffect, WorldRuleActivation, SceneBeat, HookType,
  CharacterStateUpdate,
} from "../types/planner.js";
import type { ArcPhase, ExtractedStateConstraints } from "./state_extractor.js";

// ══════════════════════════════════════════════════════════════
// Arc Phase 지침
// ══════════════════════════════════════════════════════════════
function buildArcPhaseDirective(phase: ArcPhase, remaining: number): string {
  // hook_type 허용 목록: 각 국면에서 자연스러운 엔딩 훅 유형
  // (HookType 전체 목록은 src/types/planner.ts 참조)
  const hookGuide: Record<ArcPhase, { preferred: string[]; avoid: string[] }> = {
    intro: {
      preferred: [
        "unresolved_situation",   // 여운으로 궁금증 유발 — 도입부 최적
        "unexpected_discovery",   // 세계관·인물의 첫 비밀 힌트
        "ominous_calm",           // 불길한 고요 — 앞으로 올 폭풍 예고
        "tender_moment",          // 인물 간 유대 확립 — 독자 감정 이입 시작
        "memory_trigger",         // 과거 단서 — 배경·트라우마 자연 노출
      ],
      avoid: [
        "immediate_threat",       // 아직 관계·세계관 미형성, 위협은 시기상조
        "last_moment_failure",    // 클라이맥스급 좌절은 도입부에 부적합
        "revelation",             // 핵심 폭로는 초반 투입 금지
        "betrayal_hint",          // 배신 복선은 관계 확립 후 유효
      ],
    },
    early: {
      preferred: [
        "unexpected_discovery",   // 세계관·인물 비밀 점진 노출
        "new_problem",            // 서브플롯·장애물 추가로 긴장감 축적
        "betrayal_hint",          // 신뢰 관계 위에 처음 균열 복선
        "ominous_calm",           // 갈등 예고 긴장감
        "emotional_break",        // 관계 발전 중 감정 폭발 — 독자 몰입 강화
      ],
      avoid: [
        "immediate_threat",       // 전투·추격은 관계·동기 구축 후 투입
        "revelation",             // 핵심 폭로는 전개 무게 축적 후 사용
        "last_moment_failure",    // 클라이맥스 좌절은 이름
        "time_pressure",          // 카운트다운 긴박감은 중반 이후
      ],
    },
    mid: {
      preferred: [
        "new_problem",            // 갈등 심화 — 핵심
        "unexpected_discovery",   // 복선 강화·힌트 추가
        "immediate_threat",       // 긴장 정점 이전 긴박감 시험
        "betrayal_hint",          // 관계 균열·음모 암시
        "ironic_reversal",        // 아이러니 반전 — 서사 활력
        "emotional_break",        // 감정 폭발로 인물 심층 노출
        "alliance_shift",         // 동맹·적대 역전 — 관계 복잡화
      ],
      avoid: [
        "tender_moment",          // 감동 마무리는 서사 긴장 해소 — 중반 부적합
        "unresolved_situation",   // 중반에 너무 잦은 여운은 독자 피로 유발
      ],
    },
    late: {
      preferred: [
        "immediate_threat",       // 클라이맥스 직전 긴박감 최고조
        "unexpected_discovery",   // 복선 회수 — 숨겨진 진실 노출
        "revelation",             // 정체·사실 폭로 — 후반 반전
        "last_moment_failure",    // 손에 닿기 직전 좌절 — 긴장 극대화
        "cliffhanger_choice",     // 돌이킬 수 없는 선택 기로
        "betrayal_hint",          // 배신 복선 본격 확인 시작
        "time_pressure",          // 데드라인 설정으로 긴박감 강화
      ],
      avoid: [
        "tender_moment",          // 감동 여운은 결말부 전용
        "memory_trigger",         // 회고는 흐름 끊김 — 후반 자제
        "new_problem",            // 새 서브플롯 도입 금지
      ],
    },
    pre_final: {
      preferred: [
        "cliffhanger_choice",     // 결정적 선택 기로 — 결말 직전 최고조
        "revelation",             // 핵심 반전·폭로 — 클라이맥스
        "immediate_threat",       // 최종 충돌 직전 긴박감
        "last_moment_failure",    // 절망적 위기 — 결말 반등 구조 설정
        "betrayal_hint",          // 배신 본격 드러남
        "sudden_loss",            // 충격적 상실 — 독자 감정 폭발
        "time_pressure",          // 카운트다운 정점
      ],
      avoid: [
        "unresolved_situation",   // 막연한 여운 금지 — 결말 직전은 강한 훅 필수
        "tender_moment",          // 감동 마무리는 결말부에서
        "memory_trigger",         // 회고로 흐름 끊지 않음
        "new_problem",            // 신규 서브플롯 절대 금지
      ],
    },
    final: {
      preferred: [
        "tender_moment",          // 인물 간 최종 화해·유대 — 감동 마무리
        "unresolved_situation",   // 열린 결말·여운 (시리즈 기획 시)
        "revelation",             // 마지막 진실 확인 — 독자 납득
        "emotional_break",        // 감정 해소·카타르시스
        "alliance_shift",         // 최종 관계 귀결
      ],
      avoid: [
        "immediate_threat",       // 새 위협 도입 절대 금지
        "new_problem",            // 신규 문제 절대 금지
        "betrayal_hint",          // 해소 없는 배신 암시 금지
        "time_pressure",          // 새 카운트다운 금지
        "last_moment_failure",    // 결말에 좌절만 남기면 안 됨
      ],
    },
    unknown: { preferred: [], avoid: [] },
  };

  const directives: Record<ArcPhase, { allowed: string[]; forbidden: string[] }> = {
    intro: {
      allowed: [
        "주인공의 일상·현재 상황 도입",
        "핵심 갈등의 씨앗 심기",
        "새 인물과의 첫 만남·관계 형성",
        "세계관 규칙을 자연스럽게 드러내는 장면",
        "앞으로 회수될 복선 설치",
        "과거 기억·트라우마 자연 노출 (memory_trigger hook 허용)",
        "불길한 고요·예감 묘사 (ominous_calm hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 해소 또는 결말 암시",
        "주요 적대 세력의 완전한 등장·충돌",
        "관계의 급격한 결말(이별·죽음·화해 완료)",
        "즉각적 위협·전투·추격 장면으로 시작 (immediate_threat hook 금지)",
        "핵심 정체·사실 폭로 (revelation hook 금지 — 서사 무게 미형성)",
        "손에 닿기 직전 클라이맥스급 좌절 (last_moment_failure hook 금지)",
      ],
    },
    early: {
      allowed: [
        "인물 간 관계·신뢰의 점진적 구축",
        "서브플롯 도입 및 복선 강화",
        "세계관 규칙이 갈등 원인으로 작동하는 장면",
        "새 조력자·협력자 합류 (intro에서 씨앗이 뿌려진 경우)",
        "주인공의 목표 명확화",
        "신뢰 관계 위 첫 균열 복선 (betrayal_hint hook 허용)",
        "관계 발전 중 감정 폭발 (emotional_break hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 조기 해소",
        "아직 등장하지 않은 적대 세력의 급작스러운 최종 충돌",
        "서브플롯의 완결 없이 새 서브플롯 2개 이상 동시 도입",
        "즉각적 전투·추격·생존 위기로 끝맺는 훅 (immediate_threat hook 지양)",
        "핵심 정체·사실 폭로 (revelation hook 금지 — 서사 무게 미축적)",
        "카운트다운·데드라인 설정 (time_pressure hook 금지 — 이름)",
      ],
    },
    mid: {
      allowed: [
        "갈등 심화 및 인물 간 긴장 고조",
        "복선 강화·추가 힌트 제공",
        "기존 관계의 균열 또는 예상 밖 동맹 (alliance_shift hook 허용)",
        "세계관 규칙이 선택을 제한하는 딜레마 장면",
        "서브플롯의 부분 해소 및 주플롯 연결",
        "아이러니한 반전으로 서사 활력 (ironic_reversal hook 허용)",
        "배신 암시 본격화 (betrayal_hint hook 허용)",
        "감정 폭발로 인물 심층 노출 (emotional_break hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 해소 또는 화해 완료 (tender_moment hook 자제)",
        "새로운 주요 조력자·세계관 세력의 도입 (기존 인물 활용 우선)",
        "갑작스러운 장르 전환(액션→로맨스 등)",
        "막연한 여운으로만 끝맺기 (unresolved_situation hook 과용 금지)",
      ],
    },
    late: {
      allowed: [
        "서브플롯 하나씩 회수·정리",
        "심어진 복선 중 하나 이상 드러내기 (revelation hook 허용)",
        "핵심 갈등을 향한 집결·준비",
        "인물 간 관계의 결정적 변화(화해·배신·각오)",
        "적대 세력의 실체·목적 부분 노출",
        "손에 닿기 직전 좌절로 긴장 극대화 (last_moment_failure hook 허용)",
        "결정적 선택 기로 설정 (cliffhanger_choice hook 허용)",
        "데드라인·카운트다운으로 긴박감 강화 (time_pressure hook 허용)",
      ],
      forbidden: [
        "새로운 조력자·세력 도입",
        "해결되지 않은 새 서브플롯 추가 (new_problem hook 지양)",
        "주인공이 전혀 다른 목표로 이탈",
        "감동 여운 마무리 (tender_moment hook 자제 — 결말부 전용)",
        "과거 회고로 흐름 끊기 (memory_trigger hook 자제)",
      ],
    },
    pre_final: {
      allowed: [
        "핵심 갈등의 최고조·직접 충돌",
        "남은 복선의 회수",
        "인물 간 최종 관계 정립 (각오·화해·작별)",
        "결말을 향한 결정적 행동 시작",
        "클라이맥스 반전·폭로 (revelation hook 허용)",
        "배신 본격 드러남 (betrayal_hint → betrayal 전환 허용)",
        "충격적 상실로 감정 폭발 (sudden_loss hook 허용)",
        "돌이킬 수 없는 선택 기로 (cliffhanger_choice hook 권장)",
        "카운트다운 정점 (time_pressure hook 허용)",
      ],
      forbidden: [
        "새로운 인물·세력·서브플롯 도입 (new_problem hook 금지)",
        "핵심 갈등과 무관한 탐색·여행·모집 장면",
        "주인공의 목표 변경 또는 새 목표 설정",
        "아직 등장하지 않은 정보로 반전 시도",
        "막연한 여운으로만 끝맺기 (unresolved_situation hook 금지)",
        "감동 마무리 (tender_moment hook 금지 — 결말부 전용)",
      ],
    },
    final: {
      allowed: [
        "모든 핵심 갈등의 해소",
        "남은 복선 전부 회수",
        "인물 관계의 최종 귀결",
        "세계관 변화 또는 주인공의 성장 확인 장면",
        "독자에게 감동·여운을 주는 마무리 (tender_moment hook 권장)",
        "마지막 진실 확인으로 독자 납득 (revelation hook 허용)",
        "감정 해소·카타르시스 (emotional_break hook 허용)",
      ],
      forbidden: [
        "새로운 갈등·복선·인물 도입",
        "미해결 서브플롯 추가",
        "즉각적 위협·생존 위기 (immediate_threat hook 금지)",
        "새로운 문제 발생 (new_problem hook 금지)",
        "해소 없는 배신 암시 (betrayal_hint hook 금지)",
        "새 카운트다운·데드라인 설정 (time_pressure hook 금지)",
        "결말에 좌절만 남기는 구성 (last_moment_failure hook 금지)",
      ],
    },
    unknown: {
      allowed: ["연재 계약 정보를 기반으로 자연스러운 장면 계획"],
      forbidden: [],
    },
  };

  const d = directives[phase];
  const label: Record<ArcPhase, string> = {
    intro:     "도입부",
    early:     "전개 초반",
    mid:       "전개 중반",
    late:      "전개 후반",
    pre_final: "결말 직전",
    final:     "최종화",
    unknown:   "미확정",
  };

  const hg = hookGuide[phase];
  // 프롬프트 과부하 방지: allowed 상위 4개 + forbidden 상위 3개만 포함 (full list는 8K context에서 창작 공간 잠식)
  const lines = [`현재 서사 국면: ${label[phase]} (남은 화수: ${remaining}화)`];
  if (d.allowed.length) lines.push(`[적합한 전개 (상위 우선순위)]\n${d.allowed.slice(0, 4).map(s => `- ${s}`).join("\n")}`);
  if (d.forbidden.length) lines.push(`[금지된 전개]\n${d.forbidden.slice(0, 3).map(s => `- ${s}`).join("\n")}`);
  if (hg.preferred.length) lines.push(`[권장 hook_type] ${hg.preferred.slice(0, 4).join(", ")}`);
  if (hg.avoid.length) lines.push(`[금지 hook_type] ${hg.avoid.slice(0, 3).join(", ")}`);
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════
// Planner 프롬프트 조립
// ══════════════════════════════════════════════════════════════
function buildPlannerSystemPrompt(): string {
  return `[언어 규칙] JSON 값의 모든 텍스트는 100% 한국어로 작성한다. 키릴·아랍·가나 등 비한글 문자 사용 금지.

당신은 소설 장면 설계자다. 소설 본문을 쓰지 않는다. JSON 계획만 출력한다.

JSON만 출력 (다른 텍스트 없이):
{
  "carryover_effects": [{"character_name":"...","description":"이번 화 첫 단락에서 드러날 직전 사건 여파","must_appear_in_opening":true}],
  "world_rule": {"rule_content":"활용할 규칙 원문","activation_type":"constraint","scene_usage":"이 규칙이 인물 행동·선택에 어떻게 영향 주는지"},
  "scene_beats": [{"beat_number":1,"summary":"비트 요약","characters_involved":["..."],"location":"..."}],
  "hook_type": "unresolved_situation",
  "hook_payload": "훅 내용 1~2문장",
  "hook_concrete_event": "마지막 2~4문장의 실제 인물 행동·사건",
  "character_state_updates": [{
    "character_name":"...",
    "emotional_state":"종료 시점 감정 (짧은 상태어 — 불안/결의/공포/희망/혼란/안도 등. 성격(친절·내성적)/역할(신입·리더)/관계(팀워크·동료)/목표 단어는 사용 안 함. 이전 화와 다르게)",
    "physical_state":"부상·피로 변화 (없으면 생략)",
    "items":[{"name":"...","grade":"S/A/B/C/D","condition":"손상·충전 등 상태 (정상이면 생략)","description":"짧은 용도·내력 (선택)"}],
    "location":"종료 시점 위치 (변화 없으면 생략)",
    "visibility_state":"present",
    "recent_goal":"이번 화 인물 목표·태도 1~2문장"
  }],
  "character_emotional_beats": [{
    "name":"인물명 (scene_beats 등장 인물 중)",
    "previous_emotion":"직전 화 감정",
    "current_emotion":"이번 화 감정",
    "emotion_cause":"이번 화 사건·관계·정보 중 어떤 것이 감정을 만들었는가 (1줄)",
    "goal_delta":"recent_goal 변화 — 같으면 '유지', 다르면 무엇이 어떻게 (1줄)",
    "behavior_delta":"본문에서 인물이 어떻게 다르게 행동했는가 (1줄, 같은 감정이 유지되더라도 행동 양상이 달라야 함)"
  }]
}

hook_type 허용값 (영문 식별자 그대로, 번역·변형 안 함):
immediate_threat | unexpected_discovery | new_problem | unresolved_situation | revelation | betrayal_hint | emotional_break | ironic_reversal | cliffhanger_choice | tender_moment | ominous_calm | memory_trigger | last_moment_failure | sudden_loss | alliance_shift | time_pressure

규칙:
- scene_beats는 2~4개, 각 비트는 인물 행동·사건이 명확하다.
- world_rule.activation_type ∈ {"constraint" 행동 제약, "conflict_cause" 갈등 원인, "resolution_means" 해결 수단}.
- world_rule.scene_usage는 "이 규칙 때문에 ~가 ~한다" 형식.
- hook_concrete_event는 분위기 묘사가 아닌 실제 인물 행동·사건이다.

[반복 패턴 변주]
- "낯선 환경 등장/각성 → 첫 만남 → 외부 위협" 3단 공식 사용 안 함.
- beat 1은 각성 묘사(눈을 떴다·깨어났다·정신이 들었다)로 시작 안 함.
- intro/early 국면에서 외부 물리적 위협(짐승·괴물·적·추격자)을 hook으로 사용 안 함.
- 각 화는 이전 화와 다른 감정적 출발점·사건 유형에서 시작한다.
- 모든 beat 설계에 "이 화·이 인물·이 세계관에서만 일어날 구체적 사건"을 1개 이상 포함한다. 내면 갈등(선택·의심·결심·배신감·수치심·충동)이나 관계 역학 변화를 중심으로 설계하는 것을 권장한다.
- [1화 전용] 사건보다 인물의 목소리·태도·세계 인식이 먼저 드러난다 — "이 인물은 어떤 존재인가"를 우선 보여준다.
- character_state_updates: 화 종료 시점 핵심 인물 상태. scene_beats 등장 인물만.
- items는 항상 출력 (변화 없으면 현재 소지 그대로, 없으면 빈 배열). 생략 안 함.
- location/physical_state는 변화 없으면 생략 가능 (단, 인물 이동이 본문에 있다면 location 명시).
- R5B-1.5 [필수 출력] emotional_state, recent_goal은 scene_beats 등장 인물 모두에 대해 항상 출력. 생략 금지.
  - 이전 화와 같은 단어는 사용 금지 — 감정 단어만 바꾸는 fake progression 금지. 본문 사건·결정·관계 변화·새 정보·대가에서 비롯된 자연스러운 진전이어야 한다.
  - 이번 화에서 등장하지 않는 인물(scene_beats에 없음)은 character_state_updates에 포함하지 않는다 — 억지 갱신 금지.
- recent_goal은 이번 화 인물 목표·태도를 1~2문장. 이전 화와 같은 표현 사용 금지 — 작은 진전(구체화·범위 변경·타깃 변경)이라도 명시할 것.

[★ R5B-1.7 character_emotional_beats — appeared 인물별 감정 변화 설계]
- scene_beats에 등장하는 핵심 인물(주인공·조력자·적대자) 각각에 대해 emotional_beat을 1개씩 출력.
- 비등장 인물(scene_beats characters_involved 없음)은 포함 안 함 — 억지 beat 생성 금지.
- 같은 cluster 내 단어 변경(불안↔긴장↔경계, 결의↔결단↔다짐, 혼란↔당황↔의문)은 fake progression. emotion_cause + goal_delta + behavior_delta 셋 중 최소 2개가 explicit하게 변화로 채워져야 의미 있는 변화로 간주.
- 같은 emotional_state가 유지되어도 OK — 단, behavior_delta는 반드시 변해야 한다 ("같은 불안이지만 이번엔 먼저 행동함" 같이).
- previous_emotion이 없으면 (1화) "(없음)"으로 둘 것.
- 1줄·1줄·1줄·1줄·1줄 — 인당 5줄 이내, 길게 쓰지 말 것.

[소지품 원칙]
- 세계관·배경·시대·상황과 인물 성격·역할에 일치하는 물건만 배정. "이 세계의 이 인물이 이 상황에서 가질 수 있는가" 우선 검증. 소지품 없으면 빈 배열 — 억지로 채우지 않는다.
- [인물 현재 상태]에 명시된 소지품은 유지하고, 획득·분실·파손 시에만 변경.
- 장면 소품(쇠사슬·밧줄·함정·가구)은 items 아님 — 인물이 직접 휴대하는 물건만.
- 이름(name): 사용자 원본 그대로 (축약·변경 안 함). 예 "고성능 손전등" → "손전등" 안 줄임. 상태 변화는 condition에 기록 — name: "고성능 손전등", condition: "방전" (X: name "손전등(방전)").
- 스킬·능력·특성·마법·패시브는 items에 들어가지 않는다 — 완전 제외.

[소지품 등급·상태]
- 모든 items에 grade 배정 (세계관 희소성·인물 처지·서사적 의미 기준):
  S 극히 드물거나 핵심 / A 고품질·특별 내력 / B 표준 품질 / C 낡거나 흔함 / D 파손·기능 저하.
- condition은 인물 성격·생활방식 반영 (깔끔·자존심 강함 → 양호 / 빈곤·방랑 → 낡음). 첫 화 condition은 성격 기반으로 설정.
- description은 1문장 이내 (생략 가능).
- JSON만 출력. 앞뒤 설명 없음.`;
}

function buildPlannerUserPrompt(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
): string {
  const nc = sc.narrative_contract;

  // ── 연재 계약 ──────────────────────────────────────────────────
  const narrativeLines = [
    `최종화: ${nc.resolved_final}화 / 남은 화수: ${nc.remaining_episodes}화 / 회차역할: ${nc.episode_role}`,
    `분량: ${sc.char_budget.target}자 (허용 ${sc.char_budget.min}~${sc.char_budget.max}자)`,
    `ending: ${sc.ending_constraint}`,
  ].join("\n");

  // ── 서사 국면 지침 ─────────────────────────────────────────────
  const arcPhaseText = buildArcPhaseDirective(nc.arc_phase, nc.remaining_episodes);

  // ── 작가 개입 ──────────────────────────────────────────────────
  const interventionText = sc.active_intervention_instructions.length > 0
    ? sc.active_intervention_instructions.map((ins, i) => `${i + 1}. ${ins}`).join("\n")
    : null;

  // ── 절대 규칙 (Phase 4.19) ──────────────────────────────────────
  // 사용자가 "절대"로 마킹한 항목은 의미상 두 종류가 섞여 있다.
  //   (a) 부정형 / 금지: "X를 하지 마라", "Y는 등장하지 않는다"
  //   (b) 긍정형 / 전제: "X가 일어난다", "Y가 존재한다"
  // 이전에는 모두 [절대 금지]로 출력해 (b)의 의미가 뒤집히는 문제가 있었다.
  // 이제는 [절대 규칙]로 통합 노출하고, 각 항목의 어미/표현으로 의미를 LLM이 그대로 따르게 한다.
  const absoluteText = sc.absolute_forbidden.length > 0
    ? sc.absolute_forbidden.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : null;

  // ── 이번 화 추가 제약 ───────────────────────────────────────────
  const episodeConstraintLines: string[] = [];
  if (sc.episode_forbidden.length > 0)
    episodeConstraintLines.push(`금지: ${sc.episode_forbidden.join(", ")}`);
  if (sc.episode_required.length > 0)
    episodeConstraintLines.push(`필수 포함: ${sc.episode_required.join(", ")}`);
  if (ctx.task.special_constraints?.length)
    episodeConstraintLines.push(`특수 제약: ${ctx.task.special_constraints.join(", ")}`);
  const episodeConstraintText = episodeConstraintLines.length > 0
    ? episodeConstraintLines.join("\n")
    : null;

  // ── 일반 규칙 ──────────────────────────────────────────────────
  const rulesText = sc.general_rules.length > 0
    ? sc.general_rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "없음";

  // ── 스토리 흐름 (rolling_summary + 최근 아크 요약) ─────────────
  const storyFlowParts: string[] = [];
  if (ctx.rolling_summary) storyFlowParts.push(ctx.rolling_summary);
  const lastArc = ctx.arc_summaries?.at(-1);
  if (lastArc) storyFlowParts.push(`[아크${lastArc.arc_number} ${lastArc.episode_start}~${lastArc.episode_end}화] ${lastArc.summary}`);
  const storyFlowText = storyFlowParts.length > 0 ? storyFlowParts.join("\n") : null;

  // ── 인물 아크 상태 ─────────────────────────────────────────────
  const arcEntries = Object.entries(ctx.character_arcs ?? {});
  const characterArcText = arcEntries.length > 0
    ? arcEntries.map(([name, arc]) => `${name}: ${arc.state}${arc.key_events.length ? ` (${arc.key_events.slice(-2).join(", ")})` : ""}`).join("\n")
    : null;

  // ── 직전 화 말미 ───────────────────────────────────────────────
  const prevTailText = ctx.prev_episode_tail
    ? ctx.prev_episode_tail.slice(-500)
    : null;

  // ── 복선 메모리 ────────────────────────────────────────────────
  const foreshadows = ctx.foreshadow_memory.map(f => `- ${f.content}`).join("\n") || "없음";

  // ── 필수 사건 / 숨은 정보 ─────────────────────────────────────
  const requiredEvents = ctx.task.required_events?.join(", ") || "없음";
  const hiddenInfo = ctx.task.hidden_info?.length
    ? ctx.task.hidden_info.join(", ")
    : null;

  // ── 등장 불가 인물 ─────────────────────────────────────────────
  const absentLine = sc.absent_characters.length > 0
    ? `\n[등장 불가 인물] ${sc.absent_characters.join(", ")} — 이번 화에 등장하지 않는다\n`
    : "";

  // ── 세계관 장소 제약 (범용: 모든 장르 적용, 프롬프트 최상단 배치) ──────
  const worldGenre = ctx.world_config?.genre     ?? "";
  const worldBg    = ctx.world_config?.background ?? "";
  // world_config가 비어 있으면 general_rules에서 세계관 서술 추출
  // 우선순위: 세계 내부 법칙 설명("이세계에서는..." 등) > 장르 열거형
  const worldDesc =
    sc.general_rules.find(r => /이세계에서는|이 세계에서는|이계에서|마력이 존재|판타지 세계|이 세계의|현재 세계/.test(r))?.slice(0, 120) ||
    sc.general_rules.find(r => /세계관:|배경:/.test(r))?.slice(0, 80) ||
    sc.general_rules.find(r => /장르/.test(r))?.slice(0, 80) ||
    "";
  const worldLabel = [worldGenre, worldBg].filter(Boolean).join(" / ") || worldDesc;
  const worldConstraintBlock = worldLabel
    ? `[★ 세계관 장소 — 최우선]\n` +
      `현재 세계: ${worldLabel}\n` +
      `모든 location은 이 세계에 실존 가능한 장소만 사용. 이전 화/현재 상태에 세계 외 장소가 있으면 그 값을 무시하고 세계 안 장소로 대체한다(회상·꿈 제외). 인물의 출신 세계 장소는 현재 화 배경으로 사용 불가.`
    : null;

  // ── 프롬프트 조립 ──────────────────────────────────────────────
  const sections: string[] = [
    `[${ctx.episode_number}화]\n[목표] ${sc.task_goal}\n[필수 사건] ${requiredEvents}\n[엔딩 훅 방향] ${sc.ending_hook_direction || "자유"}`,
    `[연재 계약]\n${narrativeLines}`,
    `[서사 국면]\n${arcPhaseText}`,
  ];

  // 세계관 장소 제약을 최상단에 배치 (interventionText보다 먼저)
  if (worldConstraintBlock)
    sections.push(worldConstraintBlock);

  if (interventionText)
    sections.push(`[작가 개입]\n${interventionText}`);

  if (absoluteText) {
    const absoluteHeader =
      `[절대 규칙 — 본문에서 반드시 준수]\n` +
      `각 항목의 자연어 의미 그대로 적용. 부정형은 그 일이 일어나지 않게, 긍정형/전제는 ${ctx.episode_number === 1 ? "이번 1화 본문 안에서 명시적으로 그려지게" : "이미 일어난 사건으로 전제하게"} (도입(전이·각성·만남) 묘사 포함). 규칙 문장을 본문에 그대로 옮기지 말고 행동·묘사·대사로 반영.\n` +
      absoluteText;
    sections.push(absoluteHeader);
  }

  if (episodeConstraintText)
    sections.push(`[이번 화 제약]\n${episodeConstraintText}`);

  // 주인공 선언은 renderer에서 처리 — planner에서 중복 제거 (토큰 절약)
  sections.push(`[인물 현재 상태]\n${sc.char_summary}${absentLine}`);

  if (sc.prev_event_summary)
    sections.push(`[직전 화 여파]\n${sc.prev_event_summary}`);

  // ── 연속성 계약 (ep >= 2) — known_facts / forbidden_regressions ──
  const cc = ctx.continuity_contract;
  if (cc) {
    const ccLines: string[] = [
      `이번 화(${ctx.episode_number}화)는 ${cc.must_continue_from.episode}화의 결과 위에 쌓이는 장면이다.`,
      cc.must_continue_from.last_state ? `직전 화 마지막 상태: ${cc.must_continue_from.last_state}` : "",
    ].filter(Boolean);

    if (cc.known_facts.length) {
      ccLines.push(`[이미 알려진 사실 — 처음 일어난 것처럼 다루지 않는다]\n${cc.known_facts.slice(0, 8).map(f => `- ${f}`).join("\n")}`);
    }
    if (cc.relationship_state.length) {
      ccLines.push(`[인물 관계 현황]\n${cc.relationship_state.map(r => `- ${r}`).join("\n")}`);
    }
    if (cc.open_threads.length) {
      // R5B-1.5: 발견 사건 재현 차단 — instruction을 "재발견 금지, 의미 추적"으로 변경
      ccLines.push(
        `[열린 플롯 — 미해결 질문/암시. 이번 화에서 1~2개 이어간다]\n` +
        cc.open_threads.map(t => `- ${t}`).join("\n") + "\n" +
        `[발견 행위 반복 금지] 위 항목은 "아직 답이 없는 질문" 또는 "아직 일어나지 않은 사건의 암시"다. ` +
        `이미 본문에서 발견·확인·발화된 사건을 다시 처음 발견하듯 재현하지 말 것. ` +
        `같은 인물이든 다른 인물이든 "마치 처음 발견한 것처럼" 흔적·단서·사실을 발화하면 안 된다. ` +
        `이어가기는 "그 흔적/단서의 의미 해석", "다음 행동 결정", "정체 추적", "위험 노출", "관계·신뢰 변화" 중 하나로만 진전시킨다.`
      );
    }
    if (cc.forbidden_regressions.length) {
      ccLines.push(`[퇴행 금지 — 본문 전개에서 유지]\n${cc.forbidden_regressions.map(r => `- ${r}`).join("\n")}`);
    }
    // Phase 4.11: cross-episode 위치/visibility 누적
    if (cc.character_position_state?.length) {
      const posLines = cc.character_position_state.map(p =>
        `- ${p.character_name}: "${p.last_location}", ${p.visibility}, ${p.items_summary}`
      );
      ccLines.push(
        `[직전 화 종료 시점 인물 상태]\n${posLines.join("\n")}\n` +
        `위치/등장이 다르게 시작하려면 scene_beats에 이동·시간경과·등장 계기 중 하나를 포함한다.`
      );
    }
    // Phase 4.16: 감정/목표 progression requirements
    if (cc.emotional_progression_requirements?.length) {
      const reqLines = cc.emotional_progression_requirements.map(r => `- ${r.instruction}`);
      ccLines.push(
        `[감정·목표 진전 필수]\n${reqLines.join("\n")}\n` +
        `같은 감정이 유지되어도 결정/행동/관계 변화/정보 노출/대가 지불/목표 구체화 중 하나가 본문에 실제로 일어난다.`
      );
    }
    sections.push(`[연속성 계약 — 절대 준수]\n${ccLines.join("\n")}`);
  }

  if (prevTailText) {
    sections.push(`[직전 화 말미 — 이 장면 직후부터 이번 화가 시작된다]\n${prevTailText}`);
    // ep2+ 연속성 강제: 직전 화 말미가 있으면 반드시 그 장면에서 이어지도록 지시
    sections.push(
      `[연속성 — 절대 준수]\n` +
      `beat 1은 위 [직전 화 말미] 마지막 순간의 연속선상에서 시작한다 — 직전 화의 인물·감정·상황을 그대로 이어받는다.\n` +
      `시간 점프(깨어난다/눈을 뜬다/정신이 든다)나 새 장면 출발은 흐름을 끊으므로 사용하지 않는다.\n` +
      `예외: [★ 세계관 장소] 규칙이 우선 — 직전 화 장소가 세계관과 맞지 않으면 세계 안 자연스러운 연속 장소로 대체한다.`
    );
  }

  if (storyFlowText) {
    // R5B-1.5: rolling_summary를 [이미 발생한 사건 — 재현 금지] 섹션으로 reframe.
    // LLM 요약은 발견·확인·발화 사건을 캡처하므로, 이걸 명시적으로 "재현 금지 lock"하면
    // planner/renderer가 같은 흔적·단서를 다시 발견하듯 처리하지 않게 된다.
    sections.push(
      `[이미 발생한 사건 — 재현·재발견·재발화 금지]\n` +
      `아래는 직전 화까지 본문에서 실제로 발생한 사건의 요약이다. 이번 화에서 같은 사건을 처음 일어나는 것처럼 다시 쓰지 말 것. ` +
      `같은 인물이든 다른 인물이든, 같은 흔적/단서/사실을 처음 발견하듯 발화하면 안 된다. ` +
      `진전 방식: 그 사건의 결과/의미/대응/추적 중 하나로만 이어갈 것.\n\n` +
      storyFlowText
    );
  }

  if (characterArcText)
    sections.push(`[인물 아크]\n${characterArcText}`);

  if (hiddenInfo)
    sections.push(`[숨은 정보]\n${hiddenInfo}`);

  sections.push(`[일반 규칙]\n${rulesText}`);
  sections.push(`[미회수 복선]\n${foreshadows}`);

  // ── hook 다양성 강제 (범용: 이전 화 이력 기반 반복 방지) ─────────
  const recentHooks: string[] = (ctx as any).recent_hook_types ?? [];
  if (recentHooks.length >= 1) {
    sections.push(
      `[hook_type 다양성]\n` +
      `직전 hook 이력: ${recentHooks.join(" → ")} — 가장 최근 "${recentHooks[recentHooks.length - 1]}" 반복 안 함. arc_phase 권장 목록 중 이력과 다른 값 선택.`
    );
  }

  // ── 비활성 인물 로테이션 (ep >= 3) ──────────────────────────────
  // recent_goal이 비어있거나 character_arcs에 key_events가 없는 인물 → 이번 화 우선 배정
  if (ctx.episode_number >= 3 && ctx.characters.length > 0) {
    const dynStates = ctx.character_dynamic_states ?? [];
    const arcs      = ctx.character_arcs ?? {};
    const inactive: string[] = [];
    for (const ch of ctx.characters) {
      const dynState = dynStates.find(d => d.character_name === ch.name);
      const arc      = arcs[ch.name];
      const rawGoal   = dynState?.recent_goal?.trim() ?? "";
      const hasGoal   = !!rawGoal && rawGoal !== "이전 목표 유지";
      const hasEvents = (arc?.key_events?.length ?? 0) > 0;
      if (!hasGoal && !hasEvents) inactive.push(ch.name);
    }
    if (inactive.length > 0) {
      sections.push(
        `[비활성 인물 로테이션 — JSON 필수]\n` +
        `최근 화에 활동 기록이 없는 인물: ${inactive.join(", ")}\n` +
        `scene_beats 중 최소 1 beat의 "characters_involved"에 위 인물 중 1명 이상을 포함시킨다 (단순 배경이 아닌 서사 진행 역할 — 단서 발견·충돌·독립 행동·정보 제공 등).`
      );
    }
  }

  // ── 반복 방지 섹션 ──────────────────────────────────────────────
  const avoidLines: string[] = [];

  // Phase 4.18 — 재생성 시 RegenerationDivergenceContract만 사용.
  // 이전 시도 beat 전문을 prompt에 노출하지 않는다 (anchoring 방지).
  const regenContract = (ctx as any).regen_divergence_contract as
    | import("../types/canonical.js").RegenerationDivergenceContract
    | undefined;
  const isRegen = !!regenContract;

  if (regenContract) {
    const sig = regenContract.old_episode_signature;
    const sigLines: string[] = [];
    if (sig.opening_location)   sigLines.push(`- 직전 시도 도입 장소: ${sig.opening_location}`);
    if (sig.opening_image)      sigLines.push(`- 직전 시도 도입 이미지: ${sig.opening_image}`);
    if (sig.first_conflict)     sigLines.push(`- 직전 시도 첫 갈등: ${sig.first_conflict}`);
    if (sig.ending_hook_type)   sigLines.push(`- 직전 시도 엔딩 훅 유형: ${sig.ending_hook_type}`);
    if (sig.ending_hook_image)  sigLines.push(`- 직전 시도 엔딩 훅 이미지: ${sig.ending_hook_image}`);
    if (sig.emotional_pattern)  sigLines.push(`- 직전 시도 감정 흐름: ${sig.emotional_pattern}`);
    // Phase 4.20 R5A-C — Fix E: attempt_count 정확 숫자 노출 안 함.
    // 누적 시도 횟수를 LLM에 직접 보여주면 "더 다르게 만들어야" 압박이 커져 OOD sampling 위험 ↑.
    // attempt_count 1: "이번 재생성", 2-3: "두세 번째 재생성", 4+: "여러 번의 이전 시도" 로 압축.
    const _attempt = regenContract.attempt_count;
    const _attemptLabel = _attempt >= 4 ? "여러 번의 이전 시도"
                       : _attempt >= 2 ? `${_attempt}번째 재생성`
                       : "이번 재생성";

    const recurringText = regenContract.recurring_patterns.length
      ? `\n[반복 회피 — 자주 등장한 패턴은 변주]\n` +
        regenContract.recurring_patterns.map(p => `- ${p}`).join("\n")
      : "";
    const axesLabel: Record<string, string> = {
      opening_location: "도입 장소",
      opening_image: "첫 장면 이미지",
      first_conflict: "첫 갈등",
      main_event_path: "주요 사건 경로",
      information_reveal_order: "정보 공개 순서",
      character_choice: "인물 선택/결정",
      relationship_interaction: "관계 상호작용",
      item_usage: "소지품 활용",
      threat_entry: "위협 등장 방식",
      ending_hook: "엔딩 훅",
      emotional_route: "감정 경로",
    };
    const axesText = regenContract.must_vary_axes.map(a => axesLabel[a] ?? a).join(", ");
    sections.push(
      `[재생성 분기 계약 — ${regenContract.mode}, ${_attemptLabel}]\n` +
      `직전 시도(N_old) signature (전문은 노출 안 함):\n` +
      (sigLines.length ? sigLines.join("\n") : "(추출 불가 — 자유 분기)") +
      recurringText +
      `\n\n[분기 대상 — must_vary axes]\n가능: ${axesText}\n` +
      `이번 시도는 위 axes 중 **최소 ${regenContract.hint_min_divergent_axes}개**에서 직전 시도와 다른 선택을 한다. ` +
      `세계관·인물 정체성은 유지 — "같은 맥락에서 다른 선택"이다.`
    );
    // Phase 4.20 R5A-C — Fix E 보강: "여러 번 시도되었다" 강한 경고문 제거.
    // R5A-C 분석에서 "39회 시도" 노출 자체가 LLM 인지적 압박을 가중시킴을 확인.
    // 분기 안내는 위 axes section에 충분 — 추가 압박 안내문은 제거.
  }

  // 직전 화 / 스토리 흐름 기반 진전 방향 — 재생성이 아닌 일반 다음화 생성에만 적용
  if ((prevTailText || storyFlowText) && !isRegen) {
    avoidLines.push(
      "- 직전 화 사건(만남·대화·발견·약속)은 이미 일어난 것으로 전제하고, 그 결과 위에서 새 전개를 만든다.",
      "- 같은 장소·인물·목적이 반복될 때는 새 정보·새 결정·새 결과 중 하나로 변주한다.",
      "- 직전 화 감정·장소·상황의 연속선에서 사건이 전진한다 — 새 출발점 대신 이어지는 진전."
    );
  }

  // 1화 도입부 원칙 — 신규 ep1 또는 ep1 재생성.
  if (ctx.episode_number === 1) {
    const genre = ctx.world_config?.genre ?? "";
    const bg    = ctx.world_config?.background ?? "";
    const isEp1Regen = regenContract?.mode === "episode1_regeneration";
    sections.push(
      `[첫 화 도입부 원칙 — ${isEp1Regen ? "alternate opening generation" : "first introduction"}]\n` +
      `장르·배경: ${[genre, bg].filter(Boolean).join(" / ") || "미지정"}\n` +
      `독자는 이번 본문에서 세계·인물·갈등을 처음 만난다 — 모든 사건은 이번 화에서 시작/발견된다 ("이전부터 진행 중" 전제 사용 안 함). 과거 누적 표현(그동안·지금까지·반복적으로)은 회상/꿈에서만 허용. 인물 첫 등장 시 이름/역할/관계 단서를 행동·대화로 드러낸다. ` +
      (isEp1Regen
        ? `재생성: signature는 회피 대상일 뿐 일어난 사건이 아니다 — 같은 세계관/인물에서 다른 도입 각도로 처음부터 설계한다. `
        : "") +
      `도입 방식은 자유 (행동/대화/관찰/독백 등).`
    );
  }

  if (avoidLines.length > 0) {
    sections.push(`[이번 화에서 반드시 피해야 할 패턴]\n${avoidLines.join("\n")}`);
  }

  // ── Episode Delta Contract (ep >= 2, 재생성 1화 제외) ──────────
  // 프롬프트 절약: continuity_contract와 중복되는 내용은 delta에서 압축 (핵심만 유지)
  const dc = ctx.episode_delta_contract;
  if (dc && ctx.episode_number >= 2) {
    const dcLines: string[] = [
      `이번 화(${dc.episode_number}화)는 직전 화의 반복이 아니라 후속 결과여야 한다.`,
    ];

    // must_not_repeat: 상위 3개만 (continuity_contract.known_facts와 중복 방지)
    if (dc.must_not_repeat.length) {
      dcLines.push(
        `[반복 금지 (상위 3)]\n${dc.must_not_repeat.slice(0, 3).map(s => `- ${s}`).join("\n")}`
      );
    }

    // must_progress: 상위 3개만
    if (dc.must_progress.length) {
      dcLines.push(
        `[전진 필수]\n${dc.must_progress.slice(0, 3).map(s => `- ${s}`).join("\n")}`
      );
    }

    // character_delta: 상위 2인물만
    if (dc.character_delta_requirements.length) {
      const charDelta = dc.character_delta_requirements
        .slice(0, 2)
        .map(c => `- ${c.character_name}: ${c.required_change}`)
        .join("\n");
      dcLines.push(`[인물 변화]\n${charDelta}`);
    }

    // repetition_risk: 상위 2개만 (verify 체크 충족 + 토큰 절약)
    if (dc.repetition_risk.length) {
      dcLines.push(
        `[반복 위험]\n` +
        dc.repetition_risk.slice(0, 2).map(r => `- ${r.pattern}`).join("\n")
      );
    }

    sections.push(`[Episode Delta Contract — 절대 준수]\n${dcLines.join("\n")}`);
  }

  // ── 출력 형식 최종 확인 (스키마 준수 강제) ──────────────────────
  sections.push(
    `[출력 — JSON만, 다른 텍스트 없음]\n` +
    `{"carryover_effects":[...],"world_rule":{"rule_content":"...","activation_type":"...","scene_usage":"..."},"scene_beats":[{"beat_number":1,"summary":"...","characters_involved":[...],"location":"..."}],"hook_type":"...","hook_payload":"...","hook_concrete_event":"...","character_state_updates":[{"character_name":"...","emotional_state":"...","items":[],"recent_goal":"..."}]}\n` +
    `hook_type 허용값 (이 식별자만 사용, 번역·변형 안 함): immediate_threat | unexpected_discovery | new_problem | unresolved_situation | revelation | betrayal_hint | emotional_break | ironic_reversal | cliffhanger_choice | tender_moment | ominous_calm | memory_trigger | last_moment_failure | sudden_loss | alliance_shift | time_pressure\n` +
    `character_state_updates는 scene 등장 핵심 인물 전원 포함 (생략 안 함).`
  );

  sections.push("위 정보를 바탕으로 장면 계획 JSON을 출력해라.");

  return sections.join("\n\n");
}

// ══════════════════════════════════════════════════════════════
// hook_type 정규화 — 허용 목록 외 값 자동 교정
// ══════════════════════════════════════════════════════════════
const VALID_HOOK_TYPES = new Set<string>(HOOK_TYPES);

const HOOK_ALIAS_MAP: Record<string, string> = {
  // 한국어 번역 → 정규 식별자
  "즉각위협":   "immediate_threat",     "즉각 위협":     "immediate_threat",
  "예상밖발견": "unexpected_discovery", "예상 밖 발견":  "unexpected_discovery",
  "새문제":     "new_problem",          "새 문제":       "new_problem",
  "미완상황":   "unresolved_situation", "미완 상황":     "unresolved_situation",
  "정체폭로":   "revelation",           "사실폭로":      "revelation",
  "배신암시":   "betrayal_hint",        "배신 암시":     "betrayal_hint",
  "감정폭발":   "emotional_break",      "감정 폭발":     "emotional_break",
  "아이러니반전":"ironic_reversal",     "아이러니 반전": "ironic_reversal",
  "선택기로":   "cliffhanger_choice",   "선택 기로":     "cliffhanger_choice",
  "감동연결":   "tender_moment",        "감동적연결":    "tender_moment",
  "불길한고요": "ominous_calm",         "불길한 고요":   "ominous_calm",
  "기억촉발":   "memory_trigger",       "과거기억":      "memory_trigger",
  "직전좌절":   "last_moment_failure",  "직전 좌절":     "last_moment_failure",
  "갑작스러운상실":"sudden_loss",       "갑작스러운 상실":"sudden_loss",
  "동맹역전":   "alliance_shift",       "동맹 역전":     "alliance_shift",
  "시간압박":   "time_pressure",        "시간 압박":     "time_pressure",
  // 영문 변형 → 정규 식별자
  "mystery":        "unexpected_discovery",
  "suspense":       "ominous_calm",
  "cliffhanger":    "cliffhanger_choice",
  "twist":          "ironic_reversal",
  "revelation_hint":"revelation",
  "foreshadowing":  "ominous_calm",
};

function normalizeHookType(raw: any): HookType {
  if (typeof raw !== "string") return "unresolved_situation";
  const trimmed = raw.trim();
  if (VALID_HOOK_TYPES.has(trimmed)) return trimmed as HookType;
  // 공백 제거 후 재시도
  const noSpace = trimmed.replace(/\s+/g, "");
  if (VALID_HOOK_TYPES.has(noSpace)) return noSpace as HookType;
  // alias 맵 조회
  const alias = HOOK_ALIAS_MAP[trimmed] ?? HOOK_ALIAS_MAP[noSpace];
  if (alias && VALID_HOOK_TYPES.has(alias)) return alias as HookType;
  // 부분 매칭
  for (const [key, val] of Object.entries(HOOK_ALIAS_MAP)) {
    if (trimmed.includes(key) || key.includes(trimmed)) return val as HookType;
  }
  logWarn("pipeline:planner", "hook_type 정규화 실패 — fallback unresolved_situation", { raw: trimmed });
  return "unresolved_situation";
}

// ══════════════════════════════════════════════════════════════
// JSON 파싱 복구 전략
// ══════════════════════════════════════════════════════════════
function parseCreativePlan(raw: string): CreativePlan | null {
  function tryParse(s: string): CreativePlan | null {
    try {
      const p = JSON.parse(s);
      if (p.scene_beats && p.hook_type) {
        p.hook_type = normalizeHookType(p.hook_type);
        return p as CreativePlan;
      }
    } catch {}
    return null;
  }

  // 1. 직접 파싱
  const direct = tryParse(raw.trim());
  if (direct) return direct;

  // 2. ```json ... ``` 블록 추출
  const jsonBlock = raw.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock) {
    const block = tryParse(jsonBlock[1].trim());
    if (block) return block;
  }

  // 3. 첫 { ... } 추출
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const brace = tryParse(braceMatch[0]);
    if (brace) return brace;
  }

  return null;
}

// items에 상태값이 섞였는지 판단 — 부상·피로·감정 키워드가 포함된 문자열은 소지품 아님
const STATE_KEYWORDS = ["부상","상처","출혈","골절","타박","피로","지침","탈진","소진","중독","마비",
  "봉인","저주","변이","석화","빙결","기절","혼수","불안","긴장","공포","절망","분노","슬픔",
  "찰과상","열상","자상","피 흘림","악화","누적","흔적","자국",
  "체력 고갈","기력 고갈","체력 소진","기력 소진","호흡 곤란","숨가쁨"];

function _isStateString(s: string): boolean {
  return STATE_KEYWORDS.some(k => s.includes(k));
}

/**
 * R5B-1.7 — character_emotional_beats 안전 추출.
 * planner output에서 인물별 감정 변화 설계 (cause/goal_delta/behavior_delta)를 뽑아
 * pipeline carry-forward gating + audit에 사용.
 */
export interface CharacterEmotionalBeat {
  name: string;
  previous_emotion?: string;
  current_emotion?: string;
  emotion_cause?: string;
  goal_delta?: string;
  behavior_delta?: string;
}

function extractEmotionalBeats(parsed: any): CharacterEmotionalBeat[] {
  const raw = parsed?.character_emotional_beats;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b: any) => typeof b?.name === "string" && b.name.trim().length > 0)
    .map((b: any) => ({
      name: String(b.name).trim(),
      previous_emotion: typeof b.previous_emotion === "string" ? b.previous_emotion : undefined,
      current_emotion:  typeof b.current_emotion  === "string" ? b.current_emotion  : undefined,
      emotion_cause:    typeof b.emotion_cause    === "string" ? b.emotion_cause    : undefined,
      goal_delta:       typeof b.goal_delta       === "string" ? b.goal_delta       : undefined,
      behavior_delta:   typeof b.behavior_delta   === "string" ? b.behavior_delta   : undefined,
    }));
}

/** character_state_updates 배열 안전 추출 — 형식 불일치 시 [] 반환 */
function extractStateUpdates(parsed: any): CharacterStateUpdate[] {
  const raw = parsed?.character_state_updates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u: any) => typeof u?.character_name === "string").map((u: any) => {
    // items에 상태 키워드 문자열이 섞인 경우 — 걸러내고 physical_state로 귀속
    const extraStateItems: string[] = [];
    const cleanItems = Array.isArray(u.items) ? u.items.map((i: any) => {
      if (typeof i === "string") {
        if (_isStateString(i)) { extraStateItems.push(i); return null; }
        return { name: i };
      }
      if (typeof i?.name === "string") {
        if (_isStateString(i.name)) { extraStateItems.push(i.name); return null; }
        return {
          name: i.name,
          ...(i.grade       ? { grade:       i.grade       } : {}),
          ...(i.condition   ? { condition:   i.condition   } : {}),
          ...(i.description ? { description: i.description } : {}),
        };
      }
      return null;
    }).filter(Boolean) : undefined;

    // 물리 상태: 기존 physical_state + 아이템에서 걸러낸 상태 문자열 합산
    let physState = typeof u.physical_state === "string" ? u.physical_state : undefined;
    if (extraStateItems.length > 0) {
      physState = [physState, ...extraStateItems].filter(Boolean).join(", ");
    }

    return {
      character_name:   u.character_name,
      emotional_state:  typeof u.emotional_state  === "string" ? u.emotional_state  : undefined,
      physical_state:   physState,
      items:            cleanItems,
      location:         typeof u.location         === "string" ? u.location         : undefined,
      visibility_state: ["present","absent","cannot_act"].includes(u.visibility_state)
                          ? u.visibility_state : undefined,
      recent_goal:      typeof u.recent_goal      === "string" ? u.recent_goal      : undefined,
    };
  });
}

// ══════════════════════════════════════════════════════════════
// 결정론적 fallback — LLM 실패 시 최소 계획 생성
// ══════════════════════════════════════════════════════════════
function buildFallbackPlan(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
): CreativePlan {
  const rule = sc.general_rules[0] ?? "세계관 규칙 없음";
  const prevEnding = ctx.prev_episode_state.ending_event;
  const chars = ctx.characters.map(c => c.name);

  const carryover: CarryoverEffect[] = prevEnding
    ? [{
        character_name: chars[0] ?? "주인공",
        description: `직전 사건(${prevEnding.slice(0, 40)})의 긴장감·여파가 이번 화 첫 행동에서 이어진다`,
        must_appear_in_opening: true,
      }]
    : [];

  const worldRule: WorldRuleActivation = {
    rule_content: rule,
    activation_type: "constraint",
    scene_usage: `"${rule}" 규칙이 이번 화에서 인물의 행동 선택지를 제한하는 상황이 발생한다`,
  };

  const beats: SceneBeat[] = [
    {
      beat_number: 1,
      summary: `인물들이 ${sc.opening_location}에서 ${ctx.task.goal}을 위해 움직이기 시작한다`,
      characters_involved: chars,
      location: sc.opening_location,
    },
    {
      beat_number: 2,
      summary: ctx.task.required_events?.[0]
        ? `${ctx.task.required_events[0]} 사건이 발생한다`
        : "상황이 복잡해지며 갈등이 고조된다",
      characters_involved: chars,
      location: sc.opening_location,
    },
  ];

  const hookDir = sc.ending_hook_direction;
  return {
    carryover_effects: carryover,
    world_rule: worldRule,
    scene_beats: beats,
    hook_type: "unresolved_situation" as HookType,
    hook_payload: hookDir || "다음 화로 이어지는 미해결 상황이 발생한다",
    hook_concrete_event: hookDir
      ? `${hookDir} 상황이 마지막 장면에서 구체적으로 드러난다`
      : "예상치 못한 발견이나 위협이 발생해 독자를 다음 화로 끌어당긴다",
  };
}

// ══════════════════════════════════════════════════════════════
// 메인 함수
// ══════════════════════════════════════════════════════════════
export async function runCreativePlanner(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
  modelOverride?: string,
  routeSetOverride?: string,
): Promise<{ plan: CreativePlan; fallback_used: boolean; raw_output: string }> {
  const systemPrompt = buildPlannerSystemPrompt();
  const userPrompt = buildPlannerUserPrompt(ctx, sc);

  // Phase 4.14 — config 라우트가 planner에 다른 provider/model을 지정하면 router 사용.
  // 그렇지 않으면 legacy path. routeSetOverride가 명시된 경우 우선 적용.
  const route = resolveTaskRoute("planner", routeSetOverride);
  const useRouter = !modelOverride
    && route
    && (route.provider !== getActiveProvider() || route.model !== getPlannerModel());

  const model = modelOverride ?? (useRouter ? route!.model : getPlannerModel());

  logInfo("pipeline:planner", "창의적 장면 계획 생성", {
    episode: ctx.episode_number,
    model,
    provider: useRouter ? route!.provider : getActiveProvider(),
    via: useRouter ? "router" : "legacy",
    route_set_override: routeSetOverride,
  });

  // Phase 4.18 — 재생성 시 sampling 다양성 강화. 일반 next_episode_generation은 0.65 유지.
  // Phase 4.20 R5A-C — Fix D: temperature cap 0.95 → 0.88. 0.95는 OOD sampling이 잦아
  // 한국어 본문이 외국어/CJK fragment로 빠지는 임계점.
  // 변경:
  //   기존: min(0.95, 0.75 + attempt*0.05) → attempt 4+ = 0.95
  //   신규: min(0.88, 0.75 + min(attempt,3)*0.043) → attempt 3+ = 0.88
  const _regenContract = (ctx as any).regen_divergence_contract as
    | import("../types/canonical.js").RegenerationDivergenceContract
    | undefined;
  const _temperaturePlanner = _regenContract
    ? Math.min(0.88, 0.75 + Math.min(_regenContract.attempt_count, 3) * 0.043)
    : 0.65;

  try {
    let raw: string;
    if (useRouter) {
      const r = await runLLMTask("planner", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        route_set_override: routeSetOverride,
        temperature: _temperaturePlanner,
        max_tokens: 3000,
      });
      raw = r.text;
    } else {
      const llm = getLLMClient();
      const res = await (llm.chat.completions.create as any)({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        temperature: _temperaturePlanner,
        max_tokens: 3000,
      });
      raw = res.choices?.[0]?.message?.content ?? "";
    }
    // character_state_updates는 CreativePlan과 별도로 raw에서 안전 추출
    let rawParsed: any = null;
    try { rawParsed = JSON.parse(raw.trim()); } catch {}
    if (!rawParsed) {
      const m = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/);
      if (m) try { rawParsed = JSON.parse((m[1] ?? m[0]).trim()); } catch {}
    }
    const stateUpdates = extractStateUpdates(rawParsed);
    if (stateUpdates.length === 0) {
      logWarn("pipeline:planner", "character_state_updates 빈 배열 — 상태 커밋 스킵 예정", {
        episode: ctx.episode_number,
        raw_has_state_updates: raw.includes("character_state_updates"),
        raw_length: raw.length,
        raw_tail: raw.slice(-200),
      });
    }
    // R5B-1.7: character_emotional_beats 추출 (carry-forward gating에 사용)
    const emotionalBeats = extractEmotionalBeats(rawParsed);

    const parsed = parseCreativePlan(raw);

    if (parsed) {
      parsed.character_state_updates = stateUpdates;
      (parsed as any).character_emotional_beats = emotionalBeats;
      logInfo("pipeline:planner", "플래너 JSON 파싱 성공", {
        state_updates: stateUpdates.length,
        emotional_beats: emotionalBeats.length,
      });
      return { plan: parsed, fallback_used: false, raw_output: raw };
    }

    logWarn("pipeline:planner", "JSON 파싱 실패 — fallback 사용", {
      raw_preview: raw.slice(0, 200),
    });
    return { plan: buildFallbackPlan(ctx, sc), fallback_used: true, raw_output: raw };

  } catch (err) {
    logWarn("pipeline:planner", "플래너 LLM 오류 — fallback 사용", { error: String(err) });
    return { plan: buildFallbackPlan(ctx, sc), fallback_used: true, raw_output: "" };
  }
}
