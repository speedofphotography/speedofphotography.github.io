// SOP Studio: the "Layout and colour" panel on a gallery's page. Pick one of the layouts, a background colour,
// and drag photos into the spots you want. The preview is drawn by the website's own gallery-layouts.js, so it
// matches what the client sees. Changes save by themselves.
import { h, api, toast, Locked, enc, fileUrl } from "./ui.js";

const GL = window.GalleryLayouts;
const SAMPLE = [1.5, 0.67, 1.5, 1.5, 1.78, 0.75, 1.5, 1.33, 1.5];
// Mostly tall photos with some wide ones, the kind of set the portrait-first layouts are for.
const TALL_SAMPLE = [0.67, 0.8, 1.5, 0.67, 0.67, 0.75, 1.5, 0.67, 0.8, 0.67, 1.5, 0.67];
const PHONE = 358; // a phone screen's width, less the page's side margins
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Names in the arranged order: placed ones first, then the rest by name (the same rule as the website).
function arranged(names, order) {
  const sorted = [...names].sort(byName);
  if (!order || !order.length) return sorted;
  const spot = new Map(order.map((n, i) => [n, i]));
  return [...sorted.filter((n) => spot.has(n)).sort((a, b) => spot.get(a) - spot.get(b)), ...sorted.filter((n) => !spot.has(n))];
}

// A small picture of a layout: the layout itself on a computer-sized page with sample photos, shrunk down.
const MINI = 150 / 1000;
function miniature(L) {
  const box = h("div", { class: "mini", "aria-hidden": "true" });
  const res = GL.compute(L.id, 1000, L.portrait ? TALL_SAMPLE : SAMPLE, { viewH: 640 });
  for (const b of res.mats || []) box.append(cell(b, "mini-mat"));
  res.rects.forEach((b, i) => box.append(cell(b, i === 0 ? "mini-photo first" : "mini-photo")));
  return box;
}
function cell(b, cls) {
  const d = h("span", { class: cls });
  d.style.left = `${b.x * MINI}px`;
  d.style.top = `${b.y * MINI}px`;
  d.style.width = `${b.w * MINI}px`;
  d.style.height = `${b.h * MINI}px`;
  return d;
}

export function lookPanel(code, album) {
  const state = {
    layout: album.layout || GL.DEFAULT,
    bg: album.bg || "",
    arrangedByHand: !!(album.order && album.order.length),
    order: arranged(album.files.map((f) => f.name), album.order),
  };
  let files = new Map(album.files.map((f) => [f.name, f]));
  let width = "computer";

  // ----- saving -----
  const status = h("span", { class: "muted small look-status", "aria-live": "polite" });
  let timer = 0, saving = Promise.resolve();
  function save() {
    status.textContent = "Not saved yet…";
    clearTimeout(timer);
    timer = setTimeout(() => {
      const body = { layout: state.layout, bg: state.bg, order: state.arrangedByHand ? state.order : [] };
      status.textContent = "Saving…";
      saving = saving.then(() => api("PUT", `/api/albums/${enc(code)}/look`, body)).then(() => {
        album.layout = body.layout;
        album.bg = body.bg;
        album.order = body.order;
        status.textContent = "Saved. The client's page shows this now.";
      }, (e) => {
        status.textContent = "Not saved.";
        if (!(e instanceof Locked)) toast(e.message, true);
      });
    }, 600);
  }

  // ----- layouts -----
  const picks = h("div", { class: "layout-picks", role: "group", "aria-label": "Layouts" });
  const pickButtons = GL.LAYOUTS.map((L) => {
    const b = h("button", { type: "button", class: "layout-pick", "aria-pressed": String(L.id === state.layout), onclick: () => {
      state.layout = L.id;
      pickButtons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
      save();
    } }, miniature(L), h("strong", {}, L.name), h("small", {}, L.about));
    picks.append(b);
    return b;
  });

  // ----- background colour -----
  const custom = h("input", { type: "color", "aria-label": "Any colour", value: state.bg || "#0b0b0c" });
  const hexLine = h("span", { class: "muted small" });
  const swatches = GL.PRESETS.map(([hex, label]) => {
    const b = h("button", { type: "button", class: "swatch", title: label, "aria-label": label, onclick: () => setBg(hex) },
      h("span", { class: "swatch-chip" }), h("small", {}, label));
    b.firstChild.style.background = hex || "#0b0b0c";
    b.dataset.hex = hex;
    return b;
  });
  custom.addEventListener("input", () => setBg(custom.value.toLowerCase()));
  function setBg(hex) {
    state.bg = hex === "#0b0b0c" ? "" : hex; // the site's own black is the same as no colour
    if (state.bg) custom.value = state.bg;
    draw();
    save();
  }
  function markBg() {
    let preset = false;
    for (const s of swatches) {
      const on = s.dataset.hex === state.bg;
      preset = preset || on;
      s.setAttribute("aria-pressed", String(on));
    }
    custom.parentElement?.classList.toggle("is-on", !preset);
    hexLine.textContent = state.bg ? `Background ${state.bg}` : "The site's own colours";
  }

  // ----- arranging -----
  const grid = h("div", { class: "look-grid" });
  const stage = h("div", { class: "look-stage" }, grid);
  const arrowsBar = GL.arrows(grid);
  stage.append(arrowsBar);
  const tiles = new Map();
  let dragging = null;

  function tileFor(name) {
    if (tiles.has(name)) return tiles.get(name);
    const f = files.get(name);
    const t = h("div", { class: "look-tile", draggable: "true", tabindex: "0", role: "button",
      "aria-label": `${name}. Drag to a new spot, or use the arrow keys.`, title: name });
    t.dataset.ratio = "1.5";
    t.dataset.name = name;
    t.dataset.modified = String(f ? f.modified : "");
    const num = h("span", { class: "look-num" });
    t.append(num);
    if (f && f.thumb) {
      const src = fileUrl(code, name, true) + `&t=${Date.parse(f.modified) || 0}`;
      const img = new Image();
      img.onload = () => {
        t.dataset.ratio = String(img.naturalWidth / img.naturalHeight || 1.5);
        t.style.backgroundImage = `url("${src}")`;
        queue();
      };
      img.src = src;
    } else {
      t.append(h("span", { class: "look-ext" }, f && f.kind === "video" ? "Video" : (name.split(".").pop() || "file").toUpperCase()));
    }
    t.addEventListener("dragstart", (e) => {
      dragging = name;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", name);
      // Faded only after the browser has taken its picture of the photo to drag, and only if still dragging.
      requestAnimationFrame(() => { if (dragging === name) t.classList.add("is-dragging"); });
    });
    t.addEventListener("dragend", () => {
      dragging = null;
      t.classList.remove("is-dragging");
      grid.querySelectorAll(".is-target").forEach((x) => x.classList.remove("is-target"));
    });
    t.addEventListener("dragover", (e) => {
      if (!dragging || dragging === name) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      t.classList.add("is-target");
    });
    t.addEventListener("dragleave", () => t.classList.remove("is-target"));
    t.addEventListener("drop", (e) => {
      if (!dragging) return;
      e.preventDefault();
      t.classList.remove("is-target");
      move(dragging, state.order.indexOf(name));
    });
    t.addEventListener("keydown", (e) => {
      const i = state.order.indexOf(name);
      const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: state.order.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      if (to >= 0 && to < state.order.length && to !== i) { move(name, to); t.focus(); }
    });
    tiles.set(name, t);
    return t;
  }

  // The dragged photo takes the spot it was dropped on; the others shuffle along to make room.
  function move(name, to) {
    const from = state.order.indexOf(name);
    if (from < 0 || to < 0 || from === to) return;
    state.order.splice(from, 1);
    state.order.splice(to, 0, name);
    state.arrangedByHand = true;
    draw();
    save();
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; place(); });
  }
  function place() {
    const list = state.order.map(tileFor);
    list.forEach((t, i) => { t.firstChild.textContent = String(i + 1); });
    // Tiles stay where they are in the page, so a move slides them to their new spots.
    for (const t of list) if (t.parentNode !== grid) grid.append(t);
    GL.place(grid, list, state.layout, { viewH: width === "phone" ? 700 : 760 });
    arrowsBar.hidden = !GL.LAYOUTS.find((l) => l.id === state.layout)?.scroll;
  }
  function draw() {
    const t = GL.theme(state.bg);
    for (const k of ["--bg", "--bg-alt", "--surface", "--line", "--text", "--muted", "--accent", "--on-accent", "--gl-mat", "--gl-frame"]) {
      stage.style.removeProperty(k);
    }
    if (t) for (const [k, v] of Object.entries(t.vars)) stage.style.setProperty(k, v);
    stage.style.background = t ? t.vars["--bg"] : "#0b0b0c";
    grid.style.width = width === "phone" ? `${PHONE}px` : "";
    stage.classList.toggle("is-phone", width === "phone");
    markBg();
    place();
  }
  window.addEventListener("resize", queue);

  const sizeButtons = [["computer", "Computer"], ["phone", "Phone"]].map(([v, label]) =>
    h("button", { type: "button", class: "btn btn-line small", "aria-pressed": String(v === width), onclick: (e) => {
      width = v;
      sizeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      draw();
    } }, label));
  const resetBtn = h("button", { type: "button", class: "btn btn-line small", onclick: () => {
    state.order = [...state.order].sort(byName);
    state.arrangedByHand = false;
    draw();
    save();
  } }, "Back to name order");

  const el = h("section", { class: "panel look" },
    h("div", { class: "head" }, h("h2", {}, "Layout and colour"), status),
    h("p", { class: "muted" }, "How the client's gallery page looks. Changes save by themselves."),
    h("h3", {}, "Layouts"),
    picks,
    h("h3", {}, "Background"),
    h("div", { class: "swatches" }, ...swatches, h("label", { class: "swatch custom" }, custom, h("small", {}, "Any colour"))),
    hexLine,
    h("div", { class: "head look-arrange-head" }, h("h3", {}, "Arrange the photos"),
      h("div", { class: "row" }, ...sizeButtons, resetBtn)),
    h("p", { class: "muted small" }, "Drag a photo onto a spot to put it there; the others move along. Or click a photo and use the arrow keys. Numbers show the order clients scroll through. New uploads go at the end."),
    stage);

  draw();
  return {
    el,
    // After uploads or deletes: keep the arrangement, add new files at the end, drop deleted ones.
    update(list) {
      files = new Map(list.map((f) => [f.name, f]));
      const names = list.map((f) => f.name);
      const keep = state.order.filter((n) => files.has(n));
      const added = names.filter((n) => !keep.includes(n)).sort(byName);
      state.order = state.arrangedByHand ? [...keep, ...added] : arranged(names, null);
      for (const [n, t] of tiles) if (!files.has(n)) { t.remove(); tiles.delete(n); }
      // A replaced file (same name) gets a fresh preview.
      for (const f of list) {
        const t = tiles.get(f.name);
        if (t && t.dataset.modified && t.dataset.modified !== String(f.modified)) { t.remove(); tiles.delete(f.name); }
      }
      draw();
    },
  };
}
