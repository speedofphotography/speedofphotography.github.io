// Shared bits for the Studio pages.
export const app = document.getElementById("app");
export const info = { setup: false, signedIn: false, site: "", bucket: "" };
export const hooks = { locked() {} };

// Builds elements without innerHTML, so names and messages always show as plain text.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value" && tag === "select") continue; // set once the options exist (below)
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  if (tag === "select" && attrs && attrs.value != null) el.value = attrs.value;
  return el;
}

export function show(...kids) {
  app.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  window.scrollTo(0, 0);
}

const toastEl = document.getElementById("toast");
let toastTimer;
export function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.className = "on" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ""), 4000);
}

export class Locked extends Error {}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "x-studio": "1", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !["/api/login", "/api/setup", "/api/passphrase"].includes(path)) {
    info.signedIn = false;
    hooks.locked();
    throw new Locked("Locked");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status, data });
  return data;
}

export const enc = encodeURIComponent;
export const fileUrl = (code, name, thumb) => `/api/albums/${enc(code)}/files/${enc(name)}${thumb ? "?thumb=1" : ""}`;

export function size(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
export function day(iso, withYear = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const opts = { month: "short", day: "numeric" };
  if (withYear) opts.year = "numeric";
  // A full timestamp ("…T…Z") is shown in local time; a plain date is shown as written.
  const when = iso.length > 10 && iso.includes("T") ? new Date(iso) : new Date(+m[1], m[2] - 1, +m[3]);
  return when.toLocaleDateString(undefined, opts);
}
export function weekday(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
}
export function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function copy(textValue, what = "Link") {
  try { await navigator.clipboard.writeText(textValue); toast(`${what} copied.`); }
  catch { prompt("Copy this:", textValue); }
}

export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
}

export function select(name, options, value, attrs = {}) {
  const el = h("select", { name, ...attrs }, options.map(([v, label]) => h("option", { value: v }, label)));
  el.value = value ?? options[0]?.[0] ?? "";
  return el;
}

// A list of earlier answers the browser offers while typing.
let listCount = 0;
export function suggest(input, values) {
  const id = `list-${++listCount}`;
  input.setAttribute("list", id);
  return [input, h("datalist", { id }, [...new Set(values.filter(Boolean))].sort().map((v) => h("option", { value: v })))];
}

// Runs a form's async action with the button busy and errors shown under the form.
export function busyForm(form, action) {
  const err = h("p", { class: "form-error", role: "alert", hidden: true });
  form.append(err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    err.hidden = true;
    try { await action(new FormData(form)); }
    catch (ex) { if (!(ex instanceof Locked)) { err.textContent = ex.message; err.hidden = false; } }
    finally { if (btn) btn.disabled = false; }
  });
  return form;
}

export const back = (href, label) => h("p", {}, h("a", { href, class: "back" }, `← ${label}`));
export const go = (hash) => { location.hash = hash; };
