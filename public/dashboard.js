const loadingEl = document.getElementById("dashboard-loading");
const emptyEl = document.getElementById("dashboard-empty");
const errorEl = document.getElementById("dashboard-error");
const gridEl = document.getElementById("dashboard-grid");
const userLine = document.getElementById("dashboard-user-line");

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function placeholderLetter(name) {
  const t = String(name || "?").trim();
  return (t[0] || "?").toUpperCase();
}

let cachedFrIncoming = [];
let cachedFrOutgoing = [];

async function loadFriendRequestsCache() {
  const frRes = await fetch("/api/friend-requests", { credentials: "include" });
  if (!frRes.ok) return false;
  const frData = await frRes.json().catch(() => ({}));
  cachedFrIncoming = frData.incoming || [];
  cachedFrOutgoing = frData.outgoing || [];
  return true;
}

async function patchFriendRequest(requestId, action) {
  const res = await fetch(`/api/friend-requests/${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

function fillDashboardFrBox(frEl, creatureId) {
  frEl.innerHTML = "";
  const inc = cachedFrIncoming.filter(
    (x) => String(x.to_creature_id) === String(creatureId)
  );
  const out = cachedFrOutgoing.filter(
    (x) => String(x.from_creature_id) === String(creatureId)
  );
  if (inc.length === 0 && out.length === 0) {
    frEl.hidden = true;
    return;
  }
  frEl.hidden = false;
  const head = document.createElement("p");
  head.className = "dashboard-fr-heading";
  head.textContent = "Friend requests";
  frEl.appendChild(head);

  for (const r of inc) {
    const row = document.createElement("div");
    row.className = "dashboard-fr-row";
    const label = document.createElement("span");
    label.className = "dashboard-fr-label";
    label.textContent = `From ${r.from_display_name || "?"}`;
    const actions = document.createElement("div");
    actions.className = "dashboard-fr-actions";
    const acc = document.createElement("button");
    acc.type = "button";
    acc.className = "btn-secondary dashboard-fr-btn";
    acc.textContent = "Accept";
    acc.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      acc.disabled = true;
      try {
        await patchFriendRequest(r.id, "accept");
        await loadFriendRequestsCache();
        document.querySelectorAll(".dashboard-card-fr").forEach((box) => {
          fillDashboardFrBox(box, box.dataset.creatureId);
        });
      } catch (e) {
        alert(e.message || "Could not accept.");
        acc.disabled = false;
      }
    });
    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "dashboard-kill-btn dashboard-fr-btn";
    dec.textContent = "Decline";
    dec.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dec.disabled = true;
      try {
        await patchFriendRequest(r.id, "decline");
        await loadFriendRequestsCache();
        document.querySelectorAll(".dashboard-card-fr").forEach((box) => {
          fillDashboardFrBox(box, box.dataset.creatureId);
        });
      } catch (e) {
        alert(e.message || "Could not decline.");
        dec.disabled = false;
      }
    });
    actions.appendChild(acc);
    actions.appendChild(dec);
    row.appendChild(label);
    row.appendChild(actions);
    frEl.appendChild(row);
  }

  for (const r of out) {
    const row = document.createElement("div");
    row.className = "dashboard-fr-row";
    const label = document.createElement("span");
    label.className = "dashboard-fr-label";
    label.textContent = `To ${r.to_display_name || "?"}`;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary dashboard-fr-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cancel.disabled = true;
      try {
        await patchFriendRequest(r.id, "cancel");
        await loadFriendRequestsCache();
        document.querySelectorAll(".dashboard-card-fr").forEach((box) => {
          fillDashboardFrBox(box, box.dataset.creatureId);
        });
      } catch (e) {
        alert(e.message || "Could not cancel.");
        cancel.disabled = false;
      }
    });
    row.appendChild(label);
    row.appendChild(cancel);
    frEl.appendChild(row);
  }
}

async function main() {
  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href = "/login.html?next=/dashboard.html";
    return;
  }
  const u = await me.json().catch(() => ({}));
  if (userLine && u.user) {
    userLine.textContent = u.user.username
      ? `Signed in as @${u.user.username}`
      : u.user.email
        ? `Signed in as ${u.user.email}`
        : "Signed in";
  }

  const res = await fetch("/api/creatures", { credentials: "include" });
  if (loadingEl) loadingEl.hidden = true;

  if (res.status === 503) {
    showError("Database is not configured on the server.");
    return;
  }
  if (!res.ok) {
    showError("Could not load your creatures.");
    return;
  }

  const data = await res.json().catch(() => ({}));
  const creatures = data.creatures || [];

  if (creatures.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  await loadFriendRequestsCache();

  gridEl.hidden = false;
  gridEl.innerHTML = "";

  function refreshEmptyState() {
    const items = gridEl.querySelectorAll("li.dashboard-card-wrap");
    if (items.length === 0) {
      gridEl.hidden = true;
      emptyEl.hidden = false;
    }
  }

  for (const c of creatures) {
    const name = c.display_name || c.title || "Creature";
    const li = document.createElement("li");
    li.className = "dashboard-card-wrap";

    const a = document.createElement("a");
    a.className = "dashboard-card";
    a.href = `/my-creature.html?id=${encodeURIComponent(c.id)}`;

    const portrait = String(c.portrait_data_url || "").trim();
    if (portrait.startsWith("data:")) {
      const img = document.createElement("img");
      img.className = "dashboard-card-img";
      img.src = portrait;
      img.alt = "";
      a.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "dashboard-card-placeholder";
      ph.setAttribute("aria-hidden", "true");
      ph.textContent = placeholderLetter(name);
      a.appendChild(ph);
    }

    const cap = document.createElement("div");
    cap.className = "dashboard-card-caption";
    const h2 = document.createElement("h2");
    h2.className = "dashboard-card-name";
    h2.textContent = name;
    cap.appendChild(h2);
    const meta = document.createElement("p");
    meta.className = "dashboard-card-meta";
    try {
      const d = new Date(c.updated_at);
      meta.textContent = `Updated ${d.toLocaleString()}`;
    } catch {
      meta.textContent = "";
    }
    cap.appendChild(meta);

    a.appendChild(cap);

    const hoverLayer = document.createElement("div");
    hoverLayer.className = "dashboard-card-hover-layer";
    hoverLayer.setAttribute("role", "presentation");

    const visitUrl = `/my-creature.html?id=${encodeURIComponent(c.id)}`;
    const visitLink = document.createElement("a");
    visitLink.className = "dashboard-visit-btn";
    visitLink.href = visitUrl;
    visitLink.textContent = "Visit my child";
    visitLink.setAttribute("aria-label", `Open ${name}’s page`);

    const killBtn = document.createElement("button");
    killBtn.type = "button";
    killBtn.className = "dashboard-kill-btn";
    killBtn.textContent = "Kill my child";
    killBtn.setAttribute(
      "aria-label",
      `Remove ${name} from your collection permanently`
    );

    killBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const ok = window.confirm(
        `Remove “${name}” from your collection forever? This cannot be undone.`
      );
      if (!ok) return;
      killBtn.disabled = true;
      try {
        const del = await fetch(
          `/api/creatures/${encodeURIComponent(c.id)}`,
          { method: "DELETE", credentials: "include" }
        );
        const raw = await del.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = { message: raw.slice(0, 280) };
        }
        if (!del.ok) {
          alert(
            data.message ||
              data.error ||
              `Could not delete (HTTP ${del.status}).`
          );
          killBtn.disabled = false;
          return;
        }
        li.remove();
        refreshEmptyState();
      } catch (e) {
        console.error(e);
        alert("Network error — could not delete.");
        killBtn.disabled = false;
      }
    });

    hoverLayer.appendChild(visitLink);
    hoverLayer.appendChild(killBtn);

    const stack = document.createElement("div");
    stack.className = "dashboard-card-stack";
    stack.appendChild(a);
    stack.appendChild(hoverLayer);
    li.appendChild(stack);

    const frBox = document.createElement("div");
    frBox.className = "dashboard-card-fr";
    frBox.dataset.creatureId = c.id;
    fillDashboardFrBox(frBox, c.id);
    li.appendChild(frBox);

    gridEl.appendChild(li);
  }

  document.getElementById("dashboard-logout")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  });
}

main().catch((e) => {
  console.error(e);
  if (loadingEl) loadingEl.hidden = true;
  showError("Something went wrong.");
});
