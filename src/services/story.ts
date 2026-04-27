import { getLLMClient, getStoryModel } from "../lib/llm.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { variantCPovRule, checkPovForService } from "../policies/pov_rules.js";
import type { Response } from "express";
import type { ArcSummary, CharacterArc } from "./arc_memory.js";

export interface StoryConfig {
  pov: string;
  style: string;
  episodeLength: number;
  episodeLengthVar: number;
  totalEpisodes: number;
  totalEpisodesVar: number;
  conflict: number;
  foreshadow: number;
  emotion: number;
  dialogue: number;
  direction: number;
}

export interface WorldBible {
  world_rules: string[];
  character_defaults: Record<string, string>;
  fixed_relationships: string[];
  forbidden_settings: string[];
  story_config?: StoryConfig;
}

export interface ReaderProfile {
  focus: number;
  sentiment: number;
  urgency: number;
  complexity: number;
  dialogue: number;
  audio_sync: number;
}

export interface OpenForeshadow {
  id: string;
  planted_episode: number;
  content: string;
  keywords: string[];
}

export interface StoryContext {
  worldBible: WorldBible;
  readerProfile: ReaderProfile;
  rollingSummary: string;
  directorOverrides: string[];        // L0: 최상위 우선순위
  foreshadowMemory: OpenForeshadow[]; // DB에서 로드된 전체 open 복선
  arcSummaries: ArcSummary[];         // 아크 단위 장기 기억
  characterArcs: Record<string, CharacterArc>; // 최신 인물 상태
  episodeNumber: number;
  userPrompt?: string;
  prevEpisodeTail?: string; // 직전 화 마지막 300자 — 연속성 강화
}

const DEFAULT_CONFIG: StoryConfig = {
  pov: "3인칭 관찰자", style: "균형",
  episodeLength: 800, episodeLengthVar: 200,
  totalEpisodes: 20,  totalEpisodesVar: 5,
  conflict: 5, foreshadow: 5, emotion: 5, dialogue: 5, direction: 5,
};

function buildSystemPrompt(ctx: StoryContext, isFinale: boolean): string {
  const { worldBible, readerProfile, rollingSummary, directorOverrides,
          foreshadowMemory, arcSummaries, characterArcs, episodeNumber, prevEpisodeTail } = ctx;
  const cfg = { ...DEFAULT_CONFIG, ...(worldBible.story_config ?? {}) };

  // ── 기승전결 페이즈 ───────────────────────────────────
  const totalMax = cfg.totalEpisodes + cfg.totalEpisodesVar;
  const ratio = episodeNumber / totalMax;
  const isLastEp = episodeNumber >= totalMax;
  const arcPhase = isLastEp
    ? `[최종화 — 완결 필수] 이번 화는 이야기의 마지막 화다. 갈등은 이미 절정에 달했으므로, 이번 화는 해소와 마무리로만 채운다. 반드시 아래 3단계 순서로 본문을 구성한다: (1) 중심 갈등이 해결되는 장면 — 적대자의 패배 또는 화해, (2) 주요 복선 회수 — 전에 심어둔 의문이 답을 얻는 장면, (3) 에필로그 — "그 후로", "마침내", "드디어", "이제부터" 같은 시간 도약 어휘로 인물들의 새로운 일상이나 미래를 간결하게 보여준다. 본문의 마지막 문장은 "끝맺음을 의미하는 서술"로 끝낸다. 새 갈등 도입, 열린 결말, 다음 화 암시 절대 금지.`
    : ratio < 0.25
    ? episodeNumber === 1
      ? `[기 — 1화] 도입부. 세계관·인물을 자연스럽게 소개하고 사건의 씨앗을 심는다. 주인공이 처음 이 상황에 처한 첫 순간부터 시작해라. 낯선 환경·예기치 않은 만남·불안한 예감을 담아라.`
      : `[기] 도입부 연속. 직전 줄거리에서 이야기가 자연스럽게 이어져야 한다. 직전 화에서 일어난 사건·감정·인물 위치에서 출발한다. 이전 화와 동일하거나 유사한 장면·상황·문장으로 시작하는 것은 절대 금지다. 새 사건이나 관계의 전개를 중심으로 전개한다.`
    : ratio < 0.55
    ? `[승] 전개부. 갈등을 심화시키고 인물 간 긴장을 높인다. 추적·의심·숨바꼭질 장면을 써라. 복선을 새로 심고, 인물이 진실을 피하거나 감추는 장면을 포함한다. "의심", "두려움", "추적", "조사", "숨기", "갈등" 같은 전개 어휘를 자연스럽게 사용한다.`
    : ratio < 0.73
    ? `[전] 절정부. 갈등이 최고조에 달하고 반전이 일어난다. 숨겨진 비밀이 폭로되거나 인물이 직접 맞서는 장면, 예상치 못한 충격적 사실이 드러나는 장면을 써라. "발각", "반전", "충격", "비밀", "드러났", "맞서", "절정" 같은 절정 어휘를 자연스럽게 사용한다.`
    : `[결] 결말부. 갈등 해소를 향해 달려간다. 반드시 이번 화에서 직접적인 화해·용서·결단·승리·귀환 중 하나 이상의 장면을 써라. 복선이 하나씩 답을 얻는다. "마침내", "드디어", "해결", "인정", "비로소", "함께", "자유", "승리", "물리쳤", "극복했", "귀환" 같은 결말 어휘를 자연스럽게 사용한다. 새로운 갈등을 도입하지 않는다.`;

  // ── 분량 ─────────────────────────────────────────────
  const minLen = cfg.episodeLength;
  const maxLen = cfg.episodeLength + cfg.episodeLengthVar;

  // ── 독자 프로필 기반 문체 ─────────────────────────────
  const p = readerProfile;
  const profileStyle = [
    p.focus    < 40 ? "짧고 명확한 문장" : p.focus    > 70 ? "묘사 풍부" : "",
    p.urgency  > 70 ? "빠른 전개"         : p.urgency  < 30 ? "서정적 호흡" : "",
    p.dialogue > 70 ? "대화 위주"         : p.dialogue < 30 ? "서술 위주"  : "",
  ].filter(Boolean).join(", ");
  const styleStr = [cfg.style !== "균형" ? cfg.style : "", profileStyle].filter(Boolean).join(", ") || "균형";

  // ── 슬라이더 연출 지시 ───────────────────────────────
  const sliderDirectives = [
    cfg.conflict   >= 8 ? "갈등이 격렬하고 날카롭게 전개"   : cfg.conflict   <= 3 ? "잔잔하고 온화한 갈등 흐름" : "",
    cfg.foreshadow >= 8 ? "복선을 촘촘하게 심어라"           : cfg.foreshadow <= 3 ? "복선 최소화, 직선적 전개" : "",
    cfg.emotion    >= 8 ? "감정 묘사를 깊고 세밀하게"        : cfg.emotion    <= 3 ? "감정 묘사 간결하게" : "",
    cfg.dialogue   >= 8 ? "대사 비중을 높여라"               : cfg.dialogue   <= 3 ? "서술 위주로 전개" : "",
    cfg.direction  >= 8 ? "연출 효과를 강하게"               : cfg.direction  <= 3 ? "연출 최소화, 담백하게" : "",
  ].filter(Boolean).join(". ");

  // ── 세계관 ────────────────────────────────────────────
  const rules     = worldBible.world_rules.length        ? worldBible.world_rules.join(" | ")       : "없음";
  const forbidden = worldBible.forbidden_settings.length ? worldBible.forbidden_settings.join(", ") : "없음";
  const charEntries = Object.entries(worldBible.character_defaults);
  const characters  = charEntries.map(([name, desc]) => `${name}: ${desc}`).join("\n") || "없음";
  const charNames   = charEntries.map(([name]) => name).join(", ");

  // 주인공 명시적 선언 — 유형 칩 또는 성격/특성 자유 입력 어느 쪽에 "주인공" 을 써도 탐지
  const protagonistEntry = charEntries.find(([, desc]) =>
    desc.includes("유형: 주인공") || desc.includes("유형:주인공") ||
    /[\]\s,]주인공/.test(desc) // "] 주인공", ", 주인공", " 주인공" 등 자유 입력 케이스
  );
  const protagonistDecl = protagonistEntry
    ? `[★ 주인공: ${protagonistEntry[0]}] 이 이야기의 핵심 주인공은 반드시 ${protagonistEntry[0]}이다. 모든 화에서 ${protagonistEntry[0]}의 시선·감정·행동이 서사를 이끌어야 한다. 다른 인물이 주인공 역할을 대체하는 것은 절대 금지다. ${protagonistEntry[0]} 이외의 인물을 주인공처럼 묘사하거나 그 시점으로 이야기를 전개하는 것은 오류다.`
    : "";

  const pronounRules = charEntries
    .map(([name, desc]) => {
      if (desc.includes("성별: 여") || desc.includes("성별: 여성")) return `${name}→그녀/그녀의`;
      if (desc.includes("성별: 남") || desc.includes("성별: 남성")) return `${name}→그/그의`;
      return null;
    }).filter(Boolean).join(", ");

  // ── 시점 규칙 — Variant C (2026-04-22 진단 채택) ─────
  // src/lib/pov_rules.ts 공유 모듈 사용: benchmark와 service 정책 일치.
  // 1인칭 관찰자: 미지원 POV. 규칙은 포함하되, 생성 차단은 streamEpisode()에서 처리.
  const povRule = variantCPovRule(cfg.pov || "전지적 작가");

  // ── Director Overrides (L0 최상위) ───────────────────
  const directorBlock = directorOverrides.length
    ? `\n[★ 작가 직접 지시 — 세계관 규칙보다 우선 적용, 반드시 이번 화부터 즉시 반영 ★]\n${directorOverrides.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
    : "";

  // ── 아크 장기 기억 (10화 단위 압축) ──────────────────
  // 아크 요약 주입 — 인물 현재 상태 섹션을 맨 위로 올려 이름 망각 방지
  const arcBlock = arcSummaries.length
    ? `\n[장기 서사 기억 — 설정 충돌 금지, 인물 이름 반드시 그대로 사용]\n${arcSummaries.map(a => {
        // [인물 현재 상태] 섹션이 있으면 맨 앞으로 재정렬
        const stateMatch = a.summary.match(/\[인물 현재 상태\]([\s\S]*?)(?=\[|$)/);
        const stateBlock = stateMatch ? stateMatch[0].trim() : "";
        const rest = stateMatch ? a.summary.replace(stateMatch[0], "").trim() : a.summary;
        return `◆ ${a.episode_start}~${a.episode_end}화\n${stateBlock ? stateBlock + "\n" : ""}${rest}`;
      }).join("\n\n")}`
    : "";

  // ── 인물 현재 상태 (최신 아크 기준) ──────────────────
  const charArcEntries = Object.entries(characterArcs);
  const charStateBlock = charArcEntries.length
    ? `\n[인물 현재 상태 — 아래 상태에서 이어서 전개]\n${charArcEntries.map(([name, arc]) => `${name}: ${arc.state}`).join("\n")}`
    : "";

  // ── 복선 주입 ─────────────────────────────────────────
  const foreshadowBlock = foreshadowMemory.length
    ? `\n[미회수 복선 목록 — 전체 ${foreshadowMemory.length}개, 자연스럽게 회수할 것]\n${foreshadowMemory.map((f, i) => `${i + 1}. [${f.planted_episode}화 심음] ${f.content}`).join("\n")}`
    : "";

  // ── 인물 등장 최소 요건 ────────────────────────────────
  const charTarget = ratio < 0.3 ? 2 : ratio < 0.7 ? 3 : 4;
  const mainChars  = charEntries.slice(0, Math.min(charEntries.length, charTarget + 1)).map(([n]) => n).join(", ");

  return `당신은 한국 소설 생성 AI다.
[최우선 규칙] ${povRule}
출력은 100% 한국어만 허용한다. 중국어·일본어·영어 등 어떤 외국어도 절대 사용 금지.
본문은 반드시 ${minLen}~${maxLen}자 범위 안에서 완성한다. ${maxLen}자를 초과하면 즉시 현재 단락을 마무리하고 [CLIFF]를 써야 한다. 절대 ${maxLen}자를 넘겨서 계속 쓰지 말 것.
대화 따옴표는 반드시 " "을 사용한다. 직선 "(ASCII 0x22) 사용 시 채점 0점 처리. 모든 대화는 반드시 " 로 시작해 " 로 닫는다.
${!isFinale ? `[필수 출력 형식] 본문을 완성하면 반드시 단독 줄에 [CLIFF]를 출력한다. [CLIFF]를 쓰지 않고 멈추는 것은 오류다.` : ""}
이번 화에는 반드시 ${mainChars} 중 최소 ${charTarget}명이 직접 등장하거나 대화·행동으로 언급되어야 한다.
${protagonistDecl ? protagonistDecl + "\n" : ""}${directorBlock}
[서사 단계] ${arcPhase}

[등장인물 — 아래 인물만 사용, 임의 인물 생성 금지]
${characters}

[세계관 규칙]
${rules}

[금지 설정]
${forbidden}
${arcBlock}${charStateBlock}${rollingSummary ? `\n\n[직전 줄거리]\n${rollingSummary}` : ""}${prevEpisodeTail ? `\n\n[직전 화 마지막 장면 — 이 장면 직후부터 이어서 전개할 것]\n"""\n${prevEpisodeTail}\n"""\n위 장면의 분위기·인물 위치·감정 상태가 이번 화 첫 장면에 그대로 이어져야 한다. 위 마지막 장면과 동일하거나 유사한 오프닝 문장(같은 장소 묘사, 같은 상황 반복)으로 시작하는 것은 절대 금지다.` : ""}${foreshadowBlock}

문체: ${styleStr}
${sliderDirectives ? `연출: ${sliderDirectives}` : ""}
${pronounRules ? `대명사: ${pronounRules}` : ""}

[규칙]
- [시점] ${povRule}
- 화 제목은 반드시 "# ${episodeNumber}화 - 제목" 형식으로 첫 줄에.
- 등장인물은 반드시 ${charNames || "위 인물들"}을 중심으로 전개한다.
- 과거 아크에서 확립된 인물 성격·관계·사건과 모순되지 않는다.
- [정보 역설 금지] 인물이 아직 알 수 없는 정보를 미리 아는 것처럼 쓰지 않는다. 처음 만난 인물의 이름·직책·비밀은 서사 내에서 명시적으로 전달된 뒤에만 사용한다. 금지 예시: 소개 전 이름 언급, 아직 밝혀지지 않은 비밀을 인물이 이미 아는 것처럼 암시, 독자만 아는 정보를 인물이 직감으로 정확히 맞히는 것.
- [인물 소개 절차] 처음 등장하는 인물은 반드시 자기소개·타인의 소개·이름표 등 서사 내 근거가 생긴 뒤에만 이름으로 호칭한다. 소개 전에는 반드시 "낯선 이", "그/그녀", "문을 두드린 사람" 등 묘사로만 지칭한다. 이름 소개 장면을 생략하고 갑자기 이름을 사용하는 것은 오류다.
- [감정 진정성 — 담담함·태연함 금지] 위기·충격·위협·낯선 환경에 놓인 인물이 "담담하게", "태연하게", "평이하게" 반응하는 것은 몰입을 해치는 심각한 오류다. 반드시 구체적 신체 반응(심장이 쿵 내려앉음, 손이 떨림, 식은땀, 숨이 멎는 느낌)과 내면 동요(당혹, 공포, 혼란, 분노)를 직접 묘사해야 한다. 가족을 잃은 인물, 생명 위협, 배신 앞에서 차분한 묘사는 절대 금지다.
- [관계 기반 준수] 처음 만난 인물끼리는 낯선 사이처럼 행동한다. 아직 신뢰·우정·적대가 쌓이지 않은 관계를 이미 형성된 것처럼 묘사하지 않는다.
- [인과 논리] 사건은 반드시 원인이 있어야 한다. "갑자기 해결됐다", "어느새 사라졌다", "이유 없이 성공했다" 같은 근거 없는 해결 전개 절대 금지. 위기는 인물의 구체적 행동·판단·희생을 통해서만 풀린다.
- [연속성 준수] 직전 줄거리와 인물의 위치·상태·관계가 모순되지 않아야 한다. 이전 화에서 확립된 사실과 충돌하면 안 된다.
- [인물 이름 정확성] 등장인물의 이름을 절대 변형·합성·오기하지 않는다. 위 [등장인물] 목록에 있는 이름 그대로만 사용한다. 두 인물 이름을 합치거나 혼동하는 것은 심각한 오류다.
- [장소 이동 명시] 화 내에서 장면이 다른 장소로 바뀔 때는 반드시 이동 과정·시간 경과·장소 묘사를 한 문장 이상 서술한다. 설명 없이 다른 장소에 인물이 갑자기 등장하는 것은 몰입을 해치는 오류다.
- 핵심 감정 단어 한두 개만 **굵게** 처리. 감정 단어를 단독 문장으로 쓰지 말 것.
- 목록·인용·코드블록 금지.
- 인물 성격과 말투를 일관되게 유지.
- 문장 반복 절대 금지.
- 반드시 완결된 문장으로 끝낼 것. 마지막 문장이 불완전하면 삭제하고 그 앞 문장으로 종료.
- 본문만 출력. 설명·주석·JSON·메타 정보 절대 금지.
- 대화 따옴표를 열었으면 반드시 같은 단락 안에서 닫을 것. 따옴표를 단락 경계에서 열린 채로 끊지 말 것.
- 글자 수 제한에 도달해도 어줍잖게 끊지 말고 현재 단락을 완전히 마무리하고 끝낼 것.

${isFinale
  ? `- 본문을 모두 썼으면 반드시 마지막 줄에 [END]를 단독으로 출력하고 멈춰라.`
  : `- 본문(${minLen}자 이상)을 완성한 뒤, 반드시 단독 줄에 [CLIFF]를 쓰고 멈춰라.
- [CLIFF] 다음 줄부터 클리프행어 단락을 써라: 독자가 다음 화를 참을 수 없게 만드는 반전·위기·발견 장면. 2~4문장, 완결된 문장으로 끝낼 것.
- 클리프행어까지 모두 썼으면 반드시 마지막 줄에 [END]를 단독으로 출력하고 멈춰라.`
}`;
}

// ── POV 교정: 3인칭 설정에서 1인칭 표현을 주인공 이름/대명사로 치환 ──
function buildPovCorrector(worldBible: WorldBible, pov: string): ((s: string) => string) | null {
  if (pov.includes("1인칭")) return null; // 1인칭 설정에서는 교정 불필요

  // 주인공(역할: 주인공) 찾기
  const protagonist = Object.entries(worldBible.character_defaults).find(
    ([, desc]) => desc.includes("역할: 주인공") || desc.includes("역할:주인공")
  );
  if (!protagonist) return null;

  const [name, desc] = protagonist;
  const isFemale = desc.includes("성별: 여") || desc.includes("성별: 여성");
  const isMale   = desc.includes("성별: 남") || desc.includes("성별: 남성");
  const she      = isFemale ? "그녀" : isMale ? "그" : name;

  // 공백/구두점 뒤에 오는 독립 인칭 대명사만 교정
  // NFC 정규화 후 처리 — NFD 인코딩 시 lookbehind가 실패하는 문제 방지
  // (^|공백/구두점)나는 — "레나는"처럼 붙어있는 경우는 그룹1이 없어서 불일치
  // \u201C\u201D = 한국어 곡선 큰따옴표 " "  /  \u2018\u2019 = 곡선 작은따옴표 ' '
  const WB = `(^|[\\s"'\u201C\u201D\u2018\u2019\uFF02「」『』,，。.!?\\n])`;
  return (text: string): string => {
    const t = text.normalize('NFC');
    return t
      .replace(new RegExp(`${WB}나는`, 'g'),   `$1${name}은`)
      .replace(new RegExp(`${WB}나의`, 'g'),   `$1${she}의`)
      .replace(new RegExp(`${WB}내가`, 'g'),   `$1${she}가`)
      .replace(new RegExp(`${WB}나에게`, 'g'), `$1${she}에게`)
      .replace(new RegExp(`${WB}나를`, 'g'),   `$1${she}를`)
      .replace(new RegExp(`${WB}나도`, 'g'),   `$1${she}도`)
      .replace(new RegExp(`${WB}나와`, 'g'),   `$1${she}와`);
  };
}

export async function streamEpisode(ctx: StoryContext, res: Response): Promise<string> {
  const cfg          = { ...DEFAULT_CONFIG, ...(ctx.worldBible.story_config ?? {}) };
  const epNum        = ctx.episodeNumber;

  // ── POV 지원 여부 확인 (자동 변환 금지) ─────────────────
  // 현재 모델(gemma3:12b) 기준 미지원 POV는 생성 없이 오류 이벤트를 전송한다.
  // 사용자가 요청한 POV를 다른 POV로 몰래 바꾸지 않는다.
  const povCheck = checkPovForService(cfg.pov);
  if (!povCheck.supported && povCheck.strategy === "disabled_for_current_model") {
    logWarn("story:generate", `미지원 POV 요청 — 생성 차단`, {
      pov: cfg.pov,
      strategy: povCheck.strategy,
      reason: povCheck.reason?.slice(0, 100),
    });
    res.write(`data: ${JSON.stringify({
      error: "unsupported_pov",
      pov: cfg.pov,
      message: `현재 모델(${cfg.pov} 시점)은 지원되지 않습니다. 지원 POV: 1인칭 주인공, 3인칭 관찰자, 전지적 작가, 교차 시점.`,
      strategy: povCheck.strategy,
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return "";
  }

  const isFinale     = epNum >= cfg.totalEpisodes + cfg.totalEpisodesVar;
  const systemPrompt = buildSystemPrompt(ctx, isFinale);
  const hasOverrides = ctx.directorOverrides.length > 0;
  const overrideSuffix = hasOverrides
    ? ` [필수 반영: ${ctx.directorOverrides.map((o, i) => `(${i + 1}) ${o}`).join(" ")}]`
    : "";
  const userMessage  = ctx.userPrompt
    ?? (isFinale
      ? `${epNum}화(최종화)를 ${cfg.pov} 시점으로 생성해줘. 반드시 모든 갈등을 해소하고 완전한 결말로 끝낼 것. 마지막 문장은 이야기가 완전히 끝났음을 보여주는 문장이어야 한다.${overrideSuffix}`
      : `${epNum}화를 ${cfg.pov} 시점으로 생성해줘.${overrideSuffix}`);
  const targetMaxLen = cfg.episodeLength + cfg.episodeLengthVar;
  // 한국어 1자 ≈ 0.65 token.
  // 최종화: 완결 여유 2.2배. 일반화: 본문 1.25배 + 클리프행어 예산 250 토큰 추가
  const tokenBuf  = isFinale ? 2.2 : 1.25;
  const maxTokens = Math.ceil(targetMaxLen * 0.65 * tokenBuf) + (isFinale ? 0 : 250);
  const ep           = ctx.episodeNumber;

  // POV 교정 함수 (3인칭 설정일 때만 활성)
  const correctPOV = buildPovCorrector(ctx.worldBible, cfg.pov);

  logInfo("story:generate", `${ep}화 생성 시작`, {
    episode: ep,
    model: getStoryModel(),
    max_tokens: maxTokens,
    length_range: `${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자`,
    pov: cfg.pov,
    style: cfg.style,
    sliders: { conflict: cfg.conflict, foreshadow: cfg.foreshadow, emotion: cfg.emotion, dialogue: cfg.dialogue, direction: cfg.direction },
    characters: Object.keys(ctx.worldBible.character_defaults),
    world_rules_count: ctx.worldBible.world_rules.length,
    forbidden_count: ctx.worldBible.forbidden_settings.length,
    director_overrides_count: ctx.directorOverrides.length,
    open_foreshadows_count: ctx.foreshadowMemory.length,
    arc_summaries_count: ctx.arcSummaries.length,
    char_arcs_count: Object.keys(ctx.characterArcs).length,
    has_rolling_summary: !!ctx.rollingSummary,
    system_prompt_chars: systemPrompt.length,
  });

  const stream = await getLLMClient().chat.completions.create({
    model: getStoryModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage },
    ],
    stream: true,
    temperature: 0.85,
    max_tokens: maxTokens,
    stop: ["[END]", "---\n", "\n\n\n\n"],
  } as any) as unknown as AsyncIterable<{ choices: { delta: { content?: string } }[] }>;

  const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };

  // [CLIFF] 구분자 이후 토큰은 클리프행어 영역 — 클라이언트엔 \n\n 이후로 이어붙여 전송
  // outputText: 클라이언트에 실제 전송된 전체 텍스트 (body + cliff 포함)
  let fullText    = "";   // 모델 원문 누적 (필터 전)
  let outputText  = "";   // 클라이언트 전송 누적
  let sentBuf     = "";   // POV 교정용 문장 버퍼
  let garbageTail = "";
  let garbageMode    = false;
  let cliffMode      = false;  // [CLIFF] 구분자 이후 클리프행어 영역
  let cliffStarted   = false;  // [CLIFF] 이후 첫 실제 텍스트 전송 여부
  let cliffBuf       = "";     // [CLIFF] 토큰 조각 감지용 rolling buffer
  let tokenCount  = 0;
  let filteredGarbageCount  = 0;
  let filteredForeignCount  = 0;
  let povCorrectedCount     = 0;
  let firstTokenAt: number | null = null;
  const startedAt = Date.now();
  const SENT_BOUNDARY = /[.!?。\n]/;
  const STOP_PATTERNS = ["```json", '{"new_characters"', "\n1. ", "\n2. ", "추가로 원하시는", "이런 식으로",
    "\n..\n", "\n..?\n", "\n..!\n", "\n..?!\n", "\n..?!!\n", "......"];

  const flushSentBuf = () => {
    if (!sentBuf) return;
    if (sentBuf.length > 2 && !/[가-힣]/.test(sentBuf)) { sentBuf = ""; return; }
    // 한국어 문장 중간에 삽입된 영어 단어 제거 (공백으로 치환)
    // 예: "좁은 alleys에서" → "좁은 에서", "몸은 aches했지만" → "몸은 했지만"
    let out = sentBuf.replace(/(?<=[가-힣\s])\s+[A-Za-z]+(?=[가-힣\s,.])/g, " ")
                     .replace(/[A-Za-z]{4,}(?=[가-힣])/g, "")  // 4자 이상 영어 단어가 한글 앞에 오는 경우
                     .replace(/(?<=[가-힣])[A-Za-z]{4,}/g, ""); // 한글 뒤에 4자 이상 영어 단어
    if (correctPOV) {
      const fixed = correctPOV(out);
      if (fixed !== out) {
        povCorrectedCount++;
        logWarn("story:pov", `${ep}화 POV 교정`, { episode: ep, original: out.slice(0, 60), fixed: fixed.slice(0, 60) });
      }
      out = fixed;
    }
    // [CLIFF] 마커가 sentBuf에 포함된 경우 전송 전에 제거
    // 닫는 ]가 다른 토큰에 있을 수 있으므로 [CLIFF 만으로도 감지
    const cliffInBuf = out.search(/\[CLIFF/);
    if (!cliffMode && !isFinale && cliffInBuf !== -1) {
      out = out.slice(0, cliffInBuf);
      cliffMode = true;
      cliffBuf = "";
    }
    fullText = fullText.slice(0, fullText.length - sentBuf.length) + out;
    if (!out) { sentBuf = ""; return; }
    outputText += out;
    res.write(`data: ${JSON.stringify({ token: out })}\n\n`); flush();
    sentBuf = "";
  };

  const sendToken = (t: string) => {
    outputText += t;
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ token: t })}\n\n`); flush();
  };

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? "";
    if (!token) continue;

    tokenCount++;
    if (!firstTokenAt) {
      firstTokenAt = Date.now();
      logInfo("story:stream", `${ep}화 첫 토큰 수신`, { episode: ep, ttft_ms: firstTokenAt - startedAt });
    }

    fullText += token;

    // ── [CLIFF] 구분자 감지 ─────────────────────────────
    // [CLIFF] 또는 [CLIFF\n 형태 모두 감지 (모델이 ] 없이 줄바꿈하는 경우 대응)
    const cliffIdx = fullText.search(/\[CLIFF[\]\n]/);
    if (!cliffMode && !isFinale && cliffIdx !== -1) {
      flushSentBuf();
      garbageMode = false;
      cliffMode = true;
      cliffBuf = "";
      logInfo("story:cliffhanger", `${ep}화 [CLIFF] 감지 — 클리프행어 구간 시작`, { episode: ep, body_chars: outputText.length });
      // 구분자 이후 텍스트 추출 ([CLIFF] = 7자, [CLIFF\n = 7자)
      const markerEnd = cliffIdx + (fullText[cliffIdx + 6] === "]" ? 7 : 7);
      const afterCliff = fullText.slice(markerEnd).trim();
      if (afterCliff && /[가-힣]/.test(afterCliff)) {
        sendToken("\n\n");
        sendToken(afterCliff);
        cliffStarted = true;
      }
      continue;
    }

    // ── 클리프행어 구간 처리 ────────────────────────────
    if (cliffMode) {
      if (!cliffStarted && /[가-힣]/.test(token)) {
        sendToken("\n\n");
        cliffStarted = true;
      }
      if (cliffStarted) {
        if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(token)) { garbageMode = true; continue; }
        // 클리프행어 구간 최대 500자 제한 — 초과 시 문장 경계에서 차단 (해당 토큰은 포함)
        const cliffLen = outputText.length - (outputText.lastIndexOf("\n\n") + 2);
        if (cliffLen > 500 && /[.!?"\u201D]/.test(token)) { sendToken(token); garbageMode = true; continue; }
        if (!garbageMode) sendToken(token);
      }
      continue;
    }

    if (garbageMode) { filteredGarbageCount++; continue; }

    // ── 길이 초과 가드 — 본문이 너무 길면 자연스럽게 마무리 유도 ──
    const lenCap = isFinale ? targetMaxLen * 2.0 : targetMaxLen * 1.8;
    // CLIFF 강제 삽입: maxLen * 1.1 초과했고 아직 cliffMode 미진입이면 강제로 클리프행어 구간 시작
    if (!cliffMode && !isFinale && fullText.length > targetMaxLen * 1.1) {
      flushSentBuf();
      cliffMode = true;
      cliffBuf = "";
      sendToken("\n\n");
      logWarn("story:filter", `${ep}화 분량 초과 — CLIFF 강제 삽입`, { episode: ep, at_char: fullText.length });
      continue;
    }
    if (fullText.length > lenCap) {
      flushSentBuf();
      garbageMode = true;
      filteredGarbageCount++;
      logWarn("story:filter", `${ep}화 길이 한계 초과 — 강제 차단`, { episode: ep, at_char: fullText.length });
      continue;
    }

    // STOP 패턴 감지
    const hit = STOP_PATTERNS.find(p => fullText.includes(p));
    if (hit) {
      flushSentBuf(); garbageMode = true; filteredGarbageCount++;
      logWarn("story:filter", `${ep}화 STOP 패턴 감지`, { episode: ep, pattern: hit, at_char: fullText.indexOf(hit) });
      continue;
    }

    // 외국어 감지
    if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(token)) {
      flushSentBuf(); garbageMode = true; filteredForeignCount++;
      logWarn("story:filter", `${ep}화 외국어 토큰 감지`, { episode: ep, token_sample: token.slice(0, 10) });
      continue;
    }

    // 쓰레기 누적 감지 — 공백·줄바꿈·일반 구두점·따옴표는 정상 텍스트로 간주
    const SAFE_CHARS = /[가-힣\w\s\n\r\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F.,!?;:()\-…]/;
    if (SAFE_CHARS.test(token)) { garbageTail = ""; }
    else {
      garbageTail += token;
      if (garbageTail.length > 3) {
        sentBuf = ""; garbageMode = true; filteredGarbageCount++;
        logWarn("story:filter", `${ep}화 쓰레기 누적 초과`, { episode: ep, garbage_tail: garbageTail.slice(0, 30) });
        continue;
      }
    }

    // 문장 버퍼링 — [CLIFF] 감지 및 POV 교정을 위해 항상 sentBuf 경유
    sentBuf += token;
    if (SENT_BOUNDARY.test(token) || sentBuf.length > 80) flushSentBuf();
  }

  // 남은 버퍼 플러시
  flushSentBuf();

  // 스트림 종료 후 불완전한 문장 결말 트리밍 (모델이 token limit으로 중단된 경우)
  const cleanEnding = /[.!?"\u201D\u300D\u300F\n]$/;
  if (!cleanEnding.test(outputText.trimEnd())) {
    const lastBoundary = outputText.search(/[.!?"\u201D\u300D\u300F\n][^.!?"\u201D\u300D\u300F\n]*$/);
    if (lastBoundary !== -1) {
      const trimmed = outputText.slice(0, lastBoundary + 1);
      logWarn("story:stream", `${ep}화 불완전 결말 트리밍`, { episode: ep, before: outputText.length, after: trimmed.length });
      outputText = trimmed;
    }
  }

  // [CLIFF]가 없었던 경우 로그 (모델이 구분자를 누락한 경우)
  if (!isFinale && !cliffMode) {
    logWarn("story:cliffhanger", `${ep}화 [CLIFF] 구분자 없음 — 클리프행어 미생성`, { episode: ep, body_chars: outputText.length });
  }

  res.write("data: [DONE]\n\n");
  res.end();

  const elapsed = Date.now() - startedAt;
  logInfo("story:generate", `${ep}화 스트리밍 완료`, {
    episode: ep,
    elapsed_ms: elapsed,
    total_chars: fullText.length,
    token_count: tokenCount,
    chars_per_sec: Math.round(fullText.length / (elapsed / 1000)),
    filtered_garbage: filteredGarbageCount,
    filtered_foreign: filteredForeignCount,
    pov_corrected: povCorrectedCount,
    garbage_mode_triggered: garbageMode,
  });

  return fullText;
}
