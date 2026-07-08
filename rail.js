/* Cubby marketing rail enhancer: responsive "and there's more" swimlane.
   Phone: native swipe + peek (CSS only, untouched here).
   Desktop / non-touch: inject left/right arrows, mouse drag-to-scroll, keyboard paging,
   arrows auto-hide at the ends. Multi-instance, .homex-scoped, no dependencies.
   Lives at repo root (like /news-widget.js); marketing pages load it with <script defer>. */
(function () {
  "use strict";
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function prefersReduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches; }
  var isTouch = window.matchMedia && window.matchMedia("(hover:none),(pointer:coarse)").matches;
  var canHover = window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches;

  function ensureShell(rail) {
    var shell = rail.closest(".hx-rail-shell");
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "hx-rail-shell";
      rail.parentNode.insertBefore(shell, rail);
      shell.appendChild(rail);
    }
    return shell;
  }

  function step(rail) {
    var card = rail.querySelector(".hx-cap");
    if (!card) return rail.clientWidth * 0.8;
    var cs = getComputedStyle(rail);
    var gap = parseFloat(cs.columnGap || cs.gap || "14") || 14;
    return card.getBoundingClientRect().width + gap;
  }

  function enhance(rail) {
    if (rail.dataset.railReady) return;
    rail.dataset.railReady = "1";

    // Phone: native swipe is the affordance, no arrows, no drag.
    if (isTouch || !canHover) return;

    var homex = rail.closest(".homex") || document.querySelector(".homex");
    if (homex) homex.classList.add("has-rail-nav");
    var shell = ensureShell(rail);

    function mkBtn(dir, label, glyph) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hx-rail-arrow " + dir;
      b.setAttribute("aria-label", label);
      b.textContent = glyph;
      return b;
    }
    var prev = mkBtn("prev", "Show previous cards", "‹"); // ‹
    var next = mkBtn("next", "Show next cards", "›");      // ›
    shell.appendChild(prev);
    shell.appendChild(next);

    function scrollByStep(sign) {
      rail.scrollBy({ left: sign * step(rail), behavior: prefersReduced() ? "auto" : "smooth" });
    }
    prev.addEventListener("click", function () { scrollByStep(-1); });
    next.addEventListener("click", function () { scrollByStep(1); });

    function update() {
      var max = rail.scrollWidth - rail.clientWidth;   // scroll-snap + the rail's 4px left pad leave ~4px slack at each end
      var noOverflow = max <= 6;
      prev.hidden = noOverflow || rail.scrollLeft <= 8;
      next.hidden = noOverflow || rail.scrollLeft >= max - 8;
    }

    // Keyboard paging when the rail (a focusable group) has focus.
    if (!rail.hasAttribute("tabindex")) rail.tabIndex = 0;
    rail.setAttribute("role", "group");
    if (!rail.getAttribute("aria-label")) rail.setAttribute("aria-label", "More features, scrollable");
    rail.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); scrollByStep(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); scrollByStep(-1); }
      else if (e.key === "PageDown") { e.preventDefault(); rail.scrollBy({ left: rail.clientWidth, behavior: prefersReduced() ? "auto" : "smooth" }); }
      else if (e.key === "PageUp") { e.preventDefault(); rail.scrollBy({ left: -rail.clientWidth, behavior: prefersReduced() ? "auto" : "smooth" }); }
      else if (e.key === "Home") { e.preventDefault(); rail.scrollTo({ left: 0, behavior: prefersReduced() ? "auto" : "smooth" }); }
      else if (e.key === "End") { e.preventDefault(); rail.scrollTo({ left: rail.scrollWidth - rail.clientWidth, behavior: prefersReduced() ? "auto" : "smooth" }); }
    });

    // Mouse drag-to-scroll (desktop). Touch/pen keep native swipe.
    var down = false, startX = 0, startScroll = 0, moved = false;
    rail.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") return;
      down = true; moved = false; startX = e.clientX; startScroll = rail.scrollLeft;
      if (homex) homex.classList.add("dragging");
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      rail.scrollLeft = startScroll - dx;
    });
    function endDrag() { if (!down) return; down = false; if (homex) homex.classList.remove("dragging"); }
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    // Swallow the click that follows a real drag so a card link doesn't fire mid-drag.
    rail.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

    rail.addEventListener("scroll", function () { window.requestAnimationFrame(update); }, { passive: true });
    window.addEventListener("resize", function () { window.requestAnimationFrame(update); });
    update();
  }

  ready(function () { document.querySelectorAll(".homex .hx-rail").forEach(enhance); });
})();
