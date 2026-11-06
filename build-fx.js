// "Shot in real time" intro, played only on the first page of a visit: little cars drive to each element,
// a viewfinder focuses on it, and it's captured (photos flash into focus, headlines pan in like a slow-shutter shot).
// Sections below the fold build as they scroll into view.
// Skipped for people who ask for reduced motion, and visitors can press Skip at any time.
(function () {
  const root = document.documentElement;
  if (!root.classList.contains("fx-hold")) return;
  window.__fx = true;

  const SELECTOR = [
    ".logo", ".nav-links > li",
    ".hero .eyebrow", ".hero h1", ".hero-sub", ".hero-actions > *",
    ".page-hero-inner > *",
    ".strip > div",
    ".section-head > *", ".section-sub", ".pf-tabs", ".filters",
    ".about-photo", ".about-text > *",
    ".service", ".process li", ".shot", ".section-cta",
    ".package", ".addon", ".notes", ".location",
    ".contact-info", ".contact-form", ".utm-form",
  ].join(",");
  const NAMES = [["Rollers", "#ffffff"], ["Interiors", "#8fb8ff"], ["Details", "#2e7bff"], ["Statics", "#ffffff"], ["Events", "#8fb8ff"], ["Track", "#2e7bff"]];
  // Every car is from a real shoot. Top-down cars steer; high-angle cars keep their angle and flip to face the way they're going.
  const PHOTOS = [
    ["huracan-purple"], ["mclaren-570s"], ["audi-r8"], ["gtr-r35"], ["mclaren-spider"], ["audi-wrapped"], ["nissan-370z"],
    ["skyline-r34", true], ["mustang", true],
  ].sort(() => Math.random() - 0.5);
  let nextPhoto = 0;
  const EXPOSURES = ["1/60s  f/8  ISO 100", "1/40s  f/11  ISO 64", "1/125s  f/5.6  ISO 200", "1/30s  f/16  ISO 50", "1/250s  f/2.8  ISO 400", "1/80s  f/9  ISO 100"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Pace: the faster someone scrolls, the faster the page keeps up ----------
  let scrollSpeed = 0; // px per second
  const queue = []; // one shared line, always worked through from the top of the page down
  const backlog = () => queue.length;
  const pace = () => (scrollSpeed > 1500 || backlog() > 10 ? 0.45 : scrollSpeed > 600 ? 0.7 : 1);

  // ---------- Collect what to build ----------
  const toggle = document.querySelector(".nav-toggle");
  const phoneMenu = toggle && getComputedStyle(toggle).display !== "none"; // the slide-down menu stays as it is
  try { sessionStorage.setItem("fx:visit", "1"); } catch (e) { /* private mode: it just replays */ }
  const all = [...document.querySelectorAll(SELECTOR)].filter((el) => el.offsetParent !== null && !(phoneMenu && el.closest(".nav-links")));
  const targets = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  // Anything the list above doesn't name still gets built, so nothing on the page is left out
  function cover(node) {
    [...node.children].forEach((child) => {
      if (targets.includes(child) || child.offsetParent === null) return;
      if (child.matches(".lightbox, .hero-bg, .honeypot, .fx-layer") || (phoneMenu && child.matches(".nav-links"))) return;
      if (targets.some((t) => child.contains(t))) cover(child);
      else targets.push(child);
    });
  }
  document.querySelectorAll(".site-header, main, .site-footer").forEach(cover);
  const pending = new Set(targets);
  let remaining = targets.length;
  let frames = 0;
  let shots = 0;
  targets.forEach((el) => el.classList.add("fx-wait"));

  root.classList.add("fx-on");
  root.classList.remove("fx-hold");

  // ---------- Overlay ----------
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  layer.style.height = `${document.documentElement.scrollHeight}px`;

  const finder = document.createElement("div");
  finder.className = "fx-vf";
  finder.setAttribute("aria-hidden", "true");
  finder.innerHTML = "<i></i><i></i><i></i><i></i>";
  document.body.append(finder);

  const carSrc = (file) => `/images/fx-cars/${file}.png`;
  function dress(agent) {
    const [file, highAngle] = PHOTOS[nextPhoto++ % PHOTOS.length];
    agent.img.src = carSrc(file);
    agent.img.classList.toggle("high", !!highAngle);
    agent.img.style.transform = "";
    agent.highAngle = !!highAngle;
    agent.rot = 0;
  }

  const agents = NAMES.map(([name, color], i) => {
    const el = document.createElement("div");
    el.className = "fx-car";
    el.style.setProperty("--fx-color", color);
    el.innerHTML = `<img alt=""><span>${name}</span>`;
    const x = -40;
    const y = innerHeight * (0.15 + i * 0.16);
    el.style.transform = `translate(${x}px, ${y}px)`;
    layer.append(el);
    const agent = { el, img: el.querySelector("img"), x, y, rot: 0, busy: false };
    dress(agent);
    return agent;
  });
  PHOTOS.forEach(([file]) => { new Image().src = carSrc(file); }); // ready before they're needed

  const chip = document.createElement("div");
  chip.className = "fx-chip";
  chip.innerHTML = '<span class="fx-count">[ 000 ]</span><span class="fx-msg">Shooting...</span><button type="button">Skip</button>';
  document.body.append(chip);
  const chipText = chip.querySelector(".fx-msg");
  const chipCount = chip.querySelector(".fx-count");

  function drive(agent, x, y, p) {
    const dx = x - agent.x;
    const dy = y - agent.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 30) {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (agent.highAngle) {
        agent.img.style.transform = `scaleX(${dx < 0 ? -1 : 1})`;
      } else {
        const turn = ((angle + 90 - agent.rot + 540) % 360) - 180; // the photos point up; turn the short way round
        agent.rot += turn;
        agent.img.style.transform = `rotate(${agent.rot}deg)`;
      }
      const trail = document.createElement("div");
      trail.className = "fx-trail";
      trail.style.cssText = `left:${agent.x}px;top:${agent.y}px;width:${dist}px;transform:rotate(${angle}deg)`;
      layer.append(trail);
      trail.animate(
        [{ transform: `rotate(${angle}deg) scaleX(0)`, opacity: 1 }, { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0.8, offset: 0.5 }, { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0 }],
        { duration: 900 * p, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      ).finished.catch(() => {}).then(() => trail.remove());
    }
    agent.x = x;
    agent.y = y;
    agent.el.classList.add("on");
    agent.el.style.transitionDuration = `${480 * p}ms, 350ms`;
    agent.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ---------- Reveal styles ----------
  function split(el, words) {
    const saved = el.innerHTML;
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      const bits = words ? node.textContent.split(/(\s+)/) : [...node.textContent];
      bits.forEach((bit) => {
        if (!bit.trim()) { frag.append(bit); return; }
        const s = document.createElement("fx-c"); // own tag, so page styles for spans don't recolor the letters
        s.textContent = bit;
        frag.append(s);
        parts.push(s);
      });
      node.replaceWith(frag);
    });
    return { saved, parts };
  }

  async function pan(el) {
    const heading = /^H[1-3]$/.test(el.tagName);
    const { saved, parts } = split(el, !heading);
    el.classList.remove("fx-wait");
    const step = Math.min(heading ? 26 : 34, (heading ? 700 : 600) / Math.max(parts.length, 1));
    for (const part of parts) {
      if (skipped) break;
      part.classList.add("on");
      await sleep(step * pace());
    }
    if (!skipped) await sleep(460 * pace()); // let the last letters settle before tidying up
    el.innerHTML = saved; // back to the original markup, nothing left behind
  }

  // A soft flash, and the photo pulls into focus
  async function capture(el, box) {
    el.classList.remove("fx-wait");
    const flash = document.createElement("div");
    flash.className = "fx-flash";
    box.append(flash);
    const soft = "cubic-bezier(0.25, 0.1, 0.25, 1)";
    flash.animate([{ opacity: 0 }, { opacity: 0.22, offset: 0.25 }, { opacity: 0 }], { duration: 620, easing: soft });
    await el.animate(
      [{ opacity: 0, filter: "blur(12px) brightness(1.25)", transform: "scale(1.02)" }, { opacity: 1, filter: "blur(0) brightness(1)", transform: "scale(1)" }],
      { duration: 760 * pace(), easing: soft },
    ).finished.catch(() => {});
    flash.remove();
  }

  // Blocks glide into place
  async function roll(el) {
    el.classList.remove("fx-wait");
    await el.animate(
      [{ opacity: 0, transform: "translateX(-14px)" }, { opacity: 1, transform: "none" }],
      { duration: 480 * pace(), easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    ).finished.catch(() => {});
  }

  const isPhoto = (el) => el.matches(".shot, .about-photo, .location");
  const isText = (el) => /^(H[1-3]|P)$/.test(el.tagName) && !el.querySelector("a, button");

  // ---------- Cars ----------
  function tick() {
    frames++;
    chipCount.textContent = `[ ${String(frames).padStart(3, "0")} ]`;
  }

  // Only for things already scrolled past, which nobody can see. Everything on screen gets the full treatment.
  function quick(el) {
    el.classList.remove("fx-wait");
    tick();
  }

  const passed = (el) => el.getBoundingClientRect().bottom < 0;
  function sweep() {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (passed(queue[i])) quick(queue.splice(i, 1)[0]);
    }
    settle();
  }

  async function build(agent, el, p) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0) { quick(el); return; }
    layer.style.height = `${document.documentElement.scrollHeight}px`; // clips anything that would widen the page on phones
    const inHeader = el.closest(".site-header");
    const top = r.top + (inHeader ? 0 : scrollY);
    drive(agent, Math.min(r.left + Math.min(r.width * 0.2, 60), innerWidth - 80), top + Math.min(r.height * 0.5, 40), p);
    await sleep(380 * p);

    const box = document.createElement("div");
    box.className = "fx-box";
    box.style.cssText = `left:${r.left}px;top:${top}px;width:${r.width}px;height:${r.height}px`;
    const reading = r.width > 150 ? `<b>${EXPOSURES[shots++ % EXPOSURES.length]}</b>` : ""; // small items skip it so the tags never overlap
    box.innerHTML = `<i></i><i></i><i></i><i></i>${reading}`;
    layer.append(box);
    await sleep(200 * p); // autofocus settles...
    box.classList.add("lock"); // ...and locks on

    if (isPhoto(el)) await capture(el, box);
    else if (isText(el)) await pan(el);
    else await roll(el);

    tick();
    box.classList.add("out");
    setTimeout(() => box.remove(), 520);
  }

  // Top to bottom, left to right within a row
  const place = (el) => {
    const r = el.getBoundingClientRect();
    return { row: Math.round((r.top + (el.closest(".site-header") ? 0 : scrollY)) / 16), x: r.left, y: r.top + scrollY };
  };
  function byPosition(a, b) {
    const pa = place(a);
    const pb = place(b);
    return pa.row - pb.row || pa.x - pb.x;
  }

  let nextStart = 0;
  let pumpTimer;
  function pump() {
    clearTimeout(pumpTimer);
    while (queue.length && !skipped) {
      const idle = agents.filter((a) => !a.busy);
      if (!idle.length) return;
      const wait = nextStart - performance.now();
      if (wait > 0) { pumpTimer = setTimeout(pump, wait); return; }
      queue.sort(byPosition);
      const el = queue.shift();
      const { x, y } = place(el);
      const agent = idle.reduce((best, c) => (Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y) ? c : best));
      nextStart = performance.now() + 110 * pace(); // starts stay in order, a beat apart
      work(agent, el);
    }
  }

  async function work(agent, el) {
    if (!agent.el.classList.contains("on")) dress(agent); // a parked car swaps out, so every car gets a turn
    agent.busy = true;
    await build(agent, el, pace());
    agent.busy = false;
    if (!queue.length) agent.el.classList.remove("on");
    pump();
    settle();
  }

  function settle() {
    if (queue.length || agents.some((a) => a.busy)) return;
    chip.classList.remove("on");
    finder.classList.add("out");
    if (!remaining) finish();
  }

  function enqueue(el) {
    pending.delete(el);
    remaining--;
    if (passed(el)) { quick(el); settle(); return; }
    const heading = el.closest("section")?.querySelector("h2");
    if (heading) chipText.textContent = `Shooting: ${heading.textContent.trim().slice(0, 26)}`;
    chip.classList.add("on");
    queue.push(el);
  }

  // ---------- Finish / skip ----------
  let skipped = false;
  function finish() {
    setTimeout(() => { layer.remove(); chip.remove(); finder.remove(); root.classList.remove("fx-on"); }, 500);
  }
  chip.querySelector("button").addEventListener("click", () => {
    skipped = true;
    io.disconnect();
    remaining = 0;
    document.querySelectorAll(".fx-wait").forEach((el) => el.classList.remove("fx-wait"));
    document.querySelectorAll("fx-c").forEach((el) => el.classList.add("on"));
    finish();
  });

  // ---------- Go ----------
  // Each element joins the line as it scrolls into view.
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e) => { io.unobserve(e.target); enqueue(e.target); });
    pump();
  }, { rootMargin: "100000px 0px -10% 0px" }); // builds once it is on screen; the huge top margin catches anything jumped past

  // The last things on the page may never reach the trigger line, so the bottom of the page calls them in
  function atBottom() {
    if (scrollY + innerHeight < document.documentElement.scrollHeight - 8) return;
    [...pending].filter((el) => el.getBoundingClientRect().left < innerWidth).forEach((el) => { io.unobserve(el); enqueue(el); });
    pump();
  }

  let lastY = scrollY;
  let lastT = performance.now();
  let calm;
  addEventListener("scroll", () => {
    const now = performance.now();
    const dt = now - lastT;
    if (dt < 12) return;
    scrollSpeed = scrollSpeed * 0.4 + (Math.abs(scrollY - lastY) / dt) * 1000 * 0.6;
    lastY = scrollY;
    lastT = now;
    sweep();
    atBottom();
    clearTimeout(calm);
    calm = setTimeout(() => { scrollSpeed = 0; }, 150);
  }, { passive: true });
  // Wait for the fonts first: they change where everything sits, and the focus brackets must line up
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, sleep(900)]).then(() => {
    // The banner photo pulls into focus first, then the cars get to work
    document.querySelector(".hero-bg, .page-hero.has-banner")?.animate(
      [{ filter: "blur(16px) brightness(0.6)" }, { filter: "blur(0) brightness(1)" }],
      { duration: 1100, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    );
    targets.forEach((el) => io.observe(el));
    // Everything on the first screen builds now, even things low on the screen like the scroll cue
    targets.filter((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.left < innerWidth; }).forEach((el) => { io.unobserve(el); enqueue(el); });
    pump();
    atBottom();
  });
})();
