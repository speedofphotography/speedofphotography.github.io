// Client gallery "Download all": builds the .zip inside the visitor's browser and streams it straight
// to their downloads, one photo at a time, so even multi-gigabyte galleries never sit in memory and the
// server only ever sends plain files. Files are stored as-is (photos don't shrink when zipped).
// Registered by delivery.js with scope /g/; it only answers requests for /g/__zip/<id>/<name>.zip.

const jobs = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "zip") {
    jobs.set(data.id, { files: data.files, client: event.source });
    if (event.ports && event.ports[0]) event.ports[0].postMessage("ready");
  }
  // "ping" messages from the page just keep this worker awake during long downloads.
});

self.addEventListener("fetch", (event) => {
  const match = new URL(event.request.url).pathname.match(/^\/g\/__zip\/([^/]+)\//);
  if (!match) return;
  const job = jobs.get(match[1]);
  jobs.delete(match[1]);
  if (!job) {
    event.respondWith(new Response("This download link has expired. Go back to the gallery and press Download all again.", {
      status: 404, headers: { "content-type": "text/plain; charset=utf-8" },
    }));
    return;
  }
  const report = (msg) => { try { job.client && job.client.postMessage({ id: match[1], ...msg }); } catch (e) {} };
  event.respondWith(zipResponse(job.files, report));
});

// ---------- Streaming ZIP (stored, data descriptors, ZIP64 when needed) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, crc) {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

const MAX32 = 0xffffffff;
const enc = new TextEncoder();

function dosDateTime(ms) {
  const d = new Date(ms || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// Works out every entry's position up front, so the exact zip size is known before the first byte
// (the browser can then show real progress and time remaining).
function planZip(files) {
  let offset = 0;
  const entries = files.map((f) => {
    const name = enc.encode(f.name);
    const big = f.size >= MAX32; // a single file over 4 GB
    const e = { ...f, nameBytes: name, big, offset, ...dosDateTime(f.mtime) };
    offset += 30 + name.length + (big ? 20 : 0) + f.size + (big ? 24 : 16);
    return e;
  });
  const cdStart = offset;
  let cdSize = 0;
  for (const e of entries) {
    const extra = (e.big ? 16 : 0) + (e.offset >= MAX32 ? 8 : 0);
    e.cdExtra = extra ? extra + 4 : 0;
    cdSize += 46 + e.nameBytes.length + e.cdExtra;
  }
  const zip64 = entries.length >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32 || entries.some((e) => e.big || e.offset >= MAX32);
  const total = cdStart + cdSize + (zip64 ? 56 + 20 : 0) + 22;
  return { entries, cdStart, cdSize, zip64, total };
}

function localHeader(e) {
  const buf = new Uint8Array(30 + e.nameBytes.length + (e.big ? 20 : 0));
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, e.big ? 45 : 20, true);
  v.setUint16(6, 0x0808, true); // sizes/CRC follow the data; UTF-8 names
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, e.time, true);
  v.setUint16(12, e.date, true);
  v.setUint32(14, 0, true);
  v.setUint32(18, e.big ? MAX32 : 0, true);
  v.setUint32(22, e.big ? MAX32 : 0, true);
  v.setUint16(26, e.nameBytes.length, true);
  v.setUint16(28, e.big ? 20 : 0, true);
  buf.set(e.nameBytes, 30);
  if (e.big) {
    const x = 30 + e.nameBytes.length;
    v.setUint16(x, 0x0001, true);
    v.setUint16(x + 2, 16, true); // two zero sizes; real ones are in the data descriptor
  }
  return buf;
}

function dataDescriptor(e) {
  const buf = new Uint8Array(e.big ? 24 : 16);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x08074b50, true);
  v.setUint32(4, e.crc, true);
  if (e.big) {
    v.setBigUint64(8, BigInt(e.size), true);
    v.setBigUint64(16, BigInt(e.size), true);
  } else {
    v.setUint32(8, e.size, true);
    v.setUint32(12, e.size, true);
  }
  return buf;
}

function centralDirectory(plan) {
  const { entries, cdStart, cdSize, zip64 } = plan;
  const buf = new Uint8Array(cdSize + (zip64 ? 76 : 0) + 22);
  const v = new DataView(buf.buffer);
  let p = 0;
  for (const e of entries) {
    const farOffset = e.offset >= MAX32;
    const needs64 = e.big || farOffset;
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, needs64 ? 45 : 20, true);
    v.setUint16(p + 6, needs64 ? 45 : 20, true);
    v.setUint16(p + 8, 0x0808, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, e.time, true);
    v.setUint16(p + 14, e.date, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.big ? MAX32 : e.size, true);
    v.setUint32(p + 24, e.big ? MAX32 : e.size, true);
    v.setUint16(p + 28, e.nameBytes.length, true);
    v.setUint16(p + 30, e.cdExtra, true);
    // comment length, disk, internal and external attributes stay 0
    v.setUint32(p + 42, farOffset ? MAX32 : e.offset, true);
    buf.set(e.nameBytes, p + 46);
    let x = p + 46 + e.nameBytes.length;
    if (e.cdExtra) {
      v.setUint16(x, 0x0001, true);
      v.setUint16(x + 2, e.cdExtra - 4, true);
      x += 4;
      if (e.big) {
        v.setBigUint64(x, BigInt(e.size), true);
        v.setBigUint64(x + 8, BigInt(e.size), true);
        x += 16;
      }
      if (farOffset) v.setBigUint64(x, BigInt(e.offset), true);
    }
    p += 46 + e.nameBytes.length + e.cdExtra;
  }
  const n = entries.length;
  if (zip64) {
    const recordAt = cdStart + cdSize;
    v.setUint32(p, 0x06064b50, true);
    v.setBigUint64(p + 4, 44n, true);
    v.setUint16(p + 12, 45, true);
    v.setUint16(p + 14, 45, true);
    v.setBigUint64(p + 24, BigInt(n), true);
    v.setBigUint64(p + 32, BigInt(n), true);
    v.setBigUint64(p + 40, BigInt(cdSize), true);
    v.setBigUint64(p + 48, BigInt(cdStart), true);
    p += 56;
    v.setUint32(p, 0x07064b50, true);
    v.setBigUint64(p + 8, BigInt(recordAt), true);
    v.setUint32(p + 16, 1, true);
    p += 20;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, Math.min(n, 0xffff), true);
  v.setUint16(p + 10, Math.min(n, 0xffff), true);
  v.setUint32(p + 12, Math.min(cdSize, MAX32), true);
  v.setUint32(p + 16, Math.min(cdStart, MAX32), true);
  return buf;
}

function zipStream(files, report = () => {}) {
  const plan = planZip(files);
  let i = 0;
  let current = null;
  let sent = 0;
  let lastReport = 0;
  const stream = new ReadableStream({
    async pull(ctrl) {
      try {
        if (i >= plan.entries.length) {
          ctrl.enqueue(centralDirectory(plan));
          ctrl.close();
          report({ type: "done" });
          return;
        }
        const e = plan.entries[i];
        if (!current) {
          const res = await fetch(e.url);
          if (!res.ok || !res.body) throw new Error(`Could not load ${e.name} (${res.status})`);
          current = { reader: res.body.getReader(), crc: MAX32, got: 0 };
          ctrl.enqueue(localHeader(e));
          return;
        }
        const { done, value } = await current.reader.read();
        if (!done) {
          current.crc = crc32(value, current.crc);
          current.got += value.length;
          sent += value.length;
          ctrl.enqueue(value);
          if (Date.now() - lastReport > 500) {
            lastReport = Date.now();
            report({ type: "progress", sent, total: plan.total, file: i + 1, files: plan.entries.length });
          }
          return;
        }
        if (current.got !== e.size) throw new Error(`${e.name} changed while downloading`);
        e.crc = (current.crc ^ MAX32) >>> 0;
        ctrl.enqueue(dataDescriptor(e));
        current = null;
        i++;
      } catch (err) {
        report({ type: "error", message: String(err && err.message || err) });
        ctrl.error(err);
      }
    },
    cancel() {
      if (current) current.reader.cancel().catch(() => {});
      report({ type: "cancelled" });
    },
  });
  return { stream, size: plan.total };
}

function zipResponse(files, report) {
  const { stream, size } = zipStream(files, report);
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(size),
      "content-disposition": "attachment",
      "cache-control": "no-store",
    },
  });
}

if (typeof module !== "undefined") module.exports = { zipStream, planZip, crc32 }; // for local tests only
