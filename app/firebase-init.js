/* Cubby: Firebase initialization.
   These config values are public by design (Firebase web config is not a secret).
   Security is enforced by Firestore rules, not by hiding this. */
(function () {
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
