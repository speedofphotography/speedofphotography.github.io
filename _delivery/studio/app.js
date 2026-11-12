// SOP Studio page: sign-in, galleries, settings and page routing. Client records live in crm.js.
// Everything goes through the local app (studio.mjs); this page never sees the R2 keys.
import { app, info, hooks, h, show, toast, api, Locked, enc, fileUrl, size, day, isoIn, plural, copy, field, busyForm, back, go } from "./ui.js";
import * as crm from "./crm.js";

const nav = document.querySelector(".bar-actions");
let uploading = 0;

// The gallery list, reused for a minute so moving between pages doesn't re-check R2 every time.
let albumsCache = null;
async function loadAlbums(force = false) {
  if (force || !albumsCache || Date.now() - albumsCache.at > 60000) {
    albumsCache = { at: Date.now(), list: (await api("GET", "/api/albums")).albums };
  }
  return albumsCache.list;
}
const dropAlbums = () => { albumsCache = null; };

async function createGallery(body) {
  const { code } = await api("POST", "/api/albums", body);
  dropAlbums();
  return code;
}

// ---------- sign-in ----------

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
      "At least 12 characters. A few random words works well. Setting up on a new computer later? Use the same passphrase and your client records come back."),
    field("Passphrase again", h("input", { name: "confirm", type: "password", required: true, autocomplete: "new-password" })),
    h("button", { type: "submit", class: "btn btn-primary" }, "Connect"));
  show(busyForm(form, async (d) => {
    if (d.get("passphrase") !== d.get("confirm")) throw new Error("The two passphrases don't match.");
    const { restored } = await api("POST", "/api/setup", Object.fromEntries(d));
    if (restored) toast("Connected. Your client records were restored.");
    info.signedIn = true;
    go("#/");
    start();
  }));
}

function loginScreen() {
  const input = h("input", { name: "passphrase", type: "password", required: true, autocomplete: "current-password" });
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

// ---------- galleries ----------

async function albumsScreen() {
  const list = h("div", { class: "albums" }, h("p", { class: "muted" }, "Loading galleries…"));
  show(h("div", { class: "head" }, h("h1", {}, "Galleries"), h("a", { href: "#/galleries/new", class: "btn btn-primary" }, "New gallery")), list);
  const [albums] = await Promise.all([loadAlbums(true), crm.load()]);
  if (!albums.length) {
    list.replaceChildren(h("p", { class: "muted" }, "No galleries yet. Make one from a shoot, or with New gallery."));
    return;
  }
  list.replaceChildren(...albums.map((a) => {
    const shoot = crm.shootForGallery(a.code);
    const who = shoot && crm.clientById(shoot.clientId);
    return h("article", { class: "album" + (a.expired ? " is-expired" : "") },
      h("a", { href: `#/g/${a.code}`, class: "album-cover" },
        a.cover ? h("img", { src: fileUrl(a.code, a.cover, true), alt: "", loading: "lazy" }) : h("span", {}, a.count ? "No preview" : "Empty")),
      h("div", { class: "album-body" },
        h("h2", {}, h("a", { href: `#/g/${a.code}` }, a.title || a.client || a.code)),
        h("p", { class: "muted" }, who ? h("a", { href: `#/shoots/${shoot.id}` }, who.name) : a.client && a.title ? a.client : "",
          a.date ? `${who || (a.client && a.title) ? " · " : ""}${day(a.date)}` : ""),
        h("p", {}, `${plural(a.count, "file")}${a.count ? ` · ${size(a.size)}` : ""}`),
        h("p", { class: a.expired ? "warn" : "muted" }, a.expired ? `Expired ${day(a.expires)}` : a.expires ? `Open until ${day(a.expires)}` : "No end date")),
      h("button", { type: "button", class: "btn btn-line small", onclick: () => copy(a.link) }, "Copy link"));
  }));
}

// "Open for": a set length, no end date, or a chosen day. Returns the field and a function giving the end date.
function lengthField(days) {
  const sel = h("select", { "aria-label": "Open for" },
    crm.LENGTHS.map(([d, label]) => h("option", { value: String(d) }, label)), h("option", { value: "date" }, "Until a date I pick…"));
  sel.value = String(days);
  if (sel.value !== String(days)) sel.value = "60";
  const date = h("input", { type: "date", value: crm.endFor(days || 60), min: isoIn(0), "aria-label": "Open until", hidden: true });
  sel.addEventListener("change", () => { date.hidden = sel.value !== "date"; });
  return {
    el: field("Open for", [sel, date], "After the last day the link says the gallery has expired."),
    end: () => (sel.value === "date" ? date.value : crm.endFor(Number(sel.value))),
  };
}

async function newGalleryScreen() {
  await crm.load();
  const length = lengthField(crm.galleryDays());
  const form = h("form", { class: "panel narrow", autocomplete: "off" },
    h("h1", {}, "New gallery"),
    h("p", { class: "muted" }, "Tip: making it from a shoot (Shoots > the shoot > Create gallery) fills this in and keeps it linked to the client."),
    field("Client name", h("input", { name: "client", maxlength: "120" })),
    field("Car", h("input", { name: "car", maxlength: "120" }), "Goes into the link, the default title and each download's file name."),
    field("Title", h("input", { name: "title", maxlength: "120" }), "Leave blank for \"Client's Car\"."),
    field("Shoot date", h("input", { name: "date", type: "date", value: isoIn(0) })),
    length.el,
    field("Note to the client", h("textarea", { name: "message", rows: "3", maxlength: "2000" },
      "Thanks for a great shoot! Let me know if you'd like any extra edits.")),
    h("button", { type: "submit", class: "btn btn-primary" }, "Create gallery"));
  show(back("#/galleries", "Galleries"), busyForm(form, async (d) => {
    const body = Object.fromEntries(d);
    body.expires = length.end();
    if (!body.title) body.title = body.client && body.car ? `${body.client}'s ${body.car}` : body.client ? `${body.client}'s photos` : body.car || "Your photos";
    go(`#/g/${await createGallery(body)}`);
  }));
}

async function albumScreen(code) {
  show(h("p", { class: "muted" }, "Loading…"));
  const [a] = await Promise.all([api("GET", `/api/albums/${enc(code)}`), crm.load()]);
  const shoot = crm.shootForGallery(code);
  const client = shoot && crm.clientById(shoot.clientId);
  // Galleries made before downloads were named by car: take the car from the linked shoot.
  if (!a.car && shoot?.car) {
    const { code: _c, link: _l, expired: _e, files: _f, ...meta } = a;
    api("PUT", `/api/albums/${enc(code)}/meta`, { ...meta, car: shoot.car }).then(() => { a.car = shoot.car; }).catch(() => {});
  }
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
    const done = [];
    for (const name of list) {
      try { await api("DELETE", `/api/albums/${enc(code)}/files/${enc(name)}`); done.push(name); }
      catch (e) { if (!(e instanceof Locked)) toast(e.message, true); break; }
    }
    a.files = a.files.filter((f) => !done.includes(f.name));
    dropAlbums();
    render();
    if (done.length) toast(`Deleted ${plural(done.length, "file")}.`);
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
      ? `Uploading ${Math.min(finished + failed + 1, total)} of ${total}… keep this page open.`
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
      dropAlbums();
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
        if (x.status === 401) { info.signedIn = false; hooks.locked(); reject(new Locked("Locked")); }
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
      a.files = (await api("GET", `/api/albums/${enc(code)}`)).files;
      render();
    } catch (e) { if (!(e instanceof Locked)) toast(e.message, true); }
  }

  // ----- details -----
  const heading = h("h1", {}, a.title || a.client || code);
  const details = busyForm(h("form", { class: "panel details", autocomplete: "off" },
    h("h2", {}, "Details"),
    field("Title", h("input", { name: "title", value: a.title || "", maxlength: "120" })),
    field("Client name", h("input", { name: "client", value: a.client || "", maxlength: "120" }), "Their first name starts each download's file name."),
    field("Car", h("input", { name: "car", value: a.car || shoot?.car || "", maxlength: "120" }), "Goes in each download's file name, e.g. Maya_Porsche-911-GT3-RS_07.jpg."),
    h("div", { class: "pair" },
      field("Shoot date", h("input", { name: "date", type: "date", value: a.date || "" })),
      field("Open until", h("input", { name: "expires", type: "date", value: a.expires || "" }), "Blank means no end date.")),
    h("div", { class: "row extend" }, h("span", { class: "muted" }, "Change how long it lasts:"),
      [[30, "+30 days"], [90, "+90 days"], [365, "+1 year"]].map(([n, label]) => h("button", { type: "button", class: "btn btn-line small", onclick: () => {
        // Counted from the current end date, or from today if it has already passed.
        const cur = details.elements.expires.value;
        const from = cur && cur >= isoIn(0) ? new Date(`${cur}T12:00`) : new Date();
        from.setDate(from.getDate() + n);
        details.elements.expires.value = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
        details.requestSubmit();
      } }, label)),
      h("button", { type: "button", class: "btn btn-line small", onclick: () => { details.elements.expires.value = ""; details.requestSubmit(); } }, "No end date")),
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
    a.expired = !!a.expires && a.expires < isoIn(0);
    dropAlbums();
    heading.textContent = a.title || a.client || code;
    showUntil();
    toast(a.expires ? `Saved. Open until ${day(a.expires)}.` : "Saved. No end date.");
  });

  const until = h("p", {});
  function showUntil() {
    until.className = a.expired ? "warn" : "muted";
    until.textContent = a.expired ? `Expired ${day(a.expires)}. Clients see "this gallery has expired".`
      : a.expires ? `Open until ${day(a.expires)}.` : "Open with no end date.";
  }
  showUntil();

  show(
    back("#/galleries", "Galleries"),
    h("div", { class: "head" }, heading),
    until,
    shoot ? h("p", { class: "muted" }, "For ", h("a", { href: `#/shoots/${shoot.id}` }, `${client?.name || "client"}${shoot.car ? `'s ${shoot.car}` : ""}`),
      ` · ${shoot.status === "delivered" ? "delivered" : "not marked delivered yet"}`) : null,
    h("div", { class: "link-row" },
      h("code", {}, a.link),
      h("button", { type: "button", class: "btn btn-primary small", onclick: () => copy(a.link) }, "Copy link"),
      client?.email ? h("a", { class: "btn btn-line small", href: crm.emailHref(client, shoot, a.link, a.expires) }, "Email link") : null,
      h("a", { href: a.link, target: "_blank", rel: "noopener", class: "btn btn-line small" }, "Open")),
    drop, fileInput, progress,
    h("div", { class: "head files-head" }, h("h2", {}, "Files"), countLine, delBtn),
    grid,
    details,
    h("section", { class: "panel danger" },
      h("h2", {}, "Delete gallery"),
      h("p", { class: "muted" }, "Removes every file and the link stops working. This can't be undone."),
      h("button", { type: "button", class: "btn btn-line", onclick: async (e) => {
        if (prompt(`To delete "${a.title || code}" and all its files, type DELETE.`) !== "DELETE") return;
        e.target.disabled = true;
        try {
          const { deleted } = await api("DELETE", `/api/albums/${enc(code)}`);
          dropAlbums();
          await crm.unlinkGallery(code);
          toast(`Gallery deleted (${plural(deleted, "file")}).`);
          go("#/galleries");
        } catch (ex) { e.target.disabled = false; if (!(ex instanceof Locked)) toast(ex.message, true); }
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

// ---------- settings ----------

async function settingsScreen() {
  await crm.load();
  const b = crm.backupState();
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
  const records = h("section", { class: "panel narrow" }, h("h2", {}, "Client records"),
    h("p", { class: "muted" }, "Kept encrypted on this computer, with a daily copy for the last 30 days, and an encrypted backup in your R2 bucket. Only your passphrase unlocks them."),
    h("p", {}, b.error ? h("span", { class: "warn" }, `Last R2 backup failed: ${b.error}. It retries on the next change.`)
      : b.at && b.at !== "earlier" ? `Backed up to R2 ${new Date(b.at).toLocaleString()}.` : b.at ? "Backed up to R2." : "Not backed up to R2 yet."));
  const lengthSel = h("select", { "aria-label": "Default gallery length", onchange: async () => {
    try { await crm.setGalleryDays(Number(lengthSel.value)); toast("Saved. New galleries use this from now on."); }
    catch (e) { if (!(e instanceof Locked)) toast(e.message, true); }
  } }, crm.LENGTHS.map(([d, label]) => h("option", { value: String(d) }, label)));
  lengthSel.value = String(crm.galleryDays());
  const galleries = h("section", { class: "panel narrow" }, h("h2", {}, "Galleries"),
    field("New galleries stay open for", lengthSel, "You can still pick a different length for each gallery, and extend or shorten it later on its page."));
  show(back("#/", "Today"), h("h1", {}, "Settings"), galleries, records, pass, keys);
}

// ---------- routing ----------

function markNav(hash) {
  const section = hash.startsWith("/clients") ? "clients" : hash.startsWith("/shoots") ? "shoots"
    : hash.startsWith("/g") ? "galleries" : hash.startsWith("/settings") ? "settings" : "today";
  for (const a of nav.querySelectorAll("a[data-nav]")) a.toggleAttribute("aria-current", a.dataset.nav === section);
}

async function start() {
  try { Object.assign(info, await (await fetch("/api/state", { headers: { "x-studio": "1" } })).json()); }
  catch { show(h("p", { class: "panel narrow" }, "The app isn't running. Start it again from the SOP Studio icon.")); return; }
  nav.hidden = !info.signedIn;
  if (!info.signedIn) { crm.forget(); dropAlbums(); }
  if (!info.setup) return setupScreen();
  if (!info.signedIn) return loginScreen();
  await checkBookings(false);
  route();
}

// Collects new requests from the website's booking form into the records: on sign-in and every 5 minutes.
let checking = false;
async function checkBookings(rerender = true) {
  if (checking || !info.signedIn) return;
  checking = true;
  try {
    const added = await crm.importBookings();
    if (added) {
      toast(`${added === 1 ? "A new booking request" : `${added} new booking requests`} came in from the website.`);
      const path = location.hash.slice(1).split("?")[0] || "/";
      if (rerender && (path === "/" || path === "/shoots" || path === "/clients")) route();
    }
  } catch (e) {
    if (!(e instanceof Locked)) console.warn("Couldn't check for bookings:", e.message);
  } finally { checking = false; }
}
setInterval(checkBookings, 5 * 60 * 1000);

async function route() {
  if (!info.signedIn) return;
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const q = new URLSearchParams(qs || "");
  markNav(path);
  const deps = { createGallery, loadAlbums };
  let m;
  try {
    if (path === "/") await crm.todayScreen(loadAlbums);
    else if (path === "/clients") await crm.clientsScreen();
    else if (path === "/clients/new") await crm.clientForm(null, q.get("then"));
    else if ((m = /^\/clients\/([\w-]+)\/edit$/.exec(path))) await crm.clientForm(m[1]);
    else if ((m = /^\/clients\/([\w-]+)$/.exec(path))) await crm.clientScreen(m[1]);
    else if (path === "/shoots") await crm.shootsScreen(q.get("status") || "active");
    else if (path === "/shoots/new") await crm.shootForm(null, q.get("client"));
    else if ((m = /^\/shoots\/([\w-]+)\/edit$/.exec(path))) await crm.shootForm(m[1]);
    else if ((m = /^\/shoots\/([\w-]+)$/.exec(path))) await crm.shootScreen(m[1], deps);
    else if (path === "/galleries") await albumsScreen();
    else if (path === "/galleries/new") await newGalleryScreen();
    else if ((m = /^\/g\/([^/]+)$/.exec(path))) await albumScreen(decodeURIComponent(m[1]));
    else if (path === "/settings") await settingsScreen();
    else go("#/");
  } catch (e) {
    if (!(e instanceof Locked)) show(h("p", { class: "panel narrow form-error" }, e.message), back("#/", "Today"));
  }
}

hooks.locked = start;
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => { if (uploading) e.preventDefault(); });
document.querySelector("[data-lock]").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", headers: { "x-studio": "1" } }).catch(() => {});
  info.signedIn = false;
  go("#/");
  start();
});
start();
