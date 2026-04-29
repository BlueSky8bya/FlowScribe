/**
 * text_sanitizer.ts — LLM 생성 본문 특수 토큰/외국어 조각 정제
 *
 * 처리 대상:
 *   <unused\d+>    — tokenizer special token (Gemma 계열 등)
 *   #shy, #\w+     — 비서술적 해시태그 잔여물
 *   ahuv, potongannya 등 고립된 외국어 단어
 *   키릴/아랍/태국/인도네시아어 조각
 *
 * 보존 대상:
 *   영문 고유명사, 브랜드명, 기기명 (S20, AI, USB, CLIFF, END 등)
 *   한국어 문장 내 자연스러운 영문 약어
 */

export interface SanitizeResult {
  text: string;
  removed_special_tokens: number;
  removed_foreign_fragments: number;
  warnings: string[];
}

// <unused\d+> 계열 special token
const SPECIAL_TOKEN_RE = /<unused\d+>|<\|[a-z_]+\|>|<s>|<\/s>|<unk>|<pad>/g;

// 비서술적 해시태그 (#shy, #cmd 등) — 한국어 해시태그 제외
const HASHTAG_RE = /#[a-z_][a-z0-9_]*/g;

// 고립된 외국어 단어 패턴:
// - 4자 이상 라틴문자 단어가 한국어 문장 내에 고립되어 있을 때
// - 단, 허용 목록에 있으면 유지
const ALLOWED_LATIN = /^(CLIFF|END|AI|OK|S\d+|USB|PC|TV|IT|UV|VR|AR|SF|DNA|RNA|ID|IP|URL|PDF|MP3|MP4|CCTV|GPS|WiFi|Bluetooth|Android|iPhone|App|Web|API|JSON|HTML|CSS|server|client|backend|frontend)$/i;

// 순수 외국어 조각: 한글 없이 라틴/키릴/아랍 등 4자 이상 연속된 단어 조각
const FOREIGN_FRAGMENT_RE = /(?<![a-zA-Z가-힣\d])[a-z]{4,}(?:\s+[a-z]{3,}){0,2}(?![a-zA-Z가-힣\d])/gi;

// 키릴/아랍/태국어 등 비한글 비라틴 스크립트
const NON_KO_SCRIPT_RE = /[Ѐ-ӿ؀-ۿ฀-๿ऀ-ॿ぀-ゟ゠-ヿ]/g;

export function sanitizeGeneratedBody(raw: string): SanitizeResult {
  const warnings: string[] = [];
  let text = raw;
  let removed_special_tokens = 0;
  let removed_foreign_fragments = 0;

  // 1. special tokens
  text = text.replace(SPECIAL_TOKEN_RE, (m) => {
    removed_special_tokens++;
    warnings.push(`special_token: ${m}`);
    return "";
  });

  // 2. 비서술 해시태그
  text = text.replace(HASHTAG_RE, (m) => {
    removed_foreign_fragments++;
    warnings.push(`hashtag: ${m}`);
    return "";
  });

  // 3. 키릴/아랍/태국어 조각
  text = text.replace(NON_KO_SCRIPT_RE, () => {
    removed_foreign_fragments++;
    return "";
  });

  // 4. 고립된 외국어 단어 (한국어 문장 중간에 박힌 라틴어 조각)
  // 단, 허용 목록 / 대문자로만 된 약어는 유지
  text = text.replace(FOREIGN_FRAGMENT_RE, (m) => {
    const trimmed = m.trim();
    // 허용 목록
    if (ALLOWED_LATIN.test(trimmed)) return m;
    // 대문자 약어 (3자 이하) 허용
    if (/^[A-Z]{1,4}$/.test(trimmed)) return m;
    // 한국어 앞뒤로 감싸진 경우만 제거 (고립 조각)
    removed_foreign_fragments++;
    warnings.push(`foreign_fragment: ${trimmed}`);
    return "";
  });

  // 5. 중복 공백/빈 줄 정리
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  if (warnings.length > 0) {
    warnings.unshift(`[sanitizer] ${removed_special_tokens} special tokens, ${removed_foreign_fragments} foreign fragments removed`);
  }

  return { text, removed_special_tokens, removed_foreign_fragments, warnings };
}
