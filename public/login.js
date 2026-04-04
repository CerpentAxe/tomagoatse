const form = document.getElementById("login-form");
const errEl = document.getElementById("login-error");
const submitBtn = document.getElementById("login-submit");

const signUpLink = document.querySelector('a[href="/signup.html"]');
const heroSignUp = document.querySelector(".auth-hint a[href='/signup.html']");
const q = window.location.search;
if (signUpLink && q) {
  signUpLink.href = "/signup.html" + q;
}
if (heroSignUp && q) {
  heroSignUp.href = "/signup.html" + q;
}

function showError(msg) {
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.hidden = !msg;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const fd = new FormData(form);
  const emailOrUsername = String(fd.get("emailOrUsername") || "").trim();
  const password = String(fd.get("password") || "");

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ emailOrUsername, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data.message || data.error || "Could not sign in.";
      if (data.error === "invalid_credentials") {
        msg =
          "IF YOU'RE NEW HERE, YOU NEED TO SIGN UP FIRST. We could not sign you in. Check your password. Use the email you registered with, or your username only if you set one at sign-up. If you have not created an account yet, use Sign up first.";
      }
      showError(msg);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    const dest =
      next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/dashboard.html";
    window.location.href = dest;
  } catch (err) {
    showError(err?.message || "Network error.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
  }
});
