import { sanitizeGeneratedBody } from "../dist/services/text_sanitizer.js";

const r1 = sanitizeGeneratedBody("한 분위기에 휩싸였다. 짓눌aminan였다. 그 이후");
console.log("test1 text:", r1.text, "| removed:", r1.removed_foreign_fragments);

const r2 = sanitizeGeneratedBody("그녀abeledtr를 숨기는 걸까?");
console.log("test2 text:", r2.text, "| removed:", r2.removed_foreign_fragments);

const r3 = sanitizeGeneratedBody("이준서는 CLIFF를 넘어갔다.");
console.log("test3 CLIFF:", r3.text, "| removed:", r3.removed_foreign_fragments);

const r4 = sanitizeGeneratedBody("사일러스는 단검을 들고 앞으로 나아갔다.");
console.log("test4 clean:", r4.text, "| removed:", r4.removed_foreign_fragments);
