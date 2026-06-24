/* Cubby install/PWA awareness for the marketing site. Beta users didn't realise Cubby installs to the
   home screen, so this injects (1) an "Install" button in the top nav and (2) a "use Cubby anywhere"
   band at the end of every page, and wires a platform-smart install action. Loaded with <script defer>.
   Injection (not per-page markup) keeps it consistent across all 450+ pages without touching each one.
   Lives at repo root like /rail.js + /news-widget.js. */
(function () {
  "use strict";
  if (window.__cubbyInstall) return; window.__cubbyInstall = 1;

  var bip = null; // the captured beforeinstallprompt (Android/Chrome)
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); bip = e; refreshLabels(); });
  window.addEventListener("appinstalled", function () { bip = null; });

  function standalone() {
    try { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; }
    catch (e) { return false; }
  }
  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function steps() {
    if (isIOS()) return 'On your iPhone or iPad: tap the Share icon, then "Add to Home Screen".';
    return 'On your phone: open the browser menu, then "Install app" or "Add to Home Screen".';
  }

  function onClick(e) {
    if (bip) { e.preventDefault(); bip.prompt(); if (bip.userChoice) bip.userChoice.then(function () { bip = null; }); return; }
    var a = e.currentTarget;
    if (a.tagName === "A") return;                 // band "Open Cubby" link -> let it open /app/
    e.preventDefault();                            // nav button -> bring the how-to band into view
    var band = document.getElementById("cubby-install");
    if (band) { band.scrollIntoView({ behavior: "smooth", block: "center" }); band.classList.add("flash"); setTimeout(function () { band.classList.remove("flash"); }, 1400); }
  }
  function wire(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".js-install"), function (b) { if (b.__wired) return; b.__wired = 1; b.addEventListener("click", onClick); });
  }
  function refreshLabels() {
    Array.prototype.forEach.call(document.querySelectorAll(".install-cta"), function (b) { if (bip) b.textContent = "Install Cubby"; });
  }

  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    if (standalone()) return; // already installed: nothing to advertise

    // 1) Nav "Install" button, just before the "Start free" CTA.
    var navIn = document.querySelector(".nav-in");
    if (navIn && !navIn.querySelector(".nav-install")) {
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "nav-install js-install";
      btn.setAttribute("aria-label", "Install Cubby on your device");
      btn.textContent = "📲 Install";
      var cta = navIn.querySelector(".nav-cta");
      if (cta) navIn.insertBefore(btn, cta); else navIn.appendChild(btn);
    }

    // 2) "Use Cubby anywhere" band at the end of the page (before the footer, else end of body).
    if (!document.getElementById("cubby-install")) {
      var band = document.createElement("section");
      band.className = "install-band"; band.id = "cubby-install";
      band.innerHTML =
        '<div class="install-in"><div class="install-ico">📲</div><div class="install-tx">'
        + "<h3>Use Cubby anywhere, like an app</h3>"
        + "<p>Cubby is a free web app, so there is nothing to download from a store. Add it to your home screen for one-tap, full-screen, offline access. No password, no waiting.</p>"
        + '<p class="install-how">' + steps() + "</p>"
        + '<a href="/app/" class="install-cta js-install">Open Cubby</a>'
        + "</div></div>";
      var foot = document.querySelector("footer.foot") || document.querySelector("footer");
      if (foot && foot.parentNode) foot.parentNode.insertBefore(band, foot); else document.body.appendChild(band);
    }

    wire(document);
    refreshLabels();
  });
})();
