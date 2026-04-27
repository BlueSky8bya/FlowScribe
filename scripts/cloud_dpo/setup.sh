#!/bin/bash
# FlowScribe DPO Smoke Test — Environment Setup
# Target: Runpod (CUDA 12.1, Python 3.11, A100 40GB 이상)
#
# 실행: bash setup.sh

set -e
echo "=== FlowScribe DPO Smoke Setup ==="

# 1. CUDA / Driver 확인
nvidia-smi | head -10

# 2. Python 버전 확인
python3 --version

# 3. pip 최신화
pip install --upgrade pip --quiet

# 4. PyTorch (CUDA 12.1 빌드)
echo "[1/4] PyTorch 설치..."
pip install torch==2.3.1 torchvision --index-url https://download.pytorch.org/whl/cu121 --quiet

# 5. HuggingFace 스택
echo "[2/4] Transformers / TRL / PEFT 설치..."
pip install \
  transformers==4.44.2 \
  trl==0.10.1 \
  peft==0.12.0 \
  accelerate==0.34.2 \
  bitsandbytes==0.43.3 \
  datasets==2.21.0 \
  huggingface_hub \
  --quiet

# 6. 평가용
echo "[3/4] 평가 도구 설치..."
pip install rouge-score nltk --quiet

# 7. HF 로그인
echo "[4/4] HuggingFace 로그인..."
if [ -z "$HF_TOKEN" ]; then
  echo "ERROR: HF_TOKEN 환경변수가 없습니다."
  echo "  export HF_TOKEN=hf_xxxxxxxx"
  exit 1
fi
huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential 2>/dev/null || true

echo ""
echo "=== Setup 완료 ==="
python3 -c "import torch; print('CUDA:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')"
python3 -c "import trl; print('TRL:', trl.__version__)"
