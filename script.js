// Shared by every page; sections that aren't on the current page are skipped.
const form = document.getElementById("contact-form");
// The address the contact form sends inquiries to (set in the content file, read from the form).
const CONTACT_EMAIL = form ? form.dataset.email : "";
// FormSubmit (formsubmit.co) emails each booking to CONTACT_EMAIL. No account needed:
// the very first submission sends an "Activate" email to that inbox, which must be clicked once.
const FORM_ENDPOINT = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`;

document.getElementById("year").textContent = new Date().getFullYear();

// ---------- Header background on scroll ----------
const header = document.querySelector(".site-header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- Mobile menu ----------
const toggle = document.querySelector(".nav-toggle");
const links = document.getElementById("nav-links");

function setMenu(open) {
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  links.classList.toggle("is-open", open);
  header.classList.toggle("menu-open", open);
}
toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

// ---------- Gallery filters ----------
const shots = [...document.querySelectorAll(".shot")];
document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    const cat = btn.dataset.filter;
    shots.forEach((s) => s.classList.toggle("is-hidden", cat !== "all" && s.dataset.cat !== cat));
  });
});

// ---------- Lightbox ----------
const lightbox = document.getElementById("lightbox");
if (lightbox) {
const lbImg = lightbox.querySelector(".lightbox-img");
const lbCaption = lightbox.querySelector(".lightbox-caption");
let current = 0;

const visibleShots = () => shots.filter((s) => !s.classList.contains("is-hidden"));

function show(index) {
  const list = visibleShots();
  current = (index + list.length) % list.length;
  const shot = list[current];
  const caption = shot.querySelector("figcaption").textContent;
  lbImg.style.backgroundImage = getComputedStyle(shot).backgroundImage;
  lbImg.setAttribute("aria-label", caption);
  lbCaption.textContent = caption;
}

function openLightbox(shot) {
  show(visibleShots().indexOf(shot));
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  lightbox.querySelector(".lightbox-close").focus();
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
  visibleShots()[current]?.focus();
}

shots.forEach((shot) => {
  shot.tabIndex = 0;
  shot.setAttribute("role", "button");
  shot.addEventListener("click", () => openLightbox(shot));
  shot.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox(shot);
    }
  });
});

lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightbox.querySelector(".lightbox-prev").addEventListener("click", () => show(current - 1));
lightbox.querySelector(".lightbox-next").addEventListener("click", () => show(current + 1));
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") show(current - 1);
  if (e.key === "ArrowRight") show(current + 1);
});
}

// ---------- Old links to the home page's booking section now go to the Packages page ----------
if (!form && location.hash === "#contact") {
  location.replace(document.querySelector(".logo").getAttribute("href") + "packages/#book");
}

// ---------- Contact form (emails each booking to CONTACT_EMAIL) ----------
if (form) {
// "Book this package" links arrive as /?package=Name#contact: preselect that shoot type.
const requested = new URLSearchParams(location.search).get("package");
if (requested) {
  const opt = [...form.type.options].find((o) => o.value.toLowerCase() === requested.toLowerCase());
  if (opt) form.type.value = opt.value;
}

// "Book this package" buttons on the same page: pick the package and scroll down without reloading.
document.querySelectorAll("[data-package]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const opt = [...form.type.options].find((o) => o.value.toLowerCase() === btn.dataset.package.toLowerCase());
    if (!opt) return; // let the link navigate normally
    e.preventDefault();
    form.type.value = opt.value;
    history.replaceState(null, "", btn.getAttribute("href"));
    document.getElementById("book").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => form.name.focus({ preventScroll: true }), 600);
  });
});

const submitBtn = form.querySelector('button[type="submit"]');
const statusEl = document.getElementById("form-status");

function setStatus(kind, html) {
  statusEl.className = `form-status is-${kind}`;
  statusEl.innerHTML = html;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  if (data.get("_honey")) return; // filled in by spam bots only

  const subject = `New shoot booking: ${data.get("type")}${data.get("car") ? " - " + data.get("car") : ""}`;
  const payload = {
    name: data.get("name"),
    email: data.get("email"),
    car: data.get("car") || "Not given",
    shoot_type: data.get("type"),
    add_ons: data.getAll("addons").join(", ") || "None",
    details: data.get("message") || "None",
    _subject: subject,
    _template: "table",
    _replyto: data.get("email"),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = form.dataset.sending;
  setStatus("pending", "");

  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: "POST",
      // FormSubmit treats each referring page address as a separate form needing activation.
      // Sending only the site origin keeps one activation valid for every page, query string or hash.
      referrerPolicy: "origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || String(result.success) === "false") throw new Error(result.message || res.statusText);
    form.reset();
    statusEl.className = "form-status is-success";
    statusEl.textContent = form.dataset.success;
  } catch (err) {
    const body = Object.entries(payload)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k.replace("_", " ")}: ${v}`)
      .join("\n");
    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    statusEl.className = "form-status is-error";
    statusEl.textContent = form.dataset.error + " ";
    const link = document.createElement("a");
    link.href = mailto;
    link.textContent = form.dataset.errorLink;
    statusEl.append(link);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = submitBtn.dataset.label;
  }
});
}

// ---------- Reveal sections on scroll ----------
const revealTargets = document.querySelectorAll(".section-head, .gallery, .service, .process li, .about-photo, .about-text, .contact-info, .contact-form, .package, .addon, .notes, .location, .utm-form");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealTargets.forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

// ---------- Location cards: one sideways-scrolling row with arrow buttons ----------
document.querySelectorAll(".locations-scroller").forEach((wrap) => {
  const row = wrap.querySelector(".locations");
  const prev = wrap.querySelector(".locations-arrow.prev");
  const next = wrap.querySelector(".locations-arrow.next");
  const step = () => (row.querySelector(".location")?.offsetWidth || row.clientWidth) + 16;
  const update = () => {
    prev.hidden = row.scrollLeft <= 4;
    next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
  };
  prev.addEventListener("click", () => row.scrollBy({ left: -step() }));
  next.addEventListener("click", () => row.scrollBy({ left: step() }));
  row.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
});

// ---------- Location photo switcher ----------
document.querySelectorAll(".location-media").forEach((media) => {
  const main = media.querySelector(".location-photo");
  const season = media.querySelector(".location-season");
  const credit = media.querySelector(".location-credit");
  media.querySelectorAll(".location-thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      media.querySelectorAll(".location-thumb").forEach((t) => t.classList.toggle("is-active", t === thumb));
      main.style.setProperty("--img", `url('${thumb.dataset.img}')`);
      season.textContent = thumb.dataset.label || "";
      credit.textContent = thumb.dataset.credit || "";
      credit.hidden = !thumb.dataset.credit;
      if (thumb.dataset.creditLink) credit.href = thumb.dataset.creditLink; else credit.removeAttribute("href");
    });
  });
});

// ---------- UTMedia application form (emailed via FormSubmit, like bookings) ----------
const utmForm = document.getElementById("utm-form");
if (utmForm) {
  const btn = utmForm.querySelector('button[type="submit"]');
  const status = utmForm.querySelector(".form-status");
  utmForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(utmForm);
    if (data.get("_honey")) return; // filled in by spam bots only
    const ds = utmForm.dataset;
    const name = (data.get("name") || "").trim();
    const payload = {
      name,
      social_handles: (data.get("socials") || "").trim(),
      why_they_want_to_join: (data.get("why") || "").trim(),
      _subject: `${ds.subject}: ${name}`,
      _template: "table",
    };
    btn.disabled = true;
    btn.textContent = ds.sending;
    status.className = "form-status";
    status.textContent = "";
    try {
      const res = await fetch(`https://formsubmit.co/ajax/${ds.email}`, {
        method: "POST",
        referrerPolicy: "origin", // one FormSubmit activation covers every page
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || String(result.success) === "false") throw new Error(result.message || res.statusText);
      utmForm.reset();
      status.className = "form-status is-success";
      status.textContent = ds.success;
    } catch (err) {
      const body = `Name: ${payload.name}\nSocial handles: ${payload.social_handles}\n\nWhy I want to join:\n${payload.why_they_want_to_join}`;
      status.className = "form-status is-error";
      status.textContent = ds.error + " ";
      const link = document.createElement("a");
      link.href = `mailto:${ds.email}?subject=${encodeURIComponent(payload._subject)}&body=${encodeURIComponent(body)}`;
      link.textContent = ds.errorLink;
      status.append(link);
    } finally {
      btn.disabled = false;
      btn.textContent = btn.dataset.label;
    }
  });
}

// ---------- "Suggest your own location" card (emailed via FormSubmit, like bookings) ----------
const suggestForm = document.getElementById("suggest-form");
if (suggestForm) {
  const btn = suggestForm.querySelector('button[type="submit"]');
  const status = suggestForm.querySelector(".form-status");
  suggestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(suggestForm);
    if (data.get("_honey")) return; // filled in by spam bots only
    const ds = suggestForm.dataset;
    const loc = (data.get("location") || "").trim();
    const payload = {
      location: loc,
      details: (data.get("why") || "").trim() || "None",
      suggested_by: (data.get("from") || "").trim() || "Not given",
      _subject: `${ds.subject}: ${loc}`,
      _template: "table",
    };
    btn.disabled = true;
    btn.textContent = ds.sending;
    status.className = "form-status";
    status.textContent = "";
    try {
      const res = await fetch(`https://formsubmit.co/ajax/${ds.email}`, {
        method: "POST",
        referrerPolicy: "origin", // one FormSubmit activation covers every page
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || String(result.success) === "false") throw new Error(result.message || res.statusText);
      suggestForm.reset();
      status.className = "form-status is-success";
      status.textContent = ds.success;
    } catch (err) {
      const body = `Location: ${payload.location}
Details: ${payload.details}
Suggested by: ${payload.suggested_by}`;
      status.className = "form-status is-error";
      status.textContent = ds.error + " ";
      const link = document.createElement("a");
      link.href = `mailto:${ds.email}?subject=${encodeURIComponent(payload._subject)}&body=${encodeURIComponent(body)}`;
      link.textContent = ds.errorLink;
      status.append(link);
    } finally {
      btn.disabled = false;
      btn.textContent = btn.dataset.label;
    }
  });
}
