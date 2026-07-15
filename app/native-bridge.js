/* Cubby native bridge (Capacitor).
   INERT on the plain web PWA: every path is guarded on window.Capacitor.isNativePlatform(),
   which is ONLY true inside the iOS/Android wrapper (which remote-loads little-cubby.com/app/).
   So shipping this to the web changes nothing for browser users. Inside the wrapper it:
     - hides the native splash + themes the status bar
     - registers for OS push (APNs/FCM) and exposes the token (server delivery finished on-device)
     - routes tapped-notification data and universal/custom-scheme links through the deep-link router
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
  function boot() {
    var Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return; // web PWA -> no-op
    window.__cubbyNative = (Cap.getPlatform && Cap.getPlatform()) || 'native';
    try { document.documentElement.setAttribute('data-native', window.__cubbyNative); } catch (e) {}
    var P = Cap.Plugins || {};

    try { P.SplashScreen && P.SplashScreen.hide && P.SplashScreen.hide(); } catch (e) {}
    try { P.StatusBar && P.StatusBar.setStyle && P.StatusBar.setStyle({ style: 'LIGHT' }); } catch (e) {}

    // Deep links from a universal link / custom scheme (Associated Domains).
    try {
      P.App && P.App.addListener && P.App.addListener('appUrlOpen', function (ev) {
        try { var u = new URL(ev.url); var q = u.searchParams; routeDeepLink({ go: q.get('go'), stage: q.get('stage'), read: q.get('read'), tab: q.get('tab') }); } catch (e) {}
      });
    } catch (e) {}

    // Native push: request permission, register, expose the token, and deep-link on tap.
    try {
      var Push = P.PushNotifications;
      if (Push) {
        Push.requestPermissions().then(function (res) { if (res && res.receive === 'granted') Push.register(); }, function () {});
        Push.addListener('registration', function (token) {
          window.__cubbyPushToken = token && token.value;
          if (typeof window.onNativePushToken === 'function') { try { window.onNativePushToken(window.__cubbyPushToken, window.__cubbyNative); } catch (e) {} }
        });
        Push.addListener('pushNotificationActionPerformed', function (action) {
          try { routeDeepLink(action && action.notification && action.notification.data); } catch (e) {}
        });
      }
    } catch (e) {}
  }
  if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
