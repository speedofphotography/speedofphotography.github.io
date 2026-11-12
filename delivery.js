// ---------- Client photo delivery (the page at /g/<code>/) ----------
// How galleries are organised, delivered and previewed: _delivery/README.md
// Previews and the large view are resized by Cloudflare Image Transformations (5,000 new sizes a month free;
// each photo uses 2). Downloads are always the untouched originals.

(() => {
const root = document.getElementById("delivery");
if (!root) return;
const $ = (name) => document.querySelector(`[data-d="${name}"]`);
const els = {
  title: $("title"), meta: $("meta"), message: $("message"), open: $("open"), actions: $("actions"),
  zip: $("zip"), zipStatus: $("zip-status"), state: $("state"), grid: $("grid"), help: $("help"), lb: $("lightbox"),
};

const code = (location.pathname.match(/^\/g\/([^/]+)/) || [])[1] || "";
const enc = encodeURIComponent;
// Each file's save name ("Maya_Porsche-911-GT3-RS_07.jpg") comes from the gallery list; older lists fall back to the file's own name.
const saveName = (f) => f.download || f.name;
const fileUrl = (f, dl) => `/api/gallery/${enc(code)}/file/${enc(f.name)}${dl ? `?dl=${enc(saveName(f))}` : ""}`;
// Cloudflare resizes previews on the live site; the local preview (_delivery/preview) shows originals.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const sized = (f, width) => LOCAL ? fileUrl(f)
  : `/cdn-cgi/image/width=${width},quality=85,fit=scale-down,format=auto,onerror=redirect${fileUrl(f)}`;
const THUMB = 900;
const LARGE = 2400;

const fmtBytes = (n) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const fmtDate = (s) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const baseName = (name) => name.replace(/\.[^.]+$/, "");

function setState(message) {
  els.state.textContent = message;
  els.state.hidden = !message;
}

// ---------- No code in the address: "open your gallery" form ----------
if (!code) {
  document.title = `Client gallery | ${document.title.split("|").pop().trim()}`;
  setState("");
  els.title.textContent = "Open your gallery";
  els.open.hidden = false;
  els.open.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = els.open.code.value.trim();
    const typed = (raw.match(/\/g\/([^/?#\s]+)/) || [])[1] || raw.replace(/^\/+|\/+$/g, "");
    if (typed) location.href = `/g/${enc(decodeURIComponent(typed))}/`;
  });
  return;
}

// ---------- Load the gallery ----------
let files = [];
fetch(`/api/gallery/${enc(code)}`, { cache: "no-store" })
  .then(async (res) => {
    if (res.status === 404) throw new Error("We couldn't find that gallery. Check the link, or email me and I'll resend it.");
    if (res.status === 410) throw new Error("This gallery has expired. Email me if you need the photos again.");
    if (!res.ok) throw new Error("The gallery couldn't load right now. Please try again in a minute.");
    return res.json();
  })
  .then(render)
  .catch((err) => {
    els.title.textContent = "Gallery unavailable";
    setState(err.message);
    els.help.hidden = false;
  });

function render(g) {
  files = g.files || [];
  if (g.title) {
    els.title.textContent = g.title;
    document.title = `${g.title} | ${document.title.split("|").pop().trim()}`;
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  const photos = files.filter((f) => f.kind === "image").length;
  const others = files.length - photos;
  const meta = [];
  if (g.client) meta.push(g.client);
  if (g.date) meta.push(fmtDate(g.date));
  if (files.length) meta.push([photos && plural(photos, "photo"), others && plural(others, "file")].filter(Boolean).join(" + "));
  els.meta.textContent = meta.join(" · ");
  if (g.message) { els.message.textContent = g.message; els.message.hidden = false; }
  if (g.expires) {
    const note = document.createElement("span");
    note.className = "delivery-expires";
    note.textContent = `Available to download until ${fmtDate(g.expires)}.`;
    els.meta.append(document.createElement("br"), note);
  }
  els.help.hidden = false;
  if (!files.length) { setState("Your photos are being prepared. Check back soon."); return; }
  setState("");
  els.actions.hidden = false;
  els.zip.textContent = `Download all (${fmtBytes(total)})`;
  buildGrid();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/g/sw.js", { scope: "/g/" }).catch(() => {});
}

// ---------- Grid: each photo at its own proportions, dropped into the shortest column ----------
const tiles = [];
function buildGrid() {
  files.forEach((f, i) => {
    const tile = document.createElement("figure");
    tile.className = `shot delivery-tile is-${f.kind}`;
    tile.dataset.ratio = 3 / 2;
    tile.tabIndex = 0;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", `${f.kind === "file" ? "Download" : "View"} ${f.name}`);
    if (f.kind === "image") {
      const src = sized(f, THUMB);
      tile.style.setProperty("--img", `url("${src}")`);
      const img = new Image();
      img.onload = () => { tile.dataset.ratio = img.naturalWidth / img.naturalHeight || 1.5; tile.classList.add("is-loaded"); queueLayout(); };
      img.src = src;
    } else if (f.kind === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = `${fileUrl(f)}#t=0.5`;
      v.onloadedmetadata = () => { tile.dataset.ratio = v.videoWidth / v.videoHeight || 16 / 9; queueLayout(); };
      tile.append(v);
    } else {
      const label = document.createElement("span");
      label.className = "delivery-file-ext";
      label.textContent = (f.name.split(".").pop() || "file").slice(0, 5);
      tile.append(label);
    }
    const cap = document.createElement("figcaption");
    cap.textContent = baseName(f.name);
    const dl = document.createElement("a");
    dl.className = "delivery-tile-dl";
    dl.href = fileUrl(f, true);
    dl.setAttribute("download", saveName(f));
    dl.setAttribute("aria-label", `Download ${f.name}`);
    dl.title = `Download (${fmtBytes(f.size)})`;
    dl.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    dl.addEventListener("click", (e) => e.stopPropagation());
    tile.append(cap, dl);
    const open = () => (f.kind === "file" ? dl.click() : openLightbox(i));
    tile.addEventListener("click", open);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    tiles.push(tile);
    els.grid.append(tile);
  });
  layout();
  window.addEventListener("resize", queueLayout);
}

let layoutQueued = false;
function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layout(); });
}
function layout() {
  const grid = els.grid;
  if (!tiles.length || !grid.clientWidth) return;
  const ROW = 2; // px per grid row (style.css)
  const cs = getComputedStyle(grid);
  const cols = cs.gridTemplateColumns.split(" ").length;
  const gap = parseFloat(getComputedStyle(tiles[0]).marginBottom) || 0;
  const colW = (grid.clientWidth - (parseFloat(cs.columnGap) || 0) * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  tiles.forEach((tile) => {
    const h = Math.min(colW / tile.dataset.ratio, colW * 2);
    const span = Math.ceil((h + gap) / ROW);
    const c = heights.indexOf(Math.min(...heights));
    tile.style.height = `${h}px`;
    tile.style.gridColumn = String(c + 1);
    tile.style.gridRow = `${heights[c] + 1} / span ${span}`;
    heights[c] += span;
  });
}

// ---------- Lightbox ----------
const lb = els.lb;
const lbImg = lb.querySelector(".lightbox-img");
const lbVideo = lb.querySelector(".delivery-lb-video");
const lbCount = lb.querySelector(".delivery-lb-count");
const lbDl = lb.querySelector(".delivery-lb-dl");
const lbSave = lb.querySelector(".delivery-lb-save");
let viewable = [];
let pos = 0;
let lastFocus = null;

// Phones can save a photo straight to the camera roll through the share sheet.
const canShareFiles = (() => {
  try {
    return matchMedia("(pointer: coarse)").matches && !!navigator.canShare &&
      navigator.canShare({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });
  } catch (e) { return false; }
})();

function openLightbox(index) {
  viewable = files.map((f, i) => i).filter((i) => files[i].kind !== "file");
  lastFocus = document.activeElement;
  lb.hidden = false;
  document.body.style.overflow = "hidden";
  show(viewable.indexOf(index));
  lb.querySelector(".lightbox-close").focus();
}
function closeLightbox() {
  lb.hidden = true;
  lbVideo.pause();
  lbVideo.removeAttribute("src");
  document.body.style.overflow = "";
  if (lastFocus) lastFocus.focus();
}
function show(p) {
  pos = (p + viewable.length) % viewable.length;
  const f = files[viewable[pos]];
  lbCount.textContent = `${pos + 1} / ${viewable.length}`;
  lbDl.href = fileUrl(f, true);
  lbDl.setAttribute("download", saveName(f));
  lbDl.textContent = `Download (${fmtBytes(f.size)})`;
  resetSave(f);
  if (f.kind === "video") {
    lbImg.hidden = true;
    lbVideo.hidden = false;
    lbVideo.src = fileUrl(f);
  } else {
    lbVideo.pause();
    lbVideo.hidden = true;
    lbImg.hidden = false;
    // the already-loaded preview shows at once; the sharper version fades in over it
    lbImg.style.backgroundImage = `url("${sized(f, LARGE)}"), url("${sized(f, THUMB)}")`;
    lbImg.setAttribute("aria-label", f.name);
    [1, -1].forEach((d) => {
      const n = files[viewable[(pos + d + viewable.length) % viewable.length]];
      if (n && n.kind === "image") new Image().src = sized(n, LARGE);
    });
  }
}

let saveFile = null;
function resetSave(f) {
  saveFile = null;
  lbSave.hidden = !(canShareFiles && f.kind === "image");
  lbSave.textContent = "Save to Photos";
  lbSave.dataset.name = f.name;
}
lbSave.addEventListener("click", async (e) => {
  e.preventDefault();
  const f = files[viewable[pos]];
  if (saveFile && saveFile.name === f.name) {
    // second tap: the photo is ready, open the share sheet ("Save Image")
    try { await navigator.share({ files: [saveFile] }); } catch (err) { /* closed the sheet */ }
    return;
  }
  lbSave.textContent = "Getting photo…";
  try {
    const res = await fetch(fileUrl(f));
    const blob = await res.blob();
    if (lbSave.dataset.name !== f.name) return; // moved on to another photo meanwhile
    saveFile = new File([blob], saveName(f), { type: blob.type || "image/jpeg" });
    lbSave.textContent = "Tap to save";
  } catch (err) {
    lbSave.textContent = "Save to Photos";
    lbDl.click();
  }
});

lb.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lb.querySelector(".lightbox-prev").addEventListener("click", () => show(pos - 1));
lb.querySelector(".lightbox-next").addEventListener("click", () => show(pos + 1));
lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (lb.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") show(pos - 1);
  if (e.key === "ArrowRight") show(pos + 1);
});
let touchX = null;
lb.addEventListener("touchstart", (e) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
lb.addEventListener("touchend", (e) => {
  if (touchX === null || e.target === lbVideo) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) show(pos + (dx < 0 ? 1 : -1));
  touchX = null;
});

// ---------- Download all (zip built by /g/sw.js) ----------
let zipping = false;
els.zip.addEventListener("click", async () => {
  if (zipping) return;
  const status = (msg) => { els.zipStatus.textContent = msg; };
  if (!("serviceWorker" in navigator) || !window.ReadableStream) {
    status("This browser can't download everything at once. Use the download button on each photo instead.");
    return;
  }
  zipping = true;
  els.zip.disabled = true;
  status("Starting download…");
  let ping;
  try {
    const reg = await navigator.serviceWorker.register("/g/sw.js", { scope: "/g/" });
    await navigator.serviceWorker.ready;
    const sw = reg.active;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const zipName = (els.title.textContent || code).replace(/[\\/:*?"<>|]+/g, "").trim() || code;
    await new Promise((resolve, reject) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      setTimeout(() => reject(new Error("timeout")), 5000);
      sw.postMessage({
        type: "zip", id,
        files: files.map((f) => ({ name: saveName(f), size: f.size, url: fileUrl(f), mtime: Date.parse(f.uploaded) })),
      }, [ch.port2]);
    });
    const onMsg = (e) => {
      const m = e.data || {};
      if (m.id !== id) return;
      if (m.type === "progress") status(`Downloading… ${Math.floor((m.sent / m.total) * 100)}% (photo ${m.file} of ${m.files})`);
      if (m.type === "done" || m.type === "error" || m.type === "cancelled") {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        clearInterval(ping);
        zipping = false;
        els.zip.disabled = false;
        status(m.type === "done" ? "Download complete. Check your downloads folder."
          : m.type === "cancelled" ? "Download cancelled."
          : "Something went wrong part way. Please try again, or download photos one at a time.");
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    ping = setInterval(() => sw.postMessage({ type: "ping" }), 10000);
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = `/g/__zip/${id}/${enc(zipName)}.zip`;
    document.body.append(frame);
    setTimeout(() => frame.remove(), 60 * 60 * 1000);
    status("Download started. Your browser is saving the zip…");
  } catch (err) {
    clearInterval(ping);
    zipping = false;
    els.zip.disabled = false;
    status("Couldn't start the download. Please refresh the page and try again.");
  }
});
})();
