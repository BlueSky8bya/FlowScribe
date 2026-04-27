"""
runpod_utils.py — Runpod pod 자동 종료 공통 유틸

환경변수:
  RUNPOD_API_KEY=rpa_xxxx    (필수)
  RUNPOD_POD_ID=xxxx         (선택 — 미입력 시 실행 중 pod 자동 탐지)
  RUNPOD_AUTO_TERMINATE=1    (선택 — 명시적으로 1일 때만 자동 종료)

사용:
  from runpod_utils import terminate_pod_if_configured
  terminate_pod_if_configured()  # 스크립트 맨 끝에서 호출
"""

import os
import json
import time
import logging
import urllib.request

log = logging.getLogger("runpod_utils")


def terminate_pod_if_configured(force: bool = False) -> None:
    """
    RUNPOD_API_KEY와 (RUNPOD_AUTO_TERMINATE=1 또는 force=True) 조건을 모두
    만족할 때 현재 pod를 terminate한다.

    Args:
        force: True이면 RUNPOD_AUTO_TERMINATE 환경변수 무시하고 강제 종료
    """
    api_key  = os.getenv("RUNPOD_API_KEY", "")
    pod_id   = os.getenv("RUNPOD_POD_ID", "")
    auto_terminate = os.getenv("RUNPOD_AUTO_TERMINATE", "0").strip()

    if not api_key:
        log.info("RUNPOD_API_KEY 없음 — pod 자동 종료 생략")
        return

    if not force and auto_terminate != "1":
        log.info("RUNPOD_AUTO_TERMINATE=1 아님 — pod 자동 종료 생략 (원하면 환경변수 설정)")
        return

    def _graphql(query: str) -> dict:
        body = json.dumps({"query": query}).encode()
        req  = urllib.request.Request(
            "https://api.runpod.io/graphql",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())

    try:
        if not pod_id:
            data    = _graphql("{ myself { pods { id name desiredStatus } } }")
            pods    = data.get("data", {}).get("myself", {}).get("pods", [])
            running = [p for p in pods if p.get("desiredStatus") == "RUNNING"]

            if not running:
                log.info("실행 중인 Runpod pod 없음 — 이미 종료됨")
                return
            if len(running) > 1:
                names = [f"{p['id']}({p.get('name','')})" for p in running]
                log.warning(f"실행 중인 pod가 {len(running)}개 — 자동 종료 생략 (의도치 않은 종료 방지)")
                log.warning(f"  pod 목록: {names}")
                log.warning("  RUNPOD_POD_ID 환경변수로 종료할 pod를 명시하세요.")
                return
            pod_id = running[0]["id"]
            log.info(f"자동 탐지된 pod: {pod_id} ({running[0].get('name', '')})")

        log.info(f"Runpod pod 종료 중: {pod_id} ...")
        _graphql(f'mutation {{ podTerminate(input: {{ podId: "{pod_id}" }}) }}')

        time.sleep(3)
        data      = _graphql("{ myself { pods { id desiredStatus } } }")
        remaining = [p for p in data.get("data", {}).get("myself", {}).get("pods", [])
                     if p["id"] == pod_id]
        if not remaining:
            log.info(f"  ✓ pod {pod_id} 종료 완료 — 과금 중지")
        else:
            log.info(f"  pod {pod_id} 상태: {remaining[0].get('desiredStatus')} (처리 중)")

    except Exception as e:
        log.error(f"pod 자동 종료 실패: {e}")
        log.error("  대시보드에서 수동 종료: https://www.runpod.io/console/pods")
