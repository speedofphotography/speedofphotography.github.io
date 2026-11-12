// Shared helpers for the client photo delivery API (Cloudflare Pages Functions).
//
// Storage: the R2 bucket bound to the Pages project as DELIVERY.
// Each client gallery is one top-level folder in that bucket; the folder name is the gallery code
// in the link (speedofphotography.com/g/<code>/). Use a code nobody could guess, e.g. "marcus-gt3-k7q2m9":
// there are no passwords, so the link itself is the key.
// An optional <code>/gallery.json adds a title, client name, date, message and expiry date.
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

const NOINDEX = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

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
  };
}

// A gallery stays open through the whole expiry day.
export function isExpired(meta) {
  if (!meta.expires) return false;
  const t = Date.parse(meta.expires);
  return !Number.isNaN(t) && Date.now() > t + 24 * 60 * 60 * 1000;
}
