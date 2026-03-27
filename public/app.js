const form = document.getElementById("hatch-form");
const screenForm = document.getElementById("screen-form");
const screenLoading = document.getElementById("screen-loading");
const screenError = document.getElementById("screen-error");
const screenResult = document.getElementById("screen-result");
const loadingText = document.getElementById("loading-text");
const errorDetail = document.getElementById("error-detail");
const btnRetry = document.getElementById("btn-retry");
const resultName = document.getElementById("result-name");
const resultTagline = document.getElementById("result-tagline");
const resultImage = document.getElementById("result-image");
const resultCaption = document.getElementById("result-caption");
const meterDynamic = document.getElementById("meter-dynamic");
const meterFixed = document.getElementById("meter-fixed");
const btnFeed = document.getElementById("btn-feed");
const btnDiscipline = document.getElementById("btn-discipline");
const btnEncourage = document.getElementById("btn-encourage");
const careDialog = document.getElementById("care-dialog");
const careDialogFirst = document.getElementById("care-dialog-first");
const careDialogAction = document.getElementById("care-dialog-action");
const careDialogMeterNote = document.getElementById("care-dialog-meter-note");
const careDialogClose = document.getElementById("care-dialog-close");

const WORKING_MSG = "If you see this, it is working";

const DYNAMIC_METERS = [
  {
    key: "empathy",
    name: "Empathy",
    left: "Cool distance",
    right: "Big soft heart",
  },
  {
    key: "society",
    name: "Society",
    left: "Introvert nest",
    right: "Extrovert parade",
  },
  {
    key: "informationProcessing",
    name: "Info processing",
    left: "Sensing / concrete",
    right: "Intuition / patterns",
  },
  {
    key: "decisionMaking",
    name: "Decisions",
    left: "Thinking / logic",
    right: "Feeling / harmony",
  },
  {
    key: "approach",
    name: "Approach",
    left: "Judging / plans",
    right: "Perceiving / flow",
  },
];

const FIXED_METERS = [
  { key: "energy", name: "Energy" },
  { key: "hunger", name: "Hunger" },
  { key: "cleanliness", name: "Cleanliness" },
];

const CARE_COPY = {
  feed: "ooh baby, I like that!",
  discipline: "Fuck off you prick",
  encourage: "I love you, big hearts",
};

/** @type {{ displayName: string, creatureType: string, favouriteFood: string, meters: Record<string, number>, fixedMeters: Record<string, number>, careUsedOnce: boolean } | null} */
let careSession = null;

function showScreen(which) {
  const screens = [
    [screenForm, "form"],
    [screenLoading, "loading"],
    [screenError, "error"],
    [screenResult, "result"],
  ];
  for (const [el, id] of screens) {
    const on = id === which;
    el.hidden = !on;
    el.classList.toggle("screen-hidden", !on);
  }
}

function meterRowHtml({ name, left, right, value, fixed }) {
  const v = Math.max(1, Math.min(100, Number(value) || 0));
  const cls = fixed ? "meter-fill fixed" : "meter-fill";
  return `
    <div class="meter-row">
      <div class="meter-label-row">
        <span class="meter-name">${escapeHtml(name)}</span>
        <span class="meter-value">${v}</span>
      </div>
      <div class="meter-label-row">
        <span>${left ? escapeHtml(left) : ""}</span>
        <span>${right ? escapeHtml(right) : ""}</span>
      </div>
      <div class="meter-track">
        <div class="${cls}" style="width:${v}%"></div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMetersFromSession() {
  if (!careSession) return;
  const m = careSession.meters;
  meterDynamic.innerHTML = DYNAMIC_METERS.map((spec) =>
    meterRowHtml({
      name: spec.name,
      left: spec.left,
      right: spec.right,
      value: m[spec.key],
      fixed: false,
    })
  ).join("");

  const f = careSession.fixedMeters;
  meterFixed.innerHTML = FIXED_METERS.map((spec) =>
    meterRowHtml({
      name: spec.name,
      left: "",
      right: "",
      value: f[spec.key],
      fixed: true,
    })
  ).join("");
}

function setCareButtonsDisabled(disabled) {
  btnFeed.disabled = disabled;
  btnDiscipline.disabled = disabled;
  btnEncourage.disabled = disabled;
}

function syncFeedButtonLabel() {
  if (!careSession) return;
  const raw = careSession.favouriteFood.trim();
  const labelFood = raw ? raw.slice(0, 36) + (raw.length > 36 ? "…" : "") : "something tasty";
  btnFeed.textContent = `Feed (${labelFood})`;
}

async function handleCareAction(action) {
  if (!careSession) return;

  const isFirst = !careSession.careUsedOnce;
  careSession.careUsedOnce = true;

  careDialogAction.textContent = CARE_COPY[action] || "";
  if (isFirst) {
    const ct = careSession.creatureType.trim() || "creature";
    careDialogFirst.textContent = `that's not a ${ct}, but you'll love it either way`;
    careDialogFirst.hidden = false;
  } else {
    careDialogFirst.textContent = "";
    careDialogFirst.hidden = true;
  }

  careDialogMeterNote.textContent = "Updating meters…";
  careDialogMeterNote.hidden = false;
  setCareButtonsDisabled(true);
  careDialog.showModal();

  try {
    const res = await fetch("/api/adjust-meters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        displayName: careSession.displayName,
        creatureType: careSession.creatureType,
        favouriteFood: careSession.favouriteFood,
        meters: careSession.meters,
        fixedMeters: careSession.fixedMeters,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      careDialogMeterNote.textContent =
        data.message || data.error || "Meters didn’t update; try again.";
      careDialogMeterNote.hidden = false;
      setCareButtonsDisabled(false);
      return;
    }

    careSession.meters = { ...careSession.meters, ...data.meters };
    careSession.fixedMeters = {
      ...careSession.fixedMeters,
      ...data.fixedMeters,
    };
    renderMetersFromSession();
    careDialogMeterNote.hidden = true;
  } catch (e) {
    console.error(e);
    careDialogMeterNote.textContent =
      e.message || "Network error while updating meters.";
    careDialogMeterNote.hidden = false;
  } finally {
    setCareButtonsDisabled(false);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());

  loadingText.textContent = WORKING_MSG;
  showScreen("loading");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorDetail.textContent = data.message || data.error || res.statusText;
      showScreen("error");
      return;
    }

    const displayName = data.displayName || body.name || "Your hatchling";
    resultName.textContent = displayName;
    resultTagline.textContent = data.oneLiner || "";
    resultCaption.textContent = data.personalityParagraph || "";

    const mime = data.imageMime || "image/png";
    resultImage.src = `data:${mime};base64,${data.imageBase64}`;
    resultImage.alt = `Portrait of ${displayName}`;

    const m = data.meters || {};
    const f = data.fixedMeters || {
      energy: 100,
      hunger: 100,
      cleanliness: 100,
    };

    careSession = {
      displayName,
      creatureType: String(body.creatureType || ""),
      favouriteFood: String(body.favouriteFood || ""),
      meters: {
        empathy: m.empathy,
        society: m.society,
        informationProcessing: m.informationProcessing,
        decisionMaking: m.decisionMaking,
        approach: m.approach,
      },
      fixedMeters: { ...f },
      careUsedOnce: false,
    };

    renderMetersFromSession();
    syncFeedButtonLabel();
    setCareButtonsDisabled(false);

    showScreen("result");
  } catch (err) {
    console.error(err);
    errorDetail.textContent = err.message || "Network hiccup";
    showScreen("error");
  }
});

btnRetry.addEventListener("click", () => {
  loadingText.textContent = WORKING_MSG;
  careSession = null;
  showScreen("form");
});

btnFeed.addEventListener("click", () => handleCareAction("feed"));
btnDiscipline.addEventListener("click", () =>
  handleCareAction("discipline")
);
btnEncourage.addEventListener("click", () =>
  handleCareAction("encourage")
);

careDialogClose.addEventListener("click", () => careDialog.close());

careDialog.addEventListener("close", () => {
  careDialogMeterNote.textContent = "";
  careDialogMeterNote.hidden = true;
});
