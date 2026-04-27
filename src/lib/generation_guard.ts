/**
 * generation_guard.ts — 생성/감사 LLM 충돌 방지
 *
 * planner path가 실행 중일 때 background audit가 Ollama 큐에서
 * 경쟁하지 않도록 단순 플래그 기반 가드를 제공한다.
 *
 * 단일 서버 프로세스 내 경쟁 방지용 (멀티 프로세스 환경에서는 Redis 잠금 필요).
 */

let _activeGenerations = 0;

export function enterGeneration(): void {
  _activeGenerations++;
}

export function exitGeneration(): void {
  _activeGenerations = Math.max(0, _activeGenerations - 1);
}

export function isGenerationActive(): boolean {
  return _activeGenerations > 0;
}

/**
 * 생성이 끝날 때까지 대기 (최대 waitMs).
 * background audit가 LLM 호출 전 이 함수를 호출한다.
 */
export async function waitForGenerationSlot(waitMs = 60_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (isGenerationActive() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }
}
