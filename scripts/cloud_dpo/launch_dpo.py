#!/usr/bin/env python3
"""
launch_dpo.py — Runpod DPO 완전 자동 런처

사용법:
  python scripts/cloud_dpo/launch_dpo.py [옵션]

동작 순서:
  1. Runpod API로 pod 생성 (GPU 선택 가능)
  2. SSH 준비 대기
  3. 데이터셋 + 스크립트 업로드
  4. setup.sh 실행 (환경 설치)
  5. baseline 평가 (선택)
  6. DPO 학습 실행
  7. 결과 다운로드
  8. pod 자동 종료

환경변수 (.env에서 자동 로드):
  RUNPOD_API_KEY   — 필수
  HF_TOKEN         — 필수
  SSH_KEY_PATH     — 기본값: ~/.ssh/id_ed25519

예시:
  python scripts/cloud_dpo/launch_dpo.py
  python scripts/cloud_dpo/launch_dpo.py --gpu A100_SXM --epochs 2 --skip-baseline
  python scripts/cloud_dpo/launch_dpo.py --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ─── 상수 ────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# Runpod에 업로드할 파일 목록 (PROJECT_ROOT 기준 상대경로 → 원격 /workspace/ 파일명)
UPLOAD_FILES = [
    ("data/datasets/dpo_v3_train.jsonl", "dpo_v3_train.jsonl"),
    ("data/datasets/dpo_v3_val.jsonl",   "dpo_v3_val.jsonl"),
    ("scripts/cloud_dpo/setup.sh",         "setup.sh"),
    ("scripts/cloud_dpo/run_dpo_smoke.py", "run_dpo_smoke.py"),
    ("scripts/cloud_dpo/baseline_eval.py", "baseline_eval.py"),
    ("scripts/cloud_dpo/runpod_utils.py",  "runpod_utils.py"),
]

# GPU 옵션 → Runpod displayName 매핑 (가격 순)
GPU_OPTIONS = {
    "4090x2": "NVIDIA GeForce RTX 4090",  # ~$1.40/hr, VRAM 48GB
    "A100_40": "NVIDIA A100 PCIe",          # ~$1.99/hr, VRAM 40GB
    "A100_80": "NVIDIA A100-SXM4-80GB",    # ~$3.49/hr, VRAM 80GB
    "H100":    "NVIDIA H100 80GB HBM3",    # ~$4.69/hr
}

RUNPOD_GRAPHQL = "https://api.runpod.io/graphql"
POLL_INTERVAL  = 15   # SSH 대기 폴링 간격 (초)
SSH_TIMEOUT    = 600  # SSH 준비 최대 대기 시간 (초)


# ─── 헬퍼 ────────────────────────────────────────────────────────────────────

def load_env():
    """PROJECT_ROOT/.env 파일에서 환경변수 로드 (기존 os.environ 우선)."""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def graphql(api_key: str, query: str) -> dict:
    body = json.dumps({"query": query}).encode()
    req  = urllib.request.Request(
        RUNPOD_GRAPHQL,
        data=body,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def ssh_cmd(host: str, port: int, key: str, remote_cmd: str,
            capture: bool = False, check: bool = True):
    """원격 SSH 명령 실행."""
    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-i", key,
        "-p", str(port),
        f"root@{host}",
        remote_cmd,
    ]
    if capture:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result
    else:
        result = subprocess.run(cmd, check=check)
        return result


def scp_upload(local: Path, host: str, port: int, key: str, remote: str):
    """SCP 파일 업로드."""
    cmd = [
        "scp",
        "-o", "StrictHostKeyChecking=no",
        "-i", key,
        "-P", str(port),
        str(local),
        f"root@{host}:{remote}",
    ]
    subprocess.run(cmd, check=True)


def scp_download(host: str, port: int, key: str, remote: str, local: Path):
    """SCP 파일 다운로드."""
    cmd = [
        "scp",
        "-o", "StrictHostKeyChecking=no",
        "-i", key,
        "-P", str(port),
        "-r",
        f"root@{host}:{remote}",
        str(local),
    ]
    subprocess.run(cmd, check=True)


def print_step(n: int, total: int, msg: str):
    print(f"\n[{n}/{total}] {msg}", flush=True)


# ─── 메인 ────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Runpod DPO 완전 자동 런처")
    p.add_argument("--gpu",           default="A100_40",
                   choices=list(GPU_OPTIONS.keys()),
                   help="GPU 타입 (기본: A100_40 = $1.99/hr)")
    p.add_argument("--epochs",        type=int,   default=2)
    p.add_argument("--lr",            type=float, default=5e-5)
    p.add_argument("--beta",          type=float, default=0.1)
    p.add_argument("--lora-r",        type=int,   default=16)
    p.add_argument("--batch",         type=int,   default=1)
    p.add_argument("--grad-accum",    type=int,   default=16)
    p.add_argument("--max-len",       type=int,   default=1024,
                   help="DPO 학습/평가 최대 토큰 길이 (기본: 1024). "
                        "gen_truncated_rate 높으면 1536→2048 순서로 상향. "
                        "VRAM/시간 증가 주의.")
    p.add_argument("--skip-baseline", action="store_true",
                   help="baseline 평가 건너뜀 (시간 절약 ~15분)")
    p.add_argument("--skip-gen",      action="store_true",
                   help="generation 평가 건너뜀")
    p.add_argument("--fast-eval",     type=int,   default=0,
                   help="val 평가 샘플 수 제한 (0=전체)")
    p.add_argument("--output-dir",    default="./smoke_output",
                   help="Runpod 내 결과 디렉토리")
    p.add_argument("--local-output",  default="logs/dpo_smoke",
                   help="로컬 결과 저장 경로 (PROJECT_ROOT 기준)")
    p.add_argument("--ssh-key",       default="",
                   help="SSH 개인키 경로 (기본: ~/.ssh/id_ed25519)")
    p.add_argument("--dry-run",       action="store_true",
                   help="pod 생성 없이 설정만 출력")
    return p.parse_args()


def create_pod(api_key: str, gpu_name: str, dry_run: bool) -> dict:
    """Runpod Secure Cloud pod 생성. 생성된 pod 정보 반환."""
    if dry_run:
        print(f"  [dry-run] GPU: {gpu_name} — pod 생성 건너뜀")
        return {"id": "dry-run-pod", "ip": "localhost", "port": 22}

    # 사용 가능한 GPU 목록 조회
    print("  사용 가능한 GPU 조회 중...", flush=True)
    q = """
    {
      gpuTypes {
        id
        displayName
        memoryInGb
        secureCloud
        lowestPrice(input: { gpuCount: 1 }) {
          minimumBidPrice
          uninterruptablePrice
        }
      }
    }
    """
    data   = graphql(api_key, q)
    gpus   = data.get("data", {}).get("gpuTypes", [])
    target = [g for g in gpus if gpu_name in g.get("displayName", "") and g.get("secureCloud")]

    if not target:
        available = [g["displayName"] for g in gpus if g.get("secureCloud")]
        print(f"  오류: '{gpu_name}' Secure Cloud GPU를 찾을 수 없습니다.")
        print(f"  사용 가능한 GPU 목록:\n    " + "\n    ".join(available))
        sys.exit(1)

    gpu_id = target[0]["id"]
    price  = target[0].get("lowestPrice", {}).get("uninterruptablePrice", "?")
    print(f"  선택된 GPU: {target[0]['displayName']} (${price}/hr)")

    # Pod 생성
    mutation = f"""
    mutation {{
      podFindAndDeployOnDemand(input: {{
        gpuTypeId: "{gpu_id}"
        gpuCount: 1
        volumeInGb: 20
        containerDiskInGb: 50
        minVcpuCount: 4
        minMemoryInGb: 15
        imageName: "runpod/pytorch:2.3.1-py3.11-cuda12.1.1-devel-ubuntu22.04"
        dockerArgs: ""
        ports: "22/tcp"
        supportPublicIp: true
        name: "flowscribe-dpo"
        env: [
          {{ key: "RUNPOD_AUTO_TERMINATE", value: "1" }}
        ]
      }}) {{
        id
        desiredStatus
        runtime {{
          ports {{
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }}
        }}
      }}
    }}
    """
    result  = graphql(api_key, mutation)
    errors  = result.get("errors")
    if errors:
        print(f"  pod 생성 실패: {errors}")
        sys.exit(1)

    pod = result["data"]["podFindAndDeployOnDemand"]
    print(f"  pod 생성됨: {pod['id']}")
    return pod


def wait_for_ssh(api_key: str, pod_id: str, ssh_key: str,
                 timeout: int = SSH_TIMEOUT) -> tuple[str, int]:
    """SSH 접속이 가능해질 때까지 폴링. (host, port) 반환."""
    print(f"  SSH 준비 대기 중 (최대 {timeout}초)...", flush=True)
    deadline = time.time() + timeout

    while time.time() < deadline:
        q = f"""
        {{
          myself {{
            pods(filters: {{ podId: "{pod_id}" }}) {{
              id
              desiredStatus
              runtime {{
                ports {{
                  ip
                  isIpPublic
                  privatePort
                  publicPort
                  type
                }}
              }}
            }}
          }}
        }}
        """
        data  = graphql(api_key, q)
        pods  = data.get("data", {}).get("myself", {}).get("pods", [])
        pod   = next((p for p in pods if p["id"] == pod_id), None)

        if pod and pod.get("runtime"):
            ports = pod["runtime"].get("ports", [])
            ssh   = next((p for p in ports if p["privatePort"] == 22 and p.get("isIpPublic")), None)
            if ssh:
                host = ssh["ip"]
                port = ssh["publicPort"]
                print(f"  SSH 준비 완료: {host}:{port}")
                # 실제 접속 확인
                r = ssh_cmd(host, port, ssh_key, "echo ok", capture=True, check=False)
                if r.returncode == 0:
                    return host, port
                print(f"  SSH 연결 테스트 실패 — 재시도...", flush=True)

        elapsed = int(time.time() - deadline + timeout)
        print(f"  대기 중... ({elapsed}초 경과)", flush=True)
        time.sleep(POLL_INTERVAL)

    print("  오류: SSH 준비 타임아웃")
    sys.exit(1)


def main():
    load_env()
    args = parse_args()

    api_key = os.environ.get("RUNPOD_API_KEY", "")
    hf_token = os.environ.get("HF_TOKEN", "")
    ssh_key  = args.ssh_key or os.path.expanduser("~/.ssh/id_ed25519")

    # 사전 검증
    if not args.dry_run:
        if not api_key:
            print("오류: RUNPOD_API_KEY가 설정되지 않았습니다 (.env 확인)")
            sys.exit(1)
        if not hf_token:
            print("오류: HF_TOKEN이 설정되지 않았습니다 (.env 확인)")
            sys.exit(1)
        if not Path(ssh_key).exists():
            print(f"오류: SSH 키 파일 없음: {ssh_key}")
            print("  생성: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519")
            print("  Runpod 등록: runpod.io → Settings → SSH Public Keys")
            sys.exit(1)

    # 데이터셋 파일 존재 확인
    for local_rel, _ in UPLOAD_FILES:
        local_path = PROJECT_ROOT / local_rel
        if not local_path.exists() and "dataset" in local_rel:
            print(f"오류: 데이터셋 파일 없음: {local_path}")
            sys.exit(1)

    gpu_name = GPU_OPTIONS[args.gpu]
    TOTAL_STEPS = 7 if not args.skip_baseline else 6
    step = 0

    print("=" * 60)
    print("FlowScribe DPO 자동 런처")
    print("=" * 60)
    print(f"  GPU:      {args.gpu} ({gpu_name})")
    print(f"  Epochs:   {args.epochs}")
    print(f"  LR:       {args.lr}")
    print(f"  Beta:     {args.beta}")
    print(f"  Max-len:  {args.max_len}  (gen_truncated_rate 60%+ 시 1536→2048 상향)")
    print(f"  Baseline: {'건너뜀' if args.skip_baseline else '실행'}")
    print(f"  SSH key:  {ssh_key}")
    if args.dry_run:
        print("  [DRY-RUN 모드 — pod 생성 없음]")
    print()

    # Step 1: Pod 생성
    step += 1
    print_step(step, TOTAL_STEPS, "Runpod pod 생성")
    pod = create_pod(api_key, gpu_name, args.dry_run)
    pod_id = pod["id"]

    if args.dry_run:
        print("\n[dry-run 완료] 실제 실행 시 위 단계들이 자동으로 진행됩니다.")
        return

    # Step 2: SSH 대기
    step += 1
    print_step(step, TOTAL_STEPS, "SSH 접속 대기")
    host, port = wait_for_ssh(api_key, pod_id, ssh_key)

    # Step 3: 파일 업로드
    step += 1
    print_step(step, TOTAL_STEPS, "파일 업로드")
    for local_rel, remote_name in UPLOAD_FILES:
        local_path = PROJECT_ROOT / local_rel
        if not local_path.exists():
            print(f"  건너뜀 (없음): {local_rel}")
            continue
        print(f"  업로드: {local_rel} → /workspace/{remote_name}", flush=True)
        scp_upload(local_path, host, port, ssh_key, f"/workspace/{remote_name}")
    print("  업로드 완료")

    # Step 4: 환경 설치
    step += 1
    print_step(step, TOTAL_STEPS, "환경 설치 (setup.sh)")
    ssh_cmd(host, port, ssh_key,
            f"cd /workspace && export HF_TOKEN={hf_token} && bash setup.sh")

    # Step 5: Baseline 평가 (선택)
    if not args.skip_baseline:
        step += 1
        print_step(step, TOTAL_STEPS, "Baseline 평가")
        ssh_cmd(host, port, ssh_key,
                f"cd /workspace && export HF_TOKEN={hf_token} && "
                f"python baseline_eval.py --val-file dpo_v3_val.jsonl "
                f"--max-len {args.max_len} "
                f"--output-dir {args.output_dir}/baseline")

    # Step 6: DPO 학습
    step += 1
    print_step(step, TOTAL_STEPS, "DPO 학습 실행")

    train_cmd_parts = [
        f"export HF_TOKEN={hf_token}",
        f"export RUNPOD_API_KEY={api_key}",
        f"export RUNPOD_POD_ID={pod_id}",
        "export RUNPOD_AUTO_TERMINATE=1",
        f"cd /workspace && python run_dpo_smoke.py"
        f" --epochs {args.epochs}"
        f" --lr {args.lr}"
        f" --beta {args.beta}"
        f" --lora-r {args.lora_r}"
        f" --batch {args.batch}"
        f" --grad-accum {args.grad_accum}"
        f" --max-len {args.max_len}"
        f" --output-dir {args.output_dir}",
    ]
    if args.skip_gen:
        train_cmd_parts[-1] += " --skip-gen"
    if args.fast_eval:
        train_cmd_parts[-1] += f" --fast-eval {args.fast_eval}"

    # nohup으로 백그라운드 실행 + 로그 tee
    bg_cmd = " && ".join(train_cmd_parts[:-1]) + " && " + \
             f"nohup {train_cmd_parts[-1]} > /workspace/train.log 2>&1"
    ssh_cmd(host, port, ssh_key, bg_cmd)

    # 학습 완료 대기 (train.log의 FINISHED 또는 pod 종료 감지)
    print("\n  학습 진행 중 — 로그 스트리밍:", flush=True)
    print("  (Ctrl+C로 스트리밍 중단 가능, 학습은 계속됩니다)\n", flush=True)

    try:
        ssh_cmd(host, port, ssh_key, "tail -f /workspace/train.log")
    except KeyboardInterrupt:
        print("\n  로그 스트리밍 중단. 결과 다운로드를 시도합니다...")
    except Exception:
        print("\n  pod가 종료되었거나 연결이 끊어졌습니다.")

    # Step 7: 결과 다운로드
    step += 1
    print_step(step, TOTAL_STEPS, "결과 다운로드")

    local_output = PROJECT_ROOT / args.local_output
    local_output.mkdir(parents=True, exist_ok=True)

    # pod가 아직 살아있으면 결과 다운로드
    try:
        # 결과 압축
        ssh_cmd(host, port, ssh_key,
                f"cd /workspace && tar -czf smoke_results.tar.gz {args.output_dir}/ train.log",
                check=False)
        out_file = local_output / "smoke_results.tar.gz"
        scp_download(host, port, ssh_key, "/workspace/smoke_results.tar.gz", out_file)
        print(f"  결과 저장: {out_file}")
        print(f"  압축 해제: tar -xzf {out_file} -C {local_output}/")
    except Exception as e:
        print(f"  결과 다운로드 실패 (pod가 이미 종료됨?): {e}")
        print(f"  Runpod 볼륨에서 수동으로 smoke_results.tar.gz를 가져오세요.")

    print("\n" + "=" * 60)
    print("완료!")
    print(f"  pod ID:  {pod_id}")
    print(f"  결과:    {local_output}/")
    print("  pod는 학습 완료 후 자동 종료됩니다 (RUNPOD_AUTO_TERMINATE=1)")
    print("=" * 60)


if __name__ == "__main__":
    main()
