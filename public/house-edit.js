import { slugForTownName } from "./town-slugs.js";
import {
  DEFAULT_HOUSE,
  ROOF_OPTS,
  STORIES_OPTS,
  DOOR_OPTS,
  ADDON_FRONT_OPTS,
  ADDON_LEFT_OPTS,
  FRONT_ACCESSORY_OPTS,
  houseFromPayload,
  mergeHouse,
  storyCountFromStories,
} from "./house-schema.js";
import { renderHouseSvg } from "./house-render.js";

function scaleToUi(v) {
  return Math.round((v * 100) / 1);
}

function uiToScale(u) {
  return Math.round(u) / 100;
}

function radioGroup(name, options, host, value, onChange) {
  host.innerHTML = "";
  for (const opt of options) {
    const id = `${name}-${String(opt).replace(/\s+/g, "-")}`;
    const label = document.createElement("label");
    label.className = "house-edit-radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = opt;
    input.id = id;
    input.checked = opt === value;
    input.addEventListener("change", () => {
      if (input.checked) onChange(opt);
    });
    const span = document.createElement("span");
    span.textContent =
      opt === "balcony"
        ? "Balcony"
        : name === "stories"
          ? opt.charAt(0).toUpperCase() + opt.slice(1)
          : opt;
    label.appendChild(input);
    label.appendChild(span);
    host.appendChild(label);
  }
}

function readWindowValuesFromDom() {
  const stories = document.querySelector('input[name="stories"]:checked')?.value;
  const n = storyCountFromStories(stories || "single");
  const wins = [];
  for (let i = 0; i < n; i++) {
    const el = document.getElementById(`house-windows-${i}`);
    wins.push(el ? Number(el.value) : 2);
  }
  return wins;
}

function getStateFromDom() {
  const w = document.getElementById("house-width");
  const h = document.getElementById("house-height");
  const roof = document.querySelector('input[name="roof"]:checked')?.value;
  const stories = document.querySelector('input[name="stories"]:checked')?.value;
  const door = document.querySelector('input[name="door"]:checked')?.value;
  const addonFront = document.querySelector('input[name="addonFront"]:checked')?.value;
  const addonLeft = document.querySelector('input[name="addonLeft"]:checked')?.value;
  const frontAccessory = document.querySelector(
    'input[name="frontAccessory"]:checked'
  )?.value;
  return mergeHouse(DEFAULT_HOUSE, {
    roof: roof || DEFAULT_HOUSE.roof,
    stories: stories || DEFAULT_HOUSE.stories,
    width: uiToScale(Number(w?.value)),
    height: uiToScale(Number(h?.value)),
    door: door || DEFAULT_HOUSE.door,
    windowsPerStory: readWindowValuesFromDom(),
    addonFront: addonFront || DEFAULT_HOUSE.addonFront,
    addonLeft: addonLeft || DEFAULT_HOUSE.addonLeft,
    frontAccessory: frontAccessory || DEFAULT_HOUSE.frontAccessory,
  });
}

function padWindowArrayToLength(arr, newN) {
  const base = arr.length ? arr : [2];
  const out = [];
  for (let i = 0; i < newN; i++) {
    const v = base[i] != null ? base[i] : base[base.length - 1];
    out.push(Math.min(4, Math.max(1, Math.round(Number(v)) || 2)));
  }
  return out;
}

function collectWindowValuesFromDom() {
  const prev = [];
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(`house-windows-${i}`);
    if (el) prev.push(Number(el.value));
  }
  return prev;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const creatureId = params.get("id");
  const loading = document.getElementById("house-edit-loading");
  const errBox = document.getElementById("house-edit-error");
  const content = document.getElementById("house-edit-content");
  const sub = document.getElementById("house-edit-sub");
  const back = document.getElementById("house-edit-back");
  const save = document.getElementById("house-edit-save");
  const status = document.getElementById("house-edit-status");
  const host = document.getElementById("house-edit-svg-host");
  const townNameEl = document.getElementById("house-edit-town-name");

  const me = await fetch("/api/auth/me", { credentials: "include" });
  if (me.status === 401) {
    window.location.href =
      "/login.html?next=" + encodeURIComponent(window.location.pathname + window.location.search);
    return;
  }

  const fetchUrl = creatureId
    ? `/api/creatures/${encodeURIComponent(creatureId)}`
    : "/api/creatures/me";

  const cr = await fetch(fetchUrl, { credentials: "include" });
  if (loading) loading.hidden = true;

  if (cr.status === 503) {
    if (errBox) {
      errBox.hidden = false;
      errBox.textContent = "Database is not configured.";
    }
    return;
  }

  if (!cr.ok) {
    if (errBox) {
      errBox.hidden = false;
      errBox.textContent =
        cr.status === 404
          ? "Creature not found."
          : "Could not load creature.";
    }
    return;
  }

  const row = await cr.json();
  const id = row.id;
  if (back) back.href = `/my-creature.html?id=${encodeURIComponent(id)}`;

  const initial = houseFromPayload(row.payload);
  let scene = null;

  async function loadScene() {
    const slug = slugForTownName(row.town);
    if (!slug) {
      scene = {};
      return;
    }
    const res = await fetch(`/api/town-scenes/${encodeURIComponent(slug)}`);
    if (res.ok) {
      scene = await res.json();
    } else {
      scene = {};
    }
  }

  function paint() {
    if (!host) return;
    const h = getStateFromDom();
    host.innerHTML = renderHouseSvg(h, scene || {});
  }

  function rebuildWindowSliders(perStory, storiesVal) {
    const whost = document.getElementById("house-windows-per-story-host");
    if (!whost) return;
    whost.innerHTML = "";
    const n = storyCountFromStories(storiesVal);
    const counts = padWindowArrayToLength(perStory, n);
    for (let i = 0; i < n; i++) {
      const cnt = counts[i];
      const tid = `house-windows-${i}`;
      const wrap = document.createElement("label");
      wrap.className = "house-edit-slider";
      const span = document.createElement("span");
      span.textContent = `Story ${i + 1}`;
      const input = document.createElement("input");
      input.type = "range";
      input.id = tid;
      input.min = "1";
      input.max = "4";
      input.step = "1";
      input.value = String(cnt);
      const valEl = document.createElement("span");
      valEl.className = "house-edit-range-val";
      valEl.id = `${tid}-val`;
      valEl.textContent = String(cnt);
      input.addEventListener("input", () => {
        valEl.textContent = input.value;
        paint();
      });
      wrap.appendChild(span);
      wrap.appendChild(input);
      wrap.appendChild(valEl);
      whost.appendChild(wrap);
    }
  }

  function applyToDom() {
    document.getElementById("house-width").value = String(scaleToUi(initial.width));
    document.getElementById("house-height").value = String(scaleToUi(initial.height));
    document.getElementById("house-width-val").textContent = String(initial.width);
    document.getElementById("house-height-val").textContent = String(initial.height);

    radioGroup("roof", ROOF_OPTS, document.getElementById("house-opt-roof"), initial.roof, () =>
      paint()
    );
    radioGroup(
      "stories",
      STORIES_OPTS,
      document.getElementById("house-opt-stories"),
      initial.stories,
      (newStories) => {
        const padded = padWindowArrayToLength(
          collectWindowValuesFromDom(),
          storyCountFromStories(newStories)
        );
        rebuildWindowSliders(padded, newStories);
        paint();
      }
    );
    radioGroup("door", DOOR_OPTS, document.getElementById("house-opt-door"), initial.door, () =>
      paint()
    );
    radioGroup(
      "addonFront",
      ADDON_FRONT_OPTS,
      document.getElementById("house-opt-addon-front"),
      initial.addonFront,
      () => paint()
    );
    radioGroup(
      "addonLeft",
      ADDON_LEFT_OPTS,
      document.getElementById("house-opt-addon-left"),
      initial.addonLeft,
      () => paint()
    );
    radioGroup(
      "frontAccessory",
      FRONT_ACCESSORY_OPTS,
      document.getElementById("house-opt-front-acc"),
      initial.frontAccessory,
      () => paint()
    );
    rebuildWindowSliders(initial.windowsPerStory, initial.stories);
  }

  await loadScene();
  if (townNameEl) townNameEl.textContent = row.town || "—";
  applyToDom();
  paint();

  const onSlide = () => {
    const wv = document.getElementById("house-width-val");
    const hv = document.getElementById("house-height-val");
    if (wv)
      wv.textContent = String(uiToScale(Number(document.getElementById("house-width").value)));
    if (hv)
      hv.textContent = String(uiToScale(Number(document.getElementById("house-height").value)));
    paint();
  };

  document.getElementById("house-width").addEventListener("input", onSlide);
  document.getElementById("house-height").addEventListener("input", onSlide);

  if (content) content.hidden = false;
  if (sub) {
    sub.textContent =
      "Colours follow your creature’s current town (" +
      (row.town || "—") +
      "). Change town on the creature page to reskin.";
  }

  save?.addEventListener("click", async () => {
    if (status) status.textContent = "";
    save.disabled = true;
    const body = getStateFromDom();
    try {
      const res = await fetch(`/api/creatures/${encodeURIComponent(id)}/house`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (status) status.textContent = "Saved.";
      setTimeout(() => {
        window.location.href = `/my-creature.html?id=${encodeURIComponent(id)}`;
      }, 400);
    } catch (e) {
      if (status) status.textContent = e.message || "Could not save.";
    } finally {
      save.disabled = false;
    }
  });
}

main().catch((e) => {
  console.error(e);
  const loading = document.getElementById("house-edit-loading");
  const errBox = document.getElementById("house-edit-error");
  if (loading) loading.hidden = true;
  if (errBox) {
    errBox.hidden = false;
    errBox.textContent = "Something went wrong.";
  }
});
