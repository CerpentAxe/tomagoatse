/**
 * Low-poly character creator page: loads hatch session from sessionStorage,
 * calls /api/creator-spec (Hugging Face), renders Three.js preview.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  storePendingSavePayload,
  loadPendingSavePayloadString,
  clearPendingSavePayload,
} from "./pending-save.js";

const CREATOR_SESSION_KEY = "tomagoatse-creator-session";

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

const BODY_PLANS = [
  "Quadruped",
  "Serpentine",
  "Bipedal",
  "Humanoid",
  "Avian/Flying",
  "Aquatic",
  "Arthropod-like",
];

const SPEC_GENDERS = ["Male", "Female", "Other"];

const SIZE_OPTS = ["small", "medium", "large"];

const LOC_FRONT_SIDE = ["front", "side"];

const LOC_TOP_SIDE = ["top", "side"];

const ARM_LEN_OPTS = ["short", "medium", "long"];

const NOSE_OPTS = ["Nose", "Snout", "Beak", "Proboscis"];

const MOUTH_OPTS = [
  "Normal",
  "Teeth",
  "Tusks",
  "Fangs",
  "Mandibles",
  "Jaws",
  "Tongue",
  "whiskers",
];

const ARM_TYPES = [
  "none",
  "human",
  "wings",
  "fins",
  "flippers",
  "tentacles",
  "hooves",
  "paws",
  "talons",
  "claws",
];

const BACK_TYPES = [
  "none",
  "wings",
  "dorsal fin",
  "dermal plates",
  "shell",
  "quills",
];

const TAIL_TYPES = ["none", "normal", "tentacles", "dragon", "nubbin"];

const HAIRCUT_OPTS = [
  "Bald",
  "Long and flowing",
  "Curly",
  "Spiky",
  "Mohawk",
  "Braided",
  "Buzz cut",
  "Afro/fluffy",
  "Dreadlocks/matted",
  "Layered",
];

const BACK_POS_OPTS = ["upper", "mid", "lower"];

const BACK_SIZE_OPTS = ["small", "medium", "large"];

/**
 * Five coordinated palettes for body, limbs, eyes, antennae, ears, back, tail, hair.
 * (Nose meshes still use fixed tints; hair colour is spec-driven.)
 */
const CREATOR_COLOUR_PALETTES = [
  {
    id: "ocean_teal",
    label: "Ocean teal",
    bodyColour: "#6eb3b8",
    armsColour: "#4a9099",
    eyesColour: "#143d4a",
    antennaeColour: "#5a6f7a",
    earsColour: "#8fa899",
    backColour: "#6d8fa3",
    tailColour: "#4d6b78",
  },
  {
    id: "sunset_coral",
    label: "Sunset coral",
    bodyColour: "#e8a598",
    armsColour: "#c76d5e",
    eyesColour: "#5c2e48",
    antennaeColour: "#b86d7a",
    earsColour: "#d4a088",
    backColour: "#a86888",
    tailColour: "#b85668",
  },
  {
    id: "forest_moss",
    label: "Forest moss",
    bodyColour: "#8faa89",
    armsColour: "#6d8f68",
    eyesColour: "#4a3d22",
    antennaeColour: "#5f6d4e",
    earsColour: "#9a8566",
    backColour: "#5d7354",
    tailColour: "#4e6044",
  },
  {
    id: "lavender_dusk",
    label: "Lavender dusk",
    bodyColour: "#c4b5d4",
    armsColour: "#9585b0",
    eyesColour: "#3d2f5c",
    antennaeColour: "#7d6d96",
    earsColour: "#b89fa8",
    backColour: "#9280b8",
    tailColour: "#7868a0",
  },
  {
    id: "ember_smoke",
    label: "Ember smoke",
    bodyColour: "#8a7d78",
    armsColour: "#6a605a",
    eyesColour: "#c24a2e",
    antennaeColour: "#524840",
    earsColour: "#6f6258",
    backColour: "#5c524c",
    tailColour: "#4a423c",
  },
  {
    id: "arctic_frost",
    label: "Arctic frost",
    bodyColour: "#a8c9d4",
    armsColour: "#7ba3b5",
    eyesColour: "#1e3a45",
    antennaeColour: "#6d8a99",
    earsColour: "#9fb8c4",
    backColour: "#89a8b5",
    tailColour: "#6d8f9f",
  },
  {
    id: "golden_hour",
    label: "Golden hour",
    bodyColour: "#e8c88a",
    armsColour: "#d4a86a",
    eyesColour: "#5c3d2e",
    antennaeColour: "#c49560",
    earsColour: "#d4b090",
    backColour: "#b8864a",
    tailColour: "#a67840",
  },
  {
    id: "midnight_jelly",
    label: "Midnight jelly",
    bodyColour: "#6a5a8c",
    armsColour: "#4d3d72",
    eyesColour: "#b070e8",
    antennaeColour: "#5c4d8a",
    earsColour: "#8b7aad",
    backColour: "#4a3d6a",
    tailColour: "#3d3260",
  },
  {
    id: "candy_pop",
    label: "Candy pop",
    bodyColour: "#f5a8c8",
    armsColour: "#e87ba8",
    eyesColour: "#2d6a5c",
    antennaeColour: "#e8c080",
    earsColour: "#f0b4d4",
    backColour: "#d878a8",
    tailColour: "#c86898",
  },
  {
    id: "copper_patina",
    label: "Copper patina",
    bodyColour: "#b89578",
    armsColour: "#9a7548",
    eyesColour: "#2d4a4a",
    antennaeColour: "#7a6050",
    earsColour: "#a08068",
    backColour: "#6d8a82",
    tailColour: "#5a7058",
  },
];

function applyCreatorPaletteToSpec(spec, paletteId) {
  ensureSpecShape(spec);
  const p = CREATOR_COLOUR_PALETTES.find((x) => x.id === paletteId);
  if (!p) return;
  spec.colourPaletteId = paletteId;
  spec.bodyColour = p.bodyColour;
  spec.arms.colour = p.armsColour;
  spec.head.eyes.colour = p.eyesColour;
  spec.head.antennae.colour = p.antennaeColour;
  spec.head.ears.colour = p.earsColour;
  spec.backAttachment.colour = p.backColour;
  spec.tail.colour = p.tailColour;
  spec.hairColour = p.hairColour != null ? p.hairColour : p.armsColour;
}

function buildCreatorPaletteSelectHtml(spec) {
  const current = spec.colourPaletteId || "";
  const opts = CREATOR_COLOUR_PALETTES.map(
    (p) =>
      `<option value="${escapeHtml(p.id)}"${p.id === current ? " selected" : ""}>${escapeHtml(p.label)}</option>`
  ).join("");
  return `<label for="ctx-colourPalette">Colour palette</label><select id="ctx-colourPalette" class="creator-palette-select"><option value="">Choose a palette…</option>${opts}</select>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexForColorInput(hex) {
  const m = String(hex ?? "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]}` : "#888888";
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const BODY_PROP_MIN = 0.45;
const BODY_PROP_MAX = 2.2;
const BODY_GEOM_R = 0.52;

const PREVIEW_MOVE_SPEED = 2.4;
const PREVIEW_JUMP_V = 5.8;
const PREVIEW_GRAVITY = 22;
const PREVIEW_FLY_THRUST = 5.2;
const PREVIEW_BOUNDS = 4.2;
const PREVIEW_MAX_FLY_H = 6.5;

function creatureHasWings(spec) {
  const a = spec?.arms?.type;
  const b = spec?.backAttachment?.type;
  return a === "wings" || b === "wings";
}

function isTypingInFormField(target) {
  if (!target || !target.tagName) return false;
  const t = target.tagName.toLowerCase();
  if (t === "textarea" || t === "select") return true;
  if (t === "input") {
    const type = (target.type || "").toLowerCase();
    if (
      type === "button" ||
      type === "submit" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "range" ||
      type === "color"
    ) {
      return false;
    }
    return true;
  }
  return target.isContentEditable === true;
}

let viewerKeydownHandler = null;
let viewerKeyupHandler = null;
let mobilePreviewControlsAbort = null;

function prefersMobilePreviewControls() {
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

function updateCreatorMobilePreviewChrome() {
  const mobile = prefersMobilePreviewControls();
  document.body.classList.toggle("creator-mobile-preview", mobile);
  const ui = document.getElementById("creator-mobile-preview-ui");
  if (ui) ui.setAttribute("aria-hidden", mobile ? "false" : "true");

  document.querySelectorAll(".creator-controls-lead-desktop").forEach((el) => {
    el.hidden = mobile;
  });
  document.querySelectorAll(".creator-controls-lead-mobile").forEach((el) => {
    el.hidden = !mobile;
  });
  document.querySelectorAll(".creator-controls-list-desktop").forEach((el) => {
    el.hidden = mobile;
  });
  document.querySelectorAll(".creator-controls-list-mobile").forEach((el) => {
    el.hidden = !mobile;
  });
  document.querySelectorAll(".creator-hint-desktop").forEach((el) => {
    el.hidden = mobile;
  });
  document.querySelectorAll(".creator-hint-mobile").forEach((el) => {
    el.hidden = !mobile;
  });
}

function removeViewerKeyboardListeners() {
  if (viewerKeydownHandler) {
    window.removeEventListener("keydown", viewerKeydownHandler);
    window.removeEventListener("keyup", viewerKeyupHandler);
    viewerKeydownHandler = null;
    viewerKeyupHandler = null;
  }
  if (mobilePreviewControlsAbort) {
    mobilePreviewControlsAbort.abort();
    mobilePreviewControlsAbort = null;
  }
}

function wireMobilePreviewControls(signal, ctx) {
  const {
    keys,
    previewState,
    creature,
    groundY,
    canFly,
  } = ctx;
  if (!prefersMobilePreviewControls()) return;
  const ui = document.getElementById("creator-mobile-preview-ui");
  if (!ui) return;

  const tryPreviewJump = () => {
    if (previewState.hidden) return;
    if (previewState.flying) return;
    if (creature.position.y > groundY + 0.08) return;
    previewState.vy = PREVIEW_JUMP_V;
  };

  for (const btn of ui.querySelectorAll("[data-vkey]")) {
    const code = btn.dataset.vkey;
    if (!code) continue;
    const clear = () => {
      keys.delete(code);
    };
    btn.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        keys.add(code);
      },
      { signal }
    );
    btn.addEventListener("pointerup", clear, { signal });
    btn.addEventListener("pointercancel", clear, { signal });
    btn.addEventListener("lostpointercapture", clear, { signal });
  }

  const jumpBtn = ui.querySelector('[data-action="jump"]');
  if (jumpBtn) {
    jumpBtn.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        tryPreviewJump();
      },
      { signal }
    );
  }

  const duckBtn = ui.querySelector('[data-action="duck"]');
  if (duckBtn) {
    const code = "ControlLeft";
    const clear = () => keys.delete(code);
    duckBtn.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        try {
          duckBtn.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        keys.add(code);
      },
      { signal }
    );
    duckBtn.addEventListener("pointerup", clear, { signal });
    duckBtn.addEventListener("pointercancel", clear, { signal });
    duckBtn.addEventListener("lostpointercapture", clear, { signal });
  }

  const hideBtn = ui.querySelector('[data-action="hide"]');
  if (hideBtn) {
    hideBtn.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        previewState.hidden = !previewState.hidden;
        creature.visible = !previewState.hidden;
      },
      { signal }
    );
  }

  if (canFly) {
    const flyBtn = ui.querySelector('[data-action="fly"]');
    if (flyBtn) {
      flyBtn.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          previewState.flying = !previewState.flying;
          if (!previewState.flying) previewState.vy = 0;
        },
        { signal }
      );
    }

    const riseBtn = ui.querySelector('[data-action="rise"]');
    if (riseBtn) {
      const clear = () => keys.delete("Space");
      riseBtn.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          try {
            riseBtn.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          keys.add("Space");
        },
        { signal }
      );
      riseBtn.addEventListener("pointerup", clear, { signal });
      riseBtn.addEventListener("pointercancel", clear, { signal });
      riseBtn.addEventListener("lostpointercapture", clear, { signal });
    }
  }
}

function syncCreatorFlightControlsVisible(spec) {
  const can = creatureHasWings(spec);
  const el = document.getElementById("creator-controls-flight");
  if (el) el.hidden = !can;
  const elMob = document.getElementById("creator-controls-flight-mobile");
  if (elMob) elMob.hidden = !can;
}

/** Width / height / depth multipliers for the main torso (default 1). */
function readBodyProportions(spec) {
  return {
    width: clampFloat(
      spec?.bodyWidth,
      BODY_PROP_MIN,
      BODY_PROP_MAX,
      1
    ),
    height: clampFloat(
      spec?.bodyHeight,
      BODY_PROP_MIN,
      BODY_PROP_MAX,
      1
    ),
    length: clampFloat(
      spec?.bodyLength,
      BODY_PROP_MIN,
      BODY_PROP_MAX,
      1
    ),
  };
}

/** Ensure nested spec object exists for the editor + mesh builder. */
function ensureSpecShape(s) {
  if (!s.head) s.head = {};
  const h = s.head;
  h.eyes = h.eyes || {
    count: 2,
    colour: "#3344aa",
    size: "medium",
    location: "front",
  };
  h.antennae = h.antennae || {
    count: 0,
    colour: "#666666",
    size: "small",
    location: "top",
  };
  h.ears = h.ears || {
    count: 2,
    colour: "#aa8866",
    size: "medium",
    location: "side",
  };
  s.arms = s.arms || {
    count: 2,
    length: "medium",
    colour: "#ccaa88",
    type: "paws",
  };
  if (
    !s.bodyColour ||
    typeof s.bodyColour !== "string" ||
    !String(s.bodyColour).trim()
  ) {
    s.bodyColour = s.arms.colour || "#ccaa88";
  }
  s.bodyWidth = clampFloat(s.bodyWidth, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  s.bodyHeight = clampFloat(s.bodyHeight, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  s.bodyLength = clampFloat(s.bodyLength, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  if (
    !s.hairColour ||
    typeof s.hairColour !== "string" ||
    !String(s.hairColour).trim()
  ) {
    s.hairColour = "#553322";
  }
  s.backAttachment = s.backAttachment || {
    size: "medium",
    visualScale: 1,
    colour: "#8899aa",
    position: "upper",
    type: "none",
  };
  s.backAttachment.visualScale = clampFloat(
    s.backAttachment.visualScale,
    0.5,
    1.5,
    1
  );
  s.tail = s.tail || {
    count: 1,
    colour: "#887766",
    length: "medium",
    type: "normal",
  };
}

/**
 * Silhouette defaults for certain body plans (also applied when the plan changes in the UI).
 * Quadruped: longer, lower body; Humanoid: narrow, tall, long, two arms, no back/tail; Avian: wings instead of paws; Aquatic: no legs (see legCountForPlan), longer body, dorsal fin, fins.
 */
function applyBodyPlanDefaults(spec) {
  if (!spec) return;
  ensureSpecShape(spec);
  const plan = spec.bodyPlan || "Bipedal";
  switch (plan) {
    case "Quadruped":
      spec.bodyWidth = 1;
      spec.bodyHeight = 0.76;
      spec.bodyLength = 1.38;
      break;
    case "Humanoid":
      spec.bodyWidth = 0.82;
      spec.bodyHeight = 1.18;
      spec.bodyLength = 1.14;
      spec.arms.count = 2;
      spec.arms.type = "paws";
      spec.backAttachment.type = "none";
      spec.tail.type = "none";
      spec.tail.count = 0;
      break;
    case "Avian/Flying":
      spec.arms.type = "wings";
      spec.arms.count = 2;
      break;
    case "Aquatic":
      spec.bodyWidth = 1;
      spec.bodyHeight = 0.8;
      spec.bodyLength = 1.32;
      spec.arms.type = "fins";
      spec.arms.count = 2;
      spec.backAttachment.type = "dorsal fin";
      spec.backAttachment.position = "upper";
      break;
    default:
      break;
  }
  spec.bodyWidth = clampFloat(spec.bodyWidth, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  spec.bodyHeight = clampFloat(spec.bodyHeight, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  spec.bodyLength = clampFloat(spec.bodyLength, BODY_PROP_MIN, BODY_PROP_MAX, 1);
}

function optionListHtml(options, selected) {
  return options
    .map(
      (o) =>
        `<option value="${escapeHtml(o)}"${o === selected ? " selected" : ""}>${escapeHtml(o)}</option>`
    )
    .join("");
}

function safeOpt(allowed, v, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function buildSpecPanelHTML(spec, session) {
  ensureSpecShape(spec);
  const h = spec.head;
  const prof = session.profile || {};
  const sb = safeOpt(BODY_PLANS, spec.bodyPlan, "Bipedal");
  const sg = safeOpt(SPEC_GENDERS, spec.gender, "Other");
  const sh = safeOpt(HAIRCUT_OPTS, spec.haircut, "Layered");
  const sn = safeOpt(NOSE_OPTS, h.nose, "Nose");
  const sm = safeOpt(MOUTH_OPTS, h.mouth, "Normal");
  const saLen = safeOpt(ARM_LEN_OPTS, spec.arms.length, "medium");
  const saType = safeOpt(ARM_TYPES, spec.arms.type, "paws");
  const bkSz = safeOpt(BACK_SIZE_OPTS, spec.backAttachment.size, "medium");
  const bkPos = safeOpt(BACK_POS_OPTS, spec.backAttachment.position, "upper");
  const bkTy = safeOpt(BACK_TYPES, spec.backAttachment.type, "none");
  const tlLen = safeOpt(ARM_LEN_OPTS, spec.tail.length, "medium");
  const tlTy = safeOpt(TAIL_TYPES, spec.tail.type, "normal");
  const bw = clampFloat(spec.bodyWidth, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  const bh = clampFloat(spec.bodyHeight, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  const bl = clampFloat(spec.bodyLength, BODY_PROP_MIN, BODY_PROP_MAX, 1);
  const bkVs = clampFloat(spec.backAttachment.visualScale ?? 1, 0.5, 1.5, 1);

  return `
    <h2>What the model sees</h2>
    <p class="creator-panel-lead">Creature type and pronouns (same as the hatchery). Display name, story, and personality meters are on the right. Editing here does not call the server again.</p>
    <fieldset class="creator-fieldset">
      <legend>Creature &amp; pronouns</legend>
      <div class="creator-field-row">
        <label for="ctx-creatureType">Creature type</label>
        <textarea id="ctx-creatureType" rows="2">${escapeHtml(session.creatureType || "")}</textarea>
      </div>
      <div class="creator-field-row creator-field-row--palette">
        ${buildCreatorPaletteSelectHtml(spec)}
        <p class="creator-palette-hint">Applies harmonious colours to body, limbs, eyes, antennae, ears, back, and tail.</p>
      </div>
      <div class="creator-field-row">
        <label for="ctx-gender">Pronouns / gender (form)</label>
        <select id="ctx-gender">
          <option value="" ${prof.gender === "" ? "selected" : ""}>Choose…</option>
          <option value="female" ${prof.gender === "female" ? "selected" : ""}>She / her</option>
          <option value="male" ${prof.gender === "male" ? "selected" : ""}>He / him</option>
          <option value="nonbinary" ${prof.gender === "nonbinary" ? "selected" : ""}>They / them</option>
          <option value="other" ${prof.gender === "other" ? "selected" : ""}>Other / ask</option>
          <option value="MM" ${prof.gender === "MM" ? "selected" : ""}>MM</option>
        </select>
      </div>
    </fieldset>

    <h2>Creature design (3D)</h2>
    <p class="creator-panel-lead">These fields drive the low-poly mesh. Changes update the preview immediately.</p>
    <details class="creator-fieldset creator-design-acc" open>
      <summary class="creator-design-acc-summary">Body</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-bodyPlan">Body plan</label>
          <select id="design-bodyPlan">${optionListHtml(BODY_PLANS, sb)}</select>
        </div>
        <div>
          <label for="design-gender">Gender (design)</label>
          <select id="design-gender">${optionListHtml(SPEC_GENDERS, sg)}</select>
        </div>
      </div>
      <div class="creator-field-row">
        <label for="design-haircut">Haircut</label>
        <select id="design-haircut">${optionListHtml(HAIRCUT_OPTS, sh)}</select>
      </div>
      <div class="creator-field-row">
        <label for="design-hair-colour">Hair colour</label>
        <input type="color" id="design-hair-colour" value="${hexForColorInput(spec.hairColour)}" />
      </div>
      <div class="creator-field-row">
        <label for="design-body-colour">Body colour</label>
        <input type="color" id="design-body-colour" value="${hexForColorInput(spec.bodyColour)}" />
      </div>
      <div class="creator-field-row creator-field-row--slider">
        <label for="design-body-width">Wider / narrower <span class="creator-slider-val" id="design-body-width-val">${bw.toFixed(2)}</span></label>
        <input type="range" id="design-body-width" min="${BODY_PROP_MIN}" max="${BODY_PROP_MAX}" step="0.05" value="${bw}" />
      </div>
      <div class="creator-field-row creator-field-row--slider">
        <label for="design-body-height">Taller / shorter <span class="creator-slider-val" id="design-body-height-val">${bh.toFixed(2)}</span></label>
        <input type="range" id="design-body-height" min="${BODY_PROP_MIN}" max="${BODY_PROP_MAX}" step="0.05" value="${bh}" />
      </div>
      <div class="creator-field-row creator-field-row--slider">
        <label for="design-body-length">Longer / shorter (front–back) <span class="creator-slider-val" id="design-body-length-val">${bl.toFixed(2)}</span></label>
        <input type="range" id="design-body-length" min="${BODY_PROP_MIN}" max="${BODY_PROP_MAX}" step="0.05" value="${bl}" />
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Eyes</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-eyes-count">Count</label>
          <input type="number" id="design-eyes-count" min="0" max="8" value="${h.eyes.count ?? 2}" />
        </div>
        <div>
          <label for="design-eyes-colour">Colour</label>
          <input type="color" id="design-eyes-colour" value="${hexForColorInput(h.eyes.colour)}" />
        </div>
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-eyes-size">Size</label>
          <select id="design-eyes-size">${optionListHtml(SIZE_OPTS, safeOpt(SIZE_OPTS, h.eyes.size, "medium"))}</select>
        </div>
        <div>
          <label for="design-eyes-location">Location</label>
          <select id="design-eyes-location">${optionListHtml(LOC_FRONT_SIDE, safeOpt(LOC_FRONT_SIDE, h.eyes.location, "front"))}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Antennae</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-ant-count">Count</label>
          <input type="number" id="design-ant-count" min="0" max="8" value="${h.antennae.count ?? 0}" />
        </div>
        <div>
          <label for="design-ant-colour">Colour</label>
          <input type="color" id="design-ant-colour" value="${hexForColorInput(h.antennae.colour)}" />
        </div>
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-ant-size">Size</label>
          <select id="design-ant-size">${optionListHtml(SIZE_OPTS, safeOpt(SIZE_OPTS, h.antennae.size, "small"))}</select>
        </div>
        <div>
          <label for="design-ant-location">Location</label>
          <select id="design-ant-location">${optionListHtml(LOC_TOP_SIDE, safeOpt(LOC_TOP_SIDE, h.antennae.location, "top"))}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Ears</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-ears-count">Count</label>
          <input type="number" id="design-ears-count" min="0" max="8" value="${h.ears.count ?? 2}" />
        </div>
        <div>
          <label for="design-ears-colour">Colour</label>
          <input type="color" id="design-ears-colour" value="${hexForColorInput(h.ears.colour)}" />
        </div>
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-ears-size">Size</label>
          <select id="design-ears-size">${optionListHtml(SIZE_OPTS, safeOpt(SIZE_OPTS, h.ears.size, "medium"))}</select>
        </div>
        <div>
          <label for="design-ears-location">Location</label>
          <select id="design-ears-location">${optionListHtml(LOC_FRONT_SIDE, safeOpt(LOC_FRONT_SIDE, h.ears.location, "side"))}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Face</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-nose">Nose</label>
          <select id="design-nose">${optionListHtml(NOSE_OPTS, sn)}</select>
        </div>
        <div>
          <label for="design-mouth">Mouth</label>
          <select id="design-mouth">${optionListHtml(MOUTH_OPTS, sm)}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Arms</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-arms-count">Count</label>
          <input type="number" id="design-arms-count" min="0" max="6" value="${spec.arms.count ?? 2}" />
        </div>
        <div>
          <label for="design-arms-length">Length</label>
          <select id="design-arms-length">${optionListHtml(ARM_LEN_OPTS, saLen)}</select>
        </div>
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-arms-colour">Colour</label>
          <input type="color" id="design-arms-colour" value="${hexForColorInput(spec.arms.colour)}" />
        </div>
        <div>
          <label for="design-arms-type">Type</label>
          <select id="design-arms-type">${optionListHtml(ARM_TYPES, saType)}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Back attachment</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-back-size">Size</label>
          <select id="design-back-size">${optionListHtml(BACK_SIZE_OPTS, bkSz)}</select>
        </div>
        <div>
          <label for="design-back-position">Position</label>
          <select id="design-back-position">${optionListHtml(BACK_POS_OPTS, bkPos)}</select>
        </div>
      </div>
      <div class="creator-field-row creator-field-row--slider">
        <label for="design-back-visual-scale">Visual size <span id="design-back-visual-scale-val">${bkVs.toFixed(2)}</span></label>
        <input type="range" id="design-back-visual-scale" min="0.5" max="1.5" step="0.05" value="${bkVs}" />
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-back-colour">Colour</label>
          <input type="color" id="design-back-colour" value="${hexForColorInput(spec.backAttachment.colour)}" />
        </div>
        <div>
          <label for="design-back-type">Type</label>
          <select id="design-back-type">${optionListHtml(BACK_TYPES, bkTy)}</select>
        </div>
      </div>
      </div>
    </details>
    <details class="creator-fieldset creator-design-acc">
      <summary class="creator-design-acc-summary">Tail</summary>
      <div class="creator-design-acc-panel">
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-tail-count">Count</label>
          <input type="number" id="design-tail-count" min="0" max="4" value="${spec.tail.count ?? 1}" />
        </div>
        <div>
          <label for="design-tail-length">Length</label>
          <select id="design-tail-length">${optionListHtml(ARM_LEN_OPTS, tlLen)}</select>
        </div>
      </div>
      <div class="creator-field-row creator-field-row--inline2">
        <div>
          <label for="design-tail-colour">Colour</label>
          <input type="color" id="design-tail-colour" value="${hexForColorInput(spec.tail.colour)}" />
        </div>
        <div>
          <label for="design-tail-type">Type</label>
          <select id="design-tail-type">${optionListHtml(TAIL_TYPES, tlTy)}</select>
        </div>
      </div>
      </div>
    </details>
  `;
}

/** Single-open accordion for 3D design sections (Body starts open). */
function wireCreatorDesignAccordion() {
  const panel = document.getElementById("creator-spec-panel");
  if (!panel) return;
  const blocks = panel.querySelectorAll("details.creator-design-acc");
  blocks.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      blocks.forEach((other) => {
        if (other !== d) other.open = false;
      });
    });
  });
}

function pullContextFromPanelInto(session) {
  const g = (id) => document.getElementById(id)?.value ?? "";
  session.creatureType = g("ctx-creatureType").trim();
  const nameEl = document.getElementById("creator-display-name");
  session.displayName = (nameEl?.value ?? "").trim();
  if (!session.profile) session.profile = {};
  session.profile.gender = g("ctx-gender");
}

function pullDesignFromPanelInto(spec) {
  ensureSpecShape(spec);
  const h = spec.head;
  spec.bodyPlan = document.getElementById("design-bodyPlan")?.value || spec.bodyPlan;
  spec.gender = document.getElementById("design-gender")?.value || spec.gender;
  spec.haircut = document.getElementById("design-haircut")?.value || spec.haircut;
  spec.hairColour = hexForColorInput(
    document.getElementById("design-hair-colour")?.value
  );
  spec.bodyColour = hexForColorInput(
    document.getElementById("design-body-colour")?.value
  );
  spec.bodyWidth = clampFloat(
    document.getElementById("design-body-width")?.valueAsNumber,
    BODY_PROP_MIN,
    BODY_PROP_MAX,
    spec.bodyWidth
  );
  spec.bodyHeight = clampFloat(
    document.getElementById("design-body-height")?.valueAsNumber,
    BODY_PROP_MIN,
    BODY_PROP_MAX,
    spec.bodyHeight
  );
  spec.bodyLength = clampFloat(
    document.getElementById("design-body-length")?.valueAsNumber,
    BODY_PROP_MIN,
    BODY_PROP_MAX,
    spec.bodyLength
  );

  h.eyes.count = clampInt(
    document.getElementById("design-eyes-count")?.value,
    0,
    8,
    2
  );
  h.eyes.colour = hexForColorInput(
    document.getElementById("design-eyes-colour")?.value
  );
  h.eyes.size = document.getElementById("design-eyes-size")?.value || "medium";
  h.eyes.location =
    document.getElementById("design-eyes-location")?.value || "front";

  h.antennae.count = clampInt(
    document.getElementById("design-ant-count")?.value,
    0,
    8,
    0
  );
  h.antennae.colour = hexForColorInput(
    document.getElementById("design-ant-colour")?.value
  );
  h.antennae.size =
    document.getElementById("design-ant-size")?.value || "small";
  h.antennae.location =
    document.getElementById("design-ant-location")?.value || "top";

  h.ears.count = clampInt(
    document.getElementById("design-ears-count")?.value,
    0,
    8,
    0
  );
  h.ears.colour = hexForColorInput(
    document.getElementById("design-ears-colour")?.value
  );
  h.ears.size = document.getElementById("design-ears-size")?.value || "medium";
  h.ears.location =
    document.getElementById("design-ears-location")?.value || "side";

  h.nose = document.getElementById("design-nose")?.value || "Nose";
  h.mouth = document.getElementById("design-mouth")?.value || "Normal";

  spec.arms.count = clampInt(
    document.getElementById("design-arms-count")?.value,
    0,
    6,
    2
  );
  spec.arms.length =
    document.getElementById("design-arms-length")?.value || "medium";
  spec.arms.colour = hexForColorInput(
    document.getElementById("design-arms-colour")?.value
  );
  spec.arms.type =
    document.getElementById("design-arms-type")?.value || "paws";

  spec.backAttachment.size =
    document.getElementById("design-back-size")?.value || "medium";
  spec.backAttachment.visualScale = clampFloat(
    parseFloat(document.getElementById("design-back-visual-scale")?.value),
    0.5,
    1.5,
    1
  );
  spec.backAttachment.position =
    document.getElementById("design-back-position")?.value || "upper";
  spec.backAttachment.colour = hexForColorInput(
    document.getElementById("design-back-colour")?.value
  );
  spec.backAttachment.type =
    document.getElementById("design-back-type")?.value || "none";

  spec.tail.count = clampInt(
    document.getElementById("design-tail-count")?.value,
    0,
    4,
    1
  );
  spec.tail.length =
    document.getElementById("design-tail-length")?.value || "medium";
  spec.tail.colour = hexForColorInput(
    document.getElementById("design-tail-colour")?.value
  );
  spec.tail.type =
    document.getElementById("design-tail-type")?.value || "normal";
}

function syncCreatorHeader(session) {
  const t = document.getElementById("creator-title");
  if (t) {
    const dn = session.displayName?.trim();
    t.textContent = dn ? `${dn} — low-poly` : "Low-poly character";
  }
  const st = document.getElementById("creator-subtitle");
  if (st) st.textContent = (session.creatureType || "").trim();
}

/** Read-only story lines on the right (not editable). */
function fillStoryReadonly(session) {
  const prof = session.profile || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const s =
      val != null && String(val).trim() !== ""
        ? String(val).trim()
        : "—";
    el.textContent = s;
  };
  set("creator-ro-food", session.favouriteFood);
  set("creator-ro-fear", session.biggestFear);
  set("creator-ro-song", prof.favouriteSong);
  set("creator-ro-birth", prof.placeOfBirth);
  set("creator-ro-mbti", prof.myersBriggs);
  set("creator-ro-prop", prof.sillyProp);
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

/** Read-only bars — values from the hatchery session. */
function renderMeters(session) {
  const dynEl = document.getElementById("creator-meter-dynamic");
  const fixEl = document.getElementById("creator-meter-fixed");
  if (!dynEl || !fixEl) return;
  const m = session.meters || {};
  dynEl.innerHTML = DYNAMIC_METERS.map((spec) =>
    meterRowHtml({
      name: spec.name,
      left: spec.left,
      right: spec.right,
      value: m[spec.key],
      fixed: false,
    })
  ).join("");
  const f = session.fixedMeters || {};
  fixEl.innerHTML = FIXED_METERS.map((spec) =>
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

function hexToNum(s, fallback = 0x889977) {
  if (typeof s !== "string") return fallback;
  const m = s.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return parseInt(m[1], 16);
  return fallback;
}

function mkMat(hexStr, roughness = 0.88) {
  const c = new THREE.Color(hexToNum(hexStr));
  return new THREE.MeshStandardMaterial({
    color: c,
    flatShading: true,
    roughness,
    metalness: 0.04,
  });
}

function sizeMul(size) {
  if (size === "small") return 0.68;
  if (size === "large") return 1.32;
  return 1;
}

function lenMul(len) {
  if (len === "short") return 0.75;
  if (len === "long") return 1.35;
  return 1;
}

function backSizeMul(size) {
  if (size === "small") return 0.75;
  if (size === "large") return 1.25;
  return 1;
}

/** Extra multiplier from creator slider (0.5–1.5), default 1. */
function backVisualScaleMul(spec) {
  const b = spec?.backAttachment;
  const v = b && typeof b.visualScale === "number" ? b.visualScale : 1;
  return Math.max(0.5, Math.min(1.5, v));
}

/**
 * Point on the torso ellipsoid (x=0 slice) and outward unit normal, world space.
 * Matches scaled icosahedron torso: semi-axes Rx,Ry,Rz = BODY_GEOM_R * (sx,sy,sz).
 */
function dorsalSurfaceTorso(bodyY, sx, sy, sz, position) {
  const Ry = BODY_GEOM_R * sy;
  const Rz = BODY_GEOM_R * sz;
  let fracFromCenter;
  if (position === "lower") fracFromCenter = -0.42;
  else if (position === "mid") fracFromCenter = 0.06;
  else fracFromCenter = 0.64;
  const yLocal = fracFromCenter * Ry;
  const ny = Math.max(-0.999, Math.min(0.999, yLocal / Ry));
  const z = -Rz * Math.sqrt(Math.max(0, 1 - ny * ny));
  const gy = yLocal;
  const gz = z;
  let nyl = gy / (Ry * Ry);
  let nz = gz / (Rz * Rz);
  const gl = Math.hypot(nyl, nz) || 1;
  nyl /= gl;
  nz /= gl;
  return {
    x: 0,
    y: bodyY + yLocal,
    z: gz,
    nx: 0,
    ny: nyl,
    nz,
  };
}

/** Back face of arthropod thorax box; outward normal is −Z. */
function dorsalSurfaceThoraxBox(bodyY, th, td, position) {
  const halfH = th * 0.5;
  let frac;
  if (position === "lower") frac = -0.78;
  else if (position === "mid") frac = 0.06;
  else frac = 0.82;
  const y = bodyY + frac * halfH;
  const z = -td * 0.5 - 0.012;
  return { x: 0, y, z, nx: 0, ny: 0, nz: -1 };
}

function backTangentAndBitangent(nx, ny, nz) {
  const n = new THREE.Vector3(nx, ny, nz).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let t = new THREE.Vector3().crossVectors(up, n);
  if (t.lengthSq() < 1e-4) t.crossVectors(new THREE.Vector3(1, 0, 0), n);
  t.normalize();
  const b = new THREE.Vector3().crossVectors(n, t).normalize();
  return { t, b, n };
}

function legCountForPlan(plan) {
  switch (plan) {
    case "Quadruped":
      return 4;
    case "Serpentine":
      return 0;
    case "Arthropod-like":
      return 6;
    case "Aquatic":
      return 0;
    case "Avian/Flying":
    case "Bipedal":
    case "Humanoid":
    default:
      return 2;
  }
}

/**
 * Lowest point on the scaled torso icosahedron at horizontal (x, z), in world Y.
 * Body center (0, bodyY, 0); semi-axes R*sx, R*sy, R*sz with R = BODY_GEOM_R.
 */
function bodyUndersideY(x, z, bodyY, sx, sy, sz) {
  const R = BODY_GEOM_R;
  const nx = x / (R * sx);
  const nz = z / (R * sz);
  const inner = 1 - nx * nx - nz * nz;
  if (inner <= 1e-5) return bodyY - R * sy * 0.92;
  return bodyY - R * sy * Math.sqrt(inner);
}

function addCylinderLeg(parent, x, z, mat, lenScale, bodyY, sx, sy, sz) {
  const surfY = bodyUndersideY(x, z, bodyY, sx, sy, sz);
  const overlap = 0.02 * lenScale;
  const halfH = 0.275 * lenScale;
  const cy = surfY - overlap - halfH;
  const g = new THREE.CylinderGeometry(0.07, 0.05, 0.55 * lenScale, 5, 1);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, cy, z);
  parent.add(mesh);
}

/** One side of a hexapod: femur + tibia splayed outward (insect / spider style). */
function addArthropodLeg(parent, mat, lenScale, side, tw, yAttach, zBody) {
  const grp = new THREE.Group();
  const outward = side;
  const fLen = 0.16 * lenScale;
  const tLen = 0.36 * lenScale;
  const xBase = side * (tw * 0.5 - 0.018);
  const femur = new THREE.Mesh(
    new THREE.CylinderGeometry(0.046, 0.04, fLen, 6, 1),
    mat
  );
  const tibia = new THREE.Mesh(
    new THREE.CylinderGeometry(0.034, 0.028, tLen, 6, 1),
    mat
  );
  femur.rotation.z = outward * 1.08;
  femur.rotation.x = 0.78;
  femur.position.set(outward * 0.025, -fLen * 0.36, 0);
  tibia.position.set(outward * 0.17, -fLen * 0.65 - tLen * 0.4, 0.02);
  tibia.rotation.z = outward * 0.32;
  tibia.rotation.x = 0.12;
  grp.add(femur);
  grp.add(tibia);
  grp.position.set(xBase, yAttach, zBody);
  parent.add(grp);
}

function addWingPair(parent, colourHex, scale, opts = {}) {
  const span = opts.spanX != null ? opts.spanX : 0.55 * scale;
  const wingMat = mkMat(colourHex, 0.75);
  const w = 0.95 * scale;
  const h = 0.42 * scale;
  const t = 0.065 * scale;
  const geom = new THREE.BoxGeometry(w, h, t, 12, 8, 2);
  const hasSurf =
    opts.x != null &&
    opts.y != null &&
    opts.z != null &&
    opts.nx != null &&
    opts.ny != null &&
    opts.nz != null;

  if (hasSurf) {
    const n = new THREE.Vector3(opts.nx, opts.ny, opts.nz).normalize();
    const { t: tang, b: bit } = backTangentAndBitangent(
      opts.nx,
      opts.ny,
      opts.nz
    );
    const skin = 0.06 * scale;
    const p = new THREE.Vector3(opts.x, opts.y, opts.z);
    p.addScaledVector(n, skin);
    const grp = new THREE.Group();
    grp.position.copy(p);
    const rotMat = new THREE.Matrix4().makeBasis(tang, bit, n);
    grp.quaternion.setFromRotationMatrix(rotMat);
    const left = new THREE.Mesh(geom, wingMat);
    left.position.set(-span, 0, 0);
    left.rotation.y = Math.PI / 2 + 0.35;
    grp.add(left);
    const right = new THREE.Mesh(geom, wingMat);
    right.position.set(span, 0, 0);
    right.rotation.y = -Math.PI / 2 - 0.35;
    grp.add(right);
    parent.add(grp);
    return;
  }

  const wingY = opts.y != null ? opts.y : 0.75;
  const z0 = opts.z != null ? opts.z : -0.1;
  const left = new THREE.Mesh(geom, wingMat);
  left.position.set(-span, wingY, z0);
  left.rotation.y = Math.PI / 2 + 0.35;
  parent.add(left);
  const right = new THREE.Mesh(geom, wingMat);
  right.position.set(span, wingY, z0);
  right.rotation.y = -Math.PI / 2 - 0.35;
  parent.add(right);
}

/** surf: { x, y, z, nx, ny, nz } — attachment point and outward normal (world). */
function addDorsalFin(parent, colourHex, scale, surf) {
  const h = 0.55 * scale;
  const r = 0.08 * scale;
  const g = new THREE.ConeGeometry(r, h, 4);
  const mesh = new THREE.Mesh(g, mkMat(colourHex));
  const n = new THREE.Vector3(surf.nx, surf.ny, surf.nz).normalize();
  const skin = 0.02 * scale;
  const p = new THREE.Vector3(surf.x, surf.y, surf.z);
  mesh.position.copy(p).addScaledVector(n, skin + h * 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  parent.add(mesh);
}

function buildHeadFeatures(headGroup, spec, headRadius = 0.38) {
  const h = spec?.head && typeof spec.head === "object" ? spec.head : {};
  const eyes = h.eyes && typeof h.eyes === "object" ? h.eyes : {};
  const antennae =
    h.antennae && typeof h.antennae === "object" ? h.antennae : {};
  const ears = h.ears && typeof h.ears === "object" ? h.ears : {};
  const eyeCol = eyes.colour || "#3344aa";
  const eyeSize = 0.09 * sizeMul(eyes.size || "medium");
  const R = Math.max(0.12, headRadius);
  const s = R / 0.38;
  const n = Math.min(8, Math.max(0, Number(eyes.count) || 2));
  const eyeY = 0.06 * s;
  const halfWant = (eyes.location === "side" ? 0.36 : 0.21) * s;
  const maxHalf = Math.sqrt(Math.max(0, R * R - eyeY * eyeY)) - eyeSize * 0.35;
  const half = Math.max(0.02, Math.min(halfWant, maxHalf));
  for (let i = 0; i < n; i++) {
    const eg = new THREE.IcosahedronGeometry(eyeSize, 0);
    const em = new THREE.Mesh(eg, mkMat(eyeCol, 0.5));
    let x;
    if (n === 1) {
      x = 0;
    } else {
      x = -half + (2 * half * i) / Math.max(n - 1, 1);
    }
    const y = eyeY;
    const rr = R * R - x * x - y * y;
    const z = Math.sqrt(Math.max(1e-6, rr)) + eyeSize * 0.15;
    em.position.set(x, y, z);
    headGroup.add(em);
  }

  const antN = Math.min(8, Number(antennae.count) || 0);
  for (let i = 0; i < antN; i++) {
    const ag = new THREE.ConeGeometry(
      0.03,
      0.35 * sizeMul(antennae.size || "small"),
      4
    );
    const am = new THREE.Mesh(ag, mkMat(antennae.colour || "#888888"));
    const sx = antN > 1 ? -0.12 + (i / (antN - 1 || 1)) * 0.24 : 0;
    am.position.set(sx, 0.52, 0);
    am.rotation.z = antennae.location === "side" ? Math.PI / 6 : 0;
    headGroup.add(am);
  }

  const earN = Math.min(8, Number(ears.count) || 0);
  for (let i = 0; i < earN; i++) {
    const earLen = 0.22 * sizeMul(ears.size || "medium");
    const eg = new THREE.ConeGeometry(0.1 * s, earLen, 5);
    const em = new THREE.Mesh(eg, mkMat(ears.colour || "#aa8866"));
    const side = i % 2 === 0 ? -1 : 1;
    const slot = Math.floor(i / 2);
    const earY = (0.075 + slot * 0.065) * s;
    const rAtY = Math.sqrt(Math.max(1e-6, R * R - earY * earY));
    let ex;
    let ez;
    if (ears.location === "front") {
      ez = Math.min(0.88 * rAtY, R * 0.92);
      ex = side * Math.sqrt(Math.max(1e-6, R * R - earY * earY - ez * ez));
    } else {
      ex = side * 0.93 * rAtY;
      ez = Math.sqrt(Math.max(1e-6, R * R - ex * ex - earY * earY));
    }
    const p = new THREE.Vector3(ex, earY, ez);
    const n = p.clone().normalize();
    em.position.copy(p).addScaledVector(n, earLen * 0.02);
    em.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    headGroup.add(em);
  }

  const nose = h.nose || "Nose";
  if (nose === "Beak") {
    const bg = new THREE.ConeGeometry(0.12, 0.35, 4);
    const bm = new THREE.Mesh(bg, mkMat("#ccaa88"));
    bm.position.set(0, 0, 0.55);
    bm.rotation.x = Math.PI / 2;
    headGroup.add(bm);
  } else if (nose === "Snout") {
    const bg = new THREE.BoxGeometry(0.22, 0.14, 0.28);
    const bm = new THREE.Mesh(bg, mkMat("#bbaa99"));
    bm.position.set(0, -0.05, 0.48);
    headGroup.add(bm);
  } else if (nose === "Proboscis") {
    const bg = new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5);
    const bm = new THREE.Mesh(bg, mkMat("#aa9988"));
    bm.position.set(0, 0.05, 0.58);
    bm.rotation.x = Math.PI / 2;
    headGroup.add(bm);
  } else {
    const bg = new THREE.IcosahedronGeometry(0.08, 0);
    const bm = new THREE.Mesh(bg, mkMat("#bbaa99"));
    bm.position.set(0, 0, 0.46);
    headGroup.add(bm);
  }

  const mouth = h.mouth || "Normal";
  if (mouth === "Tusks" || mouth === "Fangs") {
    for (const sx of [-0.08, 0.08]) {
      const tg = new THREE.ConeGeometry(0.04, 0.14, 4);
      const tm = new THREE.Mesh(tg, mkMat("#f0f0f0"));
      tm.position.set(sx, -0.18, 0.42);
      tm.rotation.x = -Math.PI / 2 + 0.2;
      headGroup.add(tm);
    }
  } else if (mouth === "whiskers") {
    for (let w = 0; w < 4; w++) {
      const wg = new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4);
      const wm = new THREE.Mesh(wg, mkMat("#444444"));
      wm.position.set(-0.15 + w * 0.1, -0.1, 0.48);
      wm.rotation.z = Math.PI / 2;
      headGroup.add(wm);
    }
  }

  return headGroup;
}

/**
 * Hair meshes live in headGroup local space (head icosa centered at origin).
 * All positions and sizes scale with headRadius so hair stays on the crown for any body plan.
 */
function addHair(headGroup, spec, headRadius = 0.38) {
  const R = Math.max(0.12, headRadius);
  /** Match buildHeadFeatures scaling — reference head radius 0.38 */
  const s = R / 0.38;
  const style = spec?.haircut || "Layered";
  if (style === "Bald") return;
  const hairMat = mkMat(hexForColorInput(spec?.hairColour || "#553322"), 0.92);
  const topY = 0.48 * s;
  if (style === "Mohawk") {
    for (let i = 0; i < 5; i++) {
      const cg = new THREE.ConeGeometry(0.06 * s, 0.28 * s, 4);
      const cm = new THREE.Mesh(cg, hairMat);
      cm.position.set((-0.16 + i * 0.08) * s, topY + 0.1 * s, 0);
      headGroup.add(cm);
    }
  } else if (style === "Spiky") {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rx = Math.cos(ang) * 0.2 * s;
      const rz = Math.sin(ang) * 0.17 * s;
      const cg = new THREE.ConeGeometry(0.055 * s, 0.26 * s, 4);
      const cm = new THREE.Mesh(cg, hairMat);
      cm.position.set(rx, topY + 0.09 * s, rz);
      cm.rotation.z = -Math.cos(ang) * 0.4;
      cm.rotation.x = Math.sin(ang) * 0.28;
      headGroup.add(cm);
    }
  } else if (style === "Curly") {
    const nCurls = 20;
    const shellR = 0.37 * s;
    const curlBase = 0.056 * s;
    const layers = 4;
    const perRing = 5;
    let k = 0;
    for (let ring = 0; ring < layers; ring++) {
      const ly = 0.88 - ring * 0.2;
      const ringR = Math.sqrt(Math.max(0, 1 - ly * ly)) * shellR;
      const y = topY - 0.04 * s + ly * 0.38 * s;
      const phase = ring * 0.62;
      for (let j = 0; j < perRing; j++) {
        const ang = phase + (j / perRing) * Math.PI * 2;
        const x = Math.cos(ang) * ringR;
        const z = Math.sin(ang) * ringR;
        const g = new THREE.IcosahedronGeometry(
          curlBase * (0.88 + (k % 5) * 0.04),
          0
        );
        const m = new THREE.Mesh(g, hairMat);
        m.position.set(x, y, z);
        m.rotation.set(k * 0.41, k * 0.67, k * 0.29);
        headGroup.add(m);
        k++;
      }
    }
  } else if (style === "Afro/fluffy") {
    const ag = new THREE.IcosahedronGeometry(0.35 * s, 0);
    const am = new THREE.Mesh(ag, hairMat);
    am.position.set(0, topY + 0.12 * s, 0);
    headGroup.add(am);
  } else if (style === "Long and flowing") {
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.4 * s, 0),
      hairMat
    );
    cap.position.set(0, topY + 0.03 * s, 0);
    cap.scale.set(1.1, 0.36, 1.08);
    headGroup.add(cap);

    const strandH = 0.98 * s;
    const rTip = 0.05 * s;
    const locks = 8;
    for (let i = 0; i < locks; i++) {
      const u = locks > 1 ? i / (locks - 1) : 0.5;
      const angle = (u - 0.5) * 2.15;
      const bx = Math.sin(angle) * 0.4 * s;
      const bz = -0.2 * s - Math.cos(angle) * 0.22 * s;
      const cg = new THREE.ConeGeometry(rTip * 1.15, strandH, 5);
      const m = new THREE.Mesh(cg, hairMat);
      const ay = topY - 0.06 * s;
      m.position.set(bx, ay - strandH * 0.18, bz);
      m.rotation.order = "YXZ";
      m.rotation.x = Math.PI * 0.58 + Math.abs(Math.sin(angle)) * 0.12;
      m.rotation.y = -angle * 0.62;
      m.rotation.z = Math.sin(angle) * 0.35;
      headGroup.add(m);
    }

    const sideH = 0.82 * s;
    const sideR = 0.042 * s;
    for (const side of [-1, 1]) {
      const sg = new THREE.ConeGeometry(sideR * 1.1, sideH, 5);
      const sm = new THREE.Mesh(sg, hairMat);
      sm.position.set(side * 0.36 * s, topY - 0.12 * s, 0.08 * s);
      sm.rotation.order = "YXZ";
      sm.rotation.x = Math.PI * 0.48;
      sm.rotation.y = side * 0.55;
      sm.rotation.z = side * 0.75;
      headGroup.add(sm);
    }
  } else if (style === "Braided") {
    for (let i = 0; i < 3; i++) {
      const bg = new THREE.ConeGeometry(0.07 * s, 0.5 * s, 4);
      const bm = new THREE.Mesh(bg, hairMat);
      bm.position.set((-0.12 + i * 0.12) * s, topY - 0.15 * s, -0.25 * s);
      bm.rotation.x = 0.5;
      headGroup.add(bm);
    }
  } else {
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42 * s, 0),
      hairMat
    );
    cap.position.set(0, topY + 0.05 * s, 0);
    cap.scale.set(1.05, 0.45, 1.05);
    headGroup.add(cap);
  }
}

function addTailMesh(parent, spec, opts = {}) {
  const t =
    spec?.tail && typeof spec.tail === "object"
      ? spec.tail
      : { type: "none", count: 0, colour: "#887766", length: "medium" };
  if (t.type === "none" || (Number(t.count) || 0) <= 0) return;
  const tailMat = mkMat(t.colour || "#887766");
  const L = 0.55 * lenMul(t.length);
  const thick = t.type === "dragon" ? 0.18 : 0.1;
  const attachY = opts.attachY != null ? opts.attachY : 0.5;
  const backZ = opts.backZ != null ? opts.backZ : -0.65;
  const radial = opts.radial != null ? opts.radial : 0.15;
  if (t.type === "tentacles") {
    for (let i = 0; i < Math.min(4, t.count); i++) {
      const cg = new THREE.CylinderGeometry(0.04, 0.06, L, 5);
      const cm = new THREE.Mesh(cg, tailMat);
      const ang = (i / 4) * Math.PI * 2;
      cm.position.set(
        Math.cos(ang) * radial,
        attachY - 0.05,
        backZ + 0.1 - i * 0.05
      );
      cm.rotation.x = 0.8 + i * 0.1;
      cm.rotation.z = ang * 0.3;
      parent.add(cm);
    }
    return;
  }
  const tg =
    t.type === "dragon"
      ? new THREE.ConeGeometry(thick, L, 5)
      : new THREE.ConeGeometry(thick * 0.8, L, 4);
  const tm = new THREE.Mesh(tg, tailMat);
  tm.position.set(0, attachY, backZ);
  tm.rotation.x = -Math.PI / 2 + 0.15;
  parent.add(tm);
}

function addArms(parent, spec, opts = {}) {
  const a =
    spec?.arms && typeof spec.arms === "object" ? spec.arms : {};
  const armType = a.type || "none";
  const n = Math.min(6, Number(a.count) || 0);
  if (n <= 0 || armType === "none") return;
  const armMat = mkMat(a.colour || "#ccaa88");
  const alen = 0.42 * lenMul(a.length || "medium");
  const shoulderY = opts.shoulderY != null ? opts.shoulderY : 0.72;
  const spanX = opts.spanX != null ? opts.spanX : 0.55;
  const shoulderZ = opts.shoulderZ != null ? opts.shoulderZ : 0.1;
  if (armType === "wings") {
    addWingPair(parent, a.colour, 1, {
      y: shoulderY + 0.03,
      spanX,
      z: shoulderZ - 0.2,
    });
    return;
  }
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const ag =
      armType === "tentacles"
        ? new THREE.CylinderGeometry(0.05, 0.06, alen * 1.2, 5)
        : new THREE.CylinderGeometry(0.07, 0.06, alen, 5);
    const mesh = new THREE.Mesh(ag, armMat);
    mesh.position.set(side * spanX, shoulderY, shoulderZ);
    mesh.rotation.z = side * 0.65;
    parent.add(mesh);
  }
}

function addBackAttachment(parent, spec, opts = {}) {
  const b =
    spec?.backAttachment && typeof spec.backAttachment === "object"
      ? spec.backAttachment
      : { type: "none" };
  if (!b.type || b.type === "none") return;
  if (b.type === "wings" && spec?.arms?.type === "wings") return;
  const col = b.colour;
  const s = backSizeMul(b.size) * backVisualScaleMul(spec);
  const bodyY = opts.bodyY != null ? opts.bodyY : 0.52;
  const sy = opts.sy != null ? opts.sy : 0.82;
  const sx = opts.sx != null ? opts.sx : 1.15;
  const sz = opts.sz != null ? opts.sz : 1.22;
  const position =
    b.position === "lower" ? "lower" : b.position === "mid" ? "mid" : "upper";

  const thorax = opts.thorax;
  const surf =
    thorax && thorax.th != null && thorax.td != null
      ? dorsalSurfaceThoraxBox(thorax.bodyY ?? bodyY, thorax.th, thorax.td, position)
      : dorsalSurfaceTorso(bodyY, sx, sy, sz, position);

  const n = new THREE.Vector3(surf.nx, surf.ny, surf.nz).normalize();

  if (b.type === "wings") {
    addWingPair(parent, col, s, {
      x: surf.x,
      y: surf.y,
      z: surf.z,
      nx: surf.nx,
      ny: surf.ny,
      nz: surf.nz,
      spanX: 0.55 * sx * s,
    });
    return;
  }
  if (b.type === "dorsal fin") {
    addDorsalFin(parent, col, s, surf);
    return;
  }
  if (b.type === "shell") {
    const hg = new THREE.IcosahedronGeometry(0.4 * s, 0);
    const hm = new THREE.Mesh(hg, mkMat(col));
    const skin = 0.03 * s;
    const p = new THREE.Vector3(surf.x, surf.y, surf.z);
    p.addScaledVector(n, 0.18 * s + skin);
    hm.position.copy(p);
    hm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    hm.scale.set(1.1, 0.65, 0.9);
    parent.add(hm);
    return;
  }
  if (b.type === "quills") {
    const { t: tang, b: bit } = backTangentAndBitangent(
      surf.nx,
      surf.ny,
      surf.nz
    );
    const skin = 0.04 * s;
    for (let i = 0; i < 5; i++) {
      const qg = new THREE.ConeGeometry(0.04 * s, 0.35 * s, 4);
      const qm = new THREE.Mesh(qg, mkMat(col));
      const rowLift = (i / 4 - 0.5) * 0.08 * sy * s;
      const dx = (-0.2 + i * 0.1) * sx * s;
      const p = new THREE.Vector3(surf.x, surf.y, surf.z);
      p.addScaledVector(tang, dx);
      p.addScaledVector(bit, rowLift);
      p.addScaledVector(n, skin);
      qm.position.copy(p);
      qm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      parent.add(qm);
    }
    return;
  }
  if (b.type === "dermal plates") {
    const { t: tang } = backTangentAndBitangent(surf.nx, surf.ny, surf.nz);
    const skin = 0.03 * s;
    const halfD = 0.09 * s;
    for (let i = 0; i < 4; i++) {
      const pg = new THREE.BoxGeometry(0.12 * s, 0.06 * s, 0.18 * s);
      const pm = new THREE.Mesh(pg, mkMat(col));
      const dx = (-0.15 + i * 0.1) * sx * s;
      const p = new THREE.Vector3(surf.x, surf.y, surf.z);
      p.addScaledVector(tang, dx);
      p.addScaledVector(n, halfD + skin);
      pm.position.copy(p);
      pm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      parent.add(pm);
    }
  }
}

function createCreatureGroup(spec) {
  const root = new THREE.Group();
  const arms = spec?.arms && typeof spec.arms === "object" ? spec.arms : {};
  const armHexFallback =
    typeof arms.colour === "string" ? arms.colour : "#aa9988";
  const bodyHex =
    typeof spec?.bodyColour === "string" && String(spec.bodyColour).trim()
      ? spec.bodyColour
      : armHexFallback;
  const bodyMat = mkMat(bodyHex);
  const plan = spec?.bodyPlan || "Bipedal";

  const p = readBodyProportions(spec);

  if (plan === "Serpentine") {
    const rMul = (p.width + p.height) / 2;
    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const baseR = 0.32 + (i === segments - 1 ? 0.12 : 0);
      const r = baseR * rMul;
      const geo = new THREE.IcosahedronGeometry(r, 0);
      const mesh = new THREE.Mesh(geo, bodyMat);
      const t = i / (segments - 1 || 1);
      mesh.position.set(
        0,
        0.25 * p.height * Math.sin(t * Math.PI),
        (i * 0.36 - 0.9) * p.length
      );
      root.add(mesh);
    }
    const serpHeadR = 0.42 * rMul;
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(serpHeadR, 0),
      mkMat(bodyHex)
    );
    head.position.set(0, 0.35 * p.height, 0.85 * p.length);
    const hg = new THREE.Group();
    hg.add(head);
    buildHeadFeatures(hg, spec, serpHeadR);
    addHair(hg, spec, serpHeadR);
    root.add(hg);
    const serpY = 0.4 * p.height;
    const serpZ = (-0.55 - 0.35) * p.length;
    addTailMesh(root, spec, {
      attachY: serpY,
      backZ: serpZ,
      radial: 0.15 * p.width,
    });
    addBackAttachment(root, spec, {
      bodyY: 0.35 * p.height,
      sy: 0.55 * p.height,
      sx: 0.9 * p.width,
      sz: 1.1 * p.length,
    });
    return root;
  }

  if (plan === "Arthropod-like") {
    const bodyY = 0.38 * p.height;
    const tw = 0.68 * p.width;
    const th = 0.2 * p.height;
    const td = 0.46 * p.length;
    const thorax = new THREE.Mesh(
      new THREE.BoxGeometry(tw, th, td, 5, 2, 4),
      bodyMat
    );
    thorax.position.set(0, bodyY, 0);
    root.add(thorax);

    const abMul = (p.width + p.height) / 2;
    const ab1 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.13 * abMul, 1),
      bodyMat
    );
    ab1.scale.set(1.08 * p.width, 0.72 * p.height, 1.12 * p.length);
    ab1.position.set(0, bodyY + 0.02 * p.height, -0.24 * p.length - td * 0.38);
    root.add(ab1);
    const ab2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.11 * abMul, 1),
      bodyMat
    );
    ab2.scale.set(0.92 * p.width, 0.65 * p.height, 0.95 * p.length);
    ab2.position.set(0, bodyY - 0.03 * p.height, -0.4 * p.length - td * 0.42);
    root.add(ab2);

    const bodyTop = bodyY + th * 0.5;
    const headZ = 0.26 * p.length + td * 0.35;
    const headGrp = new THREE.Group();
    const arthHeadR = 0.3;
    const headMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(arthHeadR, 0),
      mkMat(bodyHex)
    );
    headMesh.position.set(0, 0, 0);
    headGrp.add(headMesh);
    buildHeadFeatures(headGrp, spec, arthHeadR);
    addHair(headGrp, spec, arthHeadR);
    headGrp.position.set(0, bodyTop + 0.1, headZ);
    root.add(headGrp);

    const ls = lenMul(arms.length);
    const legY = bodyY - th * 0.28;
    const zLegs = [0.15, 0, -0.14];
    for (const zf of zLegs) {
      const z = zf * p.length;
      addArthropodLeg(root, bodyMat, ls, 1, tw, legY, z);
      addArthropodLeg(root, bodyMat, ls, -1, tw, legY, z);
    }

    const shoulderY = bodyY + th * 0.15;
    const spanX = 0.2 * p.width;
    const shoulderZ = 0.28 * p.length;
    addArms(root, spec, { shoulderY, spanX, shoulderZ });
    addTailMesh(root, spec, {
      attachY: bodyY - 0.02 * p.height,
      backZ: -0.48 * p.length - td * 0.55,
      radial: 0.12 * p.width,
    });
    addBackAttachment(root, spec, {
      bodyY,
      sy: th * 1.35,
      sx: tw * 0.55,
      sz: td * 0.95,
      thorax: { bodyY, th, td },
    });
    return root;
  }

  let baseX = 1.15;
  let baseY = 0.82;
  let baseZ = 1.22;
  let bodyY = 0.52;
  if (plan === "Aquatic") {
    baseX = 1.35;
    baseY = 0.55;
    baseZ = 0.85;
    bodyY = 0.45;
  } else if (plan === "Avian/Flying") {
    baseX = 0.85;
    baseY = 0.75;
    baseZ = 1.05;
  }

  const sx = baseX * p.width;
  const sy = baseY * p.height;
  const sz = baseZ * p.length;

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BODY_GEOM_R, 0),
    bodyMat
  );
  body.scale.set(sx, sy, sz);
  body.position.y = bodyY;
  root.add(body);

  const bodyTop = bodyY + BODY_GEOM_R * sy;
  const neckGap = 0.17;
  const headZ = (0.18 / 1.22) * sz;

  const headGrp = new THREE.Group();
  const bipedHeadR = 0.38;
  const headMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(bipedHeadR, 0),
    mkMat(bodyHex)
  );
  headMesh.position.set(0, 0, 0);
  headGrp.add(headMesh);
  buildHeadFeatures(headGrp, spec, bipedHeadR);
  addHair(headGrp, spec, bipedHeadR);
  headGrp.position.set(0, bodyTop + neckGap, headZ);
  root.add(headGrp);

  const legs = legCountForPlan(plan);
  const ls = lenMul(arms.length);

  if (legs === 4) {
    addCylinderLeg(root, -0.35 * p.width, 0.2 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
    addCylinderLeg(root, 0.35 * p.width, 0.2 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
    addCylinderLeg(root, -0.35 * p.width, -0.25 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
    addCylinderLeg(root, 0.35 * p.width, -0.25 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
  } else if (legs === 6) {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      addCylinderLeg(
        root,
        Math.cos(ang) * 0.38 * p.width,
        Math.sin(ang) * 0.28 * p.length,
        bodyMat,
        ls * 0.85,
        bodyY,
        sx,
        sy,
        sz
      );
    }
  } else if (legs === 2) {
    addCylinderLeg(root, -0.22 * p.width, 0.05 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
    addCylinderLeg(root, 0.22 * p.width, 0.05 * p.length, bodyMat, ls, bodyY, sx, sy, sz);
  }

  const shoulderY = bodyY + 0.485 * BODY_GEOM_R * sy;
  const spanX = BODY_GEOM_R * sx * 1.02;
  const shoulderZ = 0.082 * sz;

  addArms(root, spec, { shoulderY, spanX, shoulderZ });
  addTailMesh(root, spec, {
    attachY: bodyY + BODY_GEOM_R * sy * 0.12,
    backZ: -BODY_GEOM_R * sz - 0.18,
    radial: 0.15 * p.width,
  });
  addBackAttachment(root, spec, { bodyY, sy, sx, sz });

  const backT = spec?.backAttachment?.type;
  if (
    plan === "Avian/Flying" &&
    arms.type !== "wings" &&
    backT !== "wings"
  ) {
    addWingPair(root, spec?.backAttachment?.colour || bodyHex, 1, {
      y: bodyY + 0.55 * BODY_GEOM_R * sy,
      spanX: 0.55 * sx,
      z: -0.12 * sz - 0.02,
    });
  }

  return root;
}

let rendererRef = null;
let animationId = null;
let resizeObserverRef = null;

function cloneJson(x) {
  try {
    return structuredClone(x);
  } catch {
    return JSON.parse(JSON.stringify(x));
  }
}

function readCanvasHostSize(hostEl) {
  const rw = hostEl.clientWidth;
  const rh = hostEl.clientHeight;
  return {
    w: Math.max(rw, 320),
    h: Math.max(rh, 240),
  };
}

/** Chosen preview backdrop (solid); default black. */
let viewerBgHex = 0x000000;
/** Active Three.js scene + camera + renderer for live background updates. */
let viewerCtx = null;

function syncBgPickerButtons(hexNum) {
  const target = hexNum & 0xffffff;
  document.querySelectorAll(".creator-bg-btn").forEach((btn) => {
    const raw = btn.dataset.bgHex;
    if (raw == null) return;
    const h = parseInt(String(raw), 16);
    btn.setAttribute(
      "aria-pressed",
      (h & 0xffffff) === target ? "true" : "false"
    );
  });
}

function applyViewerBackground(hexNum) {
  viewerBgHex = hexNum & 0xffffff;
  const host = document.getElementById("creator-canvas-host");
  if (host) {
    const col = new THREE.Color(viewerBgHex);
    host.style.background = `#${col.getHexString()}`;
  }
  if (viewerCtx?.scene && viewerCtx.renderer && viewerCtx.camera) {
    viewerCtx.scene.background = new THREE.Color(viewerBgHex);
    viewerCtx.renderer.render(
      viewerCtx.scene,
      viewerCtx.camera
    );
  }
  syncBgPickerButtons(viewerBgHex);
}

function initThree(spec, hostEl) {
  viewerCtx = null;
  removeViewerKeyboardListeners();
  syncCreatorFlightControlsVisible(spec);

  if (resizeObserverRef) {
    resizeObserverRef.disconnect();
    resizeObserverRef = null;
  }
  if (rendererRef) {
    cancelAnimationFrame(animationId);
    hostEl.replaceChildren();
    rendererRef.dispose?.();
    rendererRef = null;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(viewerBgHex);
  {
    const col = new THREE.Color(viewerBgHex);
    hostEl.style.background = `#${col.getHexString()}`;
  }

  const { w: iw, h: ih } = readCanvasHostSize(hostEl);
  const camera = new THREE.PerspectiveCamera(42, iw / ih, 0.1, 100);
  camera.position.set(2.1, 1.25, 3.2);

  const hemi = new THREE.HemisphereLight(0xcceeff, 0x223344, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(4, 8, 5);
  scene.add(dir);

  const creature = createCreatureGroup(spec);
  scene.add(creature);

  const ground = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.4, 32),
    new THREE.MeshStandardMaterial({
      color: 0x2a3348,
      flatShading: true,
      roughness: 1,
      side: THREE.DoubleSide,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error(
      "WebGL is not available. Try another browser or turn on hardware acceleration."
    );
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(iw, ih);
  hostEl.appendChild(renderer.domElement);
  rendererRef = renderer;

  hostEl.tabIndex = 0;
  hostEl.setAttribute("role", "application");
  hostEl.setAttribute(
    "aria-label",
    prefersMobilePreviewControls()
      ? "Low-poly 3D preview — drag to orbit; on-screen buttons move the character"
      : "Low-poly 3D preview — click to use keyboard controls"
  );
  hostEl.addEventListener(
    "click",
    () => {
      hostEl.focus({ preventScroll: true });
    },
    { passive: true }
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.55, 0);
  controls.minDistance = 1.05;
  controls.maxDistance = 14;
  controls.zoomSpeed = 0.92;
  if (prefersMobilePreviewControls()) {
    controls.rotateSpeed = 0.88;
  }

  const clock = new THREE.Clock();
  const keys = new Set();
  const canFly = creatureHasWings(spec);
  const groundY = 0;
  const previewState = {
    vy: 0,
    flying: false,
    hidden: false,
  };

  const keydown = (e) => {
    if (isTypingInFormField(e.target)) return;
    if (
      e.code === "Space" ||
      e.code === "ArrowUp" ||
      e.code === "ArrowDown"
    ) {
      e.preventDefault();
    }
    keys.add(e.code);

    if (e.code === "KeyH" && !e.repeat) {
      previewState.hidden = !previewState.hidden;
      creature.visible = !previewState.hidden;
    }

    if (e.code === "KeyF" && !e.repeat && canFly) {
      previewState.flying = !previewState.flying;
      if (!previewState.flying) {
        previewState.vy = 0;
      }
    }

    if (
      e.code === "Space" &&
      !e.repeat &&
      !previewState.flying &&
      creature.position.y <= groundY + 0.08 &&
      !previewState.hidden
    ) {
      previewState.vy = PREVIEW_JUMP_V;
    }
  };

  const keyup = (e) => {
    keys.delete(e.code);
  };

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  viewerKeydownHandler = keydown;
  viewerKeyupHandler = keyup;

  mobilePreviewControlsAbort = new AbortController();
  wireMobilePreviewControls(mobilePreviewControlsAbort.signal, {
    keys,
    previewState,
    creature,
    groundY,
    canFly,
  });

  function tick() {
    animationId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);

    let fwd = 0;
    let strafe = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) fwd -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) fwd += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) strafe -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) strafe += 1;

    const moveLen = Math.hypot(strafe, fwd);
    if (moveLen > 1e-6) {
      strafe /= moveLen;
      fwd /= moveLen;
    }

    if (!previewState.hidden) {
      creature.position.x += strafe * PREVIEW_MOVE_SPEED * dt;
      creature.position.z += fwd * PREVIEW_MOVE_SPEED * dt;
      creature.position.x = Math.max(
        -PREVIEW_BOUNDS,
        Math.min(PREVIEW_BOUNDS, creature.position.x)
      );
      creature.position.z = Math.max(
        -PREVIEW_BOUNDS,
        Math.min(PREVIEW_BOUNDS, creature.position.z)
      );
    }

    if (moveLen > 0.02 && !previewState.hidden) {
      const targetRot = Math.atan2(strafe, fwd);
      let diff = targetRot - creature.rotation.y;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      creature.rotation.y += diff * (1 - Math.exp(-11 * dt));
    }

    const ducking =
      !previewState.flying &&
      (keys.has("ControlLeft") ||
        keys.has("ControlRight") ||
        keys.has("KeyC"));
    creature.scale.y = ducking ? 0.68 : 1;
    creature.scale.x = 1;
    creature.scale.z = 1;

    if (!previewState.hidden) {
      if (previewState.flying && canFly) {
        if (keys.has("Space")) {
          previewState.vy += PREVIEW_FLY_THRUST * dt;
        }
        if (keys.has("ControlLeft") || keys.has("ControlRight")) {
          previewState.vy -= PREVIEW_FLY_THRUST * 1.05 * dt;
        }
        previewState.vy *= Math.exp(-2.2 * dt);
        creature.position.y += previewState.vy * dt;
        creature.position.y = Math.max(
          groundY,
          Math.min(PREVIEW_MAX_FLY_H, creature.position.y)
        );
      } else {
        previewState.vy -= PREVIEW_GRAVITY * dt;
        creature.position.y += previewState.vy * dt;
        if (creature.position.y <= groundY) {
          creature.position.y = groundY;
          previewState.vy = 0;
        }
      }
    }

    const lookY = creature.position.y + 0.55;
    controls.target.x += (creature.position.x - controls.target.x) * 0.12;
    controls.target.y += (lookY - controls.target.y) * 0.12;
    controls.target.z += (creature.position.z - controls.target.z) * 0.12;

    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  const ro = new ResizeObserver(() => {
    const w = hostEl.clientWidth;
    const h = hostEl.clientHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(hostEl);
  resizeObserverRef = ro;

  viewerCtx = { scene, camera, renderer };
}

const BOOTSTRAP_CREATOR_KEY = "tomagoatse-bootstrap-creator";
/** Same key as hatchery `app.js` — snapshot includes generated portrait `portraitDataUrl`. */
const HATCHERY_RESTORE_KEY = "tomagoatse-hatchery-restore";

/** In-memory fallback when sessionStorage keys are missing at save time (same tab). */
let sessionPortraitCache = null;

/**
 * Ensure `payload.hatchery` includes the hatchery-generated portrait so the server can
 * expose it as `portrait_data_url` (with custom upload overriding via `profilePictureDataUrl`).
 * Portrait is resolved from hatchery restore snap, then creator session (embeds `portraitDataUrl`),
 * then `sessionPortraitCache` set when the creator page loaded the hatch session.
 */
function mergeHatcherySnapshotIntoPayloadForSave(payload) {
  if (!payload || typeof payload !== "object") return;

  let snap = {};
  try {
    const raw = sessionStorage.getItem(HATCHERY_RESTORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") snap = parsed;
    }
  } catch {
    snap = {};
  }

  let portrait =
    typeof snap.portraitDataUrl === "string" ? snap.portraitDataUrl : "";
  if (!portrait.startsWith("data:")) {
    try {
      const raw = sessionStorage.getItem(CREATOR_SESSION_KEY);
      if (raw) {
        const sess = JSON.parse(raw);
        if (
          typeof sess?.portraitDataUrl === "string" &&
          sess.portraitDataUrl.startsWith("data:")
        )
          portrait = sess.portraitDataUrl;
      }
    } catch {
      /* ignore */
    }
  }
  if (!portrait.startsWith("data:")) {
    if (
      typeof sessionPortraitCache === "string" &&
      sessionPortraitCache.startsWith("data:")
    )
      portrait = sessionPortraitCache;
  }
  if (!portrait.startsWith("data:")) return;

  snap.portraitDataUrl = portrait;

  const existing =
    payload.hatchery && typeof payload.hatchery === "object"
      ? payload.hatchery
      : {};
  const merged = { ...snap, ...existing };
  merged.portraitDataUrl = portrait;
  payload.hatchery = merged;
}

function goToSavedCreaturePage(data) {
  if (data?.id) {
    window.location.href = `/my-creature.html?id=${encodeURIComponent(data.id)}`;
  } else {
    window.location.href = "/dashboard.html";
  }
}

/** After logging in from “Save”, complete the pending save automatically. */
async function tryFlushPendingSaveIfLoggedIn() {
  const raw = await loadPendingSavePayloadString();
  if (!raw) return;
  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (!me.ok) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload?.creator?.spec) return;
  mergeHatcherySnapshotIntoPayloadForSave(payload);
  const title =
    String(payload.creator?.session?.displayName || "").trim() ||
    "My beautiful child";
  const res = await fetch("/api/creatures", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title.slice(0, 200), payload }),
  });
  if (!res.ok) return;
  const data = await res.json().catch(() => ({}));
  await clearPendingSavePayload();
  goToSavedCreaturePage(data);
}

async function main() {
  const errBox = document.getElementById("creator-error");
  const errMsg = document.getElementById("creator-error-msg");
  const loading = document.getElementById("creator-loading");
  const mainEl = document.getElementById("creator-main");
  const title = document.getElementById("creator-title");
  const subtitle = document.getElementById("creator-subtitle");
  const tagline = document.getElementById("creator-tagline");
  const specPre = document.getElementById("creator-spec-pre");

  const embed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "1";
  if (embed) {
    document.body.classList.add("creator-embed-mode");
  }

  updateCreatorMobilePreviewChrome();

  await tryFlushPendingSaveIfLoggedIn();

  let session = null;
  let spec = null;
  let bootstrap = false;

  try {
    const bootRaw = sessionStorage.getItem(BOOTSTRAP_CREATOR_KEY);
    if (bootRaw) {
      const boot = JSON.parse(bootRaw);
      if (boot?.spec && boot?.session) {
        bootstrap = true;
        session = boot.session;
        spec = boot.spec;
        if (boot.viewerBgHex != null) {
          const s = String(boot.viewerBgHex).replace(/^#/, "");
          const h = parseInt(s, 16);
          if (Number.isFinite(h)) viewerBgHex = h & 0xffffff;
        }
        try {
          sessionStorage.removeItem(BOOTSTRAP_CREATOR_KEY);
        } catch {
          /* ignore */
        }
        try {
          sessionStorage.setItem(
            CREATOR_SESSION_KEY,
            JSON.stringify(session)
          );
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  if (!bootstrap) {
    let raw;
    try {
      raw = sessionStorage.getItem(CREATOR_SESSION_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) {
      errBox.hidden = false;
      errMsg.textContent =
        "No hatch session found. Generate a creature on the hatchery page first.";
      return;
    }

    try {
      session = JSON.parse(raw);
    } catch {
      errBox.hidden = false;
      errMsg.textContent = "Could not read saved session.";
      return;
    }

    if (!session.creatureType?.trim()) {
      errBox.hidden = false;
      errMsg.textContent = "Missing creature type.";
      return;
    }
  }

  if (!session?.creatureType?.trim()) {
    errBox.hidden = false;
    errMsg.textContent = "Missing creature type.";
    return;
  }

  try {
    const hRaw = sessionStorage.getItem(HATCHERY_RESTORE_KEY);
    if (hRaw && session && !session.portraitDataUrl?.startsWith("data:")) {
      const h = JSON.parse(hRaw);
      if (h?.portraitDataUrl?.startsWith("data:")) {
        session.portraitDataUrl = h.portraitDataUrl;
        try {
          sessionStorage.setItem(CREATOR_SESSION_KEY, JSON.stringify(session));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  if (
    typeof session.portraitDataUrl === "string" &&
    session.portraitDataUrl.startsWith("data:")
  ) {
    sessionPortraitCache = session.portraitDataUrl;
  }

  title.textContent = session.displayName
    ? `${session.displayName} — low-poly`
    : "Low-poly character";
  subtitle.textContent = session.creatureType.trim();
  if (tagline) tagline.textContent = session.tagline || "";
  const capEl = document.getElementById("creator-caption");
  if (capEl) {
    if (session.caption?.trim()) {
      capEl.textContent = session.caption;
      capEl.hidden = false;
    } else {
      capEl.textContent = "";
      capEl.hidden = true;
    }
  }

  if (!bootstrap) {
    loading.hidden = false;
    try {
      const res = await fetch("/api/creator-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatureType: session.creatureType,
          displayName: session.displayName,
          gender: session.profile?.gender,
          colours: session.profile?.colours,
          favouriteFood: session.favouriteFood,
          biggestFear: session.biggestFear,
          favouriteSong: session.profile?.favouriteSong,
          placeOfBirth: session.profile?.placeOfBirth,
          myersBriggs: session.profile?.myersBriggs,
          sillyProp: session.profile?.sillyProp,
          meters: session.meters,
          fixedMeters: session.fixedMeters,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || res.statusText);
      }
      spec = data.spec;
      const warnEl = document.getElementById("creator-spec-warning");
      if (warnEl) {
        const w = data.warning || "";
        if (data.specSource === "heuristic" || w) {
          warnEl.textContent =
            w ||
            "Inference was unavailable; showing a keyword-based design instead of the AI model.";
          warnEl.hidden = false;
        } else {
          warnEl.textContent = "";
          warnEl.hidden = true;
        }
      }
    } catch (e) {
      loading.hidden = true;
      errBox.hidden = false;
      errMsg.textContent =
        e?.message || "Could not load character design from the model.";
      return;
    }
  } else {
    const warnEl = document.getElementById("creator-spec-warning");
    if (warnEl) {
      warnEl.textContent = "";
      warnEl.hidden = true;
    }
  }

  loading.hidden = true;
  mainEl.hidden = false;

  const signupWrap = document.getElementById("creator-signup-wrap");
  if (signupWrap) signupWrap.hidden = embed;

  const workingSpec = cloneJson(spec);
  const workingSession = cloneJson(session);
  ensureSpecShape(workingSpec);
  applyBodyPlanDefaults(workingSpec);

  const specPanel = document.getElementById("creator-spec-panel");
  if (specPanel) {
    specPanel.innerHTML = buildSpecPanelHTML(workingSpec, workingSession);
    specPanel.hidden = false;
    wireCreatorDesignAccordion();
  }

  if (specPre) specPre.textContent = JSON.stringify(workingSpec, null, 2);

  const nameInput = document.getElementById("creator-display-name");
  if (nameInput) {
    nameInput.value = workingSession.displayName || "";
    nameInput.addEventListener("input", () => {
      workingSession.displayName = nameInput.value.trim();
      syncCreatorHeader(workingSession);
    });
  }
  fillStoryReadonly(workingSession);
  renderMeters(workingSession);

  const btnSignup = document.getElementById("creator-btn-signup-save");
  if (btnSignup && !embed) {
    btnSignup.addEventListener("click", async () => {
      let payload;
      try {
        pullDesignFromPanelInto(workingSpec);
        pullContextFromPanelInto(workingSession);
        payload = {
          v: 1,
          creator: {
            spec: cloneJson(workingSpec),
            session: cloneJson(workingSession),
            viewerBgHex: (viewerBgHex & 0xffffff).toString(16).padStart(6, "0"),
          },
        };
        mergeHatcherySnapshotIntoPayloadForSave(payload);
      } catch (err) {
        console.error(err);
        alert("Could not prepare your design to save. Try again.");
        return;
      }

      const me = await fetch("/api/auth/me", { credentials: "include" });
      if (!me.ok) {
        try {
          await storePendingSavePayload(payload);
        } catch (e) {
          console.error(e);
          alert(
            "Could not store your design for sign-in (browser storage full or blocked). Try signing in first in another tab, then save again, or use a smaller hatchery portrait."
          );
          return;
        }
        window.location.href =
          "/login.html?next=" + encodeURIComponent("/creator.html");
        return;
      }

      const saveTitle =
        String(workingSession.displayName || "").trim() || "My beautiful child";
      btnSignup.disabled = true;
      const prevLabel = btnSignup.textContent;
      btnSignup.textContent = "Saving…";

      try {
        const res = await fetch("/api/creatures", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: saveTitle.slice(0, 200),
            payload,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || data.error || "Could not save to your dashboard.");
          return;
        }
        goToSavedCreaturePage(data);
      } catch (e) {
        console.error(e);
        alert("Network error — could not save.");
      } finally {
        btnSignup.disabled = false;
        btnSignup.textContent = prevLabel;
      }
    });
  }

  const host = document.getElementById("creator-canvas-host");

  let previewDebounce = null;
  function syncBodySliderLabelsFromInputs() {
    const pairs = [
      ["design-body-width", "design-body-width-val"],
      ["design-body-height", "design-body-height-val"],
      ["design-body-length", "design-body-length-val"],
      ["design-back-visual-scale", "design-back-visual-scale-val"],
    ];
    for (const [sid, vid] of pairs) {
      const el = document.getElementById(sid);
      const lab = document.getElementById(vid);
      if (el && lab) lab.textContent = Number(el.value).toFixed(2);
    }
  }
  function scheduleDesignPreview() {
    pullDesignFromPanelInto(workingSpec);
    syncBodySliderLabelsFromInputs();
    if (specPre) specPre.textContent = JSON.stringify(workingSpec, null, 2);
    if (previewDebounce) clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
      previewDebounce = null;
      if (!host) return;
      try {
        initThree(workingSpec, host);
      } catch (e) {
        console.error(e);
      }
    }, 60);
  }

  function applyContextFromPanel() {
    pullContextFromPanelInto(workingSession);
    syncCreatorHeader(workingSession);
  }

  if (specPanel) {
    specPanel.addEventListener("input", (e) => {
      const id = e.target?.id || "";
      if (id === "ctx-colourPalette") return;
      // `<select>` fires both `input` and `change`; only handle `change` so we don’t run handlers twice.
      if (e.target?.tagName === "SELECT" && (id.startsWith("design-") || id.startsWith("ctx-")))
        return;
      if (id.startsWith("ctx-")) applyContextFromPanel();
      else if (id.startsWith("design-")) {
        if (id.includes("-colour")) delete workingSpec.colourPaletteId;
        scheduleDesignPreview();
      }
    });
    specPanel.addEventListener("change", (e) => {
      const id = e.target?.id || "";
      if (id === "ctx-colourPalette") {
        const v = e.target.value;
        if (!v) {
          delete workingSpec.colourPaletteId;
          return;
        }
        applyCreatorPaletteToSpec(workingSpec, v);
        specPanel.innerHTML = buildSpecPanelHTML(workingSpec, workingSession);
        wireCreatorDesignAccordion();
        if (specPre) specPre.textContent = JSON.stringify(workingSpec, null, 2);
        syncBodySliderLabelsFromInputs();
        try {
          if (host) initThree(workingSpec, host);
        } catch (err) {
          console.error(err);
        }
        return;
      }
      if (id.startsWith("ctx-")) applyContextFromPanel();
      else if (id.startsWith("design-")) {
        if (id.includes("-colour")) delete workingSpec.colourPaletteId;
        if (id === "design-bodyPlan") {
          pullDesignFromPanelInto(workingSpec);
          applyBodyPlanDefaults(workingSpec);
          specPanel.innerHTML = buildSpecPanelHTML(workingSpec, workingSession);
          wireCreatorDesignAccordion();
          if (specPre) specPre.textContent = JSON.stringify(workingSpec, null, 2);
          syncBodySliderLabelsFromInputs();
          try {
            if (host) initThree(workingSpec, host);
          } catch (err) {
            console.error(err);
          }
          return;
        }
        scheduleDesignPreview();
      }
    });
  }

  const bgPicker = document.querySelector(".creator-bg-picker");
  if (bgPicker) {
    bgPicker.addEventListener("click", (e) => {
      const btn = e.target.closest(".creator-bg-btn");
      const raw = btn?.dataset?.bgHex;
      if (raw == null) return;
      const hex = parseInt(String(raw), 16);
      if (!Number.isFinite(hex)) return;
      applyViewerBackground(hex);
    });
  }

  if (host) {
    const tryInit = () => {
      try {
        initThree(workingSpec, host);
      } catch (e) {
        console.error(e);
        mainEl.hidden = true;
        if (specPanel) specPanel.hidden = true;
        errBox.hidden = false;
        errMsg.textContent =
          e?.message ||
          "The 3D preview failed to start. Try refreshing the page.";
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(tryInit);
    });
  }

  let lastMobilePreview = prefersMobilePreviewControls();
  let resizeMobileTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeMobileTimer);
    resizeMobileTimer = setTimeout(() => {
      updateCreatorMobilePreviewChrome();
      const now = prefersMobilePreviewControls();
      if (now === lastMobilePreview) return;
      lastMobilePreview = now;
      const h = document.getElementById("creator-canvas-host");
      if (!h) return;
      try {
        initThree(workingSpec, h);
      } catch (e) {
        console.error(e);
      }
    }, 200);
  });
}

export { createCreatureGroup, ensureSpecShape, applyBodyPlanDefaults, main };
