// SOP Studio: the emails you send clients, in the website's look: the dark page, Barlow Condensed headings in
// capitals, the blue accent line over a small heading, blue buttons and dark panels for the details.
// Email apps ignore most modern CSS, so this is built the way emails have to be: tables, styles on each element,
// and fonts that fall back to Arial Narrow / Arial where the site's own fonts can't load (Gmail, Outlook).
const SITE = "https://speedofphotography.com";
export const C = {
  bg: "#0b0b0c", bgAlt: "#131315", surface: "#1b1b1e", line: "#2a2a2e", text: "#f2f2f0", muted: "#9a9aa0", accent: "#2e7bff",
};
const DISPLAY = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const BODY = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^(https:\/\/|mailto:|cid:|\/api\/)/.test(u) ? u : "");

// Your message: a blank line starts a new paragraph; a single line break stays a line break.
const paragraphs = (text) => String(text || "").trim().split(/\n\s*\n/).filter((p) => p.trim())
  .map((p) => `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.65;color:${C.text};">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");

const eyebrow = (t) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>
  <td style="width:28px;padding:0 10px 0 0;vertical-align:middle;"><div style="height:2px;width:28px;background:${C.accent};line-height:2px;font-size:2px;">&nbsp;</div></td>
  <td style="font-family:${DISPLAY};font-weight:500;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${C.accent};vertical-align:middle;">${esc(t)}</td>
</tr></table>`;

const button = ({ label, url }) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;"><tr>
  <td style="background:${C.accent};border-radius:4px;">
    <a href="${esc(safeUrl(url))}" style="display:inline-block;padding:15px 30px;font-family:${DISPLAY};font-weight:700;font-size:17px;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:4px;">${esc(label)}</a>
  </td></tr></table>`;

// The dark panel with a blue edge: label above, value below, one row per detail.
const details = (title, rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:${C.surface};border:1px solid ${C.line};border-left:3px solid ${C.accent};border-radius:4px;">
  <tr><td style="padding:20px 22px 6px;">
    ${title ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:18px;letter-spacing:1px;text-transform:uppercase;color:${C.text};margin:0 0 14px;">${esc(title)}</div>` : ""}
    ${rows.map(([k, v]) => `<div style="margin:0 0 14px;">
      <div style="font-family:${DISPLAY};font-weight:500;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${C.muted};margin:0 0 3px;">${esc(k)}</div>
      <div style="font-family:${BODY};font-size:16px;line-height:1.45;color:${C.text};word-break:break-word;overflow-wrap:anywhere;">${esc(v).replace(/\n/g, "<br>")}</div>
    </div>`).join("")}
  </td></tr></table>`;

// A solid blue box for the one thing that matters most (how to open the gallery, the shoot date).
const highlight = (label, text) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:${C.accent};border-radius:4px;">
  <tr><td style="padding:16px 22px;">
    <div style="font-family:${DISPLAY};font-weight:500;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#dbe7ff;margin:0 0 4px;">${esc(label)}</div>
    <div style="font-family:${DISPLAY};font-weight:700;font-size:22px;letter-spacing:0.5px;text-transform:uppercase;color:#ffffff;line-height:1.15;">${esc(text)}</div>
  </td></tr></table>`;

// Numbered steps (what happens next): a dark panel with a blue number beside each step.
const steps = (title, items) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:${C.surface};border:1px solid ${C.line};border-left:3px solid ${C.accent};border-radius:4px;">
  <tr><td style="padding:20px 22px 8px;">
    ${title ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:18px;letter-spacing:1px;text-transform:uppercase;color:${C.text};margin:0 0 16px;">${esc(title)}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${items.map((t, i) => `<tr>
      <td width="38" style="width:38px;padding:0 14px 16px 0;vertical-align:top;">
        <div style="width:28px;height:28px;line-height:28px;text-align:center;background:${C.accent};border-radius:4px;font-family:${DISPLAY};font-weight:700;font-size:16px;color:#ffffff;">${i + 1}</div>
      </td>
      <td style="padding:4px 0 16px;vertical-align:top;font-family:${BODY};font-size:16px;line-height:1.5;color:${C.text};">${esc(t)}</td>
    </tr>`).join("")}
    </table>
  </td></tr></table>`;

// mail: { eyebrow, heading, message, button?, highlight?: [label, text], steps?: { title, items }, details?: { title, rows },
//         cover?: url, signature? }. Returns { html, text }.
// No hidden "preview text": text hidden in the page (or coloured like the background) is a classic spam sign, and
// email apps show the first line of the message as the preview anyway.
export function render(mail) {
  const cover = mail.cover ? `<tr><td style="padding:0 0 30px;">
      <img src="${esc(safeUrl(mail.cover))}" width="600" alt="${esc(mail.coverAlt || "A photo from your shoot")}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:8px;">
    </td></tr>` : "";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(mail.subject || mail.heading || "Speed Of Photography")}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:${C.bg}; }
  a { color:${C.accent}; }
  @media (max-width: 620px) { .wrap { padding: 24px 16px !important; } .h1 { font-size: 38px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" class="wrap" style="padding:36px 20px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 0 30px;border-bottom:1px solid ${C.line};">
      <a href="${SITE}/" style="text-decoration:none;"><img src="${SITE}/images/logo-small.png" width="170" alt="Speed Of Photography" style="display:block;width:170px;height:auto;border:0;"></a>
    </td></tr>
    <tr><td style="padding:34px 0 0;">
      ${mail.eyebrow ? eyebrow(mail.eyebrow) : ""}
      <h1 class="h1" style="margin:0 0 26px;font-family:${DISPLAY};font-weight:700;font-size:46px;line-height:1;letter-spacing:0.5px;text-transform:uppercase;color:${C.text};">${esc(mail.heading)}</h1>
    </td></tr>
    ${cover}
    <tr><td>
      ${paragraphs(mail.message)}
      ${mail.highlight ? highlight(...mail.highlight) : ""}
      ${mail.steps && mail.steps.items.length ? steps(mail.steps.title, mail.steps.items) : ""}
      ${mail.button ? button(mail.button) : ""}
      ${mail.details && mail.details.rows.length ? details(mail.details.title, mail.details.rows) : ""}
      ${mail.signature ? `<p style="margin:0 0 6px;font-family:${BODY};font-size:16px;line-height:1.6;color:${C.text};">${esc(mail.signature).replace(/\n/g, "<br>")}</p>` : ""}
    </td></tr>
    <tr><td style="padding:34px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr>
        <td style="padding:22px 0 0;font-family:${BODY};font-size:13px;line-height:1.7;color:${C.muted};">
          <span style="font-family:${DISPLAY};font-weight:700;font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:${C.text};">Speed Of Photography</span><br>
          Automotive photography &middot; Reply to this email any time.<br>
          <a href="${SITE}/" style="color:${C.accent};text-decoration:none;">speedofphotography.com</a>
          &nbsp;&middot;&nbsp;
          <a href="https://www.instagram.com/speedofphotography/" style="color:${C.accent};text-decoration:none;">@speedofphotography</a>
        </td></tr></table>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  // The plain version, for email apps that don't show HTML (and for spam filters, which like having both).
  const lines = [mail.heading.toUpperCase(), "", String(mail.message || "").trim(), ""];
  if (mail.highlight) lines.push(`${mail.highlight[0]}: ${mail.highlight[1]}`, "");
  if (mail.steps && mail.steps.items.length) {
    if (mail.steps.title) lines.push(mail.steps.title.toUpperCase());
    mail.steps.items.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push("");
  }
  if (mail.button) lines.push(`${mail.button.label}: ${mail.button.url}`, "");
  if (mail.details && mail.details.rows.length) {
    if (mail.details.title) lines.push(mail.details.title.toUpperCase());
    for (const [k, v] of mail.details.rows) lines.push(`${k}: ${v}`);
    lines.push("");
  }
  if (mail.signature) lines.push(mail.signature, "");
  lines.push("--", "Speed Of Photography", `${SITE}/`, "Instagram: @speedofphotography");
  return { html, text: lines.join("\n") };
}
