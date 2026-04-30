/**
 * episode_appearance.ts — Phase 4.20 R5A stabilization
 *
 * 회차 본문에 인물이 실제 등장했는지 판정.
 * DB migration 없이 runtime detection — char_states를 reader UI에 표시할지 결정한다.
 *
 * 등장 기준 (one-of):
 *   1. canonical name이 본문에 직접 등장
 *   2. alias_used (character_dynamic_states.alias_used)에 등록된 alias가 본문에 등장
 *   3. visibility_state === "present" 이고 location !== "미등장"
 *      AND emotional_state가 "알 수 없음"이 아님 (carry-forward로만 채워진 row 제외)
 *
 * 비등장 (any-of):
 *   - location === "미등장"
 *   - visibility_state === "absent"
 *   - 본문에 이름/alias 미등장 + emotional_state === "알 수 없음" (carry-forward only)
 */

export interface AppearanceState {
  character_name: string;
  alias_used?: string[] | null;
  location?: string | null;
  visibility_state?: string | null;
  emotional_state?: string | null;
}

export interface AppearanceResult {
  character_name: string;
  appeared_in_episode: boolean;
  appearance_evidence: string[]; // ["direct_name" | "alias_match" | "active_state"]
}

/**
 * 본문 + char_states 기반 등장 여부 판정.
 * content: 회차 본문 (sanitized 권장).
 * states: 각 인물의 alias_used / location / visibility_state / emotional_state.
 */
export function detectEpisodeAppearances(
  content: string,
  states: AppearanceState[],
): Record<string, AppearanceResult> {
  const out: Record<string, AppearanceResult> = {};
  const safeContent = (content ?? "").trim();

  for (const s of states) {
    const evidence: string[] = [];
    let appeared = false;

    const name = (s.character_name ?? "").trim();
    if (!name) {
      out[s.character_name] = {
        character_name: s.character_name,
        appeared_in_episode: false,
        appearance_evidence: [],
      };
      continue;
    }

    // 1. 직접 이름 — 한국어는 word boundary가 없어 단순 substring 사용.
    //    너무 짧은 이름(1자)은 false-positive 위험이라 2자 이상만 검출.
    if (name.length >= 2 && safeContent.includes(name)) {
      evidence.push("direct_name");
      appeared = true;
    }

    // 2. alias 매칭
    const aliases = (s.alias_used ?? []).filter(a => typeof a === "string" && a.trim().length >= 2);
    for (const alias of aliases) {
      if (safeContent.includes(alias)) {
        evidence.push(`alias:${alias}`);
        appeared = true;
        break;
      }
    }

    // 3. 명시적 비등장 마킹은 직접 부정 (위에서 detection됐어도 상태가 absent면 미등장 처리)
    const isAbsentByState =
      s.visibility_state === "absent" ||
      s.location === "미등장";

    // 4. carry-forward only 패턴 — 본문 등장 없고 emotional_state가 "알 수 없음"이면 비등장.
    const isCarryOnly =
      !appeared &&
      (s.emotional_state === "알 수 없음" || s.emotional_state == null);

    if (isAbsentByState) {
      // 본문에 이름이 보였더라도 explicit absent면 미등장으로 간주.
      // (e.g., '브론은 합류하지 못했다'는 언급은 carry-forward 알림이지 등장 아님)
      // 단 evidence는 보존해 트레이서 분석에 도움.
      out[name] = {
        character_name: name,
        appeared_in_episode: false,
        appearance_evidence: [...evidence, "absent_by_state"],
      };
      continue;
    }

    if (!appeared && !isCarryOnly && s.visibility_state === "present") {
      // 본문 매치는 없지만 active state — drift 방지로 evidence 약하게 추가.
      // 정책상 reader UI에 보여줄지는 호출 측이 결정 (보수적: 본문 매치 없으면 미표시).
      evidence.push("active_state_no_body");
    }

    out[name] = {
      character_name: name,
      appeared_in_episode: appeared && !isAbsentByState,
      appearance_evidence: evidence,
    };
  }

  return out;
}

/**
 * char_states 배열에 appeared_in_episode + appearance_evidence를 첨부.
 * DB는 변경하지 않고 응답 페이로드에만 반영한다.
 */
export function annotateCharStatesWithAppearance<
  T extends AppearanceState
>(
  content: string,
  states: T[],
): Array<T & { appeared_in_episode: boolean; appearance_evidence: string[] }> {
  const map = detectEpisodeAppearances(content, states);
  return states.map(s => {
    const r = map[s.character_name];
    return {
      ...s,
      appeared_in_episode: r?.appeared_in_episode ?? false,
      appearance_evidence: r?.appearance_evidence ?? [],
    };
  });
}
