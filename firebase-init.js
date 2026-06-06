/* Little Log: Firebase initialization.
   These config values are public by design (Firebase web config is not a secret).
   Security is enforced by Firestore rules, not by hiding this. */
(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU",
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
  window.LL.serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;
})();
