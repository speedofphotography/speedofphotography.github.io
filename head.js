// Runs in <head> on every page, before the page shows. (Kept in a file, not inline in the page, so the site's
// Content-Security-Policy can refuse every inline script.)
// A reload starts at the top of the page, not wherever the visitor was (or a #section in the address).
// Back and forward still return to where they were.
(function () {
  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    var reload = nav ? nav.type === "reload" : performance.navigation && performance.navigation.type === 1;
    if (!reload || !("scrollRestoration" in history)) return;
    history.scrollRestoration = "manual";
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    var moved = false; // once the visitor scrolls themselves, leave them be
    ["wheel", "touchstart", "keydown"].forEach(function (t) { addEventListener(t, function () { moved = true; }, { once: true, passive: true }); });
    var top = function () { if (!moved) scrollTo({ top: 0, left: 0, behavior: "instant" }); }; // the site scrolls smoothly; this must jump
    top();
    addEventListener("DOMContentLoaded", top);
    addEventListener("load", top);
    addEventListener("pagehide", function () { history.scrollRestoration = "auto"; });
  } catch (e) {}
})();

// Page-build animation (home page only): plays the first time the home page is opened in a visit and every time
// it's reloaded (not when clicking back to it), never for reduced motion. Hides the page until build-fx.js takes over.
(function () {
  if (location.pathname !== "/") return;
  try {
    var root = document.documentElement;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    var reload = nav ? nav.type === "reload" : performance.navigation && performance.navigation.type === 1;
    if (!reload && location.search.indexOf("build") < 0 && sessionStorage.getItem("fx:visit")) return;
    root.classList.add("fx-hold");
    setTimeout(function () { if (!window.__fx) root.classList.remove("fx-hold"); }, 2500);
  } catch (e) {}
})();
