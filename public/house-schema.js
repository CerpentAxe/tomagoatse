/** Per-creature house customization (stored under creature.payload.house). */

export const ROOF_OPTS = ["Gable", "Hip", "Flat"];
export const STORIES_OPTS = ["single", "double", "triple"];
export const DOOR_OPTS = ["Single", "Double", "Arch"];
export const ADDON_FRONT_OPTS = [
  "None",
  "Porch",
  "Gable",
  "Steps",
  "Ramp",
  "Chimney",
  "balcony",
];
export const ADDON_LEFT_OPTS = ["None", "Garage", "Carport", "Garden"];
export const FRONT_ACCESSORY_OPTS = ["None", "Mailbox", "Lampost", "Planter"];

const HOUSE_KEYS = [
  "roof",
  "stories",
  "width",
  "height",
  "door",
  "windowsPerStory",
  "addonFront",
  "addonLeft",
  "frontAccessory",
];

/** Default layout; colors come from the current town scene (accent, ground, etc.). */
export const DEFAULT_HOUSE = {
  roof: "Gable",
  stories: "single",
  width: 1,
  height: 1,
  door: "Single",
  windowsPerStory: [2],
  addonFront: "None",
  addonLeft: "None",
  frontAccessory: "None",
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function pickEnum(val, allowed, fallback) {
  const s = String(val ?? "").trim();
  return allowed.includes(s) ? s : fallback;
}

function pickWindows(n) {
  const x = typeof n === "number" ? n : parseInt(n, 10);
  if (!Number.isFinite(x)) return 2;
  return clamp(Math.round(x), 1, 4);
}

/** @param {"single"|"double"|"triple"} stories */
export function storyCountFromStories(stories) {
  if (stories === "triple") return 3;
  if (stories === "double") return 2;
  return 1;
}

function padWindowsPerStory(arr, n) {
  const base = Array.isArray(arr) && arr.length ? arr : [2];
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = base[i] != null ? base[i] : base[base.length - 1];
    out.push(pickWindows(v));
  }
  return out;
}

/**
 * @param {object} h
 * @param {"single"|"double"|"triple"} stories
 */
function pickWindowsPerStory(h, stories) {
  const n = storyCountFromStories(stories);
  if (Array.isArray(h.windowsPerStory)) {
    return padWindowsPerStory(h.windowsPerStory, n);
  }
  if (h.windows != null) {
    const w = pickWindows(h.windows);
    return Array(n).fill(w);
  }
  return padWindowsPerStory(DEFAULT_HOUSE.windowsPerStory, n);
}

function pickScale(n) {
  const x = typeof n === "number" ? n : parseFloat(n);
  if (!Number.isFinite(x)) return DEFAULT_HOUSE.width;
  return Math.round(clamp(x, 0.5, 1.5) * 100) / 100;
}

/**
 * Full normalized house object (safe for storage and rendering).
 * @param {object} [raw]
 */
export function normalizeHouse(raw) {
  const h = raw && typeof raw === "object" ? raw : {};
  const stories = pickEnum(h.stories, STORIES_OPTS, DEFAULT_HOUSE.stories);
  return {
    roof: pickEnum(h.roof, ROOF_OPTS, DEFAULT_HOUSE.roof),
    stories,
    width: pickScale(h.width),
    height: pickScale(h.height),
    door: pickEnum(h.door, DOOR_OPTS, DEFAULT_HOUSE.door),
    windowsPerStory: pickWindowsPerStory(h, stories),
    addonFront: pickEnum(h.addonFront, ADDON_FRONT_OPTS, DEFAULT_HOUSE.addonFront),
    addonLeft: pickEnum(h.addonLeft, ADDON_LEFT_OPTS, DEFAULT_HOUSE.addonLeft),
    frontAccessory: pickEnum(
      h.frontAccessory,
      FRONT_ACCESSORY_OPTS,
      DEFAULT_HOUSE.frontAccessory
    ),
  };
}

/**
 * Merge stored house with a partial patch (unknown keys ignored).
 * @param {object} existing
 * @param {object} patch
 */
export function mergeHouse(existing, patch) {
  const base = normalizeHouse(existing);
  if (!patch || typeof patch !== "object") return base;
  const delta = {};
  for (const k of HOUSE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      delta[k] = patch[k];
    }
  }
  return normalizeHouse({ ...base, ...delta });
}

export function houseFromPayload(payload) {
  return normalizeHouse(payload?.house);
}
