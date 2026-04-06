/**
 * Rasterize Wikimedia Cretan labyrinth *walls* (stroke), then mark walkable = inside arena
 * and not wall. Produces a unicursal-friendly grid for openGridToEdgeGrid.
 * Run: node scripts/gen-conimbriga-grid.mjs
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALL_D = `M-100,-100
H-300
V450
H350
V-150
H50
V-50
H250
V350
H-200
V0
H200
V300
H-150
V50
H-50
V200
H100
V100
M100,-100
H300
V400
H-250
V-50
H-50
V-150
H-350
V500
H400
V-200
H0
V150
H50
V50
H150
V250
H-100
V100`;

const STROKE = 25;
const HALF = STROKE / 2;
const COLS = 51;
const ROWS = 51;

/** Outer arena from wall SVG fill (same file coordinate system as WALL_D). */
const OUTER_D = `M-50,-150 H-350 V500 H400 V-200 H0Z`;

function parseSvgPathD(d) {
  const tokens = d
    .replace(/[\n\r]/g, " ")
    .split(/(?=[MmLlHhVvZz])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let x = 0;
  let y = 0;
  const segments = [];
  let subStart = null;
  for (const t of tokens) {
    const cmd = t[0];
    const rest = t.slice(1).trim();
    if (cmd === "M" || cmd === "m") {
      const [nx, ny] = rest.split(/[\s,]+/).map(Number);
      if (cmd === "M") {
        x = nx;
        y = ny;
      } else {
        x += nx;
        y += ny;
      }
      subStart = [x, y];
    } else if (cmd === "L" || cmd === "l") {
      const [nx, ny] = rest.split(/[\s,]+/).map(Number);
      const ox = x;
      const oy = y;
      if (cmd === "L") {
        x = nx;
        y = ny;
      } else {
        x += nx;
        y += ny;
      }
      segments.push([ox, oy, x, y]);
    } else if (cmd === "H" || cmd === "h") {
      const nx = Number(rest);
      const ox = x;
      const oy = y;
      x = cmd === "H" ? nx : x + nx;
      segments.push([ox, oy, x, y]);
    } else if (cmd === "V" || cmd === "v") {
      const ny = Number(rest);
      const ox = x;
      const oy = y;
      y = cmd === "V" ? ny : y + ny;
      segments.push([ox, oy, x, y]);
    } else if (cmd === "Z" || cmd === "z") {
      if (subStart) {
        segments.push([x, y, subStart[0], subStart[1]]);
        x = subStart[0];
        y = subStart[1];
      }
    }
  }
  return segments;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const inter =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-20) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

function outerPolygonFromD(d) {
  const poly = [];
  let x = 0;
  let y = 0;
  const tokens = d
    .replace(/[\n\r]/g, " ")
    .split(/(?=[MmLlHhVvZz])/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const t of tokens) {
    const cmd = t[0];
    const rest = t.slice(1).trim();
    if (cmd === "M" || cmd === "m") {
      const [nx, ny] = rest.split(/[\s,]+/).map(Number);
      if (cmd === "M") {
        x = nx;
        y = ny;
      } else {
        x += nx;
        y += ny;
      }
      poly.push([x, y]);
    } else if (cmd === "H" || cmd === "h") {
      const nx = Number(rest);
      x = cmd === "H" ? nx : x + nx;
      poly.push([x, y]);
    } else if (cmd === "V" || cmd === "v") {
      const ny = Number(rest);
      y = cmd === "V" ? ny : y + ny;
      poly.push([x, y]);
    }
  }
  return poly;
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-20;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function minDistToSegments(px, py, segments) {
  let m = Infinity;
  for (const [x1, y1, x2, y2] of segments) {
    const d = distPointToSegment(px, py, x1, y1, x2, y2);
    if (d < m) m = d;
  }
  return m;
}

const segments = parseSvgPathD(WALL_D);
const outerPoly = outerPolygonFromD(OUTER_D);
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const [x1, y1, x2, y2] of segments) {
  minX = Math.min(minX, x1, x2);
  minY = Math.min(minY, y1, y2);
  maxX = Math.max(maxX, x1, x2);
  maxY = Math.max(maxY, y1, y2);
}
for (const [px, py] of outerPoly) {
  minX = Math.min(minX, px);
  minY = Math.min(minY, py);
  maxX = Math.max(maxX, px);
  maxY = Math.max(maxY, py);
}
const pad = 20;
minX -= pad;
minY -= pad;
maxX += pad;
maxY += pad;

const open2 = [];
for (let j = 0; j < ROWS; j++) {
  const row = [];
  for (let i = 0; i < COLS; i++) {
    const px = minX + ((i + 0.5) / COLS) * (maxX - minX);
    const py = minY + ((j + 0.5) / ROWS) * (maxY - minY);
    const inside = pointInPolygon(px, py, outerPoly);
    const d = minDistToSegments(px, py, segments);
    const isWall = d <= HALF;
    row.push(inside && !isWall);
  }
  open2.push(row);
}

let pathCells = 0;
for (const r of open2) for (const c of r) if (c) pathCells++;

const cx = (COLS - 1) / 2;
const cy = (ROWS - 1) / 2;
let start = { i: 0, j: ROWS - 1 };
let end = { i: Math.floor(cx), j: Math.floor(cy) };
for (let j = ROWS - 1; j >= 0; j--) {
  for (let i = 0; i < COLS; i++) {
    if (open2[j][i]) {
      start = { i, j };
      j = -1;
      break;
    }
  }
}
let bestD = Infinity;
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    if (!open2[j][i]) continue;
    const dd = (i - cx) ** 2 + (j - cy) ** 2;
    if (dd < bestD) {
      bestD = dd;
      end = { i, j };
    }
  }
}

console.log(JSON.stringify({ cols: COLS, rows: ROWS, pathCells, start, end }));

const out = `/** Auto-generated by scripts/gen-conimbriga-grid.mjs — classical Cretan walls from Wikimedia Cretan-labyrinth-square.svg (same family as Conímbriga House of the Fountains mosaic). */
export const CONIMBRIGA_COLS = ${COLS};
export const CONIMBRIGA_ROWS = ${ROWS};
export const CONIMBRIGA_START = ${JSON.stringify(start)};
export const CONIMBRIGA_END = ${JSON.stringify(end)};
export const CONIMBRIGA_OPEN = ${JSON.stringify(open2)};
`;
writeFileSync(join(__dirname, "../public/conimbriga-labyrinth-data.js"), out, "utf8");
console.log("Wrote public/conimbriga-labyrinth-data.js");
