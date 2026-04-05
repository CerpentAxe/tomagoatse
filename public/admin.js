const STORAGE_KEY = "tomagoatse-admin-secret-session";

function getSecret() {
  const input = document.getElementById("admin-secret-input");
  return String(input?.value || "").trim();
}

function setError(msg) {
  const el = document.getElementById("admin-error");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTable(users) {
  const wrap = document.getElementById("admin-table-wrap");
  if (!wrap) return;

  if (!users.length) {
    wrap.innerHTML = "<p class=\"admin-empty\">No users yet.</p>";
    return;
  }

  const rows = [];
  for (const u of users) {
    const ident =
      u.username != null && String(u.username).trim()
        ? `@${escapeHtml(u.username)}`
        : u.email
          ? escapeHtml(u.email)
          : escapeHtml(u.id);
    const creatureRows = (u.creatures || [])
      .map(
        (c) => `
      <tr>
        <td><a href="/my-creature.html?id=${encodeURIComponent(c.id)}">${escapeHtml(c.display_name || c.title || "—")}</a></td>
        <td>${escapeHtml(c.title || "—")}</td>
        <td>${escapeHtml(c.town || "—")}</td>
        <td>${fmtDate(c.updated_at)}</td>
      </tr>`
      )
      .join("");

    rows.push(`
      <article class="admin-user-block">
        <h2 class="admin-user-title">${ident}</h2>
        <p class="admin-user-meta">User id: <code>${escapeHtml(u.id)}</code> · Registered ${fmtDate(u.created_at)}</p>
        ${
          u.creatures && u.creatures.length
            ? `<table class="admin-table">
          <thead>
            <tr>
              <th scope="col">Display name</th>
              <th scope="col">Title</th>
              <th scope="col">Town</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>${creatureRows}</tbody>
        </table>`
            : "<p class=\"admin-no-creatures\">No creatures saved.</p>"
        }
      </article>
    `);
  }

  wrap.innerHTML = rows.join("");
}

async function loadOverview() {
  const secret = getSecret();
  setError("");
  if (!secret) {
    setError("Enter the admin secret.");
    return;
  }

  const btn = document.getElementById("admin-load-btn");
  const refresh = document.getElementById("admin-refresh-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading…";
  }
  if (refresh) refresh.disabled = true;

  try {
    const res = await fetch("/api/admin/overview", {
      headers: {
        Authorization: `Bearer ${secret}`,
      },
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
    const meta = document.getElementById("admin-meta");
    if (meta) {
      const n = data.users?.length ?? 0;
      const totalC = (data.users || []).reduce(
        (acc, u) => acc + (u.creatures?.length || 0),
        0
      );
      meta.textContent = `${n} account(s), ${totalC} creature(s) · snapshot ${fmtDate(data.generated_at)}`;
    }
    renderTable(data.users || []);
    document.getElementById("admin-results")?.removeAttribute("hidden");
  } catch (e) {
    setError(e?.message || "Network error.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Load data";
    }
    if (refresh) refresh.disabled = false;
  }
}

function init() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const input = document.getElementById("admin-secret-input");
      if (input) input.value = saved;
    }
  } catch {
    /* ignore */
  }

  document.getElementById("admin-load-btn")?.addEventListener("click", loadOverview);
  document.getElementById("admin-refresh-btn")?.addEventListener("click", loadOverview);
}

init();
