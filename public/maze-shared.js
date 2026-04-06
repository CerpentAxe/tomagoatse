/**
 * Shared maze grid generation, serialization, and Three.js mesh building
 * for consciousness play mode and the maze editor.
 */
import * as THREE from "three";

export const CELL = 1.35;
export const WALL_H = 1.55;
export const WALL_T = 0.12;

export function hexToNum(hex) {
  if (hex == null || typeof hex !== "string") return 0xc4a574;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? n : 0xc4a574;
}

/** Odd dimensions work well for start/end path cells. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMaze(cols, rows, rng = Math.random) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      n: true,
      e: true,
      s: true,
      w: true,
      visited: false,
    }))
  );

  const stack = [];
  const sx = 0;
  const sy = 0;
  grid[sy][sx].visited = true;
  stack.push([sx, sy]);

  function neighbors(x, y) {
    const out = [];
    if (y > 0 && !grid[y - 1][x].visited) out.push([x, y - 1, "n", "s"]);
    if (x < cols - 1 && !grid[y][x + 1].visited) out.push([x + 1, y, "e", "w"]);
    if (y < rows - 1 && !grid[y + 1][x].visited) out.push([x, y + 1, "s", "n"]);
    if (x > 0 && !grid[y][x - 1].visited) out.push([x - 1, y, "w", "e"]);
    return out;
  }

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const n = neighbors(x, y);
    if (n.length === 0) {
      stack.pop();
      continue;
    }
    const pick = n[Math.floor(rng() * n.length)];
    const [nx, ny, dir, opp] = pick;
    grid[y][x][dir] = false;
    grid[ny][nx][opp] = false;
    grid[ny][nx].visited = true;
    stack.push([nx, ny]);
  }

  return grid;
}

export function stripGridVisited(grid, cols, rows) {
  const out = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({}))
  );
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = grid[j][i];
      out[j][i] = { n: !!c.n, e: !!c.e, s: !!c.s, w: !!c.w };
    }
  }
  return out;
}

export function gridFromCells(cells, cols, rows) {
  const grid = Array.from({ length: rows }, (_, j) =>
    Array.from({ length: cols }, (_, i) => {
      const c = cells[j][i];
      return {
        n: !!c.n,
        e: !!c.e,
        s: !!c.s,
        w: !!c.w,
        visited: false,
      };
    })
  );
  return grid;
}

/**
 * Walkable cells (corridors). Blocked cells are false.
 */
export function openGridToEdgeGrid(open, cols, rows) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      n: true,
      e: true,
      s: true,
      w: true,
      visited: false,
    }))
  );
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!open[j][i]) {
        grid[j][i].n = true;
        grid[j][i].e = true;
        grid[j][i].s = true;
        grid[j][i].w = true;
        continue;
      }
      grid[j][i].n = !(j > 0 && open[j][i] && open[j - 1][i]);
      grid[j][i].s = !(j < rows - 1 && open[j][i] && open[j + 1][i]);
      grid[j][i].w = !(i > 0 && open[j][i] && open[j][i - 1]);
      grid[j][i].e = !(i < cols - 1 && open[j][i] && open[j][i + 1]);
    }
  }
  return grid;
}

export function defaultOpenGrid(cols, rows, fill = true) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

/**
 * Expand a perfect-maze edge grid (each cell walkable, walls on edges) into a thick
 * occupancy grid for the maze editor: odd-sized grid where corridor centers sit on odd indices.
 * A 9×9 logical maze → 19×19 open[][].
 */
export function edgeMazeGridToOpenOccupancy(grid, mazeCols, mazeRows) {
  const cols = 2 * mazeCols + 1;
  const rows = 2 * mazeRows + 1;
  const open = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let mj = 0; mj < mazeRows; mj++) {
    for (let mi = 0; mi < mazeCols; mi++) {
      const c = grid[mj][mi];
      const r = 2 * mj + 1;
      const col = 2 * mi + 1;
      open[r][col] = true;
      if (mj > 0 && !c.n) open[r - 1][col] = true;
      if (mi < mazeCols - 1 && !c.e) open[r][col + 1] = true;
      if (mj < mazeRows - 1 && !c.s) open[r + 1][col] = true;
      if (mi > 0 && !c.w) open[r][col - 1] = true;
    }
  }
  return { open, cols, rows };
}

/**
 * Default start/end on traced mazes: prefer the **bottom** edge (common for START/END art).
 * Start = first walkable scanning bottom→top, left→right; end = bottom→top, right→left.
 */
export function pickDefaultEndpoints(open, cols, rows) {
  let start = { i: 0, j: 0 };
  let end = { i: cols - 1, j: rows - 1 };
  outer: for (let j = rows - 1; j >= 0; j--) {
    for (let i = 0; i < cols; i++) {
      if (open[j][i]) {
        start = { i, j };
        break outer;
      }
    }
  }
  outer2: for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      if (open[j][i]) {
        end = { i, j };
        break outer2;
      }
    }
  }
  return { start, end };
}

/** Otsu threshold on 0–255 luminance histogram (classical image binarization). */
function otsuThreshold256(hist256, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist256[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist256[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist256[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Max edge length for CV preprocessing (keeps browser work reasonable on huge uploads). */
const MAZE_PREPROCESS_MAX_SIDE = 2048;

function rgbDataToLuminanceFloat(data) {
  const n = data.length / 4;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    g[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return g;
}

/** Separable 3-tap binomial blur (approx Gaussian), edge clamped. */
function gaussianBlur3x3Gray(src, w, h) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const im = Math.max(0, i - 1);
      const ip = Math.min(w - 1, i + 1);
      const k = j * w + i;
      tmp[k] = (src[j * w + im] + 2 * src[k] + src[j * w + ip]) * 0.25;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const jm = Math.max(0, j - 1);
      const jp = Math.min(h - 1, j + 1);
      const k = j * w + i;
      dst[k] = (tmp[jm * w + i] + 2 * tmp[k] + tmp[jp * w + i]) * 0.25;
    }
  }
  return dst;
}

/** Histogram percentiles (2nd / 98th) for robust contrast stretch on document-like images. */
function luminancePercentileBounds(gray, w, h, pLow, pHigh) {
  const n = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    let b = Math.round(gray[i]);
    if (b < 0) b = 0;
    if (b > 255) b = 255;
    hist[b]++;
  }
  const targetLow = Math.max(1, Math.ceil((n * pLow) / 100));
  const targetHigh = Math.max(1, Math.ceil((n * pHigh) / 100));
  let acc = 0;
  let lowTh = 0;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc >= targetLow) {
      lowTh = t;
      break;
    }
  }
  acc = 0;
  let hiTh = 255;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc >= targetHigh) {
      hiTh = t;
      break;
    }
  }
  if (hiTh <= lowTh) hiTh = Math.min(255, lowTh + 1);
  return { lo: lowTh, hi: hiTh };
}

function stretchGrayTo8bit(gray, w, h, lo, hi) {
  const n = w * h;
  const range = hi - lo || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = ((gray[i] - lo) / range) * 255;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    out[i] = v;
  }
  return out;
}

function putGrayFloatToRgbaImageData(data, gray, w, h) {
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(gray[i])));
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
}

/**
 * Classical CV front-end before grid sampling: resize (cap), grayscale, light Gaussian denoise,
 * 2nd–98th percentile contrast stretch so ink vs paper separates more cleanly downstream.
 * @returns {{ canvas: HTMLCanvasElement, gray: Float32Array, w: number, h: number } | null}
 */
function preprocessMazeImageForTracing(imageSource) {
  const w0 = imageSource.width;
  const h0 = imageSource.height;
  if (!w0 || !h0) return null;
  let scale = 1;
  if (Math.max(w0, h0) > MAZE_PREPROCESS_MAX_SIDE) {
    scale = MAZE_PREPROCESS_MAX_SIDE / Math.max(w0, h0);
  }
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(imageSource, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  let gray = rgbDataToLuminanceFloat(imgData.data);
  gray = gaussianBlur3x3Gray(gray, w, h);
  const { lo, hi } = luminancePercentileBounds(gray, w, h, 2, 98);
  gray = stretchGrayTo8bit(gray, w, h, lo, hi);
  putGrayFloatToRgbaImageData(imgData.data, gray, w, h);
  ctx.putImageData(imgData, 0, 0);
  return { canvas, gray, w, h };
}

/** Sum table for O(1) local mean / variance (Sauvola). */
function buildIntegralImages(gray, w, h) {
  const W = w + 1;
  const sat = new Float64Array((h + 1) * W);
  const sat2 = new Float64Array((h + 1) * W);
  for (let y = 1; y <= h; y++) {
    const rowOff = (y - 1) * w;
    for (let x = 1; x <= w; x++) {
      const g = gray[rowOff + (x - 1)];
      const ij = y * W + x;
      const A = sat[(y - 1) * W + x];
      const B = sat[y * W + (x - 1)];
      const C = sat[(y - 1) * W + (x - 1)];
      sat[ij] = g + A + B - C;
      const g2 = g * g;
      sat2[ij] = g2 + sat2[(y - 1) * W + x] + sat2[y * W + (x - 1)] - sat2[(y - 1) * W + (x - 1)];
    }
  }
  return { sat, sat2, W };
}

function rectSum2D(sat, W, x0, y0, x1, y1) {
  return sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
}

/**
 * Sauvola binarization: local adaptive threshold — better than global Otsu on uneven scans.
 * Returns per-pixel wall mask (1 = dark ink / wall, 0 = paper / floor). Uses the full image rectangle
 * (no circular crop) so square mazes use corners and edges correctly.
 */
function sauvolaWallMask(gray, w, h, halfWin, kSauvola, R) {
  const { sat, sat2, W } = buildIntegralImages(gray, w, h);
  const wallMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - halfWin);
      const x1 = Math.min(w, x + halfWin + 1);
      const y0 = Math.max(0, y - halfWin);
      const y1 = Math.min(h, y + halfWin + 1);
      const cnt = (x1 - x0) * (y1 - y0);
      if (cnt < 1) {
        wallMask[y * w + x] = 0;
        continue;
      }
      const s = rectSum2D(sat, W, x0, y0, x1, y1);
      const s2 = rectSum2D(sat2, W, x0, y0, x1, y1);
      const m = s / cnt;
      const v = Math.max(0, s2 / cnt - m * m);
      const std = Math.sqrt(v);
      const T = m * (1 + kSauvola * (std / R - 1));
      const g = gray[y * w + x];
      wallMask[y * w + x] = g < T ? 1 : 0;
    }
  }
  return wallMask;
}

function wallMaskToOpenGrid(wallMask, w, h, cols, rows, wallMajority) {
  const open = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * h) / rows);
    const y1 = Math.floor(((j + 1) * h) / rows);
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * w) / cols);
      const x1 = Math.floor(((i + 1) * w) / cols);
      let wall = 0;
      let total = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          total++;
          if (wallMask[yy * w + xx]) wall++;
        }
      }
      const frac = total > 0 ? wall / total : 0;
      open[j][i] = frac < wallMajority;
    }
  }
  return open;
}

function pathFraction(open, cols, rows) {
  let p = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (open[j][i]) p++;
    }
  }
  return p / (cols * rows);
}

function openGridLooksHealthy(open, cols, rows) {
  const f = pathFraction(open, cols, rows);
  return f >= 0.05 && f <= 0.93;
}

function sauvolaOpenGridFromGray(gray, w, h, cols, rows) {
  const R = 128;
  const halfWin = Math.max(8, Math.min(26, Math.floor(Math.min(w, h) / 18)));
  const attempts = [
    { k: 0.2, wallMaj: 0.4 },
    { k: 0.16, wallMaj: 0.36 },
    { k: 0.26, wallMaj: 0.44 },
  ];
  for (const { k, wallMaj } of attempts) {
    const mask = sauvolaWallMask(gray, w, h, halfWin, k, R);
    const open = wallMaskToOpenGrid(mask, w, h, cols, rows, wallMaj);
    if (openGridLooksHealthy(open, cols, rows)) return open;
  }
  const mask = sauvolaWallMask(gray, w, h, halfWin + 4, 0.2, R);
  return wallMaskToOpenGrid(mask, w, h, cols, rows, 0.4);
}

/**
 * One canvas pixel per maze cell: draw the reference scaled to cols×rows with nearest-neighbor.
 * This locks **spatial alignment** between the picture and the grid (each cell = one sample of the art).
 */
function cellAlignedLuminance(imageSource, cols, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "low";
  }
  ctx.drawImage(imageSource, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const lum = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      lum[j * cols + i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    }
  }
  return lum;
}

/**
 * Supersample each grid cell in image space. `sp` scales with source resolution so thin strokes
 * get enough samples (polar/bilinear was smearing rings into checkerboard noise).
 * Per cell: min(mean, darkest sample) keeps black ink visible when it only covers a few subpixels.
 */
function cartesianCellLuminanceAdaptive(imageSource, cols, rows) {
  const w = imageSource.width;
  const h = imageSource.height;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const sp = Math.max(8, Math.min(16, Math.ceil(Math.max(w, h) / Math.max(cols, rows))));
  const sw = cols * sp;
  const sh = rows * sp;
  canvas.width = sw;
  canvas.height = sh;
  ctx.drawImage(imageSource, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const lum = new Float32Array(cols * rows);
  const sp2 = sp * sp;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let s = 0;
      let darkest = 255;
      for (let dj = 0; dj < sp; dj++) {
        for (let di = 0; di < sp; di++) {
          const sx = i * sp + di;
          const sy = j * sp + dj;
          const o = (sy * sw + sx) * 4;
          const L = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
          s += L;
          if (L < darkest) darkest = L;
        }
      }
      const mean = s / sp2;
      lum[j * cols + i] = Math.min(mean, darkest);
    }
  }
  return lum;
}

/** One 3×3 median pass on luminance before Otsu — damps isolated threshold flicker without eating 1-cell walls. */
function medianBlurLum3x3(lum, cols, rows) {
  const out = new Float32Array(cols * rows);
  const buf = new Float32Array(9);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let k = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          let jj = j + dj;
          let ii = i + di;
          if (jj < 0) jj = 0;
          if (jj >= rows) jj = rows - 1;
          if (ii < 0) ii = 0;
          if (ii >= cols) ii = cols - 1;
          buf[k++] = lum[jj * cols + ii];
        }
      }
      buf.sort((a, b) => a - b);
      out[j * cols + i] = buf[4];
    }
  }
  return out;
}

function lumToBinaryOpen(lum, cols, rows) {
  const n = cols * rows;
  const hist = new Array(256).fill(0);
  const lumByte = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.max(0, Math.min(255, Math.round(lum[i])));
    lumByte[i] = b;
    hist[b]++;
  }
  const T = otsuThreshold256(hist, n);
  const open = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      /** Walkable = lighter regions (paper / corridors). Dark = ink / walls. */
      open[j][i] = lumByte[idx] >= T;
    }
  }
  let pathCount = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (open[j][i]) pathCount++;
    }
  }
  const frac = pathCount / n;
  if (frac < 0.04 || frac > 0.96) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        open[j][i] = !open[j][i];
      }
    }
  }
  return open;
}

/**
 * Fallback when Sauvola is unhealthy: blend cell-aligned + supersampled luminance (not `min`, which
 * over-darkens and turns corridors into walls), then median + Otsu.
 */
function luminanceMergeOpenGrid(src, cols, rows) {
  const lumAlign = cellAlignedLuminance(src, cols, rows);
  const lumAdapt = cartesianCellLuminanceAdaptive(src, cols, rows);
  if (!lumAlign || !lumAdapt) return null;
  const n = cols * rows;
  const lum = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    lum[k] = 0.55 * lumAlign[k] + 0.45 * lumAdapt[k];
  }
  const lumMed = medianBlurLum3x3(lum, cols, rows);
  return lumToBinaryOpen(lumMed, cols, rows);
}

/**
 * Rasterize the reference into walkable vs wall cells.
 * Primary: Sauvola adaptive binarization at full preprocessed resolution, then majority vote per cell.
 * Fallback: blended luminance + Otsu when the adaptive result is degenerate (all path / all wall).
 */
export function imageToOpenGrid(imageSource, cols, rows) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    return {
      open: defaultOpenGrid(cols, rows, true),
      cols,
      rows,
    };
  }

  const pre = preprocessMazeImageForTracing(imageSource);
  const src = pre?.canvas ?? imageSource;

  let open = null;
  if (pre?.gray && pre.w && pre.h) {
    open = sauvolaOpenGridFromGray(pre.gray, pre.w, pre.h, cols, rows);
    if (!openGridLooksHealthy(open, cols, rows)) {
      open = null;
    }
  }

  if (!open) {
    const merged = luminanceMergeOpenGrid(src, cols, rows);
    open = merged || defaultOpenGrid(cols, rows, true);
  }

  return { open, cols, rows };
}

/**
 * Reference image scaled to exactly cols×rows pixels (nearest-neighbor). Use for AI alignment hints:
 * each pixel corresponds to one maze cell (i,j) = (x,y) in reading order.
 */
export function referenceToGridCellImageDataUrl(imageSource, cols, rows) {
  const pre = preprocessMazeImageForTracing(imageSource);
  const src = pre?.canvas ?? imageSource;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "low";
  }
  ctx.drawImage(src, 0, 0, cols, rows);
  return canvas.toDataURL("image/png");
}

/** Must stay in sync with server sanitizeConsciousnessMazePayload / consciousness-maze runtime. */
export const MAZE_GRID_MAX = 51;

/**
 * Pick grid dimensions from image aspect ratio (more cells along the long side), clamped for editor limits.
 * Nearly square references use a dense grid so thin strokes and center detail survive tracing.
 */
export function mazeGridSizeForImage(imgWidth, imgHeight) {
  const iw = Math.max(1, imgWidth);
  const ih = Math.max(1, imgHeight);
  const aspect = iw / ih;
  const minD = 11;
  const cap = MAZE_GRID_MAX;
  if (aspect >= 0.85 && aspect <= 1.15) {
    return { cols: cap, rows: cap };
  }
  const maxD = cap;
  let cols;
  let rows;
  if (aspect >= 1) {
    cols = maxD;
    rows = Math.max(minD, Math.min(cap, Math.round(maxD / aspect)));
  } else {
    rows = maxD;
    cols = Math.max(minD, Math.min(cap, Math.round(maxD * aspect)));
  }
  if (rows % 2 === 0) rows = Math.min(cap, rows + 1);
  if (cols % 2 === 0) cols = Math.min(cap, cols + 1);
  return { cols, rows };
}

const DEFAULT_COLORS = {
  floor: "#c4a574",
  wall: "#5c4a3a",
  rim: "#8b7355",
  background: "#d4a574",
  fog: "#c9a66b",
};

export function buildMazeGroup(grid, cols, rows, options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const open = options.open;
  const endPt = options.end;

  const sandMat = new THREE.MeshStandardMaterial({
    color: hexToNum(colors.floor),
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: hexToNum(colors.wall),
    roughness: 0.88,
    metalness: 0.06,
    flatShading: true,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: hexToNum(colors.rim),
    roughness: 0.9,
    flatShading: true,
  });
  const goalMat = new THREE.MeshStandardMaterial({
    color: 0x6ecf8f,
    roughness: 0.75,
    metalness: 0.1,
    flatShading: true,
    emissive: 0x1a4028,
    emissiveIntensity: 0.15,
  });

  const g = new THREE.Group();
  const ox = (-(cols - 1) * CELL) / 2;
  const oz = (-(rows - 1) * CELL) / 2;
  const hw = CELL * 0.5 + WALL_T * 0.5;

  const cellOpen = (i, j) => (open ? !!open[j][i] : true);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ox + i * CELL;
      const z = oz + j * CELL;

      if (!cellOpen(i, j)) {
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(CELL * 0.96, WALL_H * 0.92, CELL * 0.96),
          wallMat
        );
        block.position.set(x, WALL_H * 0.46, z);
        g.add(block);
        continue;
      }

      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 0.98, 0.06, CELL * 0.98),
        sandMat
      );
      floor.position.set(x, -0.03, z);
      g.add(floor);

      const cell = grid[j][i];
      if (cell.e) {
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(WALL_T, WALL_H, CELL),
          wallMat
        );
        w.position.set(x + hw, WALL_H * 0.5, z);
        g.add(w);
      }
      if (cell.s) {
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(CELL, WALL_H, WALL_T),
          wallMat
        );
        w.position.set(x, WALL_H * 0.5, z + hw);
        g.add(w);
      }
      if (cell.n && j === 0) {
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(CELL, WALL_H, WALL_T),
          wallMat
        );
        w.position.set(x, WALL_H * 0.5, z - hw);
        g.add(w);
      }
      if (cell.w && i === 0) {
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(WALL_T, WALL_H, CELL),
          wallMat
        );
        w.position.set(x - hw, WALL_H * 0.5, z);
        g.add(w);
      }
    }
  }

  if (endPt && cellOpen(endPt.i, endPt.j)) {
    const gx = ox + endPt.i * CELL;
    const gz = oz + endPt.j * CELL;
    const flag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.55, 8),
      goalMat
    );
    flag.position.set(gx, 0.35, gz);
    g.add(flag);
  }

  if (options.decorativeRim !== false) {
    const rimR = Math.max(cols, rows) * CELL * 0.55;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rimR, 0.09, 6, 48),
      rimMat
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    g.add(rim);
  }

  return g;
}

export function cloneJson(x) {
  try {
    return structuredClone(x);
  } catch {
    return JSON.parse(JSON.stringify(x));
  }
}
