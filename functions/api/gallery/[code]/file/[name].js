// GET /api/gallery/<code>/file/<name> : one original file, straight from R2.
// Add ?dl=1 to make the browser save it instead of showing it. Supports Range (resumable downloads).
import { CODE_RE, typeOf, noindex, readMeta, isExpired, isClientFile, safeDownloadName } from "../../../../../_functions_lib/delivery.js";

export async function onRequest({ request, params, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const code = String(params.code || "");
  const url = new URL(request.url);
  let name = "";
  try { name = decodeURIComponent(url.pathname.split("/").pop()); } catch { name = ""; }
  const bucket = env.DELIVERY;
  if (!bucket) return new Response("Not configured", { status: 503 });
  if (!CODE_RE.test(code) || !isClientFile(name)) return new Response("Not found", { status: 404 });

  const key = `${code}/${name}`;
  const range = parseRange(request.headers.get("range"));
  let meta, obj;
  try {
    [meta, obj] = await Promise.all([
      readMeta(bucket, code),
      request.method === "HEAD" ? bucket.head(key) : bucket.get(key, { range, onlyIf: request.headers }),
    ]);
  } catch (err) {
    if (range) return new Response(null, { status: 416 }); // a range past the end of the file
    throw err;
  }
  if (!obj) return new Response("Not found", { status: 404 });
  if (isExpired(meta)) return new Response("This gallery has expired", { status: 410 });

  const headers = noindex(new Headers());
  obj.writeHttpMetadata(headers);
  const stored = headers.get("content-type");
  if (!stored || stored === "application/octet-stream") headers.set("content-type", typeOf(name));
  headers.set("etag", obj.httpEtag);
  headers.set("last-modified", obj.uploaded.toUTCString());
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  if (url.searchParams.has("dl")) {
    // ?dl=<name> saves it under the gallery's download name (see downloadNames); ?dl=1 keeps the file's own name.
    name = safeDownloadName(url.searchParams.get("dl"), name);
    const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
    headers.set("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }

  if (request.method === "HEAD") {
    headers.set("content-length", String(obj.size));
    return new Response(null, { headers });
  }
  // A failed If-None-Match / If-Match check comes back without a body.
  if (!("body" in obj) || !obj.body) {
    return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers });
  }
  if (range) {
    const start = range.suffix !== undefined ? Math.max(0, obj.size - range.suffix) : range.offset;
    const end = range.length !== undefined ? Math.min(obj.size, start + range.length) - 1 : obj.size - 1;
    if (start > end) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${obj.size}` } });
    }
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

// "bytes=100-199", "bytes=100-" or "bytes=-500" (a single range; anything else gets the whole file).
function parseRange(value) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((value || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === "" ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}
