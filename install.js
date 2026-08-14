/* Cubby install/PWA awareness for the marketing site. Beta users didn't realise Cubby installs to the
   home screen (and non-tech users got lost on the iOS Share -> Add to Home Screen steps), so this injects
   (1) an "Install" button in the top nav and (2) a "use Cubby anywhere" band at the end of every page,
   and wires a platform-smart install action:
     - Android/Chrome  -> the real one-tap install prompt (beforeinstallprompt)
     - iPhone/iPad      -> a GUIDED visual overlay (Share glyph + numbered steps + an arrow) so nobody
                           gets stuck the way a real user did (Apple gives no install button on iOS)
     - in-app browsers  -> a "open in Safari/Chrome first" overlay (they literally cannot install in-app)
     - desktop          -> "open little-cubby.com on your phone", with copy-link
   Injection (not per-page markup) keeps it consistent across all 450+ pages. Lives at repo root. */
(function () {
  "use strict";
  if (window.__cubbyInstall) return; window.__cubbyInstall = 1;

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1em;height:1em;vertical-align:-0.14em"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>';
  // The iOS "Share" glyph (box with an up arrow) so the steps point at the real button.
  var SHARE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3C7DFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:0 3px"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>';

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
  function webViewName() {
    var ua = navigator.userAgent || "";
    if (/Instagram/i.test(ua)) return "Instagram";
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
    if (/WhatsApp/i.test(ua)) return "WhatsApp";
    if (/TikTok/i.test(ua)) return "TikTok";
    if (/Snapchat/i.test(ua)) return "Snapchat";
    if (/Line\//i.test(ua)) return "Line";
    if (/Twitter/i.test(ua)) return "X";
    return "this app";
  }
  function isWebView() { // in-app browsers can't add to the home screen
    var ua = navigator.userAgent || "";
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|KAKAOTALK|WhatsApp|Twitter|TikTok|Snapchat|Pinterest|MicroMessenger/i.test(ua)) return true;
    return isIOS() && /AppleWebKit/.test(ua) && !/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua); // generic iOS WKWebView
  }
  function steps() {
    if (isIOS()) return 'On your iPhone or iPad: tap the Share icon, then "Add to Home Screen".';
    return 'On your phone: open the browser menu, then "Install app" or "Add to Home Screen".';
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var CSS =
    '#cbInstallOv{position:fixed;inset:0;z-index:2147483000;background:rgba(20,15,12,.55);display:flex;flex-direction:column;justify-content:flex-end;font-family:"Nunito Sans",system-ui,sans-serif}'
    + '#cbInstallOv .cbi-card{position:relative;background:#fff;padding:24px 22px calc(24px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.22);animation:cbiUp .28s ease}'
    + '#cbInstallOv .cbi-sheet{border-radius:22px 22px 0 0}'
    + '#cbInstallOv .cbi-mid{border-radius:20px;margin:auto 16px 16px;max-width:400px;width:calc(100% - 32px);box-sizing:border-box}'
    + '@keyframes cbiUp{from{transform:translateY(26px);opacity:.4}to{transform:none;opacity:1}}'
    + '#cbInstallOv .cbi-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:none;background:#F2ECE0;border-radius:50%;font-size:18px;line-height:1;cursor:pointer;color:#6E635B}'
    + '#cbInstallOv .cbi-emoji{font-size:40px;line-height:1}'
    + '#cbInstallOv .cbi-h{font-family:"Fraunces",Georgia,serif;font-size:22px;font-weight:700;color:#2C2521;margin:6px 0 8px}'
    + '#cbInstallOv .cbi-p{font-size:15px;line-height:1.5;color:#6E635B;margin:0 0 14px}'
    + '#cbInstallOv .cbi-step{display:flex;align-items:center;gap:10px;font-size:15.5px;color:#2C2521;padding:10px 0;border-top:1px solid #F1EADF}'
    + '#cbInstallOv .cbi-n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:#C97FA0;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}'
    + '#cbInstallOv .cbi-point{margin-top:14px;text-align:center;font-weight:800;color:#C97FA0;font-size:15px;animation:cbiBob 1s ease-in-out infinite}'
    + '@keyframes cbiBob{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}'
    + '#cbInstallOv .cbi-btn{margin-top:16px;width:100%;background:#C97FA0;color:#fff;border:none;font-weight:800;padding:14px;border-radius:14px;font-size:15px;cursor:pointer}';

  function ensureCSS() { if (document.getElementById("cbInstallCSS")) return; var st = document.createElement("style"); st.id = "cbInstallCSS"; st.textContent = CSS; document.head.appendChild(st); }
  function closeGuide() { var o = document.getElementById("cbInstallOv"); if (o && o.parentNode) o.parentNode.removeChild(o); }
  function copyLink(btn) { var u = location.origin + "/app/"; try { navigator.clipboard.writeText(u).then(function () { if (btn) btn.textContent = "Link copied ✓"; }, function () {}); } catch (e) {} }

  function openGuide() {
    if (standalone()) return;
    if (bip) { bip.prompt(); if (bip.userChoice) bip.userChoice.then(function () { bip = null; }); return; } // Android: real one-tap
    ensureCSS();
    var ios = isIOS(), wv = isWebView(), body, cls = "mid";
    if (wv) {
      var nm = webViewName();
      body = '<div class="cbi-emoji">🧭</div><h3 class="cbi-h">Open Cubby in your browser first</h3>'
        + '<p class="cbi-p">You’re in ' + esc(nm) + '’s in-app browser, which can’t add apps to your home screen. Open Cubby in ' + (ios ? "Safari" : "Chrome") + ", then add it.</p>"
        + '<div class="cbi-step"><span class="cbi-n">1</span> Tap the <b>' + (ios ? "…" : "⋮") + "</b> menu (top of the screen)</div>"
        + '<div class="cbi-step"><span class="cbi-n">2</span> Choose <b>Open in ' + (ios ? "Safari" : "Chrome") + "</b></div>"
        + '<button class="cbi-btn" type="button" data-copy>Copy Cubby’s link</button>';
    } else if (ios) {
      cls = "sheet";
      body = '<h3 class="cbi-h">Add Cubby to your home screen</h3>'
        + '<p class="cbi-p">Two taps and Cubby sits on your home screen like any app — full-screen, offline, no password each time.</p>'
        + '<div class="cbi-step"><span class="cbi-n">1</span><span>Tap <b>Share</b>' + SHARE + 'at the bottom of Safari</span></div>'
        + '<div class="cbi-step"><span class="cbi-n">2</span><span>Scroll down and tap <b>Add to Home Screen</b></span></div>'
        + '<div class="cbi-step"><span class="cbi-n">3</span><span>Tap <b>Add</b> — that’s it 🐻</span></div>'
        + '<div class="cbi-point">Find ' + SHARE + " below ⌄</div>";
    } else {
      var android = /android/i.test(navigator.userAgent || "");
      body = '<div class="cbi-emoji">📱</div><h3 class="cbi-h">' + (android ? "Add Cubby to your home screen" : "Cubby is best on your phone") + "</h3>"
        + '<p class="cbi-p">' + (android
          ? "Open your browser menu <b>⋮</b> and choose <b>Install app</b> or <b>Add to Home screen</b>."
          : "Open <b>little-cubby.com</b> on your iPhone or Android to add Cubby to your home screen. On a computer, just keep using it right here.") + "</p>"
        + '<button class="cbi-btn" type="button" data-copy>Copy the link</button>';
    }
    var ov = document.createElement("div"); ov.id = "cbInstallOv";
    ov.innerHTML = '<div class="cbi-card cbi-' + cls + '"><button class="cbi-x" type="button" aria-label="Close">×</button>' + body + "</div>";
    ov.addEventListener("click", function (e) { if (e.target === ov) closeGuide(); });
    ov.querySelector(".cbi-x").addEventListener("click", closeGuide);
    var cp = ov.querySelector("[data-copy]"); if (cp) cp.addEventListener("click", function () { copyLink(cp); });
    document.body.appendChild(ov);
  }

  function onClick(e) {
    var a = e.currentTarget;
    if (a.tagName === "A") return;   // the band's "Open Cubby" link -> just open /app/
    e.preventDefault();
    openGuide();                     // nav "Install" button -> the platform-smart guided flow
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
      btn.innerHTML = ICON + " Install";
      var cta = navIn.querySelector(".nav-cta");
      if (cta) navIn.insertBefore(btn, cta); else navIn.appendChild(btn);
    }

    // 2) "Use Cubby anywhere" band at the end of the page (before the footer, else end of body).
    if (!document.getElementById("cubby-install")) {
      var band = document.createElement("section");
      band.className = "install-band"; band.id = "cubby-install";
      band.innerHTML =
        '<div class="install-in"><div class="install-ico">' + ICON + '</div><div class="install-tx">'
        + "<h3>Use Cubby anywhere, like an app</h3>"
        + "<p>Cubby is a free web app, so there is nothing to download from a store. Add it to your home screen for one-tap, full-screen, offline access. No password, no waiting.</p>"
        + '<p class="install-how">' + steps() + "</p>"
        + '<button type="button" class="install-cta js-install">Add to home screen</button> '
        + '<a href="/app/?utm_source=install-band&utm_medium=organic&utm_campaign=open-cubby" class="install-cta install-cta-ghost">Open Cubby</a>'
        + "</div></div>";
      var foot = document.querySelector("footer.foot") || document.querySelector("footer");
      if (foot && foot.parentNode) foot.parentNode.insertBefore(band, foot); else document.body.appendChild(band);
    }

    wire(document);
    refreshLabels();
  });

  window.cubbyInstallGuide = openGuide; // let any page CTA call it directly if wanted

  /* Register the site's own service worker (/sw.js), whose single job is to show our offline page
     instead of the browser's error page when a page here cannot be reached. This file is the right
     home for it: it is already injected into all 660-odd marketing and article pages, so this is one
     line rather than 660 edits, and making the site behave like an app is what install.js is for.

     Note what is NOT happening. /app/index.html does not load this file, so the app is never the thing
     that registers a root-scoped worker; the app registers its own at /app/sw.js and keeps its own
     scope. /sw.js caches no content at all — see the four rules at the top of it.

     After load, so it never competes with first paint, and silent on failure: a site that cannot
     register a worker should still be a working site. */
  // isSecureContext rather than a protocol test: it is true on https AND on localhost, which is where
  // this gets verified. A protocol check would silently skip registration for every local run.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () { });
    });
  }
})();
