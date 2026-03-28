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
const portraitDropZone = document.getElementById("portrait-drop-zone");
const dragThumbsRow = document.getElementById("drag-thumbs-row");
const foodDragWrap = document.getElementById("food-drag-wrap");
const foodDragImg = document.getElementById("food-drag-img");
const fearDragWrap = document.getElementById("fear-drag-wrap");
const fearDragImg = document.getElementById("fear-drag-img");
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
/** dataTransfer payloads for drag-to-care */
const FEED_DRAG_TYPE = "tomagoatse-feed";
const DISCIPLINE_DRAG_TYPE = "tomagoatse-discipline";

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
  syncCareDragThumbnails();
}

function syncCareDragThumbnails() {
  if (foodDragImg && foodDragWrap) {
    const hasSrc = Boolean(foodDragImg.getAttribute("src"));
    const interactive =
      !foodDragWrap.hidden &&
      hasSrc &&
      careSession &&
      !btnFeed.disabled;
    foodDragImg.draggable = interactive;
    foodDragImg.tabIndex = interactive ? 0 : -1;
    if (interactive) foodDragImg.setAttribute("role", "button");
    else foodDragImg.removeAttribute("role");
  } else if (foodDragImg) {
    foodDragImg.draggable = false;
    foodDragImg.tabIndex = -1;
    foodDragImg.removeAttribute("role");
  }
  if (fearDragImg && fearDragWrap) {
    const hasSrc = Boolean(fearDragImg.getAttribute("src"));
    const interactive =
      !fearDragWrap.hidden &&
      hasSrc &&
      careSession &&
      !btnDiscipline.disabled;
    fearDragImg.draggable = interactive;
    fearDragImg.tabIndex = interactive ? 0 : -1;
    if (interactive) fearDragImg.setAttribute("role", "button");
    else fearDragImg.removeAttribute("role");
  } else if (fearDragImg) {
    fearDragImg.draggable = false;
    fearDragImg.tabIndex = -1;
    fearDragImg.removeAttribute("role");
  }
}

function canTriggerFoodThumb() {
  return (
    careSession &&
    foodDragWrap &&
    !foodDragWrap.hidden &&
    Boolean(foodDragImg?.getAttribute("src")) &&
    !btnFeed.disabled
  );
}

function canTriggerFearThumb() {
  return (
    careSession &&
    fearDragWrap &&
    !fearDragWrap.hidden &&
    Boolean(fearDragImg?.getAttribute("src")) &&
    !btnDiscipline.disabled
  );
}

const CARE_WIND_REDUCED =
  typeof window !== "undefined" &&
  Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );

function flashThumbTapGlow(sourceImg, kind) {
  if (!sourceImg) return;
  const feedCls = "thumb-tap-glow--feed";
  const fearCls = "thumb-tap-glow--discipline";
  sourceImg.classList.remove("thumb-tap-glow", feedCls, fearCls);
  void sourceImg.offsetWidth;
  sourceImg.classList.add(
    "thumb-tap-glow",
    kind === "feed" ? feedCls : fearCls
  );
  const clear = () => {
    sourceImg.classList.remove("thumb-tap-glow", feedCls, fearCls);
  };
  sourceImg.addEventListener("animationend", clear, { once: true });
  window.setTimeout(clear, 700);
}

function playThumbToPortraitWind(sourceImg, kind) {
  if (CARE_WIND_REDUCED || !sourceImg || !resultImage) return;
  const figure = sourceImg.closest("figure.portrait");
  if (!figure) return;
  let layer = figure.querySelector(".care-wind-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "care-wind-layer";
    layer.setAttribute("aria-hidden", "true");
    figure.appendChild(layer);
  }
  const fr = figure.getBoundingClientRect();
  const sr = sourceImg.getBoundingClientRect();
  const tr = resultImage.getBoundingClientRect();
  const x0 = sr.left + sr.width / 2 - fr.left;
  const y0 = sr.top + sr.height / 2 - fr.top;
  const x1 = tr.left + tr.width / 2 - fr.left;
  const y1 = tr.top + tr.height / 2 - fr.top;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.max(24, Math.hypot(dx, dy));
  const pathAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const perp = pathAngle + 90;
  const perpRad = (perp * Math.PI) / 180;
  const n = 7;
  layer.replaceChildren();
  for (let i = 0; i < n; i++) {
    const spread = (i - (n - 1) / 2) * 10;
    const ox = Math.cos(perpRad) * spread;
    const oy = Math.sin(perpRad) * spread;
    const el = document.createElement("span");
    el.className = `care-wind-streak care-wind-streak--${kind}`;
    el.style.left = `${x0 + ox}px`;
    el.style.top = `${y0 + oy}px`;
    el.style.setProperty("--wind-deg", `${pathAngle}deg`);
    el.style.setProperty("--wind-dist", `${dist}px`);
    el.style.animationDelay = `${i * 42}ms`;
    layer.appendChild(el);
  }
  requestAnimationFrame(() => {
    layer.querySelectorAll(".care-wind-streak").forEach((el) => {
      el.classList.add("care-wind-streak--active");
    });
  });
  window.setTimeout(() => {
    layer.replaceChildren();
  }, 950);
}

function playThumbCareSendEffect(sourceImg, action) {
  const kind = action === "feed" ? "feed" : "discipline";
  flashThumbTapGlow(sourceImg, kind);
  playThumbToPortraitWind(sourceImg, kind);
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

if (foodDragImg) {
  foodDragImg.addEventListener("dragstart", (e) => {
    if (!foodDragImg.draggable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", FEED_DRAG_TYPE);
    e.dataTransfer.effectAllowed = "copy";
  });
  foodDragImg.addEventListener("click", (e) => {
    if (!canTriggerFoodThumb()) return;
    e.preventDefault();
    playThumbCareSendEffect(foodDragImg, "feed");
    handleCareAction("feed");
  });
  foodDragImg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!canTriggerFoodThumb()) return;
    e.preventDefault();
    playThumbCareSendEffect(foodDragImg, "feed");
    handleCareAction("feed");
  });
}

if (fearDragImg) {
  fearDragImg.addEventListener("dragstart", (e) => {
    if (!fearDragImg.draggable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", DISCIPLINE_DRAG_TYPE);
    e.dataTransfer.effectAllowed = "copy";
  });
  fearDragImg.addEventListener("click", (e) => {
    if (!canTriggerFearThumb()) return;
    e.preventDefault();
    playThumbCareSendEffect(fearDragImg, "discipline");
    handleCareAction("discipline");
  });
  fearDragImg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!canTriggerFearThumb()) return;
    e.preventDefault();
    playThumbCareSendEffect(fearDragImg, "discipline");
    handleCareAction("discipline");
  });
}

if (portraitDropZone) {
  portraitDropZone.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  portraitDropZone.addEventListener("dragenter", (e) => {
    if ([...e.dataTransfer.types].includes("text/plain")) {
      portraitDropZone.classList.add("portrait-drag-over");
    }
  });
  portraitDropZone.addEventListener("dragleave", (e) => {
    if (!portraitDropZone.contains(e.relatedTarget)) {
      portraitDropZone.classList.remove("portrait-drag-over");
    }
  });
  portraitDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    portraitDropZone.classList.remove("portrait-drag-over");
    if (!careSession || btnFeed.disabled) return;
    const t = e.dataTransfer.getData("text/plain");
    if (t === FEED_DRAG_TYPE) handleCareAction("feed");
    else if (t === DISCIPLINE_DRAG_TYPE) handleCareAction("discipline");
  });
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

    const hasFoodThumb = Boolean(data.foodImageBase64);
    const hasFearThumb = Boolean(data.fearImageBase64);
    if (dragThumbsRow) {
      dragThumbsRow.hidden = !hasFoodThumb && !hasFearThumb;
    }

    if (hasFoodThumb && foodDragWrap && foodDragImg) {
      foodDragWrap.hidden = false;
      const fm = data.foodImageMime || "image/png";
      foodDragImg.src = `data:${fm};base64,${data.foodImageBase64}`;
      foodDragImg.alt = `Draggable ${String(body.favouriteFood || "food").slice(0, 80)}`;
    } else if (foodDragWrap && foodDragImg) {
      foodDragWrap.hidden = true;
      foodDragImg.removeAttribute("src");
      foodDragImg.alt = "";
    }

    if (hasFearThumb && fearDragWrap && fearDragImg) {
      fearDragWrap.hidden = false;
      const fm = data.fearImageMime || "image/png";
      fearDragImg.src = `data:${fm};base64,${data.fearImageBase64}`;
      const bf = String(body.biggestFear || "").trim();
      fearDragImg.alt = bf
        ? `Their fear (“${bf.slice(0, 70)}${bf.length > 70 ? "…" : ""}”) — drag to discipline`
        : `What ${displayName} is scared of — drag to discipline`;
    } else if (fearDragWrap && fearDragImg) {
      fearDragWrap.hidden = true;
      fearDragImg.removeAttribute("src");
      fearDragImg.alt = "";
    }

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
    syncCareDragThumbnails();

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
  if (dragThumbsRow) dragThumbsRow.hidden = true;
  if (foodDragWrap) foodDragWrap.hidden = true;
  if (fearDragWrap) fearDragWrap.hidden = true;
  if (foodDragImg) {
    foodDragImg.removeAttribute("src");
    foodDragImg.alt = "";
  }
  if (fearDragImg) {
    fearDragImg.removeAttribute("src");
    fearDragImg.alt = "";
  }
  portraitDropZone?.classList.remove("portrait-drag-over");
  document.querySelector("figure.portrait .care-wind-layer")?.replaceChildren();
  if (options.resetForm) form.reset();
  careSession = null;
  syncCareDragThumbnails();
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
