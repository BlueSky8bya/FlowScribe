// ── 세계관 규칙 태그 ─────────────────────────────────────────

function makeRuleTag(entry) {
  const wrap  = document.getElementById("rulesWrap");
  const field = document.getElementById("rulesInput");
  const tag   = document.createElement("span");
  tag.className = entry.hard ? "tag hard" : "tag";

  const txt = document.createElement("span");
  txt.className = "tag-text";
  txt.textContent = entry.val;

  const toggle = document.createElement("span");
  toggle.className = "tag-toggle";
  toggle.title = "클릭으로 절대 금지 전환";
  toggle.textContent = entry.hard ? "🔒" : "🔓";

  const del = document.createElement("span");
  del.className = "tag-del";
  del.textContent = "×";

  txt.addEventListener("click", e => {
    e.stopPropagation();
    txt.contentEditable = "true";
    txt.focus();
    tag.classList.add("editing");
  });
  txt.addEventListener("blur", () => {
    txt.contentEditable = "false";
    tag.classList.remove("editing");
    const newVal = txt.textContent.trim();
    if (!newVal) {
      ruleEntries.splice(ruleEntries.indexOf(entry), 1);
      tag.remove();
    } else {
      entry.val = newVal;
      txt.textContent = newVal;
    }
  });
  txt.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); txt.blur(); }
    if (e.key === "Escape") { txt.textContent = entry.val; txt.blur(); }
  });
  toggle.addEventListener("click", e => {
    e.stopPropagation();
    entry.hard = !entry.hard;
    toggle.textContent = entry.hard ? "🔒" : "🔓";
    tag.className = entry.hard ? "tag hard" : "tag";
  });
  del.addEventListener("click", e => {
    e.stopPropagation();
    ruleEntries.splice(ruleEntries.indexOf(entry), 1);
    tag.remove();
  });

  tag.appendChild(txt); tag.appendChild(toggle); tag.appendChild(del);
  wrap.insertBefore(tag, field);
}

function addRuleTagDirect(val, hard, silent = false) {
  if (ruleEntries.find(e => e.val === val)) return;
  if (ruleEntries.length >= 10) {
    if (!silent) showToast("세계관 규칙은 최대 10개까지 설정할 수 있습니다.", "warn");
    return;
  }
  const entry = { val, hard };
  ruleEntries.push(entry);
  makeRuleTag(entry);
}

// 현재 규칙 슬롯 남은 수
function _remainingRuleSlots() { return Math.max(0, 10 - ruleEntries.length); }

function makeTagInput(wrapId, inputId) {
  const wrap  = document.getElementById(wrapId);
  const field = document.getElementById(inputId);

  function addTag(val) {
    val = val.trim();
    if (!val || ruleEntries.find(e => e.val === val)) return;
    if (ruleEntries.length >= 10) { showToast("세계관 규칙은 최대 10개까지 설정할 수 있습니다.", "warn"); return; }
    const entry = { val, hard: false };
    ruleEntries.push(entry);
    makeRuleTag(entry);
  }

  field.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      const v = field.value; field.value = ""; addTag(v); field.focus();
    }
  });
  wrap.addEventListener("click", () => field.focus());
}

makeTagInput("rulesWrap", "rulesInput");
