// ── 작가 개입 (Director Mode) ────────────────────────────────

let _overrides = [];

async function loadOverrides() {
  if (!bookId) return;
  try {
    const res = await fetch(`/api/director/${bookId}`);
    if (!res.ok) return;
    const { overrides } = await res.json();
    _overrides = overrides;
    renderOverrides();
  } catch (e) { console.error(e); }
}

async function addOverride() {
  const input = document.getElementById("directorInput");
  const text = input?.value?.trim();
  if (!text || !bookId) return;
  input.value = "";
  try {
    const res = await fetch(`/api/director/${bookId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override: text }),
    });
    const { overrides } = await res.json();
    _overrides = overrides;
    renderOverrides();
    showToast("다음 화 생성 시 반영됩니다.", "info", 2000);
  } catch {
    showToast("적용 실패", "err");
  }
}

async function removeOverride(index) {
  // 해당 항목 제거 후 전체 재등록 (API 단건 삭제 없으므로 delete 후 재추가)
  const remaining = _overrides.filter((_, i) => i !== index);
  await fetch(`/api/director/${bookId}`, { method: "DELETE" });
  for (const text of remaining) {
    await fetch(`/api/director/${bookId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override: text }),
    });
  }
  _overrides = remaining;
  renderOverrides();
}

async function clearOverrides() {
  if (!bookId || !_overrides.length) return;
  await fetch(`/api/director/${bookId}`, { method: "DELETE" });
  _overrides = [];
  renderOverrides();
  showToast("작가 개입이 초기화됐습니다.", "info", 1800);
}

function renderOverrides() {
  const list   = document.getElementById("overrideList");
  const badge  = document.getElementById("directorBadge");
  const clearBtn = document.getElementById("directorClearBtn");

  if (badge) {
    badge.textContent = _overrides.length ? `${_overrides.length}개 적용 중` : "";
    badge.style.display = _overrides.length ? "inline" : "none";
  }
  if (clearBtn) clearBtn.style.display = _overrides.length ? "inline-block" : "none";
  if (!list) return;

  list.innerHTML = "";
  _overrides.forEach((text, i) => {
    const item = document.createElement("div");
    item.className = "override-item";
    item.innerHTML = `
      <span class="override-num">${i + 1}</span>
      <span class="override-text">${esc(text)}</span>
      <button class="override-del" onclick="removeOverride(${i})" title="삭제">✕</button>
    `;
    list.appendChild(item);
  });
}

// Enter 키로 적용
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("directorInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addOverride(); }
  });
});
