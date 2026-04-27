"""
FlowScribe DPO Smoke Test  v2
==============================
Base : google/gemma-3-12b-it
Method : QLoRA (4-bit NF4) + TRL DPOTrainer 0.13.x
Data   : dpo_v3_train.jsonl, dpo_v3_val.jsonl

실행:
  python run_dpo_smoke.py               # 기본 (2 epoch)
  python run_dpo_smoke.py --epochs 1 --skip-gen --fast-eval 10  # 빠른 확인
  python run_dpo_smoke.py --dry-run    # 데이터 검증만

환경변수:
  HF_TOKEN=hf_xxxx           (필수) — gemma-3-12b-it 다운로드
  RUNPOD_API_KEY=rpa_xxxx    (선택) — 완료 후 pod 자동 종료
  RUNPOD_POD_ID=xxxx         (선택) — 종료할 pod ID (미입력 시 자동 탐지)
  TRAIN_FILE / VAL_FILE      (기본: 위 파일명)
"""

import os, sys, json, time, argparse, logging, re
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO, datefmt="%H:%M:%S",
)
log = logging.getLogger("dpo_smoke")

# ── CLI ───────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--epochs",     type=int,   default=2)
parser.add_argument("--lr",         type=float, default=5e-5)
parser.add_argument("--beta",       type=float, default=0.1)
parser.add_argument("--lora-r",     type=int,   default=16)
parser.add_argument("--batch",      type=int,   default=1)
parser.add_argument("--grad-accum", type=int,   default=16)
parser.add_argument("--max-len",    type=int,   default=1024)   # 기본값 2048→1024, VRAM 절감
parser.add_argument("--train-file", default=os.getenv("TRAIN_FILE", "dpo_v3_train.jsonl"))
parser.add_argument("--val-file",   default=os.getenv("VAL_FILE",   "dpo_v3_val.jsonl"))
parser.add_argument("--output-dir", default="./smoke_output")
parser.add_argument("--dry-run",    action="store_true")
parser.add_argument("--skip-gen",   action="store_true")
parser.add_argument("--fast-eval",  type=int,   default=0,  # 0=전체 val, N=랜덤 N쌍만 평가
                    help="val pair 평가를 N쌍으로 제한 (빠른 확인용)")
args = parser.parse_args()

HF_TOKEN        = os.getenv("HF_TOKEN", "")
RUNPOD_API_KEY  = os.getenv("RUNPOD_API_KEY", "")
RUNPOD_POD_ID   = os.getenv("RUNPOD_POD_ID", "")  # 미입력 시 API로 자동 탐지
MODEL_ID = "google/gemma-3-12b-it"
RUN_TS   = datetime.now().strftime("%Y%m%d_%H%M%S")
OUT_DIR  = Path(args.output_dir) / RUN_TS
OUT_DIR.mkdir(parents=True, exist_ok=True)

RESULTS: dict = {}
FOREIGN_RE = re.compile(r"[一-鿿぀-ゟ゠-ヿ　-〿]")

# ── 데이터 ───────────────────────────────────────────────────────────
def load_jsonl(path: str) -> list:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            rows.append({"prompt": r["prompt"], "chosen": r["chosen"], "rejected": r["rejected"]})
    return rows

log.info(f"데이터 로드: {args.train_file} / {args.val_file}")
train_raw = load_jsonl(args.train_file)
val_raw   = load_jsonl(args.val_file)

# 메타데이터 별도 보관 (generation 비교용)
val_meta = []
with open(args.val_file, encoding="utf-8") as f:
    for line in f:
        r = json.loads(line)
        val_meta.append(r.get("metadata", {}))

log.info(f"  train: {len(train_raw)}건  val: {len(val_raw)}건")

max_prompt_chars = max(len(r["prompt"]) for r in train_raw)
max_total_chars  = max(len(r["prompt"]) + len(r["chosen"]) for r in train_raw)
log.info(f"  prompt 최대 {max_prompt_chars} chars / total 최대 {max_total_chars} chars")
log.info(f"  토큰 추정: prompt max≈{max_prompt_chars//4}  total max≈{max_total_chars//4}")

RESULTS.update({"train_n": len(train_raw), "val_n": len(val_raw)})

if args.dry_run:
    log.info("--dry-run: 데이터 검증 완료, 종료")
    sys.exit(0)

if not HF_TOKEN:
    log.error("HF_TOKEN 없음 — export HF_TOKEN=hf_xxxx 후 재실행")
    sys.exit(1)

# ── 임포트 ───────────────────────────────────────────────────────────
log.info("라이브러리 로드...")
import torch
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, TaskType
from trl import DPOConfig, DPOTrainer

log.info(f"  torch {torch.__version__}  cuda={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    log.error("CUDA 없음"); sys.exit(1)
for i in range(torch.cuda.device_count()):
    p = torch.cuda.get_device_properties(i)
    log.info(f"  GPU{i}: {p.name}  {p.total_memory//1024**3}GB")

# ── 모델 ─────────────────────────────────────────────────────────────
log.info(f"모델 로드: {MODEL_ID}")

bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=HF_TOKEN)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"
# 중요: chat_template 비활성화 — 데이터가 raw text이므로 TRL이 템플릿 적용하지 않도록 함
tokenizer.chat_template = None

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb,
    device_map="auto",
    token=HF_TOKEN,
    torch_dtype=torch.bfloat16,
    attn_implementation="eager",
)
model.config.use_cache = False
model.enable_input_require_grads()  # QLoRA gradient flow 보장

for i in range(torch.cuda.device_count()):
    used  = torch.cuda.memory_allocated(i) / 1024**3
    total = torch.cuda.get_device_properties(i).total_memory / 1024**3
    log.info(f"  GPU{i} 메모리 (로드 후): {used:.1f}/{total:.0f} GB")

# ── LoRA ─────────────────────────────────────────────────────────────
lora_config = LoraConfig(
    r=args.lora_r,
    lora_alpha=args.lora_r * 2,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM,
)

# ── DPOTrainer ────────────────────────────────────────────────────────
train_ds = Dataset.from_list(train_raw)
val_ds   = Dataset.from_list(val_raw)

steps_per_epoch = max(1, len(train_raw) // (args.batch * args.grad_accum))
eval_steps      = max(3, steps_per_epoch // 3)
log.info(f"학습: epochs={args.epochs}  steps/epoch≈{steps_per_epoch}  eval_steps={eval_steps}")
log.info(f"  effective_batch={args.batch * args.grad_accum}  lr={args.lr}  beta={args.beta}")

dpo_config = DPOConfig(
    output_dir=str(OUT_DIR / "checkpoints"),
    num_train_epochs=args.epochs,
    per_device_train_batch_size=args.batch,
    gradient_accumulation_steps=args.grad_accum,
    learning_rate=args.lr,
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,
    beta=args.beta,
    max_length=args.max_len,
    max_prompt_length=1024,
    eval_strategy="epoch",       # epoch 단위 eval — steps 단위 대비 ~3회 eval 절감
    save_strategy="no",          # smoke test용: 체크포인트 저장 생략 (final_adapter만 저장)
    bf16=True,
    dataloader_num_workers=0,
    logging_steps=1,
    report_to=[],
    remove_unused_columns=False,
    load_best_model_at_end=False,
    precompute_ref_log_probs=True,  # ref model 선행 계산 후 메모리 해제 → VRAM OOM 방지 핵심
)

trainer = DPOTrainer(
    model=model,
    args=dpo_config,
    train_dataset=train_ds,
    eval_dataset=val_ds,
    processing_class=tokenizer,
    peft_config=lora_config,
)

log.info("=" * 55)
log.info("  DPO 학습 시작")
log.info("=" * 55)
t0 = time.time()
trainer.train()
elapsed = time.time() - t0
log.info(f"=== 학습 완료: {elapsed/60:.1f}분 ===")

# 어댑터 저장
adapter_dir = OUT_DIR / "final_adapter"
trainer.save_model(str(adapter_dir))
tokenizer.save_pretrained(str(adapter_dir))
log.info(f"  어댑터 저장: {adapter_dir}")

# 로그 파싱
log_history  = trainer.state.log_history
train_logs   = [l for l in log_history if "loss" in l and "eval_loss" not in l]
eval_logs    = [l for l in log_history if "eval_loss" in l]

# eval rewards/accuracies 키 탐색 (TRL 버전별 차이 대응)
def find_reward_acc(d: dict) -> float | None:
    for k in ("eval_rewards/accuracies", "eval_rewards_accuracies",
              "eval_reward/accuracies", "rewards/accuracies"):
        if k in d:
            return d[k]
    return None

RESULTS["train_time_min"]   = round(elapsed / 60, 1)
RESULTS["train_loss_final"] = train_logs[-1].get("loss")   if train_logs else None
RESULTS["eval_loss_final"]  = eval_logs[-1].get("eval_loss") if eval_logs else None
RESULTS["eval_reward_acc"]  = find_reward_acc(eval_logs[-1]) if eval_logs else None
RESULTS["train_loss_start"] = train_logs[0].get("loss")    if train_logs else None

log.info(f"  train_loss: {RESULTS['train_loss_start']} → {RESULTS['train_loss_final']}")
log.info(f"  eval_loss:  {RESULTS['eval_loss_final']}")
log.info(f"  eval_reward_acc (TRL): {RESULTS['eval_reward_acc']}")

# 과적합 감지
if train_logs and eval_logs:
    # 마지막 eval step에 가장 가까운 train loss 찾기
    last_eval_step = eval_logs[-1].get("step", 9999)
    nearest_train  = min(train_logs, key=lambda l: abs(l.get("step", 0) - last_eval_step))
    gap = (eval_logs[-1].get("eval_loss", 0) or 0) - (nearest_train.get("loss", 0) or 0)
    RESULTS["overfit_gap"] = round(gap, 4)
    if gap > 0.15:
        log.warning(f"⚠  과적합 의심: gap={gap:.3f} (> 0.15)")
    else:
        log.info(f"  loss gap={gap:.3f} ✓")

with open(OUT_DIR / "train_log.json", "w", encoding="utf-8") as f:
    json.dump({"train": train_logs, "eval": eval_logs,
               "hyperparams": vars(args), "model": MODEL_ID}, f, ensure_ascii=False, indent=2)

# ── val pair-level 평가 ───────────────────────────────────────────────
log.info("=" * 55)
log.info("  val pair-level 평가")
log.info("=" * 55)

def compute_response_logprob(mdl, tok, prompt: str, response: str) -> float:
    """response 부분의 평균 log-probability"""
    dev = next(mdl.parameters()).device
    full_text = prompt + response

    enc_full   = tok(full_text, return_tensors="pt",
                     truncation=True, max_length=2048).to(dev)
    enc_prompt = tok(prompt,    return_tensors="pt",
                     truncation=True, max_length=1024).to(dev)
    p_len = enc_prompt.input_ids.shape[1]

    with torch.no_grad():
        logits = mdl(**enc_full).logits  # [1, seq, vocab]

    # 언어모델 shift: logits[i] → token[i+1] 예측
    # labels = tokens[1:]  (길이 seq-1)
    # response 토큰은 tokens[p_len:], 즉 labels[p_len-1:] 에 대응
    labels = enc_full.input_ids[0, 1:]              # [seq-1]
    lp     = torch.log_softmax(logits[0, :-1], dim=-1)  # [seq-1, vocab]

    r_labels = labels[p_len - 1:]                    # response labels
    if r_labels.numel() == 0:
        return float("nan")

    gathered = lp[p_len - 1:].gather(1, r_labels.unsqueeze(-1)).squeeze(-1)
    return gathered.mean().item()

model.eval()
correct, errors = 0, 0
pair_details = []

# --fast-eval N: 랜덤 N쌍만 평가 (시간 절감용)
import random as _random
_eval_pairs = list(zip(val_raw, val_meta))
if args.fast_eval > 0 and args.fast_eval < len(_eval_pairs):
    _random.seed(42)
    _eval_pairs = _random.sample(_eval_pairs, args.fast_eval)
    log.info(f"  --fast-eval: {args.fast_eval}/{len(val_raw)}쌍만 평가")

for i, (row, meta) in enumerate(_eval_pairs):
    try:
        lp_c = compute_response_logprob(model, tokenizer, row["prompt"], row["chosen"])
        lp_r = compute_response_logprob(model, tokenizer, row["prompt"], row["rejected"])
        win  = bool(lp_c > lp_r)
        if win: correct += 1
        pair_details.append({
            "idx": i, "scenario": meta.get("scenario"),
            "score_delta": meta.get("score_delta"),
            "lp_chosen": round(lp_c, 4), "lp_rejected": round(lp_r, 4),
            "correct": win,
        })
        if i < 3:
            log.info(f"  pair[{i}] lp_c={lp_c:.4f} lp_r={lp_r:.4f} win={win}")
    except Exception as e:
        log.warning(f"  pair[{i}] 오류: {e}")
        errors += 1

valid_n   = len(val_raw) - errors
pair_acc  = correct / max(1, valid_n)
RESULTS["val_pair_accuracy"] = round(pair_acc, 4)
RESULTS["val_correct"]       = correct
RESULTS["val_errors"]        = errors
log.info(f"  DPO pair accuracy: {correct}/{valid_n} = {pair_acc:.1%}")

# 시나리오별 분해
from collections import defaultdict
sc_stats = defaultdict(lambda: {"correct": 0, "total": 0})
for d in pair_details:
    sc = d.get("scenario") or "unknown"
    sc_stats[sc]["total"] += 1
    if d.get("correct"):
        sc_stats[sc]["correct"] += 1

RESULTS["pair_by_scenario"] = {
    sc: {"acc": round(v["correct"] / max(1, v["total"]), 3), **v}
    for sc, v in sc_stats.items()
}
for sc, v in RESULTS["pair_by_scenario"].items():
    log.info(f"  scenario={sc}: {v['correct']}/{v['total']} = {v['acc']:.1%}")

# known-only accuracy — unknown 시나리오 제외 (배포 데이터 분포와 다름, 해석 왜곡 방지)
known_pairs = [d for d in pair_details if (d.get("scenario") or "unknown") != "unknown"]
if known_pairs:
    known_correct = sum(1 for d in known_pairs if d.get("correct"))
    known_acc = known_correct / len(known_pairs)
    RESULTS["val_pair_accuracy_known_only"] = round(known_acc, 4)
    RESULTS["val_known_n"] = len(known_pairs)
    log.info(f"  known-only accuracy (참고): {known_correct}/{len(known_pairs)} = {known_acc:.1%}  [unknown 시나리오 {len(pair_details)-len(known_pairs)}쌍 제외]")
else:
    RESULTS["val_pair_accuracy_known_only"] = None
    log.info("  known-only accuracy: N/A (known 시나리오 쌍 없음)")

# ── generation 비교 ───────────────────────────────────────────────────
if not args.skip_gen:
    log.info("=" * 55)
    log.info("  generation 비교 (DPO fine-tuned)")
    log.info("=" * 55)

    # scenario별 1개씩 5개 선택
    import random
    random.seed(42)
    seen_sc = set()
    gen_samples = []
    for row, meta in zip(val_raw, val_meta):
        sc = meta.get("scenario", "unknown")
        if sc not in seen_sc and len(gen_samples) < 5:
            gen_samples.append((row, meta)); seen_sc.add(sc)
    while len(gen_samples) < 5 and len(gen_samples) < len(val_raw):
        idx = random.randint(0, len(val_raw)-1)
        gen_samples.append((val_raw[idx], val_meta[idx]))

    GEN_KW = dict(max_new_tokens=400, do_sample=True, temperature=0.7,  # 400으로 절반 절감
                  top_p=0.9, pad_token_id=tokenizer.eos_token_id)

    def is_truncated(text: str) -> bool:
        if not text or len(text) < 50: return True
        t = text.strip()
        if "[END]" in t[-12:] or "[CLIFF]" in t[-15:]: return False
        return t[-1] not in list(".!?。！？\"'…」』")

    gen_results = []
    device = next(model.parameters()).device

    for idx, (row, meta) in enumerate(gen_samples):
        sc  = meta.get("scenario", "?")
        ep  = meta.get("episode", "?")
        log.info(f"  생성 {idx+1}/5: scenario={sc} ep={ep}")

        inp = tokenizer(row["prompt"], return_tensors="pt",
                        truncation=True, max_length=1024).to(device)
        with torch.no_grad():
            out_ids = model.generate(**inp, **GEN_KW)
        generated = tokenizer.decode(
            out_ids[0][inp.input_ids.shape[1]:], skip_special_tokens=True)

        trunc   = is_truncated(generated)
        foreign = bool(FOREIGN_RE.search(generated))
        log.info(f"    len={len(generated)}  truncated={trunc}  foreign={foreign}")
        log.info(f"    DPO 미리보기: {generated[:120]!r}")

        gen_results.append({
            "idx": idx, "scenario": sc, "episode": ep,
            "chosen_len":    len(row["chosen"]),
            "generated_len": len(generated),
            "truncated":     trunc,
            "foreign_chars": foreign,
            "chosen_preview":    row["chosen"][:200],
            "generated_preview": generated[:200],
        })

    RESULTS["gen_truncated_rate"] = round(
        sum(1 for g in gen_results if g["truncated"]) / max(1, len(gen_results)), 3)
    RESULTS["gen_foreign_rate"] = round(
        sum(1 for g in gen_results if g["foreign_chars"]) / max(1, len(gen_results)), 3)

    with open(OUT_DIR / "generation_comparison.json", "w", encoding="utf-8") as f:
        json.dump(gen_results, f, ensure_ascii=False, indent=2)
    log.info(f"  generation 결과 저장 → {OUT_DIR / 'generation_comparison.json'}")

# ── 최종 결과 저장 ────────────────────────────────────────────────────
RESULTS.update({
    "run_ts": RUN_TS, "model": MODEL_ID,
    "lora_r": args.lora_r, "epochs": args.epochs,
    "lr": args.lr, "beta": args.beta,
    "effective_batch": args.batch * args.grad_accum,
    "pair_details": pair_details,
})

# 자동 판정
val_acc = RESULTS.get("val_pair_accuracy") or 0
gap     = abs(RESULTS.get("overfit_gap") or 0)
trunc   = RESULTS.get("gen_truncated_rate") or 0
foreign = RESULTS.get("gen_foreign_rate") or 0

ok_acc     = val_acc >= 0.55
ok_gap     = gap     <= 0.15
ok_trunc   = trunc   <= 0.10
ok_foreign = foreign == 0.0

score = sum([ok_acc, ok_gap, ok_trunc, ok_foreign])
if score == 4:   verdict = "SUCCESS"
elif score >= 2: verdict = "PARTIAL"
else:            verdict = "FAIL"

RESULTS["verdict"]      = verdict
RESULTS["verdict_detail"] = {
    "val_pair_acc≥55%": ok_acc,
    "overfit_gap≤0.15": ok_gap,
    "gen_trunc≤10%":    ok_trunc,
    "gen_foreign=0%":   ok_foreign,
}

with open(OUT_DIR / "smoke_results.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=2)

# ── 콘솔 요약 ─────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("  FlowScribe DPO SMOKE TEST 결과")
print("=" * 60)
print(f"  학습 시간           : {RESULTS.get('train_time_min')}분")
print(f"  train_loss          : {RESULTS.get('train_loss_start')} → {RESULTS.get('train_loss_final')}")
print(f"  eval_loss (최종)    : {RESULTS.get('eval_loss_final')}")
print(f"  val reward_acc(TRL) : {RESULTS.get('eval_reward_acc')}")
print(f"  val pair_acc (직접) : {RESULTS.get('val_pair_accuracy')} ({correct}/{valid_n})")
  known_acc_val = RESULTS.get("val_pair_accuracy_known_only")
  known_n_val   = RESULTS.get("val_known_n", 0)
  print(f"  known-only pair_acc : {known_acc_val} (n={known_n_val})  [참고 — unknown 제외]")
print(f"  overfit gap         : {RESULTS.get('overfit_gap')}")
print(f"  gen truncated       : {RESULTS.get('gen_truncated_rate')}")
print(f"  gen foreign         : {RESULTS.get('gen_foreign_rate')}")
print(f"  판정 상세           : {RESULTS['verdict_detail']}")
print(f"\n  ★ 최종 판정: {verdict}")
print("-" * 60)
if verdict == "SUCCESS":
    print("  → DPO 효과 확인. 추가 pair 수집 후 본격 학습 권장.")
elif verdict == "PARTIAL":
    print("  → 부분 개선. fantasy 편향 완화 또는 epoch 조정 후 재실험.")
else:
    print("  → 개선 없음. 데이터/하이퍼파라미터/teacher 전략 재검토.")
print(f"\n  결과: {OUT_DIR / 'smoke_results.json'}")
print("=" * 60)

# ── Runpod pod 자동 종료 ──────────────────────────────────────────────
# RUNPOD_API_KEY + RUNPOD_AUTO_TERMINATE=1 환경변수가 설정되어 있으면 자동 종료
# run_dpo_smoke.py는 마지막 단계이므로 force=True로 호출 (AUTO_TERMINATE 변수 없어도 종료)
try:
    from runpod_utils import terminate_pod_if_configured
    terminate_pod_if_configured(force=True)
except ImportError:
    pass  # runpod_utils.py가 없는 환경(로컬 테스트 등)에서는 무시

