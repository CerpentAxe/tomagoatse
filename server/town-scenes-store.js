import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  TOWN_SCENES_DEFAULTS,
  VALID_SLUGS,
} from "./town-scenes-defaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = path.join(__dirname, "data", "town-scenes-overrides.json");

const EDITABLE_STRING_KEYS = [
  "tagline",
  "caption",
  "skyTop",
  "skyBottom",
  "fogColor",
  "ground",
  "groundLine",
  "accent",
  "particle",
  "sunColor",
];
const EDITABLE_BOOL_KEYS = ["sun"];

function sanitizeColorLike(s, fallback) {
  if (typeof s !== "string") return fallback;
  const t = s.trim().slice(0, 120);
  if (!t) return fallback;
  if (/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?([0-9A-Fa-f]{2})?$/.test(t)) return t;
  if (/^rgba?\(/i.test(t)) return t;
  return fallback;
}

function sanitizeLayers(raw, fallback) {
  if (!Array.isArray(raw)) return fallback;
  const out = [];
  for (const L of raw.slice(0, 8)) {
    if (!L || typeof L !== "object") continue;
    const speed = Number(L.speed);
    const heightPct = Number(L.heightPct);
    const topPct = Number(L.topPct);
    const opacity = L.opacity != null ? Number(L.opacity) : 1;
    const gradient = typeof L.gradient === "string" ? L.gradient.trim().slice(0, 800) : "";
    if (!gradient) continue;
    out.push({
      speed: Number.isFinite(speed) ? Math.max(0, Math.min(1, speed)) : 0.2,
      heightPct: Number.isFinite(heightPct) ? Math.max(5, Math.min(90, heightPct)) : 30,
      topPct: Number.isFinite(topPct) ? Math.max(0, Math.min(80, topPct)) : 0,
      gradient,
      opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1,
    });
  }
  return out.length ? out : fallback;
}

function deepMergeScene(slug, patch) {
  const base = TOWN_SCENES_DEFAULTS[slug];
  if (!base) return null;
  const merged = JSON.parse(JSON.stringify(base));
  if (!patch || typeof patch !== "object") return merged;
  for (const k of EDITABLE_STRING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] != null) {
      const maxLen = k === "caption" ? 800 : 500;
      const v = String(patch[k]).trim().slice(0, maxLen);
      if (k === "fogColor" || k === "accent") {
        merged[k] = sanitizeColorLike(v, merged[k]);
      } else if (["skyTop", "skyBottom", "ground", "groundLine", "sunColor"].includes(k)) {
        merged[k] = sanitizeColorLike(v, merged[k]);
      } else {
        merged[k] = v || merged[k];
      }
    }
  }
  for (const k of EDITABLE_BOOL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      merged[k] = Boolean(patch[k]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "layers")) {
    merged.layers = sanitizeLayers(patch.layers, merged.layers);
  }
  return merged;
}

let overridesCache = null;
let overridesMtime = 0;

export async function readOverridesFile() {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

export async function getOverrides() {
  const st = await fs.stat(OVERRIDES_PATH).catch(() => null);
  const m = st ? st.mtimeMs : 0;
  if (overridesCache && m === overridesMtime) return overridesCache;
  overridesCache = await readOverridesFile();
  overridesMtime = m;
  return overridesCache;
}

export async function writeOverrides(obj) {
  await fs.mkdir(path.dirname(OVERRIDES_PATH), { recursive: true });
  await fs.writeFile(OVERRIDES_PATH, JSON.stringify(obj, null, 2), "utf8");
  overridesCache = obj;
  overridesMtime = Date.now();
}

export async function getMergedScene(slug) {
  const s = String(slug || "")
    .trim()
    .toLowerCase();
  if (!VALID_SLUGS.includes(s)) return null;
  const ov = await getOverrides();
  const patch = ov[s];
  return deepMergeScene(s, patch);
}

export async function listMergedScenes() {
  const out = [];
  for (const slug of VALID_SLUGS) {
    const scene = await getMergedScene(slug);
    if (scene) {
      out.push({
        slug: scene.slug,
        name: scene.name,
        tagline: scene.tagline,
      });
    }
  }
  return out;
}

export async function getAllMergedScenes() {
  const out = [];
  for (const slug of VALID_SLUGS) {
    const scene = await getMergedScene(slug);
    if (scene) out.push(scene);
  }
  return out;
}

function sanitizeAdminPatch(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const k of EDITABLE_STRING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k) && body[k] != null) {
      out[k] = String(body[k]).trim().slice(0, 800);
    }
  }
  for (const k of EDITABLE_BOOL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      out[k] = Boolean(body[k]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "layers")) {
    out.layers = body.layers;
  }
  return out;
}

export async function applyAdminPatch(slug, body) {
  const s = String(slug || "")
    .trim()
    .toLowerCase();
  if (!VALID_SLUGS.includes(s)) {
    return { ok: false, error: "unknown_slug" };
  }
  const patch = sanitizeAdminPatch(body);
  const ov = await readOverridesFile();
  const combined = { ...(ov[s] || {}), ...patch };
  const merged = deepMergeScene(s, combined);
  if (!merged) return { ok: false, error: "merge_failed" };
  const next = { ...ov, [s]: combined };
  await writeOverrides(next);
  return { ok: true, scene: merged };
}
