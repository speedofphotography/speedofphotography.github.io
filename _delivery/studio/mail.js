// SOP Studio: write an email to a client and send it from your Gmail, in the website's look. The preview beside
// the form is the real email (made by mailer.mjs), so what you see is what they get.
import { h, show, toast, api, Locked, field, select, back, go } from "./ui.js";
import * as crm from "./crm.js";

const TYPES = [["gallery", "Photos are ready (gallery link)"], ["thanks", "Thank you + next steps"], ["booking", "Shoot booked (date, time, place)"], ["message", "Message"]];

// The original wording of the two gallery emails. Settings > Email wording replaces it with yours.
// {name} = the client's first name ("everyone" for a group), {car} = the shoot's car, {from} = your name.
export const DEFAULTS = {
  thanks: {
    subject: "Thanks for the shoot!", eyebrow: "Thank you", heading: "Thanks for the shoot",
    message: "Hi {name},\n\nThanks for a great shoot with your {car}. I had a lot of fun with it.",
    stepsTitle: "Next steps",
    steps: "I'm editing your photos now.\nYou'll get an email with your gallery link as soon as they're ready.\nOpen the gallery with your email address, then view and download everything.",
    sign: "Thanks,\n{from}",
  },
  gallery: {
    subject: "Your photos are ready", eyebrow: "Your gallery", heading: "Your photos are ready",
    message: "Hi {name},\n\nThanks again for the shoot with your {car}. Your edited photos are ready to view and download.\n\n" +
      "Open your gallery with the button below. You can save single photos or download everything at once.",
    stepsTitle: "", steps: "", sign: "Thanks,\n{from}",
  },
};
const FIELDS = ["subject", "eyebrow", "heading", "message", "stepsTitle", "steps", "sign"];
const shortDay = (iso) => (iso ? new Date(`${iso}T12:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "");

// The starting words for each kind of email. Everything can be changed before sending.
function template(kind, c, s, from) {
  const many = crm.emailsOf(c).length > 1;
  const name = many ? "everyone" : (c?.name || "").split(" ")[0] || "there";
  const hi = `Hi ${name},`;
  const car = s?.car ? ` with your ${s.car}` : "";
  const sign = `Thanks,\n${from || "Speed Of Photography"}`;
  if (DEFAULTS[kind]) {
    const t = { ...DEFAULTS[kind], ...(crm.savedTemplate(kind) || {}) };
    const fill = (v) => String(v || "").replace(/\{name\}/g, name).replace(/\{car\}/g, s?.car || "car").replace(/\{from\}/g, from || "Speed Of Photography");
    return Object.fromEntries(FIELDS.map((k) => [k, fill(t[k])]));
  }
  if (kind === "booking") return {
    subject: `You're booked${s?.date ? ` for ${shortDay(s.date)}` : ""}`, eyebrow: "Shoot confirmed", heading: "You're booked", sign,
    message: `${hi}\n\nYou're all set for the shoot${car}. The details are below. If anything changes, just reply to this email.`,
  };
  return { subject: "", eyebrow: "Speed Of Photography", heading: "", message: `${hi}\n\n`, sign };
}

export async function composeScreen(q) {
  await crm.load();
  const c = crm.clientById(q.get("client") || "");
  if (!c) return show(back("#/clients", "Clients"), h("p", { class: "panel narrow" }, "Pick a client first: open them in Clients and use Send email."));
  const mail = await api("GET", "/api/mail");
  const shoots = crm.shootsOfClient(c.id);
  // Back to where you came from: the gallery page, the shoot, or the client.
  const fromShoot = crm.shootById(q.get("shoot") || "");
  const backTo = q.get("back") === "g" && fromShoot?.gallery ? `#/g/${fromShoot.gallery}` : fromShoot ? `#/shoots/${fromShoot.id}` : `#/clients/${c.id}`;
  const backLabel = q.get("back") === "g" && fromShoot?.gallery ? "Gallery" : fromShoot ? "Shoot" : c.name;
  const emails = crm.emailsOf(c);

  // ----- who it goes to -----
  const boxes = emails.map((e) => h("label", { class: "check" }, h("input", { type: "checkbox", value: e, checked: true }), ` ${e}`));
  const extra = h("input", { type: "text", placeholder: "Anyone else? Add emails, separated by commas", spellcheck: "false", autocapitalize: "off" });
  const recipients = () => [...boxes.map((b) => b.firstChild).filter((x) => x.checked).map((x) => x.value),
    ...extra.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)];

  // ----- what it's about -----
  const shootSel = select("shoot", [["", "No shoot"], ...shoots.map((s) => [s.id, `${s.car || crm.shootName(s)}${s.date ? ` (${shortDay(s.date)})` : ""}`])],
    q.get("shoot") || shoots[0]?.id || "");
  const typeSel = h("select", { name: "kind" });
  const subject = h("input", { maxlength: "200", required: true });
  const eyebrow = h("input", { maxlength: "60" });
  const heading = h("input", { maxlength: "120" });
  const message = h("textarea", { rows: "9", maxlength: "10000" });
  const sign = h("textarea", { rows: "2", maxlength: "500" });
  const buttonLabel = h("input", { maxlength: "40", value: "View your photos" });
  const cover = h("input", { type: "checkbox", checked: true });
  const galleryBits = h("div", {}, field("Button", buttonLabel), h("label", { class: "check" }, cover, " Show a photo from the gallery at the top"));
  const stepsTitle = h("input", { maxlength: "60" });
  const steps = h("textarea", { rows: "5", maxlength: "5000" });
  const stepsBits = h("div", {}, field("Steps heading", stepsTitle), field("Next steps", steps, "One step per line. Each gets a blue number."));

  const shoot = () => crm.shootById(shootSel.value);
  const wording = h("p", { class: "muted small" }, "Change the starting wording of this email in ", h("a", { href: "#/settings" }, "Settings"), ".");
  function fillTypes(want) {
    const s = shoot();
    const types = TYPES.filter(([k]) => (k === "gallery" ? !!s?.gallery : k === "booking" || k === "thanks" ? !!s : true));
    typeSel.replaceChildren(...types.map(([v, label]) => h("option", { value: v }, label)));
    typeSel.value = types.some(([k]) => k === want) ? want : types[0][0];
  }
  function fillText() {
    const t = template(typeSel.value, c, shoot(), mail.fromName);
    subject.value = t.subject;
    eyebrow.value = t.eyebrow;
    heading.value = t.heading;
    message.value = t.message;
    sign.value = t.sign;
    stepsTitle.value = t.stepsTitle || "";
    steps.value = t.steps || "";
    galleryBits.hidden = typeSel.value !== "gallery";
    stepsBits.hidden = typeSel.value !== "thanks";
    wording.hidden = !DEFAULTS[typeSel.value];
  }
  const s0 = shoot();
  fillTypes(q.get("kind") || (s0?.gallery ? "gallery" : s0 ? "booking" : "message"));
  fillText();
  shootSel.addEventListener("change", () => { fillTypes(typeSel.value); fillText(); refresh(); });
  typeSel.addEventListener("change", () => { fillText(); refresh(); });

  const draft = () => ({
    clientId: c.id, shootId: shootSel.value, kind: typeSel.value, to: recipients(), subject: subject.value, eyebrow: eyebrow.value,
    heading: heading.value, message: message.value, signature: sign.value, buttonLabel: buttonLabel.value, cover: cover.checked,
    stepsTitle: stepsTitle.value, steps: steps.value,
  });

  // ----- preview -----
  const frame = h("iframe", { class: "mail-frame", title: "Email preview", sandbox: "allow-same-origin allow-popups allow-popups-to-escape-sandbox" });
  const previewErr = h("p", { class: "warn small", hidden: true });
  let timer = 0, seq = 0;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const { url } = await api("POST", "/api/mail/preview", draft());
        if (mine === seq) { frame.src = url; previewErr.hidden = true; }
      } catch (e) { if (!(e instanceof Locked) && mine === seq) { previewErr.textContent = e.message; previewErr.hidden = false; } }
    }, 350);
  }
  for (const el of [subject, eyebrow, heading, message, sign, buttonLabel, stepsTitle, steps]) el.addEventListener("input", refresh);
  cover.addEventListener("change", refresh);
  const widthBtns = [["Computer", ""], ["Phone", "is-phone"]].map(([label, cls], i) =>
    h("button", { type: "button", class: "btn btn-line small", "aria-pressed": String(i === 0), onclick: (e) => {
      widthBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      frame.className = `mail-frame ${cls}`;
    } }, label));

  // ----- send -----
  const sendBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Send email");
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const form = h("form", { class: "panel compose-form", autocomplete: "off" },
    h("h1", {}, "Email ", c.name),
    h("div", { class: "field" }, h("span", {}, "To"),
      emails.length ? h("div", { class: "to-list" }, boxes) : h("p", { class: "muted small" }, `${c.name} has no email in your records. Add one below, or `, h("a", { href: `#/clients/${c.id}/edit` }, "edit the client"), "."),
      extra),
    shoots.length ? field("About", shootSel) : null,
    field("Kind of email", typeSel),
    field("Subject", subject),
    h("div", { class: "pair" }, field("Small heading", eyebrow, "The blue line at the top."), field("Big heading", heading)),
    field("Message", message, "A blank line starts a new paragraph."),
    stepsBits,
    galleryBits,
    field("Sign-off", sign),
    wording,
    mail.ready
      ? h("div", { class: "row" }, sendBtn, h("span", { class: "muted small" }, `From ${mail.address}`))
      : h("div", { class: "notice" }, h("p", {}, "To send from Studio, connect your Gmail in ", h("a", { href: "#/settings" }, "Settings"), " (once)."),
          h("button", { type: "button", class: "btn btn-line small", onclick: () => {
            const d = draft();
            const body = [d.message.trim(), d.kind === "gallery" && shoot()?.gallery ? `https://speedofphotography.com/g/${shoot().gallery}/` : "", d.signature].filter(Boolean).join("\n\n");
            location.href = `mailto:${d.to.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`;
          } }, "Open as plain text in your email app instead")),
    err);
  if (!mail.ready) sendBtn.remove();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const d = draft();
    if (!d.to.length) { err.textContent = "Pick who it goes to."; err.hidden = false; return; }
    if (!confirm(`Send "${d.subject}" to ${d.to.join(", ")}?`)) return;
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    try {
      const r = await api("POST", "/api/mail/send", d);
      await crm.logEmail(c.id, d.shootId, `Sent "${r.subject}" to ${r.to.join(", ")}.`, d.kind).catch(() => {});
      toast(`Sent to ${r.to.join(", ")}. It's in your Gmail Sent folder too.`);
      go(backTo);
    } catch (ex) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send email";
      if (!(ex instanceof Locked)) { err.textContent = ex.message; err.hidden = false; }
    }
  });

  show(back(backTo, backLabel),
    h("div", { class: "compose" }, form,
      h("section", { class: "panel compose-preview" }, h("div", { class: "head" }, h("h2", {}, "Preview"), h("div", { class: "row" }, widthBtns)), previewErr, frame)));
  refresh();
}

// The "Sending email" panel in Settings: your Gmail address and an app password, kept in the vault.
export async function mailSettings() {
  const mail = await api("GET", "/api/mail");
  const status = h("p", {}, mail.ready ? `Sending from ${mail.address}.` : h("span", { class: "muted" }, "Not set up yet."));
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  const form = h("form", { class: "panel narrow", autocomplete: "off" },
    h("h2", {}, "Sending email"),
    h("p", { class: "muted" }, "Studio sends client emails from your own Gmail, so replies come back to you and copies land in Sent. It signs in with an app password: a separate password just for Studio that you can cancel any time, without changing your Google password."),
    h("ol", { class: "steps" },
      h("li", {}, "Turn on 2-Step Verification for the Google account, if it isn't on yet."),
      h("li", {}, "Open ", h("a", { href: "https://myaccount.google.com/apppasswords", target: "_blank", rel: "noopener" }, "myaccount.google.com/apppasswords"), ", make one called SOP Studio, and copy the 16 letters it shows."),
      h("li", {}, "Paste them below with your Studio passphrase.")),
    status,
    field("Gmail address", h("input", { name: "address", type: "email", value: mail.address || "", required: true, spellcheck: "false" })),
    field("App password", h("input", { name: "appPassword", type: "password", autocomplete: "off", required: !mail.ready, placeholder: mail.ready ? "Saved (leave blank to keep it)" : "16 letters" })),
    field("Name clients see", h("input", { name: "fromName", value: mail.fromName || "Speed Of Photography", maxlength: "80" })),
    field("Your Studio passphrase", h("input", { name: "passphrase", type: "password", required: true, autocomplete: "current-password" })),
    h("div", { class: "row" },
      h("button", { type: "submit", class: "btn btn-primary" }, mail.ready ? "Save" : "Connect Gmail"),
      mail.ready ? h("button", { type: "button", class: "btn btn-line", onclick: async (e) => {
        e.currentTarget.disabled = true;
        const b = e.currentTarget;
        try { const r = await api("POST", "/api/mail/test"); toast(`Test email sent to ${r.to}. Check your inbox.`); }
        catch (ex) { if (!(ex instanceof Locked)) toast(ex.message, true); }
        finally { b.disabled = false; }
      } }, "Send me a test email") : null,
      mail.ready ? h("button", { type: "button", class: "btn btn-line", onclick: async () => {
        const passphrase = form.elements.passphrase.value;
        if (!passphrase) { err.textContent = "Type your Studio passphrase first."; err.hidden = false; return; }
        if (!confirm("Stop sending from Studio? The app password is forgotten here (also delete it at Google).")) return;
        try { await api("PUT", "/api/mail/settings", { remove: true, passphrase }); toast("Studio no longer sends email."); mailSettings().then((p) => form.replaceWith(p)); }
        catch (ex) { if (!(ex instanceof Locked)) { err.textContent = ex.message; err.hidden = false; } }
      } }, "Disconnect") : null),
    err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Checking with Gmail…";
    try {
      const r = await api("PUT", "/api/mail/settings", Object.fromEntries(new FormData(form)));
      toast(`Connected. Studio sends from ${r.address}.`);
      form.replaceWith(await mailSettings());
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = mail.ready ? "Save" : "Connect Gmail";
      if (!(ex instanceof Locked)) { err.textContent = ex.message; err.hidden = false; }
    }
  });
  return form;
}

// Settings > Email wording: your own starting text for the thank-you and photos-ready emails.
export function wordingSettings() {
  const panel = h("section", { class: "panel narrow" }, h("h2", {}, "Email wording"),
    h("p", { class: "muted" }, "The starting text for the two emails on each gallery page. You can still change it before each send. ",
      "Write {name} for the client's first name (\"everyone\" for a group), {car} for the car and {from} for your name."));
  for (const [kind, title] of [["thanks", "Thank you + next steps"], ["gallery", "Photos are ready"]]) {
    const t = { ...DEFAULTS[kind], ...(crm.savedTemplate(kind) || {}) };
    const inputs = {
      subject: h("input", { maxlength: "200", value: t.subject }),
      eyebrow: h("input", { maxlength: "60", value: t.eyebrow }),
      heading: h("input", { maxlength: "120", value: t.heading }),
      message: h("textarea", { rows: "6", maxlength: "10000" }, t.message),
      stepsTitle: h("input", { maxlength: "60", value: t.stepsTitle }),
      steps: h("textarea", { rows: "5", maxlength: "5000" }, t.steps),
      sign: h("textarea", { rows: "2", maxlength: "500" }, t.sign),
    };
    const save = h("button", { type: "button", class: "btn btn-primary small", onclick: async () => {
      save.disabled = true;
      try {
        await crm.setTemplate(kind, Object.fromEntries(FIELDS.map((k) => [k, inputs[k].value])));
        toast(`Saved. New "${title}" emails start with this.`);
      } catch (e) { if (!(e instanceof Locked)) toast(e.message, true); }
      finally { save.disabled = false; }
    } }, "Save");
    const reset = h("button", { type: "button", class: "btn btn-line small", onclick: async () => {
      if (!confirm(`Go back to the original wording for "${title}"?`)) return;
      try {
        await crm.setTemplate(kind, null);
        for (const k of FIELDS) inputs[k].value = DEFAULTS[kind][k];
        toast("Back to the original wording.");
      } catch (e) { if (!(e instanceof Locked)) toast(e.message, true); }
    } }, "Original wording");
    panel.append(h("details", { class: "wording", open: kind === "thanks" }, h("summary", {}, title),
      field("Subject", inputs.subject),
      h("div", { class: "pair" }, field("Small heading", inputs.eyebrow), field("Big heading", inputs.heading)),
      field("Message", inputs.message, "A blank line starts a new paragraph."),
      kind === "thanks" ? [field("Steps heading", inputs.stepsTitle), field("Next steps", inputs.steps, "One step per line.")] : null,
      field("Sign-off", inputs.sign),
      h("div", { class: "row" }, save, reset)));
  }
  return panel;
}
