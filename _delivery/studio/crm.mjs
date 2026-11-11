// Client records (the CRM): clients, shoots, notes and follow-ups, kept as one document.
//
// Saved encrypted on this computer (%APPDATA%\SOP Studio\crm.enc, plus a daily copy in backups\ for the last
// 30 days), and an encrypted copy goes to the R2 bucket (_studio/crm.enc) so nothing is lost if this PC is.
// The data key is random and lives in the passphrase-locked vault. R2 also holds that key locked with your
// passphrase (_studio/key.json), so setting Studio up again on another PC with the same passphrase restores
// everything. Names in the bucket that start with "_" can never be reached through the client gallery pages.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DIR } from "./vault.mjs";

const FILE = path.join(DIR, "crm.enc");
const BACKUPS = path.join(DIR, "backups");
export const REMOTE = "_studio/crm.enc";
export const REMOTE_KEY = "_studio/key.json";
const MAGIC = Buffer.from("SOPCRM1");

export const empty = () => ({ v: 1, rev: 0, clients: [], shoots: [], notes: [], tasks: [] });

export function encrypt(key, doc) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(doc), "utf8"), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}

export function decrypt(key, buf) {
  if (!buf || buf.length < MAGIC.length + 28 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  try {
    const at = MAGIC.length;
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(at, at + 12));
    d.setAuthTag(buf.subarray(at + 12, at + 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(at + 28)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

// ---------- shape ----------
// Only known fields, the right types and sensible lengths get saved, whatever the page sends.

const str = (max) => (v) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = (list) => (v) => (list.includes(v) ? v : list[0]);
const ID = str(40);
export const STATUSES = ["inquiry", "booked", "shot", "editing", "delivered", "cancelled"];
export const PAYMENTS = ["unpaid", "deposit", "paid"];
export const NOTE_KINDS = ["note", "call", "email", "message", "meeting"];

const SCHEMA = {
  clients: { id: ID, name: str(120), email: str(200), phone: str(60), instagram: str(80), cars: str(1000),
    source: str(60), notes: str(5000), created: str(40) },
  shoots: { id: ID, clientId: ID, car: str(120), title: str(160), date: str(10), time: str(10), location: str(200),
    package: str(120), status: oneOf(STATUSES), payment: oneOf(PAYMENTS), amount: str(40), gallery: str(90),
    notes: str(5000), created: str(40) },
  notes: { id: ID, clientId: ID, shootId: ID, at: str(40), kind: oneOf(NOTE_KINDS), text: str(5000) },
  tasks: { id: ID, clientId: ID, shootId: ID, due: str(10), text: str(500), done: (v) => v === true, doneAt: str(40) },
};

export function clean(doc) {
  const out = empty();
  out.rev = Number.isInteger(doc?.rev) ? doc.rev : 0;
  for (const [list, fields] of Object.entries(SCHEMA)) {
    const seen = new Set();
    for (const item of Array.isArray(doc?.[list]) ? doc[list].slice(0, 20000) : []) {
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      const row = {};
      for (const [k, fix] of Object.entries(fields)) row[k] = fix(item[k]);
      out[list].push(row);
    }
  }
  return out;
}

// ---------- storage ----------

export function createStore(r2, key) {
  let doc = null;
  let timer = null;
  let uploading = null;
  const backup = { at: "", error: "" };

  function readLocal() {
    try { return decrypt(key, fs.readFileSync(FILE)); } catch { return null; }
  }

  async function upload() {
    timer = null;
    const body = encrypt(key, doc);
    uploading = r2.put(REMOTE, body, "application/octet-stream")
      .then(() => { backup.at = new Date().toISOString(); backup.error = ""; })
      .catch((e) => { backup.error = e.message || "Backup failed"; })
      .finally(() => { uploading = null; });
    return uploading;
  }
  const scheduleUpload = () => { clearTimeout(timer); timer = setTimeout(upload, 3000); };

  return {
    backup,

    // The newest of the copy on this PC and the copy in R2 (so a second PC picks up where the other left off).
    async load() {
      if (doc) return doc;
      const local = readLocal();
      let remote = null;
      try { remote = decrypt(key, await r2.getBuffer(REMOTE)); } catch (e) { backup.error = e.message; }
      const best = [local, remote].filter(Boolean).sort((a, b) => (b.rev || 0) - (a.rev || 0))[0];
      doc = clean(best || empty());
      if (remote && remote.rev === doc.rev) backup.at = backup.at || "earlier";
      if (local && (!remote || (local.rev || 0) > (remote.rev || 0))) scheduleUpload();
      if (!local && remote) writeLocal();
      return doc;
    },

    // Saves a new version. `next.rev` must match the current one, so two open tabs can't overwrite each other.
    async save(next) {
      await this.load();
      if (next.rev !== doc.rev) return null;
      doc = clean({ ...next, rev: doc.rev + 1 });
      writeLocal();
      scheduleUpload();
      return doc;
    },

    async flush() {
      if (timer) { clearTimeout(timer); await upload(); }
      else if (uploading) await uploading;
    },
  };

  function writeLocal() {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const buf = encrypt(key, doc);
    fs.writeFileSync(FILE + ".tmp", buf, { mode: 0o600 });
    fs.renameSync(FILE + ".tmp", FILE);
    // One copy per day, the last 30 days.
    fs.writeFileSync(path.join(BACKUPS, `crm-${new Date().toISOString().slice(0, 10)}.enc`), buf, { mode: 0o600 });
    const old = fs.readdirSync(BACKUPS).filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.enc$/.test(f)).sort().slice(0, -30);
    for (const f of old) fs.rmSync(path.join(BACKUPS, f), { force: true });
  }
}
