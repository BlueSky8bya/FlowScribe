# FlowScribe DPO Smoke Test — Runpod 실행 가이드

## 왜 Runpod인가

| 항목 | Runpod | Colab Pro |
|------|--------|-----------|
| 세션 타임아웃 | **없음** | 90분~12시간 (Pro) |
| GPU 선택 | A100 80GB / 40GB, H100 등 자유 선택 | 배정에 따라 랜덤 |
| 비용 (A100 40GB) | **$1.99/hr** | 컴퓨팅 단위 소모 |
| SSH 접속 | **가능** | 불가 |
| 파일 영구 저장 | 볼륨 분리 가능 | 인스턴스 종료 시 소멸 |
| 예상 학습 시간 | 60~90분 (2 epoch) | 동일 |

→ 세션 타임아웃 없이 SSH로 직접 제어 가능 → **Runpod 추천**

---

## 사전 준비물

| 항목 | 확인 방법 |
|------|----------|
| `HF_TOKEN` | https://huggingface.co/settings/tokens |
| gemma-3-12b 라이선스 승인 | https://huggingface.co/google/gemma-3-12b-it (Accept 버튼) |
| Runpod 계정 | https://runpod.io — 크레딧 $10 이상 충전 |
| 데이터셋 | 아래 업로드 방법 참고 |

---

## Step 1: Runpod 인스턴스 생성

1. runpod.io → **Secure Cloud** → **Deploy**
2. GPU 선택:
   - **1× A100 SXM 80GB** — $3.49/hr, 최적 (여유 큼)
   - **1× A100 PCIe 40GB** — $1.99/hr, 충분 (타이트)
   - **2× RTX 4090** — $1.40/hr, VRAM 48GB 합산 가능
3. Template: **RunPod PyTorch 2.3.1** (또는 CUDA 12.1 기반)
4. Container Disk: **50GB** (모델 24GB + 여유)
5. Volume: **20GB** (결과 영구 저장)
6. **Deploy On-Demand** 클릭

---

## Step 2: 데이터셋 업로드

인스턴스 시작 후 SSH 접속:
```bash
# SSH 탭에서 ssh 명령어 복사 후 로컬 터미널 실행
ssh root@<pod-ip> -p <port> -i ~/.ssh/id_ed25519
```

데이터셋 전송 (로컬에서):
```bash
# 로컬 FlowScribe 디렉토리에서 실행
scp -P <port> data/datasets/dpo_v3_train.jsonl root@<pod-ip>:/workspace/
scp -P <port> data/datasets/dpo_v3_val.jsonl   root@<pod-ip>:/workspace/
scp -P <port> scripts/cloud_dpo/setup.sh        root@<pod-ip>:/workspace/
scp -P <port> scripts/cloud_dpo/run_dpo_smoke.py root@<pod-ip>:/workspace/
scp -P <port> scripts/cloud_dpo/baseline_eval.py root@<pod-ip>:/workspace/
```

또는 wget (HuggingFace Dataset으로 업로드한 경우):
```bash
# Runpod 서버에서
wget -O dpo_v3_train.jsonl "<your-hf-dataset-url>/dpo_v3_train.jsonl"
```

---

## Step 3: 환경 설치

```bash
# Runpod SSH에서
cd /workspace
export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export RUNPOD_API_KEY=rpa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # .env에서 복사
export RUNPOD_AUTO_TERMINATE=1                              # 학습 완료 후 pod 자동 종료
bash setup.sh
```

설치 시간: 약 5~10분

---

## Step 4: baseline 먼저 측정 (선택, 권장)

DPO 학습 전 baseline 수치를 기록해 두면 학습 후 비교가 명확해진다.

```bash
cd /workspace
export HF_TOKEN=hf_xxxx
python baseline_eval.py --val-file dpo_v3_val.jsonl --output-dir ./smoke_output/baseline
```

예상 시간: 15~20분 (val 29쌍 × logprob 계산 + generation 5개)

결과: `./smoke_output/baseline/baseline_results.json`

---

## Step 5: DPO 학습 실행 (메인)

```bash
cd /workspace
export HF_TOKEN=hf_xxxx
export TRAIN_FILE=dpo_v3_train.jsonl
export VAL_FILE=dpo_v3_val.jsonl

# 표준 실행 (2 epoch, 기본 max-len=1024, eval=epoch 단위, 체크포인트 저장 없음)
python run_dpo_smoke.py \
  --epochs 2 \
  --lr 5e-5 \
  --beta 0.1 \
  --lora-r 16 \
  --batch 1 \
  --grad-accum 16 \
  --output-dir ./smoke_output

# 빠른 확인 (1 epoch + gen 생략 + 10쌍만 val 평가)
python run_dpo_smoke.py \
  --epochs 1 \
  --skip-gen \
  --fast-eval 10 \
  --output-dir ./smoke_output

# 데이터 검증만
python run_dpo_smoke.py --dry-run
```

백그라운드 실행 (SSH 끊겨도 계속):
```bash
nohup python run_dpo_smoke.py \
  --epochs 2 --lr 5e-5 --beta 0.1 \
  --output-dir ./smoke_output \
  > train.log 2>&1 &

tail -f train.log  # 실시간 확인
```

---

## Step 6: 결과 회수

```bash
# Runpod에서 결과 압축
cd /workspace
tar -czf smoke_results.tar.gz smoke_output/

# 로컬에서 다운로드
scp -P <port> root@<pod-ip>:/workspace/smoke_results.tar.gz ./
```

결과 파일 구조:
```
smoke_output/
  <timestamp>/
    smoke_results.json          ← 핵심 지표 (verdict 포함)
    train_log.json              ← epoch별 loss 기록
    generation_comparison.json  ← 생성 텍스트 비교
    final_adapter/              ← LoRA 가중치
    checkpoints/                ← 중간 체크포인트
```

---

## 예상 소요 시간 / 비용

| 단계 | A100 40GB | A100 80GB |
|------|-----------|-----------|
| setup.sh | 5~10분 | 5~10분 |
| 모델 다운로드 | 10~15분 | 10~15분 |
| baseline_eval | 15~20분 | 10~15분 |
| DPO 학습 (2 epoch) | 60~90분 | 40~60분 |
| val + generation 평가 | 10~15분 | 8~12분 |
| **전체** | **100~130분** | **75~105분** |

비용:
- A100 40GB: 약 **$3~5** (100~130분 × $1.99/hr)
- A100 80GB: 약 **$5~7** (75~105분 × $3.49/hr)

---

## VRAM 예상 사용량 (A100 40GB 기준)

| 항목 | 메모리 |
|------|--------|
| gemma3:12b 4-bit 가중치 | ~6.5 GB |
| LoRA 추가 파라미터 | ~0.2 GB |
| 학습 중 활성화값 | ~4 GB |
| DPO (chosen+rejected 동시) | ×2 배치 | ~5 GB |
| 옵티마이저 상태 | ~1.5 GB |
| **합계** | **~18 GB** |

A100 40GB면 충분히 여유 있음. RTX 4090 24GB는 batch=1, grad_accum=16 설정이면 경계선이지만 가능.

---

## 실패 시 체크 포인트

| 증상 | 원인 | 해결 |
|------|------|------|
| `ModuleNotFoundError: bitsandbytes` | 설치 미완료 | `pip install bitsandbytes` |
| `CUDA out of memory` | VRAM 부족 | `--batch 1 --grad-accum 32` 또는 A100 80GB 사용 |
| `gated repo` 403 오류 | HF 라이선스 미승인 | huggingface.co/google/gemma-3-12b-it 에서 Accept |
| NaN loss | LR 너무 큼 | `--lr 1e-5`로 낮추기 |
| val_loss 급등 | 과적합 | `--epochs 1`로 줄이기 |
| generation 전혀 한국어 아님 | 모델 붕괴 | beta 올리기 (`--beta 0.3`), epoch 줄이기 |
| `connection refused` (SSH) | 인스턴스 미시작 | Runpod 대시보드에서 상태 확인 |

---

## DPO 스모크 테스트 성공 판정 기준

| 지표 | 실패 | 부분 성공 | 성공 |
|------|------|-----------|------|
| val pair accuracy | < 45% | 45~55% | **≥ 55%** |
| eval_loss - train_loss (gap) | > 0.20 | 0.10~0.20 | **≤ 0.10** |
| gen truncated rate | > 30% | 10~30% | **≤ 10%** |
| gen foreign char rate | > 0% | 0% | **0%** |
| loss NaN / collapse | 발생 | — | **없음** |

세 지표 모두 "성공" 범위: **SUCCESS**
두 개 이상: **PARTIAL**
하나 이하: **FAIL**

---

## Colab 대안 (빠른 시작)

Runpod 세팅이 불편하면 Colab Pro(A100)으로 시작 가능.

```python
# Colab 셀 1 — 설치
!pip install torch==2.3.1 --index-url https://download.pytorch.org/whl/cu121 -q
!pip install transformers==4.44.2 trl==0.10.1 peft==0.12.0 accelerate bitsandbytes datasets -q

# Colab 셀 2 — 파일 업로드
from google.colab import files
uploaded = files.upload()  # dpo_v3_train.jsonl, dpo_v3_val.jsonl 선택

# Colab 셀 3 — 환경변수 + 실행
import os
os.environ["HF_TOKEN"] = "hf_xxxx"
!python run_dpo_smoke.py --epochs 1 --skip-gen  # Colab은 1 epoch만 권장 (타임아웃 주의)
```

Colab 주의사항:
- Pro 기준 A100 12시간 세션 → 2 epoch 실행 가능하나 끊길 수 있음
- 끊기면 처음부터 재시작 (체크포인트 있어도 복구 복잡)
- `--epochs 1`로 60분 이내 완료가 안전
