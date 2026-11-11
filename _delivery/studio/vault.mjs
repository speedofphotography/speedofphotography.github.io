// The R2 keys, locked with your passphrase. Stored in your Windows user folder (never in the website folder,
// which is public on GitHub). Without the passphrase the file is unreadable: AES-256-GCM, with the key made from
// the passphrase by scrypt, which is deliberately slow so guessing passphrases is impractical.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DIR = process.env.SOP_STUDIO_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "SOP Studio");
const FILE = path.join(DIR, "vault.json");
const KDF = { N: 2 ** 17, r: 8, p: 1 };

export const exists = () => fs.existsSync(FILE);

const derive = (pass, salt, { N, r, p }) => new Promise((resolve, reject) =>
  crypto.scrypt(pass.normalize("NFC"), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function save(pass, secrets) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await derive(pass, salt, KDF);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  const out = { v: 1, kdf: { name: "scrypt", ...KDF }, salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// The saved keys, or null if the passphrase is wrong.
export async function open(pass) {
  const v = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const key = await derive(pass, Buffer.from(v.salt, "base64"), v.kdf);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "base64"));
    d.setAuthTag(Buffer.from(v.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data, "base64")), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}
