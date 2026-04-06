const loadingEl = document.getElementById("inbox-loading");
const errorEl = document.getElementById("inbox-error");
const bannerEl = document.getElementById("inbox-unread-banner");
const mainEl = document.getElementById("inbox-main");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function placeholderLetter(name) {
  const t = String(name || "?").trim();
  return (t[0] || "?").toUpperCase();
}

function portalUrl(selfId, peerId) {
  return `/portal.html?self=${encodeURIComponent(selfId)}&peer=${encodeURIComponent(peerId)}`;
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

async function main() {
  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href = "/login.html?next=/inbox.html";
    return;
  }

  const res = await fetch("/api/portal/inbox", { credentials: "include" });
  if (loadingEl) loadingEl.hidden = true;

  if (res.status === 503) {
    if (errorEl) {
      errorEl.textContent = "Database is not available.";
      errorEl.hidden = false;
    }
    return;
  }
  if (!res.ok) {
    if (errorEl) {
      errorEl.textContent = "Could not load inbox.";
      errorEl.hidden = false;
    }
    return;
  }

  const data = await res.json().catch(() => ({}));
  const creatures = data.creatures || [];
  const totalUnread = Number(data.total_unread_threads) || 0;

  if (bannerEl) {
    if (totalUnread > 0) {
      bannerEl.hidden = false;
      bannerEl.textContent =
        totalUnread === 1
          ? "You have 1 conversation with new messages since you last opened the portal."
          : `You have ${totalUnread} conversations with new messages since you last opened the portal.`;
    } else {
      bannerEl.hidden = true;
    }
  }

  if (!mainEl) return;

  if (creatures.length === 0) {
    mainEl.innerHTML =
      '<div class="inbox-empty-creatures"><p class="inbox-empty">No saved hatchlings yet. <a href="/">Open the hatchery</a> and save one to your dashboard.</p></div>';
    return;
  }

  const parts = [];
  for (const c of creatures) {
    const name = escapeHtml(c.display_name || c.title || "Creature");
    const letter = placeholderLetter(c.display_name || c.title);
    const threads = c.threads || [];
    const threadHtml = [];
    if (threads.length === 0) {
      threadHtml.push(
        '<p class="inbox-empty">No accepted friends yet — friend requests appear on the dashboard.</p>'
      );
    } else {
      threadHtml.push('<ul class="inbox-thread-list">');
      for (const t of threads) {
        const peerName = escapeHtml(t.peer_display_name || "Friend");
        const href = portalUrl(c.id, t.peer_creature_id);
        const rawPrev = (t.last_message_preview || "")
          .slice(0, 120)
          .trim()
          .replace(/\s+/g, " ");
        const prevEsc = rawPrev ? escapeHtml(rawPrev) + (rawPrev.length >= 120 ? "…" : "") : "";
        const timeEsc = t.last_message_at
          ? escapeHtml(fmtTime(t.last_message_at))
          : "";
        const previewLine =
          timeEsc || prevEsc
            ? `<p class="inbox-thread-preview">${[timeEsc, prevEsc].filter(Boolean).join(" — ")}</p>`
            : "";
        const unread = t.has_unread
          ? '<span class="inbox-badge">New</span>'
          : "";
        threadHtml.push(
          `<li class="inbox-thread"><a href="${href}">${peerName}${unread}</a>${previewLine}</li>`
        );
      }
      threadHtml.push("</ul>");
    }

    parts.push(
      `<section class="inbox-creature" aria-label="${name}"><div class="inbox-creature-head"><div class="inbox-avatar" aria-hidden="true">${escapeHtml(letter)}</div><div><h2 class="inbox-creature-name">${name}</h2><p class="inbox-creature-meta"><a href="/my-creature.html?id=${encodeURIComponent(c.id)}">Open creature page</a></p></div></div>${threadHtml.join("")}</section>`
    );
  }

  mainEl.innerHTML = parts.join("");
}

main().catch((e) => {
  console.error(e);
  if (loadingEl) loadingEl.hidden = true;
  if (errorEl) {
    errorEl.textContent = "Something went wrong.";
    errorEl.hidden = false;
  }
});
