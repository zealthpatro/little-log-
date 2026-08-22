/* Cubby: Firebase initialization.
   These config values are public by design (Firebase web config is not a secret).
   Security is enforced by Firestore rules, not by hiding this. */
(function () {
  /* ---- the connectivity card ----------------------------------------------------------------
     One illustrated state for the places the network can genuinely strand a parent, built here
     because this is the earliest precached file in the boot chain: the SDK guard below needs it
     before a single app helper exists, and store-firebase.js reuses it for "signed in, but we
     cannot reach your Cubby". Two callers, one card, so the two can never drift apart.

     It is built from the shell's own classes and theme tokens, NOT from hardcoded colours. The
     <head> <style> survives a body wipe, so `.empty-state` / `.es-bear` / `.es-cta` and every
     theme variable are available even on this path. The literals this used to carry (#2C2521 on a
     near-black night background) put the heading at roughly 1.1:1 in the one state whose entire
     job is to explain itself to somebody at 3am.

     The picture is the painted balloon: briefly out of reach, and coming back down. It is the only
     illustration in the service worker's precache (app/sw.js) precisely because this is the moment
     the network is gone; `onerror` still hides it rather than leaving a broken-image box, since a
     blank or broken screen is itself an anxiety state.

     Copy rules that bind (DESIGN.md A7, and the charter's calm-by-default): second person, sentence
     case, no em-dash, no red, no exclamation mark, nothing that reads as blame. And the body answers
     the question a parent actually has, which is whether what she logged is safe, not what her
     network is doing. role="status" because until now every connectivity message Cubby has ever
     shown was announced to nobody using a screen reader. */
  window.cubbyConnCard = function (o) {
    o = o || {};
    return '<div class="empty-state conn-card fade-in" role="status" aria-live="polite">'
      + '<img class="es-bear es-balloon" src="/app/spot-art/offline_balloon.webp" alt=""'
      + ' width="512" height="512" onerror="this.style.display=\'none\'">'
      + '<p>' + (o.title || 'Cubby needs a moment') + '</p>'
      + '<span>' + (o.body || 'We could not finish loading. Check your connection, then try again.') + '</span>'
      + (o.action === false ? ''
        : '<br><button class="es-cta" type="button" onclick="' + (o.action || 'location.reload()') + '">'
          + (o.label || 'Try again') + '</button>')
      + '</div>';
  };

  /* If the SDK didn't load, say so instead of dying. Without this guard the next line throws
     ReferenceError BEFORE window.LL is assigned, store-firebase.js then throws TypeError reading
     window.LL.auth, and the whole boot state machine dies silently — leaving the parent on the static
     "Loading the app..." fallback forever, with no error and nothing to tap. A parent at 3am needs to
     be told it's the connection, not left staring at a dead screen.
     The guard tests auth and firestore too, not just initializeApp. The four SDK files are four
     separate requests, so a connection that drops midway can land firebase-app and not
     firebase-firestore: initializeApp exists, this guard used to pass, and then firebase.firestore()
     below threw OUTSIDE the try. Same dead screen, and this time with no card at all. */
  if (typeof firebase === 'undefined' || !firebase.initializeApp || !firebase.auth || !firebase.firestore) {
    try {
      var ov = document.getElementById('llAuthOv') || document.body;
      ov.innerHTML = window.cubbyConnCard();
    } catch (e) {}
    return;
  }
  var firebaseConfig = {
    apiKey: "AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU",
    /* Auth runs on Firebase's own always-on domain. We previously proxied /__/auth/* through the
       edge worker so the Google popup said little-cubby.com, but that proxy 404'd for some
       regions/clients and broke Google + Apple sign-in (2026-07-13). Reverted to the reliable
       firebaseapp.com origin per the documented fallback. Trade-off: the sign-in popup briefly
       shows this domain instead of little-cubby.com. Re-brand only after the proxy is proven
       stable across regions. */
    authDomain: "little-log-a9caa.firebaseapp.com",
    projectId: "little-log-a9caa",
    storageBucket: "little-log-a9caa.firebasestorage.app",
    messagingSenderId: "657437500368",
    appId: "1:657437500368:web:1267eb04555d34fe9fcfd5"
  };

  firebase.initializeApp(firebaseConfig);

  var auth = firebase.auth();
  var db = firebase.firestore();

  // Localhost-only cloud-path test hook (?fsemu=<port>&fsuid=<uid>), sibling of the ?e2e=1 hook
  // in store-firebase.js: point Firestore at the local emulator and stand in a stub signed-in
  // user, so the REAL sync layer (resolveHousehold -> startSync -> persist) can be driven
  // headlessly by test/*.test.js. The hostname guard means this can NEVER engage in prod, and a
  // stray flag on prod hostnames changes nothing. Must run before any other Firestore call.
  try {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      var _emuQ = new URLSearchParams(location.search);
      var _emuPort = parseInt(_emuQ.get('fsemu'), 10);
      /* ?authemu=<port> — the SIGN-IN sibling of ?fsemu, and the reason it exists: the fsemu hook below
         REPLACES auth with a stub carrying a fixed currentUser, which is perfect for testing the sync
         layer and useless for testing sign-in, because it bypasses sign-in entirely. With authemu the
         REAL Firebase Auth SDK runs, pointed at the Auth emulator, so signInWithCustomToken genuinely
         creates a session in this browsing context — which is the exact property the installed-iOS bug
         was about. Same hostname guard, so it can never engage anywhere real. */
      var _authPort = parseInt(_emuQ.get('authemu'), 10);
      if (_authPort) {
        try { auth.useEmulator('http://localhost:' + _authPort, { disableWarnings: true }); } catch (e) {}
      }
      if (_emuPort) {
        db.useEmulator('localhost', _emuPort);
        var _emuUser = {
          uid: _emuQ.get('fsuid') || 'EMU1', email: (_emuQ.get('fsuid') || 'emu1') + '@emu.test',
          displayName: 'Emu Parent', photoURL: ''
        };
        if (!_authPort) auth = {
          currentUser: _emuUser,
          onAuthStateChanged: function (cb) { setTimeout(function () { cb(_emuUser); }, 0); return function () {}; },
          getRedirectResult: function () { return Promise.resolve({}); },
          isSignInWithEmailLink: function () { return false; },
          setPersistence: function () { return Promise.resolve(); },
          signOut: function () { return Promise.resolve(); }
        };
      }
    }
  } catch (e) {}

  // Keep the user signed in across launches (important for an installed PWA).
  try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}

  // Offline support: cache Firestore data so the app works without a connection
  // and syncs when it returns. Falls back gracefully if the browser blocks it.
  try {
    db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
  } catch (e) {}

  // Expose for the app's sync layer.
  window.LL = window.LL || {};
  window.LL.auth = auth;
  window.LL.db = db;
  window.LL.googleProvider = new firebase.auth.GoogleAuthProvider();
  // Sign in with Apple (required by App Store guideline 4.8 once Google sign-in
  // ships in the wrapped app). Configured in the Firebase console: Authentication
  // -> Sign-in method -> Apple, using an Apple Services ID + key. The OAuth redirect
  // lands on /__/auth/handler, which worker.js already proxies to Firebase.
  window.LL.appleProvider = (function () {
    var p = new firebase.auth.OAuthProvider('apple.com');
    p.addScope('email');
    p.addScope('name');
    return p;
  })();
  window.LL.serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;
})();
