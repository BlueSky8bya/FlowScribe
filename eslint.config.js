import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // 외부 라이브러리
        marked: "readonly",
      },
    },
    rules: {
      // 같은 스코프 안에서 같은 이름 재선언 — 오늘 잡은 버그와 동일한 유형
      "no-redeclare": "error",
      // 정의되지 않은 변수 참조 (크로스파일 전역 함수는 warn으로)
      "no-undef": "warn",
      // 에러를 조용히 삼키는 빈 catch
      "no-empty": ["error", { "allowEmptyCatch": false }],
      // 도달 불가 코드
      "no-unreachable": "error",
      // switch 중복 case
      "no-duplicate-case": "error",
      // 객체 중복 키
      "no-dupe-keys": "error",
      // 함수 재할당
      "no-func-assign": "error",
      // 자기 자신에 대입
      "no-self-assign": "error",
      // 항상 true/false인 조건
      "no-constant-condition": "warn",
      // 미사용 변수 (전역 함수는 다른 파일에서 쓰므로 warn만)
      "no-unused-vars": ["warn", {
        "vars": "local",
        "args": "none",
        "varsIgnorePattern": "^_"
      }],
    },
  },
];
