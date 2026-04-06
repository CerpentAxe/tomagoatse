import { slugForTownName } from "./town-slugs.js";
import { houseFromPayload } from "./house-schema.js";
import { renderHouseSvg } from "./house-render.js";

const BOOTSTRAP_CREATOR_KEY = "tomagoatse-bootstrap-creator";

const DYNAMIC_KEYS = [
  "empathy",
  "society",
  "informationProcessing",
  "decisionMaking",
  "approach",
];

const DYNAMIC_LABELS = {
  empathy: "Empathy",
  society: "Society",
  informationProcessing: "Info processing",
  decisionMaking: "Decisions",
  approach: "Approach",
};

const FIXED_LABELS = {
  energy: "Energy",
  hunger: "Hunger",
  cleanliness: "Cleanliness",
  health: "Health",
};

/** Must match server `TOWN_OPTS` / POST default rules. */
const TOWN_OPTIONS = [
  "Grimwhistle",
  "Skulldrip Hollow",
  "Spitebridge",
  "Mucksnack-on-the-Mire",
];

/** Set when the creature page has loaded (for social refresh callbacks). */
let myPageContext = { creatureId: null, town: null };

/** Custom upload overrides hatchery-generated portrait. */
function effectiveProfilePictureUrl(payload, hatchery) {
  const c = payload?.profilePictureDataUrl;
  if (c && String(c).startsWith("data:")) return String(c);
  const h = hatchery?.portraitDataUrl;
  if (h && String(h).startsWith("data:")) return String(h);
  return null;
}

function downscaleImageToDataUrl(file, maxSide = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        reject(new Error("Invalid image."));
        return;
      }
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const ctx = c.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not process image."));
        return;
      }
      ctx.drawImage(img, 0, 0, tw, th);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(u);
      reject(new Error("Could not read that file."));
    };
    img.src = u;
  });
}

async function patchProfilePicture(creatureId, profilePictureDataUrl) {
  const res = await fetch(
    `/api/creatures/${encodeURIComponent(creatureId)}/profile-picture`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profilePictureDataUrl }),
    }
  );
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

function meterRow(label, value) {
  const pct =
    typeof value === "number" && Number.isFinite(value)
      ? `${Math.round(value)}%`
      : "—";
  return `<div class="my-creature-meter"><span>${label}</span><span>${pct}</span></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStoryFromSession(session) {
  const p = session.profile || {};
  return `
      <div class="creator-ro-row"><span class="creator-ro-label">Favourite food</span><span class="creator-ro-value">${escapeHtml(session.favouriteFood || "")}</span></div>
      <div class="creator-ro-row"><span class="creator-ro-label">Biggest fear</span><span class="creator-ro-value">${escapeHtml(session.biggestFear || "")}</span></div>
      <div class="creator-ro-row"><span class="creator-ro-label">Favourite song</span><span class="creator-ro-value">${escapeHtml(p.favouriteSong || "")}</span></div>
      <div class="creator-ro-row"><span class="creator-ro-label">Place of birth</span><span class="creator-ro-value">${escapeHtml(p.placeOfBirth || "")}</span></div>
      <div class="creator-ro-row"><span class="creator-ro-label">Myers-Briggs</span><span class="creator-ro-value">${escapeHtml(p.myersBriggs || "")}</span></div>
      <div class="creator-ro-row"><span class="creator-ro-label">Silly prop</span><span class="creator-ro-value">${escapeHtml(p.sillyProp || "")}</span></div>
    `;
}

function placeholderLetter(name) {
  const t = String(name || "?").trim();
  return (t[0] || "?").toUpperCase();
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

async function sendFriendRequest(fromCreatureId, toCreatureId) {
  const res = await fetch("/api/friend-requests", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromCreatureId, toCreatureId }),
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

async function loadFriendsPanel(creatureId) {
  const panel = document.getElementById("my-friends-panel");
  const listEl = document.getElementById("friends-list");
  const emptyEl = document.getElementById("friends-empty");
  const loadingEl = document.getElementById("friends-loading");
  if (!panel || !creatureId) return;
  panel.hidden = false;
  if (loadingEl) loadingEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  if (listEl) {
    listEl.hidden = true;
    listEl.innerHTML = "";
  }
  try {
    const res = await fetch(
      `/api/creatures/${encodeURIComponent(creatureId)}/friends`,
      { credentials: "include" }
    );
    if (loadingEl) loadingEl.hidden = true;
    if (!res.ok || !listEl) return;
    const data = await res.json().catch(() => ({}));
    const friends = data.friends || [];
    if (friends.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    for (const f of friends) {
      const name = f.display_name || f.title || "Creature";
      const li = document.createElement("li");
      li.className = "my-creature-friend-item";
      const a = document.createElement("a");
      a.className = "my-creature-friend-link";
      a.href = `/portal.html?self=${encodeURIComponent(creatureId)}&peer=${encodeURIComponent(f.id)}`;
      if (f.portrait_data_url && String(f.portrait_data_url).startsWith("data:")) {
        const img = document.createElement("img");
        img.className = "my-creature-townmate-img";
        img.src = f.portrait_data_url;
        img.alt = "";
        a.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "my-creature-townmate-placeholder";
        ph.textContent = placeholderLetter(name);
        a.appendChild(ph);
      }
      const cap = document.createElement("div");
      cap.className = "my-creature-townmate-cap";
      const nm = document.createElement("span");
      nm.className = "my-creature-townmate-name";
      nm.textContent = name;
      const sub = document.createElement("span");
      sub.className = "my-creature-friend-portal-hint";
      sub.textContent = "Open portal";
      cap.appendChild(nm);
      cap.appendChild(sub);
      a.appendChild(cap);
      li.appendChild(a);
      listEl.appendChild(li);
    }
  } catch (e) {
    console.error(e);
    if (loadingEl) loadingEl.hidden = true;
  }
}

async function loadFriendRequestsPanel(creatureId) {
  const panel = document.getElementById("my-fr-panel");
  const incEl = document.getElementById("fr-incoming");
  const outEl = document.getElementById("fr-outgoing");
  if (!panel || !creatureId || !incEl || !outEl) return;
  incEl.innerHTML = "";
  outEl.innerHTML = "";
  incEl.hidden = true;
  outEl.hidden = true;
  try {
    const res = await fetch("/api/friend-requests", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const incoming = (data.incoming || []).filter(
      (x) => String(x.to_creature_id) === String(creatureId)
    );
    const outgoing = (data.outgoing || []).filter(
      (x) => String(x.from_creature_id) === String(creatureId)
    );
    const has = incoming.length > 0 || outgoing.length > 0;
    panel.hidden = !has;
    if (!has) return;

    if (incoming.length) {
      incEl.hidden = false;
      const h = document.createElement("p");
      h.className = "my-creature-fr-sub";
      h.textContent = "Incoming";
      incEl.appendChild(h);
      for (const r of incoming) {
        const row = document.createElement("div");
        row.className = "my-creature-fr-row";
        row.innerHTML = `<span class="my-creature-fr-name">${escapeHtml(r.from_display_name || "?")}</span>`;
        const actions = document.createElement("div");
        actions.className = "my-creature-fr-actions";
        const acc = document.createElement("button");
        acc.type = "button";
        acc.className = "btn-secondary my-creature-fr-btn";
        acc.textContent = "Accept";
        acc.addEventListener("click", async () => {
          acc.disabled = true;
          try {
            await patchFriendRequest(r.id, "accept");
            loadFriendRequestsPanel(creatureId);
            loadFriendsPanel(creatureId);
            loadTownmates(creatureId, myPageContext.town, true);
          } catch (e) {
            alert(e.message || "Could not accept.");
            acc.disabled = false;
          }
        });
        const dec = document.createElement("button");
        dec.type = "button";
        dec.className = "dashboard-kill-btn my-creature-fr-btn";
        dec.textContent = "Decline";
        dec.addEventListener("click", async () => {
          dec.disabled = true;
          try {
            await patchFriendRequest(r.id, "decline");
            loadFriendRequestsPanel(creatureId);
            loadTownmates(creatureId, myPageContext.town, true);
          } catch (e) {
            alert(e.message || "Could not decline.");
            dec.disabled = false;
          }
        });
        actions.appendChild(acc);
        actions.appendChild(dec);
        row.appendChild(actions);
        incEl.appendChild(row);
      }
    }

    if (outgoing.length) {
      outEl.hidden = false;
      const h = document.createElement("p");
      h.className = "my-creature-fr-sub";
      h.textContent = "Outgoing";
      outEl.appendChild(h);
      for (const r of outgoing) {
        const row = document.createElement("div");
        row.className = "my-creature-fr-row";
        const label = document.createElement("span");
        label.className = "my-creature-fr-name";
        label.textContent = `→ ${r.to_display_name || "?"}`;
        row.appendChild(label);
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn-secondary my-creature-fr-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          try {
            await patchFriendRequest(r.id, "cancel");
            loadFriendRequestsPanel(creatureId);
            loadTownmates(creatureId, myPageContext.town, true);
          } catch (e) {
            alert(e.message || "Could not cancel.");
            cancel.disabled = false;
          }
        });
        row.appendChild(cancel);
        outEl.appendChild(row);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadTownmates(creatureId, townVal, isOwner) {
  const listEl = document.getElementById("townmates-list");
  const emptyEl = document.getElementById("townmates-empty");
  const loadingEl = document.getElementById("townmates-loading");
  const townLabel = document.getElementById("townmates-town-label");
  if (!creatureId || !listEl) return;

  if (loadingEl) loadingEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  listEl.hidden = true;
  listEl.innerHTML = "";

  const tv = String(townVal || "").trim();
  const townQ = tv || TOWN_OPTIONS[0];
  const params = new URLSearchParams({
    town: townQ,
    exclude: creatureId,
  });
  if (isOwner) {
    params.set("viewerCreatureId", creatureId);
  }

  try {
    const res = await fetch(`/api/towns/mates?${params}`, {
      credentials: "include",
    });
    if (loadingEl) loadingEl.hidden = true;
    if (!res.ok) {
      if (emptyEl) {
        emptyEl.textContent = "Could not load neighbors.";
        emptyEl.hidden = false;
      }
      return;
    }
    const data = await res.json().catch(() => ({}));
    const creatures = data.creatures || [];
    if (townLabel) townLabel.textContent = data.town || "—";

    if (creatures.length === 0) {
      if (emptyEl) {
        emptyEl.textContent =
          "No one else here yet — you’re the main character.";
        emptyEl.hidden = false;
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;

    for (const c of creatures) {
      const name = c.display_name || c.title || "Creature";
      const portrait = c.portrait_data_url;
      const rel = c.friendship?.relationship || "none";
      const reqId = c.friendship?.request_id;

      const li = document.createElement("li");
      li.className = "my-creature-townmate-item";

      const row = document.createElement("div");
      row.className = "my-creature-townmate-row";

      const a = document.createElement("a");
      a.className = "my-creature-townmate-link";
      a.href = `/my-creature.html?id=${encodeURIComponent(c.id)}`;

      if (portrait && String(portrait).startsWith("data:")) {
        const img = document.createElement("img");
        img.className = "my-creature-townmate-img";
        img.src = portrait;
        img.alt = "";
        a.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "my-creature-townmate-placeholder";
        ph.setAttribute("aria-hidden", "true");
        ph.textContent = placeholderLetter(name);
        a.appendChild(ph);
      }

      const cap = document.createElement("div");
      cap.className = "my-creature-townmate-cap";
      const nm = document.createElement("span");
      nm.className = "my-creature-townmate-name";
      nm.textContent = name;
      const ow = document.createElement("span");
      ow.className = "my-creature-townmate-owner";
      ow.textContent =
        c.owner_username != null && String(c.owner_username).trim()
          ? `@${String(c.owner_username).trim()}`
          : "—";
      cap.appendChild(nm);
      cap.appendChild(ow);
      a.appendChild(cap);
      row.appendChild(a);

      if (isOwner) {
        const act = document.createElement("div");
        act.className = "my-creature-townmate-actions";
        if (rel === "friends") {
          const pbtn = document.createElement("a");
          pbtn.className = "btn-secondary my-creature-fr-btn";
          pbtn.href = `/portal.html?self=${encodeURIComponent(creatureId)}&peer=${encodeURIComponent(c.id)}`;
          pbtn.textContent = "Portal";
          act.appendChild(pbtn);
        } else if (rel === "pending_out") {
          const s = document.createElement("span");
          s.className = "my-creature-fr-pending";
          s.textContent = "Pending";
          act.appendChild(s);
        } else if (rel === "pending_in" && reqId) {
          const acc = document.createElement("button");
          acc.type = "button";
          acc.className = "btn-secondary my-creature-fr-btn";
          acc.textContent = "Accept";
          acc.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            acc.disabled = true;
            try {
              await patchFriendRequest(reqId, "accept");
              loadFriendRequestsPanel(creatureId);
              loadFriendsPanel(creatureId);
              loadTownmates(creatureId, townVal, true);
            } catch (e) {
              alert(e.message || "Could not accept.");
              acc.disabled = false;
            }
          });
          const dec = document.createElement("button");
          dec.type = "button";
          dec.className = "my-creature-fr-btn dashboard-kill-btn";
          dec.textContent = "Decline";
          dec.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            dec.disabled = true;
            try {
              await patchFriendRequest(reqId, "decline");
              loadFriendRequestsPanel(creatureId);
              loadTownmates(creatureId, townVal, true);
            } catch (e) {
              alert(e.message || "Could not decline.");
              dec.disabled = false;
            }
          });
          act.appendChild(acc);
          act.appendChild(dec);
        } else if (rel === "declined" || rel === "none") {
          const frBtn = document.createElement("button");
          frBtn.type = "button";
          frBtn.className = "btn-secondary my-creature-fr-btn";
          frBtn.textContent = "Invite";
          frBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            frBtn.disabled = true;
            try {
              await sendFriendRequest(creatureId, c.id);
              loadFriendRequestsPanel(creatureId);
              loadTownmates(creatureId, townVal, true);
            } catch (e) {
              alert(e.message || "Could not send request.");
              frBtn.disabled = false;
            }
          });
          act.appendChild(frBtn);
        }
        row.appendChild(act);
      }

      li.appendChild(row);
      listEl.appendChild(li);
    }
  } catch (e) {
    console.error(e);
    if (loadingEl) loadingEl.hidden = true;
    if (emptyEl) {
      emptyEl.textContent = "Could not load neighbors.";
      emptyEl.hidden = false;
    }
  }
}

function fillTownSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  for (const name of TOWN_OPTIONS) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    selectEl.appendChild(o);
  }
}

async function refreshHousePreview(row, isOwner) {
  const host = document.getElementById("my-house-svg-host");
  const fallback = document.getElementById("my-house-preview-fallback");
  const label = document.getElementById("my-house-town-label");
  const link = document.getElementById("my-house-preview-link");
  const editBtn = document.getElementById("my-house-edit-btn");
  const actions = document.getElementById("my-house-actions");
  if (!host || !row) return;
  const townName = row.town || TOWN_OPTIONS[0];
  if (label) label.textContent = townName;
  const slug = slugForTownName(townName);
  if (!slug) {
    if (fallback) {
      fallback.hidden = false;
    }
    host.innerHTML = "";
    return;
  }
  try {
    const res = await fetch(`/api/town-scenes/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("scene");
    const scene = await res.json();
    const house = houseFromPayload(row.payload);
    host.innerHTML = renderHouseSvg(house, scene);
    if (fallback) fallback.hidden = true;
  } catch (e) {
    console.error(e);
    if (fallback) fallback.hidden = false;
    host.innerHTML = "";
  }
  const editUrl = `/house-edit.html?id=${encodeURIComponent(row.id)}`;
  if (isOwner) {
    link.href = editUrl;
    link.classList.remove("my-house-preview-readonly");
    link.setAttribute("aria-label", "Edit house");
    if (editBtn) editBtn.href = editUrl;
    if (actions) actions.hidden = false;
  } else {
    link.removeAttribute("href");
    link.classList.add("my-house-preview-readonly");
    link.setAttribute("aria-label", "House preview");
    if (actions) actions.hidden = true;
  }
}

function wireTownTripButtons(creatureId) {
  const host = document.getElementById("my-town-trips");
  if (!host || !creatureId) return;
  host.innerHTML = "";
  for (const name of TOWN_OPTIONS) {
    const slug = slugForTownName(name);
    if (!slug) continue;
    const a = document.createElement("a");
    a.className = "btn-secondary my-town-trip-btn";
    a.href = `/town-visit.html?creature=${encodeURIComponent(creatureId)}&town=${encodeURIComponent(slug)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `Take a trip to ${name}`;
    host.appendChild(a);
  }
}

function wireTownEditor(creatureId, rowTown, onTownSaved) {
  const selectEl = document.getElementById("my-town");
  const statusEl = document.getElementById("my-town-status");
  if (!selectEl || !creatureId) return;

  fillTownSelect(selectEl);
  let lastTown = TOWN_OPTIONS.includes(rowTown) ? rowTown : TOWN_OPTIONS[0];
  selectEl.value = lastTown;

  selectEl.addEventListener("change", async () => {
    const v = selectEl.value;
    statusEl.textContent = "";
    selectEl.disabled = true;
    try {
      const patch = await fetch(
        `/api/creatures/${encodeURIComponent(creatureId)}/settings`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ town: v }),
        }
      );
      const raw = await patch.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw.slice(0, 280) };
      }
      if (!patch.ok) {
        selectEl.value = lastTown;
        statusEl.textContent =
          data.message || data.error || `Could not save (HTTP ${patch.status}).`;
        return;
      }
      lastTown = v;
      statusEl.textContent = "Saved.";
      if (typeof onTownSaved === "function") onTownSaved(v);
    } catch (e) {
      console.error(e);
      selectEl.value = lastTown;
      statusEl.textContent = "Network error — town not saved.";
    } finally {
      selectEl.disabled = false;
    }
  });
}

function renderMeters(dynEl, fixEl, session) {
  const meters = session.meters || {};
  if (dynEl) {
    dynEl.innerHTML = DYNAMIC_KEYS.map((k) =>
      meterRow(DYNAMIC_LABELS[k] || k, meters[k])
    ).join("");
  }
  const fixed = session.fixedMeters || {};
  if (fixEl) {
    fixEl.innerHTML = Object.keys(FIXED_LABELS)
      .map((k) => meterRow(FIXED_LABELS[k], fixed[k]))
      .join("");
  }
}

let myCreatureResizeTimer = null;

function prefersMobileViewport() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (
    window.matchMedia("(max-width: 768px)").matches &&
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 0
  ) {
    return true;
  }
  return false;
}

function syncMyCreatureIframeHints() {
  const m = prefersMobileViewport();
  document.querySelectorAll(".my-iframe-hint-desktop").forEach((el) => {
    el.hidden = m;
  });
  document.querySelectorAll(".my-iframe-hint-mobile").forEach((el) => {
    el.hidden = !m;
  });
}

window.addEventListener("resize", () => {
  clearTimeout(myCreatureResizeTimer);
  myCreatureResizeTimer = setTimeout(syncMyCreatureIframeHints, 150);
});
syncMyCreatureIframeHints();

async function main() {
  const loading = document.getElementById("my-loading");
  const empty = document.getElementById("my-empty");
  const errBox = document.getElementById("my-error");
  const content = document.getElementById("my-content");
  const titleEl = document.getElementById("my-title");
  const subtitleEl = document.getElementById("my-subtitle");
  const userLine = document.getElementById("my-user-line");
  const iframe = document.getElementById("creature-iframe");
  const iframeWrap = document.getElementById("my-iframe-wrap");
  const taglineEl = document.getElementById("my-tagline");
  const captionEl = document.getElementById("my-caption");
  const storyEl = document.getElementById("my-story");
  const dynEl = document.getElementById("my-meters-dynamic");
  const fixEl = document.getElementById("my-meters-fixed");
  const thumbWrap = document.getElementById("my-hatchery-thumb-wrap");
  const thumbImg = document.getElementById("my-hatchery-thumb");

  const params = new URLSearchParams(window.location.search);
  const creatureId = params.get("id");
  const fetchUrl = creatureId
    ? `/api/creatures/${creatureId}`
    : "/api/creatures/me";

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href = "/login.html?next=" + encodeURIComponent(window.location.pathname + window.location.search);
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

  const cr = await fetch(fetchUrl, { credentials: "include" });
  if (loading) loading.hidden = true;

  if (cr.status === 503) {
    const pe = errBox?.querySelector("p");
    if (pe) {
      pe.textContent =
        "Database is not configured. Set DATABASE_URL on the server.";
    }
    if (errBox) errBox.hidden = false;
    return;
  }

  let row = null;
  let isOwner = true;
  if (cr.ok) {
    row = await cr.json();
  } else if (cr.status === 404 && creatureId) {
    const pub = await fetch(
      `/api/creatures/public/${encodeURIComponent(creatureId)}`,
      { credentials: "include" }
    );
    if (pub.ok) {
      row = await pub.json();
      isOwner = row.is_owner === true;
    }
  }

  if (!row) {
    if (cr.status === 404) {
      empty.hidden = false;
      const p = empty.querySelector("p");
      if (p) {
        p.textContent = creatureId
          ? "That hatchling was not found."
          : "No saved creature yet. Use the hatchery or low-poly creator, then save or sign up.";
      }
      return;
    }
    errBox.hidden = false;
    return;
  }
  const payload = row.payload;
  const hatchery = payload?.hatchery;
  const creator = payload?.creator;

  const hasCreator =
    creator?.spec &&
    creator?.session &&
    typeof creator.spec === "object" &&
    typeof creator.session === "object";

  const hatchSession = hatchery?.careSession;
  const statsSession = hasCreator ? creator.session : hatchSession;

  if (
    !hasCreator &&
    !hatchSession &&
    !hatchery?.portraitDataUrl &&
    !payload?.profilePictureDataUrl
  ) {
    errBox.hidden = false;
    return;
  }

  const displayName =
    row.title?.trim() ||
    statsSession?.displayName?.trim() ||
    hatchery?.displayName?.trim() ||
    "Your creature";

  const viewingBanner = document.getElementById("my-viewing-banner");
  if (viewingBanner) {
    if (isOwner) {
      viewingBanner.hidden = true;
      viewingBanner.textContent = "";
    } else {
      const ou = row.owner_username
        ? `@${String(row.owner_username).trim()}`
        : "another player";
      viewingBanner.textContent = `You’re viewing ${ou}’s hatchling.`;
      viewingBanner.hidden = false;
    }
  }

  if (titleEl) titleEl.textContent = displayName;
  if (subtitleEl) {
    subtitleEl.textContent =
      statsSession?.creatureType?.trim() ||
      hatchery?.careSession?.creatureType?.trim() ||
      "";
  }

  const portraitUrl = effectiveProfilePictureUrl(payload, hatchery);
  if (portraitUrl && thumbWrap && thumbImg) {
    thumbImg.src = portraitUrl;
    thumbImg.alt = `Portrait of ${displayName}`;
    thumbWrap.hidden = false;
  } else if (thumbWrap) {
    thumbWrap.hidden = true;
  }

  if (taglineEl) {
    const t =
      (hasCreator && creator.session.tagline) ||
      hatchery?.oneLiner ||
      "";
    taglineEl.textContent = t;
    taglineEl.style.display = t ? "block" : "none";
  }
  if (captionEl) {
    const cap =
      (hasCreator && creator.session.caption) ||
      hatchery?.personalityParagraph ||
      "";
    captionEl.textContent = cap;
    captionEl.hidden = !cap;
  }

  if (storyEl && statsSession) {
    storyEl.innerHTML = renderStoryFromSession(statsSession);
  } else if (storyEl) {
    storyEl.innerHTML = "";
  }

  if (statsSession) {
    renderMeters(dynEl, fixEl, statsSession);
  }

  const townSection = document.querySelector(".my-creature-town-section");
  if (townSection) {
    townSection.hidden = !isOwner;
  }

  const mazesSection = document.getElementById("my-mazes-section");
  const mazesList = document.getElementById("my-mazes-list");
  const mazesConLink = document.getElementById("my-mazes-consciousness-link");
  if (mazesSection && mazesList && mazesConLink) {
    const mazes = Array.isArray(payload?.consciousnessMazes)
      ? payload.consciousnessMazes.filter((m) => m && m.name && m.id)
      : [];
    if (isOwner && mazes.length > 0) {
      mazesSection.hidden = false;
      mazesList.innerHTML = "";
      for (const m of mazes) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `/consciousness.html?id=${encodeURIComponent(row.id)}&maze=${encodeURIComponent(m.id)}`;
        a.textContent = m.name;
        li.appendChild(a);
        mazesList.appendChild(li);
      }
      mazesConLink.href = `/consciousness.html?id=${encodeURIComponent(row.id)}`;
    } else {
      mazesSection.hidden = true;
    }
  }

  myPageContext = { creatureId: row.id, town: row.town };

  const frAutoWrap = document.getElementById("my-fr-auto-wrap");
  const frAutoToggle = document.getElementById("my-fr-auto-toggle");
  if (isOwner && frAutoWrap && frAutoToggle) {
    frAutoWrap.hidden = false;
    frAutoToggle.checked = row.friend_requests_enabled !== false;
    frAutoToggle.setAttribute(
      "aria-checked",
      frAutoToggle.checked ? "true" : "false"
    );
    frAutoToggle.addEventListener("change", async () => {
      const enabled = frAutoToggle.checked;
      frAutoToggle.setAttribute(
        "aria-checked",
        enabled ? "true" : "false"
      );
      frAutoToggle.disabled = true;
      try {
        const res = await fetch(
          `/api/creatures/${encodeURIComponent(row.id)}/settings`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ friend_requests_enabled: enabled }),
          }
        );
        const raw = await res.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        if (!res.ok) {
          frAutoToggle.checked = !enabled;
          frAutoToggle.setAttribute(
            "aria-checked",
            frAutoToggle.checked ? "true" : "false"
          );
          alert(data.message || data.error || "Could not save setting.");
          return;
        }
        if (typeof data.friend_requests_enabled === "boolean") {
          frAutoToggle.checked = data.friend_requests_enabled;
          frAutoToggle.setAttribute(
            "aria-checked",
            data.friend_requests_enabled ? "true" : "false"
          );
        }
      } catch (e) {
        frAutoToggle.checked = !enabled;
        frAutoToggle.setAttribute(
          "aria-checked",
          frAutoToggle.checked ? "true" : "false"
        );
        alert(e?.message || "Network error.");
      } finally {
        frAutoToggle.disabled = false;
      }
    });
  } else if (frAutoWrap) {
    frAutoWrap.hidden = true;
  }

  if (isOwner) {
    loadFriendsPanel(row.id);
    loadFriendRequestsPanel(row.id);
    wireTownTripButtons(row.id);
    wireTownEditor(row.id, row.town, (newTown) => {
      row.town = newTown;
      myPageContext.town = newTown;
      refreshHousePreview(row, isOwner);
      loadTownmates(row.id, newTown, true);
      loadFriendsPanel(row.id);
      loadFriendRequestsPanel(row.id);
    });
  } else {
    document.getElementById("my-friends-panel")?.setAttribute("hidden", "");
    document.getElementById("my-fr-panel")?.setAttribute("hidden", "");
  }
  loadTownmates(row.id, row.town, isOwner);

  if (hasCreator && iframe && iframeWrap) {
    try {
      sessionStorage.setItem(
        BOOTSTRAP_CREATOR_KEY,
        JSON.stringify({
          spec: creator.spec,
          session: creator.session,
          viewerBgHex: creator.viewerBgHex || "000000",
        })
      );
    } catch (e) {
      console.error(e);
      iframeWrap.hidden = true;
    }
    iframeWrap.hidden = false;
    iframe.src = "/creator.html?embed=1";
  } else if (iframeWrap) {
    iframeWrap.hidden = true;
    if (iframe) iframe.removeAttribute("src");
  }

  refreshHousePreview(row, isOwner).catch((e) => console.error(e));

  content.hidden = false;

  const portraitControls = document.getElementById("my-portrait-controls");
  const portraitFile = document.getElementById("my-portrait-file");
  const portraitReset = document.getElementById("my-portrait-reset");
  const portraitStatus = document.getElementById("my-portrait-status");
  if (isOwner && portraitControls && portraitFile && portraitReset && thumbImg && thumbWrap) {
    portraitControls.hidden = false;
    const syncResetBtn = () => {
      portraitReset.hidden = !Boolean(payload.profilePictureDataUrl);
    };
    syncResetBtn();
    portraitFile.addEventListener("change", async () => {
      const f = portraitFile.files?.[0];
      portraitFile.value = "";
      if (!f || !String(f.type || "").startsWith("image/")) return;
      if (portraitStatus) portraitStatus.textContent = "";
      portraitFile.disabled = true;
      try {
        const dataUrl = await downscaleImageToDataUrl(f, 512);
        await patchProfilePicture(row.id, dataUrl);
        payload.profilePictureDataUrl = dataUrl;
        thumbImg.src = dataUrl;
        thumbWrap.hidden = false;
        syncResetBtn();
        if (portraitStatus) portraitStatus.textContent = "Profile picture saved.";
      } catch (e) {
        if (portraitStatus) {
          portraitStatus.textContent = e.message || "Could not upload.";
        }
      } finally {
        portraitFile.disabled = false;
      }
    });
    portraitReset.addEventListener("click", async () => {
      if (portraitStatus) portraitStatus.textContent = "";
      portraitReset.disabled = true;
      try {
        await patchProfilePicture(row.id, null);
        delete payload.profilePictureDataUrl;
        const fallback = effectiveProfilePictureUrl(payload, hatchery);
        if (fallback) {
          thumbImg.src = fallback;
          thumbWrap.hidden = false;
          if (portraitStatus) portraitStatus.textContent = "Using hatchery portrait.";
        } else {
          thumbWrap.hidden = true;
          if (portraitStatus) portraitStatus.textContent = "Picture removed.";
        }
        syncResetBtn();
      } catch (e) {
        if (portraitStatus) {
          portraitStatus.textContent = e.message || "Could not reset.";
        }
      } finally {
        portraitReset.disabled = false;
      }
    });
  } else if (portraitControls) {
    portraitControls.hidden = true;
  }

  document.getElementById("my-logout")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/";
  });
}

main().catch((e) => {
  console.error(e);
  const loading = document.getElementById("my-loading");
  const errBox = document.getElementById("my-error");
  if (loading) loading.hidden = true;
  if (errBox) errBox.hidden = false;
});
