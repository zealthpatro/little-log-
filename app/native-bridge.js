/* Cubby native bridge (Capacitor).
   INERT on the plain web PWA: every path is guarded on window.Capacitor.isNativePlatform(),
   which is ONLY true inside the iOS/Android wrapper (which remote-loads little-cubby.com/app/).
   So shipping this to the web changes nothing for browser users. Inside the wrapper it:
     - hides the native splash + themes the status bar
     - registers for OS push (APNs/FCM) and exposes the token (server delivery finished on-device)
     - routes tapped-notification data and universal/custom-scheme links through the deep-link router
     - opens same-origin _blank links (the article reads) in an in-app browser instead of throwing
       the user out to Safari, so the reading room never loses the app
     - gives the Android hardware back button somewhere sensible to go
     - adds haptics, which iOS web can never have
   The token->server wiring (onNativePushToken) is completed during the on-device build, once the
   Firebase iOS app + GoogleService-Info.plist exist. See docs/plans/2026-07-15-native-wrapper-app-store.md */
(function () {
  function routeDeepLink(obj) {
    try {
      if (!obj) return;
      var dl = { go: obj.go || null, stage: obj.stage || null, read: obj.read || null, tab: obj.tab || null };
      if (dl.go || dl.stage || dl.read || dl.tab) {
        sessionStorage.setItem('cubby-dl', JSON.stringify(dl));
        try { window._dlRan = false; } catch (e) {}
        if (typeof maybeRunDeepLink === 'function') maybeRunDeepLink();
      }
    } catch (e) {}
  }

  /* Haptics. Defined on web too so call sites never have to guard: on the wrapper it's a real Taptic
     tap, on Android web a short vibrate, on iOS web (which has no vibration API at all) a no-op. */
  window.cubbyHaptic = function (kind) {
    try {
      var Cap = window.Capacitor;
      var H = Cap && Cap.isNativePlatform && Cap.isNativePlatform() && (Cap.Plugins || {}).Haptics;
      if (H) {
        if (kind === 'success' || kind === 'warning' || kind === 'error') H.notification({ type: kind.toUpperCase() });
        else H.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 18 : 8);
    } catch (e) {}
  };

  /* Getting a file out of the app. WKWebView SILENTLY IGNORES `a.download` — no error, no file, the
     button simply does nothing — which quietly killed every keepsake/photo/video/export save in the
     wrapper. So write the bytes to the cache dir and hand the file to the OS share sheet: Save to
     Files, AirDrop, WhatsApp. index.html's saveFile() delegates here when this exists. */
  function nativeSaveFile(href, filename, okMsg) {
    var P = (window.Capacitor && window.Capacitor.Plugins) || {};
    if (!P.Filesystem || !P.Share) { try { toast("Couldn't save that here"); } catch (e) {} return; }
    var safe = String(filename || 'cubby').replace(/[^a-zA-Z0-9._-]/g, '-');
    fetch(href)
      .then(function (r) { return r.blob(); })
      .then(function (b) {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          // Filesystem wants base64 without the data: prefix.
          fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
          fr.onerror = reject;
          fr.readAsDataURL(b);
        });
      })
      .then(function (b64) { return P.Filesystem.writeFile({ path: safe, data: b64, directory: 'CACHE' }); })
      .then(function (w) { return P.Share.share({ title: safe, url: w.uri }); })
      .then(function () { try { if (okMsg) toast(okMsg); } catch (e) {} },
        function (err) {
          // Dismissing the share sheet is a normal choice, not an error worth a message.
          var m = '' + ((err && err.message) || '');
          if (/cancel|abort|dismiss/i.test(m)) return;
          try { toast("Couldn't save that"); } catch (e) {}
        });
  }

  function boot() {
    var Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return; // web PWA -> no-op
    window.cubbyNativeSaveFile = nativeSaveFile;
    var platform = (Cap.getPlatform && Cap.getPlatform()) || 'native';
    window.__cubbyNative = platform;
    try { document.documentElement.setAttribute('data-native', platform); } catch (e) {}
    var P = Cap.Plugins || {};

    try { P.SplashScreen && P.SplashScreen.hide && P.SplashScreen.hide(); } catch (e) {}
    // Cubby's chrome is cream (#F7F2E8), so the status bar needs DARK text. In Capacitor's naming that
    // is Style.Light ("light background"), which reads backwards but is correct.
    try {
      if (P.StatusBar) {
        P.StatusBar.setStyle && P.StatusBar.setStyle({ style: 'LIGHT' });
        if (platform === 'android') {
          P.StatusBar.setOverlaysWebView && P.StatusBar.setOverlaysWebView({ overlay: false });
          P.StatusBar.setBackgroundColor && P.StatusBar.setBackgroundColor({ color: '#F7F2E8' });
        }
      }
    } catch (e) {}

    /* Articles + any other same-origin _blank link: keep them inside the app.
       The web app deliberately opens reads with target="_blank" so the browser gives a new tab. In the
       wrapper a _blank link is punted to Safari, which dumps the user out of Cubby with only the little
       "< Cubby" chip to get back. An in-app browser sheet has a Done button and keeps the app alive
       underneath, so the reading room behaves like a native reader. Falls through to the default
       behaviour if the Browser plugin isn't present. */
    try {
      document.addEventListener('click', function (ev) {
        try {
          var a = ev.target && ev.target.closest && ev.target.closest('a[target="_blank"]');
          if (!a || !a.href) return;
          var u = new URL(a.href, location.href);
          if (u.origin !== location.origin) return;           // off-site links can have the system browser
          var B = (window.Capacitor.Plugins || {}).Browser;
          if (!B || !B.open) return;
          ev.preventDefault();
          B.open({ url: u.href, presentationStyle: 'popover', toolbarColor: '#F7F2E8' });
        } catch (e) {}
      }, true);
    } catch (e) {}

    // Deep links from a universal link / custom scheme (Associated Domains).
    try {
      P.App && P.App.addListener && P.App.addListener('appUrlOpen', function (ev) {
        try {
          var u = new URL(ev.url);
          // An email sign-in link must be HANDLED, not just parsed for deep-link keys: hand the whole
          // URL to the web app so signInWithEmailLink() can finish inside the webview (in Safari it
          // would sign in to the wrong place entirely).
          if (/[?&](oobCode|mode=signIn)/.test(u.search)) { location.replace('/app/' + u.search + u.hash); return; }
          var q = u.searchParams;
          routeDeepLink({ go: q.get('go'), stage: q.get('stage'), read: q.get('read'), tab: q.get('tab') });
        } catch (e) {}
      });
    } catch (e) {}

    /* Android hardware back. Without this, back on the home screen quits the app instantly, which is a
       horrible way to lose a half-typed note. Close whatever is open first; only exit from the top. */
    try {
      P.App && P.App.addListener && P.App.addListener('backButton', function (ev) {
        try {
          if (typeof closeReadCarousel === 'function' && document.getElementById('readCarousel')) { closeReadCarousel(); return; }
          var sheet = document.getElementById('sheet');
          if (sheet && sheet.classList.contains('show') && typeof closeSheet === 'function') { closeSheet(); return; }
          // store-firebase's closeModal() is IIFE-scoped, so remove the node the same way it does.
          var modal = document.getElementById('llModalOv');
          if (modal) { modal.remove(); return; }
          if (ev && ev.canGoBack) { window.history.back(); return; }
          P.App.exitApp && P.App.exitApp();
        } catch (e) {}
      });
    } catch (e) {}

    /* Native push, via FirebaseMessaging rather than @capacitor/push-notifications. That matters: on iOS
       the plain push plugin hands back the raw APNs device token, but Cubby's whole pipeline is FCM —
       the app stores users/{uid}.push.tokens and the Worker cron sends via the FCM API. FirebaseMessaging
       wraps the native SDK, so getToken() returns a real FCM registration token and the cron, quiet hours
       and the push.due index all keep working untouched.

       Deliberately does NOT ask on launch: an OS permission dialog in front of a parent who hasn't even
       signed in yet is exactly the anxiety the charter says to design out, and Cubby's push policy is
       critical-only (a due dose). So we re-register silently if permission was already granted, and
       expose cubbyEnableNativePush() for the Reminders toggle to call in context. */
    try {
      var Msg = P.FirebaseMessaging;
      if (Msg) {
        /* `explicit` says the parent just tapped On. It has to be threaded from the tap all the way
           through, because enabling and the silent launch re-register share this exact path — and only
           the tap may switch reminders on. Without it, every launch with the OS permission still
           granted would resurrect reminders the parent had turned off. */
        var handOverToken = function (tok, explicit) {
          if (!tok) return null;
          window.__cubbyPushToken = tok;
          if (typeof window.onNativePushToken === 'function') {
            try { window.onNativePushToken(tok, window.__cubbyNative, !!explicit); } catch (e) {}
          }
          return tok;
        };
        var fetchToken = function (explicit) {
          return Msg.getToken().then(function (r) { return handOverToken(r && r.token, explicit); });
        };

        // Silent: refresh a rotated token for someone already opted in. storePushToken() drops it if
        // they aren't — this must never be the thing that turns reminders on.
        Msg.checkPermissions().then(function (res) { if (res && res.receive === 'granted') fetchToken(false); }, function () {});
        window.cubbyEnableNativePush = function () {
          return Msg.requestPermissions().then(function (res) {
            if (!res || res.receive !== 'granted') return false;
            return fetchToken(true).then(function (t) { return !!t; });
          });
        };
        // Off means off: drop the registration so a stale token can't be delivered to.
        window.cubbyDisableNativePush = function () {
          try { window.__cubbyPushToken = null; return Msg.deleteToken(); } catch (e) { return null; }
        };
        // FCM rotates tokens; keep the stored one current or reminders quietly stop arriving. Never
        // explicit — a rotation is not a request to switch reminders back on.
        Msg.addListener('tokenReceived', function (ev) { try { handOverToken(ev && ev.token, false); } catch (e) {} });
        Msg.addListener('notificationActionPerformed', function (ev) {
          try { routeDeepLink(ev && ev.notification && ev.notification.data); } catch (e) {}
        });
      }
    } catch (e) {}
  }
  if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
