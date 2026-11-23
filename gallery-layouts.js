// ---------- Client gallery layouts and background colours ----------
// Shared by the client gallery page (/g/<code>/, delivery.js) and SOP Studio's layout preview, so what you
// arrange in Studio is exactly what the client sees. Each layout works out a box for every photo from the width
// it has and each photo's proportions; place() then puts the photos in those boxes.
// gallery.json keeps the choice: "layout" (one of the ids below), "order" (file names, spot 1 first) and
// "bg" (a colour like "#f3efe6"). A gallery without them shows the staggered layout on the site's own colours,
// as every gallery did before layouts existed.
// The list of ids is repeated in _functions_lib/delivery.js (LAYOUTS), which checks what Studio saves.
(function (root) {
"use strict";

const gapFor = (W) => (W < 720 ? 8 : 12);

// Every photo at its own proportions, each dropped into the shortest column.
function columns(W, ratios, cols, tallest) {
  const G = gapFor(W);
  const colW = (W - G * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  const rects = ratios.map((r) => {
    const c = heights.indexOf(Math.min(...heights));
    const h = Math.min(colW / r, colW * tallest);
    const rect = { x: c * (colW + G), y: heights[c], w: colW, h };
    heights[c] += h + G;
    return rect;
  });
  return { rects, height: Math.max(0, Math.max(...heights) - G) };
}

// Fixed spots: each item is { col, row, cols, rows } on a grid of square-ish cells.
function cells(W, list, C, cellRatio, blockRows, pattern) {
  const G = gapFor(W);
  const u = (W - G * (C - 1)) / C;
  const ch = u * cellRatio;
  let bottom = 0;
  const rects = list.map((_, i) => {
    const block = Math.floor(i / pattern(0).length);
    const spots = pattern(block);
    const s = spots[i % spots.length];
    const top = block * (blockRows * (ch + G));
    const rect = { x: s.col * (u + G), y: top + s.row * (ch + G), w: s.cols * u + (s.cols - 1) * G, h: s.rows * ch + (s.rows - 1) * G };
    bottom = Math.max(bottom, rect.y + rect.h);
    return rect;
  });
  return { rects, height: bottom };
}

// Rows of even height, every photo uncropped: photos go into a row until it would be wider than the page at the
// target height, then the row is scaled to fill the width exactly.
function justified(W, r, target) {
  const G = gapFor(W);
  const rects = [];
  let y = 0, row = [];
  const flush = (last) => {
    if (!row.length) return;
    const sum = row.reduce((s, i) => s + r[i], 0);
    let h = (W - G * (row.length - 1)) / sum;
    if (last && h > target) h = target; // a short last row keeps the usual height instead of blowing up
    let x = 0;
    for (const i of row) { rects[i] = { x, y, w: r[i] * h, h }; x += r[i] * h + G; }
    y += h + G;
    row = [];
  };
  r.forEach((ratio, i) => {
    row.push(i);
    const width = row.reduce((s, j) => s + r[j] * target, 0) + G * (row.length - 1);
    if (width >= W - 1) flush(false);
  });
  flush(true);
  return { rects, height: Math.max(0, y - G) };
}

// A set number of photos to a row, all the same height and uncropped, each row filling the width. A short last
// row keeps the height a full row of tall photos would have, centred.
function perRow(W, r, C) {
  const G = gapFor(W);
  const rects = [];
  let y = 0;
  for (let i = 0; i < r.length; i += C) {
    const row = r.slice(i, i + C);
    let h = (W - G * (row.length - 1)) / row.reduce((s, x) => s + x, 0);
    if (row.length < C) h = Math.min(h, (W - G * (C - 1)) / (C * 0.67));
    let x = (W - (row.reduce((s, ratio) => s + ratio * h, 0) + G * (row.length - 1))) / 2;
    row.forEach((ratio, j) => { rects[i + j] = { x, y, w: ratio * h, h }; x += ratio * h + G; });
    y += h + G;
  }
  return { rects, height: Math.max(0, y - G) };
}

// A photo shown whole inside a box, centred.
function inside(box, r) {
  const w = Math.min(box.w, box.h * r);
  const h = w / r;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const LAYOUTS = [
  { id: "masonry", name: "Staggered", about: "Every photo uncropped, in columns. The original layout.",
    fn: (W, r) => columns(W, r, W < 900 ? 2 : 3, 2) },

  { id: "grid", name: "Even grid", about: "Square tiles in tidy rows.",
    fn(W, r) {
      const C = W >= 1000 ? 4 : W >= 640 ? 3 : 2;
      const G = gapFor(W);
      const s = (W - G * (C - 1)) / C;
      const rects = r.map((_, i) => ({ x: (i % C) * (s + G), y: Math.floor(i / C) * (s + G), w: s, h: s }));
      return { rects, height: r.length ? Math.ceil(r.length / C) * (s + G) - G : 0 };
    } },

  { id: "rows", name: "Justified rows", about: "Rows of even height, every photo uncropped.",
    fn: (W, r) => justified(W, r, W >= 900 ? 300 : W >= 560 ? 220 : 150) },

  { id: "feature", name: "Cover photo", about: "Spot 1 runs full width, the rest staggered below.",
    fn(W, r, o) {
      if (!r.length) return { rects: [], height: 0 };
      const G = gapFor(W);
      let h = W / Math.max(r[0], 1.6);
      if (o.viewH) h = Math.min(h, o.viewH * 0.85);
      const rest = columns(W, r.slice(1), W < 900 ? 2 : 3, 2);
      const top = h + G;
      return {
        rects: [{ x: 0, y: 0, w: W, h }, ...rest.rects.map((b) => ({ ...b, y: b.y + top }))],
        height: r.length > 1 ? top + rest.height : h,
      };
    } },

  { id: "column", name: "Single column", about: "One large photo after another, like a story.",
    fn(W, r, o) {
      const G = W < 720 ? 16 : 28;
      const maxW = Math.min(W, 1000);
      const cap = o.viewH ? Math.max(o.viewH * 0.9, 320) : maxW * 1.25;
      let y = 0;
      const rects = r.map((ratio) => {
        const w = Math.min(maxW, cap * ratio);
        const rect = { x: (W - w) / 2, y, w, h: w / ratio };
        y += rect.h + G;
        return rect;
      });
      return { rects, height: Math.max(0, y - G) };
    } },

  { id: "pairs", name: "Two columns", about: "Big photos, two side by side, uncropped.",
    fn: (W, r) => columns(W, r, W < 520 ? 1 : 2, 1.6) },

  { id: "mosaic", name: "Magazine", about: "A big photo with two small ones beside it, swapping sides.",
    fn(W, r) {
      if (W < 560) {
        return cells(W, r, 2, 0.75, 3, () => [
          { col: 0, row: 0, cols: 2, rows: 2 }, { col: 0, row: 2, cols: 1, rows: 1 }, { col: 1, row: 2, cols: 1, rows: 1 }]);
      }
      return cells(W, r, 3, 0.75, 3, (b) => (b % 2 === 0
        ? [{ col: 0, row: 0, cols: 2, rows: 2 }, { col: 2, row: 0, cols: 1, rows: 1 }, { col: 2, row: 1, cols: 1, rows: 1 }]
        : [{ col: 1, row: 0, cols: 2, rows: 2 }, { col: 0, row: 0, cols: 1, rows: 1 }, { col: 0, row: 1, cols: 1, rows: 1 }])
        .concat([{ col: 0, row: 2, cols: 1, rows: 1 }, { col: 1, row: 2, cols: 1, rows: 1 }, { col: 2, row: 2, cols: 1, rows: 1 }]));
    } },

  { id: "alternate", name: "Wide and pairs", about: "One full-width photo, then two side by side, repeating.",
    fn(W, r, o) {
      const G = gapFor(W);
      const rects = [];
      let y = 0, i = 0;
      while (i < r.length) {
        if (i % 3 === 0 || i === r.length - 1) {
          let h = W / Math.max(r[i], 1.5);
          if (o.viewH) h = Math.min(h, o.viewH * 0.85);
          rects[i] = { x: 0, y, w: W, h };
          y += h + G;
          i++;
        } else {
          const h = (W - G) / (r[i] + r[i + 1]);
          rects[i] = { x: 0, y, w: r[i] * h, h };
          rects[i + 1] = { x: r[i] * h + G, y, w: r[i + 1] * h, h };
          y += h + G;
          i += 2;
        }
      }
      return { rects, height: Math.max(0, y - G) };
    } },

  { id: "widescreen", name: "Widescreen", about: "Cinematic 16:9 crops, two to a row.",
    fn(W, r) {
      const C = W < 640 ? 1 : 2;
      const G = gapFor(W);
      const w = (W - G * (C - 1)) / C;
      const h = (w * 9) / 16;
      const rects = r.map((_, i) => ({ x: (i % C) * (w + G), y: Math.floor(i / C) * (h + G), w, h }));
      return { rects, height: r.length ? Math.ceil(r.length / C) * (h + G) - G : 0 };
    } },

  { id: "filmstrip", name: "Filmstrip", about: "One long row that scrolls sideways.", scroll: "start",
    fn(W, r, o) {
      const G = gapFor(W);
      let h = W < 640 ? W * 0.62 : Math.min(560, Math.max(320, W * 0.42));
      if (o.viewH) h = Math.min(h, Math.max(240, o.viewH * 0.7));
      let x = 0;
      const rects = r.map((ratio) => {
        const rect = { x, y: 0, w: Math.min(ratio * h, W), h };
        x += rect.w + G;
        return rect;
      });
      return { rects, height: r.length ? h : 0 };
    } },

  { id: "slideshow", name: "Slideshow", about: "One photo at a time. Swipe or use the arrows.", scroll: "center",
    fn(W, r, o) {
      const G = gapFor(W);
      let h = W < 640 ? W * 0.9 : W * 0.6;
      if (o.viewH) h = Math.min(h, Math.max(260, o.viewH * 0.78));
      return { rects: r.map((ratio, i) => inside({ x: i * (W + G), y: 0, w: W, h }, ratio)), height: r.length ? h : 0 };
    } },

  { id: "framed", name: "Gallery wall", about: "Each photo matted and framed, like prints on a wall.",
    fn(W, r) {
      const C = W >= 900 ? 3 : 2;
      const G = W < 720 ? 14 : 28;
      const u = (W - G * (C - 1)) / C;
      const pad = u * 0.09;
      const mats = [];
      const rects = r.map((ratio, i) => {
        const frame = { x: (i % C) * (u + G), y: Math.floor(i / C) * (u + G), w: u, h: u };
        mats[i] = frame;
        return inside({ x: frame.x + pad, y: frame.y + pad, w: u - pad * 2, h: u - pad * 2 }, ratio);
      });
      return { rects, mats, height: r.length ? Math.ceil(r.length / C) * (u + G) - G : 0 };
    } },

  // ----- Sized for portrait (tall) photos first. Wide photos still get wide spots, never squeezed into tall ones. -----
  { id: "portrait-grid", name: "Portrait grid", about: "Tall 4:5 tiles in tidy rows; wide photos get a double-width tile.", portrait: true,
    fn(W, r) {
      const C = W >= 1000 ? 4 : W >= 640 ? 3 : 2;
      const u = (W - gapFor(W) * (C - 1)) / C;
      // Each photo snapped to a tall 4:5, square or wide 8:5 tile, then laid in rows a tall tile high.
      return justified(W, r.map((x) => (x >= 1.2 ? 1.6 : x > 0.9 ? 1 : 0.8)), u * 1.25);
    } },

  { id: "portrait-rows", name: "Tall rows", about: "Big rows sized for tall photos; wide ones fit in too. Uncropped.", portrait: true,
    fn: (W, r) => justified(W, r, W >= 900 ? 480 : W >= 560 ? 360 : 300) },

  { id: "portrait-spotlight", name: "Spotlight", about: "One big photo to fit the screen, then three across, repeating.", portrait: true,
    fn(W, r, o) {
      const G = gapFor(W);
      const cap = o.viewH ? Math.max(o.viewH * 0.88, 360) : W * 0.75;
      const C = W < 560 ? 2 : 3;
      const rects = [];
      let y = 0, i = 0;
      while (i < r.length) {
        const h = Math.min(W / r[i], cap);
        rects[i] = { x: (W - r[i] * h) / 2, y, w: r[i] * h, h };
        y += h + G;
        i++;
        const row = perRow(W, r.slice(i, i + C), C);
        row.rects.forEach((b, j) => { rects[i + j] = { ...b, y: b.y + y }; });
        if (row.rects.length) y += row.height + G;
        i += row.rects.length;
      }
      return { rects, height: Math.max(0, y - G) };
    } },

  { id: "portrait-threes", name: "Threes", about: "Three photos to a row, same height, uncropped.", portrait: true,
    fn: (W, r) => perRow(W, r, W < 560 ? 2 : 3) },

  { id: "portrait-pairs", name: "Portrait pairs", about: "Two photos side by side, sized to fit the screen. Uncropped.", portrait: true,
    fn(W, r, o) {
      const G = W < 720 ? 12 : 20;
      const cap = o.viewH ? Math.max(o.viewH * 0.88, 360) : W * 0.75;
      const C = W < 480 ? 1 : 2;
      const rects = [];
      let y = 0;
      for (let i = 0; i < r.length; i += C) {
        const row = r.slice(i, i + C);
        const h = Math.min((W - G * (row.length - 1)) / row.reduce((s, x) => s + x, 0), cap);
        let x = (W - (row.reduce((s, ratio) => s + ratio * h, 0) + G * (row.length - 1))) / 2;
        row.forEach((ratio, j) => { rects[i + j] = { x, y, w: ratio * h, h }; x += ratio * h + G; });
        y += h + G;
      }
      return { rects, height: Math.max(0, y - G) };
    } },

  { id: "portrait-magazine", name: "Tall magazine", about: "A big tall photo beside small ones, swapping sides; wide photos get wide spots.", portrait: true,
    fn(W, r) {
      // A grid of tall 4:5 cells. A tall photo takes one cell (or the big 2x2 spot); a wide one takes two cells
      // side by side (8:5), or the whole width when it lands on the big spot.
      const G = gapFor(W);
      const C = W < 560 ? 2 : 4;
      const u = (W - G * (C - 1)) / C, ch = u * 1.25;
      const wide = (x) => x >= 1.2;
      const rects = [];
      let y = 0, i = 0, side = 0;
      // One row of two cells starting at x0: a wide photo fills both, otherwise up to two photos.
      const pairRow = (x0, yy) => {
        if (i >= r.length) return false;
        if (wide(r[i])) { rects[i++] = { x: x0, y: yy, w: 2 * u + G, h: ch }; return true; }
        rects[i++] = { x: x0, y: yy, w: u, h: ch };
        if (i < r.length) rects[i++] = { x: x0 + u + G, y: yy, w: u, h: ch };
        return true;
      };
      while (i < r.length) {
        if (wide(r[i])) {
          if (C === 4 && i + 1 < r.length && wide(r[i + 1])) {
            pairRow(0, y);
            pairRow(2 * (u + G), y);
            y += ch + G;
          } else {
            const h = C === 2 ? ch : 2 * ch + G;
            rects[i++] = { x: 0, y, w: W, h };
            y += h + G;
          }
          continue;
        }
        const big = 2 * ch + G;
        if (C === 2) {
          rects[i++] = { x: 0, y, w: W, h: big };
          y += big + G;
          if (pairRow(0, y)) y += ch + G;
        } else {
          const bx = side % 2 === 0 ? 0 : 2 * (u + G), sx = side % 2 === 0 ? 2 * (u + G) : 0;
          side++;
          rects[i++] = { x: bx, y, w: 2 * u + G, h: big };
          pairRow(sx, y);
          pairRow(sx, y + ch + G);
          y += big + G;
        }
      }
      return { rects, height: rects.reduce((m, b) => Math.max(m, b.y + b.h), 0) };
    } },
];
const byId = Object.fromEntries(LAYOUTS.map((l) => [l.id, l]));
const DEFAULT = "masonry";

// Works out the boxes without touching the page (used for the small layout pictures in Studio, and tests).
function compute(id, W, ratios, opts) {
  const L = byId[id] || byId[DEFAULT];
  return L.fn(W, ratios.map((x) => (x > 0.2 && x < 6 ? x : 1.5)), opts || {});
}

// Puts each tile (an element with data-ratio) in its spot inside grid. Call again when the width or a ratio changes.
function place(grid, tiles, id, opts) {
  const L = byId[id] || byId[DEFAULT];
  const W = grid.clientWidth;
  if (!W) return;
  const res = compute(L.id, W, tiles.map((t) => Number(t.dataset.ratio) || 1.5), opts);
  grid.classList.add("gl");
  grid.dataset.layout = L.id;
  grid.classList.toggle("gl-scroll", !!L.scroll);
  grid.style.height = `${Math.ceil(res.height) + (L.scroll ? 18 : 0)}px`;
  grid._gl = { rects: res.rects, scroll: L.scroll, W };
  // Mats (Gallery wall) are drawn behind the photos.
  const mats = res.mats || [];
  grid.querySelectorAll(":scope > .gl-mat").forEach((m, i) => { if (i >= mats.length) m.remove(); });
  let have = grid.querySelectorAll(":scope > .gl-mat");
  for (let i = have.length; i < mats.length; i++) {
    const m = document.createElement("div");
    m.className = "gl-mat";
    m.setAttribute("aria-hidden", "true");
    grid.prepend(m);
  }
  have = grid.querySelectorAll(":scope > .gl-mat");
  mats.forEach((b, i) => setBox(have[i], b));
  tiles.forEach((t, i) => {
    t.classList.add("gl-tile");
    t.style.setProperty("--gl-snap", L.scroll || "none");
    setBox(t, res.rects[i]);
  });
}
function setBox(el, b) {
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
}

// The previous / next buttons under a sideways layout (Filmstrip, Slideshow). Returns the bar to put on the page.
function arrows(grid) {
  const bar = document.createElement("div");
  bar.className = "gl-arrows";
  const step = (dir) => {
    const g = grid._gl;
    if (!g || !g.scroll) return;
    const now = grid.scrollLeft;
    const at = (b) => (g.scroll === "center" ? b.x + b.w / 2 - grid.clientWidth / 2 : b.x);
    const spots = g.rects.map(at);
    const next = dir > 0 ? spots.find((s) => s > now + 4) : [...spots].reverse().find((s) => s < now - 4);
    grid.scrollTo({ left: next === undefined ? (dir > 0 ? grid.scrollWidth : 0) : next, behavior: "smooth" });
  };
  for (const [dir, label, sign] of [[-1, "Previous photos", "‹"], [1, "Next photos", "›"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gl-arrow";
    b.setAttribute("aria-label", label);
    b.textContent = sign;
    b.addEventListener("click", () => step(dir));
    bar.append(b);
  }
  return bar;
}

// ---------- Background colours ----------
const HEX = /^#[0-9a-f]{6}$/i;
const PRESETS = [
  ["", "Site black"], ["#000000", "Black"], ["#1c1c1f", "Charcoal"], ["#2b2f36", "Slate"], ["#0f1c2e", "Midnight"],
  ["#1d2a20", "Forest"], ["#3a1519", "Burgundy"], ["#d9d3c5", "Sand"], ["#f2eee5", "Paper"], ["#ffffff", "White"],
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const ACCENT = "#2e7bff";

// The page colours that go with a background: readable text, softer lines and panels, and the blue accent only
// where it still stands out. null means the site's own colours.
function theme(bg) {
  if (!HEX.test(bg || "")) return null;
  bg = bg.toLowerCase();
  const light = contrast(bg, "#141416") > contrast(bg, "#f2f2f0");
  const text = light ? "#141416" : "#f2f2f0";
  let muted = mix(text, bg, 0.4);
  for (let t = 0.35; contrast(muted, bg) < 4.5 && t > 0; t -= 0.05) muted = mix(text, bg, t);
  const accent = contrast(ACCENT, bg) >= 3 ? ACCENT : text;
  return {
    light,
    vars: {
      "--bg": bg,
      "--bg-alt": mix(bg, text, 0.05),
      "--surface": mix(bg, text, 0.09),
      "--line": mix(bg, text, 0.18),
      "--text": text,
      "--muted": muted,
      "--accent": accent,
      "--on-accent": contrast("#ffffff", accent) >= 3 ? "#ffffff" : "#141416",
      "--gl-mat": light ? "#ffffff" : "#f4f2ed",
      "--gl-frame": light ? "rgba(0, 0, 0, 0.16)" : "rgba(0, 0, 0, 0.6)",
    },
  };
}

root.GalleryLayouts = {
  LAYOUTS: LAYOUTS.map(({ id, name, about, scroll, portrait }) => ({ id, name, about, scroll: !!scroll, portrait: !!portrait })),
  DEFAULT, PRESETS, compute, place, arrows, theme,
};
})(typeof window !== "undefined" ? window : globalThis);
