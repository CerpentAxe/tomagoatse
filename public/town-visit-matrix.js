import { createLowPolyGlyphElement } from "./town-visit-glyph.js";

const STORAGE_KEY = "tomagoatse-admin-secret-session";

function getSecret() {
  const input = document.getElementById("matrix-secret-input");
  return String(input?.value || "").trim();
}

function setError(msg) {
  const el = document.getElementById("matrix-error");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function categoryLabel(key, categories) {
  if (!key) return "Uncategorized";
  const c = categories.find((x) => x.key === key);
  return c ? c.label : `Other (${key})`;
}

function sortedPool(town, categories) {
  const pool = Array.isArray(town.visitItemPool) ? town.visitItemPool.filter(Boolean) : [];
  const order = new Map(categories.map((c, i) => [c.key, i]));
  const unknown = categories.length;
  return [...pool].sort((a, b) => {
    const ai = a.category && order.has(a.category) ? order.get(a.category) : unknown;
    const bi = b.category && order.has(b.category) ? order.get(b.category) : unknown;
    if (ai !== bi) return ai - bi;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
}

async function loadMatrix() {
  const secret = getSecret();
  setError("");
  if (!secret) {
    setError("Enter the admin secret.");
    return;
  }

  const btn = document.getElementById("matrix-load-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading…";
  }

  try {
    const res = await fetch("/api/admin/town-scenes", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || data.error || `HTTP ${res.status}`);
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, secret);
    } catch {
      /* ignore */
    }

    const towns = data.towns || [];
    const categories = data.visitMatrixCategories || [];
    const root = document.getElementById("matrix-towns-root");
    const results = document.getElementById("matrix-results");
    if (!root || !results) return;

    root.innerHTML = "";

    for (const town of towns) {
      const block = document.createElement("section");
      block.className = "town-matrix-town-block";

      const title = document.createElement("h2");
      title.className = "town-matrix-town-name";
      title.textContent = town.name || town.slug || "Town";
      block.appendChild(title);

      const wrap = document.createElement("div");
      wrap.className = "town-matrix-wrap";

      const table = document.createElement("table");
      table.className = "town-matrix-table town-matrix-table--props";

      const thead = document.createElement("thead");
      const trHead = document.createElement("tr");
      const thCat = document.createElement("th");
      thCat.scope = "col";
      thCat.className = "town-matrix-th-category";
      thCat.textContent = "category";
      const thGlyph = document.createElement("th");
      thGlyph.scope = "col";
      thGlyph.className = "town-matrix-th-glyph";
      thGlyph.textContent = "glyph";
      const thLabel = document.createElement("th");
      thLabel.scope = "col";
      thLabel.className = "town-matrix-th-label";
      thLabel.textContent = "label";
      trHead.appendChild(thCat);
      trHead.appendChild(thGlyph);
      trHead.appendChild(thLabel);
      thead.appendChild(trHead);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      const pool = sortedPool(town, categories);

      if (!pool.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.className = "town-matrix-empty-cell";
        td.textContent = "No visit items in pool.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        for (const it of pool) {
          const tr = document.createElement("tr");
          const tdC = document.createElement("td");
          tdC.className = "town-matrix-td-category";
          tdC.textContent = categoryLabel(it.category, categories);

          const tdG = document.createElement("td");
          tdG.className = "town-matrix-td-glyph";
          const glyph = createLowPolyGlyphElement({
            category: it.category || "naturalFeatures",
            label: it.label || "",
            accent: town.accent || "#c9a66b",
            fontRem: 1.25,
          });
          glyph.classList.add("town-matrix-lowpoly");
          tdG.appendChild(glyph);

          const tdL = document.createElement("td");
          tdL.className = "town-matrix-td-label";
          tdL.textContent = it.label || "";

          tr.appendChild(tdC);
          tr.appendChild(tdG);
          tr.appendChild(tdL);
          tbody.appendChild(tr);
        }
      }

      table.appendChild(tbody);
      wrap.appendChild(table);
      block.appendChild(wrap);
      root.appendChild(block);
    }

    results.hidden = false;
  } catch (e) {
    setError(e?.message || "Network error.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Load matrix";
    }
  }
}

function init() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const input = document.getElementById("matrix-secret-input");
      if (input) input.value = saved;
    }
  } catch {
    /* ignore */
  }
  document.getElementById("matrix-load-btn")?.addEventListener("click", loadMatrix);
}

init();
