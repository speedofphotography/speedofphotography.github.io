// A small client for the R2 bucket, through R2's S3-compatible API (AWS Signature Version 4).
// Uses only what ships with Node.js, so there is nothing to install.
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

const EMPTY = crypto.createHash("sha256").update("").digest("hex");
const UNSIGNED = "UNSIGNED-PAYLOAD";

// RFC 3986 encoding, as Signature V4 wants it.
export const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// Signs one request. `path` is unencoded ("/bucket/folder/IMG 1.jpg"); the result has the encoded path to send.
export function sign({ method, host, path, query = {}, headers = {}, payloadHash, accessKeyId, secretAccessKey,
  region = "auto", service = "s3", date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const all = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(headers)) all[k.toLowerCase()] = v;
  const names = Object.keys(all).sort();
  const canonHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const qs = Object.keys(query).map((k) => [enc(k), enc(String(query[k]))]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const canonPath = path.split("/").map(enc).join("/");
  const request = [method, canonPath, qs, canonHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  all.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { path: canonPath + (qs ? "?" + qs : ""), headers: all };
}

const unxml = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
  ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e.toLowerCase()] ??
  String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? unxml(m[1]) : ""; };
const all = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);

export class R2Error extends Error {
  constructor(status, code, message) { super(message || code || `Storage answered ${status}`); this.status = status; this.code = code; }
}

const collect = (res) => new Promise((resolve, reject) => {
  const parts = [];
  res.on("data", (c) => parts.push(c));
  res.on("end", () => resolve(Buffer.concat(parts)));
  res.on("error", reject);
});

export function createR2({ accountId, accessKeyId, secretAccessKey, bucket, endpoint }) {
  const base = new URL(endpoint || `https://${accountId}.r2.cloudflarestorage.com`);
  const mod = base.protocol === "http:" ? http : https;
  const agent = new mod.Agent({ keepAlive: true, maxSockets: 8 });

  // Sends one request and resolves with the response once headers arrive. Errors (4xx/5xx) reject with R2Error.
  function send(method, key, { query, headers = {}, body, stream, length, payloadHash } = {}) {
    const hash = payloadHash || (stream ? UNSIGNED : body != null ? sha256(body) : EMPTY);
    const extra = { ...headers };
    if (body != null) extra["content-length"] = String(Buffer.byteLength(body));
    else if (stream) extra["content-length"] = String(length);
    const signed = sign({ method, host: base.host, path: `/${bucket}/${key}`, query, headers: extra, payloadHash: hash,
      accessKeyId, secretAccessKey });
    return new Promise((resolve, reject) => {
      const req = mod.request({ protocol: base.protocol, hostname: base.hostname, port: base.port || undefined,
        method, path: signed.path, headers: signed.headers, agent, timeout: 120000 }, async (res) => {
        if (res.statusCode >= 300 && res.statusCode !== 304) {
          const xml = (await collect(res).catch(() => Buffer.alloc(0))).toString("utf8");
          reject(new R2Error(res.statusCode, tag(xml, "Code"), tag(xml, "Message")));
        } else resolve(res);
      });
      req.on("timeout", () => req.destroy(new Error("Storage took too long to answer")));
      req.on("error", reject);
      if (stream) {
        stream.on("error", (e) => req.destroy(e));
        stream.pipe(req);
      } else req.end(body ?? undefined);
    });
  }

  async function list({ prefix = "", delimiter, token, max = 1000 } = {}) {
    const query = { "list-type": "2", prefix, "max-keys": String(max) };
    if (delimiter) query.delimiter = delimiter;
    if (token) query["continuation-token"] = token;
    const xml = (await collect(await send("GET", "", { query }))).toString("utf8");
    return {
      objects: all(xml, "Contents").map((c) => ({ key: tag(c, "Key"), size: Number(tag(c, "Size")), modified: tag(c, "LastModified") })),
      prefixes: all(xml, "CommonPrefixes").map((c) => tag(c, "Prefix")),
      next: tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") : "",
    };
  }

  return {
    list,
    async listAll(prefix, delimiter) {
      const out = { objects: [], prefixes: [] };
      let token;
      do {
        const page = await list({ prefix, delimiter, token });
        out.objects.push(...page.objects);
        out.prefixes.push(...page.prefixes);
        token = page.next;
      } while (token);
      return out;
    },
    async getBuffer(key) {
      try { return await collect(await send("GET", key)); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async getText(key) {
      const buf = await this.getBuffer(key);
      return buf ? buf.toString("utf8") : null;
    },
    get: (key, headers) => send("GET", key, { headers }),
    async put(key, body, type) {
      const res = await send("PUT", key, { body, headers: { "content-type": type } });
      res.resume();
    },
    async putStream(key, stream, length, type) {
      const res = await send("PUT", key, { stream, length, headers: { "content-type": type } });
      res.resume();
    },
    async del(key) {
      try { (await send("DELETE", key)).resume(); }
      catch (e) { if (e.status !== 404) throw e; }
    },
    close: () => agent.destroy(),
  };
}
