// POST /api/booking : a copy of each booking-form request, for SOP Studio's client records.
//
// The request is encrypted here before it's stored, with a public key SOP Studio puts in the bucket
// (_studio/inbox-public.json). Only Studio, unlocked with your passphrase, holds the matching private key,
// so a booking sitting in the bucket (_inbox/…) can't be read by anyone else. Studio collects new ones,
// adds them to the CRM and deletes them from the bucket. The email copy (FormSubmit) is sent separately
// by the page, so a request still reaches you if this part fails.
const PUBLIC_KEY = "_studio/inbox-public.json";
const MAX_WAITING = 500; // stop accepting if Studio hasn't collected in a long time (or someone is flooding it)

import { SECURITY } from "../../_functions_lib/delivery.js";

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function onRequestPost({ request, env }) {
  const bucket = env.DELIVERY;
  if (!bucket) return reply(503, { error: "not_configured" });
  // Only the booking form on this site may send here: browsers always add the Origin header to it.
  // (Too many requests from one address are also blocked by a Cloudflare rate-limiting rule.)
  const origin = request.headers.get("origin") || "";
  const host = new URL(request.url).host;
  let fromHere = false;
  try { fromHere = new URL(origin).host === host; } catch { fromHere = false; }
  if (!fromHere) return reply(403, { error: "forbidden" });
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) return reply(415, { error: "bad_request" });
  if (Number(request.headers.get("content-length") || 0) > 20000) return reply(413, { error: "too_big" });

  const raw = await request.text();
  if (raw.length > 20000) return reply(413, { error: "too_big" });
  let b;
  try { b = JSON.parse(raw); } catch { return reply(400, { error: "bad_request" }); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return reply(400, { error: "bad_request" });
  // The hidden spam-trap box: people never see it, bots fill it in. Pretend it worked and store nothing.
  if (b._honey) return reply(200, { ok: true });

  const booking = {
    name: text(b.name, 120),
    email: text(b.email, 200),
    phone: text(b.phone, 40),
    instagram: text(b.instagram, 80),
    car: text(b.car, 120),
    type: text(b.type, 120),
    addons: Array.isArray(b.addons) ? b.addons.slice(0, 20).map((a) => text(a, 80)).filter(Boolean) : [],
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "",
    location: text(b.location, 200),
    source: text(b.source, 80),
    message: text(b.message, 5000),
    received: new Date().toISOString(),
  };
  if (!booking.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return reply(400, { error: "bad_request" });

  const keyObj = await bucket.get(PUBLIC_KEY);
  if (!keyObj) return reply(503, { error: "not_ready" });
  const waiting = await bucket.list({ prefix: "_inbox/", limit: MAX_WAITING });
  if (waiting.objects.length >= MAX_WAITING) return reply(503, { error: "full" });

  // A fresh AES key encrypts the booking; the public RSA key locks that AES key.
  const publicKey = await crypto.subtle.importKey("jwk", await keyObj.json(), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(booking)));
  const key = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, await crypto.subtle.exportKey("raw", aes));

  const id = `${booking.received.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await bucket.put(`_inbox/${id}.json`, JSON.stringify({ v: 1, key: b64(key), iv: b64(iv), data: b64(data) }),
    { httpMetadata: { contentType: "application/json" } });
  return reply(200, { ok: true });
}
