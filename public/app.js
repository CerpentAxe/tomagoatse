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
const btnNewAbomination = document.getElementById("btn-new-abomination");
const careDialog = document.getElementById("care-dialog");
const careDialogFirst = document.getElementById("care-dialog-first");
const careDialogAction = document.getElementById("care-dialog-action");
const careDialogMeterNote = document.getElementById("care-dialog-meter-note");
const careDialogClose = document.getElementById("care-dialog-close");
const lightningOverlay = document.getElementById("lightning-overlay");
const captionIntroDialog = document.getElementById("caption-intro-dialog");
const captionIntroWrap = document.querySelector(".caption-intro-wrap");
const captionIntroText = document.getElementById("caption-intro-text");

const WORKING_MSG = "If you see this, it is working";
const LIGHTNING_STEP_MS = 100;
/** One strike = black → white → black → white */
const LIGHTNING_STRIKES = 4;

async function runLightningFlash() {
  if (!lightningOverlay) return;
  const colors = ["#000000", "#ffffff", "#000000", "#ffffff"];
  lightningOverlay.hidden = false;
  for (let strike = 0; strike < LIGHTNING_STRIKES; strike++) {
    for (const bg of colors) {
      lightningOverlay.style.backgroundColor = bg;
      await new Promise((r) => setTimeout(r, LIGHTNING_STEP_MS));
    }
  }
  lightningOverlay.hidden = true;
  lightningOverlay.style.backgroundColor = "";
}

/**
 * Shows the personality blurb (same as under the portrait) in a modal; click anywhere (panel or padding) closes it.
 */
function showCaptionIntroPopup(text) {
  return new Promise((resolve) => {
    if (!captionIntroDialog || !captionIntroText) {
      resolve();
      return;
    }
    captionIntroText.textContent = text || "";

    const wrap = captionIntroWrap || captionIntroDialog;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      wrap.removeEventListener("click", onWrapClick);
      resolve();
    };

    const onWrapClick = () => {
      if (captionIntroDialog.open) captionIntroDialog.close();
    };

    const onClose = () => finish();

    wrap.addEventListener("click", onWrapClick);
    captionIntroDialog.addEventListener("close", onClose, { once: true });

    captionIntroDialog.showModal();
  });
}

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
  { key: "health", name: "Health", allowZero: true },
];

const CARE_COPY = {
  feed: "ooh baby, I like that!",
  discipline: "Fuck off you prick",
  encourage: "I love you, big hearts",
};

const SPECIAL_SELF_FEED_LINES = [
  "Everybody loves their own brand",
  "Jesus, fuck, are you trying to kill me",
  "I could get used to this",
  "It puts the lotion on the skin, or else it gets the hose again",
];

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

function meterRowHtml({ name, left, right, value, fixed, allowZero }) {
  let v;
  if (fixed && allowZero) {
    const raw = Number(value);
    v = Number.isFinite(raw)
      ? Math.max(0, Math.min(100, Math.round(raw)))
      : 0;
  } else if (fixed) {
    const raw = Number(value);
    v = Number.isFinite(raw)
      ? Math.max(1, Math.min(100, Math.round(raw)))
      : 50;
  } else {
    v = Math.max(1, Math.min(100, Number(value) || 0));
  }
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
      allowZero: spec.allowZero,
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

function creatureTypeMatchesFavouriteFood() {
  if (!careSession) return false;
  const a = careSession.creatureType.trim().toLowerCase();
  const b = careSession.favouriteFood.trim().toLowerCase();
  return a.length > 0 && b.length > 0 && a === b;
}

async function handleCareAction(action) {
  if (!careSession) return;

  const isFirst = !careSession.careUsedOnce;
  careSession.careUsedOnce = true;

  let actionLine = CARE_COPY[action] || "";
  if (
    action === "feed" &&
    creatureTypeMatchesFavouriteFood() &&
    Math.random() < 0.25
  ) {
    actionLine =
      SPECIAL_SELF_FEED_LINES[
        Math.floor(Math.random() * SPECIAL_SELF_FEED_LINES.length)
      ];
  }
  careDialogAction.textContent = actionLine;
  if (isFirst) {
    const ct = careSession.creatureType.trim() || "creature";
    careDialogFirst.textContent =
      `What you’ve done is remarkable. You carried life with care and courage, and even though this baby ${ct} isn’t yours to keep, the love and strength you gave still matter. You matter.`;
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
      health: 100,
    };
    if (f.health === undefined) f.health = 100;

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

    await runLightningFlash();
    // Hide loading so the caption dialog is not stacked over the spinner
    screenLoading.hidden = true;
    screenLoading.classList.add("screen-hidden");
    await showCaptionIntroPopup(resultCaption.textContent);
    showScreen("result");
  } catch (err) {
    console.error(err);
    errorDetail.textContent = err.message || "Network hiccup";
    showScreen("error");
  }
});

function goToCreateForm(options = {}) {
  if (careDialog.open) careDialog.close();
  if (captionIntroDialog?.open) captionIntroDialog.close();
  if (options.resetForm) form.reset();
  careSession = null;
  showScreen("form");
}

btnRetry.addEventListener("click", () => {
  loadingText.textContent = WORKING_MSG;
  goToCreateForm();
});

btnNewAbomination.addEventListener("click", () =>
  goToCreateForm({ resetForm: true })
);

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
