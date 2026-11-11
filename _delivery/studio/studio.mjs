// SOP Studio: create and manage client galleries.
//
// It runs only on this computer, at http://127.0.0.1:4417, and talks straight to the R2 bucket. There is no
// admin page on the website at all, so there is nothing online for anyone else to log in to. The R2 keys are
// saved locked with your passphrase (see vault.mjs); without it, this app can't do anything.
//
//   Double-click Studio.cmd in the _delivery folder, or:  node _delivery/studio/studio.mjs
//
// Close the window to lock it. It also locks itself after 30 minutes without use.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as vault from "./vault.mjs";
import { createR2, R2Error } from "./r2.mjs";
import * as crm from "./crm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
// Installed (install-studio.ps1), the app carries its own copy of the site's gallery rules and logo;
// run from the website folder, it uses the originals.
const installed = fs.existsSync(path.join(here, "lib", "delivery.js"));
const { CODE_RE, META_FILE, typeOf, kindOf, isClientFile, readMeta, isExpired } =
  await import(installed ? "./lib/delivery.js" : "../../_functions_lib/delivery.js");
const SITE = "https://speedofphotography.com";
const IDLE_MS = 30 * 60 * 1000;
const MAX_FILE = 4.9 * 1024 ** 3; // R2's limit for a single upload is 5 GB
const MAX_THUMB = 2 * 1024 * 1024;
const THUMBS = ".thumbs"; // small previews for this app only; the client page never lists sub-folders
const ARGS = new Set(process.argv.slice(2));

const state = { r2: null, crm: null, inboxKey: "", bucket: "", session: "", seen: 0, fails: 0, lockUntil: 0, checking: false };

function lock() {
  const { r2, crm: store } = state;
  state.r2 = null;
  state.crm = null;
  state.session = "";
  // Finish any client-records backup that's waiting, then let go of the connection.
  if (r2) (store ? store.flush() : Promise.resolve()).catch(() => {}).finally(() => r2.close());
}
setInterval(() => { if (state.session && Date.now() - state.seen > IDLE_MS) lock(); }, 30000).unref();

function connect(secrets) {
  lock();
  state.r2 = createR2({ ...secrets, endpoint: process.env.SOP_STUDIO_ENDPOINT });
  state.crm = crm.createStore(state.r2, Buffer.from(secrets.dataKey, "base64"));
  state.inboxKey = secrets.inboxKey;
  state.bucket = secrets.bucket;
  publishInboxKey(state.r2, secrets.inboxKey);
}

const newDataKey = () => crypto.randomBytes(32).toString("base64");

// The key pair for website bookings: the website encrypts each booking with the public half
// (functions/api/booking.js); only this app, unlocked, has the private half to read them.
const INBOX_PUBLIC = "_studio/inbox-public.json";
const newInboxKey = () => crypto.generateKeyPairSync("rsa", { modulusLength: 3072 })
  .privateKey.export({ type: "pkcs8", format: "pem" });

// Makes sure the saved keys include both; returns true if it had to add one.
function fillKeys(secrets, from = {}) {
  let added = false;
  if (!secrets.dataKey) { secrets.dataKey = from.dataKey || newDataKey(); added = !from.dataKey; }
  if (!secrets.inboxKey) { secrets.inboxKey = from.inboxKey || newInboxKey(); added = added || !from.inboxKey; }
  return added;
}

// Keeps R2's passphrase-locked copy of the keys current (see crm.mjs), so another PC with the same passphrase
// can read the records and waiting bookings. Runs in the background.
function shareKey(r2, pass, secrets) {
  vault.seal(pass, { dataKey: secrets.dataKey, inboxKey: secrets.inboxKey })
    .then((sealed) => r2.put(crm.REMOTE_KEY, sealed, "application/json"))
    .catch((e) => console.error("Couldn't back up the records key:", e.message));
}

// Puts the public half of the bookings key where the website can find it (only if it changed).
function publishInboxKey(r2, privatePem) {
  const jwk = { ...crypto.createPublicKey(privatePem).export({ format: "jwk" }), alg: "RSA-OAEP-256", key_ops: ["encrypt"], ext: true };
  const body = JSON.stringify(jwk);
  r2.getText(INBOX_PUBLIC).then((t) => (t === body ? null : r2.put(INBOX_PUBLIC, body, "application/json")))
    .catch((e) => console.error("Couldn't publish the bookings key:", e.message));
}

// Opens one stored booking: the RSA private key unlocks its AES key, which unlocks the booking.
function openBooking(privatePem, stored) {
  try {
    const o = JSON.parse(stored);
    const aes = crypto.privateDecrypt({ key: privatePem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(o.key, "base64"));
    const all = Buffer.from(o.data, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", aes, Buffer.from(o.iv, "base64"));
    d.setAuthTag(all.subarray(all.length - 16));
    return JSON.parse(Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

// ---------- HTTP basics ----------

const SECURITY = {
  "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; " +
    "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
};

function send(res, status, body, headers = {}) {
  const buf = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY, "content-type": "application/json; charset=utf-8", ...headers,
    "content-length": Buffer.byteLength(buf) });
  res.end(buf);
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Too big"), { status: 413 })); req.destroy(); }
      else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}
async function readJson(req, limit = 64 * 1024) {
  const body = await readBody(req, limit);
  try { return JSON.parse(body.toString("utf8")) || {}; }
  catch { throw Object.assign(new Error("Bad request"), { status: 400 }); }
}

const STATIC = {
  "/": ["app.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/ui.js": ["ui.js", "text/javascript; charset=utf-8"],
  "/crm.js": ["crm.js", "text/javascript; charset=utf-8"],
  "/logo.png": [installed ? path.join(here, "logo.png") : path.join(repo, "images", "logo-small.png"), "image/png"],
};

function cookieToken(req) {
  const m = /(?:^|;\s*)sop_studio=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "");
  return m ? m[1] : "";
}
function signedIn(req) {
  const t = cookieToken(req);
  if (!state.session || !state.r2 || !t) return false;
  if (!crypto.timingSafeEqual(Buffer.from(t), Buffer.from(state.session))) return false;
  state.seen = Date.now();
  return true;
}
function startSession(res, data) {
  state.session = crypto.randomBytes(32).toString("base64url");
  state.seen = Date.now();
  state.fails = 0;
  send(res, 200, data, { "set-cookie": `sop_studio=${state.session}; Path=/; HttpOnly; SameSite=Strict` });
}

// ---------- Galleries ----------

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const linkFor = (code) => `${SITE}/g/${code}/`;

// The app's copy of a name check: the client page rules (isClientFile) plus nothing Windows or a URL would choke on.
const okName = (name) => typeof name === "string" && name.length <= 180 && isClientFile(name) &&
  !/[\\\u0000-\u001f\u007f]/.test(name) && name.trim() === name;

// Same shape as new-gallery.ps1 makes: readable start, then 8 random letters/numbers (about 850 billion
// possibilities), from a secure generator. The link is the key, so it must not be guessable.
function makeCode(client, car) {
  const slug = `${client} ${car}`.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += abc[crypto.randomInt(abc.length)];
  return slug ? `${slug}-${suffix}` : suffix;
}

function cleanMeta(body) {
  const meta = {};
  const title = text(body.title, 120), client = text(body.client, 120), message = text(body.message, 2000);
  const date = text(body.date, 10), expires = text(body.expires, 10);
  if (title) meta.title = title;
  if (client) meta.client = client;
  if (DATE_RE.test(date)) meta.date = date;
  if (message) meta.message = message;
  if (DATE_RE.test(expires)) meta.expires = expires;
  return meta;
}

// readMeta() from the site's own code, so this app reads gallery.json exactly the way the client page does.
const metaOf = (code) => readMeta({
  get: async (key) => { const t = await state.r2.getText(key); return t == null ? null : { text: async () => t }; },
}, code);

async function filesOf(code) {
  const { objects } = await state.r2.listAll(`${code}/`);
  const thumbs = new Set();
  const files = [];
  for (const o of objects) {
    const name = o.key.slice(code.length + 1);
    if (name.startsWith(`${THUMBS}/`)) thumbs.add(name.slice(THUMBS.length + 1).replace(/\.jpg$/, ""));
    else if (isClientFile(name) && o.size > 0) files.push({ name, size: o.size, modified: o.modified, kind: kindOf(name) });
  }
  for (const f of files) f.thumb = thumbs.has(f.name);
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { files, keys: objects.map((o) => o.key) };
}

async function eachLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

async function summary(code) {
  const [{ files }, meta] = await Promise.all([filesOf(code), metaOf(code)]);
  const { found, ...details } = meta;
  return {
    code, link: linkFor(code), ...details, expired: isExpired(meta),
    count: files.length, size: files.reduce((s, f) => s + f.size, 0),
    updated: files.reduce((m, f) => (f.modified > m ? f.modified : m), ""),
    cover: (files.find((f) => f.thumb) || {}).name || "",
  };
}

// ---------- Routes ----------

const api = {
  async state(req, res) {
    send(res, 200, { setup: vault.exists(), signedIn: signedIn(req), bucket: state.r2 ? state.bucket : "", site: SITE });
  },

  // First run: save the keys under a new passphrase. Later (signed in): replace the keys, confirmed with the passphrase.
  async setup(req, res) {
    const replacing = vault.exists();
    if (replacing && !signedIn(req)) return fail(res, 401, "Sign in first.");
    const b = await readJson(req);
    const secrets = {
      accountId: text(b.accountId, 64), accessKeyId: text(b.accessKeyId, 200),
      secretAccessKey: text(b.secretAccessKey, 200), bucket: text(b.bucket, 63) || "sop-deliveries",
    };
    const pass = typeof b.passphrase === "string" ? b.passphrase : "";
    if (!/^[0-9a-f]{32}$/i.test(secrets.accountId)) return fail(res, 400, "The account ID is the 32-character code from the R2 page.");
    if (!/^\S{16,200}$/.test(secrets.accessKeyId) || !/^\S{16,200}$/.test(secrets.secretAccessKey)) {
      return fail(res, 400, "Paste both the Access Key ID and the Secret Access Key from the token page.");
    }
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(secrets.bucket)) return fail(res, 400, "That isn't a valid bucket name.");
    let old = null;
    if (replacing) {
      old = await vault.open(pass);
      if (!old) return fail(res, 401, "That passphrase isn't right.");
    } else if (pass.length < 12) return fail(res, 400, "Use a passphrase of at least 12 characters.");

    const test = createR2({ ...secrets, endpoint: process.env.SOP_STUDIO_ENDPOINT });
    let restored = false;
    try {
      await test.list({ max: 1 });
      if (old) fillKeys(secrets, old);
      else {
        // Client records already in R2 from an earlier setup? Same passphrase unlocks them again.
        const sealed = await test.getText(crm.REMOTE_KEY);
        const found = sealed ? await vault.unseal(pass, sealed) : null;
        if (found?.dataKey) { fillKeys(secrets, found); restored = true; }
        else {
          fillKeys(secrets);
          if (sealed) await setAside(test); // locked with a different passphrase: keep it, out of the way
        }
        moveLocalRecordsAside(restored);
      }
    } catch (e) { return fail(res, 400, storageMessage(e, secrets.bucket)); }
    finally { test.close(); }

    await vault.save(pass, secrets);
    connect(secrets);
    shareKey(state.r2, pass, secrets);
    startSession(res, { ok: true, restored });
  },

  async login(req, res) {
    if (!vault.exists()) return fail(res, 409, "Set up first.");
    const wait = state.lockUntil - Date.now();
    if (wait > 0) return fail(res, 429, `Too many wrong tries. Try again in ${Math.ceil(wait / 60000)} minute${wait > 60000 ? "s" : ""}.`);
    if (state.checking) return fail(res, 429, "Still checking the last try.");
    const { passphrase } = await readJson(req);
    state.checking = true;
    let secrets;
    try { secrets = typeof passphrase === "string" && passphrase ? await vault.open(passphrase) : null; }
    finally { state.checking = false; }
    if (!secrets) {
      state.fails++;
      // 5 wrong tries locks sign-in for 5 minutes, then 10, 20 … (up to a day).
      if (state.fails % 5 === 0) state.lockUntil = Date.now() + Math.min(5 * 60000 * 2 ** (state.fails / 5 - 1), 864e5);
      await new Promise((r) => setTimeout(r, 1000));
      return fail(res, 401, "That passphrase isn't right.");
    }
    const added = fillKeys(secrets);
    if (added) await vault.save(passphrase, secrets);
    connect(secrets);
    const r2 = state.r2;
    if (added) shareKey(r2, passphrase, secrets);
    else r2.getText(crm.REMOTE_KEY).then((t) => { if (!t) shareKey(r2, passphrase, secrets); }).catch(() => {});
    startSession(res, { ok: true });
  },

  async logout(req, res) {
    if (signedIn(req)) lock();
    send(res, 200, { ok: true }, { "set-cookie": "sop_studio=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
  },

  async passphrase(req, res) {
    const { current, next } = await readJson(req);
    if (typeof next !== "string" || next.length < 12) return fail(res, 400, "Use a passphrase of at least 12 characters.");
    const secrets = typeof current === "string" ? await vault.open(current) : null;
    if (!secrets) return fail(res, 401, "The current passphrase isn't right.");
    await vault.save(next, secrets);
    shareKey(state.r2, next, secrets);
    send(res, 200, { ok: true });
  },

  // New website bookings waiting in the bucket, opened. Studio adds them to the records, then calls inboxDone.
  async inbox(req, res) {
    const { objects } = await state.r2.list({ prefix: "_inbox/", max: 100 });
    const bookings = [];
    let unreadable = 0;
    await eachLimit(objects.filter((o) => /^_inbox\/[\w-]+\.json$/.test(o.key)), 6, async (o) => {
      const raw = await state.r2.getText(o.key);
      const b = raw && openBooking(state.inboxKey, raw);
      if (b) bookings.push({ key: o.key, booking: b });
      else unreadable++;
    });
    bookings.sort((a, b) => a.key.localeCompare(b.key));
    send(res, 200, { bookings, unreadable });
  },

  async inboxDone(req, res) {
    const { keys } = await readJson(req);
    const list = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === "string" && /^_inbox\/[\w-]+\.json$/.test(k));
    await eachLimit(list, 6, (k) => state.r2.del(k));
    send(res, 200, { deleted: list.length });
  },

  async getCrm(req, res) {
    const doc = await state.crm.load();
    send(res, 200, { doc, backup: state.crm.backup });
  },

  async saveCrm(req, res) {
    const { doc } = await readJson(req, 20 * 1024 * 1024);
    const saved = await state.crm.save(doc || {});
    if (!saved) return send(res, 409, { error: "These records were changed in another window. Showing the latest now.", doc: await state.crm.load() });
    send(res, 200, { rev: saved.rev, backup: state.crm.backup });
  },

  async listAlbums(req, res) {
    const { prefixes } = await state.r2.listAll("", "/");
    const codes = prefixes.map((p) => p.slice(0, -1)).filter((c) => CODE_RE.test(c));
    const albums = await eachLimit(codes, 6, summary);
    albums.sort((a, b) => (b.date || b.updated || "").localeCompare(a.date || a.updated || ""));
    send(res, 200, { albums });
  },

  async createAlbum(req, res) {
    const b = await readJson(req);
    const meta = cleanMeta(b);
    if (!meta.client && !meta.title) return fail(res, 400, "Give it a client name or a title.");
    let code;
    for (let i = 0; i < 5 && !code; i++) {
      const c = makeCode(text(b.client, 120), text(b.car, 120));
      if (!(await state.r2.list({ prefix: `${c}/`, max: 1 })).objects.length) code = c;
    }
    if (!code) return fail(res, 500, "Couldn't make a new link. Try again.");
    await state.r2.put(`${code}/${META_FILE}`, JSON.stringify(meta, null, 2) + "\n", "application/json");
    send(res, 200, { code, link: linkFor(code) });
  },

  async getAlbum(req, res, code) {
    const [{ files }, meta] = await Promise.all([filesOf(code), metaOf(code)]);
    if (!files.length && !meta.found) return fail(res, 404, "There's no gallery with that link.");
    const { found, ...details } = meta;
    send(res, 200, { code, link: linkFor(code), ...details, expired: isExpired(meta), files });
  },

  async saveMeta(req, res, code) {
    const meta = cleanMeta(await readJson(req));
    await state.r2.put(`${code}/${META_FILE}`, JSON.stringify(meta, null, 2) + "\n", "application/json");
    send(res, 200, { ok: true });
  },

  async deleteAlbum(req, res, code) {
    const { keys } = await filesOf(code);
    await eachLimit(keys, 8, (k) => state.r2.del(k));
    send(res, 200, { deleted: keys.length });
  },

  async upload(req, res, code, name) {
    const length = Number(req.headers["content-length"]);
    if (!Number.isFinite(length) || length <= 0) return fail(res, 411, "Empty file.");
    if (length > MAX_FILE) return fail(res, 413, "Files over 5 GB can't be uploaded in one go.");
    await state.r2.putStream(`${code}/${name}`, req, length, typeOf(name));
    send(res, 200, { ok: true });
  },

  async uploadThumb(req, res, code, name) {
    const body = await readBody(req, MAX_THUMB);
    if (body.length < 3 || body[0] !== 0xff || body[1] !== 0xd8) return fail(res, 400, "Previews must be JPEG.");
    await state.r2.put(`${code}/${THUMBS}/${name}.jpg`, body, "image/jpeg");
    send(res, 200, { ok: true });
  },

  async download(req, res, code, name, thumb) {
    const key = thumb ? `${code}/${THUMBS}/${name}.jpg` : `${code}/${name}`;
    const headers = req.headers.range ? { range: req.headers.range } : {};
    const up = await state.r2.get(key, headers);
    const out = { ...SECURITY, "content-type": thumb ? "image/jpeg" : up.headers["content-type"] || typeOf(name),
      "cache-control": thumb ? "private, max-age=3600" : "no-store", "accept-ranges": "bytes" };
    for (const h of ["content-length", "content-range", "etag", "last-modified"]) if (up.headers[h]) out[h] = up.headers[h];
    res.writeHead(up.statusCode, out);
    up.pipe(res);
    res.on("close", () => up.destroy());
  },

  async deleteFile(req, res, code, name) {
    await Promise.all([state.r2.del(`${code}/${name}`), state.r2.del(`${code}/${THUMBS}/${name}.jpg`)]);
    send(res, 200, { ok: true });
  },
};

// Copies R2's old client-records backup (locked with a passphrase nobody has any more) to _studio/old-<time>/.
async function setAside(r2) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const key of [crm.REMOTE, crm.REMOTE_KEY]) {
    const buf = await r2.getBuffer(key);
    if (buf) await r2.put(key.replace("_studio/", `_studio/old-${stamp}/`), buf, "application/octet-stream");
  }
}

// A fresh setup can't read records locked by an earlier key: keep that file in backups\ rather than overwrite it.
function moveLocalRecordsAside(restored) {
  const file = path.join(vault.DIR, "crm.enc");
  if (restored || !fs.existsSync(file)) return;
  fs.mkdirSync(path.join(vault.DIR, "backups"), { recursive: true });
  fs.renameSync(file, path.join(vault.DIR, "backups", `crm-old-${Date.now()}.enc`));
}

function storageMessage(e, bucket) {
  if (e.code === "NoSuchBucket") return `There's no bucket named "${bucket}" on that account.`;
  if (e.status === 401 || e.status === 403 || e.code === "InvalidAccessKeyId" || e.code === "SignatureDoesNotMatch") {
    return "Cloudflare refused those keys. Check they were copied in full and the token can read and write this bucket.";
  }
  if (e.status) return `Cloudflare storage answered with an error (${e.code || e.status}). Try again in a minute.`;
  return "Couldn't reach Cloudflare. Check the internet connection.";
}

async function route(req, res, url) {
  const { pathname } = url;
  const m = req.method;
  if (pathname === "/api/state" && m === "GET") return api.state(req, res);
  if (pathname === "/api/setup" && m === "POST") return api.setup(req, res);
  if (pathname === "/api/login" && m === "POST") return api.login(req, res);
  if (pathname === "/api/logout" && m === "POST") return api.logout(req, res);

  if (!signedIn(req)) return fail(res, 401, "Signed out.");
  if (pathname === "/api/passphrase" && m === "POST") return api.passphrase(req, res);
  if (pathname === "/api/inbox" && m === "GET") return api.inbox(req, res);
  if (pathname === "/api/inbox/done" && m === "POST") return api.inboxDone(req, res);
  if (pathname === "/api/crm" && m === "GET") return api.getCrm(req, res);
  if (pathname === "/api/crm" && m === "PUT") return api.saveCrm(req, res);
  if (pathname === "/api/albums" && m === "GET") return api.listAlbums(req, res);
  if (pathname === "/api/albums" && m === "POST") return api.createAlbum(req, res);

  const a = /^\/api\/albums\/([^/]+)(?:\/(meta|files|thumbs)(?:\/([^/]+))?)?$/.exec(pathname);
  if (!a) return fail(res, 404, "Not found.");
  let code, name;
  try { code = decodeURIComponent(a[1]); name = a[3] === undefined ? undefined : decodeURIComponent(a[3]); }
  catch { return fail(res, 400, "Bad address."); }
  if (!CODE_RE.test(code)) return fail(res, 404, "Not found.");
  const part = a[2];
  if (!part) {
    if (m === "GET") return api.getAlbum(req, res, code);
    if (m === "DELETE") return api.deleteAlbum(req, res, code);
  } else if (part === "meta" && name === undefined && m === "PUT") return api.saveMeta(req, res, code);
  else if (name !== undefined) {
    if (!okName(name)) return fail(res, 400, "That file name can't be used. Rename it without slashes and try again.");
    if (part === "files" && m === "PUT") return api.upload(req, res, code, name);
    if (part === "thumbs" && m === "PUT") return api.uploadThumb(req, res, code, name);
    if (part === "files" && m === "GET") return api.download(req, res, code, name, url.searchParams.has("thumb"));
    if (part === "files" && m === "DELETE") return api.deleteFile(req, res, code, name);
  }
  return fail(res, 405, "Not allowed.");
}

let HOSTS = new Set();

const server = http.createServer(async (req, res) => {
  try {
    // Only answer to this computer's own address. This blocks "DNS rebinding", where a website points its own
    // name at 127.0.0.1 to reach apps like this one.
    const host = req.headers.host || "";
    if (!HOSTS.has(host)) return send(res, 421, "Wrong address", { "content-type": "text/plain" });
    const url = new URL(req.url, `http://${host}`);

    if (!url.pathname.startsWith("/api/")) {
      const file = STATIC[url.pathname];
      if (!file || (req.method !== "GET" && req.method !== "HEAD")) return send(res, 404, "Not found", { "content-type": "text/plain" });
      const body = fs.readFileSync(path.isAbsolute(file[0]) ? file[0] : path.join(here, file[0]));
      return send(res, 200, body, { "content-type": file[1] });
    }

    // Other websites open in the browser can send requests here too. They can't read the answers, but they could
    // try to make changes, so anything that changes something must come from this app's own page.
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin") return fail(res, 403, "Blocked.");
    if (req.method !== "GET" && (req.headers.origin !== `http://${host}` || req.headers["x-studio"] !== "1")) {
      return fail(res, 403, "Blocked.");
    }
    await route(req, res, url);
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    if (e instanceof R2Error && e.status === 404) return fail(res, 404, "Not found.");
    if (e.status && !(e instanceof R2Error)) return fail(res, e.status, e.message);
    console.error(e.message);
    fail(res, 502, storageMessage(e, state.bucket));
  }
});
server.requestTimeout = 0; // big uploads take a while

function listen(port, tries = 10) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 1) listen(port + 1, tries - 1);
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const url = `http://127.0.0.1:${port}/`;
    console.log(`\n  SOP Studio is running at ${url}`);
    console.log("  Keep this window open while you work. Close it to lock everything.\n");
    if (!ARGS.has("--no-open")) {
      const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
        : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
      spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    }
  });
}
listen(Number(process.env.PORT || 4417));
