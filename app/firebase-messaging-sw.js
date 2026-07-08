/* Cubby push: background notification handler.
   This is a SEPARATE service worker from sw.js (the precache SW); Firebase Cloud Messaging
   requires its own firebase-messaging-sw.js at the app scope. It only does anything once
   Cloud Messaging is enabled and a VAPID key is set in the app (CUBBY_VAPID in index.html).
   Config values are public by design (security is enforced by Firestore rules). */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU',
  authDomain: 'little-cubby.com',
  projectId: 'little-log-a9caa',
  storageBucket: 'little-log-a9caa.firebasestorage.app',
  messagingSenderId: '657437500368',
  appId: '1:657437500368:web:1267eb04555d34fe9fcfd5'
});

try {
  var messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    var n = (payload && payload.notification) || {};
    var d = (payload && payload.data) || {};
    self.registration.showNotification(n.title || 'Cubby', {
      body: n.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.tag || 'cubby',
      data: d
    });
  });
} catch (e) { /* messaging unsupported on this browser; the app falls back to in-app reminders */ }

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
      for (var i = 0; i < cl.length; i++) { if (cl[i].url.indexOf('/app') >= 0 && 'focus' in cl[i]) return cl[i].focus(); }
      if (clients.openWindow) return clients.openWindow('/app/');
    })
  );
});
