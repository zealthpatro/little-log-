/* ============================================================
   LITTLE LOG: cloud auth + sync layer
   - Google sign-in gate
   - one shared "household" (members: owner | caregiver)
   - real-time sync: events subcollection + app blob + photos subcollection
   - diff-based push inside persist(): the app's ~10 save functions are untouched
   - timers / activeBabyId / theme stay per-device (not shared)
   ============================================================ */
(function () {
  var auth = window.LL.auth, db = window.LL.db;
  var LOCAL_PREFS_KEY = 'little-log-prefs-v1'; // per-device: activeBabyId, timers, theme

  var hhRef = null, eventsRef = null, photosRef = null;
  var booted = false;
  var unsub = [];
  var knownEvents = {};      // id -> JSON of last-synced event (for diffing)
  var applyingRemote = false;
  var pushTimer = null;

  /* ---------- styles for the sign-in overlay ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#llAuthOv{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#F7F2E8,#EFE6D6);display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '.ll-auth-card{background:#fff;border-radius:24px;padding:40px 28px;max-width:360px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12);}'
    + '.ll-auth-logo{font-size:54px;line-height:1;margin-bottom:8px;}'
    + '.ll-auth-card h1{font-family:"Fraunces",Georgia,serif;font-size:30px;margin:6px 0 4px;color:#2C2521;}'
    + '.ll-auth-card p{color:#6E635B;font-size:15px;margin:0 0 24px;line-height:1.4;}'
    + '.ll-auth-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid #E0D7C7;background:#fff;color:#2C2521;font-size:16px;font-weight:700;padding:14px 18px;border-radius:14px;cursor:pointer;font-family:inherit;}'
    + '.ll-auth-btn:hover{background:#FBF7EF;}.ll-auth-btn:disabled{opacity:.6;cursor:default;}'
    + '.ll-auth-msg{margin-top:16px;color:#9a8d80;font-size:13px;line-height:1.4;}'
    + '.ll-spin{width:30px;height:30px;border:3px solid #E0D7C7;border-top-color:#C97FA0;border-radius:50%;margin:6px auto 0;animation:llspin 0.9s linear infinite;}'
    + '@keyframes llspin{to{transform:rotate(360deg);}}';
  document.head.appendChild(st);

  function overlay() {
    var ov = document.getElementById('llAuthOv');
    if (!ov) { ov = document.createElement('div'); ov.id = 'llAuthOv'; document.body.appendChild(ov); }
    return ov;
  }
  function hideOverlay() { var ov = document.getElementById('llAuthOv'); if (ov) ov.remove(); }

  function showSignIn(msg) {
    overlay().innerHTML =
      '<div class="ll-auth-card"><div class="ll-auth-logo">🍼</div>'
      + '<h1>Little Log</h1><p>A warm, private baby log you can share with the people who care for them.</p>'
      + '<button id="llGoogleBtn" class="ll-auth-btn">Continue with Google</button>'
      + (msg ? '<div class="ll-auth-msg">' + msg + '</div>' : '') + '</div>';
    document.getElementById('llGoogleBtn').onclick = signInGoogle;
  }
  function showStatus(msg) {
    overlay().innerHTML =
      '<div class="ll-auth-card"><div class="ll-auth-logo">🍼</div>'
      + '<h1>Little Log</h1><div class="ll-spin"></div>'
      + '<div class="ll-auth-msg">' + (msg || 'Loading…') + '</div></div>';
  }

  function signInGoogle() {
    var btn = document.getElementById('llGoogleBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    auth.signInWithPopup(window.LL.googleProvider).catch(function (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request'
        || err.code === 'auth/operation-not-supported-in-this-environment')) {
        auth.signInWithRedirect(window.LL.googleProvider); return;
      }
      showSignIn('Sign-in failed: ' + ((err && err.message) || err));
    });
  }

  window.LL.signOut = function () {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    teardown(); auth.signOut();
  };

  function teardown() {
    unsub.forEach(function (u) { try { u(); } catch (e) {} });
    unsub = []; booted = false; knownEvents = {};
    hhRef = eventsRef = photosRef = null;
  }

  /* ---------- per-device prefs ---------- */
  function loadPrefs() { try { var v = localStorage.getItem(LOCAL_PREFS_KEY); return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }
  function savePrefs() {
    try {
      localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify({
        activeBabyId: state.activeBabyId, timers: state.timers || {},
        theme: (state.settings && state.settings.theme) || 'light'
      }));
    } catch (e) {}
  }

  /* ---------- household resolution ---------- */
  function membersMap(uid, r) { var m = {}; m[uid] = r; return m; }
  function memberInfoMap(user, r) { var m = {}; m[user.uid] = { name: user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', role: r }; return m; }
  function memberUpdate(user, r) {
    var u = {};
    u['members.' + user.uid] = r;
    u['memberInfo.' + user.uid] = { name: user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', role: r };
    return u;
  }

  async function buildMigrationPayload() {
    var app = { babies: [], settings: state.settings, milestones: [], meds: [], vaccines: {}, illnesses: [], photos: [] };
    var events = [], photos = {};
    try {
      var raw = localStorage.getItem('little-log-v1');
      if (raw) {
        var s = JSON.parse(raw);
        if (s) {
          app.babies = s.babies || []; app.settings = s.settings || state.settings;
          app.milestones = s.milestones || []; app.meds = s.meds || [];
          app.vaccines = s.vaccines || {}; app.illnesses = s.illnesses || [];
          app.photos = s.photos || [];
          events = s.events || [];
        }
      }
      var praw = localStorage.getItem('little-log-photos-v1');
      if (praw) photos = JSON.parse(praw) || {};
    } catch (e) {}
    return { app: app, events: events, photos: photos };
  }

  async function resolveHousehold(user) {
    var userRef = db.collection('users').doc(user.uid);
    var snap = await userRef.get();
    if (snap.exists && snap.data().householdId) return snap.data().householdId;

    // Invited? Invites are keyed by lowercased email (so the rules can authorize the join).
    var email = (user.email || '').toLowerCase();
    if (email) {
      var inv = await db.collection('invites').doc(email).get();
      if (inv.exists) {
        var data = inv.data();
        await db.collection('households').doc(data.householdId).update(memberUpdate(user, data.role || 'caregiver'));
        await userRef.set({ householdId: data.householdId, name: user.displayName || '', email: user.email || '' }, { merge: true });
        return data.householdId;
      }
    }

    // Otherwise create a fresh household (this user is the owner) and migrate any local data.
    var newRef = db.collection('households').doc();
    var m = await buildMigrationPayload();
    await newRef.set({
      ownerId: user.uid,
      members: membersMap(user.uid, 'owner'),
      memberInfo: memberInfoMap(user, 'owner'),
      app: m.app,
      createdAt: window.LL.serverTimestamp()
    });
    var writes = [];
    m.events.forEach(function (ev) { writes.push(newRef.collection('events').doc(String(ev.id)).set(Object.assign({ authorId: user.uid }, ev))); });
    Object.keys(m.photos).forEach(function (pid) { writes.push(newRef.collection('photos').doc(pid).set({ data: m.photos[pid], authorId: user.uid })); });
    await Promise.all(writes);
    await userRef.set({ householdId: newRef.id, name: user.displayName || '', email: user.email || '' }, { merge: true });
    return newRef.id;
  }

  /* ---------- state <-> cloud blob ---------- */
  function appBlobFromState() {
    return {
      babies: state.babies || [], settings: state.settings || {},
      milestones: state.milestones || [], meds: state.meds || [],
      vaccines: state.vaccines || {}, illnesses: state.illnesses || [],
      photos: state.photos || []
    };
  }
  function applyAppBlob(app) {
    if (!app) return;
    state.babies = app.babies || [];
    state.settings = Object.assign({}, app.settings || {});
    state.milestones = app.milestones || [];
    state.meds = app.meds || [];
    state.vaccines = app.vaccines || {};
    state.illnesses = app.illnesses || [];
    state.photos = app.photos || [];
    normalizeLoadedState(state); // defensive legacy migrations
  }
  function stripMeta(ev) { var c = Object.assign({}, ev); delete c.authorId; return c; }

  /* ---------- start real-time sync ---------- */
  function startSync(hid, user) {
    hhRef = db.collection('households').doc(hid);
    eventsRef = hhRef.collection('events');
    photosRef = hhRef.collection('photos');

    var prefs = loadPrefs();
    var gotApp = false, gotEvents = false;

    function maybeBoot() {
      if (booted || !(gotApp && gotEvents)) return;
      state.timers = prefs.timers || {};
      if (prefs.theme) state.settings.theme = prefs.theme;
      state.activeBabyId = prefs.activeBabyId || (state.babies[0] && state.babies[0].id) || null;
      if (state.activeBabyId && !state.babies.some(function (b) { return b.id === state.activeBabyId; }))
        state.activeBabyId = (state.babies[0] && state.babies[0].id) || null;
      booted = true;
      hideOverlay();
      render();
    }

    unsub.push(hhRef.onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data();
      window.LL.role = (d.members && d.members[user.uid]) || 'caregiver';
      window.LL.members = d.members || {};
      window.LL.memberInfo = d.memberInfo || {};
      window.LL.householdId = hid;
      applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;
      gotApp = true;
      if (booted) render(); else maybeBoot();
    }, function (e) { console.warn('household listen', e); }));

    unsub.push(eventsRef.onSnapshot(function (snap) {
      applyingRemote = true;
      snap.docChanges().forEach(function (ch) {
        var data = ch.doc.data(); data.id = ch.doc.id;
        if (ch.type === 'removed') {
          state.events = (state.events || []).filter(function (e) { return String(e.id) !== String(data.id); });
          delete knownEvents[data.id];
        } else {
          var i = (state.events || []).findIndex(function (e) { return String(e.id) === String(data.id); });
          if (i >= 0) state.events[i] = data; else (state.events = state.events || []).push(data);
          knownEvents[data.id] = JSON.stringify(stripMeta(data));
        }
      });
      applyingRemote = false;
      gotEvents = true;
      if (booted) render(); else maybeBoot();
    }, function (e) { console.warn('events listen', e); }));

    unsub.push(photosRef.onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') delete PhotoStore.map[ch.doc.id];
        else PhotoStore.map[ch.doc.id] = ch.doc.data().data;
      });
      if (booted) render();
    }, function (e) { console.warn('photos listen', e); }));
  }

  /* ---------- push local changes to the cloud (override persist) ---------- */
  function scheduledPush() {
    savePrefs();
    if (applyingRemote) return; // don't echo remote-applied changes back
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 350);
  }
  async function pushNow() {
    pushTimer = null;
    if (!hhRef) return;
    var uidNow = auth.currentUser && auth.currentUser.uid;
    var cur = {}; (state.events || []).forEach(function (e) { cur[e.id] = e; });
    var writes = [];
    Object.keys(cur).forEach(function (id) {
      var ser = JSON.stringify(stripMeta(cur[id]));
      if (knownEvents[id] !== ser) {
        knownEvents[id] = ser;
        writes.push(eventsRef.doc(String(id)).set(Object.assign({ authorId: cur[id].authorId || uidNow }, cur[id])));
      }
    });
    Object.keys(knownEvents).forEach(function (id) {
      if (!cur[id]) { delete knownEvents[id]; writes.push(eventsRef.doc(String(id)).delete()); }
    });
    writes.push(hhRef.update({ app: appBlobFromState(), updatedAt: window.LL.serverTimestamp() }));
    try { await Promise.all(writes); } catch (e) { console.warn('push', e); }
  }

  // Swap the app's persistence + photo storage for the cloud versions.
  persist = async function () { scheduledPush(); };

  PhotoStore.set = async function (id, dataUrl) {
    PhotoStore.map[id] = dataUrl;
    if (photosRef) { try { await photosRef.doc(String(id)).set({ data: dataUrl, authorId: (auth.currentUser && auth.currentUser.uid) || null }); } catch (e) { console.warn('photo set', e); } }
  };
  PhotoStore.del = async function (id) {
    delete PhotoStore.map[id];
    if (photosRef) { try { await photosRef.doc(String(id)).delete(); } catch (e) {} }
  };
  PhotoStore.load = async function () {};
  PhotoStore.save = async function () {};

  /* ---------- auth state machine ---------- */
  showStatus('Loading…'); // cover the app until we know whether you're signed in
  auth.getRedirectResult().catch(function () {});
  auth.onAuthStateChanged(async function (user) {
    if (!user) { teardown(); showSignIn(''); return; }
    try {
      showStatus('Setting things up…');
      var hid = await resolveHousehold(user);
      startSync(hid, user);
    } catch (err) {
      console.error(err);
      showSignIn('Could not load your data: ' + ((err && err.message) || err));
    }
  });
})();
