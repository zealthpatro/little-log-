/* ============================================================
   LITTLE LOG: cloud auth + sync layer
   - Google sign-in gate
   - one shared "household" (members: owner | caregiver)
   - real-time sync: events subcollection + app blob + photos subcollection
   - diff-based push inside persist(): the app's ~10 save functions are untouched
   - timers / activeBabyId / theme stay per-device (not shared)
   ============================================================ */
(function () {
  // firebase-init.js bails (and shows a "check your connection" screen) if the SDK didn't load, so
  // window.LL may not exist. Reading .auth off undefined here would throw and take the boot state
  // machine down on top of the message the parent is already being shown.
  if (!window.LL || !window.LL.auth) return;
  var auth = window.LL.auth, db = window.LL.db;
  var LOCAL_PREFS_KEY = 'little-log-prefs-v1'; // per-device: activeBabyId, timers, theme
  // Ids whose bytes came from an owner-gated pregnancy photos subcollection (not the circle
  // collection). Lets the two byte listeners share PhotoStore.map without stepping on each other.
  PhotoStore.privIds = PhotoStore.privIds || {};

  // Repaints the NETWORK asked for, not the parent. Thirteen listeners live in this file and each
  // one used to call render() the moment its snapshot landed, so a single sync burst (sign-in, a
  // reconnect, a caregiver logging three feeds) meant a dozen full repaints back to back — on a
  // real timeline that is seconds of frozen phone. renderSoon coalesces them to one per frame.
  // Taps stay on the synchronous render(): they measure and scroll on the very next line.
  function rerender() { try { (window.renderSoon || window.render || function () {})(); } catch (e) {} }

  var hhRef = null, eventsRef = null, photosRef = null, notesRef = null;
  var booted = false;
  var unsub = [];
  var knownEvents = {};      // id -> JSON of last-synced event (for diffing)
  var applyingRemote = false;
  var pushTimer = null;
  var firstRunShown = false;
  var lastHhSig = null; // signature of the last-applied household doc (dedupes our own write echoes)
  /* The household `app` blob is ONE Firestore field holding babies, medicines, vaccines, illnesses
     and milestones, and it used to be written as a whole-object replace from local state. Two
     consequences, both silent, both losing a family's health record:

       1. A device that had not yet received the household snapshot would push its own (empty or
          stale) state over the server's. Nothing guarded against it: pushNow checked only that
          hhRef existed.
       2. Two phones editing DIFFERENT things still clobbered each other, because each wrote the
          whole field. Mother adds a penicillin allergy, father's phone (which has not seen it yet)
          logs a milestone, and the allergy is gone. Both phones show a success toast.

     hhHydrated closes (1): nothing is written until the first snapshot has been applied, so local
     state is always server-state-plus-our-edits. blobBase closes (2): it records what we believe
     each sub-field holds, so a push writes only the keys that actually changed, as `app.<key>`
     field paths. Different areas of the record no longer collide, and a key this build has never
     heard of (written by a newer client) is left untouched rather than deleted. */
  var hhHydrated = false;      // has the household snapshot been applied at least once?
  var pushWhenHydrated = false; // a push was suppressed while unhydrated; run it once we are
  var blobBase = null;         // key -> stableStringify(value) of what the server is believed to hold

  // Raw SDK errors ("client is offline", "permission-denied", "auth/…") must never reach a
  // parent's eyes. One translator, used by every catch that shows a message.
  function isConnErr(e) {
    var code = (e && e.code) || '';
    var m = String((e && e.message) || '');
    return navigator.onLine === false || code === 'unavailable' || code === 'auth/network-request-failed' || /offline|network/i.test(m);
  }
  window.cubbyIsConnErr = isConnErr;
  /* `queues` is opt-in, and that is the whole point. "Cubby will pick this up when you're back" is a
     guarantee, not a hedge: enablePersistence means a Firestore write offline lands in the local cache
     and the SDK delivers it later. But this one translator serves every catch in the app, and for a
     server round trip that CANNOT happen offline the same sentence is simply false — nothing is
     queued, no sign-in link will arrive when she is back, and nobody will ever tell her it did not.
     The truthful-copy precedent is to weaken the claim rather than keep it, so the default is now the
     honest weaker line and the promise has to be earned per call site. A call site misclassified this
     way understates; the old shape over-promised. */
  function errText(e, fallback, queues) {
    var code = (e && e.code) || '';
    if (isConnErr(e)) {
      return queues
        ? 'You look offline. Cubby will pick this up when you’re back.'
        : 'You look offline. This part needs a connection, so give it another go when you have one.';
    }
    if (code === 'permission-denied') return 'Cubby wasn’t allowed to save that. If this keeps happening, sign out and back in.';
    if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') return 'That sign-in link has expired or was already used. Send yourself a fresh one.';
    if (code === 'auth/invalid-email') return 'That email doesn’t look right. Mind checking it?';
    if (code === 'auth/too-many-requests') return 'Lots of tries in a row. Give it a minute, then try again.';
    return fallback || 'That didn’t work just now. Mind trying again?';
  }
  window.cubbyErrText = errText;

  /* ---------- maternal-private health (Privacy Max, gate G1) ----------
     The mother's clinical data NEVER enters the shared `app` blob. It lives in
     households/{hid}/mhealth/{ownerUid}/cat/{category}, written only by the owner,
     readable by the owner + any guardian uid she lists in sharedWith. `mood` (EPDS)
     is reserved and owner-only forever (no client feature yet). The 79 in-memory
     call sites are untouched; the privacy boundary is here, at sync time. */
  var MAT_CATS = {
    health:     ['weights', 'bp', 'glucose', 'glucoseUnit', 'urine', 'nausea', 'symptoms', 'supplements', 'supplementLog'],
    careteam:   ['careTeam'],
    conditions: ['conditions'],
    // 'mood' is owner-only FOREVER and can never be shared: hard-blocked in matSetShared/matCanRead and the
    // non-owner listener skips it (below). Her private feelings/wellbeing notes live here in
    // households/{hid}/mhealth/{owner}/cat/mood, kept out of the shareable clinical 'health' bucket, so a
    // note like "I feel low" can never reach a partner or the circle. Rules enforce sharedWith is empty.
    mood:       ['moodLog']
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

  /* ---------- kept-after-loss archive (state.pregnancyArchive) ----------
     The memories a mother chooses to KEEP when a pregnancy closes (endPregnancy(true)) were
     memory-only in cloud mode: persist() never wrote them anywhere, so one reload after a loss
     silently discarded the scans she had just decided to keep. They persist OWNER-PRIVATE in
     users/{uid}.pregnancyArchive — the one doc only she can ever read or write (rules:
     users/{uid} is self-only, already published), so it needs NO rules change, survives reload
     AND device switch, is never visible to the circle, and account deletion (which deletes
     users/{uid} and purges her pregnancy photo bytes) takes it along correctly. The journey doc
     was the wrong home: pregClear deletes it, syncPregJourney overwrites it wholesale, and its
     sharedWith would show a LATER journey's readers her earlier loss. The photo BYTES survive
     separately in pregnancy/{uid}/photos, whose rules already let the owner read her own with
     the parent doc gone (asserted in test/rules-test.js Part 3). */
  var knownPregArchive = null;    // sig of the last-synced archive (diffing; null = dirty/unknown)
  var pregArchiveLoaded = false;  // boot read landed; until then NEVER push (an early [] would clobber the cloud copy)

  /* ---------- pregnancy photo BYTES (owner-gated, PRIV: bytes follow the metadata) ----------
     A bump/scan photo's metadata (moments, journey cards) lives on the owner-gated pregnancy
     doc — but the BYTES used to go to households/{hid}/photos, which every circle member can
     read. So the bytes now live in households/{hid}/pregnancy/{owner}/photos/{photoId}, where
     rules apply the exact gate the metadata already has (owner, or her sharedWith list). */
  var pregPhotoUnsubOwn = null;     // my own journey-photos listener (always on: kept keepsakes survive pregClear)
  var pregPhotoUnsubOther = null;   // one foreign journey's photos (when her doc is shared with me)
  var pregPhotoOtherOwner = null;   // whose foreign photos we listen to
  var circlePhotoIds = {};          // ids currently present in the circle-visible /photos collection
  var pregBytesMigrating = false;   // one in-flight migration pass at a time
  window.LL.memberEmails = {};      // PRIV-2: owner-only mirror of /memberEmails (uid -> email)
  var memberEmailsUnsub = null;     // owner-only listener on /memberEmails
  var avatarClaimT = null;          // debounce: write down which bear is ours once the roster settles
  var memberEmailsMigrated = false; // one owner migration attempt per session
  var ownEmailWritten = false;      // wrote my own memberEmails doc this session

  /* ---------- styles for the sign-in overlay ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#llAuthOv{position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#F7F2E8,#EFE6D6);display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Nunito Sans",system-ui,sans-serif;}'
    + '.ll-auth-card{background:#fff;border-radius:24px;padding:40px 28px;max-width:360px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12);}'
    /* Boot loader is a splash, not a dialog. The iOS app opens with a full-bleed bear splash; the
       card version made the very next moment feel like a popup. Same content, no card chrome —
       the page itself carries it, in both themes. */
    + '.ll-auth-card.ll-boot{background:transparent;border-radius:0;box-shadow:none;padding:0;}'
    + '[data-theme="night"] .ll-auth-card.ll-boot{background:transparent;outline:none;}'
    + '.ll-auth-logo{font-size:54px;line-height:1;margin-bottom:8px;}'
    + '.ll-auth-logo-img{width:84px;height:84px;border-radius:20px;display:block;margin:0 auto 12px;box-shadow:0 6px 18px rgba(0,0,0,.12);}'
    + '.ll-auth-card h1{font-family:"Fraunces",Georgia,serif;font-size:30px;margin:6px 0 4px;color:#2C2521;}'
    + '.ll-auth-card p{color:#6E635B;font-size:15px;margin:0 0 24px;line-height:1.4;}'
    + '.ll-auth-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid #E0D7C7;background:#fff;color:#2C2521;font-size:16px;font-weight:700;padding:14px 18px;border-radius:14px;cursor:pointer;font-family:inherit;}'
    // Google's light-theme surface/border/text, per their sign-in branding guidelines.
    + '.ll-auth-btn-google{border-color:#747775;background:#FFFFFF;color:#1F1F1F;}'
    + '.ll-auth-btn-google:hover{background:#F7F8F8;}'
    + '.ll-auth-btn-google svg{width:20px;height:20px;flex:0 0 auto;}'
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
    + '.ll-fp{display:flex;align-items:flex-end;justify-content:center;margin:2px 0 10px;min-height:48px;}'
    + '.ll-fp-a{display:inline-flex;width:46px;height:46px;border-radius:50%;overflow:hidden;background:#F3EFE7;'
    + 'box-shadow:0 0 0 3px #FFF;margin-left:-10px;}'
    + '.ll-fp-a:first-child{margin-left:0;}'
    + '.ll-fp-a svg,.ll-fp-a img{width:100%;height:100%;object-fit:cover;}'
    + '.ll-fp-cub{width:40px;height:40px;}'
    + '.ll-fp-more{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;'
    + 'border-radius:50%;background:#EFE7DA;color:#7a6d60;font-weight:800;font-size:13px;box-shadow:0 0 0 3px #FFF;margin-left:-10px;}'
    + '.ll-hhname{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;'
    + 'background:var(--diaper-soft,#E4EFEA);border-radius:14px;margin-bottom:12px;}'
    + '.ll-hhname-k{font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:#6f8a80;}'
    + '.ll-hhname-v{font-family:var(--font-display,Georgia),serif;font-size:18px;font-weight:600;color:#2C2521;margin-top:2px;}'
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
    + '.nap-switch{width:44px;height:25px;border-radius:999px;background:var(--switch-off,#D9CDBB);position:relative;transition:.2s;flex:0 0 auto;}'
    + '.nap-switch::after{content:"";position:absolute;top:2px;left:2px;width:21px;height:21px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2);}'
    + '.nap-toggle input:checked + .nap-switch{background:var(--sleep,#7C8FB5);}'
    + '.nap-toggle input:checked + .nap-switch::after{transform:translateX(19px);}'
    + '.ll-mem-av{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:0 0 auto;}.ll-mem-av svg{width:100%;height:100%;display:block;}'

    /* ---------- Night ----------
       #llModalOv is the circle / invite / share sheet. It was hardcoded light and readable, but it
       opened as a full-brightness white sheet from a dark app. Stated as overrides so nothing about
       the light rendering moves.

       #llAuthOv and .ll-auth-* used to be excluded here, on the reasoning that Google's white button
       would look like a bug on a dark card. That was the wrong call, and it cost us the worst
       defect in the theme: this overlay is the boot loader AND the screen every sign-out lands on,
       including "Log out" on the bereavement holding screen, so a Night parent got a full cream
       page under a #1A1614 status bar. Google's guidelines protect the BUTTON, not the page behind
       it; a white button on a dark sheet is what every dark-mode app on the phone already looks
       like. So the surface follows the theme and the two provider buttons do not. */
    + '[data-theme="night"] #llAuthOv{background:linear-gradient(160deg,var(--bg-grad-1),var(--bg-grad-2));}'
    + '[data-theme="night"] .ll-auth-card{background:var(--card);outline:1px solid var(--hairline);outline-offset:-1px;}'
    + '[data-theme="night"] .ll-auth-card h1{color:var(--ink);}'
    + '[data-theme="night"] .ll-auth-card p,[data-theme="night"] .ll-values div{color:var(--ink-soft);}'
    + '[data-theme="night"] .ll-auth-msg{color:var(--ink-faint);}'
    + '[data-theme="night"] .ll-auth-btn{background:var(--surface);border-color:var(--line);color:var(--ink);}'
    + '[data-theme="night"] .ll-auth-btn:hover{background:var(--surface-2);}'
    // ...except the two provider buttons, which answer to their owners' guidelines rather than to our
    // theme: those guidelines are a condition of using the providers at all. Google keeps their white
    // surface + untouched four-colour G in both themes; Apple's own guideline is background-dependent,
    // so it changes appearance below.
    + '[data-theme="night"] .ll-auth-btn-google{background:#FFFFFF;border-color:#747775;color:#1F1F1F;}'
    + '[data-theme="night"] .ll-auth-btn-google:hover{background:#F7F8F8;}'
    /* Apple is the opposite case, and following their guideline is what moves it. The HIG ships three
       appearances and tells you to choose by background: the white style is "for dark backgrounds
       that provide sufficient contrast", and of the black style it says outright "don't use it on
       black or dark backgrounds". Ours was black on a #211B18 page — 1.17:1 against it, an invisible
       button-shaped hole held together by nothing but the edge. So Night takes the white style.
       NOT the white-outlined style: Apple reserves that for light backgrounds and explicitly says to
       avoid it on a dark one, and an outline would also add 2px of height and break the equal-height
       parity with Google that App Review 4.8 depends on.
       Everything Apple fixes stays fixed: their logo artwork and the "Continue with Apple" title are
       untouched, and their rule that the logo and title must both be black or white is satisfied by
       flipping `color` alone — the mark is fill="currentColor", so it turns black with the label.
       Google's button is white in both themes, so the two remain the same size and the same weight of
       white; neither provider is more prominent. */
    + '[data-theme="night"] .lp-apple{background:#FFFFFF;color:#000000;}'
    // brightness(1.2) lightens black; on a white fill it does nothing, so Night hovers the other way.
    + '[data-theme="night"] .lp-apple:hover{filter:brightness(.94);}'
    // The fallback auth card (used only if landing.js never loaded) is --card in Night, so its Apple
    // button is on a dark surface too and takes the same white style, by the same rule.
    + '[data-theme="night"] .ll-auth-btn-apple{background:#FFFFFF;border-color:#FFFFFF;color:#000000;}'
    + '[data-theme="night"] .ll-auth-btn-apple:hover{background:#F2F2F2;}'
    + '[data-theme="night"] .ll-spin{border-color:var(--line);border-top-color:var(--pump);}'
    + '[data-theme="night"] .ll-modal{background:var(--card);}'
    + '[data-theme="night"] .ll-modal-head h2,[data-theme="night"] .ll-mem-name,'
    + '[data-theme="night"] .ll-invite label{color:var(--ink);}'
    + '[data-theme="night"] #llModalX,[data-theme="night"] .ll-mem-email{color:var(--ink-faint);}'
    + '[data-theme="night"] .ll-mem{background:var(--surface);}'
    + '[data-theme="night"] .ll-invite{border-top-color:var(--divider);}'
    + '[data-theme="night"] .ll-invite input,[data-theme="night"] .ll-invite select{background:var(--surface);border-color:var(--line);color:var(--ink);}'
    + '[data-theme="night"] .ll-linkrow input{background:var(--surface);border-color:var(--line);color:var(--ink-soft);}'
    + '[data-theme="night"] .ll-ghost{background:var(--surface);color:var(--ink-soft);}'
    + '[data-theme="night"] .ll-check{color:var(--ink-soft);}'
    + '[data-theme="night"] .ll-modal-btn{color:var(--bg);}';
  document.head.appendChild(st);

  function overlay() {
    var ov = document.getElementById('llAuthOv');
    if (!ov) { ov = document.createElement('div'); ov.id = 'llAuthOv'; document.body.appendChild(ov); }
    return ov;
  }
  function hideOverlay() { if (_statusRot) { clearInterval(_statusRot); _statusRot = null; } var ov = document.getElementById('llAuthOv'); if (ov) ov.remove(); }

  /* Signed in, and we still could not reach her Cubby. This used to fall through to showSignIn(),
     which paints the whole marketing landing with "Continue with Google" on top of a parent who IS
     signed in. To her that reads as "you have been logged out and everything is gone" — frightening,
     and untrue: her data is on the device and the session is intact. So the connectivity card takes
     this screen instead, with the one action that can actually help. Stops the rotating loader lines
     first, or they keep drifting underneath a message that says the waiting is over. */
  function showConnTrouble(o) {
    if (_statusRot) { clearInterval(_statusRot); _statusRot = null; }
    if (!window.cubbyConnCard) return false;
    var ov = overlay();
    ov.classList.remove('landing');
    ov.innerHTML = window.cubbyConnCard(o);
    return true;
  }

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

  /* Email magic-link sign-in (alongside Google, never instead of it). Works in the app now that the
     universal link is in place: the worker mints the link on little-cubby.com, the AASA
     (/.well-known/apple-app-site-association) claims /__/auth/action for the app, so tapping it in Mail
     opens Cubby DIRECTLY — native-bridge.js's appUrlOpen catches the oobCode and finishes the sign-in
     inside the webview's own storage. This is also the path that lets a parent who signed up by email on
     the web get back into their account from the app. Requires the app to be installed on the same
     device (universal links are per-device), which is what "Open it on this device" tells them. */
  /* These three rows are injected straight under the provider buttons on the sign-in screen, so they
     have to follow the theme with it. Their colours are set inline (they are built as strings, not
     classes), and an inline style can't be beaten by a [data-theme] rule — but it CAN hold a custom
     property, which resolves per theme like any other. Every token's light value is the literal it
     replaces, so nothing here moves in Light. */
  function emailRowHtml() {
    return '<div class="ll-email-row" style="margin:14px auto 0;max-width:340px;text-align:center">'
      + '<button type="button" class="ll-email-toggle" style="border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink-soft,#6E635B);text-decoration:underline;padding:6px">Prefer email? Get a sign-in link</button>'
      + '<form class="ll-email-form" style="display:none;gap:8px;margin-top:8px">'
      + '<input type="email" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:0;font-family:inherit;font-size:15px;padding:11px 13px;border:1.5px solid var(--line,#E7DECF);border-radius:11px;background:var(--surface-2,#FBF7EF);color:var(--ink,#2C2521)">'
      + '<button type="submit" style="border:none;background:var(--note,#9A8C6E);color:var(--on-accent,#2C2521);font-family:inherit;font-weight:800;font-size:14px;padding:11px 14px;border-radius:11px;cursor:pointer;white-space:nowrap">Send link</button>'
      + '</form><div class="ll-email-note" style="font-size:12px;font-weight:600;color:var(--ink-soft,#6E635B);margin-top:7px"></div></div>';
  }
  /* Privacy reassurance + consent, shown right at the sign-in buttons. Links /privacy/ (live); no Terms
     link until /terms/ ships. */
  function consentHtml() {
    return '<div class="ll-consent" style="margin:13px auto 0;max-width:340px;text-align:center;font-size:12px;line-height:1.55;font-weight:600;color:var(--ink-soft,#8a7d70)">'
      + '🔒 Private to your family. No ads, we never sell your data.<br>'
      + 'By continuing you agree to our <a href="/privacy/" target="_blank" rel="noopener" style="color:var(--ink-soft,#6E635B);text-decoration:underline">privacy promise</a>.'
      + '</div>';
  }
  // Subtle install affordance at the sign-in gate (the marketing /install.js does not run on /app/).
  // Reuses the app's own canShowInstall/addToHomeScreen helpers (defined in index.html, loaded first).
  function installRowHtml() {
    /* NEVER on a signed-out screen. Both callers are the sign-in card, and installing to the home
       screen is the single action that BREAKS sign-in on iOS: the installed app gets its own storage
       container, and the OAuth handler is cross-origin so it completes in Safari and the session lands
       in the wrong jar. We were advertising the trap on the very screen it disables, and had been since
       2026-06-24. Sign in first, then offer the install — by then it costs nothing.
       Gated on the SESSION rather than at the call sites so a future signed-in surface still gets it. */
    try { if (!auth.currentUser) return ''; } catch (e) { return ''; }
    try { if (!(window.canShowInstall && window.canShowInstall())) return ''; } catch (e) { return ''; }
    return '<div class="ll-install-row" style="margin:10px auto 0;max-width:340px;text-align:center"><button type="button" id="llInstallBtn" style="border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink-soft,#6E635B);text-decoration:underline;padding:6px">Or add Cubby to your home screen</button><div id="llInstallMsg" class="ll-auth-msg" style="display:none"></div></div>';
  }
  function wireInstall(scope) {
    var ib = scope.querySelector('#llInstallBtn'); if (!ib || ib.__w) return; ib.__w = 1;
    ib.onclick = function () { if (window.addToHomeScreen) window.addToHomeScreen('llInstallMsg'); };
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function looksLikeEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
  function wireEmailRow(scope) {
    var row = scope.querySelector('.ll-email-row'); if (!row) return;
    var toggle = row.querySelector('.ll-email-toggle'), form = row.querySelector('.ll-email-form'), note = row.querySelector('.ll-email-note');
    var input = form.querySelector('input'), btn = form.querySelector('button');
    var LINKBTN = 'border:none;background:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;color:#6E635B;text-decoration:underline;padding:2px';
    var cdTimer = null;
    // (re)show the email form keeping what's typed, so a wrong or changed address can be corrected and re-sent.
    function openForm() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } note.textContent = ''; toggle.style.display = 'none'; form.style.display = 'flex'; btn.disabled = false; btn.textContent = 'Send link'; input.focus(); input.select(); }
    toggle.onclick = openForm;

    // Send (or resend) the sign-in link: our own Worker + Resend first (Firebase's built-in sender
    // has poor Gmail delivery), falling back to Firebase's sender if the endpoint is down. The link
    // itself is a standard Firebase email-sign-in link, finished below by signInWithEmailLink().
    function sendLink(email) {
      return fetch('/api/send-signin-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'send_failed'); return d; }); })
        .catch(function () { return auth.sendSignInLinkToEmail(email, { url: location.origin + '/app/', handleCodeInApp: true }); })
        .then(function () { try { localStorage.setItem('cubby-email-signin', email); } catch (e) {} });
    }

    // "Check your inbox" + a Resend control with a 30s cooldown (links get lost/delayed; the cooldown
    // avoids spamming the sender). Reused after both the first send and each resend.
    function showSent(email) {
      form.style.display = 'none';
      note.innerHTML = 'Check your inbox: we sent a sign-in link to <b>' + escHtml(email) + '</b>. Open it on this device.'
        + '<div class="ll-resend-row" style="margin-top:8px">Not arrived yet? <button type="button" class="ll-resend" style="' + LINKBTN + '">Resend link</button> &middot; <button type="button" class="ll-changeemail" style="' + LINKBTN + '">Wrong email?</button></div>';
      var rb = note.querySelector('.ll-resend');
      note.querySelector('.ll-changeemail').onclick = function () { input.value = email; openForm(); }; // fix a typo or use a different address
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      var left = 30; rb.disabled = true; rb.style.opacity = '.55'; rb.textContent = 'Resend in ' + left + 's';
      cdTimer = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(cdTimer); cdTimer = null; rb.disabled = false; rb.style.opacity = '1'; rb.textContent = 'Resend link'; }
        else rb.textContent = 'Resend in ' + left + 's';
      }, 1000);
      rb.onclick = function () {
        rb.disabled = true; rb.style.opacity = '.55'; rb.textContent = 'Sending…';
        sendLink(email).then(function () { showSent(email); }).catch(function (err) {
          var rr = note.querySelector('.ll-resend-row'); if (rr) rr.textContent = errText(err, 'Could not resend just now. Mind trying again?');
        });
      };
    }

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var email = input.value.trim();
      if (!looksLikeEmail(email)) { note.textContent = 'That email looks a bit off, mind checking it?'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      sendLink(email)
        .then(function () { showSent(email); })
        .catch(function (err) { btn.disabled = false; btn.textContent = 'Send link'; note.textContent = errText(err, 'Could not send the link just now. Mind trying again?'); });
    };
  }
  function maybeFinishEmailLink() {
    try {
      if (!auth.isSignInWithEmailLink(window.location.href)) return;
    } catch (e) { return; }
    var email = null;
    try { email = localStorage.getItem('cubby-email-signin'); } catch (e) {}
    if (!email) email = window.prompt('Confirm your email to finish signing in');
    /* This used to `return` in silence. The key is missing whenever the link is opened in a DIFFERENT
       storage container from the one that asked for it — which on iOS is every time, because Mail opens
       Safari and the request was made in the home-screen app. So the person is shown a bare prompt with
       no context, dismisses it, and lands on a sign-in screen that says nothing at all. */
    if (!email) { showSignIn('To finish signing in, we need the email address you asked for the link with.'); return; }
    auth.signInWithEmailLink(email.trim(), window.location.href)
      .then(function (res) {
        try { localStorage.removeItem('cubby-email-signin'); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        if (res && res.user && !res.user.displayName) {
          return res.user.updateProfile({ displayName: email.split('@')[0] });
        }
      })
      .catch(function (err) {
        showSignIn(errText(err, 'That sign-in didn’t finish. Send yourself a fresh link and try once more.'));
      });
  }

  function showSignIn(msg) {
    /* Any re-render of this screen means the attempt is over, one way or another, so the stuck-timer
       must not outlive it — otherwise backing out of a popup (a deliberate, normal act) gets told 25
       seconds later that it "did not come back". The timer nulls itself before calling in here, so
       this is a no-op on that path. */
    signInIdle();
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
      // Google's branding guidelines apply wherever their button appears, so carry the same official
      // four-colour G as the landing rather than a plain text button (landing.js loads first).
      + '<button id="llGoogleBtn" class="ll-auth-btn ll-auth-btn-google">' + (window.cubbyGoogleG || '') + 'Continue with Google</button>'
      + appleBtnHtml('card')
      + emailRowHtml()
      + consentHtml()
      + installRowHtml()
      + (msg ? '<div class="ll-auth-msg">' + msg + '</div>' : '')
      + '<div style="margin-top:16px;font-size:12px;font-weight:700"><a href="/" style="color:var(--ink-soft,#6E635B)">About Cubby · little-cubby.com</a></div>'
      + '</div>';
    document.getElementById('llGoogleBtn').onclick = signInGoogle;
    var llAppleBtn = document.getElementById('llAppleBtn');
    if (llAppleBtn) llAppleBtn.onclick = signInApple;
    wireEmailRow(ov); wireInstall(ov);
  }
  // Gentle loader lines, rotated while the app wakes. Deliberately loss-safe: about the home, the
  // parent and the relatable chaos (the kettle, the missing sock) — never the baby's body, which
  // could sting before we know whether a parent is grieving. Warm, brief, British, no guilt.
  var LOADER_LINES = [
    'Putting the kettle on…',
    'Finding the other sock…',
    'Folding the tiny washing…',
    'Brewing you a fresh coffee…',
    'Smoothing out the day…',
    'Gathering your little moments…',
    'Plumping the cushions…',
    'Tidying the nook…',
    'Letting the quiet settle…',
    'Dusting off the memories…',
    'Untangling the muslins…',
    'Keeping it all private and yours…',
    'Lining up the good bits…',
    'Taking a deep breath…',
    'Almost there…'
  ];
  var _statusRot = null;
  function showStatus(msg) {
    overlay().classList.remove('landing');
    // Always rotate the gentle lines so the delight covers the whole wait, including the data
    // load. A meaningful message (e.g. "Setting things up…") leads, then drifts into LOADER_LINES;
    // the generic "Loading…" just starts on a random gentle line.
    var meaningful = msg && msg !== 'Loading…' && msg !== 'Loading...';
    var lines = meaningful ? [msg].concat(LOADER_LINES) : LOADER_LINES;
    var i = meaningful ? 0 : Math.floor(Math.random() * lines.length);
    overlay().innerHTML =
      '<div class="ll-auth-card ll-boot"><img src="/icons/logo-512.png" alt="Cubby" class="ll-auth-logo-img">'
      + '<h1>Cubby</h1><div class="ll-spin"></div>'
      + '<div class="ll-auth-msg" id="llAuthMsg"></div></div>';
    var mEl = document.getElementById('llAuthMsg'); if (mEl) mEl.textContent = lines[i];
    if (_statusRot) { clearInterval(_statusRot); _statusRot = null; }
    _statusRot = setInterval(function () {
      var el = document.getElementById('llAuthMsg');
      if (!el) { clearInterval(_statusRot); _statusRot = null; return; }
      i = (i + 1) % lines.length;
      el.textContent = lines[i];
    }, 2200);
  }

  /* ---------- native (Capacitor) sign-in ----------
     signInWithPopup / signInWithRedirect are BROWSER mechanisms. Inside the iOS/Android wrapper the
     webview hands the OAuth URL to the system browser, so the redirect lands in Safari while the
     handshake state sits in the webview's sessionStorage -> Firebase fails with "missing initial
     state" (seen on the first TestFlight build, 2026-07-16). The fix is to run the provider dance
     NATIVELY (@capacitor-firebase/authentication wraps Google Sign-In and ASAuthorization), then hand
     the resulting credential to the same JS SDK the rest of the app already uses, so auth state,
     Firestore rules and every downstream listener are unchanged.
     The browser is untouched: every path here is guarded on nativeAuth(), which can only be non-null
     inside the wrapper. */
  function isNativeApp() {
    try { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); } catch (e) { return false; }
  }
  function nativeAuth() {
    try { return (isNativeApp() && (window.Capacitor.Plugins || {}).FirebaseAuthentication) || null; } catch (e) { return null; }
  }
  window.LL.isNativeApp = isNativeApp;

  /* Which STEP failed matters more than the message: the native provider sheet and the Firebase
     exchange fail for completely different reasons (entitlement/config vs audience/provider setup),
     and the raw text alone can't tell them apart. Stamped on the error so the sign-in screen can
     report it — without it a failure on a device we can't attach a debugger to is unreadable. */
  function stampStep(err, step) {
    try { if (err && typeof err === 'object' && !err.cubbyStep) err.cubbyStep = step; } catch (e) {}
    throw err;
  }
  // skipNativeAuth keeps the native Firebase SDK out of the auth state, so the JS SDK stays the
  // single source of truth (one session, not two that can drift apart).
  // Runs the native provider sheet and returns a Firebase credential. Split out from nativeSignIn
  // because account deletion needs the SAME credential for reauthenticateWithCredential — Firebase
  // demands a fresh login before it will destroy a user, and duplicating this dance would mean two
  // places to get the Apple rawNonce handling wrong.
  function nativeCredential(kind) {
    var P = nativeAuth();
    var call = kind === 'apple'
      ? P.signInWithApple({ skipNativeAuth: true })
      : P.signInWithGoogle({ skipNativeAuth: true });
    return call.catch(function (e) { return stampStep(e, 'provider'); }).then(function (res) {
      var c = (res && res.credential) || {};
      if (!c.idToken) { var e = new Error('no idToken came back from ' + kind); e.cubbyStep = 'provider'; throw e; }
      return kind === 'apple'
        ? new firebase.auth.OAuthProvider('apple.com').credential({ idToken: c.idToken, rawNonce: c.nonce })
        : firebase.auth.GoogleAuthProvider.credential(c.idToken, c.accessToken || null);
    });
  }
  function nativeSignIn(kind) {
    return nativeCredential(kind).then(function (cred) {
      return auth.signInWithCredential(cred).catch(function (e) { return stampStep(e, 'firebase'); });
    });
  }
  // Which provider this account actually signs in with, so a reauth prompt matches the button they
  // originally used instead of guessing.
  function providerKind(u) {
    var ids = ((u && u.providerData) || []).map(function (p) { return (p && p.providerId) || ''; });
    if (ids.indexOf('apple.com') >= 0) return 'apple';
    if (ids.indexOf('google.com') >= 0) return 'google';
    return null;
  }
  // Firebase refuses user.delete() on a stale session (auth/requires-recent-login). Prove who they
  // are again, through whichever door they came in by.
  function reauthenticate(u) {
    var kind = providerKind(u);
    // Email-link accounts would need a whole new link round trip mid-deletion. Rather than build a
    // half-working flow, say so plainly and let the UI ask them to sign in again first.
    if (!kind) { var e = new Error('reauth_unsupported'); e.cubbyStep = 'reauth'; return Promise.reject(e); }
    if (isNativeApp() && nativeAuth()) {
      return nativeCredential(kind).then(function (cred) { return u.reauthenticateWithCredential(cred); });
    }
    return u.reauthenticateWithPopup(kind === 'apple' ? window.LL.appleProvider : window.LL.googleProvider);
  }
  /* Backing out of the native sheet is normal and must stay silent. But detect it NARROWLY: an earlier
     version matched /cancel/i on the message and err.code === 1001, and BOTH are wrong — the plugin
     sends code as a string like "auth/...", and Apple's cancel reads "The operation couldn't be
     completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)", which never contains
     the word "cancel". So real cancels showed a red error, and (worse) any future broadening of this
     test risks swallowing a genuine failure into silence. Match the exact Apple/Google cancel codes. */
  function userCancelled(err) {
    var m = '' + ((err && (err.message || err.errorMessage)) || '');
    var c = '' + ((err && err.code) || '');
    return /AuthorizationError error 100[13]\b/.test(m)          // Apple: 1001 canceled, 1003 notHandled
      || /\bcanceled|cancelled\b/i.test(m)                        // Google Sign-In / generic
      || c === 'auth/cancelled-popup-request';
  }
  function nativeSignInFailed(err) {
    if (userCancelled(err)) { showSignIn(''); return; }
    // Show the step + code, not just the text. This is the only diagnostic we get back from a
    // TestFlight device, so it has to be specific enough to act on.
    var step = (err && err.cubbyStep) || 'native';
    var code = (err && err.code) ? ' [' + err.code + ']' : '';
    var msg = (err && err.message) || String(err);
    try { console.error('[cubby] native sign-in failed at ' + step + code, err); } catch (e) {}
    // errText exists precisely so raw SDK strings never reach a parent; this catch skipped it and
    // showed things like "auth/popup-blocked". The code still goes to the console for us.
    showSignIn(errText(err, 'That sign-in did not go through. Give it another go.'));
  }

  /* Busy state for EVERY sign-in surface. The production landing uses id-less .ll-cta buttons
     (landing.js), so disabling only #llGoogleBtn left the primary button dead-silent for the 1-3s
     popup wait — inviting the double-tap that cancels the first popup. Disable them all and swap
     the label text node (the Google G / Apple mark stays untouched, per branding rules). Buttons
     come back via showSignIn()'s full re-render on cancel or failure. */
  /* The buttons come back on their own. They used to come back ONLY via showSignIn()'s re-render on
     cancel or failure — so when the promise never settled at all, which is exactly what happens to an
     installed iOS home-screen app whose popup has no opener, every button stayed greyed at "Signing in…"
     forever with nothing said. A permanently dead button is the worst state in the app: it looks like
     the app is working on it, so the parent waits, and then blames themselves.
     Nothing recovers a promise that never settles except a clock. */
  var _signInTimer = null;
  function signInIdle() { if (_signInTimer) { clearTimeout(_signInTimer); _signInTimer = null; } }
  function signInBusy() {
    Array.prototype.forEach.call(document.querySelectorAll('.ll-cta, .ll-apple-cta, #llGoogleBtn, #llAppleBtn'), function (b) {
      if (b.disabled) return;
      b.disabled = true; b.style.opacity = '.6'; b.style.pointerEvents = 'none';
      for (var i = 0; i < b.childNodes.length; i++) {
        var n = b.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = 'Signing in…'; break; }
      }
    });
    signInIdle();
    _signInTimer = setTimeout(function () {
      _signInTimer = null;
      if (auth.currentUser) return;                 // it worked; the app is already moving on
      showSignIn(stuckSignInMsg());
    }, 25000);
  }
  /* What to say when sign-in did not come back. On an installed iOS home-screen app we KNOW why, so
     say the true thing and give the route that works today, rather than a generic apology. */
  function stuckSignInMsg() {
    var standalone = false, ios = false;
    try { standalone = (typeof isStandaloneApp === 'function' && isStandaloneApp()); } catch (e) {}
    try { ios = (typeof isIOSDevice === 'function' && isIOSDevice()); } catch (e) {}
    if (standalone && ios) {
      return 'Sign-in cannot finish inside the home-screen app yet. Open <b>little-cubby.com</b> in Safari '
        + 'and sign in there, and we are fixing this so you do not have to.';
    }
    return 'That did not come back. Mind trying again?';
  }
  function signInGoogle() {
    signInBusy();
    if (nativeAuth()) { nativeSignIn('google').catch(nativeSignInFailed); return; }
    auth.signInWithPopup(window.LL.googleProvider).catch(function (err) {
      // Backing out of the popup is a normal, chosen action — stay quiet, like native does.
      if (err && err.code === 'auth/popup-closed-by-user') { showSignIn(''); return; }
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request'
        || err.code === 'auth/operation-not-supported-in-this-environment')) {
        auth.signInWithRedirect(window.LL.googleProvider); return;
      }
      showSignIn(errText(err, 'That sign-in did not go through. Give it another go.'));
    });
  }

  function signInApple() {
    signInBusy();
    if (nativeAuth()) { nativeSignIn('apple').catch(nativeSignInFailed); return; }
    auth.signInWithPopup(window.LL.appleProvider).catch(function (err) {
      // Backing out of the popup is a normal, chosen action — stay quiet, like native does.
      if (err && err.code === 'auth/popup-closed-by-user') { showSignIn(''); return; }
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request'
        || err.code === 'auth/operation-not-supported-in-this-environment')) {
        auth.signInWithRedirect(window.LL.appleProvider); return;
      }
      showSignIn(errText(err, 'That sign-in did not go through. Give it another go.'));
    });
  }

  window.LL.signOut = async function () {
    // Flush any debounced write before signing out, so the last-logged entry isn't lost
    // (confirmLogout promises "your data stays safely synced").
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; try { await pushNow(); } catch (e) {} }
    teardown(); auth.signOut();
  };

  function teardown() {
    unsub.forEach(function (u) { try { u(); } catch (e) {} });
    matUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    pregUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    unsub = []; matUnsub = []; pregUnsub = []; booted = false; knownEvents = {};
    _lastInviteEmail = ''; // per-uid cache: never let one account's invite email survive into the next
    matOwner = null; matShared = {}; knownMat = {};
    pregOwner = null; pregShared = []; knownPregJourney = null; legacyBlobPreg = null; pregMigrated = false;
    if (pregPhotoUnsubOwn) { try { pregPhotoUnsubOwn(); } catch (e) {} pregPhotoUnsubOwn = null; }
    if (pregPhotoUnsubOther) { try { pregPhotoUnsubOther(); } catch (e) {} pregPhotoUnsubOther = null; }
    pregPhotoOtherOwner = null; circlePhotoIds = {}; pregBytesMigrating = false;
    ownPregPhotoIds = {}; otherPregPhotoIds = {};
    PhotoStore.privIds = {}; PhotoStore.map = {}; // one account's photo bytes never survive into the next session
    if (memberEmailsUnsub) { try { memberEmailsUnsub(); } catch (e) {} memberEmailsUnsub = null; }
    if (avatarClaimT) { clearTimeout(avatarClaimT); avatarClaimT = null; } // never claim a bear into the account being left
    window.LL.memberEmails = {}; memberEmailsMigrated = false; ownEmailWritten = false;
    hhRef = eventsRef = photosRef = notesRef = null;
    // The next account starts unhydrated with no baseline, or this account's blob would be the
    // thing the next one's first push is diffed against.
    hhHydrated = false; pushWhenHydrated = false; blobBase = null;
    state.notes = [];
    // Clear in-memory subject data so one account's journey + maternal-private health (applyMatDoc
    // folds mhealth fields into state.pregnancy) can never survive into the next account's session
    // after an in-tab sign-out/sign-in. Privacy-Max: no leftover. The kept-after-loss archive is
    // hers alone for the same reason (the per-uid localStorage cache stays: it is keyed by HER uid
    // and the next account never reads another uid's key).
    state.pregnancy = null;
    state.pregnancyArchive = [];
    knownPregArchive = null; pregArchiveLoaded = false; pregArchiveStamp = 0; pregArchCacheSig = null;
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
  // PRIV-2: record my own sign-in email in my memberEmails doc (self + owner readable by rule).
  // Best-effort and idempotent; called after create/join and once per session at sync start, so
  // the address exists wherever the owner needs it (invite matching, removal cleanup) without
  // ever sitting in the circle-readable household doc.
  function writeOwnMemberEmail(hidOrRef) {
    try {
      var u = auth.currentUser; if (!u) return;
      var em = (u.email || '').toLowerCase(); if (!em) return;
      var ref = (typeof hidOrRef === 'string') ? db.collection('households').doc(hidOrRef) : hidOrRef;
      if (!ref) return;
      ref.collection('memberEmails').doc(u.uid).set({ email: em })
        .catch(function (e) { console.warn('memberEmail set', e); });
    } catch (e) {}
  }
  // LAZY MIGRATION (PRIV-2), owner's device only: move every email still sitting in the shared
  // memberInfo blob into /memberEmails/{uid}, then strip the blob fields. The email docs are
  // written and awaited FIRST; the strip runs only after every copy landed, so a failure can
  // never lose an address — worst case it stays where it was and the next load retries.
  function maybeMigrateMemberEmails(d) {
    if (memberEmailsMigrated || !hhRef) return;
    if ((window.LL.role || '') !== 'owner') return;
    var info = (d && d.memberInfo) || {};
    var withEmail = Object.keys(info).filter(function (u) { return info[u] && info[u].email; });
    if (!withEmail.length) { memberEmailsMigrated = true; return; }
    memberEmailsMigrated = true; // one attempt per session; a failed attempt retries next load
    Promise.all(withEmail.map(function (u) {
      return hhRef.collection('memberEmails').doc(u).set({ email: String(info[u].email).toLowerCase() });
    })).then(function () {
      var upd = {};
      withEmail.forEach(function (u) { upd['memberInfo.' + u + '.email'] = firebase.firestore.FieldValue.delete(); });
      return hhRef.update(upd);
    }).catch(function (e) { console.warn('memberEmail migrate', e); });
  }
  function membersMap(uid, r) { var m = {}; m[uid] = r; return m; }
  // PRIV-2: memberInfo (the circle-shared blob) no longer carries email addresses. A member's
  // sign-in email goes to households/{hid}/memberEmails/{uid} (writeOwnMemberEmail), which rules
  // gate to that member + the household owner(s). Everyone still sees names and bear labels.
  function memberInfoMap(user, r, rel) { var m = {}; m[user.uid] = { name: user.displayName || '', photoURL: user.photoURL || '', role: r, relationship: rel || '' }; return m; }
  function memberUpdate(user, r, opts) {
    opts = opts || {};
    var u = {};
    u['members.' + user.uid] = r;
    /* joinedAt exists so "did a second caregiver arrive in the first week" is answerable at all —
       without it the one number this product should be judged on cannot be computed from the data.
       Safe to write unconditionally: this helper has exactly two callers and both of them ARE the
       join (the pending-data path and the invite path). There is no profile-update caller that
       would reset it. A genuine re-join does re-stamp, which is the honest reading anyway. */
    u['memberInfo.' + user.uid] = { name: opts.name || user.displayName || '', photoURL: user.photoURL || '', role: r, relationship: opts.relationship || '', joinedAt: window.LL.serverTimestamp() };
    return u;
  }

  /* The three settings keys that must never reach the circle-shared blob: `seen` (per-uid), `push`
     (per-device) and `theme` (per-uid). One helper for every write path, because there are two and
     they used to disagree: appBlobFromState stripped them on every ongoing save, while the
     first-sign-in migration below seeded the brand-new household with state.settings raw — so a
     household could still be born carrying one person's Night. Kept as a single function so a
     fourth key can never be stripped in one path and forgotten in the other. Stripping is
     OUTBOUND ONLY: applyAppBlob still reads an existing settings.theme, and migrateThemePref in
     index.html still uses it as migration input for anyone yet to open this build. */
  function sharedSettings(src) {
    var s = Object.assign({}, src || state.settings || {});
    delete s.seen; delete s.push; delete s.theme;
    return s;
  }

  async function buildMigrationPayload() {
    var app = { babies: [], settings: sharedSettings(), milestones: [], meds: [], vaccines: {}, illnesses: [], photos: [] };
    var events = [], photos = {};
    try {
      var raw = localStorage.getItem('little-log-v1');
      if (raw) {
        var s = JSON.parse(raw);
        if (s) {
          app.babies = s.babies || []; app.settings = sharedSettings(s.settings);
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
    // Kept-after-loss memories ride this same read (no extra fetch), and this await sits BEFORE
    // startSync/booted — so renderLossHolding and the look-back see them on the very first paint.
    applyPregArchive(user.uid, snap.exists ? snap.data() : null);
    if (snap.exists && snap.data().householdId) {
      var curHid = snap.data().householdId;
      // If a DIFFERENT pending invite also exists for this email, stash it so we can surface it
      // after boot. (The old code returned here and the invite sat pending forever — an existing
      // Cubby user could never accept an invite, a silent dead-end for beta testers.)
      try {
        var em0 = (user.email || '').toLowerCase();
        if (em0) {
          var pend = await db.collection('invites').doc(em0).get();
          if (pend.exists && pend.data().householdId && pend.data().householdId !== curHid) {
            window.LL.pendingInvite = Object.assign({ email: em0 }, pend.data());
          }
        }
        // Same for a token link. Someone who already has a Cubby must never be moved into another
        // family silently: this only surfaces the offer, and maybePromptPendingInvite asks first,
        // with the honest copy about losing their own circle.
        if (!window.LL.pendingInvite) {
          var lk0 = await readInviteLink(joinToken(), curHid);
          if (lk0) window.LL.pendingInvite = Object.assign({ viaLink: true }, lk0);
        }
      } catch (e) {}
      return curHid;
    }

    /* A token link, for someone with no household of their own. They have nothing to lose by
       joining, so this matches the email path exactly and joins directly. Claim first: the claim is
       the single-use gate, enforced in the rules, so the loser of a race never touches the
       household. Tried BEFORE the email invite because the token is the more specific instruction —
       she followed this exact link — and because it is the path that works when Hide My Email has
       already made her address unrecognisable. */
    var tok = joinToken();
    if (tok) {
      var link = await readInviteLink(tok, null);
      if (link && await claimInviteLink(link, user)) {
        clearInviteMismatch();
        return link.householdId;
      }
    }

    // Invited? Invites are keyed by lowercased email (so the rules can authorize the join).
    var email = (user.email || '').toLowerCase();
    if (email) {
      var inv = await db.collection('invites').doc(email).get();
      if (inv.exists) {
        var data = inv.data();
        await db.collection('households').doc(data.householdId).update(memberUpdate(user, data.role || 'caregiver', { relationship: data.relationship, name: data.name }));
        writeOwnMemberEmail(data.householdId); // PRIV-2: email goes to the gated doc, not memberInfo
        await userRef.set({ householdId: data.householdId, name: user.displayName || '', email: user.email || '' }, { merge: true });
        // Remember that this session is a JOIN, not a return, so the first-run screen can say whose
        // circle they have walked into. Read once by openFirstRun and never persisted.
        window.LL.justJoined = { invitedBy: data.invitedBy || null, role: data.role || 'caregiver' };
        try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
        clearInviteMismatch(); // a corrected address joined for real: never leave the mismatch screen on top
        return data.householdId;
      }
    }

    // They followed someone's invite link, but no invite matches the address they just signed in
    // with. Creating a fresh household here (which is what used to happen) is the worst possible
    // answer: they land in an empty Cubby, as its owner, with their partner's circle nowhere in
    // sight and nothing on screen suggesting anything went wrong. Apple's Hide My Email makes this
    // the DEFAULT outcome for a caregiver invited to their real address.
    //
    // So stop, explain, and give them the two ways out. Nothing is written.
    // A spent or expired token is not an email problem, and the email screen would send her to fix
    // something that is not broken.
    if (tok) { showInviteMismatch(email || '', true); return null; }
    if (joinIntent() && email) {
      showInviteMismatch(email);
      return null;
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
    writeOwnMemberEmail(newRef); // PRIV-2: email goes to the gated doc, not memberInfo
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
      babies: state.babies || [],
      // `seen` (coach marks, tips, the get-started checklist, the install nudge) is PER PERSON and
      // must never ride along in the circle-shared blob: it used to, which meant whoever opened
      // Cubby first marked every hint as explained for the co-parent and every later caregiver.
      // It lives in localStorage under the uid now (seenMap/markSeen in index.html). Stripped on
      // the way out so existing households stop re-broadcasting the old value.
      // `push` (reminder on/off + quiet hours) is PER DEVICE for the same reason: a push token is
      // one device's, so the enabled flag must be too. In the shared blob it meant caregiver B was
      // shown "On for this device" they never enabled, and B tapping Off wrote enabled:false back to
      // A, stopping A's reminder index from refreshing — the A5-class per-user-vs-shared bug. The
      // token map and the cron's enabled flag already live per-uid in users/{uid}.push; this keeps
      // the UI's own view of it out of the circle. It stays in localStorage via persist().
      // `theme` is the third of the same family and the reason the appearance work happened: one
      // caregiver picking Night darkened the app for the whole circle. The per-uid choice now lives
      // in localStorage under cubby-theme:<uid> (themeKey in index.html), so this write was the last
      // thing keeping the old shared value alive and re-broadcasting it. Dropped on the way OUT
      // only: applyAppBlob still READS an existing settings.theme, and migrateThemePref still uses
      // it as migration input for anyone who has not opened this build yet. A device on the previous
      // build reads its own per-device copy in little-log-prefs-v1 first, so losing the shared field
      // cannot flip a household that actually chose Night — only one that never did.
      settings: sharedSettings(),
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
      lossHolding: state.lossHolding || null   // per-uid map {uid:{at}} of the calm holding state after a loss: a reload restores it for the SAME person, but it never broadcasts the bereavement screen to other members, and one member clearing their own never clears another's (see myLossHolding/clearMyLossHolding in index.html)
    };
  }
  function applyAppBlob(app) {
    if (!app) return;
    var localTheme = state.settings && state.settings.theme; // theme is per-device
    var localPush = state.settings && state.settings.push;   // reminder on/off + quiet hours: per-device (see appBlobFromState)
    state.babies = app.babies || [];
    state.settings = Object.assign({}, app.settings || {});
    if (localTheme) state.settings.theme = localTheme;
    if (localPush) state.settings.push = localPush;
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
  // One serialization per top-level blob key, so a push can tell which areas of the shared record
  // this device actually touched.
  function snapshotBlobBase() {
    var b = appBlobFromState(), m = {};
    Object.keys(b).forEach(function (k) { m[k] = stableStringify(b[k]); });
    return m;
  }

  /* ---------- maternal-private sync (mhealth subcollection) ---------- */
  // Fold a category doc's data back into state.pregnancy (private fields live in memory only).
  function applyMatDoc(cat, d) {
    if (!d) return;
    /* ONLY the maternal categories fold into state.pregnancy. This guard looks redundant today and
       is not: the mhealth collection is a general owner-private store, this listener is a
       whole-collection snapshot, and the fold below copies every key it finds. pregJourneyData is a
       DENY-list keyed on MAT_PRIVATE_KEYS, which is derived from MAT_CATS — so any category NOT in
       MAT_CATS would be folded into state.pregnancy and then written straight back out into the
       journey doc, which carries sharedWith. Storing anything owner-private outside MAT_CATS
       (medicines, next) would publish it to everyone she told she was pregnant. Fail closed. */
    if (!MAT_CATS[cat]) return;
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
        if (booted) rerender();
      }, function (e) { console.warn('mhealth own listen', e); }));
    } else {
      // A non-owner: try each shareable category; ones not shared with us fail permission and are ignored.
      Object.keys(MAT_CATS).forEach(function (cat) {
        if (cat === 'mood') return; // never shared
        matUnsub.push(base.doc(cat).onSnapshot(function (doc) {
          if (!doc.exists) return;
          applyingRemote = true; applyMatDoc(cat, doc.data()); applyingRemote = false;
          if (booted) rerender();
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
    ensureOtherPregPhotoListener(null); // and stop rendering byte we may no longer see
  }

  /* ---------- pregnancy photo BYTES (owner-gated subcollection) ---------- */
  // Bytes live in households/{hid}/pregnancy/{owner}/photos/{photoId} = {data, authorId}.
  // Two listeners can feed PhotoStore.map: my OWN subcollection (always attached — rules always
  // allow it, and after a kept loss these are the kept keepsakes) and at most ONE foreign
  // journey's (attached only once her doc is readable, i.e. she shared with me).
  var ownPregPhotoIds = {}, otherPregPhotoIds = {};
  function handlePregPhotoSnap(snap, bag) {
    snap.docChanges().forEach(function (ch) {
      var id = ch.doc.id;
      if (ch.type === 'removed') {
        delete bag[id]; delete PhotoStore.privIds[id];
        if (!circlePhotoIds[id]) delete PhotoStore.map[id];
      } else {
        bag[id] = 1; PhotoStore.privIds[id] = 1;
        PhotoStore.map[id] = ch.doc.data().data;
      }
    });
    if (booted && !(snap.metadata && snap.metadata.hasPendingWrites)) rerender();
  }
  function ensureOwnPregPhotoListener(uidNow) {
    if (pregPhotoUnsubOwn || !hhRef || !uidNow) return;
    pregPhotoUnsubOwn = hhRef.collection('pregnancy').doc(uidNow).collection('photos')
      .onSnapshot(function (snap) { handlePregPhotoSnap(snap, ownPregPhotoIds); },
        function (e) { /* nothing readable yet; ignore */ });
  }
  function ensureOtherPregPhotoListener(owner) {
    if (owner === pregPhotoOtherOwner) return;
    if (pregPhotoUnsubOther) { try { pregPhotoUnsubOther(); } catch (e) {} pregPhotoUnsubOther = null; }
    // Drop the old journey's bytes from the map: losing read access (unshared, or a loss she
    // chose not to broadcast) must also stop these photos rendering on this device.
    Object.keys(otherPregPhotoIds).forEach(function (id) {
      delete PhotoStore.privIds[id];
      if (!circlePhotoIds[id]) delete PhotoStore.map[id];
    });
    otherPregPhotoIds = {};
    pregPhotoOtherOwner = owner;
    if (!owner || !hhRef) return;
    pregPhotoUnsubOther = hhRef.collection('pregnancy').doc(owner).collection('photos')
      .onSnapshot(function (snap) { handlePregPhotoSnap(snap, otherPregPhotoIds); },
        function (e) { if (pregPhotoOtherOwner === owner) ensureOtherPregPhotoListener(null); });
  }

  // LAZY MIGRATION (PRIV: pregnancy bytes). Before this build the bytes of every pregnancy
  // photo were written to the circle-visible /photos collection. On the device that owns the
  // referencing metadata (her journey, or a device-local kept-memories archive), copy each
  // referenced byte doc into the owner-gated subcollection, then delete the circle copy.
  // Copy-first and awaited, so a failure can never lose bytes; a failed delete just leaves
  // the old copy for the next pass.
  function pregReferencedPhotoIds() {
    var ids = {};
    var p = state.pregnancy || {};
    (p.moments || []).forEach(function (m) { if (m && m.photoId) ids[m.photoId] = 1; });
    var saved = (p.journey && p.journey.saved) || {};
    Object.keys(saved).forEach(function (k) { var r = saved[k]; if (r && r.photoId) ids[r.photoId] = 1; });
    (state.pregnancyArchive || []).forEach(function (a) {
      (a.moments || []).forEach(function (m) { if (m && m.photoId) ids[m.photoId] = 1; });
    });
    return Object.keys(ids);
  }
  function maybeMigratePregPhotoBytes() {
    if (pregBytesMigrating || !hhRef || !photosRef) return;
    var uidNow = auth.currentUser && auth.currentUser.uid; if (!uidNow) return;
    var p = state.pregnancy;
    var ownsJourney = !!(p && p.ownerUid && p.ownerUid !== 'local' && p.ownerUid === uidNow);
    var hasKept = (state.pregnancyArchive || []).some(function (a) { return (a.moments || []).length; });
    if (!ownsJourney && !hasKept) return; // nothing here is ours to relocate
    var pending = pregReferencedPhotoIds().filter(function (id) { return circlePhotoIds[id] && PhotoStore.map[id]; });
    if (!pending.length) return;
    pregBytesMigrating = true;
    var priv = hhRef.collection('pregnancy').doc(uidNow).collection('photos');
    (async function () {
      for (var i = 0; i < pending.length; i++) {
        var id = pending[i];
        try {
          await priv.doc(String(id)).set({ data: PhotoStore.map[id], authorId: uidNow });
          PhotoStore.privIds[id] = 1; ownPregPhotoIds[id] = 1;
          await photosRef.doc(String(id)).delete();
        } catch (e) { console.warn('preg photo migrate', e); }
      }
    })().then(function () { pregBytesMigrating = false; }, function () { pregBytesMigrating = false; });
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
      maybeMigratePregPhotoBytes(); // my journey metadata just (re)arrived: relocate any circle-visible bytes
      if (booted) rerender();
    }, function (e) { /* own doc not readable yet; ignore */ }));
    // A non-owner: try every other member's journey doc. Not shared with us -> permission-denied, ignored.
    var members = (window.LL.members && Object.keys(window.LL.members)) || [];
    members.forEach(function (m) {
      if (m === uidNow) return;
      pregUnsub.push(base.doc(m).onSnapshot(function (doc) {
        if (!doc.exists) { if (pregOwner === m) { pregOwner = null; clearPregJourneyState(); if (booted) rerender(); } return; }
        applyingRemote = true; pregOwner = m; applyPregJourney(m, doc.data()); applyingRemote = false;
        ensureMaternalListeners(uidNow);
        ensureOtherPregPhotoListener(m); // her doc is readable -> her photo bytes are too
        if (booted) rerender();
      }, function (e) {
        // We WERE reading this member's journey and now can't: she removed us from sharedWith. Losing
        // read access has to clear the pregnancy we were rendering — otherwise the week hero and the
        // size-of-a-fruit line keep updating forever on a journey we are no longer permitted to see,
        // and after a loss that is the exact thing the charter forbids. Distinct from the ordinary
        // "never shared with us" error, where pregOwner !== m and there is correctly nothing to clear.
        if (pregOwner === m) { pregOwner = null; clearPregJourneyState(); if (booted) rerender(); }
      }));
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

  /* ---------- kept-after-loss archive sync (owner-private, users/{uid}) ---------- */
  // A per-uid localStorage cache {at, arr}, written synchronously on every persist() (see
  // scheduledPush): a tab closed inside the 350 ms push debounce, right after she chose "Keep
  // my memories", must still not lose them. Keyed by uid so one account's loss is never
  // another's to read. `at` moves ONLY when the archive itself changes, so at boot the fresher
  // of cache vs cloud wins — a crash-cached keep beats an old cloud [], while a remove done on
  // another device is never resurrected by this device's stale cache.
  var pregArchiveStamp = 0;   // when the adopted archive last changed (ms)
  var pregArchCacheSig = null; // sig behind the stamp (advance `at` only on real change)
  function pregArchCacheKey(uidNow) { return 'cubby-pregarch-' + uidNow; }
  function savePregArchiveCache(uidNow) {
    if (!uidNow) return;
    try {
      var arr = state.pregnancyArchive || [];
      var sig = stableStringify(arr);
      if (sig !== pregArchCacheSig) { pregArchCacheSig = sig; pregArchiveStamp = Date.now(); }
      localStorage.setItem(pregArchCacheKey(uidNow), JSON.stringify({ at: pregArchiveStamp, arr: arr }));
    } catch (e) {}
  }
  // Fold the users/{uid} doc into state at boot. Whichever side changed most recently wins;
  // adopting the cache leaves the sync dirty (knownPregArchive=null) so the next push writes it
  // up. Nothing here ever deletes anything.
  function applyPregArchive(uidNow, d) {
    var cloudArr = (d && Array.isArray(d.pregnancyArchive)) ? d.pregnancyArchive : null;
    var cloudAt = (d && typeof d.pregnancyArchiveAt === 'number') ? d.pregnancyArchiveAt : 0;
    var cache = null;
    try {
      var raw = localStorage.getItem(pregArchCacheKey(uidNow));
      if (raw) { cache = JSON.parse(raw); if (Array.isArray(cache)) cache = { at: 0, arr: cache }; }
    } catch (e) { cache = null; }
    if (cache && Array.isArray(cache.arr) && (cache.at || 0) > cloudAt) {
      // The cache is fresher: a crash (or a failed push) beat the cloud. Restore, and push up.
      state.pregnancyArchive = cache.arr;
      pregArchiveStamp = cache.at || 0;
      knownPregArchive = null;
    } else {
      state.pregnancyArchive = cloudArr || [];
      pregArchiveStamp = cloudAt;
      knownPregArchive = stableStringify(state.pregnancyArchive);
    }
    pregArchCacheSig = stableStringify(state.pregnancyArchive);
    pregArchiveLoaded = true;
    savePregArchiveCache(uidNow);
  }
  // The archive's share of persist(): only she can write her own users doc (rules), and merge
  // keeps householdId / push tokens / acq intact. Mirrors the events retry pattern — a failed
  // write goes back to dirty so the next push tries again, instead of being lost forever.
  async function syncPregArchive(uidNow) {
    if (!uidNow || !pregArchiveLoaded) return; // never push (especially not []) before the boot read landed
    var arr = state.pregnancyArchive || [];
    var sig = stableStringify(arr);
    if (sig !== pregArchCacheSig) { pregArchCacheSig = sig; pregArchiveStamp = Date.now(); } // changed outside persist()
    if (knownPregArchive === sig) return;
    knownPregArchive = sig;
    try {
      await db.collection('users').doc(uidNow).set({ pregnancyArchive: arr, pregnancyArchiveAt: pregArchiveStamp || Date.now() }, { merge: true });
    } catch (e) {
      if (knownPregArchive === sig) knownPregArchive = null;
      console.warn('pregnancy archive push', e);
    }
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
  // Calm recovery screen for a removed member (or a deleted household) — instead of an endless
  // loader. Clears the stale pointer so a fresh sign-in starts clean.
  // Did this open come from someone's invite link? Set by stashDeepLink() in index.html from
  // `?join=1`, which carries no personal data and survives the sign-in redirect.
  function joinIntent() {
    try { return !!sessionStorage.getItem('cubby-join'); } catch (e) { return false; }
  }
  // The token from a ?join=<token> link, or '' for the older ?join=1 links which carry only intent.
  function joinToken() {
    try { var v = sessionStorage.getItem('cubby-join') || ''; return (v && v !== '1') ? v : ''; }
    catch (e) { return ''; }
  }
  /* Mint an invite link. The token is the ONLY secret, so it comes from crypto.getRandomValues and
     never from uid() — a timestamp-and-Math.random id would be guessable by anyone who knows when
     the invite was made. 22 chars of base62 is ~130 bits. */
  function newInviteToken() {
    var A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', out = '';
    var b = new Uint8Array(22);
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < b.length; i++) out += A[b[i] % A.length];
    return out;
  }
  var INVITE_LINK_HOURS = 24;
  window.LL.createInviteLink = async function (opts) {
    opts = opts || {};
    var u = auth.currentUser;
    if (!u || !hhRef || window.LL.role !== 'owner') return null;
    var token = newInviteToken();
    try {
      await db.collection('inviteLinks').doc(token).set({
        householdId: window.LL.householdId,
        role: opts.role === 'owner' ? 'owner' : 'caregiver',
        relationship: opts.relationship || '',
        invitedBy: u.uid,
        invitedByName: nameForUid(u.uid) || (u.displayName || '').split(' ')[0] || '',
        usedBy: null,
        createdAt: window.LL.serverTimestamp(),
        expiresAt: new Date(Date.now() + INVITE_LINK_HOURS * 3600000)
      });
    } catch (e) { console.warn('createInviteLink', e); return null; }
    /* Mirror it onto the household document, the way pending email invites already are. Not a
       convenience: the rules deny LIST on inviteLinks (that is what keeps the token a secret), so
       there is no query that could rebuild this list. Without the mirror an owner would have no way
       to see, re-send or revoke a link she made two minutes ago. */
    try {
      await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', token),
        { at: Date.now(), expiresAt: Date.now() + INVITE_LINK_HOURS * 3600000, sentTo: '' });
    } catch (e) { /* the link still works; only the owner's list of it is poorer */ }
    return { token: token, url: location.origin + '/app/?join=' + token, hours: INVITE_LINK_HOURS };
  };
  /* Read a token WITHOUT joining. Returns null for anything a person should not walk through:
     missing, already claimed, expired, or pointing at the household they are already in. The rules
     enforce every one of these too — this is so we can say WHY on screen instead of failing. */
  async function readInviteLink(token, curHid) {
    if (!token) return null;
    try {
      var snap = await db.collection('inviteLinks').doc(token).get();
      if (!snap.exists) return null;
      var d = snap.data() || {};
      if (!d.householdId || d.householdId === curHid) return null;
      if (d.usedBy) return null;
      var exp = d.expiresAt && d.expiresAt.toMillis ? d.expiresAt.toMillis() : 0;
      if (!exp || exp < Date.now()) return null;
      return Object.assign({ token: token }, d);
    } catch (e) { console.warn('readInviteLink', e); return null; }
  }
  /* Claim first, join second. The claim is the single-use gate and it is enforced in the rules, so
     if two people race one forwarded link the loser's claim fails here and they never touch the
     household. Joining before claiming would let both of them in. */
  async function claimInviteLink(link, user) {
    try {
      await db.collection('inviteLinks').doc(link.token).update({ usedBy: user.uid });
    } catch (e) { console.warn('claimInviteLink', e); return false; }
    /* The household write is INSIDE the try now, and a failure gives the token back.
       It used to sit outside: the claim succeeded, the join was denied by the rules, and the
       exception escaped to onAuthStateChanged, which showed a generic sign-in error. The token was
       spent by then, so the same link could never work again and the invitee was told it had
       expired. That is how a rules gap turned every invite link into a permanently burnt one.
       joinToken is carried on the write because the rule has no other way to know WHICH link
       admitted this person: rules can only read a document whose path they can construct. It is
       already spent by the time it lands, so it is an audit trail rather than a secret. */
    try {
      await db.collection('households').doc(link.householdId)
        .update(Object.assign({ joinToken: link.token },
          memberUpdate(user, link.role || 'caregiver', { relationship: link.relationship, name: link.name })));
    } catch (e) {
      console.warn('claimInviteLink join', e);
      try { await db.collection('inviteLinks').doc(link.token).update({ usedBy: null }); } catch (e2) {}
      return false;
    }
    writeOwnMemberEmail(link.householdId);
    await db.collection('users').doc(user.uid)
      .set({ householdId: link.householdId, name: user.displayName || '', email: user.email || '' }, { merge: true });
    window.LL.justJoined = { invitedBy: link.invitedBy || null, role: link.role || 'caregiver' };
    // Clear the owner's pending row: she should see that he arrived, not a link still "waiting".
    try {
      await db.collection('households').doc(link.householdId)
        .update(new firebase.firestore.FieldPath('pendingLinks', link.token), firebase.firestore.FieldValue.delete());
    } catch (e) {}
    try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
    return true;
  }
  // The invite did not match the address they signed in with. Explain it in their terms and offer
  // the only two things that actually resolve it, rather than silently starting a new family.
  var inviteMismatchShown = false;
  // Tear the mismatch screen down and let it show again. signOut() does NOT reload, so the overlay
  // (z-index 3000) otherwise survives a "try a different sign in" and ends up covering the working app
  // after the corrected address actually joins. Any exit from the mismatch state routes through here.
  function clearInviteMismatch() {
    try { var el = document.getElementById('ll-invite-mismatch'); if (el) el.remove(); } catch (e) {}
    inviteMismatchShown = false;
  }
  /* deadLink=true when she followed a TOKEN link that no longer works. The email copy below would
     send her to fix the wrong thing entirely — her address is fine; the link is spent or expired.
     Links are single-use and last a day, and only the person who sent it can make another. */
  function showInviteMismatch(email, deadLink) {
    if (inviteMismatchShown) return; inviteMismatchShown = true;
    if (deadLink) {
      try { hideOverlay(); } catch (e) {}
      var ovd = document.createElement('div'); ovd.id = 'll-invite-mismatch';
      ovd.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:#FBF5E9;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;overflow-y:auto');
      ovd.innerHTML = '<div style="max-width:360px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
        + '<div style="font-size:44px">🐻</div>'
        + '<h2 style="font-family:Georgia,serif;color:#3a2f28;margin:12px 0 8px;font-size:22px">This invite link has expired</h2>'
        + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55">Invite links last a day and can only be used once, so that a link passed on by accident cannot let anyone in.</div>'
        + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55;margin-top:12px">Nothing is wrong with your sign in. Ask them to send you a fresh link.</div>'
        + '<div style="margin-top:22px"><a href="#" id="ll-im-own" style="color:#8a7a6d;font-size:14px;font-weight:700">Start my own Cubby instead</a></div>'
        + '</div>';
      document.body.appendChild(ovd);
      var own0 = document.getElementById('ll-im-own');
      if (own0) own0.onclick = function (ev) {
        ev.preventDefault();
        try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
        clearInviteMismatch(); try { location.reload(); } catch (e) {}
      };
      return;
    }
    try { hideOverlay(); } catch (e) {}
    // Do NOT clear cubby-join here. If we did, a second wrong sign-in (Apple hands back the SAME relay
    // address every time, so a wrong guess repeats) would no longer count as a join attempt and would
    // silently create a fresh empty household. Join intent is abandoned in exactly one place: the
    // "Start my own Cubby instead" button below, and on a successful join (resolveHousehold).
    var ov = document.createElement('div'); ov.id = 'll-invite-mismatch';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:#FBF5E9;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;overflow-y:auto');
    ov.innerHTML = '<div style="max-width:360px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
      + '<div style="font-size:44px">🐻</div>'
      + '<h2 style="font-family:Georgia,serif;color:#3a2f28;margin:12px 0 8px;font-size:22px">We could not find your invite</h2>'
      + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55">You signed in as <b>' + esc(email) + '</b>, and there is no invite waiting for that address.</div>'
      + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55;margin-top:12px">Invites are matched by email. If you signed in with Apple and chose to hide your address, Cubby sees the hidden one instead of yours.</div>'
      + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55;margin-top:12px">Sign in again with the address they sent it to, or ask them to re-send it to <b>' + esc(email) + '</b>.</div>'
      + '<button id="ll-im-btn" style="margin-top:22px;border:none;border-radius:16px;padding:15px 24px;background:#C97FA0;color:#fff;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit">Try a different sign in</button>'
      + '<div style="margin-top:14px"><a href="#" id="ll-im-own" style="color:#8a7a6d;font-size:14px;font-weight:700">Start my own Cubby instead</a></div>'
      + '</div>';
    document.body.appendChild(ov);
    var btn = document.getElementById('ll-im-btn');
    // Tear the overlay down BEFORE signing out (join intent is kept, so the corrected address retries
    // the join). Otherwise it lingers on top of the sign-in screen and then the joined app.
    if (btn) btn.onclick = function () { clearInviteMismatch(); if (window.LL && typeof window.LL.signOut === 'function') window.LL.signOut(); else { try { location.reload(); } catch (e) {} } };
    // They may genuinely want their own household after all; honour that, just never by accident. This
    // is the ONE place join intent is deliberately dropped, so the reload creates a fresh household
    // instead of returning to this screen.
    var own = document.getElementById('ll-im-own');
    if (own) own.onclick = function (e) {
      e.preventDefault();
      try { sessionStorage.removeItem('cubby-join'); } catch (e2) {}
      clearInviteMismatch();
      try { location.reload(); } catch (e2) {}
    };
  }

  var accessLostShown = false;
  function showAccessLost() {
    if (accessLostShown) return;
    // Deleting your own account also drops you from members, which fires this same snapshot. Telling
    // someone "you're no longer in this family" mid-deletion would be both alarming and wrong, so the
    // deletion flow owns the screen until it finishes.
    if (typeof deletingAccount !== 'undefined' && deletingAccount) return;
    accessLostShown = true;
    try { hideOverlay(); } catch (e) {}
    try { var u = auth.currentUser; if (u) db.collection('users').doc(u.uid).set({ householdId: null }, { merge: true }); } catch (e) {}
    var ov = document.createElement('div'); ov.id = 'll-access-lost';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:#FBF5E9;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;');
    ov.innerHTML = '<div style="max-width:340px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
      + '<div style="font-size:44px">🐻</div>'
      + '<h2 style="font-family:Georgia,serif;color:#3a2f28;margin:12px 0 8px;font-size:22px">You’re no longer in this family</h2>'
      + '<div style="color:#8a7a6d;font-size:15px;line-height:1.55">Your access to this Cubby was removed, or the family was closed. Everything you logged stays part of their story.</div>'
      + '<button id="ll-al-btn" style="margin-top:22px;border:none;border-radius:16px;padding:15px 24px;background:#C97FA0;color:#fff;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit">Back to sign in</button></div>';
    document.body.appendChild(ov);
    var btn = document.getElementById('ll-al-btn');
    if (btn) btn.onclick = function () { if (window.LL && typeof window.LL.signOut === 'function') window.LL.signOut(); else { try { location.reload(); } catch (e) {} } };
  }

  // An existing user (already in a household) who ALSO has a pending invite to a different family:
  // surface it after boot so they can accept it, instead of it silently sitting pending forever.
  function maybePromptPendingInvite() {
    var inv = window.LL && window.LL.pendingInvite;
    if (!inv || (window.LL && window.LL.needsIdentity)) return;
    window.LL.pendingInvite = null; // one-shot
    if (!window.confirmSheet) return;
    window.confirmSheet({
      title: 'You’ve been invited 🐻',
      // HONEST: joining overwrites users/{uid}.householdId, and there is no in-app way back to the old
      // one (a household switcher is not built). The old data is not deleted, but it becomes
      // unreachable from here. The previous copy promised "you can switch back", which reads as data
      // loss to a tester who joins and then can't find their own baby. Say what actually happens.
      body: (inv.relationship ? ('You’ve been invited as ' + inv.relationship + '. ') : '') + 'Join this family circle? You’ll switch to their Cubby on this account. Your own Cubby isn’t deleted, but you won’t be able to open it from here afterwards — so only join if you’re ready to switch for good.',
      confirmLabel: 'Join the family',
      cancelLabel: 'Not now',
      onConfirm: function () { joinPendingInvite(inv); }
    });
  }
  async function joinPendingInvite(inv) {
    try {
      var user = auth.currentUser; if (!user || !inv || !inv.householdId) return;
      // A link invite claims first: the claim is the single-use gate. If someone else already walked
      // through this link between the offer and the tap, stop here rather than joining anyway.
      if (inv.viaLink) {
        if (!(await claimInviteLink(inv, user))) {
          try { if (window.toast) window.toast('That invite link has already been used.'); } catch (e2) {}
          return;
        }
        try { if (window.toast) window.toast('Joined the family 🐻'); } catch (e2) {}
        setTimeout(function () { try { location.reload(); } catch (e2) {} }, 500);
        return;
      }
      await db.collection('households').doc(inv.householdId).update(memberUpdate(user, inv.role || 'caregiver', { relationship: inv.relationship, name: inv.name }));
      writeOwnMemberEmail(inv.householdId); // PRIV-2: email goes to the gated doc, not memberInfo
      await db.collection('users').doc(user.uid).set({ householdId: inv.householdId }, { merge: true });
      try { if (window.toast) window.toast('Joined the family 🐻'); } catch (e) {}
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 500);
    } catch (e) {
      console.warn('join invite', e);
      try { if (window.toast) window.toast('Couldn’t join just now — please try again.'); } catch (e2) {}
    }
  }

  function startSync(hid, user) {
    hhRef = db.collection('households').doc(hid);
    eventsRef = hhRef.collection('events');
    photosRef = hhRef.collection('photos');
    notesRef = hhRef.collection('notes');
    // PRIV-2: make sure my own gated email doc exists (idempotent; covers members who joined
    // before the email move shipped and whose blob entry the owner has already stripped).
    if (!ownEmailWritten) { ownEmailWritten = true; writeOwnMemberEmail(hhRef); }
    // My own journey-photo bytes. Attached for every member unconditionally: the rules always
    // let me read my OWN pregnancy photos path, and after a kept loss these are exactly the
    // kept keepsake bytes the archive (users/{uid}.pregnancyArchive) points at.
    ensureOwnPregPhotoListener(user.uid);
    // Crash recovery for kept memories: the boot read found none in the cloud but the local
    // cache had some (applyPregArchive left the sync dirty). Push ONLY the archive — never
    // scheduledPush here, which would write the whole still-empty blob over the household.
    if (pregArchiveLoaded && knownPregArchive === null) syncPregArchive(user.uid);

    var prefs = loadPrefs();
    var gotApp = false, gotEvents = false;
    var lastMembersSig = null; // resubscribe journey listeners only when membership changes

    function maybeBoot(force) {
      // Always need the app blob (babies/settings) to render a meaningful home. Normally also wait
      // for the first events snapshot so the activity is complete on first paint — but `force` (the
      // boot failsafe below) skips that wait so a slow/hanging events query can never pin the loader.
      if (booted || !gotApp || (!gotEvents && !force)) return;
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
      maybePromptPendingInvite();
    }

    unsub.push(hhRef.onSnapshot(function (doc) {
      if (!doc.exists) return;
      var d = doc.data();
      window.LL.role = (d.members && d.members[user.uid]) || 'caregiver';
      window.LL.members = d.members || {};
      window.LL.memberInfo = d.memberInfo || {};
      window.LL.formerMemberInfo = d.formerMemberInfo || {};
      // Pending invites live mirrored on the household doc (owners cannot query /invites: reads
      // there are invitee-only by rule), so the circle screen can show and cancel them.
      window.LL.hhPending = d.pendingInvites || {};
      window.LL.hhPendingLinks = d.pendingLinks || {};
      window.LL.pro = d.pro || null; // Pro entitlement: written only by the billing Worker
      window.LL.householdId = hid;
      // A bear that is only ever computed would change every time the circle grows, so the first
      // time one is assigned we write it down (cubby-extras.js, cubbyClaimAvatar: our own uid only,
      // never over an existing avatar). Re-armed on every household snapshot and run once things
      // settle, because the claim has to see the WHOLE roster -- and, for a baby, the applied app
      // blob -- or it books a bear someone else is already wearing.
      if (avatarClaimT) clearTimeout(avatarClaimT);
      avatarClaimT = setTimeout(function () {
        avatarClaimT = null;
        try { if (window.cubbyClaimAvatar) window.cubbyClaimAvatar(); } catch (e) {}
      }, 2000);
      // Pregnancy-journey listeners depend on the member set (a non-owner tries each member's
      // doc). (Re)subscribe whenever membership changes, including the very first snapshot.
      var membersSig = stableStringify(d.members || {});
      if (membersSig !== lastMembersSig) { lastMembersSig = membersSig; ensurePregListeners(user.uid); }
      // PRIV-2: only owners sync the memberEmails subcollection (rules deny it to everyone
      // else); the family sheet reads window.LL.memberEmails. A demoted/departing owner
      // drops the listener and the mirror.
      if (window.LL.role === 'owner' && !memberEmailsUnsub) {
        memberEmailsUnsub = hhRef.collection('memberEmails').onSnapshot(function (s) {
          var m = {};
          s.forEach(function (dd) { m[dd.id] = (dd.data() || {}).email || ''; });
          window.LL.memberEmails = m;
        }, function (e) { /* denied (not an owner any more) or offline: sheet shows no emails */ });
      } else if (window.LL.role !== 'owner' && memberEmailsUnsub) {
        try { memberEmailsUnsub(); } catch (e2) {}
        memberEmailsUnsub = null; window.LL.memberEmails = {};
      }
      maybeMigrateMemberEmails(d); // owner's device moves legacy blob emails into /memberEmails
      var sig = hhSig(d.app, d.members, d.memberInfo) + '|' + JSON.stringify(d.pro || null);
      if (booted && sig === lastHhSig) return; // our own write echo / duplicate emission, already on screen
      lastHhSig = sig;
      applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;
      ensureMaternalListeners(user.uid); // (re)subscribe once we know whose pregnancy it is
      migrateHandoffToNote(); // role + handoff are now known; fold any legacy shared note in once
      gotApp = true;
      /* The blob is now server-state-plus-our-local-overrides, which is exactly what a no-op push
         would write, so it is the right baseline to diff the next push against. Taken AFTER
         applyAppBlob rather than from d.app directly, because the round trip legitimately differs:
         theme and push are per-device and stripped on the way out. */
      blobBase = snapshotBlobBase();
      hhHydrated = true;
      if (pushWhenHydrated) { pushWhenHydrated = false; scheduledPush(); }
      if (booted) rerender(); else maybeBoot();
    }, function (e) {
      console.warn('household listen', e);
      // Removed from the family (or the household was deleted): the doc becomes unreadable, so the
      // boot would otherwise hang on the loader forever (gotApp never flips). Confirm it's a real
      // access loss (not a transient token blip) with a one-shot get, then show a calm recovery
      // screen instead of an infinite spinner.
      if (e && e.code === 'permission-denied' && !accessLostShown) {
        setTimeout(function () {
          if (accessLostShown) return;
          hhRef.get().then(function () {}).catch(function (err) { if (err && err.code === 'permission-denied') showAccessLost(); });
        }, 1500);
      }
    }));

    // ---- Two-stage events load (fast signed-in boot) ----
    // The old listener loaded the ENTIRE event history before the first render (behind the SDK
    // download) — slow boot that got worse the more you logged. Now we boot on a RECENT window so
    // the app renders fast, then hydrate the full history in the background so stats/charts/old
    // months stay correct. where(time>=) keeps a 'removed' change meaning a real delete (no limit()
    // eviction ambiguity). Anything older than the window, or missing `time`, is caught by the
    // one-time hydrate. If the windowed query ever errors (e.g. an index issue), we fall back to
    // the original unbounded listener so boot can never hang.
    var bootCutoff = Date.now() - 120 * 86400000; // ~4 months
    var hydratedHistory = false;
    function hydrateFullHistory() {
      if (hydratedHistory) return; hydratedHistory = true;
      eventsRef.get().then(function (snap) {
        applyingRemote = true; var added = 0;
        snap.forEach(function (doc) {
          if ((state.events || []).some(function (e) { return String(e.id) === String(doc.id); })) return; // recent: owned by the live listener
          var data = doc.data(); data.id = doc.id;
          (state.events = state.events || []).push(data);
          knownEvents[doc.id] = JSON.stringify(stripMeta(data)); added++;
        });
        applyingRemote = false;
        if (added && booted) rerender();
      }).catch(function (e) { console.warn('events hydrate', e); });
    }
    function subscribeEvents(query, isFallback) {
      return query.onSnapshot(function (snap) {
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
        if (!booted) { maybeBoot(); if (!isFallback) hydrateFullHistory(); }
        else if (!(snap.metadata && snap.metadata.hasPendingWrites)) rerender();
      }, function (e) {
        console.warn('events listen', e);
        if (!isFallback) { try { unsub.push(subscribeEvents(eventsRef, true)); } catch (x) {} } // windowed query failed -> full listener, so boot never hangs
      });
    }
    unsub.push(subscribeEvents(eventsRef.where('time', '>=', bootCutoff), false));

    // Boot failsafe: never let the launch loader hang on a slow Firebase read. Offline persistence
    // usually serves the first snapshots from disk instantly, but a cold connection or token refresh
    // can stall the events query for many seconds. So once the app blob is in (babies/settings),
    // show the app within ~3.5s regardless; events then stream in via the listener's render().
    setTimeout(function () { if (!booted && gotApp) maybeBoot(true); }, 3500);

    unsub.push(photosRef.onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') {
          delete circlePhotoIds[ch.doc.id];
          // A migrated pregnancy photo leaves the circle collection while its bytes live on
          // in the gated subcollection — don't blank it out from under the owner's screen.
          if (!PhotoStore.privIds[ch.doc.id]) delete PhotoStore.map[ch.doc.id];
        } else {
          circlePhotoIds[ch.doc.id] = 1;
          PhotoStore.map[ch.doc.id] = ch.doc.data().data;
        }
      });
      maybeMigratePregPhotoBytes(); // owner's device moves any circle-visible pregnancy bytes out
      if (booted && !(snap.metadata && snap.metadata.hasPendingWrites)) rerender();
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
      if (booted && !(snap.metadata && snap.metadata.hasPendingWrites)) rerender();
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
      // Local first, the way commitEvent has always done it for feeds and naps. This used to await
      // notesRef.add(), which resolves only on a server ack — so offline, or on the 3am connection
      // that never quite lands, the promise neither resolved nor rejected: the sheet stayed open
      // with the note still in it, no toast either way, and the first-note pulse stayed on forever.
      // The old comment said "optimistic" while the code sat and waited.
      var ref = notesRef.doc();
      note.id = ref.id;
      mergeNote(note);                          // idempotent by id, so the listener reconciles cleanly
      ref.set(note).catch(function (e) { console.warn('addNote', e); dropNote(note.id); });
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
  // Soft delete / restore (author-only, same update rule as pinning). A soft-deleted note keeps
  // its doc with deleted:true + deletedAt, hides everywhere, and sits in Recently deleted for
  // 30 days; the lazy purge on boot then hard-deletes it via LL.deleteNote.
  window.LL.softDeleteNote = async function (id) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var n = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (!n || (n.createdBy && n.createdBy !== u.uid)) return false; // only your own
    var at = Date.now();
    try { await notesRef.doc(String(id)).update({ deleted: true, deletedAt: at }); n.deleted = true; n.deletedAt = at; return true; }
    catch (e) { console.warn('softDeleteNote', e); return false; }
  };
  window.LL.restoreNote = async function (id) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var n = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (!n || (n.createdBy && n.createdBy !== u.uid)) return false; // only your own
    try { await notesRef.doc(String(id)).update({ deleted: false, deletedAt: null }); delete n.deleted; delete n.deletedAt; return true; }
    catch (e) { console.warn('restoreNote', e); return false; }
  };
  // Pin/unpin: at most one pinned note PER MEMBER, not per circle. This comment used to claim
  // per-circle, which the code never did and no client ever could: rules make a note editable only
  // by its author, and a note addressed privately to somebody else is not even readable, so one
  // member cannot clear another's pin. A true per-circle pin would need a privileged server that
  // can reach into every private note, which is a far bigger hole than one pin is worth.
  // So each person keeps their own pin, and home renders every pin the viewer can see
  // (pinnedNotes() in index.html). Papa's "formula is in the top cupboard" stays up when Mama pins
  // hers; taking only the newest is how one of them used to vanish with nobody told.
  window.LL.setNotePinned = async function (id, pinned) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var target = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (!target || target.createdBy !== u.uid) return false; // pin only your own (audience stays put)
    // Local first, the way addNote and commitEvent are. An update() made offline resolves only on a
    // server ack, so awaiting it left the note sheet open with no toast either way on a bad line —
    // the same wait that addNote was already fixed for. Roll the flag back if the write is refused.
    if (pinned) {
      (state.notes || []).forEach(function (n) {
        if (n.pinned && n.createdBy === u.uid && String(n.id) !== String(id)) {
          n.pinned = false;
          notesRef.doc(String(n.id)).update({ pinned: false })
            .catch(function (e) { console.warn('setNotePinned', e); n.pinned = true; rerender(); });
        }
      });
    }
    var was = !!target.pinned;
    target.pinned = !!pinned;
    notesRef.doc(String(id)).update({ pinned: !!pinned })
      .catch(function (e) { console.warn('setNotePinned', e); target.pinned = was; rerender(); });
    return true;
  };

  /* ---------- push local changes to the cloud (override persist) ---------- */
  function scheduledPush() {
    savePrefs();
    // Kept-after-loss memories hit the local cache SYNCHRONOUSLY (the cloud write below is
    // debounced 350 ms, and "Keep my memories" followed by an immediate tab close must stick).
    // Guarded on the boot read so a pre-load persist can't stomp a cache we haven't applied yet.
    if (pregArchiveLoaded) { var au = auth.currentUser; if (au) savePregArchiveCache(au.uid); }
    if (applyingRemote) return; // don't echo remote-applied changes back
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 350);
  }
  async function pushNow() {
    pushTimer = null;
    if (!hhRef) return;
    /* Never write the shared record before we have read it. Without this a phone that signed in
       and pushed before its first household snapshot landed replaced the family's whole blob with
       whatever it happened to hold. The state stays dirty and the write happens the moment the
       snapshot arrives, so nothing is dropped, only deferred. Events are unaffected: they are
       per-document and merge by id. */
    if (!hhHydrated) { pushWhenHydrated = true; return; }
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
    // A rejected write (e.g. rules denial) un-marks its doc so the next push retries it, instead of
    // the old behaviour where the entry was marked synced up-front and a rejection was lost forever.
    // Offline is unaffected: pending promises never reject, and the SDK queue delivers them later.
    Object.keys(cur).forEach(function (id) {
      var ser = JSON.stringify(stripMeta(cur[id]));
      if (knownEvents[id] !== ser) {
        knownEvents[id] = ser;
        writes.push(eventsRef.doc(String(id)).set(Object.assign({ authorId: cur[id].authorId || uidNow }, cur[id]))
          .catch(function (e) { if (knownEvents[id] === ser) delete knownEvents[id]; throw e; }));
      }
    });
    Object.keys(knownEvents).forEach(function (id) {
      if (!cur[id]) {
        var oldSer = knownEvents[id]; delete knownEvents[id];
        writes.push(eventsRef.doc(String(id)).delete()
          .catch(function (e) { if (!cur[id] && !(id in knownEvents)) knownEvents[id] = oldSer; throw e; }));
      }
    });
    /* Write only the areas of the blob this device changed, as `app.<key>` field paths. A whole
       `app` replace meant any push clobbered every key, so a phone that had merely started a nap
       timer could erase medicines and vaccines another caregiver had added in the meantime. Field
       paths also leave alone any key this build does not know about, instead of deleting it. */
    var appBlob = appBlobFromState();
    var upd = { updatedAt: window.LL.serverTimestamp() }, dirty = [];
    Object.keys(appBlob).forEach(function (k) {
      var ser = stableStringify(appBlob[k]);
      if (!blobBase || blobBase[k] !== ser) { upd['app.' + k] = appBlob[k]; dirty.push([k, ser]); }
    });
    if (dirty.length) {
      lastHhSig = hhSig(appBlob, window.LL.members, window.LL.memberInfo); // mark our own write so its echo doesn't re-render
      writes.push(hhRef.update(upd).then(function () {
        // Only now is the server known to hold these. A rejected write leaves the baseline alone
        // so the next push retries the same keys, matching how knownEvents handles a denial above.
        if (blobBase) dirty.forEach(function (p) { blobBase[p[0]] = p[1]; });
      }).catch(function (e) { lastHhSig = null; throw e; }));
    }
    try {
      await Promise.all(writes);
      pushNow._retryDelay = 0;
    } catch (e) {
      console.warn('push', e);
      var nowMs = Date.now();
      // permission-denied is NOT offline: for a removed member "we'll try again" is a lie. Say what
      // actually happened and where the door is; offline keeps its honest, patient message.
      var denied = !!(e && e.code === 'permission-denied');
      if (!pushNow._warnedAt || nowMs - pushNow._warnedAt > 120000) { // gentle: at most one toast per 2 min
        pushNow._warnedAt = nowMs;
        try {
          if (denied) window.toast && window.toast('Cubby wasn’t allowed to save that. If you’ve been removed from this circle, sign out and back in.');
          else if (navigator.onLine === false) window.toast && window.toast('You look offline. Cubby will sync when you’re back.');
          else window.toast && window.toast('That didn’t sync just now. We’ll try again.');
        } catch (e2) {}
      }
      // Offline/transient errors back off gently; a rules denial will not heal on a timer, so it
      // goes straight to the 5 min ceiling instead of hammering a door that is closed.
      pushNow._retryDelay = denied ? 300000 : Math.min((pushNow._retryDelay || 4000) * 2, 300000); // backoff 8s → 5 min
      if (!pushTimer) pushTimer = setTimeout(pushNow, pushNow._retryDelay); // state stays dirty, so later edits also retry
    }
    syncPregJourney(uidNow); // owner-only; writes the journey to the owner-owned pregnancy doc (Item 7)
    syncMaternal(uidNow); // owner-only; writes her private categories to the protected mhealth docs
    syncPregArchive(uidNow); // kept-after-loss memories -> her self-only users/{uid} doc
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

  /* ---------- account deletion (App Store 5.1.1(v)) ---------- */
  // A parent can always delete their own account, alone. This is deliberately NOT routed through the
  // guardian-consent flow that gates "Delete data": that one erases the household's shared story and
  // rightly asks both parents, but a person's own account is theirs, and Apple treats a second
  // person's approval as an obstacle.
  //
  // What goes: their access, their identity, their PRIVATE health and pregnancy records, their login.
  // What stays: the household's shared story, because the other caregivers are still living in it.
  // Their past entries keep their bear label through the formerMemberInfo tombstone — authorTag()
  // and loggerName() prefer `relationship`, so history still reads "by Mama" while the real name and
  // avatar are dropped. Removal keeps the name; deletion should not.
  //
  // If they are the LAST member there is nobody for the story to stay for, so the household is
  // flagged with deleteAfter and the Worker cron hard-deletes it 30 days later.
  var deletingAccount = false;
  window.LL.isDeletingAccount = function () { return deletingAccount; };
  window.LL.deleteAccount = async function () {
    var u = auth.currentUser;
    if (!u) throw new Error('not_signed_in');
    var uid = u.uid;
    var email = (u.email || '').toLowerCase();
    // Removing ourselves from members makes the household snapshot fire "you were removed". Suppress
    // that mid-deletion so the calm access-lost screen can't race the flow we are already running.
    deletingAccount = true;

    try {
      // 1. Private records FIRST. Their rules require membership, so once we drop out of members we
      //    could never reach them again — they would sit in the household forever, unreadable by
      //    everyone including her, but still stored. That is the exact failure the existing
      //    removeMember() path already has for a removed member.
      if (hhRef) {
        try {
          var cats = await hhRef.collection('mhealth').doc(uid).collection('cat').get();
          await Promise.all(cats.docs.map(function (d) { return d.ref.delete().catch(function () {}); }));
        } catch (e) { console.warn('del mhealth', e); }
        try { await hhRef.collection('pregnancy').doc(uid).delete(); } catch (e) { console.warn('del pregnancy', e); }
        // The journey's photo BYTES are a subcollection under that doc, and deleting a doc
        // never deletes its subcollections — purge them explicitly while still a member.
        try {
          var pph = await hhRef.collection('pregnancy').doc(uid).collection('photos').get();
          await Promise.all(pph.docs.map(function (d2) { return d2.ref.delete().catch(function () {}); }));
        } catch (e) { console.warn('del preg photos', e); }
        // PRIV-2: their gated email doc goes with them (self-delete needs no membership).
        try { await hhRef.collection('memberEmails').doc(uid).delete(); } catch (e) {}
        // Notes she wrote privately to herself: nobody else can read them, so they go with her.
        // Notes to the circle stay (shared story); notes another member addressed to her are their
        // content, not hers, and rules only let the author delete them anyway.
        try {
          var priv = await hhRef.collection('notes').where('audience', '==', uid).get();
          await Promise.all(priv.docs
            .filter(function (d) { return (d.data() || {}).createdBy === uid; })
            .map(function (d) { return d.ref.delete().catch(function () {}); }));
        } catch (e) { console.warn('del notes', e); }
      }

      // 2. Leave the household.
      if (hhRef) {
        var members = window.LL.members || {};
        var others = Object.keys(members).filter(function (m) { return m !== uid; });
        var mi = (window.LL.memberInfo || {})[uid] || {};
        var del = firebase.firestore.FieldValue.delete();
        var upd = {};
        upd['members.' + uid] = del;
        upd['memberInfo.' + uid] = del;
        upd['formerMemberInfo.' + uid] = { name: '', relationship: mi.relationship || '', avatar: null };
        if (others.length) {
          if (members[uid] === 'owner') {
            var heir = pickHeir(others);
            upd['members.' + heir] = 'owner';
            upd.ownerId = heir;
          }
        } else {
          // Last one out. 30 days is a grace window, not retention: the cron hard-deletes after it,
          // and privacy/index.html states the window.
          upd.deleteAfter = Date.now() + 30 * 24 * 60 * 60 * 1000;
          upd.deletionRequestedBy = uid;
        }
        await hhRef.update(upd);
      }

      // 3. Everything keyed to them outside the household.
      if (email) { try { await db.collection('invites').doc(email).delete(); } catch (e) {} }
      try { await db.collection('waitlist').doc(uid).delete(); } catch (e) {}
      // users/{uid} carries the push tokens, so deleting it also stops delivery at the cron.
      // It also carries her kept-after-loss archive — deletion takes it along (correct: her
      // pregnancy photo bytes were purged above), and the device cache must not outlive it.
      try { await db.collection('users').doc(uid).delete(); } catch (e) { console.warn('del user doc', e); }
      try { localStorage.removeItem(pregArchCacheKey(uid)); } catch (e) {}
      try { if (window.cubbyDisableNativePush) await window.cubbyDisableNativePush(); } catch (e) {}
      // Guessing-game hubs live in D1, keyed by this uid, and rules do not reach them.
      try {
        var tok = await u.getIdToken();
        await fetch('/api/account/purge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idToken: tok })
        });
      } catch (e) { console.warn('purge d1', e); }

      // 4. Local traces.
      try {
        ['little-log-v1', 'little-log-photos-v1', 'cubby-member', 'cubby-acq', 'cubby-ref',
         'cubby-country', 'cubby-email-signin', 'cubby-pro-waitlist', 'cubby-pro-dev']
          .forEach(function (k) { try { localStorage.removeItem(k); } catch (e2) {} });
      } catch (e) {}

      // 5. The login itself. Last, because everything above needs an authenticated session.
      try {
        await u.delete();
      } catch (e) {
        if (e && e.code === 'auth/requires-recent-login') {
          await reauthenticate(u);
          await auth.currentUser.delete();
        } else throw e;
      }
      return true;
    } catch (e) {
      deletingAccount = false;
      throw e;
    }
  };
  // Who inherits the circle when a departing owner leaves others behind. We do not record a join
  // date anywhere, so "longest-standing" is not actually knowable — prefer a co-parent, which is
  // what the household means by a guardian, and fall back to a stable pick so two devices racing
  // the same deletion cannot promote two different people.
  function pickHeir(others) {
    var info = window.LL.memberInfo || {};
    var parent = ['mother', 'mom', 'mama', 'father', 'dad', 'papa', 'parent', 'guardian'];
    var sorted = others.slice().sort();
    var coParent = sorted.filter(function (m) {
      return parent.indexOf((((info[m] || {}).relationship) || '').toLowerCase()) >= 0;
    });
    return coParent.length ? coParent[0] : sorted[0];
  }

  PhotoStore.set = async function (id, dataUrl, opts) {
    PhotoStore.map[id] = dataUrl;
    if (!photosRef) return;
    // Firestore rejects docs over 1 MiB; that write used to fail with only a console.warn while
    // the UI showed success. Pre-check and say so — the photo still works on this device.
    if (dataUrl && dataUrl.length > 990000) {
      console.warn('photo too large to sync', id, dataUrl.length);
      try { window.toast && window.toast('That photo is too big to sync — it stays on this device.'); } catch (e) {}
      return;
    }
    var uidNow = (auth.currentUser && auth.currentUser.uid) || null;
    // Pregnancy-private bytes (bump photos, scan moments, journey cards) NEVER go to the
    // circle-visible /photos collection: they live under the owner-gated journey doc, so the
    // rules give the bytes the exact visibility the metadata already has (owner + sharedWith).
    if (opts && opts.preg) {
      var p = state.pregnancy;
      var powner = (p && p.ownerUid && p.ownerUid !== 'local') ? p.ownerUid : uidNow;
      if (!uidNow || powner !== uidNow) return; // not her journey: metadata won't sync either; bytes stay on this device
      PhotoStore.privIds[id] = 1; ownPregPhotoIds[id] = 1;
      try { await hhRef.collection('pregnancy').doc(uidNow).collection('photos').doc(String(id)).set({ data: dataUrl, authorId: uidNow }); }
      catch (e) {
        delete PhotoStore.privIds[id]; delete ownPregPhotoIds[id];
        // DEPLOY-ORDER SAFETY: the app can reach phones before the founder publishes the
        // updated rules, and in that window the gated path is denied. A mother's scan photo
        // must never be lost to that ordering — fall back to the legacy circle write (the
        // status quo before this build); the owner-device migration relocates it into the
        // gated subcollection the moment the new rules are live. Any other failure keeps
        // the honest "safe on this device" toast.
        if (e && e.code === 'permission-denied') {
          try { await photosRef.doc(String(id)).set({ data: dataUrl, authorId: uidNow }); return; }
          catch (e3) { console.warn('preg photo fallback', e3); }
        }
        console.warn('preg photo set', e);
        try { window.toast && window.toast('That photo didn’t sync just now — it’s safe on this device.'); } catch (e2) {}
      }
      return;
    }
    try { await photosRef.doc(String(id)).set({ data: dataUrl, authorId: uidNow }); }
    catch (e) {
      console.warn('photo set', e);
      try { window.toast && window.toast('That photo didn’t sync just now — it’s safe on this device.'); } catch (e2) {}
    }
  };
  PhotoStore.del = async function (id) {
    delete PhotoStore.map[id];
    var wasPriv = !!PhotoStore.privIds[id];
    delete PhotoStore.privIds[id]; delete ownPregPhotoIds[id]; delete otherPregPhotoIds[id];
    if (!photosRef) return;
    // The byte doc may live in either home (circle collection, or my own journey subcollection —
    // e.g. deleting a moment, discarding after a loss, removing kept memories). Try both; the
    // rules referee each delete server-side and a miss is a harmless no-op.
    if (!wasPriv || circlePhotoIds[id]) { try { await photosRef.doc(String(id)).delete(); } catch (e) {} }
    var uidNow = auth.currentUser && auth.currentUser.uid;
    if (wasPriv && uidNow && hhRef) {
      try { await hhRef.collection('pregnancy').doc(uidNow).collection('photos').doc(String(id)).delete(); } catch (e) {}
    }
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

  /* The family, drawn as itself. Every member already has a painted bear and every baby has a cub,
     chosen or claimed, so the portrait is composed from THEIR art rather than a stock illustration
     of a family that is not theirs. Overlapped like a group photo, grown-ups first then the little
     ones, which is also the order they joined the story.

     Loss-safe by construction: it draws whoever is actually in state.babies, so after a loss there
     is no cub to draw and none appears.

     Deliberately NOT a closure inside openFamily. That function starts with `auth.currentUser`, so
     it cannot run without a live Firebase session and nothing inside it could be driven in a test.
     Reading its inputs from LL and state instead makes the drawing verifiable on its own. */
  window.cubbyFamilyPortrait = function () {
    if (typeof window.memberAvatarSvg !== 'function') return '';
    var info = (window.LL && window.LL.memberInfo) || {};
    var uids = Object.keys(info);
    if (!uids.length) return '';
    var owner = uids.filter(function (u) { return (info[u] || {}).role === 'owner'; });
    var rest = uids.filter(function (u) { return (info[u] || {}).role !== 'owner'; });
    var people = owner.concat(rest).slice(0, 5).map(function (u) {
      return '<span class="ll-fp-a" title="' + esc((info[u] || {}).name || '') + '">' + window.memberAvatarSvg(u, 46) + '</span>';
    });
    var cubs = [];
    try {
      if (typeof window.babyBearSvg === 'function') {
        /* `state`, not `window.state`. app/index.html declares it with `let` at the top level of a
           classic script, which creates a global LEXICAL binding and no property on window, so
           window.state is undefined and every baby silently vanished from the portrait. The rest of
           this file already uses the bare binding. */
        cubs = ((state && state.babies) || []).slice(0, 3).map(function (bb) {
          return '<span class="ll-fp-a ll-fp-cub" title="' + esc(bb.name || '') + '">' + window.babyBearSvg(bb, 40) + '</span>';
        });
      }
    } catch (e) { cubs = []; }
    var more = uids.length > 5 ? '<span class="ll-fp-more">+' + (uids.length - 5) + '</span>' : '';
    return '<div class="ll-fp">' + people.join('') + cubs.join('') + more + '</div>';
  };

  function openFamily() {
    var me = auth.currentUser; if (!me) return;
    var myRole = window.LL.role || 'caregiver';
    var info = window.LL.memberInfo || {};
    var myRel = (info[me.uid] && info[me.uid].relationship) || '';

    // PRIV-2: emails live in the owner-gated memberEmails subcollection now. I always know my
    // own (auth token); an owner sees everyone's (their mirror is rules-enforced); any address
    // still sitting in a legacy pre-migration blob entry is the fallback until the owner's
    // device strips it.
    function emailForUid(uid) {
      if (uid === me.uid) return me.email || '';
      var em = (window.LL.memberEmails || {})[uid];
      if (em) return em;
      return ((info[uid] || {}).email) || '';
    }

    var rows = Object.keys(info).map(function (uid) {
      var m = info[uid] || {};
      // A caregiver sees names and bear labels; email addresses are shown only to owners
      // (who need them to run the circle) and to each person for themselves.
      var em = (myRole === 'owner' || uid === me.uid) ? emailForUid(uid) : '';
      var who = m.relationship ? (m.relationship + (m.role === 'owner' ? ' · Owner' : '')) : (m.role === 'owner' ? 'Owner' : 'Caregiver');
      var av = (typeof window.memberAvatarSvg === 'function') ? '<span class="ll-mem-av">' + window.memberAvatarSvg(uid, 40) + '</span>' : '';
      var rm = (myRole === 'owner' && uid !== me.uid) ? '<button class="ll-rm" data-uid="' + uid + '" data-email="' + esc(em || '') + '" data-name="' + esc(m.name || 'this person') + '">Remove</button>' : '';
      return '<div class="ll-mem"><div style="display:flex;align-items:center;gap:10px">' + av + '<div><div class="ll-mem-name">' + esc(m.name || 'Member') + (uid === me.uid ? ' (you)' : '')
        + '</div><div class="ll-mem-email">' + esc(em || '') + '</div></div></div><div style="display:flex;align-items:center;gap:8px"><span class="ll-mem-role">' + esc(who) + '</span>' + rm + '</div></div>';
    }).join('') || '<div class="ll-auth-msg">Just you so far.</div>';

    // Pending invites, owner-only (only an owner can act on them, and an invitee who never joined
    // has not consented to being shown to the whole circle). Anyone already in memberInfo has
    // joined, so their mirror entry is display-filtered here rather than cleaned up at join time.
    var joinedEmails = {};
    Object.keys(info).forEach(function (uid) { var em = (emailForUid(uid) || '').toLowerCase(); if (em) joinedEmails[em] = 1; });
    var pendMap = (myRole === 'owner') ? (window.LL.hhPending || {}) : {};
    var pendRows = Object.keys(pendMap).filter(function (em) { return !joinedEmails[em]; }).sort().map(function (em) {
      var pv = pendMap[em] || {};
      return '<div class="ll-mem"><div><div class="ll-mem-name">' + esc(pv.name || em) + '</div><div class="ll-mem-email">' + esc(em) + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:8px"><span class="ll-mem-role">Invited · waiting</span>'
        + '<button class="ll-rm ll-cancel-inv" data-email="' + esc(em) + '">Cancel</button></div></div>';
    }).join('');

    /* Pending LINKS. Until now an owner could make a link, lose the share sheet, and have no way to
       tell whether it went — the modal still said "Just you so far". Expired ones are shown as
       expired rather than hidden, because "I sent that yesterday and heard nothing" deserves an
       answer on screen instead of silence. */
    var linkMap = (myRole === 'owner') ? (window.LL.hhPendingLinks || {}) : {};
    var linkRows = Object.keys(linkMap).sort(function (a, b) {
      return ((linkMap[b] || {}).at || 0) - ((linkMap[a] || {}).at || 0);
    }).map(function (tk) {
      var lv = linkMap[tk] || {};
      var dead = !lv.expiresAt || lv.expiresAt < Date.now();
      var when = lv.at ? new Date(lv.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      var status = dead ? 'Link expired' : (lv.sentTo ? ('Emailed to ' + esc(lv.sentTo)) : 'Link waiting');
      return '<div class="ll-mem"><div><div class="ll-mem-name">Invite link</div>'
        + '<div class="ll-mem-email">' + esc(status) + (when ? (' · ' + esc(when)) : '') + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + (dead ? '' : '<button class="ll-rm ll-reshare-link" data-token="' + esc(tk) + '">Send again</button>')
        + '<button class="ll-rm ll-cancel-link" data-token="' + esc(tk) + '">Cancel</button></div></div>';
    }).join('');
    pendRows += linkRows;

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
        + '<input id="llInvEmail" type="email" placeholder="Their email address" autocomplete="off" autocapitalize="off">'
        + '<div class="ll-auth-msg" style="text-align:left;margin:2px 0 6px">Any email works: Google, Apple or a sign-in link. They’ll need to sign in with this exact address, so use the one they actually use.</div>'
        + '<select id="llInvRel">' + relOptions('') + '</select>'
        + '<label class="ll-check"><input type="checkbox" id="llInvOwner"><span>Co-owner, full control (can edit everyone\'s entries &amp; invite others)</span></label>'
        + '<button id="llInvBtn" class="ll-modal-btn">Create invite</button>'
        + '<div id="llInvMsg" class="ll-auth-msg"></div></div>'
      : '<div class="ll-auth-msg">Only an owner can invite new people.</div>';

    // Owner-only, like the invite form above it: sharing a working invite needs an email to pair the
    // link with, and only an owner can create one. Showing this to a caregiver offered a bare link
    // that could only ever strand the recipient (they have no invite to pair it with).
    var share = (myRole === 'owner')
      ? '<div class="ll-invite"><label>Invite link</label>'
        + '<div class="ll-linkrow"><input id="llAppLink" readonly placeholder="Tap to make a one-time link" value=""><button id="llCopyLink" class="ll-modal-btn">Make a link</button></div>'
        + '<div class="ll-auth-msg">One link, for one person, good for a day. Whoever opens it joins your circle, so send it to them and not to a group. You do not need to know which email address they will sign in with.</div>'
        + '<div id="llLinkMail" style="display:none;margin-top:8px"><label>Or let Cubby email it</label>'
        + '<input id="llLinkEmail" type="email" placeholder="Their email address" autocomplete="off" autocapitalize="off">'
        + '<button id="llLinkMailBtn" class="ll-modal-btn ll-ghost" style="margin-top:6px">Email the link</button>'
        + '<div id="llLinkMailMsg" class="ll-auth-msg"></div></div>'
        + '<div class="ll-auth-msg" style="margin-top:6px">Prefer the stricter way? Add their exact email above instead: that invite only works for that address.</div></div>'
      : '';

    /* The family's own name, at the top, because it is the thing an invited person is told they
       are joining. Owner-only to change: it is the household's identity, not a personal setting,
       and a caregiver renaming the family everyone else sees would be the same class of bug as the
       shared-theme one. Everyone can SEE it. */
    var hhName = (typeof window.householdName === 'function') ? window.householdName() : '';
    var hhSet  = (typeof window.householdNamed === 'function') ? window.householdNamed() : false;
    var nameRow = hhName
      ? (window.cubbyFamilyPortrait()
        + '<div class="ll-hhname">'
          + '<div><div class="ll-hhname-k">Your family</div><div class="ll-hhname-v">' + esc(hhName) + '</div></div>'
          + (myRole === 'owner'
              ? '<button id="llHhName" class="ll-modal-btn ll-ghost" style="margin:0;width:auto;padding:8px 14px">' + (hhSet ? 'Rename' : 'Name it') + '</button>'
              : '')
        + '</div>'
        + (!hhSet && myRole === 'owner'
            ? '<div class="ll-auth-msg" style="text-align:left;margin:-4px 0 12px">Naming it means an invite can say what someone is joining, instead of "someone\'s Cubby".</div>'
            : ''))
      : '';

    modal('Family & sharing', nameRow + '<div class="ll-mems">' + rows + '</div>'
      + (pendRows ? ('<div class="ll-auth-msg" style="text-align:left;margin:6px 0 2px;font-weight:800">Invited, not joined yet</div><div class="ll-mems">' + pendRows + '</div>') : '')
      + '<div class="ll-auth-msg" style="text-align:left;margin:-2px 0 12px">When you invite people, everyone in your circle can see each other\'s name here, so you know who is who. Email addresses stay between each person and the circle owner. Only you can change your own.</div>'
      + youRow + invite + share
      + '<button id="llSignOut" class="ll-modal-btn ll-ghost">Sign out</button>'
      + '<div class="ll-auth-msg" style="margin-top:10px">Cubby v' + (window.CUBBY_VERSION || '') + ' · made with families like you 🐻</div>');

    var hhBtn = document.getElementById('llHhName');
    if (hhBtn) hhBtn.onclick = function () { closeModal(); if (window.openHouseholdName) window.openHouseholdName(); };
    document.getElementById('llSignOut').onclick = function () { closeModal(); window.LL.signOut(); };
    document.getElementById('llMyRelBtn').onclick = saveMyRelationship;
    wireRelCustom('llMyRel', 'llMyRelCustom');
    document.getElementById('llMyBearBtn').onclick = function () { if (window.openBearPicker) window.openBearPicker('member', me.uid); };
    document.getElementById('llMyFeedbackBtn').onclick = openFeedback;
    var copyBtn = document.getElementById('llCopyLink'); if (copyBtn) copyBtn.onclick = copyAppLink; // owner-only now
    if (myRole === 'owner') document.getElementById('llInvBtn').onclick = submitInvite;
    Array.prototype.forEach.call(document.querySelectorAll('.ll-rm'), function (b) {
      if (b.classList.contains('ll-cancel-inv')) return; // pending-invite cancels are wired below
      b.onclick = function () { removeMember(b.getAttribute('data-uid'), b.getAttribute('data-email'), b.getAttribute('data-name')); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ll-cancel-inv'), function (b) {
      b.onclick = function () { cancelInvite(b.getAttribute('data-email')); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ll-reshare-link'), function (b) {
      b.onclick = function () { reshareLink(b.getAttribute('data-token'), b); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ll-cancel-link'), function (b) {
      b.onclick = function () { cancelInviteLink(b.getAttribute('data-token')); };
    });
  }

  /* Send the SAME link again rather than minting a new one. Minting a second link would quietly
     invalidate nothing (both would work) and double the number of live invites into her household,
     which is the opposite of what "send again" should mean. */
  function reshareLink(token, btn) {
    if (!token) return;
    var url = location.origin + '/app/?join=' + token;
    var text = 'Join me on Cubby 🐻\n\n' + url + '\n\nIt works once and only for a day, so it is just for you.';
    if (navigator.share) { navigator.share({ title: 'Join me on Cubby 🐻', text: text }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (btn) { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1500); }
      }).catch(function () {});
    }
  }
  /* Revoke. Deleting the link document is the real revocation — the mirror is only the visible
     list, so it goes second and its failure cannot leave a live link behind. */
  async function cancelInviteLink(token) {
    if (!token || !hhRef) return;
    try { await db.collection('inviteLinks').doc(token).delete(); }
    catch (e) { try { if (window.toast) window.toast('Could not cancel that link'); } catch (e2) {} return; }
    try { await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', token), firebase.firestore.FieldValue.delete()); } catch (e) {}
    try { if (window.toast) window.toast('Link cancelled'); } catch (e) {}
    if (window.openFamily) window.openFamily();
  }
  /* Email the link from Cubby, on her behalf. Until now the app sent no invite email at all: she
     was handed a mailto: or a share sheet and was herself the delivery mechanism, which is silent
     when she closes it. The endpoint verifies her ID token AND that she owns the household the link
     points at, so this cannot become a relay for sending Cubby-branded mail to strangers. */
  window.LL.sendInviteEmail = async function (token, email) {
    var u = auth.currentUser;
    if (!u || !token || !email) return { error: 'bad_request' };
    var idToken;
    try { idToken = await u.getIdToken(); } catch (e) { return { error: 'unauthorized' }; }
    var r, out;
    try {
      r = await fetch('/api/send-invite', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: idToken, token: token, email: String(email).trim().toLowerCase() })
      });
      out = await r.json().catch(function () { return {}; });
    } catch (e) { return { error: 'network' }; }
    if (!r.ok || !out.ok) return { error: (out && out.error) || 'failed' };
    // Record who it went to, so the pending row can say so instead of just "waiting".
    try { await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', token, 'sentTo'), String(email).trim().toLowerCase()); } catch (e) {}
    return { ok: true };
  };

  // Withdraw a pending invite: the invite doc is what grants join rights, so deleting it is the
  // real revocation; the household mirror entry is just the visible list. firestore.rules already
  // lets any household owner delete an invite pointing at their household.
  function cancelInvite(email) {
    if (!email || !hhRef) return;
    var doCancel = function () {
      var done = false;
      function finish() {
        try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', email), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e) {}
        if (window.LL.hhPending) delete window.LL.hhPending[email];
        if (getLastInvite() === email) setLastInvite('');
        try { window.toast && window.toast('Invite cancelled.'); } catch (e) {}
        openFamily();
      }
      // Same optimistic exit as saves: offline the delete is queued and will land; don't hang.
      var t = setTimeout(function () { if (done) return; done = true; finish(); }, 6000);
      db.collection('invites').doc(email).delete()
        .then(function () { if (done) return; done = true; clearTimeout(t); finish(); })
        .catch(function (e) {
          if (done) return; done = true; clearTimeout(t);
          // A denied delete here almost always means the invite doc is already gone (used and
          // later cleaned up elsewhere): tidy the stale mirror entry rather than erroring forever.
          if (e && e.code === 'permission-denied') {
            try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', email), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e3) {}
            if (window.LL.hhPending) delete window.LL.hhPending[email];
            if (getLastInvite() === email) setLastInvite('');
            try { window.toast && window.toast('That invite was already gone, so it has been tidied away.'); } catch (e2) {}
            openFamily();
            return;
          }
          try { window.toast && window.toast(errText(e, 'Could not cancel that invite just now. Mind trying again?', true)); } catch (e2) {}
        });
    };
    if (window.confirmSheet) {
      window.confirmSheet({ title: 'Cancel this invite?', body: 'The invite for ' + email + ' will stop working. You can always invite them again.', confirmLabel: 'Cancel invite', cancelLabel: 'Keep it', danger: true, onConfirm: doCancel });
    } else if (window.confirm('Cancel the invite for ' + email + '?')) {
      doCancel();
    }
  }

  function maybeFirstRun(user) {
    if (firstRunShown) return;
    var mi = (window.LL.memberInfo || {})[user.uid] || {};
    // Require a real, completed setup. (Was `setupDone || relationship`, so an invited caregiver whose
    // relationship was pre-filled on the invite never got the name prompt.)
    if (mi.setupDone) return;
    firstRunShown = true;
    // Someone who just accepted an invite is NOT a brand-new owner: they must get the invitee welcome
    // (openFirstRun -> inviteeIntro), never the stage picker. Without this, an invitee joining a
    // family with no baby VISIBLE TO THEM — e.g. an expecting family whose pregnancy is owner-private —
    // had hasData=false and fell through to needsIdentity, then renderOnboard, i.e. the owner wizard,
    // where tapping "We're expecting" created their own pregnancy inside the family they just joined.
    if (window.LL.justJoined) { openFirstRun(user); return; }
    // Brand-new owner with no baby and no pregnancy lands on the onboarding wizard (renderOnboard).
    // Collect identity as a STEP inside that wizard (after stage + details), not as a locked modal
    // popped over the stage picker. Caregivers / anyone with existing data get the identity sheet now.
    var hasData = (state.babies && state.babies.length) || state.pregnancy;
    if (!hasData) { window.LL.needsIdentity = true; return; }
    openFirstRun(user);
  }
  /* The invitee's welcome: who, what you'll do, what you cannot see. Nothing else.

     The privacy line is stated TO THE PERSON IT CONSTRAINS, which is the only place it is really
     credible and where it does the most work for the mother's safe space.

     Checked against firestore.rules before it was written, because a comforting overstatement here
     would be the worst kind of lie. What the rules actually say: `mhealth/{owner}/cat/{category}`
     refuses category 'mood' to everyone except her, ALWAYS, with no mechanism to share it. Her OTHER
     health categories, and her pregnancy, are readable only by uids she has explicitly listed in
     sharedWith. So "how they're feeling, always private" is exactly true, and the rest is "private
     unless they choose to share it with you" — which the design brief's proposed wording ("health
     notes stay private, always") would have got wrong in the direction that erodes trust later. */
  function inviteeIntro() {
    var jj = window.LL.justJoined || {};
    var mi = window.LL.memberInfo || {};
    var inviter = '';
    if (jj.invitedBy && mi[jj.invitedBy]) {
      var m = mi[jj.invitedBy];
      inviter = m.relationship || (m.name ? String(m.name).split(' ')[0] : '');
    }
    var baby = '';
    try { baby = (state.babies && state.babies[0] && state.babies[0].name) || ''; } catch (e) {}
    // Pregnancy is deliberately never named here. An invitee does not get told a family is expecting
    // as a side effect of joining; that is the mother's to share, and it is loss-sensitive.
    var whose = baby ? (esc(baby) + '’s') : 'their';
    var who = inviter
      ? (esc(inviter) + ' asked you to join ' + whose + ' Cubby.')
      : ('You’ve joined ' + (baby ? (esc(baby) + '’s') : 'a family’s') + ' Cubby.');
    return who
      + '<br><br>Anything you log shows up for them straight away, and anything they log shows up for you.'
      + '<br><br>How they’re feeling stays private to them, always. Their own health notes and their pregnancy stay theirs too, unless they choose to share them with you.';
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
    // Someone who just accepted an invite is not a prospect: a person they trust already told them
    // what Cubby is. So they get three things and nothing else, per the invitee spec.
    var isJoin = !opts.asStep && !!window.LL.justJoined;
    var intro = opts.asStep
      ? 'Last thing: how should your family see you? You can change this anytime.'
      : (isJoin
        ? inviteeIntro()
        : 'We\'re so glad you\'re here. 🤍 Cubby is a calm, private place for everyone who loves your little one, and it\'s shaped by families like yours.');
    // The generic bullets are acquisition copy. They would dilute the three things above, and the
    // "your log stays private to your family" line reads oddly to someone joining a family that is
    // not theirs.
    var bullets = isJoin ? ''
      : '<br><br>• Your log stays <b>private</b> to your family, always.<br>• An idea, or something to make better? We read every note: <b>Settings → Family &amp; sharing → Send feedback</b>.';
    modal(isJoin ? 'You\'re in 🐻' : 'Welcome to Cubby 🐻',
      '<div class="ll-auth-msg" style="margin:0 0 10px;text-align:left;line-height:1.55">' + intro + bullets + '</div>'
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
    document.getElementById('llFrSave').onclick = function () {
      var er = document.getElementById('llFrErr');
      var name = (document.getElementById('llFrName').value || '').trim();
      if (!name) { if (er) er.textContent = 'Please add your name so your family knows who is who.'; document.getElementById('llFrName').focus(); return; }
      var rel = relValue('llFrRel', 'llFrRelCustom');
      var u = {}; u['memberInfo.' + uid + '.setupDone'] = true; u['memberInfo.' + uid + '.name'] = name; if (rel) u['memberInfo.' + uid + '.relationship'] = rel;
      var saveBtn = document.getElementById('llFrSave');
      if (er) er.textContent = '';
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      var done = false;
      function finish() { window.LL.needsIdentity = false; closeModal(); if (typeof opts.onDone === 'function') opts.onDone(); }
      // This modal is the ONLY thing on screen: locked, blurred, no ×, no backdrop-dismiss, and on the
      // wizard step no Log out. So its single button must never hang. The Firestore write is applied to
      // the local cache immediately and syncs when the connection returns, so we do NOT hold the exit
      // behind the server round-trip: proceed optimistically after a short wait, and surface only a real
      // rejection (which re-enables the button to retry) instead of trapping the person on a dead screen.
      var t = setTimeout(function () { if (done) return; done = true; finish(); }, 6000);
      var doUpdate = (hhRef && hhRef.update) ? hhRef.update(u) : Promise.resolve();
      doUpdate.then(function () { if (done) return; done = true; clearTimeout(t); finish(); })
        .catch(function () {
          if (done) return; done = true; clearTimeout(t);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = (opts.asStep ? 'Continue' : 'Save'); }
          if (er) er.textContent = 'Could not save just now — check your connection and try again.';
        });
    };
  }
  // Identity collection as a forward wizard step (used by the onboarding flow AFTER stage + details).
  window.LL.collectIdentity = function (stage, onDone) {
    // In prod currentUser is always set (this only runs post-auth); the fallback is for local e2e.
    var u = auth.currentUser || { uid: 'local', displayName: '' };
    firstRunShown = true;
    openFirstRun(u, { asStep: true, stage: stage, onDone: onDone });
  };

  function removeMember(uid, email, name) {
    if (!hhRef) return;
    var doRemove = async function () {
      try {
        var del = firebase.firestore.FieldValue.delete();
        var u = {}; u['members.' + uid] = del; u['memberInfo.' + uid] = del;
        // Keep a tombstone so their past entries stay attributed by name forever.
        var mi = (window.LL.memberInfo || {})[uid] || {};
        u['formerMemberInfo.' + uid] = { name: mi.name || name || '', relationship: mi.relationship || '', avatar: mi.avatar || null };
        await hhRef.update(u);
        // PRIV-2: drop the removed member's gated email doc too (owner may, by rule). Their
        // address should not linger in a circle they are no longer part of.
        try { hhRef.collection('memberEmails').doc(uid).delete().catch(function () {}); } catch (e) {}
        if (email) {
          try { await db.collection('invites').doc(email).delete(); } catch (e) {}
          // Drop any pending-invite mirror entry too, so a removed member's email doesn't linger
          // in the "Invited, waiting" list once they're gone from memberInfo.
          try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', String(email).toLowerCase()), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e) {}
        }
        openFamily();
      } catch (e) { try { window.toast && window.toast('Could not remove ' + (name || 'this person') + ' just now.'); } catch (e2) {} }
    };
    // Use the app's own confirm sheet (calm, on-brand); native confirm is only a defensive fallback.
    if (window.confirmSheet) {
      window.confirmSheet({ title: 'Remove ' + (name || 'this person') + '?', body: 'They’ll lose access, but everything they logged stays part of the baby’s story.', confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true, onConfirm: doRemove });
    } else if (window.confirm('Remove ' + (name || 'this person') + ' from your family?')) {
      doRemove();
    }
  }

  function saveMyRelationship() {
    if (!hhRef) return;
    var v = relValue('llMyRel', 'llMyRelCustom');
    var nameEl = document.getElementById('llMyName');
    var name = (nameEl ? (nameEl.value || '').trim().slice(0, 40) : '');
    var msg = document.getElementById('llMyRelMsg');
    if (nameEl && !name) { msg.textContent = 'Please add your name so your family knows who is who.'; nameEl.focus(); return; }
    var uid = auth.currentUser.uid;
    var u = {}; u['memberInfo.' + uid + '.relationship'] = v;
    if (nameEl) u['memberInfo.' + uid + '.name'] = name;
    var btn = document.getElementById('llMyRelBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var done = false;
    function finish() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save my profile'; }
      if (msg) msg.textContent = '✅ Saved.';
      if (typeof window.render === 'function') { try { window.render(); } catch (_) {} }
    }
    // Same optimistic exit as the first-run sheet (openFirstRun): the write lands in the local
    // cache immediately and syncs when the connection returns, so "Saved" is not held hostage to
    // the server round-trip. Only a real rejection re-opens the door to retry.
    var t = setTimeout(function () { if (done) return; done = true; finish(); }, 6000);
    hhRef.update(u).then(function () {
      if (nameEl && name && name !== (auth.currentUser.displayName || '')) { try { auth.currentUser.updateProfile({ displayName: name }).catch(function () {}); } catch (_) {} }
      if (done) return; done = true; clearTimeout(t); finish();
    }).catch(function (e) {
      if (done) return; done = true; clearTimeout(t);
      if (btn) { btn.disabled = false; btn.textContent = 'Save my profile'; }
      if (msg) msg.textContent = errText(e, 'Could not save just now. Mind trying again?', true);
    });
  }

  // The message a recipient actually needs. The whole invite is matched by email address, so an
  // invite link WITHOUT "sign in with this exact address" is not an invite, it is a trap — and the
  // copy button used to hand over exactly that: a bare URL, identical for every family, with the
  // instructions living only in the mailto: branch that WhatsApp users never touch.
  function inviteText(email) {
    var link = location.origin + '/app/?join=1';
    var steps = '1) Open this link: ' + link + '\n'
      + (email ? ('2) Sign in with this email address: ' + email + '\n   It has to be that one, that is how Cubby knows to let you in.\n\n') : '\n');
    var hasBaby = (typeof state !== 'undefined' && state.babies && state.babies.length);
    // Stage-aware, and honest about what the recipient will actually see. A pregnancy is
    // owner-private unless she shares it, so an expecting family's invitee may land on a quiet
    // screen: promising "you'll see everything, live" there was a broken promise on arrival.
    if (!hasBaby && typeof state !== 'undefined' && state.pregnancy) {
      return 'I\'m using Cubby to keep everything about our growing family in one calm place, and I\'d love you in our circle.\n\n'
        + steps
        + 'I\'ll share updates when I\'m ready, and once baby arrives you\'ll see the day as it happens.';
    }
    if (!hasBaby) {
      return 'I\'m using Cubby as our family\'s calm little corner, and I\'d love you on it too.\n\n'
        + steps
        + 'There isn\'t much to see just yet, but you\'ll be in from the start.';
    }
    var babyName = (state.babies[0] && state.babies[0].name) || 'our little one';
    return 'I\'m using Cubby to keep track of ' + babyName + '\'s feeds, naps and nappies, and I\'d love you on it too.\n\n'
      + steps
      + 'You\'ll see everything, live.';
  }
  // The last-created invite email, per signed-in person, surviving relaunch (it used to be a
  // page-session variable, so after a relaunch Share refused with "Create an invite first" even
  // though a perfectly good invite existed).
  var _lastInviteEmail = '';
  function lastInviteKey() { var u = auth.currentUser; return 'cubby-lastinvite-' + ((u && u.uid) || 'local'); }
  function getLastInvite() {
    if (!_lastInviteEmail) { try { _lastInviteEmail = localStorage.getItem(lastInviteKey()) || ''; } catch (e) {} }
    return _lastInviteEmail;
  }
  function setLastInvite(email) {
    _lastInviteEmail = email || '';
    try {
      if (email) localStorage.setItem(lastInviteKey(), email);
      else localStorage.removeItem(lastInviteKey());
    } catch (e) {}
  }
  /* Mint a fresh single-use link, then share it. Minting on demand rather than showing a standing
     URL is the whole point: the old row displayed one identical link for every family on earth,
     which is why the copy underneath had to explain that the link alone was not enough. */
  async function copyAppLink() {
    var btn = document.getElementById('llCopyLink');
    var inp = document.getElementById('llAppLink');
    var msg = document.getElementById('llInvMsg');
    if (btn) { btn.disabled = true; btn.textContent = 'Making…'; }
    var made = await window.LL.createInviteLink({ role: 'caregiver' });
    if (btn) btn.disabled = false;
    if (!made) {
      if (btn) btn.textContent = 'Make a link';
      if (msg) msg.textContent = 'Could not make a link just now. You can still invite by email above.';
      return;
    }
    if (inp) inp.value = made.url;
    // Reveal the email option only once a link exists, and remember which token it belongs to.
    var mailWrap = document.getElementById('llLinkMail');
    if (mailWrap) { mailWrap.style.display = ''; mailWrap.setAttribute('data-token', made.token); }
    var mailBtn = document.getElementById('llLinkMailBtn');
    if (mailBtn) mailBtn.onclick = function () { emailTheLink(made.token); };
    var text = inviteLinkText(made);
    var done = function () { if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Make another'; }, 1600); } };
    if (navigator.share) {
      navigator.share({ title: 'Join me on Cubby 🐻', text: text }).then(function () {
        if (btn) { btn.textContent = 'Shared!'; setTimeout(function () { btn.textContent = 'Make another'; }, 1600); }
      }).catch(function () { if (btn) btn.textContent = 'Make another'; });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { try { inp.select(); document.execCommand('copy'); done(); } catch (e) {} });
    } else { try { inp.select(); document.execCommand('copy'); done(); } catch (e) {} }
  }
  async function emailTheLink(token) {
    var inp = document.getElementById('llLinkEmail');
    var btn = document.getElementById('llLinkMailBtn');
    var msg = document.getElementById('llLinkMailMsg');
    var email = ((inp && inp.value) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (msg) msg.textContent = 'That does not look like an email address.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    var res = await window.LL.sendInviteEmail(token, email);
    if (btn) { btn.disabled = false; btn.textContent = 'Email the link'; }
    if (res && res.ok) {
      if (msg) msg.textContent = 'Sent. It works once and expires in a day.';
      if (inp) inp.value = '';
      return;
    }
    // Say which thing went wrong, because each one has a different next step.
    var why = (res && res.error) || 'failed';
    if (msg) msg.textContent =
      why === 'link_spent' ? 'Someone has already used that link. Make a new one.'
      : why === 'link_expired' ? 'That link has expired. Make a new one.'
      : why === 'rate_limited' ? 'A few too many just now. Try again in a minute.'
      : why === 'unauthorized' ? 'Only the owner of this circle can send invites.'
      : 'Could not send just now. You can still share the link yourself.';
  }
  // Stage-aware and honest about what they will actually land on, same as inviteText.
  function inviteLinkText(made) {
    var hasBaby = (typeof state !== 'undefined' && state.babies && state.babies.length);
    var who = hasBaby ? 'our baby\'s day' : 'our journey';
    return 'Join me on Cubby 🐻\n\n' + made.url + '\n\n'
      + 'It opens Cubby and puts you straight into our circle, so you can see ' + who + ' as it happens.\n'
      + 'The link works once and only for a day, so it is just for you.';
  }
  function copyAppLinkLegacy() {
    var btn = document.getElementById('llCopyLink');
    // No invite on record -> we do NOT know which address they should sign in with, so
    // inviteText('') would hand over a bare link with no address: the exact trap that lands the
    // recipient in an empty household as owner. Refuse it and point them at the invite box, where
    // creating the invite records the email and makes this button send the full, correct message.
    if (!getLastInvite()) {
      var m0 = document.getElementById('llInvMsg');
      if (m0) m0.textContent = 'First add their email in “Invite a family member” above and tap Create invite — then this sends the link and the exact address they sign in with.';
      try { var e0 = document.getElementById('llInvEmail'); if (e0) e0.focus(); } catch (_) {}
      if (btn) { var t0 = btn.textContent; btn.textContent = 'Create an invite first'; setTimeout(function () { btn.textContent = t0; }, 2200); }
      return;
    }
    var text = inviteText(getLastInvite());
    var done = function () { if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); } };
    // Native share sheet first: in the wrapper this is the idiom, and mailto: in a WKWebView is the
    // worst option available. Falls back to the clipboard everywhere it is missing.
    if (navigator.share) {
      navigator.share({ title: 'Join me on Cubby 🐻', text: text }).then(function () {
        if (btn) { btn.textContent = 'Shared!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); }
      }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(function () { try { var inp = document.getElementById('llAppLink'); inp.select(); document.execCommand('copy'); done(); } catch (e) {} }); }
    else { try { var inp2 = document.getElementById('llAppLink'); inp2.select(); document.execCommand('copy'); done(); } catch (e) {} }
  }

  function submitInvite() {
    var name = ((document.getElementById('llInvName').value) || '').trim();
    var email = ((document.getElementById('llInvEmail').value) || '').trim().toLowerCase();
    var rel = document.getElementById('llInvRel').value || '';
    var owner = document.getElementById('llInvOwner').checked;
    var msg = document.getElementById('llInvMsg');
    if (!email || email.indexOf('@') < 1) { msg.textContent = 'Please enter a valid email.'; return; }
    var btn = document.getElementById('llInvBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    var done = false;
    function showReady() {
      // One message, used by every route out of here. It used to be composed twice, and only the
      // mailto: copy carried the "sign in with this address" line that makes the invite work at all.
      setLastInvite(email);
      var bodyTxt = inviteText(email);
      var subject = 'Join me on Cubby 🐻';
      var mailto = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyTxt);
      // We no longer coach people out of Apple's Hide My Email here. That advice existed to paper
      // over the email-matching design, and telling a parent to give up a privacy default is not
      // something a privacy-max product should be doing. If it mismatches, the sign-in now explains
      // it and offers the way back instead.
      msg.innerHTML = '✅ Invite ready for <b>' + esc(email) + '</b>' + (rel ? ' (' + esc(rel) + ')' : '') + '.'
        + '<button id="llInvShareBtn" class="ll-modal-btn" style="margin-top:10px">' + (navigator.share ? '📤 Share the invite' : '📧 Email the invite') + '</button>'
        + '<div style="font-size:12px;color:#9a8d80;margin-top:8px">Sends the link <b>and</b> the address they need to sign in with. Or use <b>Copy</b> above for WhatsApp.</div>';
      var eb = document.getElementById('llInvShareBtn');
      if (eb) eb.onclick = function () {
        if (navigator.share) { navigator.share({ title: subject, text: bodyTxt }).catch(function () {}); return; }
        window.location.href = mailto;
      };
      btn.textContent = 'Create invite'; btn.disabled = false;
      document.getElementById('llInvName').value = ''; document.getElementById('llInvEmail').value = '';
    }
    // Same optimistic exit as the first-run sheet: offline the SDK queues the write and the
    // promise stays pending, so waiting on it would freeze "Creating…" forever. Proceed after a
    // short wait; only a real rejection turns into an error.
    var t = setTimeout(function () { if (done) return; done = true; showReady(); }, 6000);
    db.collection('invites').doc(email).set({
      householdId: window.LL.householdId, role: owner ? 'owner' : 'caregiver',
      relationship: rel, name: name,
      invitedBy: auth.currentUser.uid, status: 'pending', createdAt: window.LL.serverTimestamp()
    }).then(function () { if (done) return; done = true; clearTimeout(t); showReady(); })
      .catch(function (e) {
        if (done) return; done = true; clearTimeout(t);
        msg.textContent = errText(e, 'Could not create the invite just now. Mind trying again?');
        btn.textContent = 'Create invite'; btn.disabled = false;
      });
    // Mirror the pending invite onto the household doc so the circle screen can list and cancel
    // it (owners cannot query /invites: reads there are invitee-only by rule). FieldPath keeps the
    // dots in the email from being read as a nested path. Best-effort: the invite doc is the
    // grant, this is only the visible list.
    try {
      if (hhRef) hhRef.update(new firebase.firestore.FieldPath('pendingInvites', email), { name: name, relationship: rel, role: owner ? 'owner' : 'caregiver', at: Date.now() }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- feedback ---------- */
  function openFeedback() {
    modal('Send feedback',
      '<div class="ll-auth-msg" style="margin:0 0 8px">Bugs, ideas, anything, it goes straight to the Cubby team. Thank you for testing! 🐻</div>'
      + '<textarea id="llFbText" class="ll-fb" placeholder="What happened, or what would make Cubby better?"></textarea>'
      + '<button id="llFbSend" class="ll-modal-btn">Send</button>'
      + '<div id="llFbMsg" class="ll-auth-msg"></div>'
      + '<div class="ll-auth-msg" style="margin:10px 0 0">Got a screenshot? Email <a href="mailto:support@little-cubby.com">support@little-cubby.com</a> instead.</div>');
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
          // Both readers (tools/ops.js, tools/analytics.js) sort on createdAt, so writing only `at`
          // meant every note scored 0 and the sort was a silent no-op — the notes from twenty real
          // testers arrived in arbitrary order. `at` is kept so rows already written stay readable.
          at: window.LL.serverTimestamp(), createdAt: window.LL.serverTimestamp()
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
  /* An empty catch on the auth path is how a person gets a silent nothing. This swallowed EVERY
     redirect error, which is the branch an installed iOS app takes: the popup has no opener, Firebase
     falls through to a redirect, the redirect fails or lands in Safari, and this discarded the reason.
     Nobody could have reported what went wrong because nothing was ever said. */
  auth.getRedirectResult().catch(function (err) {
    signInIdle();
    if (err && err.code === 'auth/popup-closed-by-user') return;   // backing out is a choice, stay quiet
    showSignIn(errText(err, 'That sign-in did not come back. Mind trying again?'));
  });
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
        /* normalizeLoadedState, because the cloud path runs it on every snapshot (applyAppBlob) and
           this one used to skip it. That made ?e2e=1 boot a shape the real app never produces, so
           every gate in the repo was testing a slightly different product: tools/info_dot_check.js
           found it by crashing in medNextDue on a medicine with no pattern, which a real signed-in
           household would have had normalised away before render. A harness that is not the app is
           a harness that lies in both directions. */
        Store.load().then(function (d) {
          if (d && typeof state !== 'undefined') {
            try { Object.assign(state, d); } catch (e) {}
            try { if (typeof normalizeLoadedState === 'function') normalizeLoadedState(state); } catch (e) {}
          }
          if (typeof render === 'function') render();
          ['llAuthOv', 'llModalOv'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
        });
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
      // null means resolveHousehold deliberately declined to place this user: they followed an
      // invite link but no invite matches the address they signed in with, and showInviteMismatch()
      // already owns the screen. Starting a sync against a null household would throw over the top
      // of a message they need to read.
      if (!hid) return;
      startSync(hid, user);
      // A push token can arrive before auth restores (APNs/FCM can beat the IndexedDB restore), and
      // storePushToken parks it rather than writing to the 'local' sentinel uid. Flush it now that
      // there's a real uid to write under, or a rotated token would silently never reach the cron.
      try { if (window.cubbyFlushPendingPush) window.cubbyFlushPendingPush(); } catch (e) {}
    } catch (err) {
      console.error(err);
      // Losing signal is not a sign-in problem, so it must not send her back to the door. Only a
      // genuine auth or permission failure does that.
      if (isConnErr(err) && showConnTrouble({
        title: 'We can’t reach your Cubby',
        body: 'You look offline. Anything already saved on this phone is still here, safe. Try again once you have a connection.'
      })) return;
      showSignIn(errText(err, 'Could not load your data just now. Mind trying again?'));
    }
  });
})();
