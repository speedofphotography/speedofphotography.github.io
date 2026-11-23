// Shared helpers for the client photo delivery API (Cloudflare Pages Functions).
//
// Storage: the R2 bucket bound to the Pages project as DELIVERY.
// Each client gallery is one top-level folder in that bucket; the folder name is the gallery code
// in the link (speedofphotography.com/g/<code>/). Use a code nobody could guess, e.g. "marcus-gt3-k7q2m9".
// An optional <code>/gallery.json adds a title, client name, date, message and expiry date, and, for galleries
// made with a password, "access" (a salted hash of it; see Gallery passwords below). A gallery without "access"
// is open to anyone with the link, as every gallery was before passwords existed.
// It can also say how the page looks (see Layouts below): "layout", "order" and "bg". Without them the page shows
// the staggered layout, files in name order, on the site's own colours.
// (This folder starts with "_" so Jekyll never publishes it.)

export const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/;
export const META_FILE = "gallery.json";

const TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", pdf: "application/pdf", zip: "application/zip",
};
const IMAGES = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"]);
const VIDEOS = new Set(["mp4", "m4v", "mov"]);

export const extOf = (name) => ((name.match(/\.([^.\/]+)$/) || [])[1] || "").toLowerCase();
export const typeOf = (name) => TYPES[extOf(name)] || "application/octet-stream";
export const kindOf = (name) => (IMAGES.has(extOf(name)) ? "image" : VIDEOS.has(extOf(name)) ? "video" : "file");

// The same security headers as the site's _headers file (that file doesn't reach Functions answers), plus
// keeping galleries out of search engines and never sending the gallery address to other sites.
export const SECURITY = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://formsubmit.co https://cloudflareinsights.com; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://formsubmit.co; frame-ancestors 'none'; upgrade-insecure-requests",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const NOINDEX = { ...SECURITY, "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...NOINDEX },
  });
}

export function noindex(headers) {
  for (const [k, v] of Object.entries(NOINDEX)) headers.set(k, v);
  return headers;
}

// Files the client should see: no hidden files, no gallery.json, nothing in sub-folders.
export const isClientFile = (name) => !!name && !name.startsWith(".") && !name.includes("/") && name !== META_FILE;

// gallery.json is written by hand, so forgive the usual slips: curly quotes from a phone keyboard,
// a line break typed inside the message, a trailing comma.
function parseLoose(src) {
  const attempts = [
    (s) => s,
    (s) => s
      .replace(/^﻿/, "")
      .replace(/[“”„‟″]/g, '"')
      .replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\r?\n/g, "\\n").replace(/\t/g, " "))
      .replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const fix of attempts) {
    try {
      const v = JSON.parse(fix(src));
      if (v && typeof v === "object") return v;
    } catch { /* try the next fix */ }
  }
  return {};
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function readMeta(bucket, code) {
  const obj = await bucket.get(`${code}/${META_FILE}`);
  if (!obj) return { found: false };
  const raw = parseLoose(await obj.text());
  return {
    found: true,
    title: text(raw.title, 120),
    client: text(raw.client, 120),
    date: text(raw.date, 40),
    message: text(raw.message, 2000),
    expires: text(raw.expires, 40),
    lock: lockOf(raw.access),
    ...cleanLook(raw),
  };
}

// ---------- Layouts ----------
// Chosen in SOP Studio. The page draws them with /gallery-layouts.js, which has the same list of ids.
export const LAYOUTS = ["masonry", "grid", "rows", "feature", "column", "pairs", "mosaic", "alternate",
  "widescreen", "filmstrip", "slideshow", "framed", "portrait-grid", "portrait-rows", "portrait-spotlight",
  "portrait-threes", "portrait-pairs", "portrait-magazine"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_ORDER = 5000;

// { layout, bg, order } from gallery.json (or from Studio), keeping only what's valid. Missing means "as before".
export function cleanLook(raw) {
  const look = {};
  if (!raw || typeof raw !== "object") return look;
  if (LAYOUTS.includes(raw.layout)) look.layout = raw.layout;
  if (typeof raw.bg === "string" && HEX.test(raw.bg)) look.bg = raw.bg.toLowerCase();
  if (Array.isArray(raw.order)) {
    const seen = new Set();
    for (const n of raw.order.slice(0, MAX_ORDER)) {
      if (typeof n === "string" && n.length <= 300 && isClientFile(n) && !seen.has(n)) seen.add(n);
    }
    if (seen.size) look.order = [...seen];
  }
  return look;
}

// Files in the order chosen in Studio; anything not placed yet (new uploads) follows, in name order.
export function arrange(files, order) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const sorted = [...files].sort(byName);
  if (!order || !order.length) return sorted;
  const spot = new Map(order.map((n, i) => [n, i]));
  const placed = sorted.filter((f) => spot.has(f.name)).sort((a, b) => spot.get(a.name) - spot.get(b.name));
  return [...placed, ...sorted.filter((f) => !spot.has(f.name))];
}

// A gallery stays open through the whole expiry day.
export function isExpired(meta) {
  if (!meta.expires) return false;
  const t = Date.parse(meta.expires);
  return !Number.isNaN(t) && Date.now() > t + 24 * 60 * 60 * 1000;
}

// ---------- Gallery passwords ----------
// SOP Studio saves a password as { iter, salt, hash } (PBKDF2-SHA256) in gallery.json, never the password itself.
// A gallery opened by email is { iter, salt, hash, more, email: true }: one hash per email (all with the same salt,
// so checking a try takes one PBKDF2 whatever the number of emails), and any of them lets the client in.
// After the right password, the page gets a key ("k") that it adds to every address in the gallery. The key is
// signed with the stored hash, so changing the password (new salt and hash) makes every old key stop working.
// Studio (Node) and the website (Cloudflare) both use these same functions.
export const PBKDF2_ITER = 100000; // the most Cloudflare allows
const KEY_DAYS = 30; // how long a browser stays let in before asking again
const utf8 = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
// Spaces a phone keyboard adds at the ends don't count, and accented letters compare the same however typed.
export const cleanPassword = (p) => (typeof p === "string" ? p.normalize("NFC").trim() : "");

// Galleries can also be opened with an email: the one the client booked with, or any of a group's. Capital letters
// don't matter there. A list of emails is typed one per line (commas and spaces work too).
export const MAX_EMAILS = 50;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (e) => cleanPassword(e).toLowerCase();
export function emailList(v) {
  const out = [];
  for (const e of (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map(cleanEmail)) {
    if (EMAIL_RE.test(e) && e.length <= 200 && !out.includes(e)) out.push(e);
  }
  return out.slice(0, MAX_EMAILS);
}

function lockOf(a) {
  if (!a || typeof a !== "object") return null;
  const iter = Number(a.iter);
  if (!Number.isInteger(iter) || iter < 1000 || iter > PBKDF2_ITER) return null;
  const more = Array.isArray(a.more) ? a.more : [];
  if (more.length > MAX_EMAILS) return null;
  try {
    if (fromB64(a.salt).length < 16 || [a.hash, ...more].some((x) => typeof x !== "string" || fromB64(x).length !== 32)) return null;
  } catch { return null; }
  const lock = { iter, salt: a.salt, hash: a.hash };
  if (a.email === true) Object.assign(lock, { more, email: true });
  return lock;
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", utf8.encode(cleanPassword(password)), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

export async function makeLock(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { iter: PBKDF2_ITER, salt: toB64(salt), hash: toB64(await pbkdf2(password, salt, PBKDF2_ITER)) };
}

// A lock that opens with any of these emails. Pass the old email lock as "keep" to reuse its salt: then a client
// whose email is still first on the list stays let in on their browser when you add or remove other emails.
export async function makeEmailLock(emails, keep) {
  const list = emailList(emails);
  if (!list.length) return null;
  const salt = keep?.email ? fromB64(keep.salt) : crypto.getRandomValues(new Uint8Array(16));
  const hashes = [];
  for (const e of list) hashes.push(toB64(await pbkdf2(e, salt, PBKDF2_ITER)));
  return { iter: PBKDF2_ITER, salt: toB64(salt), hash: hashes[0], more: hashes.slice(1), email: true };
}

export async function passwordOk(lock, password) {
  const tried = lock?.email ? cleanEmail(password) : cleanPassword(password);
  if (!lock || !tried) return false;
  const got = await pbkdf2(tried, fromB64(lock.salt), lock.iter);
  let match = 0;
  for (const h of [lock.hash, ...(lock.more || [])]) { // every one is compared, so timing says nothing
    const want = fromB64(h);
    let diff = got.length ^ want.length;
    for (let i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
    match |= diff === 0 ? 1 : 0;
  }
  return match === 1;
}

// The master password: one password of the photographer's that opens every gallery with a lock, whatever its
// own password or emails. Kept in the bucket as a lock like any gallery's (salted PBKDF2 hash, never the
// password itself) under _settings/, which gallery pages can't reach (codes can't start with "_").
// Studio sets and removes it.
export const MASTER_KEY = "_settings/master.json";
export const MASTER_MIN = 8;
export async function readMaster(bucket) {
  try {
    const obj = await bucket.get(MASTER_KEY);
    if (!obj) return null;
    const lock = lockOf(JSON.parse(await obj.text()));
    return lock && !lock.email ? lock : null;
  } catch { return null; }
}
// Does this try open a gallery with this lock? Its own password (or one of its emails) first, then the master
// password. An email typed at an email gallery is never the master password, so it isn't checked twice.
export async function unlockOk(lock, password, master) {
  if (await passwordOk(lock, password)) return true;
  if (!master || (lock?.email && EMAIL_RE.test(cleanEmail(password)))) return false;
  return passwordOk(master, password);
}

const signer = (lock) => crypto.subtle.importKey("raw", fromB64(lock.hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function makeKey(lock, code) {
  const exp = Math.floor(Date.now() / 1000) + KEY_DAYS * 86400;
  const sig = await crypto.subtle.sign("HMAC", await signer(lock), utf8.encode(`${code}.${exp}`));
  return `${exp}.${b64url(sig)}`;
}

export async function keyOk(lock, code, key) {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(key || "");
  if (!lock || !m || Number(m[1]) * 1000 < Date.now()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await signer(lock), fromB64url(m[2]), utf8.encode(`${code}.${m[1]}`));
  } catch { return false; }
}

// Is this request let into the gallery? Open galleries always are; locked ones need a valid ?k=.
export const allowed = async (meta, code, url) => !meta.lock || keyOk(meta.lock, code, new URL(url).searchParams.get("k"));
