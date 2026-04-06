/**
 * Westworld-inspired desert maze + low-poly hatchling from saved creator spec.
 */
import * as THREE from "three";
import {
  createCreatureGroup,
  ensureSpecShape,
  applyBodyPlanDefaults,
} from "./creator.js";
import {
  CELL,
  mulberry32,
  generateMaze,
  buildMazeGroup,
  openGridToEdgeGrid,
  hexToNum,
  cloneJson,
} from "./maze-shared.js";
import {
  CONIMBRIGA_COLS,
  CONIMBRIGA_ROWS,
  CONIMBRIGA_OPEN,
  CONIMBRIGA_START,
  CONIMBRIGA_END,
} from "./conimbriga-labyrinth-data.js";

const MAZE_MOVE_SPEED = 2.35;
const MAZE_MOVE_SUBSTEPS = 8;

/**
 * Built-in explorable mazes: procedural (seed) or embedded grid (open[][]).
 * Classical Cretan walls rasterized from Wikimedia Cretan-labyrinth-square.svg — same family as the
 * Roman mosaic labyrinth in the House of the Fountains, Conímbriga (Portugal).
 */
const CONSCIOUSNESS_MAZES = [
  {
    id: "cursors-default",
    name: "Cursor's Default",
    seed: 0xc0da424f,
  },
  {
    id: "conimbriga-cretan",
    name: "Conímbriga (Roman mosaic Cretan)",
    cols: CONIMBRIGA_COLS,
    rows: CONIMBRIGA_ROWS,
    open: CONIMBRIGA_OPEN,
    start: CONIMBRIGA_START,
    end: CONIMBRIGA_END,
  },
];
const DEFAULT_CONSCIOUSNESS_MAZE_ID = "cursors-default";

function resolveConsciousnessMazeId(raw, customMazes) {
  const customIds = new Set(
    (customMazes || []).map((m) => m && m.id).filter(Boolean)
  );
  if (raw && CONSCIOUSNESS_MAZES.some((m) => m.id === raw)) return raw;
  if (raw && customIds.has(raw)) return raw;
  return DEFAULT_CONSCIOUSNESS_MAZE_ID;
}

function getMazeDisplayName(mazeId, customMazes) {
  const c = (customMazes || []).find((m) => m && m.id === mazeId);
  if (c && c.name) return c.name;
  const b = CONSCIOUSNESS_MAZES.find((m) => m.id === mazeId);
  return b ? b.name : CONSCIOUSNESS_MAZES[0].name;
}

function getMazeRuntime(mazeId, customMazes) {
  const c = (customMazes || []).find((m) => m && m.id === mazeId);
  if (c && Array.isArray(c.open)) {
    return { kind: "custom", def: c };
  }
  const b = CONSCIOUSNESS_MAZES.find((m) => m.id === mazeId);
  if (b && Array.isArray(b.open)) {
    return { kind: "custom", def: b };
  }
  if (b && b.seed != null) {
    return { kind: "seed", seed: b.seed, name: b.name };
  }
  return {
    kind: "seed",
    seed: CONSCIOUSNESS_MAZES[0].seed,
    name: CONSCIOUSNESS_MAZES[0].name,
  };
}

function buildMergedMazeList(customMazes) {
  const list = CONSCIOUSNESS_MAZES.map((m) => ({
    id: m.id,
    name: m.name,
  }));
  for (const m of customMazes || []) {
    if (m && m.id && m.name) {
      list.push({ id: m.id, name: m.name, isCustom: true });
    }
  }
  return list;
}

function renderConsciousnessMazePanel(creatureId, mazeList, activeMazeId) {
  const ul = document.getElementById("consciousness-maze-list");
  if (!ul) return;
  ul.innerHTML = "";
  for (const m of mazeList) {
    const li = document.createElement("li");
    li.className = "consciousness-maze-item";
    const active = m.id === activeMazeId;
    if (active) {
      li.classList.add("consciousness-maze-item--active");
      li.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "consciousness-maze-name";
      name.textContent = m.name;
      const badge = document.createElement("span");
      badge.className = "consciousness-maze-badge";
      badge.textContent = "Current";
      li.appendChild(name);
      li.appendChild(badge);
    } else {
      li.setAttribute("aria-current", "false");
      const a = document.createElement("a");
      a.className = "consciousness-maze-link";
      a.href = `/consciousness.html?id=${encodeURIComponent(creatureId)}&maze=${encodeURIComponent(m.id)}`;
      a.textContent = m.name;
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
}

const FP_EYE_Y = 0.48;
const FP_MOUSE_SENS = 0.0022;
const FP_TOUCH_SENS = 0.004;
const FP_KEY_YAW_SPEED = 1.85;
const FP_PITCH_LIMIT = Math.PI * 0.45;

function prefersMobileMazeControls() {
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

function isTypingInFormField(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "select") return true;
  if (tag === "button") return false;
  if (tag === "a") return false;
  if (tag === "input") {
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

function wireMazeMobileControls(signal, keys) {
  const ui = document.getElementById("consciousness-mobile-ui");
  if (!ui || !prefersMobileMazeControls()) return;
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
}

function resolveMazeOffsets(grid, cols, rows, maxOff, state) {
  let { cellI, cellJ, offX, offZ } = state;
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    while (offX > maxOff) {
      if (cellI < cols - 1 && !grid[cellJ][cellI].e) {
        cellI += 1;
        offX -= CELL;
        changed = true;
      } else {
        offX = maxOff;
        changed = true;
        break;
      }
    }
    while (offX < -maxOff) {
      if (cellI > 0 && !grid[cellJ][cellI].w) {
        cellI -= 1;
        offX += CELL;
        changed = true;
      } else {
        offX = -maxOff;
        changed = true;
        break;
      }
    }
    while (offZ > maxOff) {
      if (cellJ < rows - 1 && !grid[cellJ][cellI].s) {
        cellJ += 1;
        offZ -= CELL;
        changed = true;
      } else {
        offZ = maxOff;
        changed = true;
        break;
      }
    }
    while (offZ < -maxOff) {
      if (cellJ > 0 && !grid[cellJ][cellI].n) {
        cellJ -= 1;
        offZ += CELL;
        changed = true;
      } else {
        offZ = -maxOff;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  cellI = Math.max(0, Math.min(cols - 1, cellI));
  cellJ = Math.max(0, Math.min(rows - 1, cellJ));
  offX = Math.max(-maxOff, Math.min(maxOff, offX));
  offZ = Math.max(-maxOff, Math.min(maxOff, offZ));
  state.cellI = cellI;
  state.cellJ = cellJ;
  state.offX = offX;
  state.offZ = offZ;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const loading = document.getElementById("consciousness-loading");
  const err = document.getElementById("consciousness-error");
  const host = document.getElementById("consciousness-canvas-host");
  const fpToggle = document.getElementById("consciousness-fp-toggle");

  if (!id) {
    if (loading) loading.hidden = true;
    if (err) {
      err.textContent = "Missing creature id.";
      err.hidden = false;
    }
    return;
  }

  const rawMaze = params.get("maze");

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    const nextParams = new URLSearchParams({
      id,
      maze: rawMaze || DEFAULT_CONSCIOUSNESS_MAZE_ID,
    });
    window.location.href =
      "/login.html?next=" +
      encodeURIComponent("/consciousness.html?" + nextParams.toString());
    return;
  }

  const res = await fetch(`/api/creatures/${encodeURIComponent(id)}`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (loading) loading.hidden = true;
    if (err) {
      err.textContent = res.status === 404 ? "Creature not found." : "Could not load creature.";
      err.hidden = false;
    }
    return;
  }

  const row = await res.json().catch(() => ({}));
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const rawSpec = payload.creator && payload.creator.spec;
  if (!rawSpec || typeof rawSpec !== "object") {
    if (loading) loading.hidden = true;
    if (err) {
      err.textContent =
        "This hatchling has no low-poly design yet. Open them in the low-poly creator from the hatchery result screen, save, then try again.";
      err.hidden = false;
    }
    return;
  }

  const spec = cloneJson(rawSpec);
  ensureSpecShape(spec);
  applyBodyPlanDefaults(spec);

  const customMazes = Array.isArray(payload.consciousnessMazes)
    ? payload.consciousnessMazes
    : [];
  const mazeId = resolveConsciousnessMazeId(rawMaze, customMazes);
  if (rawMaze != null && rawMaze !== mazeId) {
    const u = new URL(window.location.href);
    u.searchParams.set("maze", mazeId);
    history.replaceState({}, "", u);
  }
  const mergedMazeList = buildMergedMazeList(customMazes);
  renderConsciousnessMazePanel(id, mergedMazeList, mazeId);
  document.title = `${getMazeDisplayName(mazeId, customMazes)} — Consciousness — Tomagoatse`;

  const mazeRuntime = getMazeRuntime(mazeId, customMazes);
  let cols;
  let rows;
  let grid;
  let maze;
  let mazeColors = null;

  if (mazeRuntime.kind === "custom") {
    const def = mazeRuntime.def;
    cols = Number(def.cols);
    rows = Number(def.rows);
    if (
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      cols < 3 ||
      rows < 3 ||
      cols > 51 ||
      rows > 51 ||
      !Array.isArray(def.open) ||
      def.open.length !== rows
    ) {
      if (loading) loading.hidden = true;
      if (err) {
        err.textContent = "This custom maze could not be loaded.";
        err.hidden = false;
      }
      return;
    }
    for (let j = 0; j < rows; j++) {
      if (!Array.isArray(def.open[j]) || def.open[j].length !== cols) {
        if (loading) loading.hidden = true;
        if (err) {
          err.textContent = "This custom maze data is invalid.";
          err.hidden = false;
        }
        return;
      }
    }
    const open = def.open.map((row) => row.slice());
    grid = openGridToEdgeGrid(open, cols, rows);
    mazeColors = def.colors && typeof def.colors === "object" ? def.colors : {};
    maze = buildMazeGroup(grid, cols, rows, {
      open,
      colors: mazeColors,
      end: def.end && typeof def.end === "object" ? def.end : null,
    });
  } else {
    cols = 9;
    rows = 9;
    const mazeRng = mulberry32(mazeRuntime.seed);
    grid = generateMaze(cols, rows, mazeRng);
    maze = buildMazeGroup(grid, cols, rows);
  }

  const ox = (-(cols - 1) * CELL) / 2;
  const oz = (-(rows - 1) * CELL) / 2;
  /** Half-width from cell center. Need 2*maxOff ≈ CELL so after a boundary crossing (off ± CELL) the offset stays inside [−maxOff, maxOff]; smaller values bounce you back through the same wall. */
  const maxOff = CELL * 0.5 - 1e-5;

  const creature = createCreatureGroup(spec);
  creature.scale.setScalar(0.42);

  const mazeState = {
    cellI: 0,
    cellJ: 0,
    offX: 0,
    offZ: 0,
  };

  if (mazeRuntime.kind === "custom" && mazeRuntime.def.start) {
    const s = mazeRuntime.def.start;
    if (
      Number.isFinite(s.i) &&
      Number.isFinite(s.j) &&
      s.i >= 0 &&
      s.j >= 0 &&
      s.i < cols &&
      s.j < rows &&
      mazeRuntime.def.open[s.j][s.i]
    ) {
      mazeState.cellI = s.i;
      mazeState.cellJ = s.j;
    }
  }

  function syncCreatureFromMazeState() {
    creature.position.x = ox + mazeState.cellI * CELL + mazeState.offX;
    creature.position.y = 0;
    creature.position.z = oz + mazeState.cellJ * CELL + mazeState.offZ;
  }
  syncCreatureFromMazeState();

  const scene = new THREE.Scene();
  const bgHex = mazeColors?.background
    ? hexToNum(mazeColors.background)
    : 0xd4a574;
  const fogHex = mazeColors?.fog ? hexToNum(mazeColors.fog) : 0xc9a66b;
  scene.background = new THREE.Color(bgHex);
  scene.fog = new THREE.FogExp2(fogHex, 0.045);

  const hemi = new THREE.HemisphereLight(0xffe8c8, 0x4a3528, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.05);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  scene.add(maze);
  scene.add(creature);

  const topViewBoundsBox = new THREE.Box3().setFromObject(maze);
  const topViewCorners = [];
  {
    const b = topViewBoundsBox;
    for (const x of [b.min.x, b.max.x]) {
      for (const y of [b.min.y, b.max.y]) {
        for (const z of [b.min.z, b.max.z]) {
          topViewCorners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
  }

  function readHostSize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(r.width, 320);
    const h = Math.max(r.height, 280);
    let aspect = w / h;
    if (!Number.isFinite(aspect) || aspect <= 0) aspect = 16 / 9;
    return { w, h, aspect };
  }

  const TOP_VIEW_ZOOM_MIN = 0.35;
  const TOP_VIEW_ZOOM_MAX = 4;
  let topViewZoom = 1;

  /** Slight tilt from straight overhead so vertical walls face the camera (pure top-down sees walls edge-on). */
  const TOP_VIEW_TILT = 0.15;
  /** Base camera distance seed; wheel `topViewZoom` scales the fitted distance. */
  const TOP_VIEW_BASE_DIST = 96;
  /** Fixed vertical FOV; distance is iterated so projected AABB fills min(panel w,h). */
  const TOP_VIEW_FIXED_FOV = 50;

  const perspectiveCamera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 120);
  const topViewCamera = new THREE.PerspectiveCamera(
    TOP_VIEW_FIXED_FOV,
    16 / 9,
    0.5,
    500
  );

  const _topDir = new THREE.Vector3();
  const _boxSize = new THREE.Vector3();

  function fitViewportAndCameras() {
    const { w, h, aspect } = readHostSize();
    /** Larger of projected width/height (px) should match the panel’s shorter side. */
    const targetPx = Math.min(w, h) * 0.985;
    const tilt = TOP_VIEW_TILT;
    const center = topViewBoundsBox.getCenter(new THREE.Vector3());
    const radius =
      topViewBoundsBox.getSize(_boxSize).length() * 0.5 || 8;
    /** Eye must stay outside the maze’s bounding sphere (circumradius); zoom-in was placing it inside → blank view. */
    const minEyeDist = radius + 1.5;
    const maxEyeDist = radius * 48;
    _topDir.set(0, Math.cos(tilt), Math.sin(tilt)).normalize();

    topViewCamera.fov = TOP_VIEW_FIXED_FOV;
    topViewCamera.aspect = aspect;

    let dist = THREE.MathUtils.clamp(TOP_VIEW_BASE_DIST, minEyeDist, maxEyeDist);
    const vProj = new THREE.Vector3();
    for (let iter = 0; iter < 28; iter++) {
      dist = THREE.MathUtils.clamp(dist, minEyeDist, maxEyeDist);
      topViewCamera.position.copy(center).addScaledVector(_topDir, dist);
      topViewCamera.up.set(0, 1, 0);
      topViewCamera.lookAt(center);
      topViewCamera.updateProjectionMatrix();
      topViewCamera.updateMatrixWorld(true);

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let ci = 0; ci < topViewCorners.length; ci++) {
        vProj.copy(topViewCorners[ci]).project(topViewCamera);
        if (!Number.isFinite(vProj.x) || !Number.isFinite(vProj.y)) continue;
        minX = Math.min(minX, vProj.x);
        maxX = Math.max(maxX, vProj.x);
        minY = Math.min(minY, vProj.y);
        maxY = Math.max(maxY, vProj.y);
      }
      if (minX === Infinity) {
        dist = minEyeDist * 1.15;
        break;
      }
      const wp = (maxX - minX) * (w * 0.5);
      const hp = (maxY - minY) * (h * 0.5);
      const m = Math.max(wp, hp);
      if (!Number.isFinite(m) || m < 1e-4) break;
      /** Apparent size ~ 1/dist → scale dist by m/targetPx to reach targetPx (was inverted with target/m). */
      const sizeRatio = m / targetPx;
      const nextDist = dist * THREE.MathUtils.clamp(sizeRatio, 0.45, 2.05);
      if (Math.abs(nextDist - dist) < 1e-2 || Math.abs(m - targetPx) < 1.2) {
        dist = THREE.MathUtils.clamp(nextDist, minEyeDist, maxEyeDist);
        break;
      }
      dist = THREE.MathUtils.clamp(nextDist, minEyeDist, maxEyeDist);
    }

    dist /= topViewZoom;
    dist = THREE.MathUtils.clamp(dist, minEyeDist, maxEyeDist);
    topViewCamera.position.copy(center).addScaledVector(_topDir, dist);
    topViewCamera.up.set(0, 1, 0);
    topViewCamera.lookAt(center);
    const d = topViewCamera.position.distanceTo(center);
    topViewCamera.near = Math.max(0.08, d - radius * 1.35);
    topViewCamera.far = Math.max(400, d + radius * 8 + 250);
    topViewCamera.updateProjectionMatrix();

    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  if (!renderer.getContext()) {
    throw new Error(
      "WebGL is not available. Try another browser or enable hardware acceleration."
    );
  }
  if (THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  let firstPerson = false;

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  fitViewportAndCameras();

  host.appendChild(renderer.domElement);
  requestAnimationFrame(() => {
    fitViewportAndCameras();
  });

  const zoomSlider = document.getElementById("consciousness-zoom-slider");
  function syncTopViewZoomSlider() {
    if (!zoomSlider) return;
    const v = THREE.MathUtils.clamp(
      topViewZoom,
      TOP_VIEW_ZOOM_MIN,
      TOP_VIEW_ZOOM_MAX
    );
    topViewZoom = v;
    zoomSlider.value = String(v);
    zoomSlider.setAttribute("aria-valuenow", String(v));
  }
  if (zoomSlider) {
    zoomSlider.addEventListener("input", () => {
      if (firstPerson) return;
      const raw = parseFloat(zoomSlider.value);
      topViewZoom = THREE.MathUtils.clamp(
        Number.isFinite(raw) ? raw : 1,
        TOP_VIEW_ZOOM_MIN,
        TOP_VIEW_ZOOM_MAX
      );
      fitViewportAndCameras();
    });
  }
  syncTopViewZoomSlider();

  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      if (firstPerson) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.06 : 1 / 1.06;
      topViewZoom = THREE.MathUtils.clamp(
        topViewZoom * factor,
        TOP_VIEW_ZOOM_MIN,
        TOP_VIEW_ZOOM_MAX
      );
      fitViewportAndCameras();
      syncTopViewZoomSlider();
    },
    { passive: false }
  );

  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  renderer.domElement.addEventListener(
    "touchstart",
    (e) => {
      if (firstPerson || e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartZoom = topViewZoom;
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "touchmove",
    (e) => {
      if (firstPerson || e.touches.length !== 2 || pinchStartDist < 1e-3) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / pinchStartDist;
      topViewZoom = THREE.MathUtils.clamp(
        pinchStartZoom * ratio,
        TOP_VIEW_ZOOM_MIN,
        TOP_VIEW_ZOOM_MAX
      );
      fitViewportAndCameras();
      syncTopViewZoomSlider();
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "touchend",
    () => {
      pinchStartDist = 0;
    },
    { passive: true }
  );

  const clock = new THREE.Clock();
  const keys = new Set();
  const mobileAbort = new AbortController();
  wireMazeMobileControls(mobileAbort.signal, keys);

  const mobileMazeUi = prefersMobileMazeControls();

  let fpYaw = 0;
  let fpPitch = 0;
  let fpLookTouchId = null;
  let fpLookLastX = 0;
  let fpLookLastY = 0;

  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _fpFwd = new THREE.Vector3();
  const _fpRight = new THREE.Vector3();

  function applyFpToggleUi() {
    if (fpToggle) {
      fpToggle.setAttribute("aria-pressed", firstPerson ? "true" : "false");
      fpToggle.textContent = firstPerson ? "Top view" : "First person";
    }
    document.body.classList.toggle("consciousness-fp-mode", firstPerson);
    host.setAttribute(
      "aria-label",
      firstPerson
        ? "3D maze — first person: move the mouse to look, WASD to walk, V for top view"
        : mobileMazeUi
          ? "3D maze — top-down view; on-screen buttons move your hatchling; pinch to zoom; V for first person"
          : "3D maze — top-down view; scroll to zoom; WASD or arrows to walk; V for first person"
    );
  }

  function setFirstPerson(on) {
    firstPerson = on;
    creature.visible = !firstPerson;
    if (firstPerson) {
      fpYaw = creature.rotation.y;
      fpPitch = 0;
    } else {
      creature.rotation.y = fpYaw;
      fitViewportAndCameras();
      syncTopViewZoomSlider();
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
    }
    fpLookTouchId = null;
    applyFpToggleUi();
  }

  function toggleFirstPerson() {
    setFirstPerson(!firstPerson);
  }

  if (prefersMobileMazeControls()) {
    document.body.classList.add("consciousness-mobile");
    const mui = document.getElementById("consciousness-mobile-ui");
    if (mui) {
      mui.hidden = false;
      mui.setAttribute("aria-hidden", "false");
    }
  }
  applyFpToggleUi();

  if (fpToggle) {
    fpToggle.addEventListener("click", () => toggleFirstPerson());
  }

  function onFpMouseMove(e) {
    if (!firstPerson || document.pointerLockElement !== renderer.domElement) return;
    fpYaw -= e.movementX * FP_MOUSE_SENS;
    fpPitch -= e.movementY * FP_MOUSE_SENS;
    fpPitch = Math.max(-FP_PITCH_LIMIT, Math.min(FP_PITCH_LIMIT, fpPitch));
  }
  document.addEventListener("mousemove", onFpMouseMove);

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === renderer.domElement;
    renderer.domElement.style.cursor = locked && firstPerson ? "none" : "";
  });

  renderer.domElement.addEventListener(
    "click",
    () => {
      if (firstPerson && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock().catch(() => {});
      }
    },
    { passive: true }
  );

  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      if (!firstPerson || e.pointerType !== "touch") return;
      fpLookTouchId = e.pointerId;
      fpLookLastX = e.clientX;
      fpLookLastY = e.clientY;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "pointermove",
    (e) => {
      if (
        !firstPerson ||
        e.pointerId !== fpLookTouchId ||
        e.pointerType !== "touch"
      ) {
        return;
      }
      fpYaw -= (e.clientX - fpLookLastX) * FP_TOUCH_SENS;
      fpPitch -= (e.clientY - fpLookLastY) * FP_TOUCH_SENS;
      fpPitch = Math.max(-FP_PITCH_LIMIT, Math.min(FP_PITCH_LIMIT, fpPitch));
      fpLookLastX = e.clientX;
      fpLookLastY = e.clientY;
    },
    { passive: true }
  );
  function endFpLookTouch(e) {
    if (e.pointerId === fpLookTouchId) fpLookTouchId = null;
  }
  renderer.domElement.addEventListener("pointerup", endFpLookTouch, {
    passive: true,
  });
  renderer.domElement.addEventListener("pointercancel", endFpLookTouch, {
    passive: true,
  });

  host.addEventListener(
    "click",
    () => {
      host.focus({ preventScroll: true });
    },
    { passive: true }
  );

  const keydown = (e) => {
    if (isTypingInFormField(e.target)) return;
    if (e.code === "KeyV" && !e.repeat) {
      e.preventDefault();
      toggleFirstPerson();
      return;
    }
    if (
      e.code === "ArrowUp" ||
      e.code === "ArrowDown" ||
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight"
    ) {
      e.preventDefault();
    }
    keys.add(e.code);
  };
  const keyup = (e) => {
    keys.delete(e.code);
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  let mazeReadyShown = false;

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);

    let fx;
    let fz;
    let rx;
    let rz;
    if (firstPerson) {
      if (keys.has("KeyQ")) fpYaw += FP_KEY_YAW_SPEED * dt;
      if (keys.has("KeyE")) fpYaw -= FP_KEY_YAW_SPEED * dt;
      _fpFwd.set(0, 0, -1).applyAxisAngle(_yAxis, fpYaw);
      _fpRight.set(1, 0, 0).applyAxisAngle(_yAxis, fpYaw);
      fx = _fpFwd.x;
      fz = _fpFwd.z;
      rx = _fpRight.x;
      rz = _fpRight.z;
    } else {
      /** Top-down: screen-up is world −Z, screen-right is world +X. */
      fx = 0;
      fz = -1;
      rx = 1;
      rz = 0;
    }

    let inFwd = 0;
    let inStrafe = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) inFwd += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) inFwd -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) inStrafe += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) inStrafe -= 1;

    let vx = inStrafe * rx + inFwd * fx;
    let vz = inStrafe * rz + inFwd * fz;
    const moveLenHyp = Math.hypot(vx, vz);
    if (moveLenHyp > 1e-6) {
      vx /= moveLenHyp;
      vz /= moveLenHyp;
    }

    const subdt = dt / MAZE_MOVE_SUBSTEPS;
    for (let s = 0; s < MAZE_MOVE_SUBSTEPS; s++) {
      mazeState.offX += vx * MAZE_MOVE_SPEED * subdt;
      mazeState.offZ += vz * MAZE_MOVE_SPEED * subdt;
      resolveMazeOffsets(grid, cols, rows, maxOff, mazeState);
    }

    syncCreatureFromMazeState();

    if (firstPerson) {
      creature.rotation.y = fpYaw;
      perspectiveCamera.position.set(
        creature.position.x,
        creature.position.y + FP_EYE_Y,
        creature.position.z
      );
      perspectiveCamera.rotation.order = "YXZ";
      perspectiveCamera.rotation.y = fpYaw;
      perspectiveCamera.rotation.x = fpPitch;
      renderer.render(scene, perspectiveCamera);
    } else {
      if (moveLenHyp > 0.02) {
        const targetRot = Math.atan2(vx, vz);
        let diff = targetRot - creature.rotation.y;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        creature.rotation.y += diff * (1 - Math.exp(-11 * dt));
      }
      /** Top camera is far from the maze; FogExp2 would wash everything to the fog color (flat tan). */
      const prevFog = scene.fog;
      scene.fog = null;
      renderer.render(scene, topViewCamera);
      scene.fog = prevFog;
    }

    if (!mazeReadyShown && loading) {
      mazeReadyShown = true;
      loading.hidden = true;
      loading.setAttribute("aria-busy", "false");
    }
  }
  tick();

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => fitViewportAndCameras());
    ro.observe(host);
  }
  window.addEventListener(
    "resize",
    () => {
      fitViewportAndCameras();
    },
    { passive: true }
  );
}

main().catch((e) => {
  console.error(e);
  const err = document.getElementById("consciousness-error");
  const loading = document.getElementById("consciousness-loading");
  if (loading) loading.hidden = true;
  if (err) {
    err.textContent = e?.message || "Could not start the maze.";
    err.hidden = false;
  }
});
