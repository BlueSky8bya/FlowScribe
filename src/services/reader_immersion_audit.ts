/**
 * reader_immersion_audit.ts — Reader Immersion Integrity 감사 서비스
 *
 * 설계 원칙:
 * - 장르별 if문 금지 — 상태(state), 관계(relationship), 지식(knowledge), 맥락(context) 기반 범용 판단
 * - LLM에게 추가 금지 규칙 밀어 넣지 않음 — deterministic guard + Gemini judge 분리
 * - DB/trace에서 추론 가능한 lightweight contract로 동작
 */

import { pool } from "../lib/db.js";
import type { CharacterDynamicState } from "../types/canonical.js";

// ══════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════

export type ImmersionIssueSeverity = "fatal" | "major" | "minor";

export type ImmersionIssueCategory =
  | "alive_contradiction"      // 사망/무력화 인물이 행동
  | "inventory_contradiction"  // 소지품 불일치
  | "location_jump"            // 장소 이동 설명 없는 점프
  | "time_contradiction"       // 시간대 붕괴
  | "knowledge_leak"           // 인물이 알 수 없는 정보 사용
  | "relationship_jump"        // 관계 변화 bridge 없는 급변
  | "capability_violation"     // 설정상 불가능한 능력/행동
  | "emotional_implausibility" // 감정 반응 개연성 부족
  | "speech_register_flip"     // 호칭/말투 급변
  | "artifact_noise"           // 특수 토큰, 외국어, 톤 오염
  | "repetition_loop"          // 감정/행동 루프 (변화 없이 반복)
  | "body_action_impossibility"; // 신체 상태와 행동 불일치

export type ImmersionFixCategory =
  | "state"       // dynamic state 갱신
  | "prompt"      // 렌더러 프롬프트 개선
  | "postprocess" // 생성 후 후처리
  | "memory"      // 메모리/롤링 요약 보강
  | "ledger";     // item/location ledger 수정

export interface ImmersionIssue {
  severity: ImmersionIssueSeverity;
  category: ImmersionIssueCategory;
  episode: number;
  character?: string;
  evidence: string;
  explanation: string;
  suggested_fix_type: ImmersionFixCategory;
}

export interface ImmersionAuditResult {
  book_id: string;
  episodes_audited: number;
  issues: ImmersionIssue[];
  fatal_count: number;
  major_count: number;
  minor_count: number;
  immersion_score: number;
  verdict: "PASS" | "CONDITIONAL" | "WARN" | "FAIL";
  category_summary: Record<ImmersionIssueCategory, number>;
  thirty_ep_allowed: boolean;
}

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

// 사망/무력화 상태 키워드
const FATAL_STATUS_KW = ["사망", "죽음", "죽었", "사체", "시신", "사망했", "숨졌", "숨을 거뒀", "절명"];
const INCAP_STATUS_KW = ["기절", "의식 불명", "의식불명", "쓰러졌", "혼수", "마비", "포박됨", "결박됨", "투옥"];

// LLM artifact 패턴
const ARTIFACT_PATTERNS: RegExp[] = [
  /<\/?s>/gi,
  /\[unused\d*\]/gi,
  /<<[A-Z_]+>>/g,
  /[぀-ゟ゠-ヿ]{3,}/g,  // 일본어 연속
  /[一-鿿]{4,}/g,               // 중국어 연속 4자 이상
  /[฀-๿]{3,}/g,               // 태국어
  /[؀-ۿ]{3,}/g,               // 아랍어
  /#{2,}\s*[가-힣A-Za-z]/,              // 해시태그 다중
  /\bSYSTEM\b|\bPROMPT\b|\bINSTRUCT\b/,
];

// 반복 감정 동의어 그룹
const EMOTION_SYNONYM_GROUPS: string[][] = [
  ["혼란", "혼돈"],
  ["불안", "두려", "공포", "무서"],
  ["슬픔", "슬퍼", "비통"],
  ["분노", "화가", "격분", "분개"],
  ["절망", "희망이 없"],
];

function emotionGroup(e: string): string {
  for (const group of EMOTION_SYNONYM_GROUPS) {
    if (group.some(k => e.includes(k))) return group[0];
  }
  return e;
}

// ══════════════════════════════════════════════════════════════
// Core Checkers
// ══════════════════════════════════════════════════════════════

/**
 * A. Alive / Incapacitated consistency
 * 사망/무력화 상태 인물이 이후 화에서 설명 없이 행동하는지 검사
 */
export function checkAliveContradictions(
  states: CharacterDynamicState[],
  episodeTexts: Map<number, string>,
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];

  // 인물별 마지막 fatal/incap 상태 추적
  const fatalEpisode: Record<string, number> = {};
  const incapEpisode: Record<string, number> = {};

  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    const ps = (s.physical_state ?? "").toLowerCase();
    const charName = s.character_name;

    if (FATAL_STATUS_KW.some(k => ps.includes(k))) {
      fatalEpisode[charName] = s.episode_number;
    } else if (INCAP_STATUS_KW.some(k => ps.includes(k))) {
      incapEpisode[charName] = s.episode_number;
    } else {
      // 회복 언급 확인: physical_state가 정상이면 incap 해제
      if (incapEpisode[charName] && incapEpisode[charName] < s.episode_number) {
        delete incapEpisode[charName];
      }
    }

    // 사망 후 등장 체크 (다음 화부터)
    for (const [name, deathEp] of Object.entries(fatalEpisode)) {
      if (s.episode_number <= deathEp) continue;
      if (s.character_name !== name) continue;
      // dynamic state에서 해당 인물이 active location을 갖고 있으면 모순
      if (s.location && s.location !== "" && s.location !== "불명") {
        issues.push({
          severity: "fatal",
          category: "alive_contradiction",
          episode: s.episode_number,
          character: name,
          evidence: `사망 판정(ep${deathEp}) 후 ep${s.episode_number}에서 location="${s.location}" 활성`,
          explanation: "사망/리타이어 인물이 회복/부활 설명 없이 재등장함",
          suggested_fix_type: "state",
        });
      }
    }
  }

  // episode text에서 사망 인물 대사 참여 감지
  for (const [name, deathEp] of Object.entries(fatalEpisode)) {
    for (const [epNum, text] of episodeTexts.entries()) {
      if (epNum <= deathEp) continue;
      // 대사 패턴: "강이준이 말했다" / "강이준: " / '"...' 앞에 이름
      const speechRe = new RegExp(`${escapeRe(name)}[은는이가]?\\s*(?:말했|중얼|외쳤|속삭|소리쳤|답했|물었)`, "g");
      if (speechRe.test(text)) {
        issues.push({
          severity: "fatal",
          category: "alive_contradiction",
          episode: epNum,
          character: name,
          evidence: `사망 인물 "${name}"의 발화 동사 패턴 감지 (ep${epNum})`,
          explanation: "사망/리타이어 인물이 설명 없이 대화에 참여함",
          suggested_fix_type: "state",
        });
      }
    }
  }

  return issues;
}

/**
 * B. Inventory Consistency
 * 이전 화에서 없던 아이템 돌연 사용, 분실/파손 아이템 재등장
 */
export function checkInventoryContradictions(
  states: CharacterDynamicState[],
  _canonItems: Record<string, string[]>,
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];
  const LOST_KW = ["분실", "없어졌", "사라졌", "잃어버", "파손", "고장", "망가졌", "소진", "비어있", "빈손"];

  type ItemEntry = { name: string; condition: string };
  const itemHistory: Record<string, { ep: number; items: ItemEntry[] }[]> = {};
  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    const name = s.character_name;
    const items: ItemEntry[] = Array.isArray(s.items)
      ? s.items.map(i => typeof i === "string"
          ? { name: i, condition: "" }
          : { name: (i as any).name ?? "", condition: (i as any).condition ?? "" })
        .filter(i => i.name)
      : [];
    if (!itemHistory[name]) itemHistory[name] = [];
    itemHistory[name].push({ ep: s.episode_number, items });
  }

  for (const [charName, history] of Object.entries(itemHistory)) {
    const lostItems = new Set<string>();
    for (let i = 0; i < history.length; i++) {
      const curr = history[i];
      for (const it of curr.items) {
        const cond = (it.condition ?? "").toLowerCase();
        if (LOST_KW.some(k => cond.includes(k) || it.name.includes(k))) {
          lostItems.add(it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, ""));
        }
      }
      if (i > 0 && lostItems.size > 0) {
        for (const it of curr.items) {
          const baseName = it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, "");
          const cond = (it.condition ?? "").toLowerCase();
          const isLostNow = LOST_KW.some(k => cond.includes(k) || it.name.includes(k));
          if (lostItems.has(baseName) && !isLostNow) {
            issues.push({
              severity: "major",
              category: "inventory_contradiction",
              episode: curr.ep,
              character: charName,
              evidence: `"${baseName}" 이전 화 분실/파손 → ep${curr.ep} 정상 복구 (근거 필요)`,
              explanation: "분실/파손 아이템이 수리/복구 설명 없이 재등장",
              suggested_fix_type: "ledger",
            });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * C. Location Jump
 * 직전 화 위치와 현재 화 위치가 구역이 다르고, 전환 문장 없을 때 경고
 */
const ABSENT_LOC_MARKERS = new Set(["미등장", "알 수 없음", "불명", "비활성", ""]);

export function checkLocationJumps(
  states: CharacterDynamicState[],
  episodeTexts: Map<number, string>,
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];

  const locHistory: Record<string, { ep: number; loc: string }[]> = {};
  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    if (!s.location) continue;
    const name = s.character_name;
    if (!locHistory[name]) locHistory[name] = [];
    locHistory[name].push({ ep: s.episode_number, loc: s.location });
  }

  const TRANSITION_RE = [
    /(?:이동|향했다|갔다|도착했다|들어갔다|찾아갔다|걸어갔다|나아갔다|넘어갔다)/,
    /(?:잠시\s*후|한참\s*후|시간이\s*(?:흘러|지나)|얼마\s*후|다음\s*날)/,
    /(?:문을|복도를|계단을|통로를)\s*(?:열고|지나|내려|올라|따라)/,
  ];

  for (const [charName, history] of Object.entries(locHistory)) {
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (ABSENT_LOC_MARKERS.has(prev.loc) || ABSENT_LOC_MARKERS.has(curr.loc)) continue;
      if (prev.loc === curr.loc) continue;
      if (isSameZone(prev.loc, curr.loc)) continue;

      // 현재 화 text에 전환 문장이 있는지 확인
      const text = episodeTexts.get(curr.ep) ?? "";
      const hasTransition = TRANSITION_RE.some(re => re.test(text));
      if (!hasTransition) {
        issues.push({
          severity: "major",
          category: "location_jump",
          episode: curr.ep,
          character: charName,
          evidence: `ep${prev.ep} "${prev.loc}" → ep${curr.ep} "${curr.loc}" (전환 문장 미탐지)`,
          explanation: "장소 이동 설명 없이 다른 구역으로 위치 점프",
          suggested_fix_type: "prompt",
        });
      }
    }
  }

  return issues;
}

/**
 * D. Emotional Repetition Loop
 * 같은 감정이 3화 이상 연속하고 목표/행동도 변화 없는 경우
 */
export function checkEmotionalLoops(
  states: CharacterDynamicState[],
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];

  const byChar: Record<string, CharacterDynamicState[]> = {};
  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }

  const UNKNOWN_EMO = new Set(["(없음)", "알 수 없음", "미등장"]);

  for (const [charName, history] of Object.entries(byChar)) {
    let streak = 1;
    for (let i = 1; i < history.length; i++) {
      const prevEmo = emotionGroup(history[i - 1].emotional_state ?? "");
      const currEmo = emotionGroup(history[i].emotional_state ?? "");
      if (UNKNOWN_EMO.has(prevEmo) || UNKNOWN_EMO.has(currEmo)) { streak = 1; continue; }
      const prevGoal = (history[i - 1].recent_goal ?? "").trim();
      const currGoal = (history[i].recent_goal ?? "").trim();
      const goalSame = prevGoal === currGoal || currGoal === "이전 목표 유지";

      if (prevEmo === currEmo && goalSame) {
        streak++;
        if (streak >= 3) {
          issues.push({
            severity: streak >= 4 ? "major" : "minor",
            category: "repetition_loop",
            episode: history[i].episode_number,
            character: charName,
            evidence: `ep${history[i - streak + 1].episode_number}~ep${history[i].episode_number}: 감정 "${currEmo}" ${streak}화 연속, 목표도 동일`,
            explanation: "감정과 목표가 변화 없이 반복됨 — 행동/관계 변화로 이어져야 함",
            suggested_fix_type: "prompt",
          });
          // streak 유지: 다음 화도 같으면 4화째 major로 업그레이드됨
        }
      } else {
        streak = 1;
      }
    }
  }

  return issues;
}

/**
 * E. LLM Artifact Noise
 * 특수 토큰, 외국어 조각, 톤 오염 탐지
 */
export function checkArtifactNoise(
  episodeTexts: Map<number, string>,
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];

  for (const [epNum, text] of episodeTexts.entries()) {
    for (const pattern of ARTIFACT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        issues.push({
          severity: "fatal",
          category: "artifact_noise",
          episode: epNum,
          evidence: `패턴 /${pattern.source}/ 매칭: "${match[0]?.slice(0, 40)}"`,
          explanation: "LLM 특수 토큰 또는 비한국어 조각 오염",
          suggested_fix_type: "postprocess",
        });
      }
    }

    // 연속 동일 문장 반복 (3회 이상)
    const sentences = text.split(/[.。!?！？\n]/).map(s => s.trim()).filter(s => s.length > 10);
    const sentCount: Record<string, number> = {};
    for (const s of sentences) {
      sentCount[s] = (sentCount[s] ?? 0) + 1;
    }
    for (const [s, cnt] of Object.entries(sentCount)) {
      if (cnt >= 3) {
        issues.push({
          severity: "major",
          category: "repetition_loop",
          episode: epNum,
          evidence: `"${s.slice(0, 60)}" × ${cnt}회 반복`,
          explanation: "동일 문장 3회 이상 반복 — 생성 루프 artifact",
          suggested_fix_type: "postprocess",
        });
      }
    }
  }

  return issues;
}

/**
 * F. Speech Register Flip
 * 같은 인물 쌍 사이의 존댓말/반말 급변 탐지
 * relationship_updates에서 호칭 변화 heuristic
 */
export function checkSpeechRegisterFlips(
  states: CharacterDynamicState[],
): ImmersionIssue[] {
  const issues: ImmersionIssue[] = [];

  const byChar: Record<string, CharacterDynamicState[]> = {};
  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }

  for (const [charName, history] of Object.entries(byChar)) {
    for (let i = 1; i < history.length; i++) {
      const prevRel = history[i - 1].relationship_updates as Record<string, string> | undefined ?? {};
      const currRel = history[i].relationship_updates as Record<string, string> | undefined ?? {};

      for (const target of Object.keys(currRel)) {
        const prev = (prevRel[target] ?? "").toLowerCase();
        const curr = (currRel[target] ?? "").toLowerCase();
        if (!prev || !curr) continue;

        const prevFormal = /존댓말|formal|경어|높임/.test(prev);
        const currFormal = /존댓말|formal|경어|높임/.test(curr);
        const prevCasual = /반말|casual|친밀|편한/.test(prev);
        const currCasual = /반말|casual|친밀|편한/.test(curr);

        if ((prevFormal && currCasual) || (prevCasual && currFormal)) {
          issues.push({
            severity: "minor",
            category: "speech_register_flip",
            episode: history[i].episode_number,
            character: charName,
            evidence: `ep${history[i - 1].episode_number} [${prev}] → ep${history[i].episode_number} [${curr}] (대상: ${target})`,
            explanation: "호칭/말투 격식 수준이 한 화 만에 반전 — 관계 변화 bridge 필요",
            suggested_fix_type: "state",
          });
        }
      }
    }
  }

  return issues;
}

// ══════════════════════════════════════════════════════════════
// Score & Verdict
// ══════════════════════════════════════════════════════════════

export function computeImmersionScore(issues: ImmersionIssue[]): number {
  let penalty = 0;
  for (const issue of issues) {
    if (issue.severity === "fatal") penalty += 0.15;
    else if (issue.severity === "major") penalty += 0.03;
    else penalty += 0.01;
  }
  return Math.max(0, 1 - penalty);
}

export function scoreToVerdict(score: number): ImmersionAuditResult["verdict"] {
  if (score >= 0.95) return "PASS";
  if (score >= 0.90) return "CONDITIONAL";
  if (score >= 0.80) return "WARN";
  return "FAIL";
}

// ══════════════════════════════════════════════════════════════
// Main Entry
// ══════════════════════════════════════════════════════════════

export async function runImmersionAudit(bookId: string): Promise<ImmersionAuditResult> {
  // 1. Data fetch
  const [epRes, stateRes, canonRes] = await Promise.all([
    pool.query(
      `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
      [bookId]
    ),
    pool.query(
      `SELECT character_name, episode_number, location, physical_state, items,
              emotional_state, recent_goal, relationship_updates, visibility_state
       FROM character_dynamic_states WHERE book_id=$1
       ORDER BY character_name, episode_number`,
      [bookId]
    ),
    pool.query(
      `SELECT name, initial_items FROM canonical_characters WHERE book_id=$1`,
      [bookId]
    ),
  ]);

  const episodeTexts = new Map<number, string>();
  for (const r of epRes.rows) {
    episodeTexts.set(r.episode_number, r.content ?? "");
  }

  const states: CharacterDynamicState[] = stateRes.rows.map(r => ({
    ...r,
    items: r.items ?? [],
    relationship_updates: r.relationship_updates ?? {},
    foreshadow_connections: [],
    alias_used: [],
  }));

  const canonItems: Record<string, string[]> = {};
  for (const r of canonRes.rows) {
    const raw = r.initial_items;
    const arr: string[] = Array.isArray(raw)
      ? raw.map((i: any) => (typeof i === "string" ? i : i?.name ?? ""))
      : [];
    canonItems[r.name] = arr;
  }

  // 2. Run checks
  const issues: ImmersionIssue[] = [
    ...checkAliveContradictions(states, episodeTexts),
    ...checkInventoryContradictions(states, canonItems),
    ...checkLocationJumps(states, episodeTexts),
    ...checkEmotionalLoops(states),
    ...checkArtifactNoise(episodeTexts),
    ...checkSpeechRegisterFlips(states),
  ];

  // 3. Deduplicate (same ep + char + category → keep highest severity)
  const deduped = deduplicateIssues(issues);

  // 4. Score
  const score = computeImmersionScore(deduped);
  const verdict = scoreToVerdict(score);

  const catSummary = {} as Record<ImmersionIssueCategory, number>;
  for (const issue of deduped) {
    catSummary[issue.category] = (catSummary[issue.category] ?? 0) + 1;
  }

  return {
    book_id: bookId,
    episodes_audited: epRes.rows.length,
    issues: deduped,
    fatal_count: deduped.filter(i => i.severity === "fatal").length,
    major_count: deduped.filter(i => i.severity === "major").length,
    minor_count: deduped.filter(i => i.severity === "minor").length,
    immersion_score: score,
    verdict,
    category_summary: catSummary,
    thirty_ep_allowed: verdict !== "FAIL" && deduped.filter(i => i.severity === "fatal").length === 0,
  };
}

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function isSameZone(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deduplicateIssues(issues: ImmersionIssue[]): ImmersionIssue[] {
  const SEV_ORDER: ImmersionIssueSeverity[] = ["fatal", "major", "minor"];
  const seen = new Map<string, ImmersionIssue>();
  for (const issue of issues) {
    const key = `${issue.episode}|${issue.character ?? ""}|${issue.category}`;
    const existing = seen.get(key);
    if (!existing || SEV_ORDER.indexOf(issue.severity) < SEV_ORDER.indexOf(existing.severity)) {
      seen.set(key, issue);
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.episode !== b.episode) return a.episode - b.episode;
    return SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
  });
}
