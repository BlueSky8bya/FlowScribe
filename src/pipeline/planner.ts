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

import { getLLMClient, getPlannerModel } from "../lib/llm.js";
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
  const lines = [`현재 서사 국면: ${label[phase]} (남은 화수: ${remaining}화)`];
  if (d.allowed.length) lines.push(`[이 국면에 적합한 전개]\n${d.allowed.map(s => `- ${s}`).join("\n")}`);
  if (d.forbidden.length) lines.push(`[이 국면에 금지된 전개]\n${d.forbidden.map(s => `- ${s}`).join("\n")}`);
  if (hg.preferred.length) lines.push(`[이 국면 hook_type — 반드시 이 중 하나를 선택할 것] ${hg.preferred.join(", ")}`);
  if (hg.avoid.length) lines.push(`[이 국면 절대 금지 hook_type — 사용 시 오류] ${hg.avoid.join(", ")}`);
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════
// Planner 프롬프트 조립
// ══════════════════════════════════════════════════════════════
function buildPlannerSystemPrompt(): string {
  return `[언어 규칙] JSON 값의 모든 텍스트는 100% 한국어로 작성한다. 키릴·아랍·가나 등 비한글 문자 사용 금지.

당신은 소설 장면 설계자다. 소설 본문을 쓰지 않는다. JSON 계획만 출력한다.

아래 JSON 형식만 출력한다 (다른 텍스트 없이):
{
  "carryover_effects": [
    {"character_name": "인물명", "description": "이번 화 첫 단락에서 드러나야 할 직전 사건의 여파", "must_appear_in_opening": true}
  ],
  "world_rule": {
    "rule_content": "활용할 세계관 규칙 원문",
    "activation_type": "constraint",
    "scene_usage": "이 규칙이 이번 화에서 어떤 상황에서 인물의 행동·선택에 실제로 영향을 미치는지"
  },
  "scene_beats": [
    {"beat_number": 1, "summary": "장면 비트 요약", "characters_involved": ["인물명"], "location": "장소"}
  ],
  "hook_type": "unresolved_situation",
  "hook_payload": "훅의 내용 요약 (1~2문장)",
  "hook_concrete_event": "마지막 2~4문장에서 실제로 일어날 구체적 사건 묘사",
  "character_state_updates": [
    {
      "character_name": "인물명",
      "emotional_state": "이번 화 종료 시점 감정 상태 (짧은 상태어, 예: 불안, 결의, 공포) — 반드시 이전 화와 다른 상태여야 한다",
      "physical_state": "부상·피로 등 신체 상태 변화 (변화 없으면 생략)",
      "items": [{"name": "아이템명", "grade": "S/A/B/C/D", "condition": "손상·충전·봉인 등 상태 (정상이면 생략)", "description": "짧은 용도·내력 (선택)"}],
      "location": "이번 화 종료 시점 위치 (변화 없으면 생략)",
      "visibility_state": "present",
      "recent_goal": "이번 화에서 이 인물이 추구하는 구체적 목표나 태도 (1~2문장)"
    }
  ]
}

hook_type 규칙 — 반드시 준수:
- hook_type 값은 반드시 아래 식별자 목록 중 정확히 하나를 그대로 사용한다.
- 번역, 변형, 새 식별자 생성 절대 금지. 아래 영문 식별자 그대로 출력.
- 허용 식별자:
  immediate_threat | unexpected_discovery | new_problem | unresolved_situation | revelation
  betrayal_hint | emotional_break | ironic_reversal | cliffhanger_choice | tender_moment
  ominous_calm | memory_trigger | last_moment_failure | sudden_loss | alliance_shift | time_pressure

규칙:
- scene_beats는 2~4개. 각 비트는 인물 행동·사건이 명확해야 한다.
- world_rule.activation_type은 "constraint"(행동 제약) / "conflict_cause"(갈등 원인) / "resolution_means"(해결 수단) 중 하나.
- world_rule.scene_usage는 "이 규칙 때문에 ~가 ~할 수 없다/해야 한다" 형식.
- hook_concrete_event는 분위기 묘사("어둠이 깔렸다" 등)가 아닌 실제 인물 행동·사건이어야 한다.

[반복 패턴 금지 — 반드시 준수]
- "주인공이 낯선 환경에 등장/각성 → 누군가와 첫 만남 → 외부 위협이 나타난다" 형식의 3단 공식 절대 금지.
- beat 1을 "눈을 떴다/깨어났다/정신이 들었다/의식이 돌아왔다" 류 각성 묘사로 시작하는 것 금지.
- 외부 물리적 위협(짐승·괴물·적·추격자 등)을 hook으로 사용하는 것은 intro/early 국면에서 금지.
- 각 화는 이전 화와 완전히 다른 감정적 출발점·사건 유형에서 시작해야 한다.
- beat를 설계할 때 "이 화·이 인물·이 세계관에서만 일어날 수 있는 구체적 사건"을 반드시 1개 이상 넣어야 한다.
- 인물의 내면 갈등(선택 기로, 의심, 결심, 배신감, 수치심, 충동 등)이나 관계 역학 변화를 중심으로 설계하는 것을 권장한다.
- [1화 전용] 이야기의 첫 화에서는 인물이 처한 상황보다 인물 자체의 목소리·태도·세계 인식이 먼저 드러나야 한다. "사건이 일어난다"보다 "이 인물은 어떤 존재인가"를 보여주는 것이 우선이다.
- character_state_updates: 이번 화 종료 시점 인물 상태 예측. scene_beats에 등장하는 핵심 인물만 포함.
- items 필드는 **반드시 출력**한다. 이번 화에서 소지품 변화가 없어도 현재 소지 중인 물건 전체를 그대로 기재한다. 아무것도 없으면 빈 배열 []로 명시한다. 절대 생략하지 않는다.
- 그 외 변화 없는 필드(location, physical_state 등)는 생략 가능.
- emotional_state는 반드시 이전 화 상태와 달라야 한다. 서사 맥락에 따른 자연스러운 감정 변화가 있어야 한다.
- recent_goal은 이번 화에서 해당 인물이 추구하는 구체적인 목표나 태도를 1~2문장으로 서술한다.

[소지품 배정 원칙 — 반드시 준수]
- 인물에게 소지품을 배정할 때 반드시 세계관·배경·시대·상황과 일치하는 물건만 사용한다.
- 판단 기준: "이 세계의 이 인물이 이 상황에서 실제로 가질 수 있는가?"를 먼저 검증한다.
- 소지품은 인물의 성격·역할·처지와도 일치해야 한다. 인물 성향·역할과 맞지 않는 물건은 배정 금지.
- 소지품이 없거나 맨손 상태라면 items 필드를 빈 배열로 두거나 생략한다. 억지로 물건을 채우지 않는다.
- 이미 [인물 현재 상태]에 소지품이 명시되어 있다면 그대로 유지하고, 이번 화에서 획득·분실·파손된 경우에만 변경한다.
- ★ 장면에 등장하는 소품(쇠사슬, 밧줄, 함정, 가구 등)은 소지품이 아니다. 인물이 직접 소유·휴대하는 물건만 items에 넣는다.
- ★★ 소지품 이름(name)은 사용자가 설정한 원본 이름을 그대로 사용한다. 절대로 축약하거나 임의로 변경하지 않는다.
  예시: "고성능 손전등" → "손전등"으로 줄이는 것 금지. 그대로 "고성능 손전등"으로 출력할 것.
- ★★ 소지품 상태 변화는 name이 아니라 condition에 기록한다.
  금지: name: "손전등(방전)" / name: "방전된 손전등"
  정답: name: "고성능 손전등", condition: "방전"
- ★★ 스킬·능력·특성·이능·마법 능력·패시브는 items에 절대 넣지 않는다.
  예시: "똑똑이 스킬", "고유 스킬: 분석", "마법 능력 Lv.3" 등은 items 아님. 완전 제외할 것.

[소지품 등급 및 상태 원칙 — 반드시 준수]
- 모든 소지품에 grade(S/A/B/C/D)를 배정한다. 기준: 세계관 내 희소성·인물 처지·서사적 의미.
  S: 세계관 내 극히 드물거나 서사적으로 핵심인 물건 (전설 무기, 유일한 유품 등)
  A: 고품질·고가·특별한 내력의 물건 (정예 장비, 고위직 상징물 등)
  B: 표준 품질·기능에 충실한 물건 (일반 군용 장비, 숙련자 도구 등)
  C: 낡거나 저렴하거나 흔한 물건
  D: 파손·기능 저하·임시방편으로 쓰는 물건
- condition(상태)은 인물의 성격·생활방식·처지를 반영한다.
  깔끔하거나 자존심 강한 인물의 첫 화 장비: "상태 양호", "날이 잘 서 있음" 등 정비된 상태
  빈곤하거나 방랑 중인 인물: 낡거나 수리 흔적 있어도 자연스럽게
  이야기 중 파손·소모가 없었다면 첫 화 condition은 인물 성격 기반으로 설정
- description은 물건의 짧은 용도나 내력을 1문장 이내로 서술 (생략 가능).
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

  // ── 절대 금지 ──────────────────────────────────────────────────
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
    ? `[★ 세계관 장소 제약 — 최우선 준수]\n` +
      `현재 이야기의 세계: ${worldLabel}\n` +
      `규칙:\n` +
      `1. scene_beats와 character_state_updates의 location은 반드시 현재 이야기 세계에 실존 가능한 장소여야 한다.\n` +
      `2. [인물 현재 상태]의 위치가 이 세계관과 맞지 않으면(이전 화 오류 포함), 그 값을 무시하고 세계관에 맞는 장소로 직접 대체한다.\n` +
      `3. 등장인물이 다른 세계·시대·차원에서 왔더라도, 현재 이야기의 배경은 위 세계다. 인물의 출신 세계 장소(예: 현대 학교·교실·사무실·아파트)는 현재 화 배경으로 절대 사용 불가 — 회상·꿈 장면으로만 허용된다.\n` +
      `4. [직전 화 말미]에 세계관과 맞지 않는 장소가 나타나면 이전 회차 오류다 — 그 장소를 따르지 않고 세계관에 맞는 자연스러운 장소로 교정한다.\n` +
      `5. 장소가 불명확할 때는 직전 화의 서사 흐름과 세계관에서 가장 자연스러운 장소를 직접 선택한다.`
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

  if (absoluteText)
    sections.push(`[절대 금지]\n${absoluteText}`);

  if (episodeConstraintText)
    sections.push(`[이번 화 제약]\n${episodeConstraintText}`);

  // 주인공 탐지 — personality에 "주인공" 또는 type이 "주인공"인 첫 인물
  const protagonistChar = ctx.characters.find(c =>
    c.type === "주인공" || /주인공/.test(c.personality ?? "")
  );
  if (protagonistChar) {
    sections.push(`[★ 핵심 주인공: ${protagonistChar.name}]\n이 이야기의 주인공은 반드시 ${protagonistChar.name}이다. 모든 scene_beats에서 ${protagonistChar.name}의 시선·감정·행동이 중심이 되어야 한다. 다른 인물이 주인공 역할을 대체하는 장면 계획은 오류다.`);
  }

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
      ccLines.push(`[이미 알려진 사실 — 처음 일어난 것처럼 반복 금지]\n${cc.known_facts.map(f => `- ${f}`).join("\n")}`);
    }
    if (cc.relationship_state.length) {
      ccLines.push(`[인물 관계 현황]\n${cc.relationship_state.map(r => `- ${r}`).join("\n")}`);
    }
    if (cc.open_threads.length) {
      ccLines.push(`[열린 플롯 스레드 — 이번 화에서 최소 1~2개 이어야 한다]\n${cc.open_threads.map(t => `- ${t}`).join("\n")}`);
    }
    if (cc.forbidden_regressions.length) {
      ccLines.push(`[금지된 퇴행 — 절대 금지]\n${cc.forbidden_regressions.map(r => `- ${r}`).join("\n")}`);
    }
    sections.push(`[연속성 계약 — 절대 준수]\n${ccLines.join("\n")}`);
  }

  if (prevTailText) {
    sections.push(`[직전 화 말미 — 이 장면 직후부터 이번 화가 시작된다]\n${prevTailText}`);
    // ep2+ 연속성 강제: 직전 화 말미가 있으면 반드시 그 장면에서 이어지도록 지시
    sections.push(
      `[연속성 — 절대 준수]\n` +
      `이번 화는 위 [직전 화 말미]의 마지막 순간에서 직접 이어진다.\n` +
      `- beat 1은 반드시 직전 화가 끝난 시점·상황의 연속선상에서 시작한다.\n` +
      `- "깨어난다/눈을 뜬다/정신이 든다" 등 시간 점프나 리셋 금지. 흐름이 끊기지 않아야 한다.\n` +
      `- 직전 화 마지막에 등장한 인물·감정을 beat 1에서 바로 이어받는다.\n` +
      `- 직전 화와 완전히 다른 새 장면으로 시작하는 것 금지.\n` +
      `- 단, [★ 세계관 장소 일관성] 규칙이 항상 우선한다. 직전 화의 장소가 세계관과 맞지 않으면 그 장소를 무시하고 세계관에 맞는 자연스러운 연속 장소로 대체한다.`
    );
  }

  if (storyFlowText)
    sections.push(`[스토리 흐름]\n${storyFlowText}`);

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
      `[hook_type 다양성 — 반드시 준수]\n` +
      `직전 화 hook_type 이력: ${recentHooks.join(" → ")}\n` +
      `이번 화는 위 이력에 있는 hook_type, 특히 가장 최근 "${recentHooks[recentHooks.length - 1]}"을 반복하지 않는다.\n` +
      `arc_phase 권장 목록 안에서 이력과 다른 hook_type을 선택한다.`
    );
  }

  // ── 반복 방지 섹션 ──────────────────────────────────────────────
  const avoidLines: string[] = [];

  // 재생성 시: 같은 회차의 모든 이전 시도 beat 전체를 누적 금지 목록으로 주입
  const regenPrev: string | undefined = (ctx as any).regen_prev_text;
  if (regenPrev) {
    sections.push(
      `[이전 시도 beat 기록 — 아래 목록에 나온 구조를 단 하나도 반복 금지]\n${regenPrev}`
    );
    avoidLines.push(
      "- 위 [이전 시도 beat 기록]에 나온 모든 시도의 beat 1 도입 방식을 전부 금지. 완전히 다른 방식으로 열어야 한다.",
      "- 위 기록에 등장한 장소(숲, 특정 위치 등)를 beat 1 배경으로 재사용 금지.",
      "- 위 기록에 등장한 사건 유형(각성, 짐승 위협, 첫 마력 발동 등)을 동일 beat 위치에서 재사용 금지.",
      "- 위 기록에 등장한 hook 사건을 이번 hook으로 재사용 금지.",
      "- 위 기록 중 어느 시도와도 beat-by-beat 유사도가 60% 이상이면 반드시 다시 설계한다."
    );
  }

  // 직전 화 / 스토리 흐름 기반 반복 방지 — 재생성(regen)이 아닌 경우 연속성 유지 원칙 적용
  if (prevTailText || storyFlowText) {
    if (regenPrev) {
      // 재생성: 이전 시도와 다른 방향으로 설계
      avoidLines.push(
        "- [직전 화 말미] 또는 [스토리 흐름]에 이미 등장한 사건·장면 구조를 반복 금지.",
        "- 동일 인물 조합이 동일 장소에서 동일 목적으로 재회하는 구성 금지."
      );
    } else {
      // 다음화 생성: 직전 화 마지막 장면을 이어야 하므로 "감정적 출발점을 달리하라"는 지시 금지
      // 같은 사건을 반복하는 것은 금지하되, 감정·장소·상황의 연속성은 유지한다
      avoidLines.push(
        "- 직전 화에서 이미 일어난 사건(만남·대화·발견·약속)을 처음 일어나는 것처럼 반복 금지.",
        "- 동일 장소·동일 인물 조합·동일 목적으로 사건이 '원점으로 돌아간 것처럼' 구성하는 것 금지.",
        "- 단, 직전 화 감정·장소·상황의 연속선 위에서 사건이 전진하는 것은 필수다. 연속성을 깨는 새 출발점 금지."
      );
    }
  }

  // 1화 재생성 장소 명시 회피 목록
  const avoidLocs: string[] = (ctx as any).regen_avoid_locations ?? [];
  if (avoidLocs.length) {
    avoidLines.push(
      `- 이전 1화 시도에 등장한 장소를 반드시 피한다: ${avoidLocs.join(", ")} — 이 장소들을 beat에 쓰지 않는다.`
    );
  }

  // 1화 또는 재생성 시: 진입점 다양성 강제 (rolling_summary 유무와 무관하게 ep1이면 항상 적용)
  if (ctx.episode_number === 1) {
    const genre = ctx.world_config?.genre ?? "";
    const bg    = ctx.world_config?.background ?? "";
    const hasRegen = !!regenPrev;
    sections.push(
      `[첫 화 진입점 다양성 — 반드시 준수]\n` +
      `장르·배경: ${[genre, bg].filter(Boolean).join(" / ") || "미지정"}\n` +
      `- beat 1은 "주인공이 어딘가에서 눈을 뜬다/깨어난다/나타난다"로 시작 금지.\n` +
      `- beat 1은 "주인공이 기억을 잃었다는 것을 인지한다" 구조로 시작 금지.\n` +
      `- beat 1은 "짐승 소리가 들린다/위협이 나타난다" 구조 금지.\n` +
      (hasRegen
        ? `- 이미 위 [이전 시도 beat 기록]에 있는 도입 방식은 모두 금지. 전혀 다른 각도로 접근한다.\n`
        : "") +
      `- 대신: 주인공이 이미 무언가를 하고 있는 장면, 또는 주인공의 내면이 극명하게 드러나는 순간으로 시작한다.\n` +
      `- 가능한 대안 진입점 예시: 주인공의 독백/생각 흐름, 다른 인물과 이미 진행 중인 대화, 특이한 행동이나 반응.`
    );
  }

  if (avoidLines.length > 0) {
    sections.push(`[이번 화에서 반드시 피해야 할 패턴]\n${avoidLines.join("\n")}`);
  }

  // ── Episode Delta Contract (ep >= 2, 재생성 1화 제외) ──────────
  const dc = ctx.episode_delta_contract;
  if (dc && ctx.episode_number >= 2) {
    const dcLines: string[] = [
      `이번 화(${dc.episode_number}화)는 직전 화의 반복이 아니라 후속 결과여야 한다.`,
    ];

    if (dc.must_not_repeat.length) {
      dcLines.push(
        `[반복 절대 금지]\n${dc.must_not_repeat.slice(0, 5).map(s => `- ${s}`).join("\n")}`
      );
    }

    if (dc.must_progress.length) {
      dcLines.push(
        `[반드시 전진해야 할 항목]\n${dc.must_progress.slice(0, 4).map(s => `- ${s}`).join("\n")}`
      );
    }

    if (dc.newly_required_changes.length) {
      dcLines.push(
        `[이번 화에서 새로 변해야 하는 것]\n${dc.newly_required_changes.map(s => `- ${s}`).join("\n")}`
      );
    }

    if (dc.character_delta_requirements.length) {
      const charDelta = dc.character_delta_requirements
        .slice(0, 4)
        .map(c => `- ${c.character_name}: 이전 상태(${c.previous_state}) → ${c.required_change}`)
        .join("\n");
      dcLines.push(`[인물별 변화 요구사항]\n${charDelta}`);
    }

    if (dc.repetition_risk.length) {
      dcLines.push(
        `[반복 위험 패턴 — 이번 화에서 핵심 사건으로 사용 금지]\n` +
        dc.repetition_risk.map(r => `- ${r.pattern}: ${r.reason.slice(0, 80)}`).join("\n")
      );
    }

    if (dc.plot_delta_requirements.length) {
      dcLines.push(
        `[플롯 스레드 진전 요구]\n` +
        dc.plot_delta_requirements.slice(0, 3).map(p =>
          `- "${p.thread}": ${p.required_progress}`
        ).join("\n")
      );
    }

    sections.push(`[Episode Delta Contract — 절대 준수]\n${dcLines.join("\n")}`);
  }

  // ── 출력 형식 최종 확인 (스키마 준수 강제) ──────────────────────
  // 긴 컨텍스트에서 LLM이 스키마를 이탈하지 않도록 user prompt 마지막에 명시
  sections.push(
    `[출력 형식 최종 확인 — 반드시 아래 JSON 구조만 출력]\n` +
    `{\n` +
    `  "carryover_effects": [{...}],\n` +
    `  "world_rule": {"rule_content": "...", "activation_type": "...", "scene_usage": "..."},\n` +
    `  "scene_beats": [{"beat_number": 1, "summary": "...", "characters_involved": [...], "location": "..."}],\n` +
    `  "hook_type": "반드시 허용 식별자 중 하나",\n` +
    `  "hook_payload": "...",\n` +
    `  "hook_concrete_event": "...",\n` +
    `  "character_state_updates": [{"character_name": "...", "emotional_state": "...", "items": [], "recent_goal": "..."}]\n` +
    `}\n` +
    `hook_type 허용 식별자 (이 값만 사용, 번역·변형 금지):\n` +
    `immediate_threat | unexpected_discovery | new_problem | unresolved_situation | revelation\n` +
    `betrayal_hint | emotional_break | ironic_reversal | cliffhanger_choice | tender_moment\n` +
    `ominous_calm | memory_trigger | last_moment_failure | sudden_loss | alliance_shift | time_pressure\n` +
    `character_state_updates는 절대 생략 불가. scene에 등장한 핵심 인물 전원 포함.\n` +
    `JSON 외 설명 텍스트, 주석, 추가 키 출력 금지.`
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
): Promise<{ plan: CreativePlan; fallback_used: boolean; raw_output: string }> {
  const llm   = getLLMClient();
  const model = modelOverride ?? getPlannerModel();

  logInfo("pipeline:planner", "창의적 장면 계획 생성", {
    episode: ctx.episode_number, model,
  });

  try {
    const res = await (llm.chat.completions.create as any)({
      model,
      messages: [
        { role: "system", content: buildPlannerSystemPrompt() },
        { role: "user",   content: buildPlannerUserPrompt(ctx, sc) },
      ],
      temperature: 0.65,   // 다양성 유지하되 JSON 스키마 준수율 향상
      max_tokens: 3000,    // scene_beats 4개 + character_state_updates 4인물 + 여유
    });

    const raw = res.choices?.[0]?.message?.content ?? "";
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

    const parsed = parseCreativePlan(raw);

    if (parsed) {
      parsed.character_state_updates = stateUpdates;
      logInfo("pipeline:planner", "플래너 JSON 파싱 성공", { state_updates: stateUpdates.length });
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
