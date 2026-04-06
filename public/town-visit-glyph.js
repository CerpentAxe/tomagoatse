/**
 * Procedural low-poly SVG icons for town-visit scenic props.
 * Shape family comes from `category`; variation is deterministic from `label` + `accent`.
 */

function hash32(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHex(hex) {
  const s = String(hex || "#888888").replace("#", "");
  const n = parseInt(s.length <= 4 ? s.padEnd(6, s[3] || s[2] || "0") : s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 140, g: 120, b: 100 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbHex({ r, g, b }) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[c(r), c(g), c(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function shade(rgb, mul, add = 0) {
  return {
    r: rgb.r * mul + add,
    g: rgb.g * mul + add,
    b: rgb.b * mul + add,
  };
}

function paletteFromAccent(accentHex, rnd) {
  const base = parseHex(accentHex);
  const m = 0.35 + rnd() * 0.35;
  const m2 = 0.55 + rnd() * 0.25;
  return {
    dark: rgbHex(shade(base, 0.42, -18)),
    mid: rgbHex(shade(base, m, 0)),
    light: rgbHex(shade(base, m2, 38)),
    face: rgbHex(shade(base, 0.78 + rnd() * 0.12, 12)),
    ink: rgbHex(shade(base, 0.28, -28)),
    rim: rgbHex(shade(base, 1.02, 58)),
    glow: rgbHex(shade(base, 0.92, 48)),
    shade: "rgba(12, 10, 8, 0.18)",
    shadeDeep: "rgba(6, 5, 4, 0.32)",
    mist: "rgba(200, 210, 220, 0.12)",
  };
}

function poly(points, fill, stroke = "rgba(0,0,0,0.14)", sw = 0.32) {
  const d =
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ") + " Z";
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter"/>`;
}

function lineQuad(p1, p2, w, fill, stroke = "rgba(0,0,0,0.1)") {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * w;
  const py = (dx / len) * w;
  const pts = [
    [p1[0] + px, p1[1] + py],
    [p2[0] + px, p2[1] + py],
    [p2[0] - px, p2[1] - py],
    [p1[0] - px, p1[1] - py],
  ];
  return poly(pts, fill, stroke, 0.28);
}

function ellipseFlat(cx, cy, rx, ry, fill) {
  return `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="${fill}"/>`;
}

function jitter(rnd, x, y, mag) {
  return [x + (rnd() - 0.5) * mag, y + (rnd() - 0.5) * mag];
}

function ngon(rnd, cx, cy, r, sides, rot, jMag, fill) {
  const pts = [];
  for (let j = 0; j < sides; j++) {
    const a = rot + (j / sides) * Math.PI * 2;
    pts.push(jitter(rnd, cx + Math.cos(a) * r, cy + Math.sin(a) * r, jMag));
  }
  return poly(pts, fill);
}

function plantsSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(22, 46.8, 16, 3.5, P.shadeDeep));
  parts.push(ellipseFlat(28, 46.5, 11, 2.2, P.shade));

  const trunks = [
    [20, 4.2],
    [26, 3.8],
  ];
  for (const [tw, th] of trunks) {
    const L = 18 + rnd() * 4;
    parts.push(
      poly(
        [
          [L, 46],
          [L + tw, 46],
          [L + tw - 0.4, 28],
          [L + 0.4, 28],
        ],
        P.ink
      )
    );
    for (let k = 0; k < 4; k++) {
      parts.push(
        poly(
          [
            [L + 0.5, 40 - k * 3],
            [L + tw - 0.5, 40 - k * 3],
            [L + tw - 0.5, 38 - k * 3],
            [L + 0.5, 38 - k * 3],
          ],
          k % 2 ? P.dark : P.mid
        )
      );
    }
  }

  for (let layer = 0; layer < 8; layer++) {
    const t = layer / 7;
    const y = 30 - t * 22 + rnd() * 2;
    const spread = 6 + t * 14;
    const cx = 24 + (rnd() - 0.5) * 8;
    const sides = 3 + (layer % 3);
    parts.push(ngon(rnd, cx, y, spread, sides, rnd() * 0.5, 2.5 + layer * 0.3, [P.mid, P.light, P.face, P.glow][layer % 4]));
  }

  for (let v = 0; v < 7; v++) {
    const x0 = 14 + rnd() * 20;
    parts.push(lineQuad([x0, 44 - v * 0.3], [x0 + rnd() * 4, 22 + rnd() * 6], 0.45 + rnd() * 0.3, P.dark));
  }

  for (let r = 0; r < 14; r++) {
    parts.push(
      poly(
        [
          jitter(rnd, 8 + rnd() * 32, 42 + rnd() * 4, 1.5),
          jitter(rnd, 10 + rnd() * 30, 40 + rnd() * 4, 1.5),
          jitter(rnd, 9 + rnd() * 31, 44 + rnd() * 2, 1.5),
        ],
        rnd() > 0.5 ? P.mid : P.dark
      )
    );
  }

  for (let m = 0; m < 10; m++) {
    parts.push(ngon(rnd, 6 + rnd() * 36, 8 + rnd() * 18, 1.2 + rnd() * 2, 5, rnd() * 6, 0.6, P.rim));
  }

  return parts.join("");
}

function naturalSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(24, 46.5, 22, 3.2, P.shadeDeep));
  parts.push(ellipseFlat(18, 44, 8, 2, P.mist));
  parts.push(ellipseFlat(32, 43, 7, 1.8, P.mist));

  for (let layer = 0; layer < 5; layer++) {
    const scale = 0.4 + layer * 0.15;
    const n = 4 + layer * 3;
    for (let i = 0; i < n; i++) {
      const cx = 4 + rnd() * 40;
      const cy = 6 + rnd() * 34;
      const sides = rnd() > 0.35 ? 4 + (i % 3) : 3;
      const r = (3 + rnd() * 9) * scale;
      const pts = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        pts.push(jitter(rnd, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5));
      }
      parts.push(poly(pts, [P.mid, P.light, P.face, P.dark, P.glow][(i + layer) % 5]));
    }
  }

  for (let k = 0; k < 22; k++) {
    const x = 2 + rnd() * 44;
    const y = 4 + rnd() * 36;
    parts.push(poly([jitter(rnd, x, y, 1.8), jitter(rnd, x + 2.5, y + 1.8, 1.8), jitter(rnd, x - 1.5, y + 2.5, 1.8)], P.rim));
  }

  for (let f = 0; f < 12; f++) {
    parts.push(
      poly(
        [
          jitter(rnd, 4 + f * 3.5, 46, 1),
          jitter(rnd, 6 + f * 3.5, 43, 1),
          jitter(rnd, 5 + f * 3.5, 45, 1),
        ],
        P.ink
      )
    );
  }

  return parts.join("");
}

function terrainSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(26, 47.2, 24, 3.5, P.shadeDeep));

  parts.push(
    poly(
      [
        [0, 48],
        jitter(rnd, 4, 38, 2),
        jitter(rnd, 10, 30, 3),
        jitter(rnd, 18, 18, 4),
        jitter(rnd, 26, 8, 5),
        jitter(rnd, 34, 16, 4),
        jitter(rnd, 42, 26, 3),
        [48, 48],
      ],
      P.mid
    )
  );

  parts.push(
    poly(
      [
        jitter(rnd, 4, 44, 2),
        jitter(rnd, 14, 28, 4),
        jitter(rnd, 24, 10, 5),
        jitter(rnd, 34, 20, 4),
        jitter(rnd, 44, 32, 3),
      ],
      P.light
    )
  );

  parts.push(
    poly(
      [
        jitter(rnd, 10, 36, 3),
        jitter(rnd, 22, 12, 5),
        jitter(rnd, 30, 6, 4),
      ],
      P.rim
    )
  );

  for (let b = 0; b < 22; b++) {
    const x = rnd() * 36;
    const y = 28 + rnd() * 16;
    parts.push(ngon(rnd, x, y, 1.5 + rnd() * 2.5, 4 + (b % 2), rnd() * 3, 1.2, [P.dark, P.mid, P.face][b % 3]));
  }

  for (let s = 0; s < 6; s++) {
    const y = 34 + s * 2;
    parts.push(
      poly(
        [
          [2 + rnd() * 4, y],
          [44 + rnd() * 2, y + rnd()],
          [43, y + 1.2],
          [3, y + 1],
        ],
        s % 2 ? P.ink : P.dark
      )
    );
  }

  parts.push(
    poly(
      [
        [0, 48],
        [0, 41],
        jitter(rnd, 4, 36, 2),
      ],
      P.ink
    )
  );

  parts.push(ellipseFlat(30, 38, 14, 4, P.mist));

  return parts.join("");
}

function infraSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(24, 47.2, 18, 3, P.shadeDeep));

  const tiers = [
    [10, 46, 38, 22],
    [12, 22, 36, 14],
    [14, 14, 34, 8],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [l, b, r, t] = tiers[i];
    parts.push(poly([[l, b], [r, b], [r, t], [l, t]], i === 0 ? P.ink : i === 1 ? P.dark : P.mid));
  }
  parts.push(poly([[17, 8], [31, 8], [29, 2], [19, 2]], P.light));
  parts.push(poly([[20, 4], [28, 4], [27, 0], [21, 0]], P.rim));

  const wx = 2.5 + rnd() * 2.5;
  parts.push(poly([[24 - wx, 24], [24 + wx, 24], [24 + wx, 38], [24 - wx, 38]], P.face));
  parts.push(poly([[24 - wx * 0.35, 26], [24 + wx * 0.35, 26], [24 + wx * 0.35, 36], [24 - wx * 0.35, 36]], P.ink));

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 14 + col * 6.5 + rnd();
      const y = 26 + row * 3.5;
      parts.push(poly([[x, y], [x + 2.8, y], [x + 2.8, y + 2.4], [x, y + 2.4]], P.light));
      parts.push(poly([[x + 0.4, y + 0.4], [x + 2.4, y + 0.4], [x + 2.4, y + 2], [x + 0.4, y + 2]], P.dark));
    }
  }

  parts.push(lineQuad([32, 12], [44, 4], 1.2, P.mid));
  parts.push(lineQuad([10, 18], [6, 8], 0.9, P.dark));
  for (let i = 0; i < 5; i++) {
    parts.push(lineQuad([12 + i * 5, 46], [13 + i * 5, 40], 0.7, P.ink));
  }

  parts.push(poly([[11, 44], [13, 44], [13, 46], [11, 46]], P.ink));
  parts.push(poly([[35, 44], [37, 44], [37, 46], [35, 46]], P.ink));

  for (let v = 0; v < 8; v++) {
    parts.push(ngon(rnd, 8 + rnd() * 32, 10 + rnd() * 12, 0.8, 4, rnd() * 2, 0.4, P.rim));
  }

  return parts.join("");
}

function sacredSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(24, 47.2, 22, 3.2, P.shadeDeep));

  parts.push(poly([[3, 46], [12, 46], [12, 20], [3, 20]], P.ink));
  parts.push(poly([[36, 46], [45, 46], [45, 20], [36, 20]], P.ink));
  parts.push(poly([[13, 20], [35, 20], [24, 2]], P.light));
  parts.push(poly([[15, 20], [33, 20], [24, 7]], P.mid));
  parts.push(poly([[17, 18], [31, 18], [24, 9]], P.face));
  parts.push(poly([[19, 16], [29, 16], [24, 11]], P.rim));
  parts.push(poly([[22, 2], [26, 2], [25, -1], [23, -1]], P.glow));

  const rose = 16;
  const rcx = 24;
  const rcy = 14;
  const rr = 5.5;
  for (let i = 0; i < rose; i++) {
    const a0 = (i / rose) * Math.PI * 2;
    const a1 = ((i + 1) / rose) * Math.PI * 2;
    parts.push(
      poly(
        [
          [rcx, rcy],
          [rcx + Math.cos(a0) * rr, rcy + Math.sin(a0) * rr],
          [rcx + Math.cos(a1) * rr, rcy + Math.sin(a1) * rr],
        ],
        i % 2 ? P.mid : P.light
      )
    );
  }

  for (let st = 0; st < 10; st++) {
    const x = 12 + st * 2.8;
    parts.push(poly([[x, 45.5], [x + 2.2, 45.5], [x + 2, 46], [x + 0.2, 46]], P.dark));
  }

  for (let c = 0; c < 8; c++) {
    const x = 5 + rnd() * 38;
    const y = 22 + rnd() * 20;
    parts.push(poly([[x, y], [x + 0.8, y - 3], [x + 1.6, y]], P.glow));
  }

  parts.push(poly([[18, 46], [30, 46], [29, 42], [19, 42]], P.ink));
  parts.push(lineQuad([12, 20], [8, 12], 1.5, P.dark));
  parts.push(lineQuad([36, 20], [40, 12], 1.5, P.dark));

  for (let b = 0; b < 12; b++) {
    parts.push(ngon(rnd, 4 + rnd() * 40, 4 + rnd() * 14, 0.9, 3, rnd() * 2, 0.5, P.rim));
  }

  return parts.join("");
}

function moonSvg(rnd, P) {
  const parts = [];
  const cx = 24 + (rnd() - 0.5) * 2;
  const cy = 24 + (rnd() - 0.5) * 2;
  const rOuter = 16 + rnd() * 1.5;

  const segs = 20;
  const ptsOuter = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ptsOuter.push(jitter(rnd, cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter, 0.9));
  }
  parts.push(poly(ptsOuter, P.light));

  const rIn = rOuter * 0.78;
  const ptsIn = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ptsIn.push(jitter(rnd, cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn, 0.6));
  }
  parts.push(poly(ptsIn, P.glow));

  const rCore = rIn * 0.62;
  const ptsCore = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ptsCore.push(jitter(rnd, cx + Math.cos(a) * rCore, cy + Math.sin(a) * rCore, 0.4));
  }
  parts.push(poly(ptsCore, P.face));

  const shadowOff = 3.5;
  const ptsSh = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 0.35 + (i / 8) * Math.PI * 0.55;
    ptsSh.push([cx + Math.cos(a) * rIn * 0.88 - shadowOff, cy + Math.sin(a) * rIn * 0.45]);
  }
  parts.push(poly(ptsSh, P.dark));

  for (let c = 0; c < 12; c++) {
    const a = rnd() * Math.PI * 2;
    const cr = 0.9 + rnd() * 1.8;
    const ccx = cx + Math.cos(a) * rIn * 0.5;
    const ccy = cy + Math.sin(a) * rIn * 0.5;
    const crater = [];
    for (let k = 0; k < 6; k++) {
      const aa = (k / 6) * Math.PI * 2;
      crater.push(jitter(rnd, ccx + Math.cos(aa) * cr, ccy + Math.sin(aa) * cr * 0.65, 0.35));
    }
    parts.push(poly(crater, P.ink));
  }

  parts.push(poly([[cx - 2, cy - 5], [cx + 12, cy - 10], [cx + 7, cy + 8]], P.rim));

  for (let ring = 0; ring < 3; ring++) {
    const rr = rOuter + 3 + ring * 2.2;
    const arc = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 0.1 + (i / 8) * Math.PI * 0.8;
      arc.push(jitter(rnd, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.35, 0.8));
    }
    parts.push(poly(arc, ring % 2 ? P.mist : P.mid));
  }

  for (let st = 0; st < 14; st++) {
    const sx = rnd() * 46;
    const sy = rnd() * 20;
    parts.push(poly([[sx, sy], [sx + 1.2, sy + 0.8], [sx, sy + 1.6], [sx - 1, sy + 0.7]], P.rim));
  }

  return parts.join("");
}

function buildingsSvg(rnd, P) {
  const parts = [];
  parts.push(ellipseFlat(24, 47.2, 20, 2.9, P.shadeDeep));

  parts.push(poly([[4, 46], [44, 46], [44, 24], [4, 24]], P.mid));
  parts.push(poly([[6, 24], [42, 24], [40, 14], [8, 14]], P.dark));
  parts.push(poly([[9, 14], [39, 14], [37, 6], [11, 6]], P.ink));

  parts.push(poly([[14, 6], [20, 6], [19, 2], [15, 2]], P.light));
  parts.push(poly([[26, 6], [34, 6], [33, 3], [27, 3]], P.light));
  parts.push(poly([[30, 24], [38, 24], [37, 18], [31, 18]], P.face));

  for (let w = 0; w < 5; w++) {
    const x = 8 + w * 6.8;
    parts.push(poly([[x, 40], [x + 4, 40], [x + 4, 45], [x, 45]], P.ink));
    parts.push(poly([[x + 0.6, 41], [x + 3.4, 41], [x + 3.4, 43.8], [x + 0.6, 43.8]], P.light));
    parts.push(poly([[x + 1.2, 42.2], [x + 2.8, 42.2], [x + 2.8, 43], [x + 1.2, 43]], P.dark));
  }

  parts.push(poly([[32, 38], [38, 38], [37, 44], [33, 44]], P.dark));
  parts.push(lineQuad([6, 46], [2, 44], 1.8, P.ink));
  parts.push(lineQuad([42, 46], [46, 44], 1.8, P.ink));
  parts.push(poly([[18, 24], [28, 24], [27, 20], [19, 20]], P.rim));

  for (let i = 0; i < 6; i++) {
    parts.push(lineQuad([10 + i * 6, 14], [11 + i * 6, 8], 0.55, P.mid));
  }

  for (let ivy = 0; ivy < 18; ivy++) {
    parts.push(
      poly(
        [
          jitter(rnd, 6 + rnd() * 36, 28 + rnd() * 16, 1),
          jitter(rnd, 7 + rnd() * 36, 26 + rnd() * 16, 1),
          jitter(rnd, 5.5 + rnd() * 36, 27 + rnd() * 16, 1),
        ],
        ivy % 2 ? P.mid : P.dark
      )
    );
  }

  return parts.join("");
}

const BUILDERS = {
  plantsTrees: plantsSvg,
  naturalFeatures: naturalSvg,
  terrain: terrainSvg,
  infrastructure: infraSvg,
  sacredSites: sacredSvg,
  moon: moonSvg,
  buildings: buildingsSvg,
};

export function buildLowPolyGlyphSvgString(opts) {
  const category = String(opts.category || "naturalFeatures");
  const label = String(opts.label || "prop");
  const accent = opts.accent || "#c9a66b";
  const seed = hash32(`${category}:${label}`);
  const rnd = mulberry32(seed);
  const P = paletteFromAccent(accent, rnd);
  const builder = BUILDERS[category] || naturalSvg;
  const inner = builder(rnd, P);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" class="tv-lowpoly-glyph-svg">${inner}</svg>`;
}

/**
 * @param {{ category?: string, label?: string, accent?: string, fontRem?: number, sizeScale?: number }} opts
 * — `sizeScale` multiplies the rendered size (e.g. 5–15 in town visit).
 */
export function createLowPolyGlyphElement(opts) {
  const wrap = document.createElement("span");
  wrap.className = "tv-visit-item-glyph tv-lowpoly-glyph";
  wrap.innerHTML = buildLowPolyGlyphSvgString(opts);
  const label = String(opts.label || "").trim();
  if (label) wrap.title = label;
  const rem = Number.isFinite(Number(opts.fontRem)) ? Number(opts.fontRem) : 1.35;
  const sizeScale =
    Number.isFinite(Number(opts.sizeScale)) && Number(opts.sizeScale) > 0 ? Number(opts.sizeScale) : 1;
  const px = rem * 1.15 * sizeScale;
  wrap.style.width = `${px}rem`;
  wrap.style.height = `${px}rem`;
  return wrap;
}
