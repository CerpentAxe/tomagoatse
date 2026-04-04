const loadingEl = document.getElementById("settings-loading");
const errorEl = document.getElementById("settings-error");
const contentEl = document.getElementById("settings-content");
const userLine = document.getElementById("settings-user-line");
const usernameEl = document.getElementById("settings-username");
const emailEl = document.getElementById("settings-email");
const surnameInput = document.getElementById("settings-surname");
const profileForm = document.getElementById("settings-profile-form");
const profileStatus = document.getElementById("settings-profile-status");
const charactersEmpty = document.getElementById("settings-characters-empty");
const charactersList = document.getElementById("settings-characters-list");

const SOCIAL_OPTIONS = [
  { value: "offline", label: "Offline" },
  { value: "family", label: "Communicate with family" },
  { value: "town", label: "Communicate with my town" },
  { value: "anyone", label: "Communicate with anyone" },
];

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function setLoading(visible) {
  if (loadingEl) loadingEl.hidden = !visible;
}

async function main() {
  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href = "/login.html?next=/settings.html";
    return;
  }
  const meJson = await me.json().catch(() => ({}));
  if (userLine && meJson.user) {
    userLine.textContent = meJson.user.username
      ? `Signed in as @${meJson.user.username}`
      : meJson.user.email
        ? `Signed in as ${meJson.user.email}`
        : "Signed in";
  }

  const res = await fetch("/api/settings", { credentials: "include" });
  const raw = await res.text();
  setLoading(false);

  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (res.status === 503) {
    showError("Database is not configured on the server.");
    return;
  }
  if (!res.ok) {
    const hint =
      data.message ||
      (data.error === "not_found"
        ? "Account not found. Try signing out and signing in again."
        : null);
    showError(hint || "Could not load settings.");
    return;
  }
  const user = data.user || {};
  if (usernameEl) usernameEl.textContent = user.username || "—";
  if (emailEl) emailEl.textContent = user.email || "—";
  if (surnameInput) surnameInput.value = user.surname != null ? String(user.surname) : "";

  const creatures = data.creatures || [];
  if (creatures.length === 0) {
    charactersEmpty.hidden = false;
    charactersList.hidden = true;
  } else {
    charactersEmpty.hidden = true;
    charactersList.hidden = false;
    charactersList.innerHTML = "";
    for (const c of creatures) {
      const name = c.display_name || c.title || "Creature";
      const li = document.createElement("li");
      li.className = "settings-creature-row";
      li.dataset.creatureId = c.id;

      const head = document.createElement("div");
      head.className = "settings-creature-head";
      const title = document.createElement("h3");
      title.className = "settings-creature-name";
      const link = document.createElement("a");
      link.href = `/my-creature.html?id=${encodeURIComponent(c.id)}`;
      link.textContent = name;
      title.appendChild(link);
      head.appendChild(title);

      const controls = document.createElement("div");
      controls.className = "settings-creature-controls";

      const reachWrap = document.createElement("label");
      reachWrap.className = "field settings-creature-field";
      const reachSpan = document.createElement("span");
      reachSpan.className = "label";
      reachSpan.textContent = "Social reach";
      const select = document.createElement("select");
      select.className = "settings-social-select";
      select.setAttribute("aria-label", `Social reach for ${name}`);
      for (const opt of SOCIAL_OPTIONS) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
      }
      const reach = String(c.social_reach || "town");
      select.value = SOCIAL_OPTIONS.some((o) => o.value === reach) ? reach : "town";
      reachWrap.appendChild(reachSpan);
      reachWrap.appendChild(select);

      const frWrap = document.createElement("label");
      frWrap.className = "field settings-creature-field settings-creature-checkbox";
      const fr = document.createElement("input");
      fr.type = "checkbox";
      fr.checked = c.friend_requests_enabled !== false;
      fr.setAttribute(
        "aria-label",
        `Auto friend requests for ${name}`
      );
      const frLbl = document.createElement("span");
      frLbl.className = "label";
      frLbl.textContent = "Auto send / receive friend requests";
      frWrap.appendChild(fr);
      frWrap.appendChild(frLbl);

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn-secondary settings-creature-save";
      saveBtn.textContent = "Save";

      const status = document.createElement("span");
      status.className = "settings-inline-status";
      status.setAttribute("role", "status");

      saveBtn.addEventListener("click", async () => {
        status.textContent = "";
        saveBtn.disabled = true;
        try {
          const patch = await fetch(
            `/api/creatures/${encodeURIComponent(c.id)}/settings`,
            {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                social_reach: select.value,
                friend_requests_enabled: fr.checked,
              }),
            }
          );
          const raw = await patch.text();
          let body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = { message: raw.slice(0, 280) };
          }
          if (!patch.ok) {
            status.textContent =
              body.message || body.error || `Could not save (HTTP ${patch.status}).`;
            return;
          }
          status.textContent = "Saved.";
        } catch (e) {
          console.error(e);
          status.textContent = "Network error.";
        } finally {
          saveBtn.disabled = false;
        }
      });

      controls.appendChild(reachWrap);
      controls.appendChild(frWrap);
      controls.appendChild(saveBtn);
      controls.appendChild(status);

      li.appendChild(head);
      li.appendChild(controls);
      charactersList.appendChild(li);
    }
  }

  contentEl.hidden = false;

  profileForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!surnameInput || !profileStatus) return;
    profileStatus.textContent = "";
    const btn = document.getElementById("settings-save-profile");
    if (btn) btn.disabled = true;
    try {
      const patch = await fetch("/api/settings/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surname: surnameInput.value }),
      });
      const raw = await patch.text();
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { message: raw.slice(0, 280) };
      }
      if (!patch.ok) {
        profileStatus.textContent =
          body.message || body.error || `Could not save (HTTP ${patch.status}).`;
        return;
      }
      profileStatus.textContent = "Surname saved.";
    } catch (e) {
      console.error(e);
      profileStatus.textContent = "Network error.";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("settings-logout")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  });
}

main().catch((e) => {
  console.error(e);
  setLoading(false);
  showError("Something went wrong.");
});
