"""
baseline_eval.py — DPO 학습 전 baseline 측정
(학습 전 실행 → 학습 후 run_dpo_smoke.py 결과와 비교)

실행: python baseline_eval.py [--val-file dpo_v3_val.jsonl]
"""

import os
import sys
import json
import time
import argparse
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO, datefmt="%H:%M:%S")
log = logging.getLogger("baseline")

parser = argparse.ArgumentParser()
parser.add_argument("--val-file",   default=os.getenv("VAL_FILE", "dpo_v3_val.jsonl"))
parser.add_argument("--output-dir", default="./smoke_output/baseline")
parser.add_argument("--max-len",    type=int, default=1024,
                    help="토크나이저 최대 길이 (run_dpo_smoke.py와 동일값 사용 권장)")
args = parser.parse_args()

HF_TOKEN = os.getenv("HF_TOKEN", "")
MODEL_ID = "google/gemma-3-12b-it"
OUT_DIR  = Path(args.output_dir)
OUT_DIR.mkdir(parents=True, exist_ok=True)

log.info("라이브러리 로드...")
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=HF_TOKEN)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"
tokenizer.chat_template = None  # raw text 데이터 — chat template 적용 금지

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID, quantization_config=bnb_config, device_map="auto",
    token=HF_TOKEN, torch_dtype=torch.bfloat16, attn_implementation="eager",
)
model.config.use_cache = False
model.eval()
device = next(model.parameters()).device
log.info(f"  모델 로드 완료 (device={device})")

val_raw = []
with open(args.val_file, encoding="utf-8") as f:
    for line in f:
        val_raw.append(json.loads(line))

log.info(f"  val: {len(val_raw)}건")

def compute_logprobs(model, tokenizer, prompt, response):
    full = prompt + response
    enc_full   = tokenizer(full,   return_tensors="pt", truncation=True, max_length=args.max_len * 2).to(device)
    enc_prompt = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=args.max_len).to(device)
    prompt_len = enc_prompt.input_ids.shape[1]
    with torch.no_grad():
        out = model(**enc_full, labels=enc_full.input_ids)
        logits = out.logits
    labels = enc_full.input_ids[0][1:]
    lp = torch.log_softmax(logits[0, :-1], dim=-1)
    if prompt_len - 1 >= len(labels):
        return float("nan")
    gathered = lp[prompt_len-1:].gather(1, labels[prompt_len-1:].unsqueeze(-1)).squeeze(-1)
    return gathered.mean().item()

log.info("=== baseline pair 평가 ===")
correct, nan_count = 0, 0
pair_details = []
for i, row in enumerate(val_raw):
    try:
        lp_c = compute_logprobs(model, tokenizer, row["prompt"], row["chosen"])
        lp_r = compute_logprobs(model, tokenizer, row["prompt"], row["rejected"])
        win = lp_c > lp_r
        if win: correct += 1
        pair_details.append({
            "idx": i, "lp_chosen": round(lp_c, 4), "lp_rejected": round(lp_r, 4), "correct": win,
            "scenario": row.get("metadata", {}).get("scenario"),
            "delta": row.get("metadata", {}).get("score_delta"),
        })
    except Exception as e:
        log.warning(f"  [{i}] 오류: {e}")
        nan_count += 1

pair_acc = correct / max(1, len(val_raw) - nan_count)
log.info(f"  baseline pair acc: {correct}/{len(val_raw)} = {pair_acc:.1%}")

# generation 5개 샘플
log.info("=== baseline generation ===")
import random, re
random.seed(42)
samples = []
seen = set()
for r in val_raw:
    sc = r.get("metadata", {}).get("scenario", "unknown")
    if sc not in seen and len(samples) < 5:
        samples.append(r); seen.add(sc)

gen_results = []
GEN_KWARGS = dict(max_new_tokens=400, do_sample=True, temperature=0.7, top_p=0.9, pad_token_id=tokenizer.eos_token_id)  # run_dpo_smoke.py와 동일값 유지 — truncation 비교 공정성
FOREIGN_RE = re.compile(r"[一-鿿぀-ゟ゠-ヿ　-〿]")

for idx, s in enumerate(samples):
    sc = s.get("metadata", {}).get("scenario", "?")
    log.info(f"  생성 {idx+1}/5: scenario={sc}")
    inp = tokenizer(s["prompt"], return_tensors="pt", truncation=True, max_length=args.max_len).to(device)
    with torch.no_grad():
        out_ids = model.generate(**inp, **GEN_KWARGS)
    gen = tokenizer.decode(out_ids[0][inp.input_ids.shape[1]:], skip_special_tokens=True)
    t = gen.strip()
    truncated = bool(t) and t[-1] not in list(".!?。！？\"'…」』") and "[END]" not in t[-10:] and "[CLIFF]" not in t[-15:]
    gen_results.append({
        "idx": idx, "scenario": sc,
        "generated_len": len(gen), "truncated": truncated,
        "foreign_chars": bool(FOREIGN_RE.search(gen)),
        "preview": gen[:200],
    })
    log.info(f"    len={len(gen)} truncated={truncated} foreign={bool(FOREIGN_RE.search(gen))}")

results = {
    "model": MODEL_ID, "run_ts": datetime.now().isoformat(),
    "val_n": len(val_raw),
    "baseline_pair_acc": round(pair_acc, 4),
    "baseline_correct": correct,
    "pair_details": pair_details,
    "gen_truncated_rate": sum(1 for g in gen_results if g["truncated"]) / max(1, len(gen_results)),
    "gen_foreign_rate":   sum(1 for g in gen_results if g["foreign_chars"]) / max(1, len(gen_results)),
    "gen_results": gen_results,
}

with open(OUT_DIR / "baseline_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\n=== BASELINE 결과 ===")
print(f"  pair accuracy: {pair_acc:.1%}  ({correct}/{len(val_raw)})")
print(f"  gen truncated: {results['gen_truncated_rate']:.1%}")
print(f"  gen foreign:   {results['gen_foreign_rate']:.1%}")
print(f"  저장: {OUT_DIR / 'baseline_results.json'}")
