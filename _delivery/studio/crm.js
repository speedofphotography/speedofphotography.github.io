// Client records: the Today page, clients, shoots, follow-ups and notes. Saved through the local app,
// which keeps them encrypted (see crm.mjs).
import { h, show, toast, api, Locked, day, weekday, isoIn, plural, newId, copy, field, select, suggest, busyForm, back, go } from "./ui.js";

export const STATUS = [["inquiry", "Inquiry"], ["booked", "Booked"], ["shot", "Shot"], ["editing", "Editing"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
export const PAYMENT = [["unpaid", "Unpaid"], ["deposit", "Deposit paid"], ["paid", "Paid"]];
const KINDS = [["note", "Note"], ["call", "Call"], ["email", "Email"], ["message", "Message"], ["meeting", "Meeting"]];
const SOURCES = ["Instagram", "Website booking form", "Referral", "Car meet", "Repeat client", "Other"];
const NEXT = { inquiry: "booked", booked: "shot", shot: "editing", editing: "delivered" };
const label = (list, v) => (list.find((x) => x[0] === v) || [])[1] || v;

// ---------- data ----------

let doc = null;
let backup = {};

export async function load(force = false) {
  if (!doc || force) {
    const r = await api("GET", "/api/crm");
    doc = r.doc;
    backup = r.backup || {};
  }
  return doc;
}
export const forget = () => { doc = null; };
export const backupState = () => backup;

async function save() {
  try {
    const r = await api("PUT", "/api/crm", { doc });
    doc.rev = r.rev;
    backup = r.backup || backup;
  } catch (e) {
    if (e.status === 409 && e.data?.doc) {
      doc = e.data.doc;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    throw e;
  }
}
// Saves, and shows a message instead of failing silently.
async function commit(message) {
  try { await save(); if (message) toast(message); return true; }
  catch (e) { if (!(e instanceof Locked)) toast(e.message, true); return false; }
}

const today = () => isoIn(0);
const now = () => new Date().toISOString();
const clientOf = (id) => doc.clients.find((c) => c.id === id);
const shootOf = (id) => doc.shoots.find((s) => s.id === id);
const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999");
const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");
const shootsOf = (clientId) => doc.shoots.filter((s) => s.clientId === clientId).sort(byDateDesc);
export const carsOf = (c) => (c?.cars || "").split(/\n|,/).map((s) => s.trim()).filter(Boolean);
// A client can have several emails (a group booking), kept one per line. Same rules as the website's emailList().
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitEmails = (v) => String(v || "").split(/[\s,;]+/).map((e) => e.normalize("NFC").trim().toLowerCase()).filter(Boolean);
export const emailsOf = (c) => [...new Set(splitEmails(c?.email).filter((e) => EMAIL_RE.test(e)))];
export const shootForGallery = (code) => doc?.shoots.find((s) => s.gallery === code);
// ---------- gallery length ----------
// How long a gallery stays open. The default for new galleries is set in Settings.
export const LENGTHS = [[14, "2 weeks"], [30, "30 days"], [60, "60 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"], [0, "No end date"]];
export const galleryDays = () => doc?.settings?.galleryDays ?? 60;
export const endFor = (days) => (days ? isoIn(days) : "");
export async function setGalleryDays(days) {
  await load();
  doc.settings = { ...(doc.settings || {}), galleryDays: days };
  await save();
}

// ---------- website bookings ----------
// Requests from the booking form wait (encrypted) in the bucket. This adds each one to the records: the client
// (matched by email, phone or Instagram, or added new), an Inquiry shoot, a note, and a follow-up to reply today.
// Returns how many were added. Safe to run twice: each booking remembers where it came from.
const digits = (v) => (v || "").replace(/\D/g, "");
const handle = (v) => (v || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "").toLowerCase();

export async function importBookings() {
  const { bookings } = await api("GET", "/api/inbox");
  if (!bookings.length) return 0;
  await load();
  let added = 0;
  for (const { key, booking: b } of bookings) {
    if (doc.shoots.some((s) => s.bookingId === key)) continue;
    const email = (b.email || "").trim().toLowerCase();
    const phone = digits(b.phone);
    const ig = handle(b.instagram);
    let c = doc.clients.find((x) => email && emailsOf(x).includes(email))
      || doc.clients.find((x) => phone.length >= 7 && digits(x.phone) === phone)
      || doc.clients.find((x) => ig && handle(x.instagram) === ig);
    if (!c) {
      c = { id: newId(), name: b.name || "Website booking", email: EMAIL_RE.test(email) ? email : "", phone: b.phone || "", instagram: ig, cars: "",
        source: b.source || "Website booking form", notes: "", created: b.received || now() };
      doc.clients.push(c);
    } else {
      // Fill in what's missing; never overwrite what you've already entered.
      // The email they booked with opens their galleries, so it joins the client's list.
      if (EMAIL_RE.test(email) && !emailsOf(c).includes(email)) c.email = [...emailsOf(c), email].join("\n");
      if (!c.phone && b.phone) c.phone = b.phone;
      if (!c.instagram && ig) c.instagram = ig;
      if (!c.source && b.source) c.source = b.source;
    }
    if (b.car && !carsOf(c).some((x) => x.toLowerCase() === b.car.toLowerCase())) c.cars = [...carsOf(c), b.car].join("\n");

    const pkg = [b.type, (b.addons || []).length ? `add-ons: ${b.addons.join(", ")}` : ""].filter(Boolean).join(" + ");
    const s = { id: newId(), clientId: c.id, car: b.car || "", title: "", date: b.date || "", time: "", location: b.location || "",
      package: pkg, status: "inquiry", payment: "unpaid", amount: "", gallery: "", notes: b.message || "",
      created: b.received || now(), bookingId: key };
    doc.shoots.push(s);
    const summary = [
      "Booking request from the website.",
      b.type && `Shoot type: ${b.type}`, (b.addons || []).length && `Add-ons: ${b.addons.join(", ")}`,
      b.date && `Preferred date: ${day(b.date)}`, b.location && `Location: ${b.location}`,
      b.source && `Heard about you through: ${b.source}`, b.message && `\n${b.message}`,
    ].filter(Boolean).join("\n");
    doc.notes.push({ id: newId(), clientId: c.id, shootId: s.id, at: b.received || now(), kind: "message", text: summary });
    doc.tasks.push({ id: newId(), clientId: c.id, shootId: s.id, due: today(), text: `Reply to ${c.name.split(" ")[0]}'s booking request`, done: false, doneAt: "" });
    added++;
  }
  if (added) await save();
  // Only now that they're saved in the records, remove them from the bucket.
  await api("POST", "/api/inbox/done", { keys: bookings.map((x) => x.key) });
  return added;
}

// After a gallery is deleted, shoots no longer point at it.
export async function unlinkGallery(code) {
  await load();
  const linked = doc.shoots.filter((s) => s.gallery === code);
  if (!linked.length) return;
  for (const s of linked) s.gallery = "";
  await save();
}
export const clientById = (id) => doc && clientOf(id);
export const shootName = (s) => s.title || [clientOf(s.clientId)?.name, s.car].filter(Boolean).join(" · ") || "Untitled shoot";
const igUrl = (handle) => `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@/, ""))}/`;

export function emailHref(c, s, link, expires) {
  const to = emailsOf(c);
  const first = to.length > 1 ? "everyone" : (c.name || "").split(" ")[0] || "there";
  const what = s?.car ? `your ${s.car} shoot` : "your shoot";
  const open = s?.galleryBy === "email"
    ? (to.length > 1 ? "To open it, enter your email address (any of the ones this was sent to works).\n\n" : "To open it, enter your email address.\n\n")
    : s?.galleryPass ? `Password: ${s.galleryPass}\n\n` : "";
  const body = `Hi ${first},\n\nThe photos from ${what} are ready:\n${link}\n\n` + open +
    (expires ? `You can view and download them until ${day(expires)}.\n\n` : "") + "Thanks again!\nSpeed Of Photography";
  return `mailto:${to.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent("Your photos are ready")}&body=${encodeURIComponent(body)}`;
}
export const canEmail = (c) => emailsOf(c).length > 0;

// ---------- small pieces ----------

const pill = (status) => h("span", { class: `pill s-${status}` }, label(STATUS, status));

function shootRow(s, { withClient = true } = {}) {
  const c = clientOf(s.clientId);
  return h("a", { href: `#/shoots/${s.id}`, class: "row-link" },
    h("span", { class: "when" }, s.date ? weekday(s.date) : "No date"),
    h("span", { class: "what" },
      h("strong", {}, withClient ? c?.name || "No client" : s.car || shootName(s)),
      h("span", { class: "muted" }, withClient ? [s.car, s.location].filter(Boolean).join(" · ") : [s.title, s.location].filter(Boolean).join(" · "))),
    pill(s.status),
    h("span", { class: `pay pay-${s.payment}` }, label(PAYMENT, s.payment)));
}

function dueText(due) {
  if (!due) return "";
  if (due < today()) return `Overdue · ${day(due, false)}`;
  if (due === today()) return "Today";
  if (due === isoIn(1)) return "Tomorrow";
  return day(due, false);
}

function taskRow(t, rerender, { showWho = false } = {}) {
  const c = clientOf(t.clientId);
  const s = t.shootId && shootOf(t.shootId);
  return h("div", { class: "task" + (t.done ? " done" : "") + (!t.done && t.due && t.due < today() ? " late" : "") },
    h("input", { type: "checkbox", checked: t.done, "aria-label": `Done: ${t.text}`, onchange: async (e) => {
      t.done = e.target.checked;
      t.doneAt = t.done ? now() : "";
      if (await commit(t.done ? "Done." : "")) rerender();
    } }),
    h("span", { class: "task-text" }, t.text,
      showWho && c ? h("a", { href: s ? `#/shoots/${s.id}` : `#/clients/${c.id}`, class: "muted" }, ` · ${c.name}${s?.car ? `, ${s.car}` : ""}`) : null),
    h("span", { class: "task-due" }, t.done ? "" : dueText(t.due)),
    h("button", { type: "button", class: "x", title: "Delete", "aria-label": "Delete follow-up", onclick: async () => {
      doc.tasks = doc.tasks.filter((x) => x !== t);
      if (await commit()) rerender();
    } }, "×"));
}

// Follow-ups for one client or one shoot.
function tasksBlock({ clientId, shootId }) {
  const box = h("section", { class: "panel" });
  function render() {
    const list = doc.tasks.filter((t) => (shootId ? t.shootId === shootId : t.clientId === clientId))
      .sort((a, b) => a.done - b.done || (a.due || "9999").localeCompare(b.due || "9999"));
    const text = h("input", { name: "text", required: true, maxlength: "500", placeholder: "e.g. Send the gallery link" });
    const form = busyForm(h("form", { class: "add-row", autocomplete: "off" },
      text, h("input", { name: "due", type: "date", value: isoIn(3), "aria-label": "Due" }),
      h("button", { type: "submit", class: "btn btn-line small" }, "Add")), async (d) => {
      doc.tasks.push({ id: newId(), clientId, shootId: shootId || "", due: d.get("due") || "", text: d.get("text").trim(), done: false, doneAt: "" });
      await save();
      render();
      box.querySelector("input[name=text]").focus();
    });
    box.replaceChildren(h("h2", {}, "Follow-ups"),
      list.length ? h("div", { class: "tasks" }, list.map((t) => taskRow(t, render))) : h("p", { class: "muted" }, "Nothing to follow up."),
      form);
  }
  render();
  return box;
}

// Notes and contact history for one client (all of it) or one shoot.
function notesBlock({ clientId, shootId }) {
  const box = h("section", { class: "panel" });
  function render() {
    const list = doc.notes.filter((n) => (shootId ? n.shootId === shootId : n.clientId === clientId)).sort((a, b) => b.at.localeCompare(a.at));
    const form = busyForm(h("form", { class: "note-form", autocomplete: "off" },
      h("div", { class: "add-row" }, select("kind", KINDS, "note", { "aria-label": "Kind" }),
        h("button", { type: "submit", class: "btn btn-line small" }, "Add")),
      h("textarea", { name: "text", rows: "2", required: true, maxlength: "5000", placeholder: "What was said, what they want, anything worth remembering" })),
    async (d) => {
      doc.notes.push({ id: newId(), clientId, shootId: shootId || "", at: now(), kind: d.get("kind"), text: d.get("text").trim() });
      await save();
      render();
    });
    box.replaceChildren(h("h2", {}, "Notes"), form,
      list.length ? h("ol", { class: "timeline" }, list.map((n) => {
        const s = !shootId && n.shootId && shootOf(n.shootId);
        return h("li", {},
          h("div", { class: "muted small" }, `${label(KINDS, n.kind)} · ${new Date(n.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
            s ? h("a", { href: `#/shoots/${s.id}` }, ` · ${s.car || shootName(s)}`) : null,
            h("button", { type: "button", class: "x", "aria-label": "Delete note", onclick: async () => {
              if (!confirm("Delete this note?")) return;
              doc.notes = doc.notes.filter((x) => x !== n);
              if (await commit()) render();
            } }, "×")),
          h("p", { class: "note-text" }, n.text));
      })) : h("p", { class: "muted" }, "No notes yet."));
  }
  render();
  return box;
}

// ---------- Today ----------

export async function todayScreen(loadAlbums) {
  await load();
  const t = today();
  const soon = isoIn(7);
  const section = (title, items, empty) => h("section", { class: "panel" }, h("h2", {}, title),
    items.length ? h("div", { class: "rows" }, items) : h("p", { class: "muted" }, empty));

  const render = () => {
    const tasks = doc.tasks.filter((x) => !x.done && (!x.due || x.due <= soon)).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const upcoming = doc.shoots.filter((s) => ["inquiry", "booked"].includes(s.status) && (!s.date || s.date >= t)).sort(byDate);
    const stale = doc.shoots.filter((s) => ["inquiry", "booked"].includes(s.status) && s.date && s.date < t).sort(byDate);
    const editing = doc.shoots.filter((s) => ["shot", "editing"].includes(s.status)).sort(byDate);
    const unpaid = doc.shoots.filter((s) => s.status === "delivered" && s.payment !== "paid").sort(byDate);

    show(
      h("div", { class: "head" }, h("div", {}, h("h1", {}, "Today"), h("p", { class: "muted" }, weekday(t))),
        h("div", { class: "row" }, h("a", { href: "#/clients/new", class: "btn btn-line" }, "New client"), h("a", { href: "#/shoots/new", class: "btn btn-primary" }, "New shoot"))),
      !doc.clients.length ? h("section", { class: "panel" }, h("h2", {}, "Start here"),
        h("p", { class: "muted" }, "Add a client, then a shoot for them. Each shoot moves from inquiry to delivered, and can have its gallery made in one click.")) : null,
      h("div", { class: "cols" },
        h("div", {},
          h("section", { class: "panel" }, h("h2", {}, "Follow-ups this week"),
            tasks.length ? h("div", { class: "tasks" }, tasks.map((x) => taskRow(x, render, { showWho: true }))) : h("p", { class: "muted" }, "Nothing due this week.")),
          stale.length ? section("Needs an update", stale.map((s) => h("div", { class: "row-with-action" }, shootRow(s),
            h("button", { type: "button", class: "btn btn-line small", onclick: async () => {
              s.status = s.status === "inquiry" ? "cancelled" : "shot";
              if (await commit(`Marked ${label(STATUS, s.status).toLowerCase()}.`)) render();
            } }, s.status === "inquiry" ? "Didn't book" : "Mark shot"))), "") : null,
          section("Coming up", upcoming.map((s) => shootRow(s)), "No shoots booked."),
        ),
        h("div", {},
          section("To edit and deliver", editing.map((s) => shootRow(s)), "Nothing waiting."),
          section("Delivered, not paid", unpaid.map((s) => shootRow(s)), "All paid up."),
          closing)));
  };
  const closing = h("section", { class: "panel" }, h("h2", {}, "Galleries closing soon"), h("p", { class: "muted" }, "Checking…"));
  render();
  try {
    const albums = (await loadAlbums()).filter((a) => !a.expired && a.expires && a.expires <= isoIn(14)).sort((a, b) => a.expires.localeCompare(b.expires));
    closing.replaceChildren(h("h2", {}, "Galleries closing soon"), albums.length
      ? h("div", { class: "rows" }, albums.map((a) => h("a", { href: `#/g/${a.code}`, class: "row-link" },
        h("span", { class: "when" }, day(a.expires, false)), h("span", { class: "what" }, h("strong", {}, a.title || a.code), h("span", { class: "muted" }, a.client || "")))))
      : h("p", { class: "muted" }, "None in the next two weeks."));
  } catch (e) {
    if (!(e instanceof Locked)) closing.replaceChildren(h("h2", {}, "Galleries closing soon"), h("p", { class: "muted" }, e.message));
  }
}

// ---------- clients ----------

export async function clientsScreen() {
  await load();
  const search = h("input", { type: "search", placeholder: "Search name, car, email, phone or Instagram", "aria-label": "Search clients" });
  const list = h("div", { class: "rows" });
  const lastShoot = (c) => shootsOf(c.id)[0];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const rows = doc.clients
      .filter((c) => !q || [c.name, c.email, c.phone, c.instagram, c.cars].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...(rows.length ? rows.map((c) => {
      const last = lastShoot(c);
      return h("a", { href: `#/clients/${c.id}`, class: "row-link client-row" },
        h("span", { class: "what" }, h("strong", {}, c.name), h("span", { class: "muted" }, carsOf(c).join(", "))),
        h("span", { class: "muted" }, c.instagram ? `@${c.instagram.replace(/^@/, "")}` : emailsOf(c)[0] || c.phone),
        h("span", { class: "muted" }, last ? `Last shoot ${day(last.date)}` : "No shoots yet"));
    }) : [h("p", { class: "muted" }, doc.clients.length ? "No one matches." : "No clients yet.")]));
  };
  search.addEventListener("input", render);
  show(h("div", { class: "head" }, h("h1", {}, "Clients"),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn btn-line", onclick: exportCsv }, "Export CSV"),
      h("a", { href: "#/clients/new", class: "btn btn-primary" }, "New client"))),
  search, list);
  render();
  search.focus();
}

export async function clientForm(id, then) {
  await load();
  const c = id ? clientOf(id) : null;
  if (id && !c) return go("#/clients");
  const v = c || {};
  const form = busyForm(h("form", { class: "panel narrow", autocomplete: "off" },
    h("h1", {}, c ? "Edit client" : "New client"),
    field("Name", h("input", { name: "name", maxlength: "120", value: v.name || "" })),
    field("Emails", h("textarea", { name: "email", rows: "2", maxlength: "6000", spellcheck: "false", autocapitalize: "off" }, emailsOf(v).join("\n") || v.email || ""),
      "One per line. For a group, add everyone's: any of these emails opens their galleries."),
    field("Phone", h("input", { name: "phone", type: "tel", maxlength: "60", value: v.phone || "" })),
    field("Instagram", h("input", { name: "instagram", maxlength: "80", value: v.instagram || "", placeholder: "@handle" })),
    field("Cars", h("textarea", { name: "cars", rows: "2", maxlength: "1000" }, v.cars || ""), "One per line."),
    field("How they found you", suggest(h("input", { name: "source", maxlength: "60", value: v.source || "" }),
      [...SOURCES, ...doc.clients.map((x) => x.source)])),
    field("Notes", h("textarea", { name: "notes", rows: "3", maxlength: "5000" }, v.notes || ""), "Anything to keep in mind about this person."),
    h("div", { class: "row" }, h("button", { type: "submit", class: "btn btn-primary" }, c ? "Save" : "Add client"),
      h("a", { href: c ? `#/clients/${c.id}` : "#/clients", class: "btn btn-line" }, "Cancel"))),
  async (d) => {
    const data = Object.fromEntries([...d].map(([k, x]) => [k, String(x).trim()]));
    if (!data.name) data.name = c?.name || "Unnamed client";
    data.instagram = data.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
    const bad = splitEmails(data.email).filter((e) => !EMAIL_RE.test(e));
    if (bad.length) throw new Error(`${bad.join(", ")} ${bad.length > 1 ? "don't" : "doesn't"} look like an email. Put one email on each line.`);
    data.email = emailsOf(data).join("\n");
    const before = emailsOf(c).join("\n");
    const target = c || { id: newId(), created: now() };
    Object.assign(target, data);
    if (!c) doc.clients.push(target);
    await save();
    const synced = c && before !== data.email ? await syncGalleryEmails(target) : "";
    toast(synced || (c ? "Saved." : "Client added."), synced.startsWith("Saved, but"));
    go(then === "shoot" ? `#/shoots/new?client=${target.id}` : then === "gallery" ? `#/galleries/new?client=${target.id}` : `#/clients/${target.id}`);
  });
  show(back(c ? `#/clients/${c.id}` : "#/clients", c ? c.name : "Clients"), form);
  form.querySelector("input").focus();
}

export async function clientScreen(id) {
  await load();
  const c = clientOf(id);
  if (!c) return show(back("#/clients", "Clients"), h("p", { class: "muted" }, "That client isn't in your records."));
  const shoots = shootsOf(c.id);
  const contact = [
    ...emailsOf(c).map((e) => h("a", { href: `mailto:${e}` }, e)),
    c.phone && h("a", { href: `tel:${c.phone.replace(/[^\d+]/g, "")}` }, c.phone),
    c.instagram && h("a", { href: igUrl(c.instagram), target: "_blank", rel: "noopener" }, `@${c.instagram}`),
  ].filter(Boolean);
  show(
    back("#/clients", "Clients"),
    h("div", { class: "head" }, h("h1", {}, c.name),
      h("div", { class: "row" }, h("a", { href: `#/clients/${c.id}/edit`, class: "btn btn-line" }, "Edit"),
        h("a", { href: `#/shoots/new?client=${c.id}`, class: "btn btn-primary" }, "New shoot"))),
    h("p", { class: "contact" }, contact.length ? contact.flatMap((x, i) => (i ? [" · ", x] : [x])) : h("span", { class: "muted" }, "No contact details yet.")),
    h("p", { class: "muted" }, [carsOf(c).join(", "), c.source && `Found you through ${c.source}`, c.created && `Client since ${day(c.created)}`].filter(Boolean).join(" · ")),
    c.notes ? h("p", { class: "note-text client-notes" }, c.notes) : null,
    h("div", { class: "cols" },
      h("div", {},
        h("section", { class: "panel" }, h("h2", {}, "Shoots"),
          shoots.length ? h("div", { class: "rows" }, shoots.map((s) => shootRow(s, { withClient: false }))) : h("p", { class: "muted" }, "No shoots yet.")),
        tasksBlock({ clientId: c.id })),
      h("div", {}, notesBlock({ clientId: c.id }))),
    h("section", { class: "panel danger" }, h("h2", {}, "Delete client"),
      h("p", { class: "muted" }, "Removes this client with their shoots, notes and follow-ups. Their galleries stay online until you delete them."),
      h("button", { type: "button", class: "btn btn-line", onclick: async () => {
        if (prompt(`To delete ${c.name} and their records, type DELETE.`) !== "DELETE") return;
        const ids = new Set(shoots.map((s) => s.id));
        doc.clients = doc.clients.filter((x) => x !== c);
        doc.shoots = doc.shoots.filter((s) => !ids.has(s.id));
        doc.notes = doc.notes.filter((n) => n.clientId !== c.id);
        doc.tasks = doc.tasks.filter((t) => t.clientId !== c.id);
        if (await commit("Client deleted.")) go("#/clients");
      } }, "Delete client")));
}

function exportCsv() {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const rows = [["Name", "Email", "Phone", "Instagram", "Cars", "Found you through", "Shoots", "Last shoot", "Notes"]];
  for (const c of [...doc.clients].sort((a, b) => a.name.localeCompare(b.name))) {
    const s = shootsOf(c.id);
    rows.push([c.name, emailsOf(c).join("; "), c.phone, c.instagram, carsOf(c).join("; "), c.source, s.length, s[0]?.date || "", c.notes]);
  }
  const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `SOP clients ${today()}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- shoots ----------

export async function shootsScreen(filter = "active") {
  await load();
  const groups = [["active", "Active"], ...STATUS, ["all", "All"]];
  const pick = (f) => doc.shoots.filter((s) => f === "all" || (f === "active" ? !["delivered", "cancelled"].includes(s.status) : s.status === f));
  const list = pick(filter).sort(["active", "inquiry", "booked"].includes(filter) ? byDate : byDateDesc);
  show(
    h("div", { class: "head" }, h("h1", {}, "Shoots"), h("a", { href: "#/shoots/new", class: "btn btn-primary" }, "New shoot")),
    h("nav", { class: "chips", "aria-label": "Filter shoots" }, groups.map(([f, name]) =>
      h("a", { href: `#/shoots?status=${f}`, class: "chip", "aria-current": f === filter ? "true" : null }, `${name} ${pick(f).length}`))),
    list.length ? h("div", { class: "rows" }, list.map((s) => shootRow(s))) : h("p", { class: "muted" }, "No shoots here."));
}

export async function shootForm(id, presetClient) {
  await load();
  const s = id ? shootOf(id) : null;
  if (id && !s) return go("#/shoots");
  const v = s || { clientId: presetClient || "", status: "inquiry", payment: "unpaid" };
  const clients = [...doc.clients].sort((a, b) => a.name.localeCompare(b.name));
  const clientSel = select("clientId", [["", "No client"], ...clients.map((c) => [c.id, c.name])], v.clientId);
  const carInput = h("input", { name: "car", maxlength: "120", value: v.car || "" });
  const carList = h("datalist", { id: "car-list" });
  carInput.setAttribute("list", "car-list");
  const fillCars = () => carList.replaceChildren(...carsOf(clientOf(clientSel.value)).map((x) => h("option", { value: x })));
  clientSel.addEventListener("change", () => { fillCars(); if (!carInput.value) carInput.value = carsOf(clientOf(clientSel.value))[0] || ""; });
  fillCars();
  if (!s && !carInput.value) carInput.value = carsOf(clientOf(clientSel.value))[0] || "";

  const form = busyForm(h("form", { class: "panel narrow", autocomplete: "off" },
    h("h1", {}, s ? "Edit shoot" : "New shoot"),
    field("Client", clientSel, h("span", {}, "Not listed? ", h("a", { href: "#/clients/new?then=shoot" }, "Add a new client"), ".")),
    field("Car", [carInput, carList]),
    field("Title", h("input", { name: "title", maxlength: "160", value: v.title || "" }), "Optional, e.g. \"Canyon run\"."),
    h("div", { class: "pair" },
      field("Date", h("input", { name: "date", type: "date", value: v.date || "" })),
      field("Time", h("input", { name: "time", type: "time", value: v.time || "" }))),
    field("Location", suggest(h("input", { name: "location", maxlength: "200", value: v.location || "" }), doc.shoots.map((x) => x.location))),
    field("Package", suggest(h("input", { name: "package", maxlength: "120", value: v.package || "" }), doc.shoots.map((x) => x.package))),
    h("div", { class: "pair" },
      field("Stage", select("status", STATUS, v.status)),
      field("Payment", select("payment", PAYMENT, v.payment))),
    field("Amount", h("input", { name: "amount", maxlength: "40", value: v.amount || "", inputmode: "decimal" }), "Optional. Only you see this."),
    field("Notes", h("textarea", { name: "notes", rows: "3", maxlength: "5000" }, v.notes || ""), "Shot list, meeting spot, anything for the day."),
    h("div", { class: "row" }, h("button", { type: "submit", class: "btn btn-primary" }, s ? "Save" : "Add shoot"),
      h("a", { href: s ? `#/shoots/${s.id}` : "#/shoots", class: "btn btn-line" }, "Cancel"))),
  async (d) => {
    const data = Object.fromEntries([...d].map(([k, x]) => [k, String(x).trim()]));
    if (!clientOf(data.clientId)) data.clientId = "";
    const target = s || { id: newId(), created: now(), gallery: "" };
    Object.assign(target, data);
    if (!s) doc.shoots.push(target);
    // Remember a new car on the client too.
    const c = clientOf(data.clientId);
    if (c && data.car && !carsOf(c).some((x) => x.toLowerCase() === data.car.toLowerCase())) c.cars = [...carsOf(c), data.car].join("\n");
    await save();
    toast(s ? "Saved." : "Shoot added.");
    go(`#/shoots/${target.id}`);
  });
  show(back(s ? `#/shoots/${s.id}` : "#/shoots", s ? shootName(s) : "Shoots"), form);
}

export async function shootScreen(id, { createGallery, loadAlbums }) {
  await load();
  const s = shootOf(id);
  if (!s) return show(back("#/shoots", "Shoots"), h("p", { class: "muted" }, "That shoot isn't in your records."));
  const c = clientOf(s.clientId);
  const next = NEXT[s.status];
  const facts = [
    ["Date", s.date ? `${weekday(s.date)}${s.time ? `, ${s.time}` : ""}` : "Not set"],
    ["Location", s.location || "Not set"],
    ["Package", s.package || "Not set"],
    ["Payment", `${label(PAYMENT, s.payment)}${s.amount ? ` · ${s.amount}` : ""}`],
  ];
  if (s.bookingId) facts.push(["Came in", `Website booking form, ${day(s.created)}`]);
  show(
    back("#/shoots", "Shoots"),
    h("div", { class: "head" }, h("div", {}, h("h1", {}, s.car || shootName(s)),
      h("p", { class: "muted" }, c ? h("a", { href: `#/clients/${c.id}` }, c.name) : "No client", s.title && s.car ? ` · ${s.title}` : "")),
    h("div", { class: "row" }, pill(s.status),
      next ? h("button", { type: "button", class: "btn btn-primary small", onclick: async () => {
        s.status = next;
        if (await commit(`Marked ${label(STATUS, next).toLowerCase()}.`)) shootScreen(id, { createGallery, loadAlbums });
      } }, `Mark ${label(STATUS, next).toLowerCase()}`) : null,
      h("a", { href: `#/shoots/${s.id}/edit`, class: "btn btn-line small" }, "Edit"))),
    h("dl", { class: "facts" }, facts.flatMap(([k, x]) => [h("dt", {}, k), h("dd", {}, x)])),
    s.notes ? h("p", { class: "note-text client-notes" }, s.notes) : null,
    galleryPanel(s, c, { createGallery, loadAlbums, refresh: () => shootScreen(id, { createGallery, loadAlbums }) }),
    h("div", { class: "cols" }, h("div", {}, tasksBlock({ clientId: s.clientId, shootId: s.id })), h("div", {}, notesBlock({ clientId: s.clientId, shootId: s.id }))),
    h("section", { class: "panel danger" }, h("h2", {}, "Delete shoot"),
      h("p", { class: "muted" }, "Removes the shoot with its notes and follow-ups. Its gallery stays until you delete it."),
      h("button", { type: "button", class: "btn btn-line", onclick: async () => {
        if (!confirm("Delete this shoot? This can't be undone.")) return;
        doc.shoots = doc.shoots.filter((x) => x !== s);
        doc.notes = doc.notes.filter((n) => n.shootId !== s.id);
        doc.tasks = doc.tasks.filter((t) => t.shootId !== s.id);
        if (await commit("Shoot deleted.")) go(c ? `#/clients/${c.id}` : "#/shoots");
      } }, "Delete shoot")));
}

function galleryPanel(s, c, { createGallery, loadAlbums, refresh }) {
  const box = h("section", { class: "panel" }, h("h2", {}, "Gallery"));
  if (s.gallery) {
    const link = `https://speedofphotography.com/g/${s.gallery}/`;
    box.append(
      h("div", { class: "link-row" }, h("code", {}, link),
        h("button", { type: "button", class: "btn btn-primary small", onclick: () => copy(link) }, "Copy link"),
        canEmail(c) ? h("a", { class: "btn btn-line small", href: emailHref(c, s, link) }, "Email link") : null,
        h("a", { href: `#/g/${s.gallery}`, class: "btn btn-line small" }, "Manage photos")),
      s.galleryBy === "email" ? h("p", { class: "muted" }, emailsOf(c).length > 1 ? "Opens with any of: " : "Opens with: ",
        h("code", {}, emailsOf(c).join(", ") || "the client's email")) : null,
      s.galleryBy !== "email" && s.galleryPass ? h("p", { class: "muted" }, "Password: ", h("code", {}, s.galleryPass), " ",
        h("button", { type: "button", class: "linkish", onclick: () => copy(s.galleryPass, "Password") }, "Copy")) : null,
      h("button", { type: "button", class: "linkish", onclick: async () => {
        if (!confirm("Unlink this gallery from the shoot? The gallery itself stays.")) return;
        s.gallery = "";
        if (await commit("Unlinked.")) refresh();
      } }, "Unlink gallery"));
    return box;
  }
  const make = c ? h("a", { href: `#/galleries/new?shoot=${s.id}`, class: "btn btn-primary" }, "Create gallery for this shoot")
    : h("p", { class: "muted" }, "Pick a client for this shoot first (Edit) to make its gallery.");
  const pickBox = h("div", { class: "add-row" });
  box.append(h("p", { class: "muted" }, "No gallery yet. Make one when the edits are ready; the link, title and date are filled in from this shoot."),
    h("div", { class: "row" }, make), pickBox);
  loadAlbums().then((albums) => {
    const used = new Set(doc.shoots.map((x) => x.gallery).filter(Boolean));
    const free = albums.filter((a) => !used.has(a.code));
    if (!free.length) return;
    const sel = select("code", free.map((a) => [a.code, `${a.title || a.code}${a.date ? ` (${day(a.date)})` : ""}`]), "", { "aria-label": "Existing gallery" });
    pickBox.replaceChildren(h("span", { class: "muted" }, "Or link one you already made:"), sel,
      h("button", { type: "button", class: "btn btn-line small", onclick: async () => {
        s.gallery = sel.value;
        if (await commit("Gallery linked.")) refresh();
      } }, "Link"));
  }).catch(() => {});
  return box;
}

// ---------- new gallery ----------
// Every new gallery is for a client in your records and is linked to one of their shoots: one picked here, or a new
// shoot made with it. It opens with the client's email (any of them, for a group) unless you untick the box.

// After a client's emails change, every gallery of theirs that opens by email takes the new list. (Galleries left
// open, and older ones with their own password, stay as they are.) Returns a message for the toast.
export async function syncGalleryEmails(c) {
  const emails = emailsOf(c);
  const codes = [...new Set(shootsOf(c.id).map((s) => s.gallery).filter(Boolean))];
  if (!codes.length) return "";
  if (!emails.length) return "Saved, but with no email left, their galleries still open with the old ones. Add an email to change that.";
  let changed = 0, failed = 0;
  for (const code of codes) {
    try {
      const r = await api("PUT", `/api/albums/${encodeURIComponent(code)}/password`, { emails, onlyIfEmail: true });
      if (r.changed) changed++;
    } catch (e) { if (e instanceof Locked) throw e; failed++; }
  }
  if (failed) return `Saved, but ${failed === 1 ? "1 gallery" : `${failed} galleries`} couldn't be updated with the new emails. Open it and use "Use the client's emails".`;
  return changed ? `Saved. ${changed === 1 ? "1 gallery opens" : `${changed} galleries open`} with these emails now.` : "";
}

// The "opens with their email" box on the new-gallery form. On by default; untick to leave the gallery open.
function emailLockBox() {
  const box = h("input", { type: "checkbox", checked: true });
  const who = h("small", {});
  let client = null;
  const sync = () => {
    const list = emailsOf(client);
    who.replaceChildren(!box.checked ? "Anyone with the link can open it."
      : !client ? "Pick a client first."
      : list.length > 1 ? `Any of these works: ${list.join(", ")}.`
      : list.length ? `Their email: ${list[0]}.`
      : h("span", { class: "warn" }, `${client.name} has no email in your records yet. Add one (Edit client), or untick the box.`));
  };
  box.addEventListener("change", sync);
  return {
    el: h("div", { class: "field" }, h("span", {}, "Password"),
      h("label", { class: "check" }, box, " Clients open it with their email (the one they booked with)"), who),
    setClient: (c) => { client = c; sync(); },
    open: () => {
      if (!box.checked) return true;
      if (!emailsOf(client).length) throw new Error(`${client?.name || "This client"} has no email in your records yet. Add one (Edit client), or untick the box to leave the gallery open.`);
      return false;
    },
  };
}

export async function galleryForm(q, { createGallery, lengthField }) {
  await load();
  const preShoot = shootOf(q.get("shoot") || "");
  if (preShoot?.gallery) return go(`#/g/${preShoot.gallery}`);
  const clients = [...doc.clients].sort((a, b) => a.name.localeCompare(b.name));
  if (!clients.length) {
    return show(back("#/galleries", "Galleries"), h("section", { class: "panel narrow" }, h("h1", {}, "New gallery"),
      h("p", {}, "Every gallery is for a client in your records, and you don't have any yet."),
      h("a", { href: "#/clients/new?then=gallery", class: "btn btn-primary" }, "Add a client")));
  }
  const clientSel = select("clientId", [["", "Pick a client…"], ...clients.map((c) => [c.id, c.name])],
    preShoot?.clientId || q.get("client") || "", { required: true });
  const shootSel = h("select", { name: "shootId", "aria-label": "Shoot" });
  const carInput = h("input", { name: "car", maxlength: "120" });
  const carList = h("datalist", { id: "gallery-car-list" });
  carInput.setAttribute("list", "gallery-car-list");
  const dateInput = h("input", { name: "date", type: "date", value: preShoot?.date || today() });
  const length = lengthField(galleryDays());
  const pass = emailLockBox();

  // The client's shoots that don't have a gallery yet; the newest one that's been shot is picked to start with.
  function fillShoots() {
    const c = clientOf(clientSel.value);
    const open = c ? shootsOf(c.id).filter((s) => !s.gallery && s.status !== "cancelled") : [];
    shootSel.replaceChildren(...open.map((s) => h("option", { value: s.id }, `${s.car || shootName(s)}${s.date ? ` (${day(s.date)})` : ""}`)),
      h("option", { value: "new" }, "New shoot (made with this gallery)"));
    const pick = preShoot && open.includes(preShoot) ? preShoot : open.find((s) => ["shot", "editing"].includes(s.status));
    shootSel.value = pick ? pick.id : "new";
    carList.replaceChildren(...carsOf(c).map((x) => h("option", { value: x })));
    pass.setClient(c);
    fillFromShoot();
  }
  function fillFromShoot() {
    const s = shootOf(shootSel.value);
    const c = clientOf(clientSel.value);
    carInput.value = s?.car || carsOf(c)[0] || "";
    if (s?.date) dateInput.value = s.date;
  }
  clientSel.addEventListener("change", fillShoots);
  shootSel.addEventListener("change", fillFromShoot);
  fillShoots();

  const form = busyForm(h("form", { class: "panel narrow", autocomplete: "off" },
    h("h1", {}, "New gallery"),
    field("Client", clientSel, h("span", {}, "Not listed? ", h("a", { href: "#/clients/new?then=gallery" }, "Add a new client"), ".")),
    field("Shoot", shootSel, "The gallery is linked to this shoot in your records."),
    field("Car", [carInput, carList], "Goes into the link and the default title."),
    field("Title", h("input", { name: "title", maxlength: "120" }), "Leave blank for \"Client's Car\"."),
    field("Shoot date", dateInput),
    length.el,
    pass.el,
    field("Note to the client", h("textarea", { name: "message", rows: "3", maxlength: "2000" },
      "Thanks for a great shoot! Let me know if you'd like any extra edits.")),
    h("button", { type: "submit", class: "btn btn-primary" }, "Create gallery")),
  async (d) => {
    const c = clientOf(clientSel.value);
    if (!c) throw new Error("Pick a client for this gallery.");
    const open = pass.open();
    const car = carInput.value.trim();
    const date = dateInput.value;
    const code = await createGallery({
      clientId: c.id, client: c.name, car, date, expires: length.end(),
      title: String(d.get("title") || "").trim() || (car ? `${c.name}'s ${car}` : `${c.name}'s photos`),
      message: String(d.get("message") || ""), open,
    });
    let s = shootOf(shootSel.value);
    if (!s) {
      s = { id: newId(), created: now(), clientId: c.id, car, title: "", date, time: "", location: "", package: "",
        status: "editing", payment: "unpaid", amount: "", notes: "", gallery: "" };
      doc.shoots.push(s);
    } else if (["inquiry", "booked", "shot"].includes(s.status)) s.status = "editing";
    s.gallery = code;
    s.galleryPass = "";
    s.galleryBy = open ? "" : "email";
    if (car && !carsOf(c).some((x) => x.toLowerCase() === car.toLowerCase())) c.cars = [...carsOf(c), car].join("\n");
    try { await save(); }
    catch (e) { if (!(e instanceof Locked)) toast(`Gallery made, but linking it to the shoot didn't save: ${e.message}`, true); }
    go(`#/g/${code}`);
  });
  show(back(preShoot ? `#/shoots/${preShoot.id}` : "#/galleries", preShoot ? shootName(preShoot) : "Galleries"), form);
}

// After a gallery's lock changes in Studio, the shoot it belongs to remembers how it opens now.
export async function setGalleryLock(code, by) {
  await load();
  const s = doc.shoots.find((x) => x.gallery === code);
  if (!s || ((s.galleryBy || "") === by && !s.galleryPass)) return;
  s.galleryBy = by;
  s.galleryPass = "";
  await save();
}
