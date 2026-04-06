function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayNameFromCreatureRow(row) {
  if (!row || !row.payload) return row?.title || "Creature";
  const h = row.payload.hatchery;
  const c = row.payload.creator;
  const fromH =
    h && String(h.displayName || "").trim()
      ? String(h.displayName).trim()
      : "";
  const fromC =
    c && c.session && String(c.session.displayName || "").trim()
      ? String(c.session.displayName).trim()
      : "";
  return fromH || fromC || row.title || "Creature";
}

/** @type {{ parent_blocked?: boolean, continue_available_at?: string | null, can_continue?: boolean }} */
let portalState = {
  parent_blocked: false,
  continue_available_at: null,
  can_continue: false,
};

/** Last fetched thread (for typing indicator without threading through every call). */
let cachedMessages = [];

async function main() {
  const loadingEl = document.getElementById("portal-loading");
  const errEl = document.getElementById("portal-error");
  const contentEl = document.getElementById("portal-content");
  const threadEl = document.getElementById("portal-thread");
  const formEl = document.getElementById("portal-form");
  const inputEl = document.getElementById("portal-input");
  const sendBtn = document.getElementById("portal-send");
  const titleEl = document.getElementById("portal-title");
  const subEl = document.getElementById("portal-sub");
  const creatureLinkEl = document.getElementById("portal-creature-link");
  const parentNoteEl = document.getElementById("portal-parent-note");
  const statusEl = document.getElementById("portal-status");
  const continueWrap = document.getElementById("portal-continue-wrap");
  const continueBtn = document.getElementById("portal-continue-btn");
  const continueHint = document.getElementById("portal-continue-hint");
  const unblockWrap = document.getElementById("portal-unblock-wrap");
  const unblockBtn = document.getElementById("portal-unblock-btn");
  const typingOverlay = document.getElementById("portal-typing-overlay");
  const typingLabelEl = document.getElementById("portal-typing-label");

  const params = new URLSearchParams(window.location.search);
  const selfId = params.get("self");
  const peerId = params.get("peer");
  if (params.get("popup") === "1") {
    document.body.classList.add("portal-shell--popup");
  }
  if (!selfId || !peerId) {
    if (loadingEl) loadingEl.hidden = true;
    if (errEl) {
      errEl.textContent = "Missing self or peer in the URL.";
      errEl.hidden = false;
    }
    return;
  }

  if (creatureLinkEl) {
    creatureLinkEl.href = `/my-creature.html?id=${encodeURIComponent(selfId)}`;
  }

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href =
      "/login.html?next=" + encodeURIComponent(window.location.pathname + window.location.search);
    return;
  }

  let selfName = "You";
  let peerName = "Friend";
  try {
    const [selfRes, peerRes] = await Promise.all([
      fetch(`/api/creatures/${encodeURIComponent(selfId)}`, { credentials: "include" }),
      fetch(`/api/creatures/public/${encodeURIComponent(peerId)}`, {
        credentials: "include",
      }),
    ]);
    if (selfRes.ok) {
      const sj = await selfRes.json().catch(() => ({}));
      selfName = displayNameFromCreatureRow(sj);
    }
    if (peerRes.ok) {
      const pj = await peerRes.json().catch(() => ({}));
      peerName = displayNameFromCreatureRow(pj);
    }
  } catch {
    /* use defaults */
  }

  if (titleEl) titleEl.textContent = `${selfName} ↔ ${peerName}`;
  if (subEl) subEl.textContent = "Only you and your friend can read this thread.";
  if (creatureLinkEl) creatureLinkEl.textContent = selfName;

  if (parentNoteEl) {
    parentNoteEl.textContent =
      `You, as ${selfName}'s parent can send the first message to ask about intentions, but after that, ${peerName} will respond and ${selfName} will respond after 5–10 minutes. If you approve, you can click the button that says continue the conversation, which only appears after 12 hours`;
    parentNoteEl.hidden = false;
  }

  const qs = new URLSearchParams({
    selfCreatureId: selfId,
    peerCreatureId: peerId,
  });

  async function loadPortalData() {
    const res = await fetch(`/api/portal/messages?${qs}`, { credentials: "include" });
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
    portalState = data.portal || {};
    cachedMessages = data.messages || [];
    return cachedMessages;
  }

  function updatePortalChrome() {
    const blocked = Boolean(portalState.parent_blocked);
    const canContinue = Boolean(portalState.can_continue);
    const continueAt = portalState.continue_available_at
      ? new Date(portalState.continue_available_at)
      : null;

    /** Unblock bypasses the normal gate; until then, composer stays off while blocked (unless can_continue — still blocked until Continue or Unblock). */
    if (inputEl) inputEl.disabled = blocked;
    if (sendBtn) sendBtn.disabled = blocked;
    /** Never stack the “typing…” overlay on an active composer — it washes out text under the semi-transparent layer. */
    if (!blocked && typingOverlay && typingLabelEl) {
      typingOverlay.hidden = true;
      typingLabelEl.textContent = "";
    }

    if (statusEl) {
      if (!blocked) {
        statusEl.hidden = true;
        statusEl.textContent = "";
      } else if (canContinue) {
        statusEl.hidden = true;
        statusEl.textContent = "";
      } else if (continueAt && !Number.isNaN(continueAt.getTime())) {
        statusEl.hidden = false;
        if (continueAt.getTime() > Date.now()) {
          statusEl.textContent = `Next round: you can send again after ${continueAt.toLocaleString()}, or use Continue when it unlocks below.`;
        } else {
          statusEl.textContent =
            "You can approve the next parent message with Continue below.";
        }
      } else {
        statusEl.hidden = false;
        statusEl.textContent =
          "Simulated replies are on the way — your friend’s hatchling first, then yours after a few minutes.";
      }
    }

    if (continueWrap && continueBtn && continueHint) {
      if (blocked && canContinue) {
        continueWrap.hidden = false;
        continueBtn.hidden = false;
        continueHint.textContent =
          "Appears once 12 hours have passed since the last simulated reply.";
      } else if (blocked && continueAt && !Number.isNaN(continueAt.getTime()) && !canContinue) {
        continueWrap.hidden = false;
        continueBtn.hidden = true;
        continueHint.textContent =
          continueAt.getTime() > Date.now()
            ? `Continue unlocks at ${continueAt.toLocaleString()}.`
            : "";
      } else {
        continueWrap.hidden = true;
        continueHint.textContent = "";
      }
    }

    if (unblockWrap) {
      unblockWrap.hidden = !blocked;
    }

    /** Friend’s simulated line is next: last message is your non-AI line, round still in progress. */
    const last = cachedMessages.length
      ? cachedMessages[cachedMessages.length - 1]
      : null;
    const lastFromSelf =
      last && String(last.from_creature_id) === String(selfId);
    const waitingForFriendSim =
      Boolean(blocked) &&
      !portalState.can_continue &&
      !portalState.continue_available_at &&
      lastFromSelf &&
      !last.is_ai;

    if (typingOverlay && typingLabelEl) {
      if (waitingForFriendSim) {
        typingLabelEl.textContent = `${peerName} is typing `;
        typingOverlay.hidden = false;
      } else {
        typingOverlay.hidden = true;
        typingLabelEl.textContent = "";
      }
    }
  }

  function renderMessages(messages) {
    if (!threadEl) return;
    threadEl.innerHTML = "";
    if (!messages.length) {
      const p = document.createElement("p");
      p.className = "portal-empty";
      p.textContent = "No messages yet — say hello.";
      threadEl.appendChild(p);
      return;
    }
    for (const m of messages) {
      const mine = String(m.from_creature_id) === String(selfId);
      const isAi = Boolean(m.is_ai);
      const row = document.createElement("div");
      row.className = `portal-msg ${mine ? "portal-msg-mine" : "portal-msg-theirs"}`;
      const meta = document.createElement("div");
      meta.className = "portal-msg-meta";
      let label = mine ? selfName : peerName;
      if (isAi) label += " (simulated)";
      meta.textContent = label;
      const body = document.createElement("div");
      body.className = "portal-msg-body";
      body.innerHTML = escapeHtml(m.body || "").replace(/\n/g, "<br />");
      let t = "";
      try {
        t = new Date(m.created_at).toLocaleString();
      } catch {
        t = "";
      }
      const time = document.createElement("time");
      time.className = "portal-msg-time";
      time.dateTime = m.created_at || "";
      time.textContent = t;
      row.appendChild(meta);
      row.appendChild(body);
      row.appendChild(time);
      threadEl.appendChild(row);
    }
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  try {
    const messages = await loadPortalData();
    if (loadingEl) loadingEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
    renderMessages(messages);
    updatePortalChrome();
  } catch (e) {
    console.error(e);
    if (loadingEl) loadingEl.hidden = true;
    if (errEl) {
      errEl.textContent =
        e && e.message ? String(e.message) : "Could not load messages.";
      errEl.hidden = false;
    }
    return;
  }

  setInterval(async () => {
    try {
      if (document.visibilityState !== "visible") return;
      const msgs = await loadPortalData();
      renderMessages(msgs);
      updatePortalChrome();
    } catch {
      /* ignore poll errors */
    }
  }, 5000);

  document.getElementById("portal-logout")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  });

  unblockBtn?.addEventListener("click", async () => {
    if (!unblockBtn) return;
    unblockBtn.disabled = true;
    try {
      const res = await fetch("/api/portal/unblock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfCreatureId: selfId,
          peerCreatureId: peerId,
        }),
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
      portalState = data.portal || portalState;
      const msgs = await loadPortalData();
      renderMessages(msgs);
      updatePortalChrome();
      if (inputEl && !inputEl.disabled) {
        inputEl.focus();
      }
    } catch (e) {
      alert(e && e.message ? e.message : "Could not unblock.");
    } finally {
      unblockBtn.disabled = false;
    }
  });

  continueBtn?.addEventListener("click", async () => {
    if (!continueBtn) return;
    continueBtn.disabled = true;
    try {
      const res = await fetch("/api/portal/continue", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfCreatureId: selfId,
          peerCreatureId: peerId,
        }),
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
      portalState = data.portal || portalState;
      const msgs = await loadPortalData();
      renderMessages(msgs);
      updatePortalChrome();
    } catch (e) {
      alert(e && e.message ? e.message : "Could not continue.");
    } finally {
      continueBtn.disabled = false;
    }
  });

  formEl?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = String(inputEl?.value || "").trim();
    if (!body || !sendBtn) return;
    sendBtn.disabled = true;
    try {
      const res = await fetch("/api/portal/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfCreatureId: selfId,
          peerCreatureId: peerId,
          body,
        }),
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
      if (data.portal) portalState = data.portal;
      if (inputEl) inputEl.value = "";
      const messages = await loadPortalData();
      renderMessages(messages);
      updatePortalChrome();
    } catch (e) {
      alert(e && e.message ? e.message : "Could not send.");
    } finally {
      sendBtn.disabled = false;
      updatePortalChrome();
    }
  });
}

main().catch((e) => {
  console.error(e);
  const errEl = document.getElementById("portal-error");
  const loadingEl = document.getElementById("portal-loading");
  if (loadingEl) loadingEl.hidden = true;
  if (errEl) {
    errEl.textContent = "Something went wrong.";
    errEl.hidden = false;
  }
});
