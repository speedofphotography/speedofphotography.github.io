// GET  /api/gallery/<code> : the gallery's details and file list, for /g/<code>/.
// POST /api/gallery/<code> : { password } for a gallery with a password (or the client's email, for a gallery
//                            opened by email); answers with a key ("k") the page adds
//                            to every gallery address (see Gallery passwords in _functions_lib/delivery.js).
// Galleries without a password (every gallery made before passwords existed) work exactly as before.
import {
  CODE_RE, json, readMeta, isExpired, isClientFile, kindOf, allowed, passwordOk, makeKey, arrange,
} from "../../../_functions_lib/delivery.js";

// Wrong passwords per gallery, from anywhere, before it stops checking for an hour. (Each address is also
// limited by the Cloudflare rate-limiting rule on /api/gallery/.) Counted in the bucket under _attempts/,
// which gallery pages can never reach: codes can't start with "_".
const MAX_TRIES = 20;
const TRY_WINDOW = 60 * 60 * 1000;

export async function onRequestGet({ request, params, env }) {
  const code = String(params.code || "");
  if (!CODE_RE.test(code)) return json({ error: "not_found" }, 404);
  const bucket = env.DELIVERY;
  if (!bucket) return json({ error: "not_configured" }, 503);

  const meta = await readMeta(bucket, code);
  if (meta.found && isExpired(meta)) return json({ error: "expired" }, 410);
  // A locked gallery says nothing about itself (not even its title) until the password is in.
  // "ask" tells the page whether to ask for a password or for the client's email.
  if (!(await allowed(meta, code, request.url))) return json({ error: "password", ask: meta.lock.email ? "email" : "password" }, 401);

  const files = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: `${code}/`, delimiter: "/", cursor, limit: 1000 });
    for (const obj of page.objects) {
      const name = obj.key.slice(code.length + 1);
      if (!isClientFile(name) || obj.size === 0) continue;
      files.push({ name, size: obj.size, uploaded: obj.uploaded, kind: kindOf(name) });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (!files.length && !meta.found) return json({ error: "not_found" }, 404);

  // Files come in the order arranged in Studio (name order if it was never arranged).
  const { found, lock, order, ...details } = meta;
  return json({ code, ...details, files: arrange(files, order) });
}

export async function onRequestPost({ request, params, env }) {
  const code = String(params.code || "");
  if (!CODE_RE.test(code)) return json({ error: "not_found" }, 404);
  const bucket = env.DELIVERY;
  if (!bucket) return json({ error: "not_configured" }, 503);
  // Only the gallery page on this site sends passwords here.
  let fromHere = false;
  try { fromHere = new URL(request.headers.get("origin") || "").host === new URL(request.url).host; } catch { fromHere = false; }
  if (!fromHere) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) return json({ error: "bad_request" }, 415);
  const raw = await request.text();
  if (raw.length > 2000) return json({ error: "bad_request" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "bad_request" }, 400); }
  const password = b && typeof b.password === "string" ? b.password.slice(0, 200) : "";

  const meta = await readMeta(bucket, code);
  if (!meta.found) return json({ error: "not_found" }, 404);
  if (isExpired(meta)) return json({ error: "expired" }, 410);
  if (!meta.lock) return json({ ok: true, k: "" }); // this gallery has no password

  const triesKey = `_attempts/${code}.json`;
  let tries = { count: 0, since: Date.now() };
  try {
    const t = await bucket.get(triesKey);
    if (t) {
      const saved = JSON.parse(await t.text());
      if (Date.now() - saved.since < TRY_WINDOW) tries = saved;
    }
  } catch { /* start counting again */ }
  if (tries.count >= MAX_TRIES) return json({ error: "too_many" }, 429);

  if (!(await passwordOk(meta.lock, password))) {
    tries.count += 1;
    await bucket.put(triesKey, JSON.stringify(tries), { httpMetadata: { contentType: "application/json" } });
    return json({ error: "wrong_password" }, 401);
  }
  if (tries.count) await bucket.delete(triesKey);
  return json({ ok: true, k: await makeKey(meta.lock, code) });
}
