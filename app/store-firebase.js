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

  var hhRef = null, eventsRef = null, photosRef = null, notesRef = null;
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

  /* ---------- pregnancy JOURNEY (owner-owned, Privacy Max, Item 7) ----------
     The journey (stage, dueDate, lmp, week, appts, kicks, contractions, birthPlan, bag,
     moments, etc.) is the most sensitive event a family has: the bare fact that someone
     is expecting. It must NEVER sit in the circle-shared `app` blob, where every member
     (in-laws, nanny) would see it the moment a pregnancy starts. Instead it lives in
     households/{hid}/pregnancy/{ownerUid}, written only by the owner, readable by the owner
     plus any uid she lists in sharedWith[] (the one-time stakeholder review at creation).
     Same shape and plumbing as mhealth. Maternal-private HEALTH stays separately owner-only
     in mhealth and is NEVER swept into the journey. ownerUid + id are routing metadata, not
     journey payload, so they are not duplicated into `data`. */
  var PREG_META_KEYS = ['ownerUid', 'id']; // routing, not journey payload
  var pregUnsub = [];     // pregnancy-journey doc listeners
  var pregOwner = null;   // uid whose journey we are currently listening to
  var pregShared = [];    // sharedWith[] for the journey (last seen, so a data write keeps consent)
  var knownPregJourney = null; // sig of last-synced {data, sharedWith} (diffing)
  var legacyBlobPreg = null;   // a journey found in a legacy `app` blob, awaiting one-time relocation
  var pregMigrated = false;    // owner has already relocated the legacy journey this session

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
    + '.ll-auth-btn-apple{background:#000;color:#fff;border-color:#000;margin-top:10px;}'
    + '.ll-auth-btn-apple:hover{background:#1a1a1a;}.ll-auth-btn-apple svg{width:17px;height:17px;}'
    + '.lp-apple{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;max-width:340px;margin:10px auto 0;border:none;background:#000;color:#fff;font-size:17px;font-weight:800;padding:16px 22px;border-radius:15px;cursor:pointer;font-family:inherit;}'
    + '.lp-apple:hover{filter:brightness(1.2);}.lp-apple:disabled{opacity:.6;cursor:default;}.lp-apple svg{width:18px;height:18px;}'
    + '.ll-auth-msg{margin-top:16px;color:#9a8d80;font-size:13px;line-height:1.4;}'
    + '.ll-values{text-align:left;margin:4px 0 20px;display:flex;flex-direction:column;gap:9px;}'
    + '.ll-values div{display:flex;align-items:center;gap:10px;font-size:13.5px;color:#6E635B;font-weight:600;}'
    + '.ll-values span{font-size:16px;flex:0 0 auto;width:20px;text-align:center;}'
    + '.ll-spin{width:30px;height:30px;border:3px solid #E0D7C7;border-top-color:#C97FA0;border-radius:50%;margin:6px auto 0;animation:llspin 0.9s linear infinite;}'
    + '@keyframes llspin{to{transform:rotate(360deg);}}'
    + '#llModalOv{position:fixed;inset:0;z-index:99998;background:rgba(20,15,12,.45);display:flex;align-items:flex-end;justify-content:center;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '#llModalOv.ll-blur{background:rgba(40,30,22,.34);backdrop-filter:blur(9px) saturate(115%);-webkit-backdrop-filter:blur(9px) saturate(115%);}'
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

  /* Sign in with Apple button. variant 'lp' = big landing button; otherwise the
     bordered auth-card style. Uses Apple's official logo + "Continue with Apple". */
  function appleBtnHtml(variant) {
    var logo = '<svg viewBox="0 0 384 512" aria-hidden="true" fill="currentColor">'
      + '<path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
    if (variant === 'lp') {
      return '<button type="button" class="lp-apple ll-apple-cta">' + logo + 'Continue with Apple</button>';
    }
    return '<button type="button" id="llAppleBtn" class="ll-auth-btn ll-auth-btn-apple">' + logo + 'Continue with Apple</button>';
  }

  /* Email magic-link sign-in (alongside Google, never instead of it). */
  function emailRowHtml() {
    return '<div class="ll-email-row" style="margin:14px auto 0;max-width:340px;text-align:center">'
      + '<button type="button" class="ll-email-toggle" style="border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:#6E635B;text-decoration:underline;padding:6px">Prefer email? Get a sign-in link</button>'
      + '<form class="ll-email-form" style="display:none;gap:8px;margin-top:8px">'
      + '<input type="email" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:0;font-family:inherit;font-size:15px;padding:11px 13px;border:1.5px solid #E7DECF;border-radius:11px;background:#FBF7EF;color:#2C2521">'
      + '<button type="submit" style="border:none;background:#9A8C6E;color:#fff;font-family:inherit;font-weight:800;font-size:14px;padding:11px 14px;border-radius:11px;cursor:pointer;white-space:nowrap">Send link</button>'
      + '</form><div class="ll-email-note" style="font-size:12px;font-weight:600;color:#6E635B;margin-top:7px"></div></div>';
  }
  /* Privacy reassurance + consent, shown right at the sign-in buttons. Links /privacy/ (live); no Terms
     link until /terms/ ships. */
  function consentHtml() {
    return '<div class="ll-consent" style="margin:13px auto 0;max-width:340px;text-align:center;font-size:12px;line-height:1.55;font-weight:600;color:#8a7d70">'
      + '🔒 Private to your family. No ads, we never sell your data.<br>'
      + 'By continuing you agree to our <a href="/privacy/" target="_blank" rel="noopener" style="color:#6E635B;text-decoration:underline">privacy promise</a>.'
      + '</div>';
  }
  // Subtle install affordance at the sign-in gate (the marketing /install.js does not run on /app/).
  // Reuses the app's own canShowInstall/addToHomeScreen helpers (defined in index.html, loaded first).
  function installRowHtml() {
    try { if (!(window.canShowInstall && window.canShowInstall())) return ''; } catch (e) { return ''; }
    return '<div class="ll-install-row" style="margin:10px auto 0;max-width:340px;text-align:center"><button type="button" id="llInstallBtn" style="border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:#6E635B;text-decoration:underline;padding:6px">Or add Cubby to your home screen</button><div id="llInstallMsg" class="ll-auth-msg" style="display:none"></div></div>';
  }
  function wireInstall(scope) {
    var ib = scope.querySelector('#llInstallBtn'); if (!ib || ib.__w) return; ib.__w = 1;
    ib.onclick = function () { if (window.addToHomeScreen) window.addToHomeScreen('llInstallMsg'); };
  }
  function wireEmailRow(scope) {
    var row = scope.querySelector('.ll-email-row'); if (!row) return;
    var toggle = row.querySelector('.ll-email-toggle'), form = row.querySelector('.ll-email-form'), note = row.querySelector('.ll-email-note');
    toggle.onclick = function () { toggle.style.display = 'none'; form.style.display = 'flex'; form.querySelector('input').focus(); };
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var email = form.querySelector('input').value.trim(); if (!email) return;
      var btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
      // Send via our own Worker + Resend (Firebase's built-in sender has poor Gmail delivery).
      // Completion is unchanged: the link is a standard Firebase email-sign-in link, finished
      // below by signInWithEmailLink(). Falls back to Firebase's sender if the endpoint is down.
      fetch('/api/send-signin-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'send_failed'); return d; }); })
        .then(function () {
          try { localStorage.setItem('cubby-email-signin', email); } catch (e) {}
          form.style.display = 'none';
          note.textContent = 'Check your inbox: we sent a sign-in link to ' + email + '. Open it on this device.';
        })
        .catch(function () {
          // Endpoint unavailable (e.g. not deployed yet): fall back to Firebase's own sender.
          auth.sendSignInLinkToEmail(email, { url: location.origin + '/app/', handleCodeInApp: true })
            .then(function () {
              try { localStorage.setItem('cubby-email-signin', email); } catch (e) {}
              form.style.display = 'none';
              note.textContent = 'Check your inbox: we sent a sign-in link to ' + email + '. Open it on this device.';
            })
            .catch(function (err) {
              btn.disabled = false; btn.textContent = 'Send link';
              note.textContent = 'Could not send the link: ' + ((err && err.message) || err);
            });
        });
    };
  }
  function maybeFinishEmailLink() {
    try {
      if (!auth.isSignInWithEmailLink(window.location.href)) return;
    } catch (e) { return; }
    var email = null;
    try { email = localStorage.getItem('cubby-email-signin'); } catch (e) {}
    if (!email) email = window.prompt('Confirm your email to finish signing in');
    if (!email) return;
    auth.signInWithEmailLink(email.trim(), window.location.href)
      .then(function (res) {
        try { localStorage.removeItem('cubby-email-signin'); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        if (res && res.user && !res.user.displayName) {
          return res.user.updateProfile({ displayName: email.split('@')[0] });
        }
      })
      .catch(function (err) {
        showSignIn('Email sign-in failed: ' + ((err && err.message) || err));
      });
  }

  function showSignIn(msg) {
    var ov = overlay();
    if (typeof window.cubbyLanding === 'function') {
      ov.classList.add('landing');
      ov.innerHTML = window.cubbyLanding(msg);
      // Only the primary (hero) CTA carries the full method set + consent, so the three methods are
      // consistent and not duplicated. (Was: an Apple button after EVERY .ll-cta but the email row only
      // after the first, so the hero had Google+Apple+email while the footer CTA had Google+Apple+no email.)
      Array.prototype.forEach.call(ov.querySelectorAll('.ll-cta'), function (b, i) {
        b.onclick = signInGoogle;
        if (i === 0) b.insertAdjacentHTML('afterend', appleBtnHtml('lp') + emailRowHtml() + consentHtml() + installRowHtml());
      });
      Array.prototype.forEach.call(ov.querySelectorAll('.ll-apple-cta'), function (b) { b.onclick = signInApple; });
      wireEmailRow(ov); wireInstall(ov);
      return;
    }
    ov.classList.remove('landing');
    ov.innerHTML =
      '<div class="ll-auth-card"><img src="/icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
      + '<h1>Cubby</h1><p>A warm, private baby log you can share with the people who care for them.</p>'
      + '<div class="ll-values"><div><span>⚡</span>Log feeds, sleep &amp; nappies in seconds</div><div><span>👨‍👩‍👧</span>Share with family &amp; caregivers, live</div><div><span>🔒</span>Private to your family</div></div>'
      + '<button id="llGoogleBtn" class="ll-auth-btn">Continue with Google</button>'
      + appleBtnHtml('card')
      + emailRowHtml()
      + consentHtml()
      + installRowHtml()
      + (msg ? '<div class="ll-auth-msg">' + msg + '</div>' : '')
      + '<div style="margin-top:16px;font-size:12px;font-weight:700"><a href="/" style="color:#6E635B">About Cubby · little-cubby.com</a></div>'
      + '</div>';
    document.getElementById('llGoogleBtn').onclick = signInGoogle;
    var llAppleBtn = document.getElementById('llAppleBtn');
    if (llAppleBtn) llAppleBtn.onclick = signInApple;
    wireEmailRow(ov); wireInstall(ov);
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

  function signInApple() {
    // Disable whichever Apple button was clicked (landing or auth-card) for feedback.
    Array.prototype.forEach.call(document.querySelectorAll('.ll-apple-cta, #llAppleBtn'), function (b) { b.disabled = true; });
    auth.signInWithPopup(window.LL.appleProvider).catch(function (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request'
        || err.code === 'auth/operation-not-supported-in-this-environment')) {
        auth.signInWithRedirect(window.LL.appleProvider); return;
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
    matUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    pregUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    unsub = []; matUnsub = []; pregUnsub = []; booted = false; knownEvents = {};
    matOwner = null; matShared = {}; knownMat = {};
    pregOwner = null; pregShared = []; knownPregJourney = null; legacyBlobPreg = null; pregMigrated = false;
    hhRef = eventsRef = photosRef = notesRef = null;
    state.notes = [];
    // Clear in-memory subject data so one account's journey + maternal-private health (applyMatDoc
    // folds mhealth fields into state.pregnancy) can never survive into the next account's session
    // after an in-tab sign-out/sign-in. Privacy-Max: no leftover.
    state.pregnancy = null;
    state.handoff = null;
    handoffMigrated = false;
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
    var userDoc = { householdId: newRef.id, name: user.displayName || '', email: user.email || '' };
    // Referral attribution: brand-new family + a remembered ?ref= code -> record who referred them.
    // (Invited caregivers above join an existing household; that's the care-circle loop, not a referral.)
    try {
      var refBy = localStorage.getItem('cubby-ref');
      if (refBy && /^[a-z0-9]{4,12}$/.test(refBy) && !snap.exists) {
        userDoc.referredBy = refBy;
        localStorage.removeItem('cubby-ref');
      }
    } catch (e) {}
    // Campaign attribution: stamp the first-touch utm_* onto the brand-new family's own user doc.
    // First-party (the user owns this record); kept in localStorage so the Pro waitlist write can reuse it.
    try {
      var acqRaw = localStorage.getItem('cubby-acq');
      if (acqRaw && !snap.exists) userDoc.acq = JSON.parse(acqRaw);
    } catch (e) {}
    await userRef.set(userDoc, { merge: true });
    return newRef.id;
  }

  /* ---------- state <-> cloud blob ---------- */
  // The journey payload that goes into the owner-owned pregnancy doc: everything in
  // state.pregnancy EXCEPT maternal-private HEALTH (kept in mhealth) and routing meta
  // (ownerUid, id, carried on the doc, not duplicated inside `data`).
  function pregJourneyData(p) {
    if (!p) return {};
    var out = {};
    Object.keys(p).forEach(function (k) {
      if (MAT_PRIVATE_KEYS.indexOf(k) >= 0) return; // health -> mhealth
      if (PREG_META_KEYS.indexOf(k) >= 0) return;   // routing -> doc id / fields
      out[k] = p[k];
    });
    return out;
  }
  function appBlobFromState() {
    return {
      babies: state.babies || [], settings: state.settings || {},
      milestones: state.milestones || [], meds: state.meds || [],
      vaccines: state.vaccines || {}, illnesses: state.illnesses || [],
      photos: state.photos || [],
      handoff: state.handoff || null,  // shared parent<->caregiver note
      // pregnancy is NO LONGER in the shared blob (Item 7): the journey is owner-owned in
      // households/{hid}/pregnancy/{ownerUid} and reaches members only by explicit consent.
      den: state.den || null,  // household hub: chores, shopping, meals, staff, expenses, weights
      consents: state.consents || [],  // dual-guardian approvals for big actions (delete/export)
      guardians: state.guardians || null,  // explicit guardian uids (papa + mama); derived if null
      timers: state.timers || {},   // shared so an ongoing nap/feed shows on every phone
      journey: state.journey || null,   // baby-scope guided-journey: titles, dismissed prompts, relationship captures (NOT pregnancy — that stays owner-owned)
      lossHolding: state.lossHolding || null   // calm holding state after a loss, so a reload (and a following co-parent) gets the gentle screen, never the upbeat journey chooser
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
    // The journey no longer comes from the blob (Item 7). A legacy blob may still carry one;
    // stash it so the owner can relocate it into the owner-owned doc, then never read it again.
    if (app.pregnancy && !legacyBlobPreg) legacyBlobPreg = app.pregnancy;
    state.den = app.den || null;
    state.consents = app.consents || [];
    state.guardians = app.guardians || null;
    // Don't stomp a timer the local user just started but hasn't pushed yet.
    if (!pushTimer) state.timers = app.timers || {};
    state.journey = app.journey || null;
    state.lossHolding = app.lossHolding || null;
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

  /* ---------- pregnancy-journey sync (owner-owned pregnancy doc, Item 7) ---------- */
  // Fold an owner's journey doc into state.pregnancy. Maternal-private HEALTH already loaded
  // from the mhealth listener is preserved (the journey doc never carries it).
  function applyPregJourney(owner, d) {
    if (!d) return;
    pregShared = d.sharedWith || [];
    knownPregJourney = stableStringify([d.data || {}, pregShared]); // don't immediately re-write what we just received
    var data = d.data || {};
    var p = state.pregnancy || {};
    if (p.id && data.id && p.id !== data.id) p = {}; // a different pregnancy -> drop stale fields
    Object.keys(data).forEach(function (k) { p[k] = data[k]; });
    p.ownerUid = owner; // routing meta lives on the doc, not in data
    state.pregnancy = p;
  }
  // Clear the in-memory journey when the doc is gone / never readable (so a non-permitted
  // member never even learns a pregnancy exists, and an owner who ended it sees it cleared).
  function clearPregJourneyState() {
    state.pregnancy = null;
    matOwner = null; matShared = {}; knownMat = {};
    matUnsub.forEach(function (u) { try { u(); } catch (e) {} }); matUnsub = [];
  }
  // Listen to the journey doc we're permitted to read: the owner reads her own;
  // a non-owner tries each member's doc (ones not shared with us fail permission and are ignored).
  function ensurePregListeners(uidNow) {
    pregUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    pregUnsub = []; pregOwner = null; pregShared = []; knownPregJourney = null;
    if (!hhRef || !uidNow) return;
    var base = hhRef.collection('pregnancy');
    // The owner (or whoever holds her own doc) reads her own journey.
    pregUnsub.push(base.doc(uidNow).onSnapshot(function (doc) {
      applyingRemote = true;
      if (doc.exists) { pregOwner = uidNow; applyPregJourney(uidNow, doc.data()); ensureMaternalListeners(uidNow); }
      else if (pregOwner === uidNow) { pregOwner = null; clearPregJourneyState(); }
      applyingRemote = false;
      if (booted) render();
    }, function (e) { /* own doc not readable yet; ignore */ }));
    // A non-owner: try every other member's journey doc. Not shared with us -> permission-denied, ignored.
    var members = (window.LL.members && Object.keys(window.LL.members)) || [];
    members.forEach(function (m) {
      if (m === uidNow) return;
      pregUnsub.push(base.doc(m).onSnapshot(function (doc) {
        if (!doc.exists) { if (pregOwner === m) { pregOwner = null; clearPregJourneyState(); if (booted) render(); } return; }
        applyingRemote = true; pregOwner = m; applyPregJourney(m, doc.data()); applyingRemote = false;
        ensureMaternalListeners(uidNow);
        if (booted) render();
      }, function (e) { /* permission-denied = not shared with me; ignore */ }));
    });
  }
  // The owner writes her changed journey doc (data + current sharedWith). No-op for non-owners.
  async function syncPregJourney(uidNow) {
    var p = state.pregnancy;
    if (!hhRef || !p || !p.ownerUid || p.ownerUid !== uidNow) return; // only the owner writes her own journey
    var data = pregJourneyData(p);
    var shared = pregShared || [];
    var sig = stableStringify([data, shared]);
    if (knownPregJourney === sig) return;
    knownPregJourney = sig;
    try {
      await hhRef.collection('pregnancy').doc(uidNow)
        .set({ ownerUid: uidNow, data: data, sharedWith: shared, updatedAt: window.LL.serverTimestamp() });
    } catch (e) { console.warn('pregnancy journey push', e); }
  }
  // One-time migration: relocate a legacy in-blob journey to the owner-owned doc, then strip the
  // blob. Owner-only, once per session. The legacy journey was already visible to the whole circle
  // (it lived in the shared blob), so the migrated sharedWith defaults to the current members, so
  // nobody silently loses access they already had. The new-pregnancy audit governs fresh starts.
  function maybeMigrateLegacyJourney() {
    if (pregMigrated) return;
    if (window.LL.role !== 'owner') return;          // only the household owner relocates
    var uidNow = auth.currentUser && auth.currentUser.uid; if (!uidNow) return;
    var legacy = legacyBlobPreg; if (!legacy) return;
    if (pregOwner) { pregMigrated = true; legacyBlobPreg = null; return; } // an owner-owned doc already exists; nothing to relocate
    pregMigrated = true;
    // Seed in-memory state from the legacy blob and claim ownership.
    var p = state.pregnancy || {};
    Object.keys(legacy).forEach(function (k) { if (p[k] === undefined) p[k] = legacy[k]; });
    p.ownerUid = uidNow;
    state.pregnancy = p;
    pregOwner = uidNow;
    // Preserve existing visibility: share the journey with the current circle (everyone who could
    // already see it via the blob). The owner can trim this later in the privacy sheet.
    pregShared = ((window.LL.members && Object.keys(window.LL.members)) || []).filter(function (m) { return m !== uidNow; });
    knownPregJourney = null; // force the journey + blob-strip to be written
    legacyBlobPreg = null;
    ensureMaternalListeners(uidNow);
    scheduledPush(); // writes the journey doc + mhealth + the blob without pregnancy
  }

  /* ---------- start real-time sync ---------- */
  function startSync(hid, user) {
    hhRef = db.collection('households').doc(hid);
    eventsRef = hhRef.collection('events');
    photosRef = hhRef.collection('photos');
    notesRef = hhRef.collection('notes');

    var prefs = loadPrefs();
    var gotApp = false, gotEvents = false;
    var lastMembersSig = null; // resubscribe journey listeners only when membership changes

    function maybeBoot() {
      if (booted || !(gotApp && gotEvents)) return;
      if (!state.timers) state.timers = {}; // timers come from the cloud app blob
      if (prefs.theme) state.settings.theme = prefs.theme;
      state.activeBabyId = prefs.activeBabyId || (state.babies[0] && state.babies[0].id) || null;
      if (state.activeBabyId && !state.babies.some(function (b) { return b.id === state.activeBabyId; }))
        state.activeBabyId = (state.babies[0] && state.babies[0].id) || null;
      booted = true;
      // One-time relocation (Item 7): if a legacy blob carried the pregnancy journey (and any
      // maternal-private fields), the owner moves it into the owner-owned pregnancy doc (plus
      // mhealth), then strips it from the shared blob. Done only by the household owner, once.
      maybeMigrateLegacyJourney();
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
      window.LL.pro = d.pro || null; // Pro entitlement: written only by the billing Worker
      window.LL.householdId = hid;
      // Pregnancy-journey listeners depend on the member set (a non-owner tries each member's
      // doc). (Re)subscribe whenever membership changes, including the very first snapshot.
      var membersSig = stableStringify(d.members || {});
      if (membersSig !== lastMembersSig) { lastMembersSig = membersSig; ensurePregListeners(user.uid); }
      var sig = hhSig(d.app, d.members, d.memberInfo) + '|' + JSON.stringify(d.pro || null);
      if (booted && sig === lastHhSig) return; // our own write echo / duplicate emission, already on screen
      lastHhSig = sig;
      applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;
      ensureMaternalListeners(user.uid); // (re)subscribe once we know whose pregnancy it is
      migrateHandoffToNote(); // role + handoff are now known; fold any legacy shared note in once
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

    startNotesSync(user);
  }

  /* ---------- home day-surface notes (private by rules, never in the app blob) ----------
     Notes live in households/{hid}/notes/{noteId}. A private note (audience == a member uid) is
     readable ONLY by that member or its author; a 'circle' note is readable by everyone. We run
     three scoped queries that each satisfy the read rule, so a member never even attempts to read a
     note addressed to someone else (no permission-denied churn). We still filter client-side as a
     belt-and-braces guard: a note must never render for the wrong member. */
  function noteVisibleTo(n, uid) {
    if (!n) return false;
    return n.audience === 'circle' || n.audience === uid || n.createdBy === uid;
  }
  function mergeNote(d) {
    var uidNow = auth.currentUser && auth.currentUser.uid;
    if (!noteVisibleTo(d, uidNow)) return; // never hold a note this viewer may not see
    state.notes = state.notes || [];
    var i = state.notes.findIndex(function (n) { return String(n.id) === String(d.id); });
    if (i >= 0) state.notes[i] = d; else state.notes.push(d);
  }
  function dropNote(id) {
    state.notes = (state.notes || []).filter(function (n) { return String(n.id) !== String(id); });
  }
  function startNotesSync(user) {
    state.notes = [];
    function handle(snap) {
      snap.docChanges().forEach(function (ch) {
        var d = ch.doc.data(); d.id = ch.doc.id;
        if (ch.type === 'removed') dropNote(d.id); else mergeNote(d);
      });
      migrateHandoffToNote(); // one-time: fold any legacy shared handoff into a circle note
      if (booted && !(snap.metadata && snap.metadata.hasPendingWrites)) render();
    }
    function warn(e) { /* a scoped query a viewer can't run is ignored, never thrown */ }
    // 1) circle notes (everyone). 2) my own notes. 3) notes addressed privately to me.
    unsub.push(notesRef.where('audience', '==', 'circle').onSnapshot(handle, warn));
    unsub.push(notesRef.where('createdBy', '==', user.uid).onSnapshot(handle, warn));
    unsub.push(notesRef.where('audience', '==', user.uid).onSnapshot(handle, warn));
  }

  // MIGRATION: the app used to keep a single shared note in state.handoff (inside the app blob).
  // On first load, the household owner copies it into one 'circle' note on its own day, then clears
  // state.handoff so the blob no longer carries it. Owner-only so it runs once, not once per member.
  var handoffMigrated = false;
  function migrateHandoffToNote() {
    if (handoffMigrated || !notesRef) return;
    var h = state.handoff;
    if (!h || !h.text) { handoffMigrated = true; return; }
    if (window.LL.role !== 'owner') return; // only the owner migrates the shared blob
    handoffMigrated = true;
    var uidNow = (auth.currentUser && auth.currentUser.uid) || null;
    var at = h.at || Date.now();
    var note = {
      // The owner performs the write, so createdBy MUST be the owner or the notes create
      // rule (createdBy == request.auth.uid) rejects it. The original author is preserved
      // by name for the circle to see.
      createdBy: uidNow,
      createdByName: (h.by && nameForUid(h.by)) || nameForUid(uidNow) || '',
      at: at, day: dayKeyOf(at), text: String(h.text), audience: 'circle', pinned: false
    };
    // Deterministic doc id so a retry (owner reloads before the clear-push lands, or the
    // push fails) overwrites the same doc instead of adding a duplicate circle note.
    notesRef.doc('legacy-handoff').set(note).then(function () {
      state.handoff = null; // clear the legacy field; next push drops it from the blob
      scheduledPush();
    }).catch(function (e) { handoffMigrated = false; console.warn('handoff migrate', e); });
  }
  function dayKeyOf(ts) { var d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function nameForUid(uid) {
    var info = (window.LL && window.LL.memberInfo) || {};
    var m = info[uid]; if (!m) return '';
    return m.relationship || (m.name ? String(m.name).split(' ')[0] : '') || '';
  }

  /* Notes API consumed by the home day-surface UI in index.html. */
  // Create a note. audience is set here and is immutable afterward (no update path changes it).
  window.LL.addNote = async function (text, audience, day, at) {
    if (!notesRef) return false;
    var u = auth.currentUser; if (!u) return false;
    text = String(text == null ? '' : text).trim(); if (!text) return false;
    audience = (audience === 'circle' || audience == null) ? 'circle' : String(audience);
    at = at || Date.now();
    var note = {
      createdBy: u.uid, createdByName: nameForUid(u.uid),
      at: at, day: day || dayKeyOf(at), text: text, audience: audience, pinned: false
    };
    try {
      var ref = await notesRef.add(note);
      note.id = ref.id; mergeNote(note); // optimistic; the listener will reconcile
      return true;
    } catch (e) { console.warn('addNote', e); return false; }
  };
  // Delete a note (author-only, also enforced by rules).
  window.LL.deleteNote = async function (id) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var n = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (n && n.createdBy && n.createdBy !== u.uid) return false; // not mine
    try { await notesRef.doc(String(id)).delete(); dropNote(id); return true; }
    catch (e) { console.warn('deleteNote', e); return false; }
  };
  // Pin/unpin: at most ONE pinned note per circle. Setting a pin clears any other the author can edit.
  // (We only ever clear pins on notes the caller authored, so the rules permit the write.)
  window.LL.setNotePinned = async function (id, pinned) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var target = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (!target || target.createdBy !== u.uid) return false; // pin only your own (audience stays put)
    try {
      var writes = [];
      if (pinned) {
        (state.notes || []).forEach(function (n) {
          if (n.pinned && n.createdBy === u.uid && String(n.id) !== String(id)) {
            n.pinned = false; writes.push(notesRef.doc(String(n.id)).update({ pinned: false }));
          }
        });
      }
      target.pinned = !!pinned;
      writes.push(notesRef.doc(String(id)).update({ pinned: !!pinned }));
      await Promise.all(writes);
      return true;
    } catch (e) { console.warn('setNotePinned', e); return false; }
  };

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
      pregOwner = uidNow;
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
    syncPregJourney(uidNow); // owner-only; writes the journey to the owner-owned pregnancy doc (Item 7)
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

  /* ---------- pregnancy-journey sharing API (Item 7; consumed by index.html) ---------- */
  // The bare fact of a pregnancy is the most sensitive thing here. The owner alone controls
  // who in the circle can see the journey, via the sharedWith[] on her owner-owned doc.
  window.LL.pregIsOwner = function () {
    var u = auth.currentUser; if (!u) return true;
    var p = state.pregnancy; if (!p) return true;
    if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
    return window.LL.role === 'owner';
  };
  window.LL.pregJourneyShared = function () { return (pregShared || []).slice(); };
  // Owner sets who in the circle may see the journey. Claiming an unassigned/legacy pregnancy is
  // role-gated to the household owner (mirrors pushNow + matSetShared) so a caregiver can never
  // become owner as a side-effect of toggling a share.
  window.LL.pregSetShared = async function (uids) {
    var u = auth.currentUser, p = state.pregnancy;
    if (!hhRef || !u || !p) return false;
    var owned = p.ownerUid && p.ownerUid !== 'local';
    if (owned && p.ownerUid !== u.uid) return false;        // someone else owns it
    if (!owned && window.LL.role !== 'owner') return false; // unassigned: only the household owner may claim
    if (!owned) { p.ownerUid = u.uid; pregOwner = u.uid; }   // claim (household owner only)
    pregShared = (uids || []).slice();
    var data = pregJourneyData(p);
    knownPregJourney = stableStringify([data, pregShared]);
    try {
      await hhRef.collection('pregnancy').doc(u.uid)
        .set({ ownerUid: u.uid, data: data, sharedWith: pregShared, updatedAt: window.LL.serverTimestamp() });
      return true;
    } catch (e) { console.warn('pregSetShared', e); return false; }
  };
  // Owner removes her journey doc (called when a pregnancy is closed). Also clears mhealth.
  window.LL.pregClear = async function () {
    var u = auth.currentUser; if (!hhRef || !u) return;
    var owner = pregOwner || (state.pregnancy && state.pregnancy.ownerUid) || u.uid;
    if (owner !== u.uid) return; // only the owner clears her own
    try { await window.LL.matClear(); } catch (e) {}
    try { await hhRef.collection('pregnancy').doc(u.uid).delete(); } catch (e) {}
    pregShared = []; knownPregJourney = null; pregOwner = null;
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


  function modal(title, bodyHtml, opts) {
    opts = opts || {};
    closeModal();
    var ov = document.createElement('div'); ov.id = 'llModalOv';
    if (opts.blur) ov.className = 'll-blur';
    var closeBtn = opts.locked ? '' : '<button id="llModalX">×</button>';
    ov.innerHTML = '<div class="ll-modal"><div class="ll-modal-head"><h2>' + esc(title) + '</h2>' + closeBtn + '</div>' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    if (!opts.locked) {
      ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
      document.getElementById('llModalX').onclick = closeModal;
    }
  }
  function closeModal() { var m = document.getElementById('llModalOv'); if (m) m.remove(); }

  var RELATIONSHIPS = ['Mama Bear', 'Papa Bear', 'Nana Bear', 'Grandpa Bear', 'Auntie Bear', 'Uncle Bear', 'Nanny', 'Caregiver', 'Other'];
  function relOptions(sel, withCustom) {
    var list = RELATIONSHIPS.slice();
    if (sel && list.indexOf(sel) < 0) list.unshift(sel); // keep any previously-saved label (incl. a custom one)
    var html = '<option value="">Relationship…</option>' + list.map(function (r) {
      return '<option value="' + esc(r) + '"' + (r === sel ? ' selected' : '') + '>' + esc(r) + '</option>';
    }).join('');
    if (withCustom) html += '<option value="__custom__">✏️ Add your own…</option>';
    return html;
  }
  // Free-text role for circles beyond the presets (driver, cook, ayah, godmother…). Plain label, as typed.
  function relCustomInput(id) { return '<input id="' + id + '" class="ll-rel-custom" placeholder="e.g. Driver, Cook, Godmother" maxlength="24" autocomplete="off" style="display:none;margin-top:6px">'; }
  function wireRelCustom(selId, inpId) {
    var s = document.getElementById(selId), i = document.getElementById(inpId);
    if (!s || !i) return;
    var sync = function () { var c = (s.value === '__custom__'); i.style.display = c ? 'block' : 'none'; if (c) i.focus(); };
    s.addEventListener('change', sync); sync();
  }
  function relValue(selId, inpId) {
    var s = document.getElementById(selId); if (!s) return '';
    if (s.value === '__custom__') { var i = document.getElementById(inpId); return ((i && i.value) || '').trim().slice(0, 24); }
    return s.value;
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

    var myName = (info[me.uid] && info[me.uid].name) || me.displayName || '';
    var youRow = '<div class="ll-invite" style="border-top:none;padding-top:4px"><label style="font-weight:800;font-size:15px">Your profile</label>'
      + '<label>Your name</label><input id="llMyName" maxlength="40" autocomplete="name" placeholder="Your name" value="' + esc(myName) + '">'
      + '<label style="margin-top:10px;display:block">Your relationship to baby</label>'
      + '<select id="llMyRel">' + relOptions(myRel, true) + '</select>' + relCustomInput('llMyRelCustom')
      + '<button id="llMyRelBtn" class="ll-modal-btn ll-ghost" style="margin-top:8px">Save my profile</button>'
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

    modal('Family & sharing', '<div class="ll-mems">' + rows + '</div>'
      + '<div class="ll-auth-msg" style="text-align:left;margin:-2px 0 12px">When you invite people, everyone in your circle can see each other\'s name and email here, so you know who is who. Only you can change your own.</div>'
      + youRow + invite + share
      + '<button id="llSignOut" class="ll-modal-btn ll-ghost">Sign out</button>'
      + '<div class="ll-auth-msg" style="margin-top:10px">Cubby v' + (window.CUBBY_VERSION || '') + ' · made with families like you 🐻</div>');

    document.getElementById('llSignOut').onclick = function () { closeModal(); window.LL.signOut(); };
    document.getElementById('llMyRelBtn').onclick = saveMyRelationship;
    wireRelCustom('llMyRel', 'llMyRelCustom');
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
    // Require a real, completed setup. (Was `setupDone || relationship`, so an invited caregiver whose
    // relationship was pre-filled on the invite never got the name prompt.)
    if (mi.setupDone) return;
    firstRunShown = true;
    // Brand-new owner with no baby and no pregnancy lands on the onboarding wizard (renderOnboard).
    // Collect identity as a STEP inside that wizard (after stage + details), not as a locked modal
    // popped over the stage picker. Caregivers / anyone with existing data get the identity sheet now.
    var hasData = (state.babies && state.babies.length) || state.pregnancy;
    if (!hasData) { window.LL.needsIdentity = true; return; }
    openFirstRun(user);
  }
  function openFirstRun(user, opts) {
    opts = opts || {};
    var uid = user.uid;
    var bear = (typeof window.memberAvatarSvg === 'function') ? window.memberAvatarSvg(uid, 84) : '';
    // Relationship label adapts to where the family is, so it never asks "relationship to baby"
    // before there is a baby (the old confusing case for expecting/trying users).
    var relLabel = opts.stage === 'expecting' ? 'Your relationship to your little one on the way'
      : (opts.stage === 'planning' ? 'Your role' : 'Your relationship to your baby');
    // As a wizard step (after stage + details), it's the warm last beat; as the standalone caregiver
    // sheet it's the welcome. Either way name is required. (Install moved out of here; it's offered later.)
    var intro = opts.asStep
      ? 'Last thing: how should your family see you? You can change this anytime.'
      : 'We\'re so glad you\'re here. 🤍 Cubby is a calm, private place for everyone who loves your little one, and it\'s shaped by families like yours.';
    modal('Welcome to Cubby 🐻',
      '<div class="ll-auth-msg" style="margin:0 0 10px;text-align:left;line-height:1.55">' + intro + '<br><br>• Your log stays <b>private</b> to your family, always.<br>• An idea, or something to make better? We read every note: <b>Settings → Family &amp; sharing → Send feedback</b>.</div>'
      + '<div class="ll-auth-msg" style="margin:0 0 6px">How should your family see you?</div>'
      + '<div class="ll-mem-av" id="llFrBear" style="width:84px;height:84px;margin:10px auto 4px;cursor:pointer">' + bear + '</div>'
      + '<div style="text-align:center;margin-bottom:6px"><button id="llFrBearBtn" class="ll-rm" style="color:#C97FA0">Customise my bear</button></div>'
      + '<div class="ll-invite" style="border-top:none;padding-top:8px"><label>Your name</label><input id="llFrName" maxlength="40" autocomplete="name" placeholder="Your name" value="' + esc(user.displayName || '') + '">'
      + '<label style="margin-top:10px;display:block">' + relLabel + '</label><select id="llFrRel">' + relOptions('', true) + '</select>' + relCustomInput('llFrRelCustom')
      + '<div id="llFrErr" class="ll-auth-msg" style="color:#C0392B"></div></div>'
      + '<button id="llFrSave" class="ll-modal-btn">' + (opts.asStep ? 'Continue' : 'Save') + '</button>'
      + (opts.asStep ? '' : '<button id="llFrOut" class="ll-modal-btn ll-ghost" style="margin-top:10px">Log out</button>'),
      { locked: true, blur: true });
    var outBtn = document.getElementById('llFrOut');
    if (outBtn) outBtn.onclick = function () { closeModal(); window.LL.signOut(); };
    function pickBear() { if (window.openBearPicker) window.openBearPicker('member', uid); }
    document.getElementById('llFrBear').onclick = pickBear;
    document.getElementById('llFrBearBtn').onclick = pickBear;
    wireRelCustom('llFrRel', 'llFrRelCustom');
    document.getElementById('llFrSave').onclick = async function () {
      var name = (document.getElementById('llFrName').value || '').trim();
      if (!name) { var er = document.getElementById('llFrErr'); if (er) er.textContent = 'Please add your name so your family knows who is who.'; document.getElementById('llFrName').focus(); return; }
      var rel = relValue('llFrRel', 'llFrRelCustom');
      var u = {}; u['memberInfo.' + uid + '.setupDone'] = true; u['memberInfo.' + uid + '.name'] = name; if (rel) u['memberInfo.' + uid + '.relationship'] = rel;
      try { await hhRef.update(u); } catch (e) {}
      window.LL.needsIdentity = false;
      closeModal();
      if (typeof opts.onDone === 'function') opts.onDone();
    };
  }
  // Identity collection as a forward wizard step (used by the onboarding flow AFTER stage + details).
  window.LL.collectIdentity = function (stage, onDone) {
    // In prod currentUser is always set (this only runs post-auth); the fallback is for local e2e.
    var u = auth.currentUser || { uid: 'local', displayName: '' };
    firstRunShown = true;
    openFirstRun(u, { asStep: true, stage: stage, onDone: onDone });
  };

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
    var v = relValue('llMyRel', 'llMyRelCustom');
    var nameEl = document.getElementById('llMyName');
    var name = (nameEl ? (nameEl.value || '').trim().slice(0, 40) : '');
    var msg = document.getElementById('llMyRelMsg');
    if (nameEl && !name) { msg.textContent = 'Please add your name so your family knows who is who.'; nameEl.focus(); return; }
    var uid = auth.currentUser.uid;
    var u = {}; u['memberInfo.' + uid + '.relationship'] = v;
    if (nameEl) u['memberInfo.' + uid + '.name'] = name;
    try {
      await hhRef.update(u);
      if (nameEl && name && name !== (auth.currentUser.displayName || '')) { try { await auth.currentUser.updateProfile({ displayName: name }); } catch (_) {} }
      msg.textContent = '✅ Saved.';
      if (typeof window.render === 'function') { try { window.render(); } catch (_) {} }
    }
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
  maybeFinishEmailLink();

  // Local E2E boot — localhost + ?e2e=1 ONLY. The hostname guard means this can NEVER run in
  // prod (little-cubby.com). It skips Firebase + the sign-in gate so tools/uitest.js can drive
  // the logged-in UI from seeded localStorage. No credentials, no network.
  var e2eMode = new URLSearchParams(location.search).get('e2e');
  if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && (e2eMode === '1' || e2eMode === 'onboard')) {
    try {
      window.LL.role = 'owner';
      window.LL.members = { local: { role: 'owner' } };
      if (e2eMode === 'onboard') {
        // Brand-new owner: no name/setup, no baby, no pregnancy -> the first-run wizard renders.
        window.LL.memberInfo = { local: { role: 'owner' } };
        window.LL.needsIdentity = true;
        try { state.babies = []; state.pregnancy = null; state.activeBabyId = null; } catch (e) {}
        if (typeof render === 'function') render();
        ['llAuthOv', 'llModalOv'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
      } else {
        window.LL.memberInfo = { local: { name: 'Test Parent', relationship: 'Mama Bear', role: 'owner' } };
        Store.load().then(function (d) { if (d && typeof state !== 'undefined') { try { Object.assign(state, d); } catch (e) {} } if (typeof render === 'function') render(); ['llAuthOv', 'llModalOv'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); }); });
      }
    } catch (e) { console.error('e2e boot failed', e); }
    return;
  }
  auth.onAuthStateChanged(async function (user) {
    if (!user) { teardown(); showSignIn(''); return; }
    try { localStorage.setItem('cubby-member', '1'); } catch (e) {}
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
