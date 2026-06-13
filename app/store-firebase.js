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
  var firstRunShown = false;
  var lastHhSig = null; // signature of the last-applied household doc (dedupes our own write echoes)

  /* ---------- maternal-private health (Privacy Max, gate G1) ----------
     The mother's clinical data NEVER enters the shared `app` blob. It lives in
     households/{hid}/mhealth/{ownerUid}/cat/{category}, written only by the owner,
     readable by the owner + any guardian uid she lists in sharedWith. `mood` (EPDS)
     is reserved and owner-only forever (no client feature yet). The 79 in-memory
     call sites are untouched; the privacy boundary is here, at sync time. */
  var MAT_CATS = {
    health:     ['weights', 'bp', 'glucose', 'glucoseUnit', 'urine', 'nausea', 'symptoms', 'supplements', 'supplementLog'],
    careteam:   ['careTeam'],
    conditions: ['conditions']
    // 'mood' reserved (EPDS) — owner-only forever; never serialized, never shareable.
  };
  var MAT_PRIVATE_KEYS = Object.keys(MAT_CATS).reduce(function (a, c) { return a.concat(MAT_CATS[c]); }, []);
  var matUnsub = [];      // mhealth doc listeners
  var matOwner = null;    // uid we are currently listening to
  var matShared = {};     // category -> sharedWith[] (last seen, so a data write keeps consent)
  var knownMat = {};      // category -> sig of last-synced {data, sharedWith} (diffing)

  /* ---------- styles for the sign-in overlay ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#llAuthOv{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#F7F2E8,#EFE6D6);display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '.ll-auth-card{background:#fff;border-radius:24px;padding:40px 28px;max-width:360px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12);}'
    + '.ll-auth-logo{font-size:54px;line-height:1;margin-bottom:8px;}'
    + '.ll-auth-logo-img{width:84px;height:84px;border-radius:20px;display:block;margin:0 auto 12px;box-shadow:0 6px 18px rgba(0,0,0,.12);}'
    + '.ll-auth-card h1{font-family:"Fraunces",Georgia,serif;font-size:30px;margin:6px 0 4px;color:#2C2521;}'
    + '.ll-auth-card p{color:#6E635B;font-size:15px;margin:0 0 24px;line-height:1.4;}'
    + '.ll-auth-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid #E0D7C7;background:#fff;color:#2C2521;font-size:16px;font-weight:700;padding:14px 18px;border-radius:14px;cursor:pointer;font-family:inherit;}'
    + '.ll-auth-btn:hover{background:#FBF7EF;}.ll-auth-btn:disabled{opacity:.6;cursor:default;}'
    + '.ll-auth-msg{margin-top:16px;color:#9a8d80;font-size:13px;line-height:1.4;}'
    + '.ll-values{text-align:left;margin:4px 0 20px;display:flex;flex-direction:column;gap:9px;}'
    + '.ll-values div{display:flex;align-items:center;gap:10px;font-size:13.5px;color:#6E635B;font-weight:600;}'
    + '.ll-values span{font-size:16px;flex:0 0 auto;width:20px;text-align:center;}'
    + '.ll-spin{width:30px;height:30px;border:3px solid #E0D7C7;border-top-color:#C97FA0;border-radius:50%;margin:6px auto 0;animation:llspin 0.9s linear infinite;}'
    + '@keyframes llspin{to{transform:rotate(360deg);}}'
    + '#llModalOv{position:fixed;inset:0;z-index:99998;background:rgba(20,15,12,.45);display:flex;align-items:flex-end;justify-content:center;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '.ll-modal{background:#fff;width:100%;max-width:440px;border-radius:22px 22px 0 0;padding:20px 20px 28px;max-height:85vh;overflow:auto;box-shadow:0 -8px 40px rgba(0,0,0,.2);}'
    + '@media(min-width:480px){#llModalOv{align-items:center;}.ll-modal{border-radius:22px;}}'
    + '.ll-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}'
    + '.ll-modal-head h2{font-family:"Fraunces",Georgia,serif;font-size:22px;margin:0;color:#2C2521;}'
    + '#llModalX{border:none;background:none;font-size:28px;line-height:1;color:#9a8d80;cursor:pointer;}'
    + '.ll-mems{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;}'
    + '.ll-mem{display:flex;align-items:center;justify-content:space-between;background:#FBF7EF;border-radius:12px;padding:10px 12px;}'
    + '.ll-mem-name{font-weight:700;color:#2C2521;font-size:15px;}.ll-mem-email{color:#9a8d80;font-size:12px;}'
    + '.ll-mem-role{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#C97FA0;font-weight:700;}'
    + '.ll-invite{display:flex;flex-direction:column;gap:8px;border-top:1px solid #efe6d6;padding-top:16px;}'
    + '.ll-invite label{font-weight:700;color:#2C2521;font-size:14px;}'
    + '.ll-invite input,.ll-invite select{border:1px solid #E0D7C7;border-radius:10px;padding:11px 12px;font-size:15px;font-family:inherit;background:#fff;}'
    + '.ll-modal-btn{border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;background:#C97FA0;color:#fff;cursor:pointer;font-family:inherit;}'
    + '.ll-modal-btn:disabled{opacity:.6;}.ll-ghost{background:#FBF7EF;color:#6E635B;margin-top:18px;width:100%;}'
    + '.ll-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#6E635B;line-height:1.35;cursor:pointer;}'
    + '.ll-check input{margin-top:2px;flex:0 0 auto;width:16px;height:16px;}'
    + '.ll-linkrow{display:flex;gap:8px;}'
    + '.ll-linkrow input{flex:1;min-width:0;border:1px solid #E0D7C7;border-radius:10px;padding:11px 12px;font-size:13px;font-family:inherit;background:#FBF7EF;color:#6E635B;}'
    + '.ll-linkrow .ll-modal-btn{width:auto;padding:11px 16px;white-space:nowrap;}'
    + '.tl-by{font-size:11px;color:var(--ink-soft,#9a8d80);opacity:.85;margin-top:2px;}'
    + '.nap-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 12px;font-size:14px;color:var(--ink,#2C2521);cursor:pointer;}'
    + '.nap-toggle input{position:absolute;opacity:0;width:0;height:0;}'
    + '.nap-switch{width:44px;height:25px;border-radius:999px;background:#D9CDBB;position:relative;transition:.2s;flex:0 0 auto;}'
    + '.nap-switch::after{content:"";position:absolute;top:2px;left:2px;width:21px;height:21px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2);}'
    + '.nap-toggle input:checked + .nap-switch{background:var(--sleep,#7C8FB5);}'
    + '.nap-toggle input:checked + .nap-switch::after{transform:translateX(19px);}'
    + '.ll-mem-av{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:0 0 auto;}.ll-mem-av svg{width:100%;height:100%;display:block;}';
  document.head.appendChild(st);

  function overlay() {
    var ov = document.getElementById('llAuthOv');
    if (!ov) { ov = document.createElement('div'); ov.id = 'llAuthOv'; document.body.appendChild(ov); }
    return ov;
  }
  function hideOverlay() { var ov = document.getElementById('llAuthOv'); if (ov) ov.remove(); }

  function showSignIn(msg) {
    var ov = overlay();
    if (typeof window.cubbyLanding === 'function') {
      ov.classList.add('landing');
      ov.innerHTML = window.cubbyLanding(msg);
      Array.prototype.forEach.call(ov.querySelectorAll('.ll-cta'), function (b) { b.onclick = signInGoogle; });
      return;
    }
    ov.classList.remove('landing');
    ov.innerHTML =
      '<div class="ll-auth-card"><img src="/icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
      + '<h1>Cubby</h1><p>A warm, private baby log you can share with the people who care for them.</p>'
      + '<div class="ll-values"><div><span>⚡</span>Log feeds, sleep &amp; nappies in seconds</div><div><span>👨‍👩‍👧</span>Share with family &amp; caregivers, live</div><div><span>🔒</span>Private to your family</div></div>'
      + '<button id="llGoogleBtn" class="ll-auth-btn">Continue with Google</button>'
      + (msg ? '<div class="ll-auth-msg">' + msg + '</div>' : '') + '</div>';
    document.getElementById('llGoogleBtn').onclick = signInGoogle;
  }
  function showStatus(msg) {
    overlay().classList.remove('landing');
    overlay().innerHTML =
      '<div class="ll-auth-card"><img src="/icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
      + '<h1>Cubby</h1><div class="ll-spin"></div>'
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
        activeBabyId: state.activeBabyId,
        theme: (state.settings && state.settings.theme) || 'light'
      }));
    } catch (e) {}
  }

  /* ---------- household resolution ---------- */
  function membersMap(uid, r) { var m = {}; m[uid] = r; return m; }
  function memberInfoMap(user, r, rel) { var m = {}; m[user.uid] = { name: user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', role: r, relationship: rel || '' }; return m; }
  function memberUpdate(user, r, opts) {
    opts = opts || {};
    var u = {};
    u['members.' + user.uid] = r;
    u['memberInfo.' + user.uid] = { name: opts.name || user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', role: r, relationship: opts.relationship || '' };
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
        await db.collection('households').doc(data.householdId).update(memberUpdate(user, data.role || 'caregiver', { relationship: data.relationship, name: data.name }));
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
  // Copy of state.pregnancy with all maternal-private fields removed — what's safe for the shared blob.
  function sharedPregnancy(p) {
    if (!p) return null;
    var out = {};
    Object.keys(p).forEach(function (k) { if (MAT_PRIVATE_KEYS.indexOf(k) < 0) out[k] = p[k]; });
    return out;
  }
  // Merge the shared (non-private) pregnancy fields from the blob, preserving private fields
  // already loaded from the mhealth listener (the blob never carries them).
  function mergeSharedPreg(shared) {
    if (!shared) { state.pregnancy = null; matOwner = null; return; }
    var p = state.pregnancy || {};
    if (p.id && shared.id && p.id !== shared.id) p = {}; // different pregnancy → drop stale private fields
    Object.keys(shared).forEach(function (k) { p[k] = shared[k]; });
    state.pregnancy = p;
  }
  function appBlobFromState() {
    return {
      babies: state.babies || [], settings: state.settings || {},
      milestones: state.milestones || [], meds: state.meds || [],
      vaccines: state.vaccines || {}, illnesses: state.illnesses || [],
      photos: state.photos || [],
      handoff: state.handoff || null,  // shared parent<->caregiver note
      pregnancy: sharedPregnancy(state.pregnancy),  // shared journey only; maternal-private fields stripped out (G1)
      den: state.den || null,  // household hub: chores, shopping, meals, staff, expenses, weights
      consents: state.consents || [],  // dual-guardian approvals for big actions (delete/export)
      guardians: state.guardians || null,  // explicit guardian uids (papa + mama); derived if null
      timers: state.timers || {}   // shared so an ongoing nap/feed shows on every phone
    };
  }
  function applyAppBlob(app) {
    if (!app) return;
    var localTheme = state.settings && state.settings.theme; // theme is per-device
    state.babies = app.babies || [];
    state.settings = Object.assign({}, app.settings || {});
    if (localTheme) state.settings.theme = localTheme;
    state.milestones = app.milestones || [];
    state.meds = app.meds || [];
    state.vaccines = app.vaccines || {};
    state.illnesses = app.illnesses || [];
    state.photos = app.photos || [];
    state.handoff = app.handoff || null;
    mergeSharedPreg(app.pregnancy);  // private fields stay; only the shared journey comes from the blob (G1)
    state.den = app.den || null;
    state.consents = app.consents || [];
    state.guardians = app.guardians || null;
    // Don't stomp a timer the local user just started but hasn't pushed yet.
    if (!pushTimer) state.timers = app.timers || {};
    normalizeLoadedState(state); // defensive legacy migrations
  }
  function stripMeta(ev) { var c = Object.assign({}, ev); delete c.authorId; return c; }
  function stableStringify(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stableStringify(o[k]); }).join(',') + '}';
  }
  function hhSig(app, members, memberInfo) { return stableStringify([app || null, members || null, memberInfo || null]); }

  /* ---------- maternal-private sync (mhealth subcollection) ---------- */
  // Fold a category doc's data back into state.pregnancy (private fields live in memory only).
  function applyMatDoc(cat, d) {
    if (!d) return;
    matShared[cat] = d.sharedWith || [];
    knownMat[cat] = stableStringify([d.data || {}, matShared[cat]]); // don't immediately re-write what we just received
    if (!state.pregnancy) state.pregnancy = {};
    var data = d.data || {};
    Object.keys(data).forEach(function (k) { state.pregnancy[k] = data[k]; });
  }
  // Listen to the owner's category docs we're permitted to read (own collection, or specific shared docs).
  function ensureMaternalListeners(uidNow) {
    var p = state.pregnancy;
    var owner = p && p.ownerUid;
    if (!owner || owner === 'local') return;     // no real owner yet
    if (owner === matOwner) return;              // already listening for this owner
    matUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    matUnsub = []; matShared = {}; knownMat = {};
    matOwner = owner;
    var base = hhRef.collection('mhealth').doc(owner).collection('cat');
    if (owner === uidNow) {
      // The owner reads her whole category collection.
      matUnsub.push(base.onSnapshot(function (snap) {
        applyingRemote = true;
        snap.forEach(function (doc) { applyMatDoc(doc.id, doc.data()); });
        applyingRemote = false;
        if (booted) render();
      }, function (e) { console.warn('mhealth own listen', e); }));
    } else {
      // A non-owner: try each shareable category; ones not shared with us fail permission and are ignored.
      Object.keys(MAT_CATS).forEach(function (cat) {
        if (cat === 'mood') return; // never shared
        matUnsub.push(base.doc(cat).onSnapshot(function (doc) {
          if (!doc.exists) return;
          applyingRemote = true; applyMatDoc(cat, doc.data()); applyingRemote = false;
          if (booted) render();
        }, function (e) { /* permission-denied = not shared with me; ignore */ }));
      });
    }
  }
  // The owner writes her changed category docs (data + current sharedWith). No-op for non-owners.
  async function syncMaternal(uidNow) {
    var p = state.pregnancy;
    if (!hhRef || !p || !p.ownerUid || p.ownerUid !== uidNow) return; // only the owner writes her own health
    var base = hhRef.collection('mhealth').doc(uidNow).collection('cat');
    var writes = [];
    Object.keys(MAT_CATS).forEach(function (cat) {
      var data = {};
      MAT_CATS[cat].forEach(function (k) { if (p[k] !== undefined) data[k] = p[k]; });
      var shared = matShared[cat] || [];
      var sig = stableStringify([data, shared]);
      if (knownMat[cat] === sig) return;
      knownMat[cat] = sig;
      writes.push(base.doc(cat).set({ ownerUid: uidNow, category: cat, data: data, sharedWith: shared, updatedAt: window.LL.serverTimestamp() }));
    });
    if (writes.length) { try { await Promise.all(writes); } catch (e) { console.warn('mhealth push', e); } }
  }

  /* ---------- start real-time sync ---------- */
  function startSync(hid, user) {
    hhRef = db.collection('households').doc(hid);
    eventsRef = hhRef.collection('events');
    photosRef = hhRef.collection('photos');

    var prefs = loadPrefs();
    var gotApp = false, gotEvents = false;

    function maybeBoot() {
      if (booted || !(gotApp && gotEvents)) return;
      if (!state.timers) state.timers = {}; // timers come from the cloud app blob
      if (prefs.theme) state.settings.theme = prefs.theme;
      state.activeBabyId = prefs.activeBabyId || (state.babies[0] && state.babies[0].id) || null;
      if (state.activeBabyId && !state.babies.some(function (b) { return b.id === state.activeBabyId; }))
        state.activeBabyId = (state.babies[0] && state.babies[0].id) || null;
      booted = true;
      // One-time relocation: if a legacy blob carried maternal-private fields, the owner moves
      // them into the protected mhealth docs and strips them from the shared blob on next push.
      if (state.pregnancy && window.LL.role === 'owner' && MAT_PRIVATE_KEYS.some(function (k) { return state.pregnancy[k] !== undefined; })) {
        scheduledPush();
      }
      hideOverlay();
      render();
      maybeFirstRun(user);
    }

    unsub.push(hhRef.onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data();
      window.LL.role = (d.members && d.members[user.uid]) || 'caregiver';
      window.LL.members = d.members || {};
      window.LL.memberInfo = d.memberInfo || {};
      window.LL.formerMemberInfo = d.formerMemberInfo || {};
      window.LL.householdId = hid;
      var sig = hhSig(d.app, d.members, d.memberInfo);
      if (booted && sig === lastHhSig) return; // our own write echo / duplicate emission, already on screen
      lastHhSig = sig;
      applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;
      ensureMaternalListeners(user.uid); // (re)subscribe once we know whose pregnancy it is
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
      if (!booted) maybeBoot();
      else if (!(snap.metadata && snap.metadata.hasPendingWrites)) render();
    }, function (e) { console.warn('events listen', e); }));

    unsub.push(photosRef.onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') delete PhotoStore.map[ch.doc.id];
        else PhotoStore.map[ch.doc.id] = ch.doc.data().data;
      });
      if (booted && !(snap.metadata && snap.metadata.hasPendingWrites)) render();
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
    // Assign/repair ownership: the household owner on this device owns the pregnancy she holds.
    // (Maternal data is only ever written by its owner; this claims a new or legacy/offline one.)
    if (state.pregnancy && (!state.pregnancy.ownerUid || state.pregnancy.ownerUid === 'local') && uidNow && window.LL.role === 'owner') {
      state.pregnancy.ownerUid = uidNow;
      ensureMaternalListeners(uidNow);
    }
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
    var appBlob = appBlobFromState();
    lastHhSig = hhSig(appBlob, window.LL.members, window.LL.memberInfo); // mark our own write so its echo doesn't re-render
    writes.push(hhRef.update({ app: appBlob, updatedAt: window.LL.serverTimestamp() }));
    try { await Promise.all(writes); } catch (e) { console.warn('push', e); }
    syncMaternal(uidNow); // owner-only; writes her private categories to the protected mhealth docs
  }

  // Swap the app's persistence + photo storage for the cloud versions.
  persist = async function () { scheduledPush(); };

  /* ---------- maternal sharing API (consumed by the consent UI in index.html) ---------- */
  // Owner = the subject of the pregnancy. Once an ownerUid is assigned, only that uid is owner.
  // While it is still unassigned/legacy, ONLY the household owner is the de-facto owner — a caregiver
  // is never treated as owner (so they can't see, claim, or write the mother's health). Solo mothers
  // are the household owner, so they always control their own data.
  window.LL.matIsOwner = function () {
    var u = auth.currentUser; if (!u) return true;
    var p = state.pregnancy; if (!p) return true;
    if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
    return window.LL.role === 'owner';
  };
  window.LL.matCanRead = function (cat) {
    var u = auth.currentUser, p = state.pregnancy;
    if (!u || !p) return true;
    if (p.ownerUid && p.ownerUid !== 'local') {
      if (p.ownerUid === u.uid) return true;
      if (cat === 'mood') return false;
      return (matShared[cat] || []).indexOf(u.uid) >= 0;
    }
    return window.LL.role === 'owner'; // unassigned/legacy: only the household owner may see it
  };
  window.LL.matShared = function (cat) { return (matShared[cat] || []).slice(); };
  // Owner sets who may see a category. `mood` can never be shared (also enforced in rules).
  // Claiming an unassigned pregnancy is role-gated (household owner only), mirroring pushNow — a
  // caregiver toggling a share can never become the owner as a side-effect.
  window.LL.matSetShared = async function (cat, uids) {
    var u = auth.currentUser, p = state.pregnancy;
    if (!hhRef || !u || !p) return false;
    if (cat === 'mood' || !MAT_CATS[cat]) return false;
    var owned = p.ownerUid && p.ownerUid !== 'local';
    if (owned && p.ownerUid !== u.uid) return false;        // someone else owns it
    if (!owned && window.LL.role !== 'owner') return false; // unassigned: only the household owner may claim
    if (!owned) p.ownerUid = u.uid;                          // claim (household owner only)
    matShared[cat] = (uids || []).slice();
    var data = {}; MAT_CATS[cat].forEach(function (k) { if (p[k] !== undefined) data[k] = p[k]; });
    knownMat[cat] = stableStringify([data, matShared[cat]]);
    try {
      await hhRef.collection('mhealth').doc(u.uid).collection('cat').doc(cat)
        .set({ ownerUid: u.uid, category: cat, data: data, sharedWith: matShared[cat], updatedAt: window.LL.serverTimestamp() });
      return true;
    } catch (e) { console.warn('matSetShared', e); return false; }
  };
  // Owner removes all her private category docs (called when a pregnancy is removed entirely).
  window.LL.matClear = async function () {
    var u = auth.currentUser; if (!hhRef || !u) return;
    var owner = matOwner || (state.pregnancy && state.pregnancy.ownerUid) || u.uid;
    if (owner !== u.uid) return; // only the owner clears her own
    var base = hhRef.collection('mhealth').doc(u.uid).collection('cat');
    try { await Promise.all(Object.keys(MAT_CATS).map(function (c) { return base.doc(c).delete(); })); } catch (e) {}
    knownMat = {}; matShared = {};
  };

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

  /* ---------- account / family sharing UI ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }


  function modal(title, bodyHtml) {
    closeModal();
    var ov = document.createElement('div'); ov.id = 'llModalOv';
    ov.innerHTML = '<div class="ll-modal"><div class="ll-modal-head"><h2>' + esc(title) + '</h2><button id="llModalX">×</button></div>' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.getElementById('llModalX').onclick = closeModal;
  }
  function closeModal() { var m = document.getElementById('llModalOv'); if (m) m.remove(); }

  var RELATIONSHIPS = ['Mama Bear', 'Papa Bear', 'Nana Bear', 'Grandpa Bear', 'Auntie Bear', 'Uncle Bear', 'Nanny', 'Caregiver', 'Other'];
  function relOptions(sel) {
    var list = RELATIONSHIPS.slice();
    if (sel && list.indexOf(sel) < 0) list.unshift(sel); // keep any previously-saved label
    return '<option value="">Relationship…</option>' + list.map(function (r) {
      return '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' + r + '</option>';
    }).join('');
  }

  function openFamily() {
    var me = auth.currentUser; if (!me) return;
    var myRole = window.LL.role || 'caregiver';
    var info = window.LL.memberInfo || {};
    var myRel = (info[me.uid] && info[me.uid].relationship) || '';

    var rows = Object.keys(info).map(function (uid) {
      var m = info[uid] || {};
      var who = m.relationship || (m.role === 'owner' ? 'Owner' : 'Caregiver');
      var av = (typeof window.memberAvatarSvg === 'function') ? '<span class="ll-mem-av">' + window.memberAvatarSvg(uid, 40) + '</span>' : '';
      var rm = (myRole === 'owner' && uid !== me.uid) ? '<button class="ll-rm" data-uid="' + uid + '" data-email="' + esc(m.email || '') + '" data-name="' + esc(m.name || m.email || 'this person') + '">Remove</button>' : '';
      return '<div class="ll-mem"><div style="display:flex;align-items:center;gap:10px">' + av + '<div><div class="ll-mem-name">' + esc(m.name || m.email || 'Member') + (uid === me.uid ? ' (you)' : '')
        + '</div><div class="ll-mem-email">' + esc(m.email || '') + '</div></div></div><div style="display:flex;align-items:center;gap:8px"><span class="ll-mem-role">' + esc(who) + '</span>' + rm + '</div></div>';
    }).join('') || '<div class="ll-auth-msg">Just you so far.</div>';

    var youRow = '<div class="ll-invite" style="border-top:none;padding-top:4px"><label>Your relationship to baby</label>'
      + '<select id="llMyRel">' + relOptions(myRel) + '</select>'
      + '<button id="llMyRelBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">Save relationship</button>'
      + '<button id="llMyBearBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">Change my bear avatar</button>'
      + '<button id="llMyFeedbackBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">💬 Send feedback</button>'
      + '<div id="llMyRelMsg" class="ll-auth-msg"></div></div>';

    var invite = (myRole === 'owner')
      ? '<div class="ll-invite"><label>Invite a family member</label>'
        + '<input id="llInvName" type="text" placeholder="Their name (optional)" autocomplete="off">'
        + '<input id="llInvEmail" type="email" placeholder="their-google-email@gmail.com" autocomplete="off" autocapitalize="off">'
        + '<select id="llInvRel">' + relOptions('') + '</select>'
        + '<label class="ll-check"><input type="checkbox" id="llInvOwner"><span>Co-owner, full control (can edit everyone\'s entries &amp; invite others)</span></label>'
        + '<button id="llInvBtn" class="ll-modal-btn">Create invite</button>'
        + '<div id="llInvMsg" class="ll-auth-msg"></div></div>'
      : '<div class="ll-auth-msg">Only an owner can invite new people.</div>';

    var share = '<div class="ll-invite"><label>App link to share</label>'
      + '<div class="ll-linkrow"><input id="llAppLink" readonly value="' + esc(location.origin) + '"><button id="llCopyLink" class="ll-modal-btn">Copy</button></div>'
      + '<div class="ll-auth-msg">Cubby doesn\'t send emails. Send this link yourself (text / WhatsApp); the invited person signs in with Google using the invited email and joins automatically.</div></div>';

    modal('Family & sharing', '<div class="ll-mems">' + rows + '</div>' + youRow + invite + share
      + '<button id="llSignOut" class="ll-modal-btn ll-ghost">Sign out</button>'
      + '<div class="ll-auth-msg" style="margin-top:10px">Cubby v' + (window.CUBBY_VERSION || '') + ' · beta</div>');

    document.getElementById('llSignOut').onclick = function () { closeModal(); window.LL.signOut(); };
    document.getElementById('llMyRelBtn').onclick = saveMyRelationship;
    document.getElementById('llMyBearBtn').onclick = function () { if (window.openBearPicker) window.openBearPicker('member', me.uid); };
    document.getElementById('llMyFeedbackBtn').onclick = openFeedback;
    document.getElementById('llCopyLink').onclick = copyAppLink;
    if (myRole === 'owner') document.getElementById('llInvBtn').onclick = submitInvite;
    Array.prototype.forEach.call(document.querySelectorAll('.ll-rm'), function (b) {
      b.onclick = function () { removeMember(b.getAttribute('data-uid'), b.getAttribute('data-email'), b.getAttribute('data-name')); };
    });
  }

  function maybeFirstRun(user) {
    if (firstRunShown) return;
    var mi = (window.LL.memberInfo || {})[user.uid] || {};
    if (mi.setupDone || mi.relationship) return;
    firstRunShown = true;
    openFirstRun(user);
  }
  function openFirstRun(user) {
    var uid = user.uid;
    var bear = (typeof window.memberAvatarSvg === 'function') ? window.memberAvatarSvg(uid, 84) : '';
    modal('Welcome to Cubby 🐻',
      '<div class="ll-auth-msg" style="margin:0 0 10px;text-align:left;line-height:1.5">An early beta, thanks for trying it! A few notes:<br>• Your log is <b>private</b> to your family.<br>• On a phone: <b>Share → Add to Home Screen</b> to install it like an app.<br>• Bug or idea? <b>Settings → Family &amp; sharing → Send feedback</b>.</div>'
      + '<div class="ll-auth-msg" style="margin:0 0 6px">First, how you appear to your family:</div>'
      + '<div class="ll-mem-av" id="llFrBear" style="width:84px;height:84px;margin:10px auto 4px;cursor:pointer">' + bear + '</div>'
      + '<div style="text-align:center;margin-bottom:6px"><button id="llFrBearBtn" class="ll-rm" style="color:#C97FA0">Customise my bear</button></div>'
      + '<div class="ll-invite" style="border-top:none;padding-top:8px"><label>Your relationship to baby</label><select id="llFrRel">' + relOptions('') + '</select></div>'
      + '<button id="llFrSave" class="ll-modal-btn">Save</button>');
    function pickBear() { if (window.openBearPicker) window.openBearPicker('member', uid); }
    document.getElementById('llFrBear').onclick = pickBear;
    document.getElementById('llFrBearBtn').onclick = pickBear;
    document.getElementById('llFrSave').onclick = async function () {
      var rel = document.getElementById('llFrRel').value;
      var u = {}; u['memberInfo.' + uid + '.setupDone'] = true; if (rel) u['memberInfo.' + uid + '.relationship'] = rel;
      try { await hhRef.update(u); } catch (e) {}
      closeModal();
    };
  }

  async function removeMember(uid, email, name) {
    if (!hhRef) return;
    if (!window.confirm('Remove ' + (name || 'this person') + ' from your family? They\'ll lose access, but everything they logged stays part of the baby\'s story.')) return;
    try {
      var del = firebase.firestore.FieldValue.delete();
      var u = {}; u['members.' + uid] = del; u['memberInfo.' + uid] = del;
      // Keep a tombstone so their past entries stay attributed by name forever.
      var mi = (window.LL.memberInfo || {})[uid] || {};
      u['formerMemberInfo.' + uid] = { name: mi.name || name || '', relationship: mi.relationship || '', avatar: mi.avatar || null };
      await hhRef.update(u);
      if (email) { try { await db.collection('invites').doc(email).delete(); } catch (e) {} }
      openFamily();
    } catch (e) { alert('Could not remove: ' + ((e && e.message) || e)); }
  }

  async function saveMyRelationship() {
    if (!hhRef) return;
    var v = document.getElementById('llMyRel').value;
    var msg = document.getElementById('llMyRelMsg');
    var u = {}; u['memberInfo.' + auth.currentUser.uid + '.relationship'] = v;
    try { await hhRef.update(u); msg.textContent = '✅ Saved.'; }
    catch (e) { msg.textContent = 'Could not save: ' + ((e && e.message) || e); }
  }

  function copyAppLink() {
    var inp = document.getElementById('llAppLink'), btn = document.getElementById('llCopyLink');
    var done = function () { if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(inp.value).then(done).catch(function () { try { inp.select(); document.execCommand('copy'); done(); } catch (e) {} }); }
    else { try { inp.select(); document.execCommand('copy'); done(); } catch (e) {} }
  }

  async function submitInvite() {
    var name = ((document.getElementById('llInvName').value) || '').trim();
    var email = ((document.getElementById('llInvEmail').value) || '').trim().toLowerCase();
    var rel = document.getElementById('llInvRel').value || '';
    var owner = document.getElementById('llInvOwner').checked;
    var msg = document.getElementById('llInvMsg');
    if (!email || email.indexOf('@') < 1) { msg.textContent = 'Please enter a valid email.'; return; }
    var btn = document.getElementById('llInvBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await db.collection('invites').doc(email).set({
        householdId: window.LL.householdId, role: owner ? 'owner' : 'caregiver',
        relationship: rel, name: name,
        invitedBy: auth.currentUser.uid, status: 'pending', createdAt: window.LL.serverTimestamp()
      });
      var link = location.origin;
      var babyName = (typeof state !== 'undefined' && state.babies && state.babies[0] && state.babies[0].name) ? state.babies[0].name : 'our baby';
      var subject = 'Join me on Cubby 🐻';
      var bodyTxt = 'I\'m using Cubby to keep track of ' + babyName + '\'s feeds, naps, nappies and more, and I\'d love you on it too.\n\n'
        + '1) Open this link: ' + link + '\n'
        + '2) Tap "Continue with Google" using THIS email: ' + email + '\n\n'
        + 'You\'ll join automatically and see everything, live. (On a phone you can add it to your home screen like an app.)';
      var mailto = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyTxt);
      msg.innerHTML = '✅ Invite ready for <b>' + esc(email) + '</b>' + (rel ? ' (' + esc(rel) + ')' : '') + '.'
        + '<button id="llInvEmailBtn" class="ll-modal-btn" style="margin-top:10px">📧 Email the invite</button>'
        + '<div style="font-size:12px;color:#9a8d80;margin-top:8px">Opens your email app with the link ready to send. Or use <b>Copy</b> above for WhatsApp/text.</div>';
      var eb = document.getElementById('llInvEmailBtn'); if (eb) eb.onclick = function () { window.location.href = mailto; };
      btn.textContent = 'Create invite'; btn.disabled = false;
      document.getElementById('llInvName').value = ''; document.getElementById('llInvEmail').value = '';
    } catch (e) {
      msg.textContent = 'Could not create invite: ' + ((e && e.message) || e);
      btn.textContent = 'Create invite'; btn.disabled = false;
    }
  }

  /* ---------- feedback ---------- */
  function openFeedback() {
    modal('Send feedback',
      '<div class="ll-auth-msg" style="margin:0 0 8px">Bugs, ideas, anything, it goes straight to the Cubby team. Thank you for testing! 🐻</div>'
      + '<textarea id="llFbText" class="ll-fb" placeholder="What happened, or what would make Cubby better?"></textarea>'
      + '<button id="llFbSend" class="ll-modal-btn">Send</button>'
      + '<div id="llFbMsg" class="ll-auth-msg"></div>');
    document.getElementById('llFbSend').onclick = async function () {
      var t = (document.getElementById('llFbText').value || '').trim();
      var msg = document.getElementById('llFbMsg');
      if (!t) { msg.textContent = 'Type a little something first.'; return; }
      var btn = document.getElementById('llFbSend'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        var u = auth.currentUser;
        await db.collection('feedback').add({
          text: t.slice(0, 4000),
          uid: u ? u.uid : null, email: u ? u.email : null, name: u ? u.displayName : null,
          householdId: window.LL.householdId || null,
          version: window.CUBBY_VERSION || '', userAgent: (navigator.userAgent || '').slice(0, 300),
          at: window.LL.serverTimestamp()
        });
        modal('Thank you 🐻', '<div class="ll-auth-msg" style="margin:0 0 12px">Your feedback was sent, we read every one.</div><button id="llFbDone" class="ll-modal-btn">Close</button>');
        document.getElementById('llFbDone').onclick = closeModal;
      } catch (e) { msg.textContent = 'Could not send: ' + ((e && e.message) || e); btn.disabled = false; btn.textContent = 'Send'; }
    };
  }
  window.openFeedback = openFeedback;
  window.openFamily = openFamily;

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
