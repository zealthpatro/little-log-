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
    + '.ll-auth-logo-img{width:84px;height:84px;border-radius:20px;display:block;margin:0 auto 12px;box-shadow:0 6px 18px rgba(0,0,0,.12);}'
    + '.ll-auth-card h1{font-family:"Fraunces",Georgia,serif;font-size:30px;margin:6px 0 4px;color:#2C2521;}'
    + '.ll-auth-card p{color:#6E635B;font-size:15px;margin:0 0 24px;line-height:1.4;}'
    + '.ll-auth-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid #E0D7C7;background:#fff;color:#2C2521;font-size:16px;font-weight:700;padding:14px 18px;border-radius:14px;cursor:pointer;font-family:inherit;}'
    + '.ll-auth-btn:hover{background:#FBF7EF;}.ll-auth-btn:disabled{opacity:.6;cursor:default;}'
    + '.ll-auth-msg{margin-top:16px;color:#9a8d80;font-size:13px;line-height:1.4;}'
    + '.ll-spin{width:30px;height:30px;border:3px solid #E0D7C7;border-top-color:#C97FA0;border-radius:50%;margin:6px auto 0;animation:llspin 0.9s linear infinite;}'
    + '@keyframes llspin{to{transform:rotate(360deg);}}'
    + '#llAcctBtn{position:fixed;top:max(10px,env(safe-area-inset-top));right:10px;z-index:9000;width:42px;height:42px;border-radius:50%;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.92);font-size:20px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;}'
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
    overlay().innerHTML =
      '<div class="ll-auth-card"><img src="icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
      + '<h1>Cubby</h1><p>A warm, private baby log you can share with the people who care for them.</p>'
      + '<button id="llGoogleBtn" class="ll-auth-btn">Continue with Google</button>'
      + (msg ? '<div class="ll-auth-msg">' + msg + '</div>' : '') + '</div>';
    document.getElementById('llGoogleBtn').onclick = signInGoogle;
  }
  function showStatus(msg) {
    overlay().innerHTML =
      '<div class="ll-auth-card"><img src="icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
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
  function appBlobFromState() {
    return {
      babies: state.babies || [], settings: state.settings || {},
      milestones: state.milestones || [], meds: state.meds || [],
      vaccines: state.vaccines || {}, illnesses: state.illnesses || [],
      photos: state.photos || [],
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
    // Don't stomp a timer the local user just started but hasn't pushed yet.
    if (!pushTimer) state.timers = app.timers || {};
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
      if (!state.timers) state.timers = {}; // timers come from the cloud app blob
      if (prefs.theme) state.settings.theme = prefs.theme;
      state.activeBabyId = prefs.activeBabyId || (state.babies[0] && state.babies[0].id) || null;
      if (state.activeBabyId && !state.babies.some(function (b) { return b.id === state.activeBabyId; }))
        state.activeBabyId = (state.babies[0] && state.babies[0].id) || null;
      booted = true;
      hideOverlay();
      injectAccountButton();
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

  /* ---------- account / family sharing UI ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function injectAccountButton() {
    if (document.getElementById('llAcctBtn')) return;
    var b = document.createElement('button');
    b.id = 'llAcctBtn'; b.title = 'Family & sharing'; b.textContent = '👨‍👩‍👧';
    b.onclick = openFamily;
    document.body.appendChild(b);
  }

  function modal(title, bodyHtml) {
    closeModal();
    var ov = document.createElement('div'); ov.id = 'llModalOv';
    ov.innerHTML = '<div class="ll-modal"><div class="ll-modal-head"><h2>' + esc(title) + '</h2><button id="llModalX">×</button></div>' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.getElementById('llModalX').onclick = closeModal;
  }
  function closeModal() { var m = document.getElementById('llModalOv'); if (m) m.remove(); }

  var RELATIONSHIPS = ['Mother', 'Father', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Nanny', 'Caregiver', 'Other'];
  function relOptions(sel) {
    return '<option value="">Relationship…</option>' + RELATIONSHIPS.map(function (r) {
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
      return '<div class="ll-mem"><div style="display:flex;align-items:center;gap:10px">' + av + '<div><div class="ll-mem-name">' + esc(m.name || m.email || 'Member') + (uid === me.uid ? ' (you)' : '')
        + '</div><div class="ll-mem-email">' + esc(m.email || '') + '</div></div></div><div class="ll-mem-role">' + esc(who) + '</div></div>';
    }).join('') || '<div class="ll-auth-msg">Just you so far.</div>';

    var youRow = '<div class="ll-invite" style="border-top:none;padding-top:4px"><label>Your relationship to baby</label>'
      + '<select id="llMyRel">' + relOptions(myRel) + '</select>'
      + '<button id="llMyRelBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">Save relationship</button>'
      + '<button id="llMyBearBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">Change my bear avatar</button>'
      + '<div id="llMyRelMsg" class="ll-auth-msg"></div></div>';

    var invite = (myRole === 'owner')
      ? '<div class="ll-invite"><label>Invite a family member</label>'
        + '<input id="llInvName" type="text" placeholder="Their name (optional)" autocomplete="off">'
        + '<input id="llInvEmail" type="email" placeholder="their-google-email@gmail.com" autocomplete="off" autocapitalize="off">'
        + '<select id="llInvRel">' + relOptions('') + '</select>'
        + '<label class="ll-check"><input type="checkbox" id="llInvOwner"><span>Co-owner — full control (can edit everyone\'s entries &amp; invite others)</span></label>'
        + '<button id="llInvBtn" class="ll-modal-btn">Create invite</button>'
        + '<div id="llInvMsg" class="ll-auth-msg"></div></div>'
      : '<div class="ll-auth-msg">Only an owner can invite new people.</div>';

    var share = '<div class="ll-invite"><label>App link to share</label>'
      + '<div class="ll-linkrow"><input id="llAppLink" readonly value="' + esc(location.origin) + '"><button id="llCopyLink" class="ll-modal-btn">Copy</button></div>'
      + '<div class="ll-auth-msg">Cubby doesn\'t send emails. Send this link yourself (text / WhatsApp); the invited person signs in with Google using the invited email and joins automatically.</div></div>';

    modal('Family & sharing', '<div class="ll-mems">' + rows + '</div>' + youRow + invite + share
      + '<button id="llSignOut" class="ll-modal-btn ll-ghost">Sign out</button>');

    document.getElementById('llSignOut').onclick = function () { closeModal(); window.LL.signOut(); };
    document.getElementById('llMyRelBtn').onclick = saveMyRelationship;
    document.getElementById('llMyBearBtn').onclick = function () { if (window.openBearPicker) window.openBearPicker('member', me.uid); };
    document.getElementById('llCopyLink').onclick = copyAppLink;
    if (myRole === 'owner') document.getElementById('llInvBtn').onclick = submitInvite;
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
      msg.innerHTML = '✅ Invite ready for <b>' + esc(email) + '</b>' + (rel ? ' (' + esc(rel) + ')' : '')
        + '. Now <b>Copy</b> the app link above and send it to them. They sign in with Google using <b>' + esc(email) + '</b> and join automatically.';
      btn.textContent = 'Create invite'; btn.disabled = false;
      document.getElementById('llInvName').value = ''; document.getElementById('llInvEmail').value = '';
    } catch (e) {
      msg.textContent = 'Could not create invite: ' + ((e && e.message) || e);
      btn.textContent = 'Create invite'; btn.disabled = false;
    }
  }

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
