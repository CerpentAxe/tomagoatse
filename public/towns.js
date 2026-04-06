const STORAGE_KEY = "tomagoatse-admin-secret-session";

function getSecret() {
  const input = document.getElementById("towns-secret-input");
  return String(input?.value || "").trim();
}

function setError(msg) {
  const el = document.getElementById("towns-error");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadTowns() {
  const secret = getSecret();
  setError("");
  if (!secret) {
    setError("Enter the admin secret.");
    return;
  }

  const btn = document.getElementById("towns-load-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading…";
  }

  try {
    const res = await fetch("/api/admin/town-scenes", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || data.error || `HTTP ${res.status}`);
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, secret);
    } catch {
      /* ignore */
    }

    const ul = document.getElementById("towns-list");
    const results = document.getElementById("towns-results");
    if (!ul || !results) return;
    ul.innerHTML = "";
    for (const t of data.towns || []) {
      const li = document.createElement("li");
      li.className = "towns-admin-item";
      const a = document.createElement("a");
      a.href = `/town-edit.html?slug=${encodeURIComponent(t.slug)}`;
      a.textContent = `Edit ${t.name}`;
      const span = document.createElement("span");
      span.className = "towns-admin-tagline";
      span.textContent = t.tagline || "";
      li.appendChild(a);
      li.appendChild(span);
      ul.appendChild(li);
    }
    results.hidden = false;
  } catch (e) {
    setError(e?.message || "Network error.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Load towns";
    }
  }
}

function init() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const input = document.getElementById("towns-secret-input");
      if (input) input.value = saved;
    }
  } catch {
    /* ignore */
  }
  document.getElementById("towns-load-btn")?.addEventListener("click", loadTowns);
}

init();
