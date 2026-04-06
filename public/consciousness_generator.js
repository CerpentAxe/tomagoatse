/**
 * Maze editor: paint grid, move selection, colours, save to creature payload.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildMazeGroup,
  openGridToEdgeGrid,
  hexToNum,
  pickDefaultEndpoints,
  referenceToGridCellImageDataUrl,
} from "./maze-shared.js";

const DRAFT_KEY = "consciousness_generator_draft";

const params = new URLSearchParams(window.location.search);
const creatureId = params.get("id");

const errEl = document.getElementById("cg-error");
const mainEl = document.getElementById("cg-main");
const canvas = document.getElementById("cg-canvas");
const nameInput = document.getElementById("cg-name");
const saveBtn = document.getElementById("cg-save");
const statusEl = document.getElementById("cg-status");
const aiCaptionEl = document.getElementById("cg-ai-caption");
const backLink = document.getElementById("cg-back-link");
const previewHost = document.getElementById("cg-preview-host");
const referencePanel = document.getElementById("cg-reference-panel");
const referenceImg = document.getElementById("cg-reference-img");
const cleanUpBtn = document.getElementById("cg-clean-up");

/** @type {CanvasRenderingContext2D | null} */
let ctx = null;
if (canvas) ctx = canvas.getContext("2d");

let state = {
  mazeId: "",
  creatureId: "",
  name: "",
  cols: 9,
  rows: 9,
  /** @type {boolean[][]} */
  open: [],
  start: { i: 0, j: 0 },
  end: { i: 0, j: 0 },
  colors: {
    floor: "#c4a574",
    wall: "#5c4a3a",
    rim: "#8b7355",
    background: "#d4a574",
    fog: "#c9a66b",
  },
  /** @type {{ r0: number; c0: number; r1: number; c1: number } | null} */
  sel: null,
  /** Data URL from create flow; required for AI clean-up. */
  referenceImageDataUrl: null,
};

let selectDrag = null;
let paintDown = false;

function getTool() {
  const r = document.querySelector('input[name="cg-tool"]:checked');
  return r ? String(r.value) : "floor";
}

function tryMoveRegion(r0, c0, r1, c1, di, dj) {
  const open = state.open;
  const cols = state.cols;
  const rows = state.rows;
  const sr0 = Math.min(r0, r1);
  const sr1 = Math.max(r0, r1);
  const sc0 = Math.min(c0, c1);
  const sc1 = Math.max(c0, c1);
  const h = sr1 - sr0 + 1;
  const w = sc1 - sc0 + 1;
  const nr0 = sr0 + dj;
  const nc0 = sc0 + di;
  if (nr0 < 0 || nc0 < 0 || nr0 + h - 1 >= rows || nc0 + w - 1 >= cols) {
    return null;
  }

  const src = new Set();
  for (let j = sr0; j <= sr1; j++) {
    for (let i = sc0; i <= sc1; i++) {
      src.add(`${i},${j}`);
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ti = nc0 + i;
      const tj = nr0 + j;
      if (src.has(`${ti},${tj}`)) continue;
      if (open[tj][ti]) return null;
    }
  }

  const patch = [];
  for (let j = sr0; j <= sr1; j++) {
    patch.push(open[j].slice(sc0, sc1 + 1));
  }

  for (let j = sr0; j <= sr1; j++) {
    for (let i = sc0; i <= sc1; i++) {
      open[j][i] = false;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      open[nr0 + j][nc0 + i] = patch[j][i];
    }
  }

  let ns = { ...state.start };
  let ne = { ...state.end };
  const s = state.start;
  const e = state.end;
  if (s.i >= sc0 && s.i <= sc1 && s.j >= sr0 && s.j <= sr1) {
    ns = { i: s.i + di, j: s.j + dj };
  }
  if (e.i >= sc0 && e.i <= sc1 && e.j >= sr0 && e.j <= sr1) {
    ne = { i: e.i + di, j: e.j + dj };
  }

  state.start = ns;
  state.end = ne;
  state.sel = { r0: nr0, c0: nc0, r1: nr0 + h - 1, c1: nc0 + w - 1 };
  return true;
}

function renderOpenGridToDataUrl() {
  const { cols, rows, open, colors } = state;
  const scale = Math.max(2, Math.min(10, Math.floor(512 / Math.max(cols, rows))));
  const w = cols * scale;
  const h = rows * scale;
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const g = el.getContext("2d");
  if (!g) return null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      g.fillStyle = open[j][i] ? colors.floor : colors.wall;
      g.fillRect(i * scale, j * scale, scale + 0.5, scale + 0.5);
    }
  }
  return el.toDataURL("image/png");
}

function loadReferenceImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not decode the reference image."));
    img.src = dataUrl;
  });
}

function syncCleanUpButton() {
  if (!cleanUpBtn) return;
  cleanUpBtn.disabled = !state.referenceImageDataUrl;
  cleanUpBtn.title = state.referenceImageDataUrl
    ? "Send your reference image and this grid to the AI for a refined maze."
    : "Create a maze from Consciousness with a reference image — the image is stored with your draft.";
}

function repairStartEnd() {
  const { cols, rows } = state;
  if (
    !state.open[state.start.j]?.[state.start.i] ||
    !state.open[state.end.j]?.[state.end.i]
  ) {
    const p = pickDefaultEndpoints(state.open, cols, rows);
    state.start = p.start;
    state.end = p.end;
  }
}

function applyToolAt(i, j) {
  const tool = getTool();
  if (tool === "select") return;
  if (tool === "floor") {
    state.open[j][i] = true;
  } else if (tool === "wall") {
    state.open[j][i] = false;
  } else if (tool === "start") {
    if (state.open[j][i]) state.start = { i, j };
  } else if (tool === "end") {
    if (state.open[j][i]) state.end = { i, j };
  }
  repairStartEnd();
}

function eventToCell(e) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  const i = Math.floor(x * state.cols);
  const j = Math.floor(y * state.rows);
  if (i < 0 || j < 0 || i >= state.cols || j >= state.rows) return null;
  return { i, j };
}

function resizeEditorCanvas() {
  if (!canvas || !ctx) return;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const side = Math.floor(Math.min(rect.width, 640));
  if (side < 80) return;
  canvas.width = side;
  canvas.height = side;
  draw();
}

function draw() {
  if (!ctx || !canvas) return;
  const { cols, rows } = state;
  const w = canvas.width;
  const h = canvas.height;
  const cw = w / cols;
  const ch = h / rows;
  ctx.clearRect(0, 0, w, h);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      ctx.fillStyle = state.open[j][i]
        ? state.colors.floor
        : state.colors.wall;
      ctx.fillRect(i * cw, j * ch, cw + 0.5, ch + 0.5);
    }
  }

  ctx.strokeStyle = "rgba(40,30,20,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cw, 0);
    ctx.lineTo(i * cw, h);
    ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    ctx.beginPath();
    ctx.moveTo(0, j * ch);
    ctx.lineTo(w, j * ch);
    ctx.stroke();
  }

  const sx = state.start.i * cw + cw * 0.5;
  const sy = state.start.j * ch + ch * 0.5;
  ctx.fillStyle = "#3b7dd8";
  ctx.beginPath();
  ctx.arc(sx, sy, Math.min(cw, ch) * 0.22, 0, Math.PI * 2);
  ctx.fill();

  const ex = state.end.i * cw + cw * 0.5;
  const ey = state.end.j * ch + ch * 0.5;
  ctx.fillStyle = "#3bbf6a";
  ctx.beginPath();
  ctx.arc(ex, ey, Math.min(cw, ch) * 0.22, 0, Math.PI * 2);
  ctx.fill();

  if (state.sel) {
    const { r0, c0, r1, c1 } = state.sel;
    const x0 = Math.min(c0, c1) * cw;
    const y0 = Math.min(r0, r1) * ch;
    const x1 = (Math.max(c0, c1) + 1) * cw;
    const y1 = (Math.max(r0, r1) + 1) * ch;
    ctx.strokeStyle = "#1a50a0";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    ctx.setLineDash([]);
  }
}

let previewTimer = 0;
function schedulePreview() {
  if (previewTimer) cancelAnimationFrame(previewTimer);
  previewTimer = requestAnimationFrame(() => {
    previewTimer = 0;
    updatePreview3d();
  });
}

/** @type {THREE.WebGLRenderer | null} */
let previewRenderer = null;
/** @type {THREE.Scene | null} */
let previewScene = null;
/** @type {THREE.PerspectiveCamera | null} */
let previewCam = null;
/** @type {OrbitControls | null} */
let previewControls = null;
/** @type {THREE.Group | null} */
let previewMaze = null;

function ensurePreview() {
  if (!previewHost || previewRenderer) return;
  previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  if (!previewRenderer.getContext()) return;
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  previewHost.appendChild(previewRenderer.domElement);
  previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color(hexToNum(state.colors.background));
  previewCam = new THREE.PerspectiveCamera(42, 1, 0.4, 200);
  previewCam.position.set(10, 11, 10);
  previewControls = new OrbitControls(previewCam, previewRenderer.domElement);
  previewControls.enableDamping = true;
  previewControls.target.set(0, 0, 0);
  const hemi = new THREE.HemisphereLight(0xffe8c8, 0x4a3528, 0.85);
  previewScene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.05);
  sun.position.set(6, 12, 4);
  previewScene.add(sun);

  function loop() {
    requestAnimationFrame(loop);
    if (previewControls) previewControls.update();
    if (previewRenderer && previewScene && previewCam) {
      previewRenderer.render(previewScene, previewCam);
    }
  }
  loop();

  let resizeRaf = 0;
  const ro = new ResizeObserver(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (!previewHost || !previewRenderer || !previewCam) return;
      const r = previewHost.getBoundingClientRect();
      const pw = Math.max(
        120,
        Math.min(1600, Math.floor(r.width || previewHost.clientWidth))
      );
      const ph = Math.max(
        120,
        Math.min(800, Math.floor(r.height || previewHost.clientHeight))
      );
      if (pw < 2 || ph < 2) return;
      previewRenderer.setSize(pw, ph);
      previewCam.aspect = pw / ph;
      previewCam.updateProjectionMatrix();
    });
  });
  ro.observe(previewHost);
}

function updatePreview3d() {
  ensurePreview();
  if (!previewScene || !previewRenderer || !previewCam) return;
  previewScene.background = new THREE.Color(hexToNum(state.colors.background));
  if (previewMaze) {
    previewScene.remove(previewMaze);
  }
  const grid = openGridToEdgeGrid(state.open, state.cols, state.rows);
  previewMaze = buildMazeGroup(grid, state.cols, state.rows, {
    open: state.open,
    colors: state.colors,
    end: state.end,
    decorativeRim: false,
  });
  previewScene.add(previewMaze);
  const box = new THREE.Box3().setFromObject(previewMaze);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  previewControls.target.copy(ctr);
  const r = Math.max(size.x, size.z, 3) * 0.88;
  /* Tight framing + overhead so the maze fills the preview panel. */
  previewCam.position.set(ctr.x + r * 0.52, ctr.y + r * 1.28, ctr.z + r * 0.52);
  previewCam.near = 0.1;
  previewCam.far = r * 20;
  previewCam.updateProjectionMatrix();
}

async function main() {
  if (!creatureId) {
    if (errEl) {
      errEl.textContent = "Missing creature id.";
      errEl.hidden = false;
    }
    return;
  }

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href =
      "/login.html?next=" +
      encodeURIComponent(
        "/consciousness_generator.html?id=" + encodeURIComponent(creatureId)
      );
    return;
  }

  if (backLink) {
    backLink.href = `/consciousness.html?id=${encodeURIComponent(creatureId)}`;
  }

  let raw;
  try {
    raw = sessionStorage.getItem(DRAFT_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    if (errEl) {
      errEl.textContent =
        "No maze draft found. Start from the Consciousness page: create a maze and upload an image.";
      errEl.hidden = false;
    }
    return;
  }

  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    if (errEl) {
      errEl.textContent = "Could not read maze draft.";
      errEl.hidden = false;
    }
    return;
  }

  if (!draft || draft.creatureId !== creatureId || !Array.isArray(draft.open)) {
    if (errEl) {
      errEl.textContent = "Draft does not match this creature. Create a new maze from Consciousness.";
      errEl.hidden = false;
    }
    return;
  }

  state = {
    mazeId: draft.mazeId || crypto.randomUUID(),
    creatureId,
    name: String(draft.name || "Custom maze"),
    cols: draft.cols,
    rows: draft.rows,
    open: draft.open.map((row) => row.map((c) => !!c)),
    start: draft.start || { i: 0, j: 0 },
    end: draft.end || { i: draft.cols - 1, j: draft.rows - 1 },
    colors: { ...state.colors, ...(draft.colors || {}) },
    sel: null,
  };
  repairStartEnd();

  if (nameInput) nameInput.value = state.name;
  if (draft.aiCaption && aiCaptionEl) {
    aiCaptionEl.hidden = false;
    aiCaptionEl.textContent = `AI note: ${draft.aiCaption}`;
  }

  const refUrl =
    typeof draft.referenceImageDataUrl === "string" &&
    draft.referenceImageDataUrl.startsWith("data:")
      ? draft.referenceImageDataUrl
      : null;
  if (refUrl && referenceImg && referencePanel) {
    referenceImg.src = refUrl;
    referenceImg.alt = "Reference image for this maze";
    referencePanel.hidden = false;
  }
  state.referenceImageDataUrl = refUrl;
  syncCleanUpButton();

  syncColorInputs();
  if (mainEl) mainEl.hidden = false;

  requestAnimationFrame(() => {
    resizeEditorCanvas();
  });
  if (typeof ResizeObserver !== "undefined" && canvas?.parentElement) {
    const ro = new ResizeObserver(() => resizeEditorCanvas());
    ro.observe(canvas.parentElement);
  }

  schedulePreview();

  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.trim() || "Custom maze";
  });

  for (const id of ["cg-c-floor", "cg-c-wall", "cg-c-rim", "cg-c-bg", "cg-c-fog"]) {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      const cf = document.getElementById("cg-c-floor");
      const cw = document.getElementById("cg-c-wall");
      const cr = document.getElementById("cg-c-rim");
      const cb = document.getElementById("cg-c-bg");
      const fg = document.getElementById("cg-c-fog");
      if (cf) state.colors.floor = cf.value;
      if (cw) state.colors.wall = cw.value;
      if (cr) state.colors.rim = cr.value;
      if (cb) state.colors.background = cb.value;
      if (fg) state.colors.fog = fg.value;
      draw();
      schedulePreview();
    });
  }

  document.querySelectorAll('input[name="cg-tool"]').forEach((r) => {
    r.addEventListener("change", () => {
      state.sel = null;
      draw();
    });
  });

  canvas?.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const cell = eventToCell(e);
    if (!cell) return;
    const tool = getTool();
    if (tool === "select") {
      selectDrag = { i0: cell.i, j0: cell.j, i1: cell.i, j1: cell.j };
      state.sel = { r0: cell.j, c0: cell.i, r1: cell.j, c1: cell.i };
      return;
    }
    paintDown = true;
    applyToolAt(cell.i, cell.j);
    draw();
    schedulePreview();
  });

  canvas?.addEventListener("pointermove", (e) => {
    const cell = eventToCell(e);
    if (!cell) return;
    if (selectDrag) {
      selectDrag.i1 = cell.i;
      selectDrag.j1 = cell.j;
      state.sel = {
        r0: selectDrag.j0,
        c0: selectDrag.i0,
        r1: selectDrag.j1,
        c1: selectDrag.i1,
      };
      draw();
      return;
    }
    if (!paintDown) return;
    const tool = getTool();
    if (tool === "select") return;
    applyToolAt(cell.i, cell.j);
    draw();
    schedulePreview();
  });

  function endPointer() {
    selectDrag = null;
    paintDown = false;
  }
  canvas?.addEventListener("pointerup", endPointer);
  canvas?.addEventListener("pointercancel", endPointer);

  window.addEventListener(
    "keydown",
    (e) => {
      if (!state.sel) return;
      if (
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        return;
      }
      e.preventDefault();
      let di = 0;
      let dj = 0;
      if (e.key === "ArrowLeft") di = -1;
      if (e.key === "ArrowRight") di = 1;
      if (e.key === "ArrowUp") dj = -1;
      if (e.key === "ArrowDown") dj = 1;
      const { r0, c0, r1, c1 } = state.sel;
      const ok = tryMoveRegion(r0, c0, r1, c1, di, dj);
      if (ok) {
        draw();
        schedulePreview();
      }
    },
    { passive: false }
  );

  cleanUpBtn?.addEventListener("click", async () => {
    if (!state.referenceImageDataUrl) return;
    cleanUpBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Cleaning up maze with AI…";
    try {
      const gridImageDataUrl = renderOpenGridToDataUrl();
      if (!gridImageDataUrl) {
        throw new Error("Could not render the grid image.");
      }
      let referenceAlignedDataUrl = null;
      try {
        const refImg = await loadReferenceImage(state.referenceImageDataUrl);
        referenceAlignedDataUrl = referenceToGridCellImageDataUrl(
          refImg,
          state.cols,
          state.rows
        );
      } catch {
        /* optional — server still runs with full reference + grid only */
      }
      const res = await fetch("/api/consciousness/maze-clean-up", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceImageDataUrl: state.referenceImageDataUrl,
          gridImageDataUrl,
          referenceAlignedDataUrl,
          cols: state.cols,
          rows: state.rows,
          open: state.open,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.message || data.error || `Request failed (${res.status}).`
        );
      }
      if (!Array.isArray(data.open)) {
        throw new Error("Invalid response from server.");
      }
      state.open = data.open.map((row) => row.map((c) => !!c));
      repairStartEnd();
      draw();
      schedulePreview();
      if (statusEl) statusEl.textContent = "Maze updated from AI.";
    } catch (e) {
      console.error(e);
      if (statusEl) {
        statusEl.textContent = e?.message || "Clean-up failed.";
      }
    } finally {
      syncCleanUpButton();
    }
  });

  saveBtn?.addEventListener("click", async () => {
    if (!saveBtn) return;
    saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Saving…";
    try {
      const body = {
        name: state.name,
        cols: state.cols,
        rows: state.rows,
        open: state.open,
        start: state.start,
        end: state.end,
        colors: state.colors,
      };
      const res = await fetch(
        `/api/creatures/${encodeURIComponent(creatureId)}/consciousness-mazes/${encodeURIComponent(state.mazeId)}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.message || "Save failed");
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      if (statusEl) statusEl.textContent = "Saved.";
      window.location.href = `/consciousness.html?id=${encodeURIComponent(creatureId)}&maze=${encodeURIComponent(state.mazeId)}`;
    } catch (e) {
      console.error(e);
      if (statusEl) {
        statusEl.textContent = e?.message || "Could not save.";
      }
      saveBtn.disabled = false;
    }
  });
}

function syncColorInputs() {
  const map = [
    ["cg-c-floor", "floor"],
    ["cg-c-wall", "wall"],
    ["cg-c-rim", "rim"],
    ["cg-c-bg", "background"],
    ["cg-c-fog", "fog"],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    const v = state.colors[key];
    if (el && typeof v === "string") el.value = v;
  }
}

main().catch((e) => {
  console.error(e);
  if (errEl) {
    errEl.textContent = e?.message || "Could not load editor.";
    errEl.hidden = false;
  }
});
