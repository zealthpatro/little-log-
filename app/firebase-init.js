/* Cubby: Firebase initialization.
   These config values are public by design (Firebase web config is not a secret).
   Security is enforced by Firestore rules, not by hiding this. */
(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU",
    /* Auth runs on our own domain: the edge worker proxies /__/auth/* to the
       firebaseapp.com origin, so the Google popup says little-cubby.com.
       (Revert to "little-log-a9caa.firebaseapp.com" if sign-in ever breaks.) */
    authDomain: "little-cubby.com",
    projectId: "little-log-a9caa",
    storageBucket: "little-log-a9caa.firebasestorage.app",
    messagingSenderId: "657437500368",
    appId: "1:657437500368:web:1267eb04555d34fe9fcfd5"
  };

  firebase.initializeApp(firebaseConfig);

  // App Check — bot/abuse defense (reCAPTCHA v3). It makes Firestore/Auth reject requests that
  // don't come from the real app. Enforcement is toggled in the Firebase console; keep it in
  // MONITOR mode until the verified-traffic metric is clean, then enforce. Wrapped in try/catch so
  // a blocked or failed reCAPTCHA (privacy blockers, offline) never prevents the app from booting.
  // On localhost we use a debug token instead of reCAPTCHA so the local + e2e harness keeps working.
  try {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    if (firebase.appCheck) {
      firebase.appCheck().activate('6LdxBlEtAAAAAICwaxnu9HH20CF8skr5jRglmiXP', true);
    }
  } catch (e) { /* App Check must never block boot */ }

  var auth = firebase.auth();
  var db = firebase.firestore();

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
