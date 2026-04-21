"""
FlowScribe 로컬 LLM 서버
모델: unsloth/gemma-4-E4B-it (GGUF 양자화)

사전 설치:
  $env:CMAKE_ARGS="-DGGML_CUDA=on"
  pip install llama-cpp-python openai uvicorn

GGUF 파일 다운로드 (Hugging Face):
  unsloth/gemma-4-E4B-it-GGUF 에서 gemma-4-E4B-it-Q4_K_M.gguf 다운로드

실행:
  python llm_server.py
  → http://localhost:8000/v1 (OpenAI 호환 엔드포인트)
"""

import os
from llama_cpp import Llama
from llama_cpp.server.app import create_app
import uvicorn

MODEL_PATH = os.environ.get("MODEL_PATH", "./gemma-4-E4B-it-Q4_K_M.gguf")
HOST = os.environ.get("LLM_HOST", "0.0.0.0")
PORT = int(os.environ.get("LLM_PORT", "8000"))

# n_gpu_layers=-1 : 모든 레이어를 VRAM에 올림 (CUDA 필요)
# n_gpu_layers=0  : CPU 전용
llm = Llama(
    model_path=MODEL_PATH,
    n_gpu_layers=-1,
    n_ctx=8192,
    chat_format="gemma",
)

if __name__ == "__main__":
    app = create_app(llm)
    print(f"LLM server running → http://{HOST}:{PORT}/v1")
    uvicorn.run(app, host=HOST, port=PORT)
