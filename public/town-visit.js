import * as THREE from "three";
import {
  createCreatureGroup,
  ensureSpecShape,
  applyBodyPlanDefaults,
} from "./creator.js";
import { createLowPolyGlyphElement } from "./town-visit-glyph.js";
import { renderHouseSvg } from "./house-render.js";

function cloneSpec(raw) {
  try {
    return structuredClone(raw);
  } catch {
    return JSON.parse(JSON.stringify(raw));
  }
}

/** Normalize friendship keys from the API (avoids wrong buttons on casing/whitespace). */
function normalizeFriendRelationship(rel) {
  const r = String(rel ?? "none").trim().toLowerCase();
  if (r === "friend") return "friends";
  return r || "none";
}

function syncNeighborHouseFriendLabel(house) {
  if (!house?.friendsLabelEl) return;
  const rel = normalizeFriendRelationship(house.friendship?.relationship);
  house.friendsLabelEl.hidden = rel !== "friends";
}

/**
 * Side-view WebGL preview of the saved low-poly rig (same mesh as creator / consciousness).
 */
function initTownVisitCreature3D(hostEl, spec) {
  if (!hostEl) throw new Error("Missing 3D host element.");
  hostEl.replaceChildren();

  const scene = new THREE.Scene();
  scene.background = null;

  const hemi = new THREE.HemisphereLight(0xe8dcc8, 0x4a3528, 0.88);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff5e8, 1);
  key.position.set(4, 9, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8899cc, 0.38);
  rim.position.set(-3, 2, -4);
  scene.add(rim);

  const creature = createCreatureGroup(spec);
  creature.scale.setScalar(0.62);
  const box0 = new THREE.Box3().setFromObject(creature);
  creature.position.y -= box0.min.y;

  scene.add(creature);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.06, 48);

  function frameCamera() {
    const w = Math.max(2, hostEl.clientWidth || 180);
    const h = Math.max(2, hostEl.clientHeight || 180);
    camera.aspect = w / h;
    const box = new THREE.Box3().setFromObject(creature);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const dist = Math.max(size.y, size.z) * 2.5;
    camera.position.set(center.x + dist, center.y + size.y * 0.05, center.z);
    camera.lookAt(center.x, center.y, center.z);
    camera.updateProjectionMatrix();
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error("WebGL is not available.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  hostEl.appendChild(renderer.domElement);

  frameCamera();
  renderer.setSize(hostEl.clientWidth || 180, hostEl.clientHeight || 180);

  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  }
  loop();

  const ro = new ResizeObserver(() => {
    const w = hostEl.clientWidth;
    const h = hostEl.clientHeight;
    if (w < 2 || h < 2) return;
    frameCamera();
    renderer.setSize(w, h);
  });
  ro.observe(hostEl);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    if (renderer.domElement.parentNode === hostEl) {
      hostEl.removeChild(renderer.domElement);
    }
    scene.remove(creature);
  };
}

/** Matches `creator.js` — arms or back attachment wings. */
function creatureHasWings(spec) {
  const a = spec?.arms?.type;
  const b = spec?.backAttachment?.type;
  return a === "wings" || b === "wings";
}

function buildParticleClass(particle) {
  const p = String(particle || "").toLowerCase();
  if (p === "embers") return "tv-particle--ember";
  if (p === "drips") return "tv-particle--drip";
  if (p === "sparks") return "tv-particle--spark";
  if (p === "fireflies") return "tv-particle--fly";
  return "tv-particle--ember";
}

function seedParticles(host, particle, count = 24) {
  host.innerHTML = "";
  const cls = buildParticleClass(particle);
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = `tv-particle ${cls}`;
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = `${Math.random() * 40}%`;
    el.style.animationDelay = `${Math.random() * 8}s`;
    host.appendChild(el);
  }
}

const TV_VISIT_SEGMENTS = 20;

function seedVisitItems(world, scene) {
  if (!world) return;
  let host = document.getElementById("tv-visit-items");
  if (!host) {
    host = document.createElement("div");
    host.id = "tv-visit-items";
    host.className = "tv-visit-items";
    host.setAttribute("aria-hidden", "true");
    world.appendChild(host);
  }
  host.innerHTML = "";
  const pool = Array.isArray(scene.visitItemPool) ? scene.visitItemPool : [];
  if (!pool.length) return;

  const slugSafe = String(scene.slug || "town").replace(/[^a-z0-9-]/g, "") || "town";

  const accent = scene.accent || "#c9a66b";
  for (let s = 0; s < TV_VISIT_SEGMENTS; s++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) continue;
    const left = ((s + 0.12 + Math.random() * 0.56) / TV_VISIT_SEGMENTS) * 100;
    const el = document.createElement("div");
    el.className = `tv-visit-item tv-visit-item--${slugSafe}`;
    el.dataset.speed = String(pick.speed ?? 0.22);
    el.style.left = `${left}%`;
    el.style.bottom = `${pick.bottomPct ?? 14}%`;
    if (pick.opacity != null) el.style.opacity = String(pick.opacity);
    const label = typeof pick.label === "string" ? pick.label.trim() : "";
    if (label) el.title = label;
    const sizeScale = 5 + Math.random() * 10;
    const glyph = createLowPolyGlyphElement({
      category: pick.category || "naturalFeatures",
      label: label || "Scenic prop",
      accent,
      fontRem: pick.fontRem != null ? Number(pick.fontRem) : 1.35,
      sizeScale,
    });
    el.appendChild(glyph);
    host.appendChild(el);
  }
}

function applyScene(scene) {
  const sky = document.getElementById("tv-sky");
  const layersHost = document.getElementById("tv-layers");
  const fog = document.getElementById("tv-fog");
  const ground = document.getElementById("tv-ground-strip");
  const sun = document.getElementById("tv-sun");
  const world = document.getElementById("tv-world");

  if (sky) {
    sky.style.background = `linear-gradient(180deg, ${scene.skyTop} 0%, ${scene.skyBottom} 100%)`;
  }
  if (fog) {
    fog.style.background = `linear-gradient(180deg, transparent 20%, ${scene.fogColor} 90%)`;
  }
  if (ground) {
    ground.style.borderTopColor = scene.groundLine || scene.accent;
    ground.style.background = `linear-gradient(180deg, transparent 0%, ${scene.ground} 55%)`;
  }
  if (sun) {
    sun.hidden = !scene.sun;
    if (scene.sun) {
      sun.style.background = `radial-gradient(circle, ${scene.sunColor} 0%, transparent 70%)`;
    }
  }
  if (layersHost) {
    layersHost.innerHTML = "";
    const list = Array.isArray(scene.layers) ? scene.layers : [];
    list.forEach((L, idx) => {
      const d = document.createElement("div");
      d.className = "tv-layer";
      d.dataset.speed = String(L.speed ?? 0.2);
      d.dataset.layerIndex = String(idx);
      d.style.top = `${L.topPct ?? 0}%`;
      d.style.height = `${L.heightPct ?? 30}%`;
      d.style.background = L.gradient || "transparent";
      d.style.opacity = L.opacity != null ? String(L.opacity) : "1";
      layersHost.appendChild(d);
    });
  }
  if (world) {
    let ph = document.getElementById("tv-particles");
    if (!ph) {
      ph = document.createElement("div");
      ph.className = "tv-particles";
      ph.id = "tv-particles";
      world.appendChild(ph);
    }
    seedParticles(ph, scene.particle);
    seedVisitItems(world, scene);
  }

  document.body.style.setProperty("--tv-accent", scene.accent || "#c9a66b");
}

function seedNeighborHouses(world, scene, neighborRows, neighborState) {
  const host = document.getElementById("tv-neighbor-houses");
  if (!host || !neighborState) return;
  host.innerHTML = "";
  neighborState.houses = [];
  const n = neighborRows.length;
  if (!n) return;
  const W = Math.max(world.offsetWidth, 2400);
  const margin = W * 0.04;
  /** Houses sit ahead of the player (to the right of spawn) so you walk up to them. */
  const playerStartX = W / 2;
  const startForward = Math.min(W - margin - 80, playerStartX + 140);
  const endX = W - margin;
  const spanForward = Math.max(endX - startForward, 120);
  const slot = spanForward / Math.max(n + 1, 2);
  neighborRows.forEach((row, i) => {
    const jitter = (Math.random() - 0.5) * slot * 0.18;
    const worldX = startForward + slot * (i + 1) + jitter;
    const el = document.createElement("div");
    el.className = "tv-neighbor-house";
    el.dataset.speed = "0.32";
    el.dataset.worldX = String(worldX);
    el.dataset.creatureId = String(row.id);
    el.style.left = `${worldX}px`;
    el.style.zIndex = "12";
    const scale = 0.94 + Math.random() * 0.34;
    const inner = renderHouseSvg(row.house || {}, scene, {
      transparentBackground: true,
    });

    const label = document.createElement("div");
    label.className = "tv-neighbor-house-label";
    const nameLine = document.createElement("div");
    nameLine.className = "tv-neighbor-house-name";
    nameLine.textContent = row.display_name || row.title || "Neighbor";
    const friendsLine = document.createElement("div");
    friendsLine.className = "tv-neighbor-house-friends";
    friendsLine.textContent = "Friends";
    friendsLine.hidden =
      normalizeFriendRelationship(row.friendship?.relationship) !== "friends";
    label.appendChild(nameLine);
    label.appendChild(friendsLine);

    const svgWrap = document.createElement("div");
    svgWrap.className = "tv-neighbor-house-svg";
    svgWrap.style.transform = `scale(${scale})`;
    svgWrap.style.transformOrigin = "center bottom";
    svgWrap.innerHTML = inner;

    el.appendChild(label);
    el.appendChild(svgWrap);
    host.appendChild(el);
    neighborState.houses.push({
      el,
      worldX,
      /** Half visual width (~84px base × scale; matches .tv-neighbor-house width 168px). */
      halfWidth: 84 * scale,
      id: String(row.id),
      displayName: row.display_name || row.title || "Neighbor",
      friendship: row.friendship || { relationship: "none" },
      friendsLabelEl: friendsLine,
    });
  });
}

function isTypingInField(target) {
  if (!target || !target.tagName) return false;
  const t = target.tagName.toLowerCase();
  if (t === "textarea" || t === "select") return true;
  if (t === "input") {
    const type = (target.type || "").toLowerCase();
    if (type === "button" || type === "submit" || type === "checkbox" || type === "radio") return false;
    return true;
  }
  return false;
}

const KEY_LEFT = new Set(["KeyA", "ArrowLeft"]);
const KEY_RIGHT = new Set(["KeyD", "ArrowRight"]);
const KEY_CROUCH = new Set(["KeyS", "ArrowDown"]);
const KEY_FLY = new Set(["KeyW", "ArrowUp"]);

function runTownPlayfield(playfield, world, opts) {
  const {
    hasWings,
    charSprite,
    charBob,
    charShadow,
    characterEl,
    neighborState = { houses: [], activeBehind: null },
    selfCreatureId,
    promptEls,
  } = opts;

  const layers = () => world.querySelectorAll(".tv-layer");
  const sun = document.getElementById("tv-sun");
  const fog = document.getElementById("tv-fog");

  let playerX = NaN;
  let vx = 0;
  let vy = 0;
  let verticalPx = 0;
  let faceLeft = false;
  let lastT = 0;
  let raf = 0;

  const keysDown = new Set();

  function horizontalInput() {
    let input = 0;
    for (const k of keysDown) {
      if (KEY_RIGHT.has(k)) input += 1;
      if (KEY_LEFT.has(k)) input -= 1;
    }
    return input;
  }

  const GRAVITY = 2800;
  const GRAVITY_AIR_WINGS = 1100;
  const JUMP_V = 780;
  const FLY_THRUST = 2000;
  const MAX_RUN = 480;
  const CROUCH_MULT = 0.38;
  const ACCEL = 5200;
  const FRICTION = 9.5;

  function worldWidth() {
    return Math.max(world.offsetWidth, playfield.clientWidth);
  }

  function clampPlayer() {
    const W = worldWidth();
    const P = playfield.clientWidth;
    const half = P / 2;
    const maxX = W - half;
    playerX = Math.max(half, Math.min(maxX, playerX));
  }

  /** Same horizontal scroll as `syncCameraAndParallax` (world translate). */
  function getCameraX() {
    const W = worldWidth();
    const P = playfield.clientWidth;
    return Math.max(0, Math.min(W - P, playerX - P / 2));
  }

  /**
   * Neighbor houses use extra parallax vs the character (`translate3d` on `.tv-neighbor-house`).
   * Depth / menu logic must use this visual center, not raw `worldX`, or the wrong house wins after scroll.
   */
  function neighborHouseVisualCenterX(h, camX) {
    const speed = parseFloat(h.el?.dataset?.speed ?? "0.32") || 0.32;
    const shift = -camX * speed * 0.35;
    return h.worldX + shift;
  }

  function syncCameraAndParallax() {
    const camX = getCameraX();
    world.style.transform = `translate3d(${-camX}px, 0, 0)`;

    if (characterEl && Number.isFinite(playerX)) {
      characterEl.style.left = `${playerX}px`;
    }

    layers().forEach((el) => {
      const speed = parseFloat(el.dataset.speed || "0.2") || 0.2;
      const shift = -camX * speed * 0.35;
      el.style.transform = `translate3d(${shift}px, 0, 0)`;
    });
    if (sun && !sun.hidden) {
      sun.style.transform = `translate3d(${-camX * 0.06}px, 0, 0)`;
    }
    if (fog) {
      fog.style.transform = `translate3d(${-camX * 0.02}px, 0, 0)`;
    }
    world.querySelectorAll(".tv-visit-item").forEach((el) => {
      const speed = parseFloat(el.dataset.speed || "0.2") || 0.2;
      const shift = -camX * speed * 0.35;
      el.style.transform = `translate3d(${shift}px, 0, 0) translateX(-50%)`;
    });
    world.querySelectorAll(".tv-neighbor-house").forEach((el) => {
      const speed = parseFloat(el.dataset.speed || "0.32") || 0.32;
      const shift = -camX * speed * 0.35;
      el.style.transform = `translate3d(${shift}px, 0, 0) translateX(-50%)`;
    });
  }

  /**
   * Friend / portal actions only while `behindHouse` is set: the rig has passed the facade
   * so the house is drawn on top (character behind the house).
   */
  function updateNeighborPrompt(behindHouse) {
    neighborState.activeBehind = behindHouse || null;
    const {
      panel,
      nameEl,
      addBtn,
      portal,
      pending,
      accept,
      status,
    } = promptEls || {};
    if (!panel) return;
    if (status) status.textContent = "";
    if (!behindHouse) {
      panel.hidden = true;
      if (addBtn) addBtn.hidden = true;
      if (portal) portal.hidden = true;
      if (pending) pending.hidden = true;
      if (accept) accept.hidden = true;
      return;
    }
    panel.hidden = false;
    if (nameEl) {
      nameEl.textContent = behindHouse.displayName;
    }
    const rel = normalizeFriendRelationship(behindHouse.friendship?.relationship);
    const reqId = behindHouse.friendship?.request_id;

    const isFriends = rel === "friends";
    const incomingRequest = rel === "pending_in" && reqId;
    const outgoingPending = rel === "pending_out";

    const showPortal = isFriends && !!selfCreatureId;
    const showAccept = incomingRequest && !!accept;
    const showPendingNote = outgoingPending;
    const showAdd =
      !showPortal &&
      !showAccept &&
      !showPendingNote &&
      (rel === "none" || rel === "declined");

    if (addBtn) addBtn.hidden = !showAdd;
    if (portal) portal.hidden = !showPortal;
    if (pending) pending.hidden = !showPendingNote;
    if (accept) {
      accept.hidden = !showAccept;
      if (incomingRequest && reqId) accept.dataset.requestId = String(reqId);
    }
  }

  neighborState.refreshPrompt = () => {
    updateNeighborPrompt(neighborState.activeBehind);
  };

  function applySprite(input, typing) {
    const onGround = verticalPx <= 0 && vy <= 0;

    charSprite.style.transform = `translateY(${-verticalPx}px)`;

    const crouch =
      onGround &&
      (keysDown.has("KeyS") || keysDown.has("ArrowDown")) &&
      !typing;

    charSprite.classList.toggle("tv-char-sprite--crouch", crouch);
    charSprite.classList.toggle("tv-char-sprite--face-left", faceLeft);

    const walking = !typing && onGround && !crouch && input !== 0;
    charBob.classList.toggle("tv-char-bob--walk", walking);

    if (charShadow) {
      const h = Math.min(140, verticalPx);
      const dim = Math.max(0.25, 1 - h / 220);
      charShadow.style.opacity = String(dim);
      charShadow.style.transform = `scaleX(${0.85 + dim * 0.2})`;
    }
  }

  function tick(t) {
    const dt = lastT ? Math.min(0.045, (t - lastT) / 1000) : 0;
    lastT = t;

    const W = worldWidth();

    if (!Number.isFinite(playerX) && W > 0) {
      playerX = W / 2;
      clampPlayer();
    }

    const input = horizontalInput();
    if (input < 0) faceLeft = false;
    else if (input > 0) faceLeft = true;

    const typing = isTypingInField(document.activeElement);
    if (!typing && dt > 0) {
      const crouchHeld = keysDown.has("KeyS") || keysDown.has("ArrowDown");
      const onGround = verticalPx <= 0 && vy <= 0;
      const crouch = onGround && crouchHeld;

      const maxRun = crouch ? MAX_RUN * CROUCH_MULT : MAX_RUN;
      const targetVx = input * maxRun;
      if (input !== 0) {
        vx += (targetVx - vx) * Math.min(1, ACCEL * 0.00035 * (dt * 60));
      } else {
        const f = Math.exp(-FRICTION * dt);
        vx *= f;
        if (Math.abs(vx) < 4) vx = 0;
      }

      playerX += vx * dt;
      clampPlayer();

      if (verticalPx <= 0 && vy <= 0) {
        verticalPx = 0;
        vy = 0;
      } else {
        const wantFly =
          hasWings && [...keysDown].some((k) => KEY_FLY.has(k));
        const g = wantFly ? GRAVITY_AIR_WINGS : GRAVITY;
        vy -= g * dt;
        if (wantFly) vy += FLY_THRUST * dt;
        vy = Math.min(vy, 950);
        verticalPx += vy * dt;
        if (verticalPx < 0) {
          verticalPx = 0;
          vy = 0;
        }
      }
    }

    syncCameraAndParallax();
    applySprite(input, typing);

    /**
     * Depth: when the hatchling has walked *past* a house (horizontally overlapping),
     * the house draws in front (higher z-index) and the low-poly rig reads behind it.
     * Walking right: "past" = playerX past house center. Walking left: past = before center.
     */
    const camX = getCameraX();
    const vxDead = 18;
    function hasWalkedPastHouse(h) {
      const cx = neighborHouseVisualCenterX(h, camX);
      const dx = Math.abs(playerX - cx);
      if (dx >= h.halfWidth + 52) return false;
      if (vx > vxDead) return playerX > cx;
      if (vx < -vxDead) return playerX < cx;
      return playerX > cx;
    }

    let houseInFront = null;
    if (neighborState.houses && neighborState.houses.length) {
      let bestD = Infinity;
      for (const h of neighborState.houses) {
        if (!hasWalkedPastHouse(h)) continue;
        const cx = neighborHouseVisualCenterX(h, camX);
        const dx = Math.abs(playerX - cx);
        if (dx < bestD) {
          bestD = dx;
          houseInFront = h;
        }
      }
    }
    if (characterEl) {
      if (houseInFront) {
        characterEl.style.zIndex = "9";
        neighborState.houses.forEach((h) => {
          h.el.style.zIndex = h === houseInFront ? "22" : "12";
        });
      } else {
        characterEl.style.zIndex = "20";
        neighborState.houses.forEach((h) => {
          h.el.style.zIndex = "12";
        });
      }
    }
    updateNeighborPrompt(houseInFront);

    raf = requestAnimationFrame(tick);
  }

  function onKeyDown(e) {
    if (isTypingInField(e.target)) return;
    const code = e.code;
    if (
      KEY_LEFT.has(code) ||
      KEY_RIGHT.has(code) ||
      KEY_CROUCH.has(code) ||
      KEY_FLY.has(code) ||
      code === "Space"
    ) {
      e.preventDefault();
    }
    keysDown.add(code);

    if (code === "Space" && !e.repeat) {
      const onGround = verticalPx <= 0 && vy <= 0;
      const crouch =
        onGround &&
        (keysDown.has("KeyS") || keysDown.has("ArrowDown"));
      if (onGround && !crouch) {
        vy = JUMP_V;
        verticalPx = 0.001;
      }
    }
  }

  function onKeyUp(e) {
    keysDown.delete(e.code);
  }

  function onBlur() {
    keysDown.clear();
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  playfield.addEventListener("blur", onBlur);

  const ro = new ResizeObserver(() => {
    clampPlayer();
    syncCameraAndParallax();
  });
  ro.observe(playfield);
  ro.observe(world);

  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    playfield.removeEventListener("blur", onBlur);
    ro.disconnect();
  };
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const creatureId = params.get("creature");
  const townSlug = (params.get("town") || "").trim().toLowerCase();
  const errEl = document.getElementById("tv-error");
  const stage = document.getElementById("tv-stage");

  if (!creatureId || !townSlug) {
    if (errEl) {
      errEl.textContent = "Missing creature or town. Open this page from your creature’s Current Town panel.";
      errEl.hidden = false;
    }
    return;
  }

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.href = `/login.html?next=${next}`;
    return;
  }

  const [creatureRes, sceneRes] = await Promise.all([
    fetch(`/api/creatures/${encodeURIComponent(creatureId)}`, { credentials: "include" }),
    fetch(`/api/town-scenes/${encodeURIComponent(townSlug)}`),
  ]);

  if (!creatureRes.ok) {
    if (errEl) {
      errEl.textContent =
        creatureRes.status === 404
          ? "Creature not found or you don’t have access."
          : "Could not load your creature.";
      errEl.hidden = false;
    }
    return;
  }
  if (!sceneRes.ok) {
    if (errEl) {
      errEl.textContent = "Unknown town.";
      errEl.hidden = false;
    }
    return;
  }

  const creature = await creatureRes.json();
  const scene = await sceneRes.json();

  const displayName =
    creature.payload?.hatchery?.displayName ||
    creature.payload?.creator?.session?.displayName ||
    creature.title ||
    "Hatchling";

  const rawSpec = creature.payload?.creator?.spec;
  if (!rawSpec || typeof rawSpec !== "object") {
    if (errEl) {
      errEl.textContent =
        "This hatchling has no low-poly design yet. Open them in the low-poly creator from the hatchery result screen, save, then try town visit again.";
      errEl.hidden = false;
    }
    return;
  }

  const spec = cloneSpec(rawSpec);
  ensureSpecShape(spec);
  applyBodyPlanDefaults(spec);

  const hasWings = creatureHasWings(spec);

  document.title = `${scene.name} — ${displayName} — Tomagoatse`;
  const nameEl = document.getElementById("tv-town-name");
  const tagEl = document.getElementById("tv-town-tagline");
  const capEl = document.getElementById("tv-town-caption");
  if (nameEl) nameEl.textContent = scene.name;
  if (tagEl) tagEl.textContent = scene.tagline || "";
  if (capEl) {
    capEl.textContent = scene.caption || "";
    capEl.hidden = !scene.caption;
  }

  const hintFly = document.getElementById("tv-hint-fly");
  if (hintFly) hintFly.hidden = !hasWings;

  const back = document.getElementById("tv-back");
  if (back) {
    back.href = `/my-creature.html?id=${encodeURIComponent(creatureId)}`;
  }

  applyScene(scene);
  if (stage) stage.hidden = false;

  const loadingEl = document.getElementById("tv-loading");
  if (loadingEl) {
    loadingEl.hidden = false;
    loadingEl.setAttribute("aria-busy", "true");
  }

  const playfield = document.getElementById("tv-playfield");
  const world = document.getElementById("tv-world");
  const charSprite = document.getElementById("tv-char-sprite");
  const charBob = document.getElementById("tv-char-bob");
  const charShadow = document.getElementById("tv-character-shadow");
  const characterEl = document.getElementById("tv-character");

  const neighborState = { houses: [], activeBehind: null };
  try {
    const nbRes = await fetch(
      `/api/towns/visit-neighbors?${new URLSearchParams({
        town: scene.name,
        exclude: creatureId,
        viewerCreatureId: creatureId,
      })}`,
      { credentials: "include" }
    );
    if (nbRes.ok && world) {
      const nd = await nbRes.json();
      seedNeighborHouses(world, scene, nd.neighbors || [], neighborState);
    }
  } catch (e) {
    console.warn("[town visit neighbors]", e);
  }

  const promptEls = {
    panel: document.getElementById("tv-neighbor-prompt"),
    nameEl: document.getElementById("tv-neighbor-prompt-name"),
    addBtn: document.getElementById("tv-neighbor-add-friend"),
    portal: document.getElementById("tv-neighbor-portal"),
    pending: document.getElementById("tv-neighbor-prompt-pending"),
    accept: document.getElementById("tv-neighbor-accept"),
    status: document.getElementById("tv-neighbor-prompt-status"),
  };

  if (playfield && world && charSprite && charBob && characterEl) {
    runTownPlayfield(playfield, world, {
      hasWings,
      charSprite,
      charBob,
      charShadow,
      characterEl,
      neighborState,
      selfCreatureId: creatureId,
      promptEls,
    });
    stage?.addEventListener("click", () => {
      playfield.focus({ preventScroll: true });
    });

    promptEls.addBtn?.addEventListener("click", async () => {
      const peer = neighborState.activeBehind;
      const st = promptEls.status;
      if (!peer || !creatureId) return;
      promptEls.addBtn.disabled = true;
      if (st) st.textContent = "";
      try {
        const res = await fetch("/api/friend-requests", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromCreatureId: creatureId,
            toCreatureId: peer.id,
          }),
        });
        const raw = await res.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        if (!res.ok) {
          throw new Error(data.message || data.error || `HTTP ${res.status}`);
        }
        const accepted = data.status === "accepted";
        peer.friendship = accepted
          ? { relationship: "friends" }
          : { relationship: "pending_out", request_id: data.id };
        syncNeighborHouseFriendLabel(peer);
        if (st) {
          st.textContent = accepted
            ? "You’re friends — same town, instant homies."
            : "Request sent.";
        }
        neighborState.refreshPrompt?.();
      } catch (e) {
        if (st) st.textContent = e.message || "Could not send request.";
      } finally {
        promptEls.addBtn.disabled = false;
      }
    });

    const acceptBtn = promptEls.accept;
    acceptBtn?.addEventListener("click", async () => {
      const rid = acceptBtn.dataset.requestId;
      const st = promptEls.status;
      const peer = neighborState.activeBehind;
      if (!rid || !peer) return;
      acceptBtn.disabled = true;
      if (st) st.textContent = "";
      try {
        const res = await fetch(`/api/friend-requests/${encodeURIComponent(rid)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept" }),
        });
        const raw = await res.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        if (!res.ok) {
          throw new Error(data.message || data.error || `HTTP ${res.status}`);
        }
        peer.friendship = { relationship: "friends" };
        syncNeighborHouseFriendLabel(peer);
        if (st) st.textContent = "You’re friends — say hi in the portal.";
        neighborState.refreshPrompt?.();
      } catch (e) {
        if (st) st.textContent = e.message || "Could not accept.";
      } finally {
        acceptBtn.disabled = false;
      }
    });

    promptEls.portal?.addEventListener("click", () => {
      const peer = neighborState.activeBehind;
      if (!peer || !creatureId) return;
      if (normalizeFriendRelationship(peer.friendship?.relationship) !== "friends") {
        return;
      }
      const url = `/portal.html?self=${encodeURIComponent(creatureId)}&peer=${encodeURIComponent(peer.id)}&popup=1`;
      const w = window.open(
        url,
        "portalChat",
        "width=580,height=760,scrollbars=yes,resizable=yes,noopener,noreferrer"
      );
      if (w) w.focus();
    });
  }

  const host3d = document.getElementById("tv-char-3d-host");
  function dismissLoading() {
    if (loadingEl) {
      loadingEl.hidden = true;
      loadingEl.setAttribute("aria-busy", "false");
    }
    if (playfield) {
      requestAnimationFrame(() => playfield.focus({ preventScroll: true }));
    }
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!host3d) {
        dismissLoading();
        return;
      }
      try {
        initTownVisitCreature3D(host3d, spec);
      } catch (e) {
        console.error(e);
      } finally {
        dismissLoading();
      }
    });
  });
}

main().catch((e) => {
  console.error(e);
  const errEl = document.getElementById("tv-error");
  if (errEl) {
    errEl.textContent = e?.message || "Something went wrong.";
    errEl.hidden = false;
  }
});
