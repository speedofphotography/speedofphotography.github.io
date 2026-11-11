// SOP Studio page. Everything goes through the local app (studio.mjs); this page never sees the R2 keys.
const app = document.getElementById("app");
const nav = document.querySelector(".bar-actions");
const toastEl = document.getElementById("toast");
let info = { setup: false, signedIn: false, site: "" };
let uploading = 0;

// ---------- helpers ----------

// Builds elements without innerHTML, so names and messages always show as plain text.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

function show(...kids) {
  app.replaceChildren(...kids);
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.className = "on" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ""), 4000);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "x-studio": "1", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !["/api/login", "/api/setup", "/api/passphrase"].includes(path)) {
    info.signedIn = false;
    start();
    throw new Error("Locked");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const enc = encodeURIComponent;
const fileUrl = (code, name, thumb) => `/api/albums/${enc(code)}/files/${enc(name)}${thumb ? "?thumb=1" : ""}`;

function size(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function copy(textValue) {
  try { await navigator.clipboard.writeText(textValue); toast("Link copied."); }
  catch { prompt("Copy the link:", textValue); }
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
}

// Runs a form's async action with the button busy and errors shown under the form.
function busyForm(form, action) {
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  form.append(err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    err.hidden = true;
    try { await action(new FormData(form)); }
    catch (ex) { if (ex.message !== "Locked") { err.textContent = ex.message; err.hidden = false; } }
    finally { btn.disabled = false; }
  });
  return form;
}

// ---------- screens ----------

function setupScreen() {
  const form = h("form", { class: "panel narrow", autocomplete: "off" },
    h("h1", {}, "Set up"),
    h("p", { class: "lead" }, "Connect the app to your R2 bucket once. Your keys are saved on this computer only, locked with a passphrase you choose."),
    h("ol", { class: "steps" },
      h("li", {}, "In the Cloudflare dashboard, open R2 and copy your Account ID."),
      h("li", {}, "Choose Manage API tokens, then Create API token. Pick \"Object Read & Write\", limit it to the sop-deliveries bucket, and create it."),
      h("li", {}, "Copy the Access Key ID and Secret Access Key it shows (the secret is shown only once).")),
    field("Account ID", h("input", { name: "accountId", required: true, spellcheck: "false" })),
    field("Access Key ID", h("input", { name: "accessKeyId", required: true, spellcheck: "false" })),
    field("Secret Access Key", h("input", { name: "secretAccessKey", type: "password", required: true })),
    field("Bucket", h("input", { name: "bucket", value: "sop-deliveries", required: true, spellcheck: "false" })),
    field("New passphrase", h("input", { name: "passphrase", type: "password", required: true, minlength: "12", autocomplete: "new-password" }),
      "At least 12 characters. A few random words works well. If you forget it, you'll set up again with a new token."),
    field("Passphrase again", h("input", { name: "confirm", type: "password", required: true, autocomplete: "new-password" })),
    h("button", { type: "submit", class: "btn btn-primary" }, "Connect"));
  show(busyForm(form, async (d) => {
    if (d.get("passphrase") !== d.get("confirm")) throw new Error("The two passphrases don't match.");
    await api("POST", "/api/setup", Object.fromEntries(d));
    info.signedIn = true;
    location.hash = "#/";
    start();
  }));
}

function loginScreen() {
  const input = h("input", { name: "passphrase", type: "password", required: true, autocomplete: "current-password", autofocus: true });
  const form = h("form", { class: "panel narrow" },
    h("h1", {}, "Unlock"),
    field("Passphrase", input),
    h("button", { type: "submit", class: "btn btn-primary" }, "Unlock"));
  show(busyForm(form, async (d) => {
    try { await api("POST", "/api/login", { passphrase: d.get("passphrase") }); }
    finally { input.value = ""; input.focus(); }
    info.signedIn = true;
    start();
  }));
  input.focus();
}

async function albumsScreen() {
  const list = h("div", { class: "albums" }, h("p", { class: "muted" }, "Loading galleries…"));
  show(h("div", { class: "head" }, h("h1", {}, "Galleries"), h("a", { href: "#/new", class: "btn btn-primary" }, "New gallery")), list);
  const { albums } = await api("GET", "/api/albums");
  if (!albums.length) {
    list.replaceChildren(h("p", { class: "muted" }, "No galleries yet. Make one with New gallery."));
    return;
  }
  list.replaceChildren(...albums.map((a) => h("article", { class: "album" + (a.expired ? " is-expired" : "") },
    h("a", { href: `#/g/${a.code}`, class: "album-cover" },
      a.cover ? h("img", { src: fileUrl(a.code, a.cover, true), alt: "", loading: "lazy" }) : h("span", {}, a.count ? "No preview" : "Empty")),
    h("div", { class: "album-body" },
      h("h2", {}, h("a", { href: `#/g/${a.code}` }, a.title || a.client || a.code)),
      h("p", { class: "muted" }, [a.client && a.title ? a.client : "", day(a.date)].filter(Boolean).join(" · ")),
      h("p", {}, `${plural(a.count, "file")}${a.count ? ` · ${size(a.size)}` : ""}`),
      h("p", { class: a.expired ? "warn" : "muted" }, a.expired ? `Expired ${day(a.expires)}` : a.expires ? `Open until ${day(a.expires)}` : "No end date")),
    h("button", { type: "button", class: "btn btn-line small", onclick: () => copy(a.link) }, "Copy link"))));
}

function newScreen() {
  const form = h("form", { class: "panel narrow", autocomplete: "off" },
    h("p", {}, h("a", { href: "#/", class: "back" }, "← Galleries")),
    h("h1", {}, "New gallery"),
    field("Client name", h("input", { name: "client", required: true, maxlength: "120" })),
    field("Car", h("input", { name: "car", maxlength: "120" }), "Optional. Goes into the link and the default title."),
    field("Title", h("input", { name: "title", maxlength: "120" }), "Leave blank for \"Client's Car\"."),
    field("Shoot date", h("input", { name: "date", type: "date", value: isoIn(0) })),
    field("Open until", h("input", { name: "expires", type: "date", value: isoIn(60) }), "After this day the link says the gallery has expired."),
    field("Note to the client", h("textarea", { name: "message", rows: "3", maxlength: "2000" },
      "Thanks for a great shoot! Let me know if you'd like any extra edits.")),
    h("button", { type: "submit", class: "btn btn-primary" }, "Create gallery"));
  show(busyForm(form, async (d) => {
    const body = Object.fromEntries(d);
    if (!body.title) body.title = body.car ? `${body.client}'s ${body.car}` : `${body.client}'s photos`;
    const { code } = await api("POST", "/api/albums", body);
    location.hash = `#/g/${code}`;
  }));
}

async function albumScreen(code) {
  show(h("p", { class: "muted" }, "Loading…"));
  const a = await api("GET", `/api/albums/${enc(code)}`);
  const names = new Set(a.files.map((f) => f.name));
  const selected = new Set();

  const grid = h("div", { class: "grid" });
  const delBtn = h("button", { type: "button", class: "btn btn-line small", disabled: true, onclick: deleteSelected }, "Delete selected");
  const countLine = h("p", { class: "muted" });
  const progress = h("div", { class: "uploads", hidden: true });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, onchange: () => { queue([...fileInput.files]); fileInput.value = ""; } });
  const drop = h("div", { class: "drop", tabindex: "0", role: "button",
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); },
    ondragleave: () => drop.classList.remove("over"),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); queue([...e.dataTransfer.files]); } },
  h("strong", {}, "Drop photos here"), h("span", {}, "or click to choose files. A file with the same name replaces the old one."));

  function tile(f) {
    const box = h("input", { type: "checkbox", "aria-label": `Select ${f.name}`, onchange: () => {
      box.checked ? selected.add(f.name) : selected.delete(f.name);
      delBtn.disabled = !selected.size;
      delBtn.textContent = selected.size ? `Delete ${selected.size} selected` : "Delete selected";
    } });
    const ext = (f.name.split(".").pop() || "").toUpperCase();
    return h("figure", { class: "tile", "data-name": f.name },
      h("a", { href: fileUrl(code, f.name), target: "_blank", rel: "noopener", class: "tile-img" },
        f.thumb ? h("img", { src: fileUrl(code, f.name, true) + `&t=${Date.parse(f.modified) || 0}`, alt: "", loading: "lazy" })
          : h("span", {}, f.kind === "video" ? "Video" : ext)),
      h("figcaption", {}, h("label", {}, box, h("span", {}, f.name)), h("small", {}, size(f.size))));
  }
  function render() {
    grid.replaceChildren(...a.files.map(tile));
    countLine.textContent = a.files.length ? `${plural(a.files.length, "file")} · ${size(a.files.reduce((s, f) => s + f.size, 0))}` : "No files yet.";
    selected.clear();
    delBtn.disabled = true;
    delBtn.textContent = "Delete selected";
  }

  async function deleteSelected() {
    const list = [...selected];
    if (!confirm(`Delete ${plural(list.length, "file")} from this gallery? This can't be undone.`)) return;
    delBtn.disabled = true;
    let done = 0;
    for (const name of list) {
      try { await api("DELETE", `/api/albums/${enc(code)}/files/${enc(name)}`); done++; }
      catch (e) { toast(e.message, true); break; }
    }
    a.files = a.files.filter((f) => !list.slice(0, done).includes(f.name));
    list.slice(0, done).forEach((n) => names.delete(n));
    render();
    if (done) toast(`Deleted ${plural(done, "file")}.`);
  }

  // ----- uploads -----
  const pending = [];
  let active = 0, total = 0, finished = 0, failed = 0;
  const summaryLine = h("p", { class: "uploads-summary" });
  progress.append(summaryLine);

  function queue(files) {
    const skipped = files.filter((f) => f.name.startsWith(".") || f.name === "gallery.json" || f.size === 0);
    for (const f of files) {
      if (skipped.includes(f)) continue;
      const bar = h("progress", { max: "100", value: "0" });
      const row = h("div", { class: "upload" }, h("span", {}, f.name), bar);
      progress.append(row);
      pending.push({ file: f, row, bar });
      total++;
    }
    if (skipped.length) toast(`Skipped ${plural(skipped.length, "file")} (hidden, empty or gallery.json).`, true);
    progress.hidden = !total;
    pump();
  }
  function pump() {
    summaryLine.textContent = active || pending.length
      ? `Uploading ${finished + failed + 1 > total ? total : finished + failed + 1} of ${total}… keep this page open.`
      : `Uploaded ${plural(finished, "file")}${failed ? `, ${failed} failed` : ""}.`;
    while (active < 2 && pending.length) {
      const job = pending.shift();
      active++;
      uploading++;
      sendFile(job).then(() => { finished++; job.row.remove(); }, (e) => {
        failed++;
        job.row.classList.add("failed");
        job.row.append(h("small", {}, e.message));
      }).finally(() => { active--; uploading--; pump(); });
    }
    if (!active && !pending.length && total) {
      total = finished = failed = 0;
      refresh();
    }
  }
  function put(url, body, type, onprogress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("x-studio", "1");
      if (type) x.setRequestHeader("content-type", type);
      if (onprogress) x.upload.onprogress = (e) => e.lengthComputable && onprogress(e.loaded / e.total);
      x.onload = () => {
        let msg = "";
        try { msg = JSON.parse(x.responseText).error || ""; } catch { /* not JSON */ }
        if (x.status === 401) { info.signedIn = false; start(); reject(new Error("Locked")); }
        else if (x.status >= 200 && x.status < 300) resolve();
        else reject(new Error(msg || `Upload failed (${x.status}).`));
      };
      x.onerror = () => reject(new Error("The app stopped answering. Is its window still open?"));
      x.send(body);
    });
  }
  async function sendFile({ file, bar }) {
    const base = `/api/albums/${enc(code)}`;
    await put(`${base}/files/${enc(file.name)}`, file, file.type || "application/octet-stream", (p) => (bar.value = Math.round(p * 95)));
    const thumb = await makeThumb(file);
    if (thumb) await put(`${base}/thumbs/${enc(file.name)}`, thumb, "image/jpeg").catch(() => {});
    bar.value = 100;
  }
  async function refresh() {
    try {
      const fresh = await api("GET", `/api/albums/${enc(code)}`);
      a.files = fresh.files;
      a.files.forEach((f) => names.add(f.name));
      render();
    } catch (e) { if (e.message !== "Locked") toast(e.message, true); }
  }

  // ----- details -----
  const details = busyForm(h("form", { class: "panel details", autocomplete: "off" },
    h("h2", {}, "Details"),
    field("Title", h("input", { name: "title", value: a.title || "", maxlength: "120" })),
    field("Client name", h("input", { name: "client", value: a.client || "", maxlength: "120" })),
    h("div", { class: "pair" },
      field("Shoot date", h("input", { name: "date", type: "date", value: a.date || "" })),
      field("Open until", h("input", { name: "expires", type: "date", value: a.expires || "" }), "Blank means no end date.")),
    field("Note to the client", h("textarea", { name: "message", rows: "3", maxlength: "2000" }, a.message || "")),
    h("div", { class: "row" },
      h("button", { type: "submit", class: "btn btn-primary" }, "Save details"),
      h("button", { type: "button", class: "btn btn-line", onclick: () => {
        if (!confirm("Close this gallery now? The link will say it has expired. You can open it again by changing the date.")) return;
        details.elements.expires.value = isoIn(-1);
        details.requestSubmit();
      } }, "Close gallery now"))),
  async (d) => {
    const body = Object.fromEntries(d);
    await api("PUT", `/api/albums/${enc(code)}/meta`, body);
    Object.assign(a, body);
    heading.textContent = a.title || a.client || code;
    toast("Details saved.");
  });

  const heading = h("h1", {}, a.title || a.client || code);
  show(
    h("p", {}, h("a", { href: "#/", class: "back" }, "← Galleries")),
    h("div", { class: "head" }, heading, a.expired ? h("span", { class: "badge" }, "Expired") : null),
    h("div", { class: "link-row" },
      h("code", {}, a.link),
      h("button", { type: "button", class: "btn btn-primary small", onclick: () => copy(a.link) }, "Copy link"),
      h("a", { href: a.link, target: "_blank", rel: "noopener", class: "btn btn-line small" }, "Open")),
    drop, fileInput, progress,
    h("div", { class: "head files-head" }, h("h2", {}, "Files"), countLine, delBtn),
    grid,
    details,
    h("section", { class: "panel danger" },
      h("h2", {}, "Delete gallery"),
      h("p", { class: "muted" }, "Removes every file and the link stops working. This can't be undone."),
      h("button", { type: "button", class: "btn btn-line", onclick: async (e) => {
        const typed = prompt(`To delete "${a.title || code}" and all its files, type DELETE.`);
        if (typed !== "DELETE") return;
        e.target.disabled = true;
        try {
          const { deleted } = await api("DELETE", `/api/albums/${enc(code)}`);
          toast(`Gallery deleted (${plural(deleted, "file")}).`);
          location.hash = "#/";
        } catch (ex) { e.target.disabled = false; if (ex.message !== "Locked") toast(ex.message, true); }
      } }, "Delete this gallery")));
  render();
}

// A small JPEG preview for this app's grid (the client page makes its own). Skipped for files the browser can't draw.
async function makeThumb(file) {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  } catch { return null; }
}

function settingsScreen() {
  const pass = busyForm(h("form", { class: "panel narrow", autocomplete: "off" },
    h("h2", {}, "Change passphrase"),
    field("Current passphrase", h("input", { name: "current", type: "password", required: true, autocomplete: "current-password" })),
    field("New passphrase", h("input", { name: "next", type: "password", required: true, minlength: "12", autocomplete: "new-password" })),
    field("New passphrase again", h("input", { name: "confirm", type: "password", required: true, autocomplete: "new-password" })),
    h("button", { type: "submit", class: "btn btn-primary" }, "Change passphrase")),
  async (d) => {
    if (d.get("next") !== d.get("confirm")) throw new Error("The two new passphrases don't match.");
    await api("POST", "/api/passphrase", { current: d.get("current"), next: d.get("next") });
    pass.reset();
    toast("Passphrase changed.");
  });
  const keys = busyForm(h("form", { class: "panel narrow", autocomplete: "off" },
    h("h2", {}, "Replace R2 keys"),
    h("p", { class: "muted" }, "If a token was deleted or you think it leaked, delete it in Cloudflare, make a new one and paste it here."),
    field("Account ID", h("input", { name: "accountId", required: true, spellcheck: "false" })),
    field("Access Key ID", h("input", { name: "accessKeyId", required: true, spellcheck: "false" })),
    field("Secret Access Key", h("input", { name: "secretAccessKey", type: "password", required: true })),
    field("Bucket", h("input", { name: "bucket", value: info.bucket || "sop-deliveries", required: true, spellcheck: "false" })),
    field("Your passphrase", h("input", { name: "passphrase", type: "password", required: true, autocomplete: "current-password" })),
    h("button", { type: "submit", class: "btn btn-primary" }, "Save new keys")),
  async (d) => {
    await api("POST", "/api/setup", Object.fromEntries(d));
    keys.reset();
    toast("New keys saved.");
  });
  show(h("p", {}, h("a", { href: "#/", class: "back" }, "← Galleries")), h("h1", {}, "Settings"), pass, keys);
}

// ---------- routing ----------

async function start() {
  try { info = await (await fetch("/api/state", { headers: { "x-studio": "1" } })).json(); }
  catch { show(h("p", { class: "panel narrow" }, "The app isn't running. Start it again with Studio.cmd.")); return; }
  nav.hidden = !info.signedIn;
  if (!info.setup) return setupScreen();
  if (!info.signedIn) return loginScreen();
  route();
}

async function route() {
  if (!info.signedIn) return;
  const hash = location.hash.slice(1) || "/";
  try {
    const g = /^\/g\/([^/]+)$/.exec(hash);
    if (g) await albumScreen(decodeURIComponent(g[1]));
    else if (hash === "/new") newScreen();
    else if (hash === "/settings") settingsScreen();
    else await albumsScreen();
  } catch (e) {
    if (e.message !== "Locked") show(h("p", { class: "panel narrow form-error" }, e.message), h("p", {}, h("a", { href: "#/", class: "back" }, "← Galleries")));
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => { if (uploading) e.preventDefault(); });
document.querySelector("[data-lock]").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", headers: { "x-studio": "1" } }).catch(() => {});
  info.signedIn = false;
  location.hash = "#/";
  start();
});
start();
