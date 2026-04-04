import {
  loadPendingSavePayloadString,
  clearPendingSavePayload,
} from "./pending-save.js";

const form = document.getElementById("signup-form");
const errEl = document.getElementById("signup-error");
const pendingNote = document.getElementById("signup-pending-note");
const submitBtn = document.getElementById("signup-submit");

function showError(msg) {
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.hidden = !msg;
}

let pendingPayload = null;

async function refreshPendingPayload() {
  try {
    const raw = await loadPendingSavePayloadString();
    pendingPayload = raw ? JSON.parse(raw) : null;
  } catch {
    pendingPayload = null;
  }
  return pendingPayload;
}

function pronounForCreatorSession(session) {
  const g = String(session?.profile?.gender || "").toLowerCase();
  if (g === "male") return "he";
  if (g === "female") return "she";
  if (g === "nonbinary") return "they";
  return "it";
}

function fillPendingNote() {
  if (!pendingNote) return;
  if (pendingPayload?.creator?.spec) {
    const session = pendingPayload.creator.session || {};
    const name = session.displayName?.trim() || "your creature";
    const p = pronounForCreatorSession(session);
    pendingNote.textContent = `You need to save ${name} — you've made it, ${p} is real — your personal information is important to me.`;
    pendingNote.hidden = false;
  } else {
    pendingNote.textContent =
      "No pending design was found. Visit the low-poly creator and press “Save your beautiful child” (and sign in if asked) before you register, or continue to create an empty account.";
    pendingNote.hidden = false;
  }
}

const loginLink = document.querySelector('a[href="/login.html"]');
if (loginLink && window.location.search) {
  loginLink.href = "/login.html" + window.location.search;
}

refreshPendingPayload().then(() => fillPendingNote());

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  await refreshPendingPayload();

  const fd = new FormData(form);
  let email = String(fd.get("email") || "").trim();
  let username = String(fd.get("username") || "").trim();
  const password = String(fd.get("password") || "");
  const password2 = String(fd.get("password2") || "");

  // People often type their username into "Email" when skipping email — treat as username.
  if (!username && email && !email.includes("@")) {
    if (/^[a-zA-Z0-9_]{3,32}$/.test(email)) {
      username = email;
      email = "";
    }
  }

  const usernameOk = /^[a-zA-Z0-9_]{3,32}$/.test(username);
  if (!email && !username) {
    showError("Enter a unique username (email is optional).");
    return;
  }
  if (email && !email.includes("@")) {
    if (!usernameOk) {
      showError(
        "Enter a valid email, or leave the email field empty and use a username (3–32 letters, numbers, underscores)."
      );
      return;
    }
    email = "";
  }
  if (username && !usernameOk) {
    showError("Username must be 3–32 characters: letters, numbers, underscores only.");
    return;
  }

  if (password !== password2) {
    showError("Passwords do not match.");
    return;
  }

  let initialCreature = null;
  if (pendingPayload?.creator?.spec && pendingPayload?.creator?.session) {
    const title =
      pendingPayload.creator.session.displayName?.trim() ||
      "My beautiful child";
    initialCreature = {
      title: title.slice(0, 200),
      payload: pendingPayload,
    };
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating…";

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ...(email ? { email } : {}),
        username: username || undefined,
        password,
        initialCreature,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.message || data.error || "Could not create account.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account & save";
      return;
    }
    await clearPendingSavePayload();
    const next = new URLSearchParams(window.location.search).get("next");
    const dest =
      next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/dashboard.html";
    window.location.href = dest;
  } catch (err) {
    showError(err?.message || "Network error.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Create account & save";
  }
});
