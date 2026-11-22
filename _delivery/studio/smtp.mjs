// SOP Studio: sends email from your own Gmail address, the way an email app does (SMTP over TLS to Gmail, signed
// in with a Google "app password"). Gmail keeps a copy in your Sent folder, and replies come back to your inbox.
// No outside packages: the conversation with the mail server is a handful of lines (RFC 5321), and the message
// itself is built here as HTML with a plain-text version and an inline picture (RFC 2045-2047).
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

// Gmail by default. SOP_STUDIO_SMTP="host:port:plain" points it at a stand-in mail server for testing.
export function server() {
  const [host, port, mode] = (process.env.SOP_STUDIO_SMTP || "smtp.gmail.com:465:tls").split(":");
  return { host, port: Number(port), secure: mode !== "plain" };
}

export const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const noBreaks = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
// A header value with non-English letters, written the way mail headers allow (RFC 2047).
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const b64lines = (buf) => buf.toString("base64").replace(/.{1,76}/g, "$&\r\n");
const boundary = () => `=_sop_${crypto.randomBytes(12).toString("hex")}`;

// Text the way ordinary email apps send it (quoted-printable, RFC 2045): plain letters stay as they are, anything
// else becomes =XX, and long lines are folded with a "=" at the end. Spam filters distrust text sent as base64.
export function qp(str) {
  const out = [];
  for (const line of String(str).replace(/\r\n?/g, "\n").split("\n")) {
    const bytes = Buffer.from(line, "utf8");
    let enc = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      const keep = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && i < bytes.length - 1);
      enc += keep ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    while (enc.length > 76) {
      // Fold at 75 characters plus "=", never through the middle of an =XX.
      let cut = 75;
      if (enc[cut - 1] === "=") cut -= 1;
      else if (enc[cut - 2] === "=") cut -= 2;
      out.push(`${enc.slice(0, cut)}=`);
      enc = enc.slice(cut);
    }
    out.push(enc);
  }
  return out.join("\r\n");
}

// The whole message as text, ready to send. inline: [{ cid, type, name, data: Buffer }] pictures the HTML shows
// with src="cid:...".
export function buildMessage({ from, fromName, to, subject, html, text, inline = [] }) {
  const alt = boundary();
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", qp(text),
    `--${alt}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", qp(html),
    `--${alt}--`, "",
  ].join("\r\n");
  let body = altPart;
  if (inline.length) {
    const rel = boundary();
    body = [`Content-Type: multipart/related; boundary="${rel}"`, "", `--${rel}`, altPart,
      ...inline.flatMap((p) => [`--${rel}`, `Content-Type: ${p.type}; name="${p.name}"`, "Content-Transfer-Encoding: base64",
        `Content-ID: <${p.cid}>`, `Content-Disposition: inline; filename="${p.name}"`, "", b64lines(p.data)]),
      `--${rel}--`, ""].join("\r\n");
  }
  const domain = from.split("@")[1] || "localhost";
  const head = [
    `From: ${word(`"${noBreaks(fromName).replace(/"/g, "")}"`)} <${from}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${word(noBreaks(subject))}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
  ];
  return `${head.join("\r\n")}\r\n${body}`;
}

// Talks to the mail server: send a line, wait for the answer (a 3-digit code; "250-" lines go on, "250 " ends).
function connect({ host, port, secure }, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = "", waiting = null;
    const fail = (e) => { if (waiting) { const w = waiting; waiting = null; w.reject(e); } else reject(e); };
    sock.setTimeout(timeout, () => { sock.destroy(); fail(new Error("The mail server stopped answering.")); });
    sock.on("error", (e) => fail(e));
    // An answer can arrive before anyone is waiting for it (the greeting), so it stays in buf until asked for.
    const pump = () => {
      if (!waiting) return;
      const lines = buf.split("\r\n");
      const done = lines.slice(0, -1).findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (done < 0) return;
      const reply = lines.slice(0, done + 1);
      buf = lines.slice(done + 1).join("\r\n");
      const w = waiting;
      waiting = null;
      w.resolve({ code: Number(reply[done].slice(0, 3)), text: reply.map((l) => l.slice(4)).join("\n") });
    };
    sock.on("data", (d) => { buf += d.toString("utf8"); pump(); });
    const next = () => new Promise((res, rej) => { waiting = { resolve: res, reject: rej }; pump(); });
    const talk = async (line, want) => {
      const p = next();
      if (line != null) sock.write(`${line}\r\n`);
      const r = await p;
      if (!want.includes(r.code)) throw Object.assign(new Error(r.text || `Mail server said ${r.code}`), { smtp: r.code });
      return r;
    };
    sock.once(secure ? "secureConnect" : "connect", () => resolve({ talk, sock }));
  });
}

async function session(cfg, user, pass, work) {
  const { talk, sock } = await connect(cfg);
  try {
    await talk(null, [220]);
    await talk("EHLO sop-studio", [250]);
    const auth = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
    try { await talk(`AUTH PLAIN ${auth}`, [235]); }
    catch (e) {
      if (e.smtp === 534 || e.smtp === 535) throw Object.assign(new Error("Gmail didn't accept the address and app password. Check both in Settings."), { status: 400 });
      throw e;
    }
    if (work) await work(talk, sock);
    await talk("QUIT", [221]).catch(() => {});
  } finally { sock.end(); }
}

// Signs in and out again: checks the address and app password without sending anything.
export const checkLogin = (mail) => session(server(), mail.address, mail.appPassword);

export async function send(mail, { to, subject, html, text, inline }) {
  const list = [...new Set(to.map((x) => String(x).trim().toLowerCase()))];
  if (!list.length || list.some((x) => !EMAIL_RE.test(x))) throw Object.assign(new Error("Check the email addresses."), { status: 400 });
  const message = buildMessage({ from: mail.address, fromName: mail.fromName || "Speed Of Photography", to: list, subject, html, text, inline });
  await session(server(), mail.address, mail.appPassword, async (talk, sock) => {
    await talk(`MAIL FROM:<${mail.address}>`, [250]);
    for (const r of list) await talk(`RCPT TO:<${r}>`, [250, 251]);
    await talk("DATA", [354]);
    // A line that starts with "." gets a second one, so it can't end the message early.
    const p = talk(null, [250]);
    sock.write(`${message.replace(/\r\n\./g, "\r\n..")}\r\n.\r\n`);
    await p;
  });
  return list;
}
