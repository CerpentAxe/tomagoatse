const STORAGE_KEY = "tomagoatse-admin-secret-session";

function getSecret() {
  const input = document.getElementById("town-edit-secret");
  return String(input?.value || "").trim();
}

function setError(msg) {
  const el = document.getElementById("town-edit-error");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "").trim().toLowerCase();
  if (!slug) {
    setError("Missing ?slug= in the URL. Open this page from the towns list.");
    return;
  }

  const secretInput = document.getElementById("town-edit-secret");
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && secretInput) secretInput.value = saved;
  } catch {
    /* ignore */
  }

  const res = await fetch(`/api/town-scenes/${encodeURIComponent(slug)}`);
  const scene = await res.json().catch(() => ({}));
  if (!res.ok) {
    setError(scene.message || scene.error || "Could not load town.");
    return;
  }

  const titleEl = document.getElementById("town-edit-title");
  if (titleEl) titleEl.textContent = `Edit — ${scene.name || slug}`;

  const form = document.getElementById("town-edit-form");
  if (!form) return;
  form.hidden = false;

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") {
      el.checked = Boolean(v);
    } else {
      el.value = v != null ? String(v) : "";
    }
  };

  set("f-tagline", scene.tagline);
  set("f-caption", scene.caption);
  set("f-skyTop", scene.skyTop);
  set("f-skyBottom", scene.skyBottom);
  set("f-fogColor", scene.fogColor);
  set("f-ground", scene.ground);
  set("f-groundLine", scene.groundLine);
  set("f-accent", scene.accent);
  set("f-sun", scene.sun);
  set("f-sunColor", scene.sunColor);
  set("f-particle", scene.particle);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const secret = getSecret();
    const status = document.getElementById("town-edit-status");
    if (!secret) {
      if (status) status.textContent = "Enter the admin secret above.";
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, secret);
    } catch {
      /* ignore */
    }

    const body = {
      tagline: document.getElementById("f-tagline")?.value,
      caption: document.getElementById("f-caption")?.value,
      skyTop: document.getElementById("f-skyTop")?.value,
      skyBottom: document.getElementById("f-skyBottom")?.value,
      fogColor: document.getElementById("f-fogColor")?.value,
      ground: document.getElementById("f-ground")?.value,
      groundLine: document.getElementById("f-groundLine")?.value,
      accent: document.getElementById("f-accent")?.value,
      sun: document.getElementById("f-sun")?.checked,
      sunColor: document.getElementById("f-sunColor")?.value,
      particle: document.getElementById("f-particle")?.value,
    };

    const saveBtn = document.getElementById("town-edit-save");
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = "Saving…";
    setError("");

    try {
      const put = await fetch(`/api/admin/town-scenes/${encodeURIComponent(slug)}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
      });
      const data = await put.json().catch(() => ({}));
      if (!put.ok) {
        if (status) status.textContent = "";
        setError(data.message || data.error || `HTTP ${put.status}`);
        return;
      }
      if (status) status.textContent = "Saved.";
    } catch (err) {
      if (status) status.textContent = "";
      setError(err?.message || "Network error.");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

main().catch((e) => {
  console.error(e);
  setError(e?.message || "Failed to load.");
});
