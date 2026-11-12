// GET /api/gallery/<code> : the gallery's details and file list, for /g/<code>/.
import { CODE_RE, META_FILE, json, readMeta, isExpired, isClientFile, kindOf, downloadNames } from "../../../_functions_lib/delivery.js";

export async function onRequestGet({ params, env }) {
  const code = String(params.code || "");
  if (!CODE_RE.test(code)) return json({ error: "not_found" }, 404);
  const bucket = env.DELIVERY;
  if (!bucket) return json({ error: "not_configured" }, 503);

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

  const meta = await readMeta(bucket, code);
  if (!files.length && !meta.found) return json({ error: "not_found" }, 404);
  if (isExpired(meta)) return json({ error: "expired" }, 410);

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  downloadNames(meta, files).forEach((d, i) => { files[i].download = d; });
  const { found, ...details } = meta;
  return json({ code, ...details, files });
}
