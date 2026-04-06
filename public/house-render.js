/**
 * Procedural SVG preview for creature houses (town palette drives colours).
 */

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length !== 3 && h.length !== 6) return { r: 120, g: 100, b: 80 };
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const x = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`;
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const u = Math.max(0, Math.min(1, t));
  return rgbToHex(
    A.r + (B.r - A.r) * u,
    A.g + (B.g - A.g) * u,
    A.b + (B.b - A.b) * u
  );
}

/**
 * @param {object} scene - merged town scene (accent, ground, groundLine, …)
 */
export function paletteFromScene(scene) {
  const accent = scene?.accent || "#c9a66b";
  const ground = scene?.ground || "#2a1810";
  const groundLine = scene?.groundLine || "#4a3224";
  return {
    wall: mixHex(ground, accent, 0.38),
    wallDark: mixHex(ground, groundLine, 0.45),
    roof: mixHex(accent, groundLine, 0.22),
    roofLight: mixHex(accent, ground, 0.15),
    trim: groundLine,
    door: mixHex(accent, ground, 0.55),
    doorFrame: mixHex(groundLine, ground, 0.35),
    window: mixHex(accent, "#e8e4dc", 0.25),
    windowFrame: groundLine,
    ground: ground,
    sky: scene?.skyBottom || mixHex(ground, accent, 0.2),
    accent,
  };
}

function storyCount(stories) {
  if (stories === "triple") return 3;
  if (stories === "double") return 2;
  return 1;
}

/**
 * @param {object} house — normalized house options from `house-schema.js`
 * @param {object} scene
 * @param {{ transparentBackground?: boolean }} [options] — town visit: no sky plate / horizon line
 * @returns {string} SVG markup (no outer <svg> wrapper — caller supplies)
 */
export function renderHouseSvgInner(house, scene, options) {
  const transparent = options?.transparentBackground === true;
  const pal = paletteFromScene(scene);
  const wScale = house.width;
  const hScale = house.height;
  const baseW = 56 + 48 * ((wScale - 0.5) / 1);
  const storyH = 18 + 16 * ((hScale - 0.5) / 1);
  const n = storyCount(house.stories);
  const bodyH = n * storyH;
  const cx = 110;
  const groundY = 148;
  const bodyBottom = groundY - 12;
  const bodyTop = bodyBottom - bodyH;
  const left = cx - baseW / 2;
  const right = cx + baseW / 2;

  let roofH =
    house.roof === "Flat" ? 6 : house.roof === "Hip" ? 22 : Math.min(28, 14 + baseW * 0.12);
  const roofTop = bodyTop - roofH;

  const parts = [];

  if (!transparent) {
    parts.push(
      `<rect x="0" y="0" width="220" height="160" fill="${pal.sky}" opacity="0.35" />`
    );
    parts.push(
      `<line x1="10" y1="${groundY}" x2="210" y2="${groundY}" stroke="${pal.trim}" stroke-width="3" />`
    );
  }
  parts.push(
    `<rect x="${left - 2}" y="${bodyBottom - 4}" width="${baseW + 4}" height="8" rx="1" fill="${pal.wallDark}" />`
  );

  if (house.addonLeft === "Garage") {
    const gw = baseW * 0.42;
    const gh = storyH * 1.1;
    const gx = left - gw - 4;
    const gy = bodyBottom - gh;
    parts.push(
      `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="${pal.wall}" stroke="${pal.trim}" stroke-width="1.5" />`
    );
    parts.push(
      `<rect x="${gx + gw * 0.12}" y="${gy + gh * 0.55}" width="${gw * 0.76}" height="${gh * 0.4}" fill="${pal.doorFrame}" />`
    );
  } else if (house.addonLeft === "Carport") {
    const gw = baseW * 0.5;
    const gx = left - gw - 2;
    parts.push(
      `<rect x="${gx}" y="${bodyTop + 8}" width="${gw}" height="6" fill="${pal.roof}" stroke="${pal.trim}" stroke-width="1" />`
    );
    parts.push(
      `<line x1="${gx + 4}" y1="${bodyTop + 14}" x2="${gx + 4}" y2="${groundY - 4}" stroke="${pal.trim}" stroke-width="2" />`
    );
    parts.push(
      `<line x1="${gx + gw - 4}" y1="${bodyTop + 14}" x2="${gx + gw - 4}" y2="${groundY - 4}" stroke="${pal.trim}" stroke-width="2" />`
    );
  } else if (house.addonLeft === "Garden") {
    const gx = left - 28;
    parts.push(
      `<ellipse cx="${gx}" cy="${groundY - 6}" rx="14" ry="8" fill="${mixHex(pal.accent, pal.ground, 0.5)}" opacity="0.85" />`
    );
    parts.push(
      `<ellipse cx="${gx - 6}" cy="${groundY - 4}" rx="6" ry="5" fill="${mixHex(pal.accent, "#fff", 0.35)}" opacity="0.7" />`
    );
  }

  parts.push(
    `<rect x="${left}" y="${bodyTop}" width="${baseW}" height="${bodyH}" fill="${pal.wall}" stroke="${pal.trim}" stroke-width="2" />`
  );

  for (let s = 1; s < n; s++) {
    const y = bodyBottom - s * storyH;
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${pal.trim}" stroke-width="1.2" opacity="0.65" />`
    );
  }

  const doorW =
    house.door === "Double" ? baseW * 0.28 : house.door === "Arch" ? baseW * 0.22 : baseW * 0.2;
  const doorH = storyH * 0.72;
  const doorLeft = cx - doorW / 2;
  const doorTop = bodyBottom - doorH - 2;

  if (house.addonFront === "Porch") {
    parts.push(
      `<rect x="${doorLeft - 8}" y="${doorTop + doorH - 4}" width="${doorW + 16}" height="6" fill="${pal.trim}" opacity="0.9" />`
    );
    parts.push(
      `<line x1="${doorLeft - 6}" y1="${doorTop}" x2="${doorLeft - 6}" y2="${doorTop + doorH}" stroke="${pal.trim}" stroke-width="2" />`
    );
    parts.push(
      `<line x1="${doorLeft + doorW + 6}" y1="${doorTop}" x2="${doorLeft + doorW + 6}" y2="${doorTop + doorH}" stroke="${pal.trim}" stroke-width="2" />`
    );
    parts.push(
      `<rect x="${doorLeft - 6}" y="${doorTop - 6}" width="${doorW + 12}" height="5" fill="${pal.roof}" />`
    );
  } else if (house.addonFront === "Steps") {
    for (let i = 0; i < 3; i++) {
      parts.push(
        `<rect x="${doorLeft - 4 - i * 2}" y="${bodyBottom - 3 - i * 3}" width="${doorW + 8 + i * 4}" height="3" fill="${pal.wallDark}" stroke="${pal.trim}" stroke-width="0.8" />`
      );
    }
  } else if (house.addonFront === "Ramp") {
    parts.push(
      `<polygon points="${doorLeft - 18},${bodyBottom} ${doorLeft - 4},${doorTop + doorH} ${doorLeft - 4},${bodyBottom}" fill="${pal.wallDark}" stroke="${pal.trim}" stroke-width="1" />`
    );
  } else if (house.addonFront === "Gable") {
    parts.push(
      `<polygon points="${cx},${doorTop - 18} ${doorLeft - 4},${doorTop + 2} ${doorLeft + doorW + 4},${doorTop + 2}" fill="${pal.roofLight}" stroke="${pal.trim}" stroke-width="1.2" />`
    );
  }

  if (house.door === "Arch") {
    parts.push(
      `<path d="M ${doorLeft} ${doorTop + doorH} L ${doorLeft} ${doorTop + doorW * 0.35} Q ${cx} ${doorTop - 4} ${doorLeft + doorW} ${doorTop + doorW * 0.35} L ${doorLeft + doorW} ${doorTop + doorH} Z" fill="${pal.door}" stroke="${pal.doorFrame}" stroke-width="1.5" />`
    );
  } else if (house.door === "Double") {
    const mid = doorW / 2;
    parts.push(
      `<rect x="${doorLeft}" y="${doorTop}" width="${mid - 1}" height="${doorH}" fill="${pal.door}" stroke="${pal.doorFrame}" stroke-width="1.2" />`
    );
    parts.push(
      `<rect x="${cx + 1}" y="${doorTop}" width="${mid - 1}" height="${doorH}" fill="${pal.door}" stroke="${pal.doorFrame}" stroke-width="1.2" />`
    );
  } else {
    parts.push(
      `<rect x="${doorLeft}" y="${doorTop}" width="${doorW}" height="${doorH}" fill="${pal.door}" stroke="${pal.doorFrame}" stroke-width="1.5" />`
    );
  }

  const winH = storyH * 0.32;
  const wps = Array.isArray(house.windowsPerStory) ? house.windowsPerStory : [2];
  for (let si = 0; si < n; si++) {
    const storyBottom = bodyBottom - si * storyH;
    const storyTop = storyBottom - storyH;
    const winY = storyTop + storyH * 0.22;
    const cnt = Math.min(4, Math.max(1, Number(wps[si]) || 2));
    const winW = Math.min(12, baseW / (cnt + 2));
    const gap = (baseW - cnt * winW) / (cnt + 1);
    for (let i = 0; i < cnt; i++) {
      const wx = left + gap + i * (winW + gap);
      parts.push(
        `<rect x="${wx}" y="${winY}" width="${winW}" height="${winH}" rx="1" fill="${pal.window}" stroke="${pal.windowFrame}" stroke-width="1.2" />`
      );
      parts.push(
        `<line x1="${wx + winW / 2}" y1="${winY}" x2="${wx + winW / 2}" y2="${winY + winH}" stroke="${pal.windowFrame}" stroke-width="0.8" />`
      );
    }
  }

  if (house.roof === "Gable") {
    parts.push(
      `<polygon points="${left - 4},${bodyTop} ${cx},${roofTop} ${right + 4},${bodyTop}" fill="${pal.roof}" stroke="${pal.trim}" stroke-width="2" />`
    );
  } else if (house.roof === "Hip") {
    parts.push(
      `<polygon points="${left - 2},${bodyTop} ${cx},${roofTop + 6} ${right + 2},${bodyTop}" fill="${pal.roof}" stroke="${pal.trim}" stroke-width="2" />`
    );
    parts.push(
      `<line x1="${cx}" y1="${roofTop + 6}" x2="${cx}" y2="${bodyTop - 2}" stroke="${pal.roofLight}" stroke-width="1" opacity="0.7" />`
    );
  } else {
    parts.push(
      `<rect x="${left - 3}" y="${bodyTop - 6}" width="${baseW + 6}" height="8" fill="${pal.roof}" stroke="${pal.trim}" stroke-width="1.5" />`
    );
  }

  if (house.addonFront === "balcony" && n >= 2) {
    const by = bodyBottom - storyH * 1.15;
    parts.push(
      `<rect x="${left + baseW * 0.15}" y="${by}" width="${baseW * 0.7}" height="5" fill="${pal.trim}" />`
    );
    parts.push(
      `<line x1="${left + baseW * 0.15}" y1="${by}" x2="${left + baseW * 0.15}" y2="${by - 10}" stroke="${pal.trim}" stroke-width="1.5" />`
    );
    parts.push(
      `<line x1="${right - baseW * 0.15}" y1="${by}" x2="${right - baseW * 0.15}" y2="${by - 10}" stroke="${pal.trim}" stroke-width="1.5" />`
    );
  }

  if (house.addonFront === "Chimney") {
    const chH = Math.max(20, bodyTop - roofTop + 10);
    parts.push(
      `<rect x="${right - 16}" y="${roofTop - 2}" width="12" height="${chH}" fill="${pal.wallDark}" stroke="${pal.trim}" stroke-width="1.2" />`
    );
  }

  const ax = cx + baseW * 0.42;
  const ay = groundY - 4;
  if (house.frontAccessory === "Mailbox") {
    parts.push(`<rect x="${ax}" y="${ay - 18}" width="10" height="12" rx="1" fill="${pal.roof}" stroke="${pal.trim}" stroke-width="1" />`);
    parts.push(
      `<line x1="${ax + 5}" y1="${ay - 6}" x2="${ax + 5}" y2="${ay}" stroke="${pal.trim}" stroke-width="2" />`
    );
  } else if (house.frontAccessory === "Lampost") {
    parts.push(
      `<line x1="${ax}" y1="${ay - 28}" x2="${ax}" y2="${ay}" stroke="${pal.trim}" stroke-width="2" />`
    );
    parts.push(`<circle cx="${ax}" cy="${ay - 30}" r="5" fill="${pal.accent}" stroke="${pal.trim}" />`);
  } else if (house.frontAccessory === "Planter") {
    parts.push(
      `<ellipse cx="${ax}" cy="${ay - 4}" rx="10" ry="5" fill="${pal.wallDark}" stroke="${pal.trim}" />`
    );
    parts.push(`<ellipse cx="${ax}" cy="${ay - 8}" rx="7" ry="4" fill="${mixHex(pal.accent, pal.ground, 0.4)}" />`);
  }

  return parts.join("");
}

/**
 * @param {object} scene — merged town scene (accent, ground, …)
 * @param {{ transparentBackground?: boolean }} [options]
 */
export function renderHouseSvg(house, scene, options) {
  const inner = renderHouseSvgInner(house, scene, options);
  const svgStyle = options?.transparentBackground
    ? ' style="background: transparent"'
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 160" width="220" height="160"${svgStyle} role="img" aria-label="House preview">${inner}</svg>`;
}
