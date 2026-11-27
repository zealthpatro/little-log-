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
  /* Sign-in steps as usage events (app/cubby-track.js; spec §8.3 signin.attempted). The method, the step
     and a fixed error word only: never the address, the code or the provider's own message. */
  var _signinTries = {};
  function signinErr(err) {
    var c = String((err && (err.code || err.message)) || '');
    if (/popup-closed/.test(c)) return 'popup_closed';
    if (/popup-blocked/.test(c)) return 'popup_blocked';
    if (/cancel/i.test(c)) return 'cancelled';
    if (/network|offline|Failed to fetch/i.test(c)) return 'network';
    if (/invalid-action-code|invalid_link/.test(c)) return 'invalid_link';
    if (/expired/.test(c)) return 'expired_code';
    if (/bad_code/.test(c)) return 'wrong_code';
    if (/rate_limited|too-many/.test(c)) return 'too_many';
    if (/no_session|user-token-expired/.test(c)) return 'no_session';
    return 'other';
  }
  function signinTrack(method, step, outcome, err) {
    try {
      if (!window.cubbyTrack) return;
      if (step === 'started') { _signinTries[method] = (_signinTries[method] || 0) + 1; try { sessionStorage.setItem('cubby-signin-method', method); } catch (e) {} }
      var inApp = false;
      try { inApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || !!window.navigator.standalone || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) {}
      window.cubbyTrack('signin.attempted', { method: method, step: step, outcome: outcome, error: err ? signinErr(err) : 'none',
        attempt: Math.max(1, Math.min(20, _signinTries[method] || 1)), storage: inApp ? 'app' : 'browser' });
    } catch (e) {}
  }
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

  /* Everything a snapshot carries was written by SOMEONE in the circle, and the rules check only
     who, not what. So ids, colours and photo bytes go through window.cubbyIngest (index.html) on
     the way into state, and nothing else is trusted to have done it (AUDIT client-1). A doc id that
     is not one Cubby would make is swapped for a stable stand-in; rawDocId remembers the real key,
     so the entry can still be edited or deleted. If an older cached index.html has no cubbyIngest,
     data passes as before rather than the sync breaking. */
  var PASS = { id: function (v) { return v; }, photo: function (v) { return v; }, event: function (d, id) { d.id = id; return d; }, note: function (d, id) { d.id = id; return d; }, blob: function (a) { return a; }, mat: function (d) { return d; }, photos: function (m) { return m; } };
  function ing() { return window.cubbyIngest || PASS; }
  var rawDocId = {};
  function ingestId(raw) { var s = ing().id(raw); if (s !== raw) rawDocId[s] = raw; return s; }
  function docKey(id) { return rawDocId[id] || String(id); }

  var hhRef = null, eventsRef = null, photosRef = null, notesRef = null;
  var booted = false;
  var unsub = [];
  var knownEvents = {};      // id -> JSON of last-synced event (for diffing)
  var serverAuthor = {};     // id -> the authorId the server holds (stripMeta drops it from knownEvents; rules make it immutable)
  var applyingRemote = false;
  var pushTimer = null;
  var unackedEv = {};        // id -> { baseSer, n }: entry writes the server has not acknowledged yet (the outbox, below)
  var syncUid = null;        // whose family this phone's memory holds (startSync), for a sign-out that lands after auth has gone
  var blobOut = 0;           // blob writes issued and not yet settled
  var outboxSaved = false;   // an outbox for this page is in localStorage now (it is hidden or going away)
  var replayEv = null, replayHold = null; // a stored outbox read at boot, not yet put back by its first snapshot
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
  /* Maternal keys an older build left inside the shared blob. firestore.rules appBlobClean refuses
     EVERY write that touches `app` while any of them is there, for every member, so the owner's
     one-time move (maybeMigrateLegacyJourney) has to delete them, not just stop writing them.
     Refreshed from each household snapshot, so "present" always means present on the server. */
  var LEGACY_BLOB_KEYS = ['pregnancy', 'mhealth', 'maternalHealth'];
  var legacyBlobPresent = [];

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
  /* The preparation checklist gets its OWN last-synced signature, and it has to.
     knownPregJourney is a whole-document signature, and every device latches permanently
     different from it about a second after boot: applyPregJourney adopts the server's data, then
     the first render calls ensurePregFields, which adds `gentle` and `guesses` locally. Neither is
     stripped by pregJourneyData, so `unsaved` below is TRUE forever on every phone, including
     phones holding no edit at all. Keying "do I owe the cloud a checklist?" off that flag meant a
     partner's tick was kept locally by BOTH devices and adopted by neither: his tick never reached
     her, and her next save wrote her stale list back over it. This signature moves only when the
     checklist itself is adopted from a snapshot or successfully written, so it means exactly what
     it says. */
  var knownPrecon = null;      // sig of the precon array we last adopted from / wrote to the cloud
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
  var configUnsub = null;           // the one read-only remote config document, config/app
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
    + '.ll-mem{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#FBF7EF;border-radius:12px;padding:10px 12px;}'
    // A long name or address wraps, anywhere, so the label and buttons beside it stay on the card at
    // 320px. The label side gives up its room first (a huge flex-shrink), and it can: its label stacks
    // over its button (flex-wrap), so an ordinary name or address ("Papadopoulos", "sam.lee@...") that
    // fits once they stack is never broken mid-word. Without the wrap the label side could not shrink
    // at all, and the name side broke its words to make room. (The 8px between a stacked label and its
    // button is the inline gap on that div; a row-gap here would lose to it.)
    + '.ll-mem-name{font-weight:700;color:#2C2521;font-size:15px;overflow-wrap:anywhere;}.ll-mem-email{color:#9a8d80;font-size:12px;overflow-wrap:anywhere;}'
    + '.ll-mem>div:last-child{flex-shrink:1000000;flex-wrap:wrap;justify-content:flex-end;}'
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
    /* The fold, used only by the invite door: one obvious action at the top and the slower ways
       tucked under a tap. <details> rather than a JS toggle because it opens on tap and on Enter
       with no script at all, so it can never end up stuck shut on a phone where something else
       threw. Its body cancels .ll-invite's own top rule, which would otherwise draw a divider
       immediately under the fold's own border.

       Border only, no fill, in both themes. The ghost buttons that live inside it (Save my
       profile, Change my bear avatar, Sign out) are #FBF7EF in day and var(--surface) at night,
       which is exactly the fill a tinted panel would have wanted: shot at 390px in Night with a
       var(--surface) fold, all three buttons disappeared into the panel they sat on. */
    + '.ll-fold{border:1px solid #E8DFCF;border-radius:14px;margin-top:12px;background:transparent;}'
    + '.ll-fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;font-weight:700;font-size:14px;color:#2C2521;}'
    + '.ll-fold>summary::-webkit-details-marker{display:none;}'
    + '.ll-fold-c{color:#9a8d80;font-weight:800;transform:rotate(90deg);transition:transform .15s;}'
    + '.ll-fold[open] .ll-fold-c{transform:rotate(-90deg);}'
    + '.ll-fold-b{padding:0 14px 14px;}'
    + '.ll-fold-b .ll-invite{border-top:none;padding-top:0;}'
    + '.ll-fold-b .ll-ghost{margin-top:10px;}'
    // Nothing has gone wrong yet, so it should take up no room yet.
    + '#llLinkErr:empty{display:none;}'
    /* And when something HAS gone wrong it has to look unlike the two helper paragraphs it sits
       between. Measured before this rule: #9a8d80 on white, 2.9:1, typographically identical to
       its neighbours, so the one line telling her the link failed read as more small print.
       --danger-ink is the text-safe rung and already swaps itself at night (6.0:1 day on white,
       6.2:1 night on --surface), so this needs no night twin. */
    + '#llLinkErr:not(:empty){color:var(--danger-ink,#9F4C3B);font-weight:700;margin-top:6px;}'
    /* The one-line prompt above the link, for an owner who has not named the family yet: it is
       the only advice on this screen that stops being useful the second she taps Make a link. */
    + '.ll-namefirst{display:flex;align-items:center;justify-content:space-between;gap:10px;'
    + 'border:1px solid #E8DFCF;border-radius:14px;padding:11px 12px 11px 14px;margin-bottom:12px;'
    + 'font-size:13px;line-height:1.4;color:#2C2521;}'
    + '.ll-namefirst .ll-modal-btn{margin:0;width:auto;padding:9px 14px;white-space:nowrap;font-size:14px;}'
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
    + '[data-theme="night"] .ll-fold{border-color:var(--line);}'
    + '[data-theme="night"] .ll-fold>summary{color:var(--ink);}'
    + '[data-theme="night"] .ll-fold-c{color:var(--ink-faint);}'
    + '[data-theme="night"] .ll-namefirst{border-color:var(--line);color:var(--ink);}'
    // The family's own name, on the mint panel, was #2C2521 on #1E2F2A at night: 1.5:1, the one
    // thing on this screen an invited person is told they are joining.
    + '[data-theme="night"] .ll-hhname-v{color:var(--ink);}'
    + '[data-theme="night"] .ll-modal-btn{color:var(--bg);}'
    /* Last, and one class heavier, because the line above it is what broke these. Equal
       specificity meant `[data-theme="night"] .ll-modal-btn{color:var(--bg)}` won over
       `.ll-ghost`'s own colour by source order, so Save my profile, Change my bear avatar and
       Sign out were all #1A1614 on var(--surface): 1.09:1, invisible. The fold now puts three of
       them one tap away, which is where a parent would have met it. */
    + '[data-theme="night"] .ll-modal-btn.ll-ghost{color:var(--ink-soft);}';
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
  /* THE CODE IS THE HAPPY PATH, on every surface, and the link is the fallback that happens to be in
     the same email. It used to be the other way round everywhere except an installed iOS app.

     A code does not navigate. You read it and type it where you already are, so the session is created
     in the container that asked for it — which is the only property that always holds. A link has to
     land somewhere, and we do not get to choose where: from an installed iOS app it opens Safari,
     whose storage jar the app cannot see; read on a different device from the one waiting, it signs in
     the device holding the mail and leaves the other exactly where it was. It is one tap when it works
     and a dead end when it does not, so it is offered second. */
  var SEND_LABEL = 'Send code';
  /* width:100% as the Google button beside it has (.lp-cta). In the app's sign-in column (.lp-app-auth, a
     flex column) a child with auto side margins is sized to its content, not to the column, and the code
     box's own width (an input's intrinsic size, plus Sign in) is wider than a 320 px phone's column: the row
     ran from the left gutter to the screen's edge, with the button's corner cut off (round-6 skeptic
     R6M2-5). Filling the column, capped at 340 px and centred, gives it the same gutter on both sides. */
  function emailRowHtml() {
    return '<div class="ll-email-row" style="margin:14px auto 0;width:100%;max-width:340px;text-align:center">'
      + '<button type="button" class="ll-email-toggle" style="border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink-soft,#6E635B);text-decoration:underline;padding:6px">'
      + 'Prefer email? Get a sign-in code</button>'
      + '<form class="ll-email-form" style="display:none;gap:8px;margin-top:8px">'
      + '<input type="email" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:0;font-family:inherit;font-size:15px;padding:11px 13px;border:1.5px solid var(--line,#E7DECF);border-radius:11px;background:var(--surface-2,#FBF7EF);color:var(--ink,#2C2521)">'
      + '<button type="submit" style="border:none;background:var(--note,#9A8C6E);color:var(--on-accent,#2C2521);font-family:inherit;font-weight:800;font-size:14px;padding:11px 14px;border-radius:11px;cursor:pointer;white-space:nowrap">'
      + SEND_LABEL + '</button>'
      + '</form>'
      // inputMode numeric + autocomplete one-time-code, so iOS offers the code from the notification
      // rather than making them switch to Mail and back.
      /* The primary control of the email flow, on every surface. Revealed once an email is actually
         out, and only when the sender told us that email carries a code. */
      + '<form class="ll-code-form" style="display:none;gap:8px;margin-top:8px">'
        + '<input type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="6-digit code" style="flex:1;min-width:0;font-family:inherit;font-size:17px;letter-spacing:.18em;text-align:center;padding:11px 13px;border:1.5px solid var(--line,#E7DECF);border-radius:11px;background:var(--surface-2,#FBF7EF);color:var(--ink,#2C2521)">'
        + '<button type="submit" style="border:none;background:var(--note,#9A8C6E);color:var(--on-accent,#2C2521);font-family:inherit;font-weight:800;font-size:14px;padding:11px 14px;border-radius:11px;cursor:pointer;white-space:nowrap">Sign in</button>'
        + '</form>'
      + '<div class="ll-email-note" style="font-size:12px;font-weight:600;color:var(--ink-soft,#6E635B);margin-top:7px"></div></div>';
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
  /* The field she is typing in stays above the keyboard. The app's own sign-in is exactly one screen
     tall (.lp-app is min-height:100dvh inside the fixed overlay), and an iPhone keyboard does not change
     100dvh, so when the keys came up over the email field there was nothing to scroll: WebKit could not
     bring the field up, and the address and Send code sat under the keys (device test, 16 Nov 2026). The
     code step only escaped because its longer note made the screen taller than the phone. So while a
     field of the email row has focus and the keys cover part of the screen, the overlay gets that much
     room below its content and the row is moved up above the keys; when the keys go, the room goes.
     WHAT ELSE STAYS ABOVE THE KEYS (round 7, 17 Nov 2026). She waits in the code box with the keys up,
     which is the designed flow (iOS offers the code from Mail there), and the note about her email sits
     under the box. "We couldn't get that email to you" arrived under the keys and was never seen, which is
     the incident itself, again. So in the code box, once the note has something new to say (the status
     line or a code error has words), the block kept above the keys runs from the box to the end of the
     note, "Wrong email?" included; if it cannot all fit, the box wins, because it is where she is typing. */
  function keysHeight() {
    var vv = window.visualViewport;
    return vv ? Math.max(0, Math.round(document.documentElement.clientHeight - vv.height)) : 0;
  }
  function fitAboveKeys() {
    var vv = window.visualViewport, ov = document.getElementById('llAuthOv');
    if (!vv || !ov) return;
    var a = document.activeElement, row = a && a.closest ? a.closest('.ll-email-row') : null;
    var keys = row && ov.contains(row) && ov.classList.contains('landing') ? keysHeight() : 0;
    if (keys < 80) { ov.style.paddingBottom = ''; return; }
    ov.style.paddingBottom = keys + 'px';
    var f = a.closest('form') || a, r = f.getBoundingClientRect(), rTop = r.top, rBottom = r.bottom;
    var nt = f.classList && f.classList.contains('ll-code-form') ? row.querySelector('.ll-email-note') : null;
    var said = nt && [nt.querySelector('.ll-mail-status'), nt.querySelector('.ll-code-err')].some(function (x) { return x && x.textContent; });
    if (said) rBottom = Math.max(rBottom, nt.getBoundingClientRect().bottom);
    var top = vv.offsetTop + 12, bottom = vv.offsetTop + vv.height - 16;
    if (rBottom > bottom) ov.scrollTop += Math.min(rBottom - bottom, rTop - top);
    else if (rTop < top) ov.scrollTop -= top - rTop;
  }
  (function () {
    var vv = window.visualViewport, t = null;
    if (!vv) return;
    var soon = function () { clearTimeout(t); t = setTimeout(fitAboveKeys, 60); };
    vv.addEventListener('resize', soon);
    document.addEventListener('focusin', soon);
    document.addEventListener('focusout', soon);
  })();
  function wireEmailRow(scope) {
    var row = scope.querySelector('.ll-email-row'); if (!row) return;
    var toggle = row.querySelector('.ll-email-toggle'), form = row.querySelector('.ll-email-form'), note = row.querySelector('.ll-email-note');
    var input = form.querySelector('input'), btn = form.querySelector('button');
    var LINKBTN = 'border:none;background:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;color:#6E635B;text-decoration:underline;padding:2px';
    var cdTimer = null;
    // (re)show the email form keeping what's typed, so a wrong or changed address can be corrected and re-sent.
    /* SEND_LABEL is module-level and used by the markup too: the button label had been hardcoded
       separately from the mode that chose it, so the toggle once read "Sign in with an email code"
       over a button reading "Send link". One variable, so they cannot disagree again. */
    /* It leaves the mail watch alone (skeptic M-S1, 16 Nov 2026). The undeliverable note says "Check the
       address", so "Wrong email?" is exactly where she goes next, and dropping what the panel knew here meant
       the same address sent again inside the minute came back "We already sent an email ... so use that
       one". Whatever she sends next decides the watch (showEmailSent); until then it draws nowhere. */
    function openForm() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } note.textContent = ''; toggle.style.display = 'none'; form.style.display = 'flex'; btn.disabled = false; btn.textContent = SEND_LABEL; input.focus(); input.select(); }
    toggle.onclick = openForm;

    // Send (or resend) the sign-in link: our own Worker + Resend first (Firebase's built-in sender
    // has poor Gmail delivery), falling back to Firebase's sender if the endpoint is down. The link
    // itself is a standard Firebase email-sign-in link, finished below by signInWithEmailLink().
    function sendLink(email) {
      return fetch('/api/send-signin-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'send_failed'); return d; }); })
        /* Firebase's own sender, last resort, and it can only ever mail a LINK. So it answers in the
           same shape the worker does, with hasCode false: the panel must not offer a code box over an
           email that has no code in it. Same rule, stated by whoever actually did the sending. */
        .catch(function () { return auth.sendSignInLinkToEmail(email, { url: location.origin + '/app/', handleCodeInApp: true }).then(function () { return { fallback: true, hasLink: true, hasCode: false }; }); })
        // Resolve with what the worker actually said (notably `cached`, which means it sent nothing).
        .then(function (d) { try { localStorage.setItem('cubby-email-signin', email); } catch (e) {} return d || {}; });
    }

    /* The worker answers {ok:true, cached:true} when the per-address cooldown is still armed, and on
       that answer it sent NOTHING. Saying "we sent you an email" over a request that mailed nobody is
       the same lie in miniature as a code panel over a link-only email, and it costs her the minute
       she spends staring at an inbox nothing is coming to. So say which one it was. */
    function sentLine(email, cached) {
      return cached
        ? 'We already sent an email to <b>' + escHtml(email) + '</b> in the last minute, so use that one. If it never turns up, try again in a moment.'
        : 'Check your inbox: we just emailed <b>' + escHtml(email) + '</b>.';
    }

    /* ---- did that email actually go? (16 Nov 2026) ----
       Resend accepting an email is not the email arriving. It accepts one for an address on its
       suppression list and then never sends it, and a bounce comes after it accepted. A new Gmail
       address met exactly that: "we just emailed you", three times, and nothing in any folder, Spam
       included, with no hint that Google or Apple would let her straight in. So when the sender hands
       back a sendRef, the panel asks the Worker what became of that email a few times while she waits
       (MAIL_CHECKS, seconds after the send), and stops at the first settled answer or after the last.
         undeliverable: say so plainly, drop "check your inbox", and point to the other doors.
         delivered:     say it arrived, and where it may be hiding.
         anything else: sent, delayed or unknown (a sending-only Resend key, another colo, a timeout)
                        changes nothing on her screen until about 45 seconds have passed (below).
       A status answer only ever writes into its own line. It never touches what she has typed, because a
       code that did arrive must always still work.
       The line is a polite live region, and it is on the page, empty, from the moment the note is drawn: a
       screen reader reads out a change to a region it already has, and may skip one that was hidden until
       the words arrived (skeptic M-S4). So the words go in after the region (fresh: a note just drawn).
       NO ANSWER YET (round 7). Production's Resend key may only be allowed to send, and then every ask is
       unknown; an ask can land in another data centre; Resend can still be trying (delayed); an older
       Worker sends no sendRef; a reload or a second panel inside the minute gets only the cooldown's
       answer. Each of those left her with "check your inbox" and nothing else, which is the incident. So
       when nothing is settled about 45 seconds after the email went, the line says, once, that it can take
       a few minutes and that Google or Apple will let her in now (SLOW_LINE). Never over delivered or
       undeliverable, which say more; a settled answer that comes later replaces it.
       It is timed from the send, on the page's own clock (a timer of MAIL_SLOW), not from a step of the
       asking chain: the chain's steps are each counted from the answer before, and iOS suspends the app
       while she looks in Mail, so on her return the chain is wherever it stopped. Back 60 seconds after
       the send, she had the line 37 seconds later, at the chain's 45-second step (round 7, R7M-1). A
       suspended page runs its overdue timers the moment she is back, so the timer is due at once. A phone
       that slept (locked, its screen off) can come back with its timers behind the wall clock instead, so
       any answer that is not settled also brings the line once Date.now() is 45 seconds past the send. It
       still never draws the line by itself while an ask could contradict it a moment later: with an ask
       on its way, the line comes with that answer if it is not settled (an ask gives up after
       MAIL_ASK_GIVE_UP); with none, the chain's next ask is made now instead, and the line comes with it.
       ABOVE THE KEYS (round 7). The line is under the code box, so under the keys while she waits in the
       box. A line with words is fitted above the keys with the box (fitAboveKeys). Undeliverable over an
       EMPTY box lets go of the box instead, so the keys go down and she sees the note and the Google and
       Apple buttons; a box she has typed into is never let go, and neither is any other line's. */
    var MAIL_CHECKS = [8000, 20000, 45000, 90000];
    var MAIL_SLOW = 45000;          // from the send: the next answer that is not settled brings the slow line
    var MAIL_SLOW_AGAIN = 15000;    // after a cooldown answer: that email went out before it, up to a minute ago
    var MAIL_ASK_GIVE_UP = 7000;    // an ask that hangs must not hold the line back (the Worker answers inside ~5 s)
    var SLOW_LINE = 'It can take a few minutes to arrive. You can also continue with Google or Apple now.';
    var mailWatch = null;   // { email, ref, hasCode, state, slow, timer, t0, due, dueTimer, asking }: the one send this panel is about
    function stopMailWatch() {
      if (mailWatch) { if (mailWatch.timer) clearTimeout(mailWatch.timer); if (mailWatch.dueTimer) clearTimeout(mailWatch.dueTimer); }
      mailWatch = null;
    }
    function drawMailStatus(fresh) {
      var el = note.querySelector('.ll-mail-status'), lead = note.querySelector('.ll-sent-lead'), ask = note.querySelector('.ll-resend-ask');
      var w = mailWatch, st = w ? w.state : '';
      var html = st === 'undeliverable'
        ? 'We couldn’t get that email to <b>' + escHtml(w.email) + '</b>, so ' + (w.hasCode ? 'no code is on its way' : 'it won’t arrive') + '. Check the address, or continue with Google or Apple.'
        : st === 'delivered'
          ? 'It’s been delivered. If it isn’t in your inbox, have a look in Spam or Promotions.'
          : w && w.slow ? SLOW_LINE : '';
      if (lead) lead.style.display = st === 'undeliverable' ? 'none' : '';   // "check your inbox" is no longer true
      /* A resend to an address Resend could not reach is not sent either (a suppressed address stays
         suppressed), and each one spends a code from the address's hourly allowance. "Wrong email?" stays. */
      if (ask) ask.style.display = st === 'undeliverable' ? 'none' : '';
      if (!el) return;
      var put = function () { el.innerHTML = html; el.style.marginTop = html ? '7px' : '0'; if (html) inSight(st); };
      if (fresh && html) setTimeout(put, 150); else put();
    }
    /* Make a line that just got its words visible while she is in the code box (ABOVE THE KEYS). */
    function inSight(st) {
      var ci = codeForm.querySelector('input');
      if (st === 'undeliverable' && ci && document.activeElement === ci && !ci.value && keysHeight() >= 80) ci.blur();
      else fitAboveKeys();
    }
    /* The Worker already knows what became of the email (a cooldown answer carries its settled state): no
       asking, just say so. */
    function knownMail(email, state, hasCode) {
      stopMailWatch();
      mailWatch = { email: email, ref: '', hasCode: !!hasCode, state: state, slow: false, timer: null };
    }
    /* Nothing to ask with (no sendRef: an older Worker, Firebase's own sender, a cooldown answer): only the
       slow line can come, `after` milliseconds from now, unless something replaces this watch first. */
    function waitMail(email, hasCode, after) {
      stopMailWatch();
      var w = mailWatch = { email: email, ref: '', hasCode: !!hasCode, state: '', slow: false, timer: null };
      w.timer = setTimeout(function () {
        if (mailWatch !== w) return;
        w.timer = null;
        if (!row.isConnected) { stopMailWatch(); return; }
        w.slow = true; drawMailStatus();
      }, after);
    }
    function watchMail(email, ref, hasCode) {
      stopMailWatch();
      var w = mailWatch = { email: email, ref: ref, hasCode: !!hasCode, state: '', slow: false, timer: null, t0: Date.now(), due: false, dueTimer: null, asking: false }, i = 0;
      function ask() {
        w.timer = null;
        if (mailWatch !== w) return;
        /* This panel is no longer on screen: stop. That is also how a sign-in stops it, because every
           sign-in that changes who is signed in redraws the overlay (onAuthStateChanged -> showStatus),
           which takes this row with it. It used to stop on auth.currentUser as well, which no sign-in
           ever needed (round-6 mutant: removing it turned nothing red) and which silenced the whole
           watch for a parent who is already signed in and on this screen ("Could not load your data
           just now"), the one case where the panel stays up with someone signed in. */
        if (!row.isConnected) { stopMailWatch(); return; }
        i++;
        w.asking = true;
        var ac = typeof AbortController === 'function' ? new AbortController() : null;
        var giveUp = ac ? setTimeout(function () { ac.abort(); }, MAIL_ASK_GIVE_UP) : null;
        fetch('/api/signin-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: ref }), signal: ac ? ac.signal : undefined })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
          .then(function (d) {
            if (giveUp) clearTimeout(giveUp);
            w.asking = false;
            if (mailWatch !== w) return;
            var st = d && d.state;
            if (st === 'undeliverable' || st === 'delivered') { w.state = st; drawMailStatus(); return; }   // the due timer then does nothing
            if (!w.slow && (w.due || Date.now() - w.t0 >= MAIL_SLOW)) { w.slow = true; drawMailStatus(); }
            next();
          });
      }
      function next() {
        if (mailWatch !== w || i >= MAIL_CHECKS.length) return;
        w.timer = setTimeout(ask, MAIL_CHECKS[i] - (i ? MAIL_CHECKS[i - 1] : 0));
      }
      /* NO ANSWER YET, from the send (above). Never the line on its own here: an answer on its way brings
         it, and with none on its way the next ask goes now. */
      w.dueTimer = setTimeout(function () {
        w.dueTimer = null;
        if (mailWatch !== w || w.state) return;
        w.due = true;
        if (w.asking) return;
        if (w.timer) clearTimeout(w.timer);
        ask();
      }, MAIL_SLOW);
      next();
    }

    /* ---- the code path: the way in, everywhere ---- */
    var codeForm = row.querySelector('.ll-code-form');
    function sendCode(email) {
      signinTrack('email_code', 'started', 'succeeded');
      return fetch('/api/signin-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var er = new Error(d.error || 'send_failed'); er.retryAfter = Number(d.retryAfter) || 0; er.liveCode = d.liveCode === true; er.liveFor = Number(d.liveFor) || 0; throw er; } return d; }); })
        /* The code email carries the sign-in link too, and on this phone the link opens this app, which
           needs her address to finish it (maybeFinishEmailLink). Only sendLink kept it, so the link met a
           bare "Confirm your email" box every time (founder's simulator, 16 Nov 2026). Kept as sendLink
           keeps it, when the answer says that email has a link: hasLink, or cached (the email this exact
           address got in the last minute, which every client reads as code and link). */
        .then(function (d) { if (d && (d.hasLink === true || d.cached === true)) { try { localStorage.setItem('cubby-email-signin', email); } catch (e) {} } return d; });
    }
    /* How long codes are paused, in words. The worker's hourly ceilings say when a slot frees
       (retryAfter, seconds); a pause from the per-IP limiter carries none and lasts about a minute. */
    function pauseWords(secs) {
      var m = Math.round((Number(secs) || 0) / 60);
      if (m <= 1) return 'a minute or so';
      if (m >= 55) return 'about an hour';
      return 'about ' + m + ' minutes';
    }
    /* How much longer the code in her newest email works, in words. Rounded DOWN, so it never
       promises a minute the code does not have. */
    function liveWords(secs) {
      var m = Math.floor((Number(secs) || 0) / 60);
      if (m < 1) return 'under a minute';
      if (m === 1) return 'about a minute more';
      return 'about ' + m + ' more minutes';
    }
    /* The installed iPhone app: a link tapped in Mail opens Safari, whose storage is separate, so a
       link can never sign THIS app in. Copy that says "open the link" there is a dead end. */
    function inInstalledIOS() {
      try { return typeof isStandaloneApp === 'function' && isStandaloneApp() && typeof isIOSDevice === 'function' && isIOSDevice(); }
      catch (e) { return false; }
    }
    /* A code that did not work is said in its own line at the top of the note (skeptic M-S2). It used to
       replace the whole note, which wiped what the panel had learned about the email (an undeliverable note
       arriving after that had nowhere to go) and took Resend and "Wrong email?" with it, so an expired code
       left her nothing to tap but the box. */
    function codeError(m) {
      var el = note.querySelector('.ll-code-err');
      if (!el) { note.textContent = m; return; }
      el.textContent = m; el.style.marginBottom = m ? '6px' : '0';
      if (m) fitAboveKeys();   // she is in the box with the keys up: the error comes up with it (round 7)
    }
    /* Reveal the six-digit box and wire it. ONE implementation for one control: two copies of a
       sign-in submit is how the two routes drifted apart in the first place. */
    function showCodeBox(email) {
      codeForm.style.display = 'flex';
      var ci = codeForm.querySelector('input'); ci.value = '';
      codeForm.onsubmit = function (ev2) {
        ev2.preventDefault();
        var code = (ci.value || '').replace(/\D/g, '');
        if (code.length !== 6) { codeError('That code should be six digits.'); ci.focus(); return; }
        var cb = codeForm.querySelector('button');
        cb.disabled = true; cb.textContent = 'Signing in…';
        fetch('/api/signin-verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, code: code }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.token) { var er = new Error(d.error || 'bad_code'); er.retryAfter = Number(d.retryAfter) || 0; throw er; } return d; }); })
          /* The whole point: the session is created HERE, in this container, by this page. No
             navigation, no popup, no cross-origin handler, nothing for iOS to redirect elsewhere. */
          .then(function (d) { return auth.signInWithCustomToken(d.token); })
          .catch(function (err) {
            cb.disabled = false; cb.textContent = 'Sign in';
            signinTrack('email_code', 'verified', 'failed', err);
            var msg = err && err.message;
            /* rate_limited is a pause, not a failure, and "mind trying again?" over a pause that can
               last most of an hour sent her round in circles at 3am. Say it is paused, for how long,
               and that nothing is wrong. Usually it is somebody else's guesses, not hers. */
            /* A 429 WITHOUT retryAfter is the per-IP limiter counting this device's requests in the
               last minute, not the hourly ceiling on the address, and her code is still live. So it
               says so in device words, never "codes for this email are paused". */
            var m = msg === 'bad_code'
              ? 'That code did not match, or it has expired. Codes last 10 minutes and work once.'
              : msg === 'rate_limited'
                ? (err.retryAfter > 0
                  ? 'There have been a lot of tries for this email, so codes are paused for ' + pauseWords(err.retryAfter) + '. Nothing is wrong with your account. Try again then.'
                  : 'That was a lot of tries in a minute. Wait a moment, then type your code again.')
                : errText(err, 'Could not finish signing in just now. Mind trying again?');
            codeError(m); ci.select();
          });
      };
      return ci;
    }

    /* ONE panel for "the email is out", drawn from what the SENDER SAID IT CONTAINS — hasCode and
       hasLink come back from the worker with the send. Not from a guess about the browser, which is
       how a screen promising a code over a link-only email became possible in the first place. The
       code box is offered because there is a code in that inbox, full stop.
       The code leads. The link is mentioned second, and only when one was actually included. */
    function showEmailSent(email, res) {
      res = res || {};
      var hasCode = !!res.hasCode, hasLink = !!res.hasLink;
      if (res.cached) { hasCode = true; hasLink = true; }   // the earlier email came from this same sender
      /* No new email went out (new codes are paused for this address), but the code in her newest
         email still works: keep the box open and say so. Never a link here: in the installed app a
         link cannot sign this app in, and nothing new is in her inbox to tap anyway. */
      if (res.liveCode) { hasCode = true; hasLink = false; }
      form.style.display = 'none';
      var inApp = inInstalledIOS();
      var how = hasCode
        // No "below": the code box renders ABOVE this note (emailRowHtml puts the note last), and a
        // pointer that points the wrong way is worse than none.
        ? ' Type the 6-digit code from that email here.'
          + (hasLink && !inApp ? ' Or tap the link in it, if you are reading it on this device.' : '')
        /* No code in this email. Either codes are paused for this address (res.codesPaused, the hourly
           ceiling), or the code could not be stored. Say which, and never tell the installed iPhone
           app to open a link: it opens in Safari and cannot sign this app in. */
        : res.codesPaused
          ? ' Codes for this email are paused for ' + pauseWords(res.retryAfter) + ', after a lot of tries.'
            + (inApp ? ' The email has a link, which signs you in to Cubby in Safari. To sign in to this app, ask for a code again then.' : ' Tap the link in that email to sign in.')
          : (inApp ? ' It has a link, which opens Cubby in Safari rather than this app. To sign in here, ask again in a minute for a code.' : ' Open the link in it on this device.');
      var lead = res.liveCode
        ? 'New codes are paused for ' + pauseWords(res.retryAfter) + ', but the code in your most recent email still works for ' + liveWords(res.liveFor) + '. Type it here.'
        : sentLine(email, res.cached) + how;
      /* What became of the email. A sendRef is a new email to ask about. A cooldown answer that carries a
         settled state is the Worker saying what it already found (a reload, or a second panel, inside the
         minute). Any other answer for the same address with no sendRef sent no new email of ours (the
         cooldown, cached or not, or codes paused with her newest still live), so the email being asked about
         is still the one in question: keep asking, and keep saying what is known. Firebase's own sender
         (fallback) is a different email by a different road, and a different address is a different email. */
      if (res.sendRef && !res.liveCode) watchMail(email, String(res.sendRef), hasCode);
      else if (res.state === 'undeliverable' || res.state === 'delivered') knownMail(email, res.state, hasCode);
      else if (!(mailWatch && mailWatch.email === email && !res.fallback)) stopMailWatch();
      /* Nothing to ask about and nothing known (round 7, NO ANSWER YET): the slow line, in time. A cooldown
         answer (cached) is about an email that went out before it, so its wait is shorter. Not when codes are
         paused and her newest code still works: that email went long ago, and the lead says so. */
      if (!mailWatch && !res.liveCode) waitMail(email, hasCode, res.cached ? MAIL_SLOW_AGAIN : MAIL_SLOW);
      note.innerHTML = '<div class="ll-code-err" role="alert"></div>'
        + '<span class="ll-sent-lead">' + lead + '</span>'
        + '<div class="ll-mail-status" role="status" aria-live="polite" style="margin-top:0;color:var(--ink,#2C2521)"></div>'
        + '<div class="ll-resend-row" style="margin-top:8px"><span class="ll-resend-ask">Not arrived yet? <button type="button" class="ll-resend" style="' + LINKBTN + '">Resend email</button> &middot; </span><button type="button" class="ll-changeemail" style="' + LINKBTN + '">Wrong email?</button></div>';
      drawMailStatus(true);
      if (hasCode) showCodeBox(email).focus(); else codeForm.style.display = 'none';
      var rb = note.querySelector('.ll-resend');
      note.querySelector('.ll-changeemail').onclick = function () { codeForm.style.display = 'none'; input.value = email; openForm(); }; // fix a typo or use a different address
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      var left = 30; rb.disabled = true; rb.style.opacity = '.55'; rb.textContent = 'Resend in ' + left + 's';
      cdTimer = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(cdTimer); cdTimer = null; rb.disabled = false; rb.style.opacity = '1'; rb.textContent = 'Resend email'; }
        else rb.textContent = 'Resend in ' + left + 's';
      }, 1000);
      rb.onclick = function () {
        rb.disabled = true; rb.style.opacity = '.55'; rb.textContent = 'Sending…';
        sendEmail(email).then(function (d) { showEmailSent(email, d); }).catch(function (err) {
          var rr = note.querySelector('.ll-resend-row'); if (rr) rr.textContent = errText(err, 'Could not resend just now. Mind trying again?');
        });
      };
    }

    /* Ask for a code; fall back to the link sender only if the code sender is down.
       The fallback is not cosmetic. /api/signin-code REQUIRES a Firestore write (no stored code, no
       email), so making the code the only route would mean a Firestore blip locks every parent out of
       their own account. /api/send-signin-link needs only Identity Toolkit, and its email carries a
       code too whenever it can. Each answer states what it actually put in the inbox, so whichever
       one ran, the panel tells the truth. */
    function sendEmail(email) {
      return sendCode(email).catch(function (err) {
        /* New codes are paused, but her newest code still works: no fallback. The link sender would
           mail a link-only email the installed app cannot use, and send her to it for an hour. */
        if (err && err.message === 'rate_limited' && err.liveCode) return { liveCode: true, liveFor: err.liveFor, retryAfter: err.retryAfter };
        var paused = !!(err && err.message === 'rate_limited' && err.retryAfter > 0);
        return sendLink(email).then(function (d) {
          // The code endpoint's pause rides along, so the panel can say so instead of "open the link".
          return paused ? Object.assign({}, d, { codesPaused: true, retryAfter: err.retryAfter }) : d;
        });
      });
    }

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var email = input.value.trim();
      if (!looksLikeEmail(email)) { note.textContent = 'That email looks a bit off, mind checking it?'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      sendEmail(email)
        .then(function (d) { btn.disabled = false; btn.textContent = SEND_LABEL; showEmailSent(email, d); })
        .catch(function (err) { btn.disabled = false; btn.textContent = SEND_LABEL; note.textContent = errText(err, 'Could not send that just now. Mind trying again?'); });
    };
  }
  function maybeFinishEmailLink(notKept) {
    try {
      if (!auth.isSignInWithEmailLink(window.location.href)) return;
    } catch (e) { return; }
    var email = null, kept = false;
    if (!notKept) { try { email = localStorage.getItem('cubby-email-signin'); kept = !!email; } catch (e) {} }
    if (!email) email = window.prompt('Confirm your email to finish signing in');
    /* This used to `return` in silence. The key is missing whenever the link is opened in a DIFFERENT
       storage container from the one that asked for it — which on iOS is every time, because Mail opens
       Safari and the request was made in the home-screen app. So the person is shown a bare prompt with
       no context, dismisses it, and lands on a sign-in screen that says nothing at all. */
    /* As a note (window.LL.signInNote), not a message of the moment: this runs at boot, before the first
       auth answer, and that answer (signed out) redraws the screen with showSignIn(''), which wiped the
       line a moment after it appeared. She saw a plain sign-in screen (test/native-signin-link.test.js S1). */
    if (!email) { window.LL.signInNote('To finish signing in, we need the email address you asked for the link with.'); return; }
    auth.signInWithEmailLink(email.trim(), window.location.href)
      .then(function (res) {
        try { localStorage.removeItem('cubby-email-signin'); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        if (res && res.user && !res.user.displayName) {
          return res.user.updateProfile({ displayName: email.split('@')[0] });
        }
      })
      .catch(function (err) {
        var code = (err && err.code) || '';
        /* The address kept on this phone is not this link's: she asked for a code here for one address
           and opened a link asked for with another. Forgotten, and she is asked once, as if nothing had
           been kept; it used to end on "doesn't look right" with no box to fix it (test K). */
        if (kept && code === 'auth/invalid-email') {
          try { localStorage.removeItem('cubby-email-signin'); } catch (e) {}
          maybeFinishEmailLink(true);
          return;
        }
        signinTrack('email_link', 'verified', 'failed', err);
        /* A used or expired code never works, so it comes off the address, or every later load of this
           page (a join's reload, Try again) runs it again over whatever she is doing then (test X). */
        var dead = code === 'auth/invalid-action-code' || code === 'auth/expired-action-code';
        if (dead) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
        /* Who is signed in is known only from the first auth answer, which on a phone can come before or
           after this one. Signed in (a link she had already used, tapped again after iOS closed the app),
           she stays on her app with a short note; the sign-in screen used to come down over it and stay
           (test D). Signed out, the sign-in screen says what went wrong, drawn after that answer's own
           plain one, so it is not wiped. */
        var answered = false, off = auth.onAuthStateChanged(function (user) {
          if (answered) return; answered = true;
          if (off) off();
          if (user) {
            var said = dead ? 'That sign-in link was already used. You’re still signed in.' : 'That sign-in didn’t finish. You’re still signed in.';
            // Her app is still behind "Setting things up…" for a moment, and that cover hides toasts.
            (function note(tries) {
              if (document.getElementById('llAuthOv') && tries < 40) { setTimeout(function () { note(tries + 1); }, 250); return; }
              try { if (window.toast) window.toast(said, { ms: 4000 }); } catch (e) {}
            })(0);
            return;
          }
          showSignIn(errText(err, 'That sign-in didn’t finish. Send yourself a fresh link and try once more.'));
        });
        if (answered && off) off();
      });
  }

  /* What is left for her to do, said on the sign-in screen until someone signs in (Nov 2026). An account
     deletion that stops at the login signs her out (deleteAccount), and the sign-in screen covers the app's
     toasts, so app/index.html doDeleteAccount says it here instead (window.LL.signInNote). A message of the
     moment (a sign-in that failed) still comes first; the note is back on the next plain draw.
     tools/usage_tracker_check.js S23 reads it off the screen. */
  var signInNote = '';
  window.LL.signInNote = function (msg) {
    signInNote = String(msg || '');
    if (!auth.currentUser) showSignIn('');
  };
  function showSignIn(msg) {
    msg = msg || signInNote;
    try { if (window.cubbyTrackScreen) window.cubbyTrackScreen('signin'); } catch (e) {}
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
      '<div class="ll-auth-card"><img src="/icons/logo-512.png?v=09cba32f" alt="Cubby" class="ll-auth-logo-img">'
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
      '<div class="ll-auth-card ll-boot"><img src="/icons/logo-512.png?v=09cba32f" alt="Cubby" class="ll-auth-logo-img">'
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
  /* Account deletion asks for a recent sign-in BEFORE it deletes or leaves anything (Nov 2026). Firebase
     deletes a login only soon after a sign-in (about five minutes, auth/requires-recent-login), and says so
     only when the login itself is deleted, the LAST step of deleteAccount. By then she had left her family,
     her private records were gone and her usage purge was asked for, yet a sign-in sheet she closed there
     was reported as "Nothing was deleted". So the age of her sign-in is read first, by the server's clock
     alone (a token refreshed now carries the server's time beside the time she signed in), and when it is
     near the limit she is asked to sign in again before step 0. A cancel or an email-code session then
     really means nothing was deleted. If Firebase still asks at the end (the steps outran the minute left),
     deleteAccount says how far it got (deletionStage) and the app says only that.
     tools/usage_tracker_check.js S22 drives each path on the Firestore emulator. */
  var FRESH_SIGNIN_MS = 4 * 60 * 1000;   // a minute under Firebase's five, for the steps in between
  async function freshSignIn(u) {
    var t = await u.getIdTokenResult(true);
    var age = Date.parse(t && t.issuedAtTime) - Date.parse(t && t.authTime);
    if (age >= 0 && age < FRESH_SIGNIN_MS) return;
    await reauthenticate(u);
  }
  /* How far a deletion that stopped got, stamped on what it throws (app/index.html doDeleteAccount reads it):
     'nothing' (nothing deleted or left), 'partly' (some steps ran, the login and possibly the family remain),
     'login' (everything but the login itself is done). It is the furthest ANY attempt for this account got on
     this page, not only this one: after a stop at the login, a retry she cancels at the sign-in sheet deletes
     nothing more, but her private records and her place in the family went the first time, and "Nothing was
     deleted" would be untrue again (tools/usage_tracker_check.js S23). */
  var deletionReached = {};   // uid -> the furthest stage an attempt for that account reached on this page
  var STAGE_RANK = { nothing: 0, partly: 1, login: 2 };
  function deletionStage(e, stage, uid) {
    if (!e || typeof e !== 'object') e = new Error(String(e));
    if (uid) {
      var before = deletionReached[uid];
      if (before && STAGE_RANK[before] > STAGE_RANK[stage]) stage = before;
      deletionReached[uid] = stage;
    }
    try { if (!e.cubbyDeletion) e.cubbyDeletion = stage; } catch (x) {}
    return e;
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
    signinTrack('google', 'started', 'succeeded');
    if (nativeAuth()) { nativeSignIn('google').catch(function (err) { signinTrack('google', 'provider_returned', userCancelled(err) ? 'abandoned' : 'failed', err); nativeSignInFailed(err); }); return; }
    auth.signInWithPopup(window.LL.googleProvider).catch(function (err) {
      signinTrack('google', 'provider_returned', (err && err.code === 'auth/popup-closed-by-user') ? 'abandoned' : 'failed', err);
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
    signinTrack('apple', 'started', 'succeeded');
    if (nativeAuth()) { nativeSignIn('apple').catch(function (err) { signinTrack('apple', 'provider_returned', userCancelled(err) ? 'abandoned' : 'failed', err); nativeSignInFailed(err); }); return; }
    auth.signInWithPopup(window.LL.appleProvider).catch(function (err) {
      signinTrack('apple', 'provider_returned', (err && err.code === 'auth/popup-closed-by-user') ? 'abandoned' : 'failed', err);
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
    // The address kept for her sign-in link (sendCode, sendLink) goes with her: a shared phone keeps nothing of hers.
    try { localStorage.removeItem('cubby-email-signin'); } catch (e) {}
  };

  function teardown() {
    if (hhRef) leaveFamily(); // before anything below forgets what this phone still owed the family
    syncUid = null;
    // Sign-out flushed and waited for the push; nothing of this person's is left in the outbox.
    if (auth.currentUser && hhRef) dropOutbox(auth.currentUser.uid, hhRef.id);
    /* The usage tracker (app/cubby-track.js). A deletion that stopped after her usage rows were asked to go
       left it silent until she is signed out (deleteAccount's catch signs her out itself); signing out ends
       that, so whoever signs in next on this page, her included, is tracked as anyone is. A deletion still
       running, or one that finished (its sign-out lands here too), keeps it silent until the page reloads.
       And whose family record has been seen from the server is forgotten: the next account waits for its own
       (startSync). */
    if (!deletingAccount) window.__cubbyDeleting = false;
    householdSeen('');
    unackedEv = {}; blobOut = 0; replayEv = null; replayHold = null;
    unsub.forEach(function (u) { try { u(); } catch (e) {} });
    matUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    pregUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    unsub = []; matUnsub = []; pregUnsub = []; booted = false; knownEvents = {}; serverAuthor = {};
    _lastInviteEmail = ''; // per-uid cache: never let one account's invite email survive into the next
    matOwner = null; matShared = {}; knownMat = {};
    pregOwner = null; pregShared = []; knownPregJourney = null; knownPrecon = null; legacyBlobPreg = null; pregMigrated = false;
    if (pregPhotoUnsubOwn) { try { pregPhotoUnsubOwn(); } catch (e) {} pregPhotoUnsubOwn = null; }
    if (pregPhotoUnsubOther) { try { pregPhotoUnsubOther(); } catch (e) {} pregPhotoUnsubOther = null; }
    pregPhotoOtherOwner = null; circlePhotoIds = {}; pregBytesMigrating = false;
    ownPregPhotoIds = {}; otherPregPhotoIds = {};
    PhotoStore.privIds = {}; PhotoStore.map = {}; // one account's photo bytes never survive into the next session
    if (memberEmailsUnsub) { try { memberEmailsUnsub(); } catch (e) {} memberEmailsUnsub = null; }
    // Lane B, D1: one account's link tokens never survive into the next session.
    if (ownerLinksUnsub) { try { ownerLinksUnsub(); } catch (e) {} ownerLinksUnsub = null; }
    window.LL.ownerLinks = {}; ownerLinksLoaded = false; ownerLinksDenied = false; ownerLinksDeniedAt = 0; ownerLinksTidiedOnce = false; ownerLinksRows = {};
    ownerLinksMembers = []; ownerLinksTidySig = '';
    // Config is the same for everyone, so its last value stays applied; only the listener goes.
    if (configUnsub) { try { configUnsub(); } catch (e) {} configUnsub = null; }
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

  /* ---------- remote config (config/app) ----------
     Read-only for every client (firestore.rules); written only by an operator with the admin key.
     Kept out of the boot path on purpose: it is never part of maybeBoot's condition, never writes,
     and never touches state, so a slow, denied or missing document can only ever leave the app on the
     defaults compiled into index.html. A denied read is the normal case until the rules that allow it
     are deployed (they ship separately from a push). */
  function ensureConfigListener() {
    if (configUnsub || !db || typeof window.cubbyApplyConfig !== 'function') return;
    try {
      configUnsub = db.collection('config').doc('app').onSnapshot(function (doc) {
        window.cubbyApplyConfig(doc.exists ? doc.data() : null);
        if (booted) rerender();
      }, function (e) { /* denied, offline or missing: the defaults stand */ });
    } catch (e) { configUnsub = null; }
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

  /* LINK ROWS, the owner's side (lane B, D1). Only an owner can read the tokens, so only her device
     keeps window.LL.ownerLinks live (Send again, Cancel and Remove need a token without waiting for
     the network) and only her device tidies the list. Called from every household snapshot:
     attaches once, and lets go when she stops being an owner.
     Refused (the rules published before ownerLinks existed) is not for the whole session: Cubby can
     stay open for days across the new rules being published. A later household snapshot tries
     again, at most once every OWNER_LINKS_RETRY_MS, and a link minted the new way re-attaches at
     once (createInviteLink). */
  var ownerLinksLoaded = false, ownerLinksTidyBusy = false, ownerLinksTidiedOnce = false, ownerLinksRows = {};
  var ownerLinksMembers = [], ownerLinksTidySig = '', ownerLinksDeniedAt = 0, OWNER_LINKS_RETRY_MS = 20000;
  function watchOwnerLinks(d) {
    var owner = (window.LL.role || '') === 'owner';
    if (owner) { ownerLinksRows = (d && d.pendingLinks) || {}; ownerLinksMembers = Object.keys((d && d.members) || {}); }
    if (owner && ownerLinksDenied && !ownerLinksUnsub && Date.now() - ownerLinksDeniedAt >= OWNER_LINKS_RETRY_MS) ownerLinksDenied = false;
    if (owner && !ownerLinksUnsub && !ownerLinksDenied && hhRef) {
      var mine = hhRef.collection('ownerLinks').onSnapshot(function (s) {
        var m = {};
        s.forEach(function (dd) { m[dd.id] = dd.data() || {}; });
        window.LL.ownerLinks = m;
        ownerLinksLoaded = true;
        maybeTidyOwnerLinks();
      }, function (e) {
        // Rules published before ownerLinks existed: links are made the old way until a retry gets in.
        if (e && e.code === 'permission-denied') { ownerLinksDenied = true; ownerLinksDeniedAt = Date.now(); }
        if (ownerLinksUnsub === mine) { ownerLinksUnsub = null; ownerLinksLoaded = false; window.LL.ownerLinks = {}; }
      });
      ownerLinksUnsub = mine;
    } else if (!owner && ownerLinksUnsub) {
      try { ownerLinksUnsub(); } catch (e) {}
      ownerLinksUnsub = null; ownerLinksLoaded = false; window.LL.ownerLinks = {};
    }
    if (owner) maybeTidyOwnerLinks();
  }
  // What the tidy last judged: who is in the family, and which rows are on the list. A join by an
  // older build (which clears a token key a row-id row does not have) changes the first; a used,
  // cancelled or newly minted link changes the second.
  function ownerLinksSig() {
    return ownerLinksMembers.slice().sort().join(',') + '|' + Object.keys(ownerLinksRows || {}).sort().join(',');
  }
  /* Three things only the owner's device can put right, all in one transaction so they are judged on
     what the server holds, never on two listeners that have not caught up with each other:
     1. a row still keyed by its token (written before this change, or by an older build) moves to a
        row id: the token doc, the link learning its row id, and the row itself, in one write;
     2. a row whose link has been used or deleted goes (an older build's join clears the token key,
        which a row-id row does not have);
     3. a token doc with no row goes, and if its link is still live the link goes too: an older build
        cancelled that row, or removed someone, and meant the link to stop working.
     Expired links that nobody used stay, so the list can still say "Link expired".
     It runs once per session, then again whenever there is an old-shape row or an orphan copy, or
     the members or the rows have changed since it last ran (ownerLinksSig): an older build's join
     uses a link without clearing its row, and the row would otherwise say "Link waiting" until a
     relaunch. A change that lands while it runs is judged straight after. */
  function maybeTidyOwnerLinks() {
    if (ownerLinksTidyBusy || !ownerLinksLoaded || ownerLinksDenied || deletingAccount || !hhRef) return;
    if ((window.LL.role || '') !== 'owner') return;
    var rows = ownerLinksRows || {}, ol = window.LL.ownerLinks || {};
    var legacy = Object.keys(rows).some(function (k) { return !isLinkRowId(k); });
    var orphan = Object.keys(ol).some(function (k) { return !Object.prototype.hasOwnProperty.call(rows, k); });
    var sig = ownerLinksSig();
    if (!Object.keys(rows).length && !Object.keys(ol).length) { ownerLinksTidiedOnce = true; ownerLinksTidySig = sig; return; }   // no links at all: nothing to read
    if (ownerLinksTidiedOnce && !legacy && !orphan && sig === ownerLinksTidySig) return;
    ownerLinksTidyBusy = true;
    var ref = hhRef;
    setTimeout(function () {
      tidyOwnerLinks(ref).then(function () {
        ownerLinksTidiedOnce = true; ownerLinksTidySig = sig; ownerLinksTidyBusy = false;
        if (ref === hhRef && ownerLinksSig() !== sig) maybeTidyOwnerLinks();
      }, function (e) { console.warn('tidy links', e && e.code); ownerLinksTidyBusy = false; });
    }, 1200);
  }
  function tidyOwnerLinks(ref) {
    if (!ref || ref !== hhRef || deletingAccount) return Promise.resolve();
    var FP = firebase.firestore.FieldPath, DEL = firebase.firestore.FieldValue.delete();
    var known = Object.keys(window.LL.ownerLinks || {});
    return db.runTransaction(async function (tx) {
      var hs = await tx.get(ref);
      if (!hs.exists) return;
      var rows = (hs.data() || {}).pendingLinks || {};
      var has = function (k) { return Object.prototype.hasOwnProperty.call(rows, k); };
      var ids = Object.keys(rows).filter(isLinkRowId);
      known.forEach(function (k) { if (ids.indexOf(k) < 0) ids.push(k); });
      // Every read before any write, as a transaction requires.
      var docs = {}, i;
      for (i = 0; i < ids.length; i++) {
        var os = await tx.get(ref.collection('ownerLinks').doc(ids[i]));
        if (os.exists) docs[ids[i]] = os.data() || {};
      }
      var tokens = {};
      Object.keys(rows).forEach(function (k) { if (!isLinkRowId(k)) tokens[k] = k; });
      Object.keys(docs).forEach(function (k) { if (typeof docs[k].token === 'string' && docs[k].token) tokens[k] = docs[k].token; });
      var keys = Object.keys(tokens), links = {};
      for (i = 0; i < keys.length; i++) {
        var ls = await tx.get(db.collection('inviteLinks').doc(tokens[keys[i]]));
        links[keys[i]] = ls.exists ? (ls.data() || {}) : null;
      }
      var hhArgs = [];
      keys.forEach(function (k) {
        var l = links[k];
        var live = !!l && !(l.usedBy || l.consumed) && l.householdId === ref.id;
        if (!isLinkRowId(k)) {
          if (!live) { hhArgs.push(new FP('pendingLinks', k), DEL); return; }
          var nid = newLinkRowId(), r = rows[k] || {};
          tx.set(ref.collection('ownerLinks').doc(nid), { token: k, at: r.at || Date.now(), expiresAt: r.expiresAt || 0 });
          tx.update(db.collection('inviteLinks').doc(k), { rowId: nid });
          hhArgs.push(new FP('pendingLinks', k), DEL, new FP('pendingLinks', nid), r);
        } else if (has(k)) {
          if (!live) { hhArgs.push(new FP('pendingLinks', k), DEL); tx.delete(ref.collection('ownerLinks').doc(k)); }
        } else {
          if (live) tx.delete(db.collection('inviteLinks').doc(tokens[k]));
          tx.delete(ref.collection('ownerLinks').doc(k));
        }
      });
      // Field paths, never the whole map: a row someone else adds meanwhile is left as it is.
      if (hhArgs.length) { var txUpdate = tx.update; txUpdate.apply(tx, [ref].concat(hhArgs)); }
    });
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

  /* The shared blob a brand-new family is given from this phone's own record (little-log-v1). One definition,
     read by the migration and by letGoOfRecord below, so the two can never disagree about what was copied. */
  function appFromRecord(s) {
    return {
      babies: s.babies || [], settings: sharedSettings(s.settings),
      milestones: s.milestones || [], meds: s.meds || [],
      vaccines: s.vaccines || {}, illnesses: s.illnesses || [],
      photos: s.photos || []
    };
  }
  async function buildMigrationPayload() {
    var app = { babies: [], settings: sharedSettings(), milestones: [], meds: [], vaccines: {}, illnesses: [], photos: [] };
    var events = [], photos = {};
    try {
      var raw = localStorage.getItem(LOCAL_RECORD);
      if (raw) {
        var s = JSON.parse(raw);
        if (s) {
          app = appFromRecord(s);
          events = s.events || [];
        }
      }
      var praw = localStorage.getItem(LOCAL_PHOTOS);
      if (praw) photos = JSON.parse(praw) || {};
    } catch (e) {}
    return { app: app, events: events, photos: photos };
  }

  /* ---------- this phone's own record, let go of once a family holds it ----------
     While no family is attached, persist() keeps the whole state in this phone's own record (little-log-v1,
     Store.save in app/index.html), beside a pre-Firebase build's photo bytes (little-log-photos-v1), and the
     first sign-in that makes a family copies both into it (buildMigrationPayload). Nothing let go of them after
     that copy, so the next account with no family to sign in on this phone was given the same babies, entries
     and photos, and its screen showed them (docs/postmortems/2026-11-19-pre-sign-in-data-reaches-next-account.md).
     So whatever a family holds leaves the record: entries and babies by id, photos by id, and each copied part
     of the shared blob while it still equals what that family was given. Anything a family does not hold stays,
     so nothing that has not reached the server is lost from the phone; with nothing left, the key goes. The
     record keeps its format, so an older build on this phone reads what is left as it always did.
     held: { events: {id: true}, babies: {id: true}, photos: {id: true}, blob: {part: stableStringify} or 'whole' }.
     'whole' (a family already on this phone, letGoOfHeldHere) lets the copied parts go only when the record is
     entirely that family's: every entry and baby in it is held there, and it has at least one. */
  var LOCAL_RECORD = 'little-log-v1', LOCAL_PHOTOS = 'little-log-photos-v1';
  var RECORD_PARTS = ['settings', 'milestones', 'meds', 'vaccines', 'illnesses', 'photos'];
  function emptyish(v) { return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length); }
  function letGoOfRecord(held) {
    try {
      var raw = localStorage.getItem(LOCAL_RECORD), s = raw ? JSON.parse(raw) : null;
      if (s && typeof s === 'object') {
        var evs = Array.isArray(s.events) ? s.events : [], bbs = Array.isArray(s.babies) ? s.babies : [];
        var isHeldEv = function (e) { return !!(e && held.events[String(e.id)]); };
        var isHeldBaby = function (b) { return !!(b && held.babies[b.id]); };
        var whole = held.blob === 'whole' && (evs.length + bbs.length) > 0 && evs.every(isHeldEv) && bbs.every(isHeldBaby);
        var app = appFromRecord(s);
        RECORD_PARTS.forEach(function (k) {
          if (!(k in s)) return;
          if (whole || (held.blob && held.blob !== 'whole' && stableStringify(app[k]) === held.blob[k])) delete s[k];
        });
        if (Array.isArray(s.events)) s.events = evs.filter(function (e) { return !isHeldEv(e); });
        if (Array.isArray(s.babies)) s.babies = bbs.filter(function (b) { return !isHeldBaby(b); });
        if (s.activeBabyId && held.babies[s.activeBabyId]) delete s.activeBabyId;
        if (s.timers && typeof s.timers === 'object') Object.keys(held.babies).forEach(function (id) { if (emptyish(s.timers[id])) delete s.timers[id]; });
        if (Object.keys(s).every(function (k) { return emptyish(s[k]); })) localStorage.removeItem(LOCAL_RECORD);
        else localStorage.setItem(LOCAL_RECORD, JSON.stringify(s));
      }
      var praw = localStorage.getItem(LOCAL_PHOTOS), p = praw ? JSON.parse(praw) : null;
      if (p && typeof p === 'object') {
        Object.keys(p).forEach(function (k) { if (held.photos[k]) delete p[k]; });
        if (!Object.keys(p).length) localStorage.removeItem(LOCAL_PHOTOS); else localStorage.setItem(LOCAL_PHOTOS, JSON.stringify(p));
      }
    } catch (e) {}
  }
  // What a brand-new family was just given (resolveHousehold): every write of it acknowledged by the server.
  function heldFromMigration(m) {
    var held = { events: {}, babies: {}, photos: {}, blob: {} };
    m.events.forEach(function (e) { if (e) held.events[String(e.id)] = true; });
    (m.app.babies || []).forEach(function (b) { if (b && b.id) held.babies[b.id] = true; });
    Object.keys(m.photos).forEach(function (k) { held.photos[k] = true; });
    RECORD_PARTS.forEach(function (k) { held.blob[k] = stableStringify(m.app[k]); });
    return held;
  }
  /* What the family on this phone holds, once its whole history has been read (hydrateFullHistory). This is
     how a record an older build copied and kept is let go: the next time its owner opens this build. */
  function letGoOfHeldHere() {
    var held = { events: {}, babies: {}, photos: {}, blob: 'whole' };
    Object.keys(knownEvents).forEach(function (id) { held.events[String(id)] = true; });
    (state.babies || []).forEach(function (b) { if (b && b.id) held.babies[b.id] = true; });
    Object.keys(circlePhotoIds).forEach(function (id) { held.photos[id] = true; });
    letGoOfRecord(held);
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
          // Every family that has invited her, one offer each, most recent first (readInviteOffers).
          // The one into the family she is already in is not an offer.
          var offers0 = (await readInviteOffers(em0, pend)).filter(function (o) { return o.householdId !== curHid; });
          if (offers0.length) {
            window.LL.pendingInvite = offers0[0];
            window.LL.pendingInviteQueue = offers0.slice(1);
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
    var declinedInvite = false;
    if (email) {
      /* GUARDED, and the existing-user branch above has been guarded all along — this one never was.
         An unguarded read here is the whole app: onAuthStateChanged catches the throw and calls
         showSignIn(), which puts a parent WITH A LIVE SESSION back on the landing. She cannot repair
         that; she will decide sign-in failed and try again.
         No known bug requires this. It was added while chasing a strand that turned out to be two
         agent sessions sharing one browser profile, and the mechanism proposed at the time (a custom
         token arriving without its email claim) was measured and does not exist. It stays because it
         costs nothing on the happy path and removes a way for one refused read to lock someone out,
         not because anything is known to refuse it.
         Falling through cannot put anyone in the WRONG family: the join-token and join-intent
         branches below still show the mismatch screen. Worst case is a directly-invited parent
         starting her own Cubby, which her invite still sitting there can repair. */
      var inv = null;
      try {
        inv = await db.collection('invites').doc(email).get();
      } catch (e) {
        // One retry on a genuinely fresh token, in case the refusal is anything token-shaped.
        try { await user.getIdToken(true); inv = await db.collection('invites').doc(email).get(); }
        catch (e2) { console.warn('invite lookup refused twice; continuing without it', e2 && e2.code); inv = null; }
      }
      /* Every family that has invited her: the address-keyed invite and each family's own
         (invites/{email}/from/{hid}), one offer per family, most recent first. More than one, and
         she is asked about each in turn on the same sheet; "Not this one" throws that one away and
         moves on to the next. */
      var offers = await readInviteOffers(email, inv);
      /* At most NEWCOMER_ASKS of them stand between her and a Cubby of her own. Anyone with an account
         can make households and invite any address from each, so with no limit a stranger could hold a
         newcomer at the door with one question after another. The rest wait in the pending list and are
         offered once she is in, where "Not now" lets her past each one. */
      var asked = offers.slice(0, NEWCOMER_ASKS), later = offers.slice(NEWCOMER_ASKS);
      for (var oi = 0; oi < asked.length; oi++) {
        var data = asked[oi];
        var moreOffers = oi < asked.length - 1;
        /* ASK FIRST, the way an existing user has always been asked (maybePromptPendingInvite).
           Anyone with an account can write an invite for any address, so joining here without a
           word let a stranger pull a new parent into the stranger's family, where everything she
           logged was theirs to read. One tap, naming who invited her. */
        var answer = await askNewcomerToJoin(data, { more: moreOffers });
        if (answer === true) {
          /* Refused AFTER she said yes: the owner withdrew the invite while she read the sheet, or
             the family has since closed (the rules never let anyone join a household flagged for
             deletion). Thrown on, that reached onAuthStateChanged and put a signed-in parent on the
             sign-in landing under "Cubby wasn't allowed to save that". Nothing was written, so say
             what happened and let her start her own. The dead invite is hers to throw away, so it
             is not offered again; another family's invite is not touched. */
          var joinLanded = watchJoinWait(); // offline, the loader gives way to the connectivity card
          try {
            await joinByEmailInvite(user, data);
          } catch (je) {
            joinLanded();
            if (!je || je.code !== 'permission-denied') throw je;
            console.warn('join refused after consent', je.code);
            await Promise.race([declineOffer(email, data), new Promise(function (r) { setTimeout(r, 3000); })]);
            if (moreOffers || later.length) {
              try { if (window.toast) window.toast('That invite is no longer open.'); } catch (e) {}
              // The last she is asked about here: her own Cubby next, with the rest still waiting.
              if (!moreOffers) declinedInvite = true;
              continue;
            }
            showInviteMismatch(email, 'gone');
            return null;
          }
          writeOwnMemberEmail(data.householdId); // PRIV-2: email goes to the gated doc, not memberInfo
          try {
            await userRef.set({ householdId: data.householdId, name: user.displayName || '', email: user.email || '' }, { merge: true });
          } finally { joinLanded(); }
          // Remember that this session is a JOIN, not a return, so the first-run screen can say whose
          // circle they have walked into. Read once by openFirstRun and never persisted.
          window.LL.justJoined = { invitedBy: data.invitedBy || null, role: data.role || 'caregiver' };
          try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
          clearInviteMismatch(); // a corrected address joined for real: never leave the mismatch screen on top
          return data.householdId;
        }
        if (answer === false) {
          // She said no. The invite is hers to throw away (rules allow deleting the one addressed to
          // you), and the join intent goes with it, so she lands in her own new Cubby rather than on
          // a "we could not find your invite" screen.
          // Not awaited: on a bad connection she should not wait on it. If it never lands, the
          // invite is simply offered again later, the way it is to anyone with a Cubby.
          // Only THIS family's invite goes; the next family's is asked about next.
          declineOffer(email, data);
          try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
          declinedInvite = true;
          continue;
        }
        // Could not ask (no sheet on this screen). Never join silently: she gets her own Cubby,
        // and the invites are offered after boot, as they are to anyone who already has one.
        window.LL.pendingInvite = data;
        window.LL.pendingInviteQueue = offers.slice(oi + 1);
        declinedInvite = true;
        break;
      }
      // Not asked yet: offered after boot, as they are to anyone who already has a Cubby. Not thrown
      // away either; only her own "no" ever deletes an invite.
      if (later.length && !window.LL.pendingInvite) {
        window.LL.pendingInvite = later[0];
        window.LL.pendingInviteQueue = later.slice(1);
        declinedInvite = true;
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
    if (tok && !declinedInvite) { showInviteMismatch(email || '', true); return null; }
    if (joinIntent() && email && !declinedInvite) {
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
    m.events.forEach(function (ev) { writes.push(newRef.collection('events').doc(String(ev.id)).set(Object.assign({}, ev, { authorId: (ev.authorId && ev.authorId !== 'local') ? ev.authorId : user.uid }))); });
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
    // The family is hers now and the server holds all of it: the phone's record lets go of what was copied.
    letGoOfRecord(heldFromMigration(m));
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
    ing().blob(app); // ids and colours another member wrote, made safe before they reach state
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
    legacyBlobPresent = LEGACY_BLOB_KEYS.filter(function (k) { return Object.prototype.hasOwnProperty.call(app, k); });
    state.den = app.den || null;
    state.consents = app.consents || [];
    state.guardians = app.guardians || null;
    /* Timers take the server's value like every other key. A timer this phone started and has not
       pushed yet is kept by the general rule in the snapshot handler (holdPendingBlobEdits), which
       also lets the OTHER phone's timer through when this one did not touch timers. The old special
       case here kept local timers whenever ANY push was pending, so a caregiver who had just added a
       medicine never saw the nap the owner started. */
    state.timers = app.timers || {};
    state.journey = app.journey || null;
    state.lossHolding = app.lossHolding || null;
    normalizeLoadedState(state); // defensive legacy migrations
  }
  function noteServerAuthor(id, data) { if (data && data.authorId) serverAuthor[id] = data.authorId; }
  /* The authorId to write for an event: the author the server already holds for it wins, then a real author
     stored on the entry, then the writer. The server's author comes first because the rules make authorId
     immutable on update, so an owner's edit of a caregiver's entry, or an edit from a copy that lost the field,
     must not put the editor's uid there. 'local' (stamped while nobody was signed in: importCommit,
     setBirthWeight via myUid()) is not a real author, so an entry carrying it is the writer's now. A stored
     author that is another account's uid is kept, and the rules refuse that create (authorId must be the
     writer's on create), as they did before 'local' was handled here. */
  function authorToWrite(id, ev, uidNow) {
    if (serverAuthor[id]) return serverAuthor[id];
    return (ev.authorId && ev.authorId !== 'local') ? ev.authorId : uidNow;
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

  /* ---------- a household snapshot that lands while this phone still owes the cloud an edit ----------
     THE LOST UPDATE (review R1, 2026-11-12). A snapshot used to overwrite every app.* key with the
     server's copy and then re-baseline, so an edit still waiting in the 350 ms push debounce (or for a
     retry) vanished from the screen AND from the push: pushNow found nothing dirty. Her own memberInfo
     write in the same tick was enough to lose a new medicine. So, while a push is pending, every key
     whose local copy differs from its baseline is a pending local edit: it is held across the snapshot,
     merged with it (below), and then takes the SERVER's copy as its new baseline. What the merge adds
     on top of the server's copy therefore stays dirty, and pushNow still writes it.
     The baseline has to move to the server's copy, not stay where it was. A second snapshot can land
     inside the same pending window (edits under 350 ms apart keep re-arming the debounce, and a retry
     waits 8 s to 5 min). Merged against a stale baseline, a record the other phone changed twice looked
     changed on BOTH sides, so this phone's copy of its first version won and was pushed over its second,
     and a record the other phone added and then deleted looked added here and came back (review A-V1).
     Holding a whole key would only move the loss to the other phone when both touched it inside the
     window, so a held key is merged three ways instead: base = what we last knew the server held,
     local = this phone, remote = the snapshot. Lists of records with ids (medicines, milestones,
     illnesses, babies, photos, consents, and any other) merge record by record: a record added or
     changed on one side only is kept, one deleted on one side and untouched on the other is deleted,
     and when both changed the same record this phone's edit wins, whole. Every other key (settings,
     the vaccines map, den, journey, timers...) keeps this phone's value wherever this phone changed
     it, and takes the other phone's change where only the other phone changed something. That last
     part is not a nicety: render code adds empty entries without a save (timersFor makes
     timers[baby] = {} on read), so "keep the whole local key" made a caregiver who had just added a
     medicine push her empty timers back over the nap the owner had started. Per-device settings
     (theme, push) stay exactly as applyAppBlob leaves them.
     WHAT THIS DOES NOT FIX, said plainly. Each push writes whole keys (app.meds is the entire list), and
     the merge above only runs on a snapshot this phone RECEIVES while its push waits.
     1. A phone that is offline, for any length of time, receives nothing. Its queued write lands when it
        reconnects and replaces the whole key, so every edit another phone made to that key meanwhile
        (a medicine added, a dose corrected) is lost on every phone. Last writer wins, as before this fix.
        The same happens when two pushes of one key cross on the wire. The fix is a separate lane: push
        the blob in a transaction that reads the server's copy and runs this same merge before writing
        (transactions do not run offline, so the edit stays dirty and merges on reconnect), or give
        medicines, milestones and illnesses a document each.
     2. An edit the rules REFUSE is reverted from this phone and never retried (see pushNow). */
  function idListOf(v) {
    if (!Array.isArray(v)) return null;
    var byId = {}, keyOrder = [];
    for (var i = 0; i < v.length; i++) {
      var it = v[i];
      if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
      var id = it.id;
      if (!((typeof id === 'string' && id) || (typeof id === 'number' && isFinite(id)))) return null;
      var key = typeof id + ':' + id;
      if (byId[key]) return null; // two records share an id: there is no safe identity to merge on
      byId[key] = it; keyOrder.push(key);
    }
    return { byId: byId, keyOrder: keyOrder };
  }
  function ser3(x) { return x === undefined ? '' : stableStringify(x); }
  // null when any side is not a list of records with unique ids (the caller then keeps the local value).
  function mergeIdList(base, local, remote) {
    var B = idListOf(base), L = idListOf(local), R = idListOf(remote);
    if (!B || !L || !R) return null;
    function pick(key) {
      var b = ser3(B.byId[key]);
      if (ser3(L.byId[key]) === b) return R.byId[key]; // untouched here: the other phone's version, or its delete
      if (ser3(R.byId[key]) === b) return L.byId[key]; // untouched there: ours, or our delete
      return L.byId[key];                              // both changed it: this phone's edit wins
    }
    var out = [], seen = {};
    // The server's order first, then what only this phone has, in this phone's order.
    R.keyOrder.concat(L.keyOrder).forEach(function (key) {
      if (seen[key]) return; seen[key] = 1;
      var v = pick(key);
      if (v !== undefined) out.push(v);
    });
    return out;
  }
  function plainObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // Three-way merge of one value. undefined means absent (a delete, or never there).
  function mergeBlobValue(base, local, remote, depth) {
    var b = ser3(base), l = ser3(local), r = ser3(remote);
    if (l === b) return remote;           // untouched here: theirs, or their delete
    if (r === b || r === l) return local; // untouched there, or the same change on both
    depth = depth || 0;
    if (depth > 12) return local;
    if (Array.isArray(local) && Array.isArray(remote)) return mergeIdList(Array.isArray(base) ? base : [], local, remote) || local;
    if (plainObj(local) && plainObj(remote)) {
      var bo = plainObj(base) ? base : {}, out = {}, seen = {};
      Object.keys(local).concat(Object.keys(remote)).forEach(function (k) {
        if (seen[k]) return; seen[k] = 1;
        var v = mergeBlobValue(bo[k], local[k], remote[k], depth + 1);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    return local; // both changed something that cannot be merged: this phone's edit wins
  }
  // Before the snapshot is applied: the keys this phone has edited and not yet pushed.
  function holdPendingBlobEdits() {
    if (!blobBase || !(pushTimer || pushWhenHydrated)) return null;
    var cur = appBlobFromState(), held = null;
    Object.keys(cur).forEach(function (k) {
      if (blobBase[k] === stableStringify(cur[k])) return;
      (held = held || {})[k] = { base: blobBase[k], local: state[k], blobValue: cur[k] };
    });
    return held;
  }
  // After it is applied: put the held edits back, merged with what the snapshot brought. Returns the
  // baseline for each held key: the server's copy as this snapshot has it. Whatever the merge keeps on
  // top of that copy stays dirty, so the pending push writes it, and a later snapshot in the same
  // window is merged against what the server really held, never against what it held before this one.
  function reapplyPendingBlobEdits(held) {
    var remote = appBlobFromState(), kept = {};
    Object.keys(held).forEach(function (k) {
      var h = held[k], remoteSer = stableStringify(remote[k]);
      kept[k] = remoteSer; // the server's copy, now (review A-V1: the old baseline here reverted later edits)
      if (remoteSer === h.base) { state[k] = h.local; return; } // the server did not move it: ours stands as it was
      var base; try { base = JSON.parse(h.base); } catch (e) { base = undefined; }
      var merged = mergeBlobValue(base, h.blobValue, remote[k]);
      if (k === 'settings') { // the per-device fields stay exactly as applyAppBlob left them
        var dev = state.settings || {};
        merged = Object.assign({}, merged);
        ['theme', 'push', 'seen'].forEach(function (f) { if (dev[f] !== undefined) merged[f] = dev[f]; });
      }
      state[k] = merged;
    });
    return kept;
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
    /* She writes these and her partner's phone draws them, so they get the journey's checks
       (numbers stay numbers, units on their list, lists stay lists). And a doc sets only the keys
       its own category owns: a health doc can never rewrite the visits, the stage, or who owns the
       pregnancy. An older index.html without mat() passes them through as before. */
    var I = ing(), data = ('mat' in I ? I : PASS).mat(d.data || {});
    var own = {};
    MAT_CATS[cat].forEach(function (k) { if (data[k] !== undefined) own[k] = data[k]; });
    knownMat[cat] = stableStringify([own, matShared[cat]]); // don't immediately re-write what we just received
    if (!state.pregnancy) state.pregnancy = {};
    Object.keys(own).forEach(function (k) { state.pregnancy[k] = own[k]; });
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
  /* THE BUG THIS GUARDS AGAINST, because it destroyed real data and the shape of it is not obvious.
     A parent ticked an antenatal appointment. It appeared, then un-ticked itself about a second later,
     and her journey doc ended up with SEVEN appointments and zero ticks — `at` null on every row, so
     not one tap had ever been saved. She was tapping the same boxes over and over.

     Two lines conspired. This function used to overwrite every field from the snapshot, including the
     whole `appts` array, AND set knownPregJourney to the server's signature. syncPregJourney then
     refuses to write when `knownPregJourney === sig` — an echo guard, and a correct one. But once the
     snapshot had erased the local tick, the local signature MATCHED the server's, so the guard
     concluded there was nothing to send. The edit was wiped from memory and its write cancelled in the
     same breath. Any other household activity produces a snapshot, so this fired constantly.

     So: if this device is holding an edit it has not managed to save, keep our appts and do NOT adopt
     the incoming signature — the pending write has to stay pending. Other fields still take the remote
     value, so this stays a narrow rule rather than "ignore the server when we feel like it". */
  function applyPregJourney(owner, d) {
    if (!d) return;
    pregShared = d.sharedWith || [];
    var data = ing().blob(d.data || {}); // a partner writes data.precon here, so it is ingested like the blob
    var p = state.pregnancy || {};
    if (p.id && data.id && p.id !== data.id) { p = {}; knownPrecon = null; } // a different pregnancy -> drop stale fields

    var unsaved = false;
    try {
      if (knownPregJourney && state.pregnancy) {
        unsaved = stableStringify([pregJourneyData(state.pregnancy), pregShared]) !== knownPregJourney;
      }
    } catch (e) { unsaved = false; }
    var keepAppts = (unsaved && Array.isArray(p.appts)) ? p.appts : null;
    /* The checklist needs the identical protection and needs it more, because here the second
       writer is the normal case rather than the unlucky one. But it must NOT hang off `unsaved`:
       that flag is latched true on every device (see knownPrecon above), so keying off it kept the
       local list forever and threw away every checklist the cloud ever sent. Ask the narrow
       question instead: is THIS device holding a checklist edit it has not managed to save? */
    var preconDirty = false;
    try { preconDirty = knownPrecon !== null && stableStringify(p.precon || []) !== knownPrecon; } catch (e) { preconDirty = false; }
    var keepPrecon = (preconDirty && Array.isArray(p.precon)) ? p.precon : null;

    Object.keys(data).forEach(function (k) { p[k] = data[k]; });
    if (keepAppts) p.appts = keepAppts;
    // Not holding one of our own: adopt theirs, and remember it, so the next snapshot is judged
    // against what we actually have rather than against a doc-wide signature that never matches.
    if (keepPrecon) p.precon = keepPrecon;
    else { try { knownPrecon = stableStringify(data.precon || []); } catch (e) {} }
    p.ownerUid = owner; // routing meta lives on the doc, not in data
    state.pregnancy = p;

    // Adopt the server signature ONLY when nothing local is waiting to go out. Doing it
    // unconditionally is what cancelled the write.
    if (!unsaved) knownPregJourney = stableStringify([data, pregShared]);
  }
  // Clear the in-memory journey when the doc is gone / never readable (so a non-permitted
  // member never even learns a pregnancy exists, and an owner who ended it sees it cleared).
  function clearPregJourneyState() {
    state.pregnancy = null;
    preconDenied = false; knownPrecon = null; // a refusal belongs to one journey; the next one starts unjudged
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
      var id = ingestId(ch.doc.id);
      // Bytes that are not a raster image data URL are treated as no photo at all.
      var bytes = ch.type === 'removed' ? '' : ing().photo(ch.doc.data().data);
      if (!bytes) {
        delete bag[id]; delete PhotoStore.privIds[id];
        if (!circlePhotoIds[id]) delete PhotoStore.map[id];
      } else {
        bag[id] = 1; PhotoStore.privIds[id] = 1;
        PhotoStore.map[id] = bytes;
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
          await priv.doc(docKey(id)).set({ data: PhotoStore.map[id], authorId: uidNow });
          PhotoStore.privIds[id] = 1; ownPregPhotoIds[id] = 1;
          await photosRef.doc(docKey(id)).delete();
        } catch (e) { console.warn('preg photo migrate', e); }
      }
    })().then(function () { pregBytesMigrating = false; }, function () { pregBytesMigrating = false; });
  }
  // Listen to the journey doc we're permitted to read: the owner reads her own;
  // a non-owner tries each member's doc (ones not shared with us fail permission and are ignored).
  function ensurePregListeners(uidNow) {
    pregUnsub.forEach(function (u) { try { u(); } catch (e) {} });
    pregUnsub = []; pregOwner = null; pregShared = []; knownPregJourney = null; knownPrecon = null;
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
  /* ---------- the shared preparation checklist (precon), the one field a partner writes ----------
     Everything else on the journey doc is hers alone. The checklist is not: it is folic acid, a
     dentist check, easing off alcohol, and it was already rendered to the people she chose to tell,
     just uninteractively — so the stage meant to be done by two people contained nothing two people
     could do. It stays on THIS document rather than moving to the circle-shared `app` blob, because
     that blob is readable by every member (a grandparent, a nanny) and a checklist that opens with
     folic acid announces that someone is trying to conceive to people she never told. The audience
     has to stay exactly the sharedWith[] she picked, and that is this document's audience already.
     So a non-owner writes ONE field path, data.precon, and firestore.rules allows that key alone.
     If those rules are not deployed the write is refused, and a refusal has to be said out loud
     rather than left as a tick that quietly disappears on the next snapshot. */
  var preconDenied = false; // this device asked to write the shared list and was refused
  async function syncSharedPrecon(uidNow) {
    var p = state.pregnancy;
    if (!hhRef || !p || !p.ownerUid || p.ownerUid === uidNow) return;
    if (preconDenied) return; // the door is closed; index.html has already gone read-only
    /* Compared on the checklist alone, never on the whole-document signature. That signature never
       matches on any device (knownPrecon, above), so gating on it fired a Firestore write on every
       single persist() a partner made, about anything at all. */
    var sig = stableStringify(p.precon || []);
    if (knownPrecon === sig) return; // nothing of ours is waiting to go out
    try {
      await hhRef.collection('pregnancy').doc(p.ownerUid)
        .update({ 'data.precon': p.precon || [], updatedAt: window.LL.serverTimestamp() });
      knownPrecon = sig; // it is the cloud's now, so the echo of our own write is adopted quietly
    } catch (e) {
      console.warn('shared precon push', e);
      /* Dropping the signature is the honest half: nothing is dirty while it is null, so the very
         next snapshot restores the owner's list over the tick that did not save, instead of this
         device holding an edit forever that nobody else will ever see. */
      knownPrecon = null;
      if (e && e.code === 'permission-denied') {
        preconDenied = true;
        try { if (booted) rerender(); } catch (e2) {}
        try { window.toast && window.toast('Could not save that, try again'); } catch (e2) {}
      }
    }
  }
  // The owner writes her changed journey doc (data + current sharedWith). A member she shared it
  // with writes the preparation checklist and nothing else.
  async function syncPregJourney(uidNow) {
    var p = state.pregnancy;
    if (!hhRef || !p || !p.ownerUid) return;
    if (p.ownerUid !== uidNow) { syncSharedPrecon(uidNow); return; }
    var data = pregJourneyData(p);
    var shared = pregShared || [];
    var sig = stableStringify([data, shared]);
    if (knownPregJourney === sig) return;
    knownPregJourney = sig;
    try {
      await hhRef.collection('pregnancy').doc(uidNow)
        .set({ ownerUid: uidNow, data: data, sharedWith: shared, updatedAt: window.LL.serverTimestamp() });
      // Her whole-document write carries the checklist too, so it is no longer hers alone to owe.
      knownPrecon = stableStringify(data.precon || []);
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
  // blob. Run by the member the copy names as its owner, or by the household owner when it names
  // nobody in the circle (legacyJourneyMovedHere). The legacy journey was already visible to the whole circle
  // (it lived in the shared blob), so the migrated sharedWith defaults to the current members, so
  // nobody silently loses access they already had. The new-pregnancy audit governs fresh starts.
  /* THE STRIP IS NOT OPTIONAL (review R2). This used to rely on pushNow, which writes app.<key> field
     paths for the keys it knows and so never deleted app.pregnancy. firestore.rules appBlobClean then
     refused every later write that touched `app`, for the owner and every caregiver, for good. So the
     move ends with its own update deleting each legacy key still present, and only once her journey
     (and any private health that rode inside it) is confirmed on the SERVER: a strip that landed
     first, then a closed tab, would have lost the most sensitive thing a family writes down.
     Idempotent, so a move that stopped half way (a closed tab, a lost connection) is simply run again.
     Each run reads her journey doc and her private health docs from the SERVER first and folds them
     in, so the legacy copy only ever fills what is not there yet and never overwrites her own record.
     Whatever is still owed (the journey doc, or a health field the legacy copy carries that her
     health docs lack) is written and then read back from the server, and the strip waits for that.
     A failure leaves pregMigrated false, and the next household snapshot or a backoff timer tries again. */
  /* WHOSE MOVE IT IS (review A-V4). The move lands the journey and her health in the PRIVATE docs of
     whoever runs it. A legacy copy that names another member of the circle as its owner (a co-owner who
     is the one expecting) is hers: moved by this phone it would sit in this person's private health,
     unreadable by her, and the strip would then delete the last copy she could read. So when the copy
     names a current member, only that member's phone moves it, whatever her role. When it names nobody
     (or 'local', or someone who has left the circle), the household owner moves it, as before. */
  function legacyJourneyMovedHere(legacy, uidNow, role, members) {
    var named = legacy && typeof legacy.ownerUid === 'string' && legacy.ownerUid !== 'local' ? legacy.ownerUid : '';
    if (named && members && Object.prototype.hasOwnProperty.call(members, named)) return named === uidNow;
    return role === 'owner';
  }
  function maybeMigrateLegacyJourney() {
    if (pregMigrated) return;
    var uidNow = auth.currentUser && auth.currentUser.uid; if (!uidNow || !hhRef) return;
    if (legacyBlobPresent.indexOf('pregnancy') < 0) return; // nothing legacy in the shared blob
    var legacy = (legacyBlobPreg && typeof legacyBlobPreg === 'object') ? legacyBlobPreg : null;
    /* Not this phone's to move: nothing moved, nothing stripped, and the check runs again on every
       snapshot. The stash is KEPT. Dropped here, a retry already waiting from an earlier failed move
       (the named member was not in the circle then, so it was this phone's move) found no copy, read
       that as "a legacy key with nothing in it", and stripped her journey and health from the blob
       without moving them anywhere (review A-V5). No client can rewrite the legacy key (appBlobClean),
       so the stash never goes stale. */
    if (!legacyJourneyMovedHere(legacy, uidNow, window.LL.role, window.LL.members)) return;
    pregMigrated = true;
    var ref = hhRef, own = ref.collection('pregnancy').doc(uidNow);
    var cats = Object.keys(MAT_CATS);
    function catRef(c) { return ref.collection('mhealth').doc(uidNow).collection('cat').doc(c); }
    function stillHere() { return hhRef === ref && !!auth.currentUser && auth.currentUser.uid === uidNow; }
    // The health fields the legacy copy carries that a category doc on the server does not hold yet.
    function owed(c, snap) {
      var d = (snap && snap.exists && snap.data() && snap.data().data) || {};
      return MAT_CATS[c].filter(function (k) { return legacy && legacy[k] !== undefined && d[k] === undefined; });
    }
    function readServer() { return Promise.all([own].concat(cats.map(catRef)).map(function (r) { return r.get({ source: 'server' }); })); }
    // A journey another member owns is live here (the carrier is not always the household owner): it is
    // not hers to fold the legacy copy into. Left exactly as before this fix: nothing moved, nothing stripped.
    function anothersJourney() { return !!pregOwner && pregOwner !== uidNow; }
    if (anothersJourney()) { legacyBlobPreg = null; return; }
    readServer().then(function (snaps) {
      if (!stillHere()) return false;
      if (!legacy) return true; // a legacy key with nothing in it: only the strip is owed
      var journeyOwed = !snaps[0].exists;
      var catsOwed = cats.filter(function (c, i) { return owed(c, snaps[i + 1]).length; });
      if (!journeyOwed && !catsOwed.length) return true; // moved already (a strip that never landed): only the strip is owed
      if (anothersJourney()) { legacyBlobPreg = null; return false; }
      // She owns what is moved. The listeners for her own health start first: for a new owner they reset
      // the consent and sync memory that the folds below then fill in from the server.
      var p = state.pregnancy || {};
      p.ownerUid = uidNow;
      state.pregnancy = p;
      /* pregOwner is NOT set here: her own-doc listener sets it when the doc exists. Set early, that
         listener reads a "no doc yet" snapshot as "her journey was deleted" and clears state.pregnancy
         in the middle of the move (clearPregJourneyState), taking the health fields being moved with it. */
      ensureMaternalListeners(uidNow);
      // Her own record first, as the server has it (with its sharedWith), so nothing below writes over it.
      applyingRemote = true;
      if (snaps[0].exists) applyPregJourney(uidNow, snaps[0].data());
      cats.forEach(function (c, i) { if (snaps[i + 1].exists) applyMatDoc(c, snaps[i + 1].data()); });
      applyingRemote = false;
      // Then the legacy copy fills only what is still missing.
      p = state.pregnancy;
      Object.keys(legacy).forEach(function (k) { if (p[k] === undefined) p[k] = legacy[k]; });
      // Preserve existing visibility: share the journey with the current circle (everyone who could
      // already see it via the blob). The owner can trim this later in the privacy sheet.
      if (journeyOwed) pregShared = ((window.LL.members && Object.keys(window.LL.members)) || []).filter(function (m) { return m !== uidNow; });
      if (journeyOwed) knownPregJourney = null; // force the journey to be written
      catsOwed.forEach(function (c) { delete knownMat[c]; });
      // Both started in THIS tick, as pushNow does: once the journey doc lands, its own listener folds
      // that doc into state.pregnancy, and nothing may be read from state after that point.
      return Promise.all([syncPregJourney(uidNow), syncMaternal(uidNow)]).then(readServer).then(function (after) {
        var still = cats.reduce(function (a, c, i) { return a.concat(owed(c, after[i + 1])); }, after[0].exists ? [] : ['journey']);
        if (still.length) throw new Error('not on the server yet: ' + still.join(', '));
        return true;
      });
    }).then(function (strip) {
      if (!strip || !stillHere()) return;
      var keys = legacyBlobPresent.slice(); // only the ones present
      if (!keys.length) return;
      var upd = { updatedAt: window.LL.serverTimestamp() };
      keys.forEach(function (k) { upd['app.' + k] = firebase.firestore.FieldValue.delete(); });
      return ref.update(upd).then(function () {
        legacyBlobPreg = null; maybeMigrateLegacyJourney._retryMs = 0;
        // Edits still waiting on this phone go now. One the rules already REFUSED while the key was
        // there is not among them: a refused edit is reverted and not retried (see pushNow).
        if (stillHere()) scheduledPush();
      });
    }).catch(function (e) {
      console.warn('legacy journey move', e);
      if (!stillHere()) return;
      pregMigrated = false;
      // Until it finishes, nobody in the circle can save to the blob, so it does not wait for a snapshot a
      // quiet household may not send for hours: it tries again on a backoff (5 s, doubling, 5 min at most).
      var wait = maybeMigrateLegacyJourney._retryMs = Math.min((maybeMigrateLegacyJourney._retryMs || 2500) * 2, 300000);
      setTimeout(function () { if (stillHere()) maybeMigrateLegacyJourney(); }, wait);
    });
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
  /* LINK ROWS (lane B, D1). The pending-links list on the household document is read by every
     member, and it used to be keyed by each live link's token, so any caregiver could copy one and
     hand it to anyone. A row is now keyed by an id that opens nothing ('r_' and 16 random
     characters, which can never be a token: tokens have no underscore), and the token for each row
     lives in households/{hid}/ownerLinks/{rowId}, which only an owner can read. A row still keyed
     by its token was written before this change (or by an older build); the owner's own device
     moves it (tidyOwnerLinks). window.LL.ownerLinks is the owner's live copy of that collection. */
  window.LL.ownerLinks = {};
  var ownerLinksUnsub = null;      // owner-only listener on households/{hid}/ownerLinks
  var ownerLinksDenied = false;    // the token listener was refused: rules without ownerLinks (retried, see watchOwnerLinks)
  function newLinkRowId() {
    var A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', out = 'r_';
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < b.length; i++) out += A[b[i] % A.length];
    return out;
  }
  function isLinkRowId(key) { return /^r_[A-Za-z0-9]{16}$/.test(String(key || '')); }
  // The token behind a pending row: from the owner-only doc, or the key itself for a row written
  // before row ids. '' when it cannot be known on this device.
  function linkTokenFor(rowKey) {
    var ol = (window.LL.ownerLinks || {})[rowKey];
    if (ol && typeof ol.token === 'string' && ol.token) return ol.token;
    return (rowKey && !isLinkRowId(rowKey)) ? String(rowKey) : '';
  }
  // And the other way: which row a token sits under (its own key, for a row written before).
  function linkRowFor(token) {
    var ol = window.LL.ownerLinks || {};
    for (var k in ol) { if (Object.prototype.hasOwnProperty.call(ol, k) && ol[k] && ol[k].token === token) return k; }
    return token;
  }
  window.LL.createInviteLink = async function (opts) {
    opts = opts || {};
    var u = auth.currentUser;
    if (!u || !hhRef || window.LL.role !== 'owner') return null;
    var token = newInviteToken();
    var linkDoc = {
      householdId: window.LL.householdId,
      // Always a caregiver link: the rules refuse any other kind. A link admits whoever holds it, and an
      // owner-role one would have handed a forwarded message the power to remove the owner.
      role: 'caregiver',
      relationship: opts.relationship || '',
      invitedBy: u.uid,
      invitedByName: nameForUid(u.uid) || (u.displayName || '').split(' ')[0] || '',
      usedBy: null,
      createdAt: window.LL.serverTimestamp(),
      expiresAt: new Date(Date.now() + INVITE_LINK_HOURS * 3600000)
    };
    // Checked by the rules against this account's own address, so the sheet that offers the link to
    // someone with a Cubby already can show who really sent it (inviteFacts).
    if (u.email) linkDoc.fromEmail = String(u.email).toLowerCase();
    /* Mirror it onto the household document, the way pending email invites already are. Not a
       convenience: the rules deny LIST on inviteLinks (that is what keeps the token a secret), so
       there is no query that could rebuild this list. Without the mirror an owner would have no way
       to see, re-send or revoke a link she made two minutes ago.
       The mirror row is keyed by a row id, and the token goes where only owners can read it, all in
       ONE batch, so there is never a row without its token or a token without its row. Under rules
       published before ownerLinks existed that batch is refused, and the link is made the old way
       (token-keyed row); this owner's device moves that row once the rules allow it.
       The batch is tried first EVERY time, never skipped on an earlier refusal: Cubby can be open
       when the new rules are published, and the first link after that must already be the new shape. */
    var row = { at: Date.now(), expiresAt: Date.now() + INVITE_LINK_HOURS * 3600000, sentTo: '' };
    var rowId = newLinkRowId();
    try {
      var b = db.batch();
      b.set(hhRef.collection('ownerLinks').doc(rowId), { token: token, at: row.at, expiresAt: row.expiresAt });
      b.set(db.collection('inviteLinks').doc(token), Object.assign({ rowId: rowId }, linkDoc));
      b.update(hhRef, new firebase.firestore.FieldPath('pendingLinks', rowId), row);
      await b.commit();
      window.LL.ownerLinks[rowId] = { token: token, at: row.at, expiresAt: row.expiresAt };
      // The rules have ownerLinks now. If this session's listener was refused under the ones before,
      // attach it now, so the tidy moves the rows made the old way without a relaunch.
      if (ownerLinksDenied && !ownerLinksUnsub) {
        ownerLinksDenied = false; ownerLinksDeniedAt = 0;
        watchOwnerLinks({ pendingLinks: window.LL.hhPendingLinks || {}, members: window.LL.members || {} });
      }
    } catch (e) {
      if (!e || e.code !== 'permission-denied') { console.warn('createInviteLink', e); return null; }
      /* Fall back to the old shape ONLY when the rules really have no ownerLinks yet: a refused batch
         AND a refused read of ownerLinks. A refusal under rules that do have it is some other
         problem, and the old shape would put the token back where every member can read it. */
      var older = false;
      try { await hhRef.collection('ownerLinks').limit(1).get(); } catch (e2) { older = !!e2 && e2.code === 'permission-denied'; }
      if (!older) { console.warn('createInviteLink', e); return null; }
      if (!ownerLinksDenied) { ownerLinksDenied = true; ownerLinksDeniedAt = Date.now(); }
      rowId = '';
    }
    if (!rowId) {
      try {
        await db.collection('inviteLinks').doc(token).set(linkDoc);
      } catch (e) { console.warn('createInviteLink', e); return null; }
      try {
        await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', token), row);
      } catch (e) { /* the link still works; only the owner's list of it is poorer */ }
    }
    return { token: token, rowId: rowId || token, url: location.origin + '/app/?join=' + token, hours: INVITE_LINK_HOURS };
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
  /* Claim, consume and join in ONE batch. The household rule requires the link to go from not
     consumed to consumed by this uid in the very write that adds them, so a link admits one person
     once, and a member removed later cannot walk back in with the token from their old invite URL.
     If two people race one forwarded link, the loser's batch is refused as a whole and they never
     touch the household.
     The rules published before this change refuse the batch (they read the claim as it was before
     it), so a refusal falls back to the old two steps: claim, then join. The claim sets consumed
     too, so links used during the deploy window are closed once the new rules go live. Under the
     new rules that lone claim is itself refused (a link may only be claimed in the write that
     joins), so the fallback can never spend a link without getting the person in.
     joinToken is carried on the write because the rule has no other way to know WHICH link
     admitted this person: rules can only read a document whose path they can construct. It is
     spent by the time it lands, so it is an audit trail rather than a secret. The owner's pending
     row for this link is cleared in the same write: a caregiver may not edit that list later. */
  async function claimInviteLink(link, user) {
    var linkRef = db.collection('inviteLinks').doc(link.token);
    var hh = db.collection('households').doc(link.householdId);
    var upd = Object.assign({ joinToken: link.token },
      memberUpdate(user, link.role || 'caregiver', { relationship: link.relationship, name: link.name }));
    // Her own row: by the row id the owner wrote on the link, or by the token for a link minted
    // before row ids. The rules allow exactly that one key and nothing else (lane B, D1).
    upd['pendingLinks.' + (isLinkRowId(link.rowId) ? link.rowId : link.token)] = firebase.firestore.FieldValue.delete();
    var joined = false;
    try {
      var b = db.batch();
      b.update(linkRef, { usedBy: user.uid, consumed: true });
      b.update(hh, upd);
      await b.commit();
      joined = true;
    } catch (e) {
      if (!e || e.code !== 'permission-denied') { console.warn('claimInviteLink', e); return false; }
    }
    if (!joined) {
      try {
        await linkRef.update({ usedBy: user.uid, consumed: true });
      } catch (e) { console.warn('claimInviteLink', e); return false; }
      /* The household write is INSIDE the try, and a failure gives the token back. It used to sit
         outside: the claim succeeded, the join was denied by the rules, and the exception escaped to
         onAuthStateChanged, which showed a generic sign-in error. */
      try {
        await hh.update(upd);
      } catch (e) {
        console.warn('claimInviteLink join', e);
        try { await linkRef.update({ usedBy: null }); } catch (e2) {}
        return false;
      }
    }
    writeOwnMemberEmail(link.householdId);
    await db.collection('users').doc(user.uid)
      .set({ householdId: link.householdId, name: user.displayName || '', email: user.email || '' }, { merge: true });
    window.LL.justJoined = { invitedBy: link.invitedBy || null, role: link.role || 'caregiver' };
    try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
    return true;
  }
  /* Joining by email invite: the join and the deletion of the invite in ONE batch, so the grant is
     spent the moment it is used. An invite left behind after a join was a standing way back in for
     anyone the owner later removed. The joiner's own row in the owner's pending list goes in the
     same write, so her address stops sitting on a document the whole circle can read.
     The rules before this change accept the batch as well. The single write is kept only for a
     refusal the batch meets and the old shape might not. */
  async function joinByEmailInvite(user, inv) {
    var email = (user.email || '').toLowerCase();
    var hh = db.collection('households').doc(inv.householdId);
    var upd = memberUpdate(user, inv.role || 'caregiver', { relationship: inv.relationship, name: inv.name });
    // update() with field/value pairs, because the email key has dots a string path would split on.
    var args = [hh, new firebase.firestore.FieldPath('pendingInvites', email), firebase.firestore.FieldValue.delete()];
    Object.keys(upd).forEach(function (k) { args.push(k, upd[k]); });
    try {
      var b = db.batch();
      // Held in a variable first: the design-doc class count scans this whole file (it makes a style
      // element), and a dotted method chain there reads to it as one more CSS class.
      var batchUpdate = b.update;
      batchUpdate.apply(b, args);
      /* Every invite this family holds for her, in the same batch: the rules refuse a join that
         leaves one behind. Only the docs she READ go in: under the rules live before the per-family
         invite, deleting a path they have no rule for would refuse the whole batch. */
      if (inv.hasFamily) b.delete(familyInviteRef(email, inv.householdId));
      if (inv.hasLegacy || !inv.hasFamily) b.delete(db.collection('invites').doc(email));
      await b.commit();
    } catch (e) {
      if (!e || e.code !== 'permission-denied') throw e;
      await hh.update(upd);
    }
  }
  /* ONE INVITE PER FAMILY PER ADDRESS (firestore.rules, invites/{email}/from/{hid}). The address-keyed
     invite let whichever family wrote first hold a person's slot, and her real family could not invite
     her at all. Each family now writes its own. The address-keyed one is still read, joined, declined
     and cancelled for as long as older builds write it, and while the rules live before this change
     refuse the per-family one, which is when this client writes the address-keyed one instead. */
  function familyInviteRef(email, hid) { return db.collection('invites').doc(email).collection('from').doc(hid); }
  // How many invites a newcomer is asked about before she is in a Cubby of her own (resolveHousehold).
  var NEWCOMER_ASKS = 3;
  function inviteMillis(d) {
    var c = d && d.createdAt;
    try { if (c && typeof c.toMillis === 'function') return c.toMillis(); } catch (e) {}
    return typeof c === 'number' ? c : 0;
  }
  /* Every invite waiting for this address, one offer per family, most recent first. legacySnap is the
     address-keyed doc, already read by the caller (or null). The per-family list is refused by the rules
     live before this change, and then it is simply empty. An offer remembers which docs it came from
     (hasFamily, hasLegacy), because joining or declining it must spend exactly those. */
  async function readInviteOffers(email, legacySnap) {
    var byHid = {}, list = [];
    function add(d, kind) {
      if (!d || !d.householdId) return;
      var o = byHid[d.householdId];
      if (!o) { o = byHid[d.householdId] = { email: email }; list.push(o); }
      /* When a family holds both, the newer one says what the owner wants now. Usually that is the
         family's own (this build writes it), but an older build that cannot see it may have cancelled
         and sent the address-keyed one again since, perhaps with another role. Ties: the family's own. */
      if (!(o.hasFamily || o.hasLegacy) || inviteMillis(d) > inviteMillis(o) || (kind === 'family' && inviteMillis(d) === inviteMillis(o))) Object.assign(o, d);
      if (kind === 'family') o.hasFamily = true; else o.hasLegacy = true;
    }
    try { if (legacySnap && legacySnap.exists) add(legacySnap.data(), 'legacy'); } catch (e) {}
    try {
      var fam = await db.collection('invites').doc(email).collection('from').get();
      fam.forEach(function (s) { add(Object.assign({}, s.data(), { householdId: (s.data() || {}).householdId || s.id }), 'family'); });
    } catch (e) { /* refused (the rules live before this change) or offline: the address-keyed one only */ }
    list.sort(function (a, b) { return inviteMillis(b) - inviteMillis(a); });
    return list;
  }
  /* She has said no to ONE family's invite: throw that one away and no other. Both of its docs, when
     it has both. Never awaited by a caller that must not wait; each refusal is quiet. */
  function declineOffer(email, inv) {
    var outs = [];
    if (inv && inv.hasFamily) outs.push(familyInviteRef(email, inv.householdId).delete().catch(function (e) { console.warn('decline invite', e && e.code); }));
    if (inv && (inv.hasLegacy || !inv.hasFamily)) outs.push(db.collection('invites').doc(email).delete().catch(function (e) { console.warn('decline invite', e && e.code); }));
    return Promise.all(outs);
  }
  /* A newcomer whose address has an invite waiting: ask, on the app's own confirm sheet, naming who
     sent it. Resolves true (join), false (she chose her own Cubby) or null (no sheet to ask with).
     Pulling the sheet down or tapping outside is not an answer, so it simply asks again: deciding
     for her either way would be wrong at 3am. The inviter's name comes from the invite itself, so
     it is escaped by confirmSheet and the copy never claims more than "invited you". */
  /* Who sent an invite, as facts for the sheet to draw as data rather than as Cubby's own sentence.
     The name and the relationship are whatever the sender typed, so a stranger could once write the
     reassurance ("Mum. Your partner set this up for you") straight into the question. Now the name
     is a labelled row, the relationship is cut to a short label, and beside them sits the one thing
     the sender could not choose: fromEmail, which the rules check against their own sign-in address.
     An invite with no proven address shows no name at all. */
  function inviteLabel(s, max) {
    // A label, not a sentence: stop at the first sentence break, squash whitespace, cap the length.
    return String(s == null ? '' : s).split(/[.!?;:\n\r]/)[0].replace(/\s+/g, ' ').trim().slice(0, max);
  }
  /* The name the sender typed for herself, as a short label. It sits beside an address the rules
     proved, so it must never read as one: a name that is itself an address ("midwife@nhs.test") or
     a path is dropped, and a name that runs on into a sentence ("Cubby. Verified family") is cut at
     its first break. The proven address leads the row, so the name can only ever be the aside.
     Look-alikes count (round-5 review VJ-2): NFKC first, so a full-width or small @ becomes the @ it
     imitates; invisible direction and joiner marks go, since they can reorder or hide what is drawn;
     a domain-shaped run ("nhs.test", "Cubby.Verified") or a spelled-out "(at)" drops the name too;
     and brackets go, so a name cannot close the parentheses it is drawn in and open a claim of its own. */
  function senderName(s) {
    var raw = String(s == null ? '' : s);
    try { raw = raw.normalize('NFKC'); } catch (e) {}
    raw = raw.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '');
    if (/[@\/\\]/.test(raw) || /[^\s.]\.[^\s.]/.test(raw) || /[(\[]\s*at\s*[)\]]/i.test(raw)) return '';
    return raw.split(/[!?;:\n\r\u3002\uFF61]|\. /)[0].replace(/[()\[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  }
  function inviteFacts(inv) {
    var factRows = [];
    var from = String((inv && inv.fromEmail) || '').trim().toLowerCase().slice(0, 120);
    var who = from ? senderName(inv && inv.invitedByName) : '';
    if (from) factRows.push({ label: 'From', value: who ? (from + ' (' + who + ')') : from });
    var rel = inviteLabel(inv && inv.relationship, 24);
    if (rel) factRows.push({ label: 'You’d join as', value: rel });
    /* camelCase on purpose: tools/design_doc_check.js counts any dotted lowercase name in a file that makes a
       style element as a CSS class, so plain lowercase property names here read to it as new classes. */
    return { factRows: factRows, senderProven: !!from };
  }
  // Older builds of the page draw only title and body. Fold the facts into the body there.
  function factsAsText(rows) {
    return rows.map(function (row) { return String(row.label) + ': ' + String(row.value) + '.'; }).join(' ');
  }
  function askNewcomerToJoin(inv, opts) {
    // more: another family's invite is still to come, so saying no here is "Not this one", not yet
    // "Start my own Cubby" (that is what saying no to the last one means).
    var more = !!(opts && opts.more);
    if (typeof window.confirmSheet !== 'function' || !document.getElementById('sheet')) return Promise.resolve(null);
    /* A page from an older build (the edge or a precache can pair it with this file) has a
       confirmSheet that ignores onCancel, so "Start my own Cubby" would never settle this promise
       and she would sit on a blank screen. Its cancel hook is what tells the two apart. Not being
       able to ask is the existing safe answer: her own Cubby, with the invite offered after boot. */
    if (typeof window.__confirmCancel !== 'function') return Promise.resolve(null);
    try { hideOverlay(); } catch (e) {}
    var f = inviteFacts(inv);
    var share = 'If you join, what you log is shared with their family circle, and what they log is shared with you.';
    var body = more
      ? (f.senderProven
        ? share + ' Only join if you know who sent this.'
        : 'This invite doesn’t say who sent it. Only join if you were expecting one, and they can always invite you again. ' + share)
      : (f.senderProven
        ? share + ' Only join if you know who sent this. If you don’t, start your own Cubby instead.'
        : 'This invite doesn’t say who sent it. Join if you were expecting one. If not, start your own Cubby, and they can always invite you again. ' + share);
    var rich = window.confirmSheet.drawsFacts === true;
    if (!rich && f.factRows.length) body = factsAsText(f.factRows) + ' ' + body;
    return new Promise(function (resolve) {
      var ask = function () {
        window.confirmSheet({
          title: 'You’ve been invited',
          lead: 'Someone has invited you to join their family on Cubby.',
          facts: f.factRows,
          mustAnswer: true,
          body: body,
          confirmLabel: 'Join the family',
          cancelLabel: more ? 'Not this one' : 'Start my own Cubby',
          onConfirm: function () { try { showStatus('Setting things up…'); } catch (e) {} resolve(true); },
          onCancel: function (how) {
            if (how !== 'cancel') { setTimeout(ask, 250); return; }
            try { showStatus('Setting things up…'); } catch (e) {}
            resolve(false);
          }
        });
      };
      ask();
    });
  }
  /* "Join the family" with no connection (P2, Nov 2026). The join is one batch, and offline the SDK
     keeps it queued and sends it when the connection returns, so the tap itself is never lost. The
     screen was: the rotating loader turned for as long as she stayed offline, which reads as stuck.
     After about 8 seconds without the server's answer it gives way to the boot's own connectivity
     card, word for word, and the join stays queued underneath. Its button never reloads the page:
     her pointer to the family is saved only once the join lands, so a reload while it waits would
     leave her in the family with nothing on this phone pointing at it. "Try again" just looks again.
     Call the returned function once the join and her pointer have landed, or the join has failed. */
  var JOIN_WAIT_MS = 8000;
  function watchJoinWait() {
    var settled = false, timer = null;
    function arm() {
      timer = setTimeout(function () {
        timer = null;
        if (settled || !document.getElementById('llAuthMsg')) return; // something else owns the screen
        if (!showConnTrouble({
          title: 'We can’t reach your Cubby',
          body: 'You look offline. Anything already saved on this phone is still here, safe. Try again once you have a connection.',
          action: 'void 0'
        })) return;
        var again = document.querySelector('#llAuthOv .es-cta');
        if (again) again.onclick = function () { if (!settled) { showStatus('Setting things up…'); arm(); } };
      }, JOIN_WAIT_MS);
    }
    arm();
    return function () {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      // Landed while the card was up: back to the loader, and the boot takes it from there.
      if (document.querySelector('#llAuthOv .conn-card')) showStatus('Setting things up…');
    };
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
  /* The three full-screen notes below (dead link, no invite, removed) follow the parent's theme. They
     used to hard-code the light palette, so at 3am in Night she got a bright cream screen. The
     fallbacks are the light values, for a page whose tokens have not loaded. */
  var OV_BG = 'var(--bg,#FBF5E9)', OV_INK = 'var(--ink,#3a2f28)', OV_SOFT = 'var(--ink-soft,#8a7a6d)';
  /* Their pink button carries dark text, the same as the goodbye screen: white on #C97FA0 is 2.99:1,
     and #1A1614 on it is about 6:1, in light and in Night alike (the pink does not change). */
  /* deadLink is set when the invite she is acting on no longer works, and says which kind:
     true for a TOKEN link (spent, expired, or into a family that has closed), 'gone' for an email
     invite whose join was refused after she said yes (withdrawn while she read it, or the family has
     closed). The email copy below would send her to fix the wrong thing entirely: her address is
     fine. Only the person who invited her can make another. */
  function showInviteMismatch(email, deadLink) {
    if (inviteMismatchShown) return; inviteMismatchShown = true;
    // Any open store sheet (z-index 99998) would otherwise sit on top of this note (3000).
    try { closeModal(); } catch (e) {}
    if (deadLink) {
      try { hideOverlay(); } catch (e) {}
      var isLink = deadLink !== 'gone';
      var ovd = document.createElement('div'); ovd.id = 'll-invite-mismatch';
      ovd.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:' + OV_BG + ';display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;overflow-y:auto');
      ovd.innerHTML = '<div style="max-width:360px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
        + '<img src="/icons/logo-512.png?v=09cba32f" alt="" width="52" height="52" style="display:block;margin:0 auto;border-radius:13px">'
        + '<h2 style="font-family:Georgia,serif;color:' + OV_INK + ';margin:12px 0 8px;font-size:22px">' + (isLink ? 'This invite link no longer works' : 'This invite is no longer open') + '</h2>'
        + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55">' + (isLink
            ? 'Invite links last a day and work once, so that a link passed on by accident cannot let anyone in.'
            : 'It may have been withdrawn, or the family may have closed their Cubby. Nothing was shared.') + '</div>'
        + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55;margin-top:12px">Nothing is wrong with your sign in. '
        + (isLink ? 'Ask them to send you a fresh link.' : 'If you were expecting it, ask them to invite you again.') + '</div>'
        + '<div style="margin-top:18px"><a href="#" id="ll-im-own" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;color:' + OV_SOFT + ';font-size:15px;font-weight:700">Start my own Cubby instead</a></div>'
        + '</div>';
      document.body.appendChild(ovd);
      var own0 = document.getElementById('ll-im-own');
      if (own0) own0.onclick = function (ev) {
        ev.preventDefault();
        try { sessionStorage.removeItem('cubby-join'); } catch (e) {}
        /* An email invite into a closed family still exists, and on the reload it would be offered
           again, refused again, and land her back here. She has chosen her own, so it is hers to
           throw away (rules allow deleting the one addressed to you). Bounded, so a bad connection
           cannot hold the button. */
        var gone = (!isLink && email)
          ? Promise.race([db.collection('invites').doc(email).delete().catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })])
          : Promise.resolve();
        gone.then(function () { clearInviteMismatch(); try { location.reload(); } catch (e) {} });
      };
      return;
    }
    try { hideOverlay(); } catch (e) {}
    // Do NOT clear cubby-join here. If we did, a second wrong sign-in (Apple hands back the SAME relay
    // address every time, so a wrong guess repeats) would no longer count as a join attempt and would
    // silently create a fresh empty household. Join intent is abandoned in exactly one place: the
    // "Start my own Cubby instead" button below, and on a successful join (resolveHousehold).
    var ov = document.createElement('div'); ov.id = 'll-invite-mismatch';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:' + OV_BG + ';display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;overflow-y:auto');
    ov.innerHTML = '<div style="max-width:360px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
      + '<img src="/icons/logo-512.png?v=09cba32f" alt="" width="52" height="52" style="display:block;margin:0 auto;border-radius:13px">'
      + '<h2 style="font-family:Georgia,serif;color:' + OV_INK + ';margin:12px 0 8px;font-size:22px">We could not find your invite</h2>'
      + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55">You signed in as <b>' + esc(email) + '</b>, and there is no invite waiting for that address.</div>'
      + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55;margin-top:12px">Invites are matched by email. If you signed in with Apple and chose to hide your address, Cubby sees the hidden one instead of yours.</div>'
      + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55;margin-top:12px">Sign in again with the address they sent it to, or ask them to re-send it to <b>' + esc(email) + '</b>.</div>'
      + '<button id="ll-im-btn" style="margin-top:22px;border:none;border-radius:16px;padding:15px 24px;background:#C97FA0;color:#1A1614;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit">Try a different sign in</button>'
      + '<div style="margin-top:10px"><a href="#" id="ll-im-own" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;color:' + OV_SOFT + ';font-size:15px;font-weight:700">Start my own Cubby instead</a></div>'
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

  /* A REMOVED MOTHER'S OWN RECORDS (D2, Nov 2026). Her journey, her private health and her pregnancy
     photo bytes live under the family, in her own uid's paths. Once an owner removed her she could no
     longer reach them, while anyone she had shared them with still could. The rules now let the
     record's own uid list and delete those three, and only those, without membership. Used by the
     note below and by account deletion. */
  function ownRecordPaths(ref, uid) {
    var journey = ref.collection('pregnancy').doc(uid);
    return { catsCol: ref.collection('mhealth').doc(uid).collection('cat'), journeyDoc: journey, photosCol: journey.collection('photos') };
  }
  // true: she has some there. false: none. null: the rules or the network would not say (older rules
  // refuse an ex-member outright), and then nothing is offered that could not be done.
  async function hasOwnRecords(ref, uid) {
    var at = ownRecordPaths(ref, uid);
    try {
      var found = await Promise.all([at.catsCol.limit(1).get(), at.photosCol.limit(1).get(), at.journeyDoc.get()]);
      return found[0].size > 0 || found[1].size > 0 || found[2].exists === true;
    } catch (e) { return null; }
  }
  // Every one of them, in batches (one round trip, all or nothing each). Listed from the SERVER: from
  // the cache, an offline phone would "find" what it last saw and queue deletes nobody confirmed.
  async function deleteOwnRecords(ref, uid) {
    var at = ownRecordPaths(ref, uid);
    var fromServer = { source: 'server' };
    var found = await Promise.all([at.catsCol.get(fromServer), at.photosCol.get(fromServer)]);
    var refs = found[0].docs.concat(found[1].docs).map(function (d) { return d.ref; });
    refs.push(at.journeyDoc);
    for (var i = 0; i < refs.length; i += 400) {
      var b = db.batch();
      refs.slice(i, i + 400).forEach(function (r) { b.delete(r); });
      await b.commit();
    }
  }

  var accessLostShown = false;
  function showAccessLost() {
    if (accessLostShown) return;
    // Deleting your own account also drops you from members, which fires this same snapshot. Telling
    // someone "you're no longer in this family" mid-deletion would be both alarming and wrong, so the
    // deletion flow owns the screen until it finishes.
    if (typeof deletingAccount !== 'undefined' && deletingAccount) return;
    accessLostShown = true;
    // Family & sharing, or the first-run sheet, is a store sheet at z-index 99998, and this note is 3000:
    // left open, it hid the one thing she needs to read.
    try { closeModal(); } catch (e) {}
    try { hideOverlay(); } catch (e) {}
    /* The family she lost is remembered on her own users doc (self-only by rule): after this her pointer
       is cleared and her next sign-in starts afresh, and account deletion still has to find her private
       records there, first, before anything else goes.
       An update, which Firestore refuses (not-found) when the doc is not there, never a merge, which makes
       it. Every way into a family writes that doc (resolveHousehold, the link and invite joins), so a member
       losing a family has one, unless account deletion has removed it (step 3, whether or not the login itself
       then went), and then there is nothing to point from: her own records there went in that deletion. Her
       other phone, still signed in on a token that outlives the account, lands here when that deletion takes
       her out of the family, and its merge used to write the record back, under an account that no longer
       exists, where nothing ever removed it (Nov 2026). The rules allow both (users/{uid}: her own write).
       tools/chaos.js --self-test drives both on the real SDK: Olive deleting on one of two phones, and a removal. */
    var lostRef = hhRef, u = auth.currentUser;
    try {
      if (u) {
        var pointer = { householdId: null };
        if (lostRef) pointer.formerHouseholdIds = firebase.firestore.FieldValue.arrayUnion(lostRef.id);
        db.collection('users').doc(u.uid).update(pointer).catch(function (e) { console.warn('access lost: pointer', e && e.code); });
      }
    } catch (e) {}
    var ov = document.createElement('div'); ov.id = 'll-access-lost';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:3000;background:' + OV_BG + ';display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;overflow-y:auto;');
    ov.innerHTML = '<div style="max-width:340px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
      + '<img src="/icons/logo-512.png?v=09cba32f" alt="" width="52" height="52" style="display:block;margin:0 auto;border-radius:13px">'
      + '<h2 style="font-family:Georgia,serif;color:' + OV_INK + ';margin:12px 0 8px;font-size:22px">You’re no longer in this family</h2>'
      + '<div style="color:' + OV_SOFT + ';font-size:15px;line-height:1.55">Your access to this Cubby was removed, or the family was closed. Everything you logged stays part of their story.</div>'
      + '<button id="ll-al-btn" style="margin-top:22px;border:none;border-radius:16px;padding:15px 24px;background:#C97FA0;color:#1A1614;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit">Back to sign in</button>'
      /* Quieter, and only once we know she has records there (see offerOwnRecordDeletion). The wrapper
         carries hidden: the button sets its own display, which would beat the attribute. */
      + '<div id="ll-al-rec-row" hidden style="margin-top:10px"><button id="ll-al-rec" type="button" style="border:none;background:none;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;color:' + OV_SOFT + ';font-size:var(--fs-lead,15px);font-weight:700;line-height:1.35;text-decoration:underline">Delete my pregnancy records from that family</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    /* The note goes once she is signed out, by its button or any other way. Signing out does not
       reload, so it used to stay at 3000 under the sign-in screen (99999) and then sit over her next
       Cubby the moment that one booted: a new family she could not see, still flagged as the one she
       lost. The boot's own listener was registered first, so the sign-in screen is already up when
       this runs and the old family never shows in between. */
    try {
      var lostUid = u ? u.uid : null, stopWatch = null, watchDone = false;
      var endNote = function (who) {
        if (watchDone || (who && who.uid === lostUid)) return;
        watchDone = true;
        if (stopWatch) stopWatch();
        try { ov.remove(); } catch (e) {}
        accessLostShown = false;
      };
      stopWatch = auth.onAuthStateChanged(endNote);
      if (watchDone) stopWatch();
    } catch (e) {}
    var btn = document.getElementById('ll-al-btn');
    if (btn) btn.onclick = function () { if (window.LL && typeof window.LL.signOut === 'function') window.LL.signOut(); else { try { location.reload(); } catch (e) {} } };
    if (lostRef && u) offerOwnRecordDeletion(lostRef, u.uid);
  }
  /* The quiet second button on the note above. Shown only when she has records in that family and the
     rules let her reach them, so under the older rules it simply never appears. One confirm, the app's
     own, lifted over the note (it is 3000, the sheet 51); closeSheet() puts it back. */
  function offerOwnRecordDeletion(ref, uid) {
    hasOwnRecords(ref, uid).then(function (has) {
      var rec = document.getElementById('ll-al-rec'), row = document.getElementById('ll-al-rec-row');
      if (has !== true || !rec || !row || typeof window.confirmSheet !== 'function') return;
      row.removeAttribute('hidden');
      var busy = false;
      rec.onclick = function () {
        if (busy) return;
        window.confirmSheet({
          title: 'Delete your pregnancy records?',
          body: 'This removes your journey, health notes and pregnancy photos from that family’s Cubby. It can’t be undone.',
          confirmLabel: 'Delete',
          cancelLabel: 'Keep',
          danger: true,
          onConfirm: function () {
            busy = true;
            deleteOwnRecords(ref, uid).then(function () {
              row.setAttribute('hidden', '');
              noteOverNote('Your pregnancy records are deleted.');
              // Nothing left there for account deletion to find.
              try { db.collection('users').doc(uid).set({ formerHouseholdIds: firebase.firestore.FieldValue.arrayRemove(ref.id) }, { merge: true }); } catch (e) {}
            }, function (e) {
              console.warn('delete own records', e && e.code);
              noteOverNote(errText(e));
            }).then(function () { busy = false; });
          }
        });
        var scrimEl = document.getElementById('scrim'), sheetEl = document.getElementById('sheet');
        if (scrimEl) scrimEl.style.zIndex = '3001';
        if (sheetEl) sheetEl.style.zIndex = '3002';
      };
    });
  }
  /* A toast is 60 and the note is 3000: lift it while it shows, then hand it back. Its stylesheet
     transitions "all", z-index included, so the lift is made with the transition off: otherwise it
     climbs from 60 over the same 0.3s the toast fades in, and spends that fade behind the note. */
  function noteOverNote(msg) {
    var t = document.getElementById('toast');
    var stack = function (z) {
      if (!t) return;
      t.style.setProperty('transition', 'none');
      t.style.zIndex = z;
      void t.offsetWidth; // apply it now, before the transition comes back
      t.style.removeProperty('transition');
    };
    stack('3003');
    setTimeout(function () { stack(''); }, 2600);
    try { if (window.toast) window.toast(msg); } catch (e) {}
  }

  // An existing user (already in a household) who ALSO has a pending invite to a different family:
  // surface it after boot so they can accept it, instead of it silently sitting pending forever.
  function maybePromptPendingInvite() {
    var inv = window.LL && window.LL.pendingInvite;
    if (!inv || (window.LL && window.LL.needsIdentity)) return;
    window.LL.pendingInvite = null; // one-shot
    if (!window.confirmSheet) return;
    // Who sent it, drawn as data (inviteFacts): the same rule as the newcomer's sheet.
    var f = inviteFacts(inv);
    var ask = function (empty) {
      // HONEST: joining overwrites users/{uid}.householdId, and there is no in-app way back to the old
      // one (a household switcher is not built). The old data is not deleted, but it becomes
      // unreachable from here. The previous copy promised "you can switch back", which reads as data
      // loss to a tester who joins and then can't find their own baby. Say what actually happens.
      // When there is nothing in hers to leave behind (ownCubbyIsEmpty), the warning would only
      // frighten her for nothing, so she is told that instead.
      var body = (empty
        ? 'Join this family circle? You’ll move into their Cubby. Yours is still empty, so nothing is left behind.'
        : 'Join this family circle? You’ll switch to their Cubby on this account. Your own Cubby isn’t deleted, but you won’t be able to open it from here afterwards, so only join if you’re ready to switch for good.')
        + (f.senderProven ? '' : ' This invite doesn’t say who sent it, so only join if you were expecting one.');
      if (window.confirmSheet.drawsFacts !== true && f.factRows.length) body = factsAsText(f.factRows) + ' ' + body;
      window.confirmSheet({
        title: 'You’ve been invited',
        facts: f.factRows,
        body: body,
        confirmLabel: 'Join the family',
        cancelLabel: 'Not now',
        onConfirm: function () { joinPendingInvite(inv); },
        // Another family's invite, if there is one, is offered next; nothing is thrown away by
        // "Not now". Only her own tap moves on: a sheet closed by something else leaves the rest
        // for the next launch rather than opening over whatever closed it.
        onCancel: function (how) { if (how === 'cancel') offerNextPendingInvite(); }
      });
    };
    ownCubbyIsEmpty().then(ask, function () { ask(false); });
  }
  function offerNextPendingInvite() {
    var q = (window.LL && window.LL.pendingInviteQueue) || [];
    if (!q.length) return;
    window.LL.pendingInvite = q.shift();
    window.LL.pendingInviteQueue = q;
    setTimeout(maybePromptPendingInvite, 300);
  }
  /* Is her own Cubby still empty, with nothing in it she would leave behind by moving? No baby, no
     logs, no journey (or kept memories of one), no notes or photos or anything else kept, and nobody
     else in it. Read from the server where the app holds only part of it (the logs load the last four
     months first; the journey and the notes have their own listeners), and any doubt, a failed read or
     an offline phone, answers no, so the warning stays. "Nothing is left behind" has to be true. */
  async function ownCubbyIsEmpty() {
    var me = auth.currentUser;
    if (!me || !hhRef) return false;
    var people = Object.keys(window.LL.members || {});
    if (people.length !== 1 || people[0] !== me.uid) return false;
    if ((state.babies || []).length || (state.events || []).length || state.pregnancy || (state.pregnancyArchive || []).length) return false;
    var kept = ['notes', 'photos', 'milestones', 'meds', 'illnesses'].some(function (k) { return (state[k] || []).length > 0; });
    if (kept || state.handoff) return false;
    try {
      var reads = await Promise.all([
        hhRef.collection('events').limit(1).get({ source: 'server' }),
        hhRef.collection('photos').limit(1).get({ source: 'server' }),
        // Notes are read the way the rules let anyone read them: her own, and any left to the circle.
        hhRef.collection('notes').where('createdBy', '==', me.uid).limit(1).get({ source: 'server' }),
        hhRef.collection('notes').where('audience', '==', 'circle').limit(1).get({ source: 'server' })
      ]);
      if (reads.some(function (q) { return q.size > 0; })) return false;
      var journey = await hhRef.collection('pregnancy').doc(me.uid).get({ source: 'server' });
      return !journey.exists;
    } catch (e) { return false; }
  }
  async function joinPendingInvite(inv) {
    try {
      var user = auth.currentUser; if (!user || !inv || !inv.householdId) return;
      // A link invite claims first: the claim is the single-use gate. If someone else already walked
      // through this link between the offer and the tap, stop here rather than joining anyway.
      if (inv.viaLink) {
        if (!(await claimInviteLink(inv, user))) {
          // Used, expired, or into a family that has closed. Any of those means: ask for another.
          try { if (window.toast) window.toast('That invite link no longer works. Ask them for a fresh one.'); } catch (e2) {}
          return;
        }
        try { if (window.toast) window.toast('Joined the family'); } catch (e2) {}
        setTimeout(function () { try { location.reload(); } catch (e2) {} }, 500);
        return;
      }
      await joinByEmailInvite(user, inv);
      writeOwnMemberEmail(inv.householdId); // PRIV-2: email goes to the gated doc, not memberInfo
      await db.collection('users').doc(user.uid).set({ householdId: inv.householdId }, { merge: true });
      try { if (window.toast) window.toast('Joined the family'); } catch (e) {}
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 500);
    } catch (e) {
      console.warn('join invite', e);
      // Refused by the rules: the invite was withdrawn, or the family has closed. Trying again won't help.
      var gone = e && e.code === 'permission-denied';
      /* And the invite is dead. Kept, it was offered on every launch and refused every time. It is hers
         to throw away (the rules let you delete the one addressed to you), as the newcomer's "Start my
         own Cubby" already does. Bounded, so a bad connection cannot hold the message back. */
      if (gone && inv && !inv.viaLink) {
        var mine = ((auth.currentUser && auth.currentUser.email) || '').toLowerCase();
        if (mine) {
          // This family's invite only: another family's is still hers to be asked about.
          await Promise.race([declineOffer(mine, inv),
            new Promise(function (r) { setTimeout(r, 3000); })]);
        }
      }
      try { if (window.toast) window.toast(gone ? 'That invite is no longer open. If you were expecting it, ask them to invite you again.' : 'Couldn’t join just now. Mind trying again?'); } catch (e2) {}
      if (gone) offerNextPendingInvite();
    }
  }

  /* For the usage tracker (app/cubby-track.js, PRIV-4): has this person's family record been seen AS THE
     SERVER HOLDS IT? Firestore answers first from this phone's own copy, which can be a day old, and a loss
     holding set on another phone (Papa ends the pregnancy and her holding is seeded) arrives only with the
     server's copy. So for a signed-in person the tracker sends nothing until window.__cubbyHouseholdSeen
     names her uid, set below once a household snapshot from the server, with nothing of this phone's own
     pending, has been applied. '*' is the local-only test page (?e2e=1), which has no family record for
     anyone; '' is nobody yet. A person this never names (no family, or a read that failed) is held: what the
     tracker recorded waits on the phone for an open where it is said. */
  function householdSeen(who) {
    window.__cubbyHouseholdSeen = who;
    // What waited for it goes now (or, if the server's copy brought her holding, is dropped now).
    try { if (who && typeof window.cubbyTrackFlush === 'function') window.cubbyTrackFlush(); } catch (e) {}
  }

  function startSync(hid, user) {
    householdSeen('');
    syncUid = user.uid;
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
    // What a quick close left unsent (see flushPendingPush). Each half is put back by the first snapshot
    // it belongs to; the stored copy goes once both are back in memory, where the next hide saves them again.
    var outbox = readOutbox(user.uid, hid);
    replayEv = (outbox && outbox.events) || null; replayHold = (outbox && outbox.blob) || null;
    if (replayHold && !Object.keys(replayHold).length) replayHold = null;
    function outboxBack() { if (outbox && !replayEv && !replayHold && hhHydrated) { outbox = null; dropOutbox(user.uid, hid); } }

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
      // mhealth), then strips it from the shared blob. Done once, by the phone whose move it is
      // (legacyJourneyMovedHere).
      maybeMigrateLegacyJourney();
      hideOverlay();
      render();
      try { if (typeof window.cubbyAppOpened === 'function') window.cubbyAppOpened(); } catch (e) {}
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
      watchOwnerLinks(d); // lane B, D1: owner-only link tokens, and the owner's device tidies the link rows
      var sig = hhSig(d.app, d.members, d.memberInfo) + '|' + JSON.stringify(d.pro || null);
      if (booted && sig === lastHhSig) return; // our own write echo / duplicate emission, already on screen
      lastHhSig = sig;
      var held = holdPendingBlobEdits(); // edits still waiting to be pushed, taken BEFORE the server's copy lands on them
      if (replayHold) { held = Object.assign({}, replayHold, held || {}); replayHold = null; pushWhenHydrated = true; } // a quick close's unsent blob edits
      applyingRemote = true; applyAppBlob(d.app); applyingRemote = false;
      var keptBase = held ? reapplyPendingBlobEdits(held) : null;
      ensureMaternalListeners(user.uid); // (re)subscribe once we know whose pregnancy it is
      migrateHandoffToNote(); // role + handoff are now known; fold any legacy shared note in once
      gotApp = true;
      /* The blob is now server-state-plus-our-local-overrides, which is exactly what a no-op push
         would write, so it is the right baseline to diff the next push against. Taken AFTER
         applyAppBlob rather than from d.app directly, because the round trip legitimately differs:
         theme and push are per-device and stripped on the way out. */
      blobBase = snapshotBlobBase();
      // A held key's baseline is the server's copy, not its merged value, so the pending push still finds
      // what the merge kept on top of it dirty and writes it.
      if (keptBase) Object.keys(keptBase).forEach(function (k) { blobBase[k] = keptBase[k]; });
      hhHydrated = true;
      outboxBack();
      if (pushWhenHydrated) { pushWhenHydrated = false; scheduledPush(); }
      if (booted) { maybeMigrateLegacyJourney(); rerender(); } else maybeBoot(); // the move retries here if it could not finish
    }, function (e) {
      console.warn('household listen', e);
      // Removed from the family (or the household was deleted): the doc becomes unreadable, so the
      // boot would otherwise hang on the loader forever (gotApp never flips). Confirm it's a real
      // access loss (not a transient token blip) with a one-shot get, then show a calm recovery
      // screen instead of an infinite spinner.
      if (e && e.code === 'permission-denied' && !accessLostShown) {
        /* The ref as it was when the listener died. Deleting your own account clears hhRef inside
           this 1.5s, and reading the global then threw an uncaught "Cannot read properties of null". */
        var refAtLoss = hhRef;
        /* And only while the page still has that family open. An account deletion that stops at the login
           signs her out (teardown clears hhRef), and this re-check, landing after, read the family as refused
           and put the note up over the sign-in screen, taking that screen away (hideOverlay) and leaving the
           app showing with nobody signed in (tools/usage_tracker_check.js S23b). */
        setTimeout(function () {
          if (accessLostShown || !refAtLoss || deletingAccount || refAtLoss !== hhRef) return;
          refAtLoss.get().then(function () {}).catch(function (err) { if (err && err.code === 'permission-denied' && refAtLoss === hhRef) showAccessLost(); });
        }, 1500);
      }
    }));
    /* PRIV-4: the same document again, for its metadata only. It shares the listener above's watch (no extra
       reads), and unlike that one it is told when the server's copy arrives even if that copy matches the
       cached one. Registered after it, so when the server's copy did change, the listener above has applied
       it (a loss holding with it) before this one reports.
       Only a copy with nothing of this phone's own pending counts. With a write this phone made offline,
       answered before the server's reply to the listen reaches the phone, Firestore's first copy after
       reconnecting is marked fromCache false while that write still shows as pending, and it does not hold
       the server's newer changes: a holding seeded overnight is not in it. The copy after it, with nothing
       pending, is the server's. Seen on the emulator in most unstaged runs; tools/usage_tracker_check.js
       S20 stages that delivery order every time.
       A listen that fails reports nothing: the tracker keeps holding, and what it recorded waits on the phone
       for the next open. */
    var serverSeen = false, offServerSeen = null;
    offServerSeen = hhRef.onSnapshot({ includeMetadataChanges: true }, function (snap) {
      if (serverSeen || !snap || !snap.metadata || snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
      serverSeen = true;
      try { if (offServerSeen) offServerSeen(); } catch (e) {}
      householdSeen(user.uid);
    }, function () {});
    unsub.push(offServerSeen);

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
    // Anything that answers a question about all of history (first tastes, the allergen block on the
    // visit summary) has to know that "never" currently means "not in the last four months". Set
    // here, cleared the moment the full read lands or fails; a local-only account never sets it.
    window.cubbyHistoryPending = true;
    function hydrateFullHistory() {
      if (hydratedHistory) return; hydratedHistory = true;
      /* This read can still be out when she signs out (teardown nulls eventsRef) or another family is attached
         (startSync makes a new eventsRef). What it brings back then is the family she left: none of it goes into
         memory, knownEvents or serverAuthor, where the next save with no family attached would write it into this
         phone's record, and its failure says nothing about the next family's history, whose pending flag is its
         own (docs/postmortems/2026-11-19-pre-sign-in-data-reaches-next-account.md, case H). */
      var histRef = eventsRef;
      histRef.get().then(function (snap) {
        if (histRef !== eventsRef) return;
        applyingRemote = true; var added = 0;
        snap.forEach(function (doc) {
          var eid = ingestId(doc.id);
          if ((state.events || []).some(function (e) { return String(e.id) === String(eid); })) return; // recent: owned by the live listener
          var data = ing().event(doc.data(), eid);
          (state.events = state.events || []).push(data);
          knownEvents[eid] = JSON.stringify(stripMeta(data)); noteServerAuthor(eid, data); added++;
        });
        applyingRemote = false;
        window.cubbyHistoryPending = false;
        if (gotApp && hhRef && hhRef.id === hid) letGoOfHeldHere(); // all of this family is known now: what it holds leaves the phone's record
        if (booted) rerender(); // even with nothing added: surfaces that were waiting can now answer
      }).catch(function (e) { if (histRef === eventsRef) window.cubbyHistoryPending = false; console.warn('events hydrate', e); });
    }
    function subscribeEvents(query, isFallback) {
      return query.onSnapshot(function (snap) {
        applyingRemote = true;
        snap.docChanges().forEach(function (ch) {
          var data = ing().event(ch.doc.data(), ingestId(ch.doc.id));
          if (ch.type === 'removed') {
            state.events = (state.events || []).filter(function (e) { return String(e.id) !== String(data.id); });
            delete knownEvents[data.id]; delete serverAuthor[data.id];
          } else {
            var i = (state.events || []).findIndex(function (e) { return String(e.id) === String(data.id); });
            if (i >= 0) state.events[i] = data; else (state.events = state.events || []).push(data);
            knownEvents[data.id] = JSON.stringify(stripMeta(data)); noteServerAuthor(data.id, data);
          }
        });
        applyingRemote = false;
        gotEvents = true;
        if (replayEv) { var re = replayEv; replayEv = null; if (replayOutboxEvents(re)) scheduledPush(); outboxBack(); } // a quick close's unsent entries
        if (isFallback) window.cubbyHistoryPending = false; // unbounded listener: this IS all of it
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
        var pid = ingestId(ch.doc.id);
        var bytes = ch.type === 'removed' ? '' : ing().photo(ch.doc.data().data);
        if (!bytes) {
          delete circlePhotoIds[pid];
          // A migrated pregnancy photo leaves the circle collection while its bytes live on
          // in the gated subcollection — don't blank it out from under the owner's screen.
          if (!PhotoStore.privIds[pid]) delete PhotoStore.map[pid];
        } else {
          circlePhotoIds[pid] = 1;
          PhotoStore.map[pid] = bytes;
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
        var d = ing().note(ch.doc.data(), ingestId(ch.doc.id));
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
  // The inviter as a newcomer would know them: first name, else the sign-in name, else the bear label.
  function inviterName() {
    var u = auth.currentUser; if (!u) return '';
    var m = ((window.LL && window.LL.memberInfo) || {})[u.uid] || {};
    return (m.name ? String(m.name).split(' ')[0] : '') || (u.displayName || '').split(' ')[0] || m.relationship || '';
  }
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
    try { await notesRef.doc(docKey(id)).delete(); dropNote(id); return true; }
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
    try { await notesRef.doc(docKey(id)).update({ deleted: true, deletedAt: at }); n.deleted = true; n.deletedAt = at; return true; }
    catch (e) { console.warn('softDeleteNote', e); return false; }
  };
  window.LL.restoreNote = async function (id) {
    if (!notesRef || !id) return false;
    var u = auth.currentUser; if (!u) return false;
    var n = (state.notes || []).find(function (x) { return String(x.id) === String(id); });
    if (!n || (n.createdBy && n.createdBy !== u.uid)) return false; // only your own
    try { await notesRef.doc(docKey(id)).update({ deleted: false, deletedAt: null }); delete n.deleted; delete n.deletedAt; return true; }
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
          notesRef.doc(docKey(n.id)).update({ pinned: false })
            .catch(function (e) { console.warn('setNotePinned', e); n.pinned = true; rerender(); });
        }
      });
    }
    var was = !!target.pinned;
    target.pinned = !!pinned;
    notesRef.doc(docKey(id)).update({ pinned: !!pinned })
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
        var n = noteEvWrite(id, knownEvents[id]);
        knownEvents[id] = ser;
        writes.push(eventsRef.doc(docKey(id)).set(Object.assign({}, cur[id], { authorId: authorToWrite(id, cur[id], uidNow) }))
          .then(function () { settleEvWrite(id, n, ser); })
          .catch(function (e) { if (knownEvents[id] === ser) delete knownEvents[id]; throw e; }));
      }
    });
    Object.keys(knownEvents).forEach(function (id) {
      if (!cur[id]) {
        var oldSer = knownEvents[id], n = noteEvWrite(id, oldSer); delete knownEvents[id];
        writes.push(eventsRef.doc(docKey(id)).delete()
          .then(function () { settleEvWrite(id, n, undefined); })
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
      /* Firestore refuses some values (undefined, above all) by THROWING inside update(), not by
         rejecting. Thrown here, it escaped this async function as an unhandled rejection: no toast, no
         retry, and since the same key stayed dirty, every later blob save from this phone died the same
         silent way (review R3). A refusal is a refusal, however it arrives: it takes the catch below. */
      var hhWrite;
      try { hhWrite = hhRef.update(upd); } catch (e) { hhWrite = Promise.reject(e); }
      blobOut++;
      writes.push(hhWrite.then(function () {
        blobOut = Math.max(0, blobOut - 1);
        /* Only now is the server known to hold these. A write that never left this phone (the
           synchronous throw above) leaves the baseline alone, so the retry sends the same keys.
           A write the RULES refuse is different, and is NOT retried: Firestore shows it on this
           phone at once (latency compensation), that local snapshot re-baselines the key with the
           edit in it, and the snapshot that reverts the refusal then finds nothing dirty. The edit
           is gone from this phone and from every later push (review A-V3). Known and accepted; a
           refusal here means a removed member or a household a legacy key still blocks. */
        if (blobBase) dirty.forEach(function (p) { blobBase[p[0]] = p[1]; });
        if (outboxSaved) saveOutbox(); // landed while hidden: the outbox no longer owes it
      }, function (e) { blobOut = Math.max(0, blobOut - 1); throw e; }).catch(function (e) { lastHhSig = null; throw e; }));
    }
    try {
      await Promise.all(writes);
      pushNow._retryDelay = 0; pushNow._fails = 0;
    } catch (e) {
      console.warn('push', e);
      var nowMs = Date.now();
      // permission-denied is NOT offline: for a removed member "we'll try again" is a lie. Say what
      // actually happened and where the door is; offline keeps its honest, patient message.
      var denied = !!(e && e.code === 'permission-denied');
      pushNow._fails = (pushNow._fails || 0) + 1;
      if (!pushNow._warnedAt || nowMs - pushNow._warnedAt > 120000) { // gentle: at most one toast per 2 min
        pushNow._warnedAt = nowMs;
        try {
          var code = String((e && e.code) || '');
          if (window.cubbyTrack) window.cubbyTrack('save.failed', { error: denied ? 'permission_denied' : /unavailable/.test(code) ? 'unavailable' : /deadline/.test(code) ? 'deadline'
            : /resource-exhausted/.test(code) ? 'quota' : /too large|exceeds/i.test(String(e && e.message)) ? 'too_large' : 'other', retries: Math.min(50, pushNow._fails - 1), offline: navigator.onLine === false ? 'yes' : 'no' });
        } catch (e3) {}
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

  /* ---------- a quick close keeps what she just logged (chaos CH-bd7f70) ----------
     With a household, logging writes nothing on the phone: persist() only arms the 350 ms push above.
     An entry logged and then the app reloaded, closed or swiped away inside that window was lost from
     the server AND from her phone, with nothing to say so. Two halves:
     1. The moment the page is hidden or torn down, the waiting push goes NOW (flushPendingPush).
        Switching away (visibilitychange to hidden) leaves the page alive long enough for Firestore to
        keep the writes in its offline queue, and that queue sends them now or the next time Cubby opens.
        Her journey, private health and kept memories are issued here too: pushNow writes them only
        after the server has answered, which a phone that suspends the page may never let it hear.
     2. A reload or a close does NOT leave that time. Firestore's queue lives in IndexedDB, and a write
        issued while the page is being torn down never commits there (staged on the emulator: the
        entry was gone after a reload 40 ms later, with the flush in place). So the same moment also
        writes an OUTBOX to localStorage, which is synchronous: every entry write the server has not
        acknowledged, and every blob key whose push has not landed, each with the version the server
        held before (its base). The next boot puts back only what has not moved since: an entry whose
        copy on this phone still equals its base, and blob keys through the same three-way merge a
        snapshot uses for a pending edit. A write Firestore did keep, or a change another phone made
        since, is left exactly as it is. The outbox is per person and household, cleared when the page
        is visible again, when the writes in it land, and at sign-out, and read once at boot.
     Not in the outbox, said plainly: her journey and private health docs (written whole, by her own
     phone only). A reload within 350 ms of a journey edit can still lose that edit. Kept memories have
     their own synchronous cache (scheduledPush). */
  function evCanon(ser) { try { return ser === undefined ? null : stableStringify(JSON.parse(ser)); } catch (e) { return null; } }
  // pushNow, as it issues an entry write: the first unacknowledged write of an entry keeps the version
  // the server held before it as the base; a later one keeps that base.
  function noteEvWrite(id, prevSer) {
    var u = unackedEv[id] || (unackedEv[id] = { baseSer: evCanon(prevSer), n: 0 });
    return ++u.n;
  }
  // When the server acknowledges one: nothing is owed, or, if a later write of it is still out, the
  // server now holds this one, which becomes that later write's base.
  function settleEvWrite(id, n, ser) {
    var u = unackedEv[id];
    if (!u) return;
    if (u.n === n) delete unackedEv[id]; else u.baseSer = evCanon(ser);
    if (outboxSaved) saveOutbox();
  }
  function outboxKey(uidNow, hid) { return 'cubby-outbox:' + uidNow + ':' + hid; }
  function buildOutbox() {
    var cur = {}, events = {}, blob = {}, any = false;
    (state.events || []).forEach(function (e) { cur[e.id] = e; });
    Object.keys(unackedEv).forEach(function (id) { events[id] = { baseSer: unackedEv[id].baseSer, evData: cur[id] || null }; any = true; });
    // Only what pushNow owes: a push waiting or out. A key that differs with nothing pending (render code
    // adds empty timer entries without a save) is not an edit, and is not carried into the next boot.
    if (blobBase && (pushTimer || pushWhenHydrated || blobOut > 0)) {
      var b = appBlobFromState();
      Object.keys(b).forEach(function (k) {
        if (blobBase[k] === stableStringify(b[k])) return;
        blob[k] = { base: blobBase[k], local: state[k], blobValue: b[k] }; any = true;
      });
    }
    // Read at boot and not put back yet (its first snapshot has not come): carried over as it was.
    if (replayEv) Object.keys(replayEv).forEach(function (id) { if (!events[id]) { events[id] = replayEv[id]; any = true; } });
    if (replayHold) Object.keys(replayHold).forEach(function (k) { if (!blob[k]) { blob[k] = replayHold[k]; any = true; } });
    return any ? { v: 1, at: Date.now(), events: events, blob: blob } : null;
  }
  function saveOutbox() {
    var u = auth.currentUser;
    if (!u || !hhRef || !hhHydrated) return;
    try {
      var ob = buildOutbox(), key = outboxKey(u.uid, hhRef.id);
      if (ob) localStorage.setItem(key, JSON.stringify(ob)); else localStorage.removeItem(key);
      outboxSaved = !!ob;
    } catch (e) {}
  }
  function dropOutbox(uidNow, hid) {
    outboxSaved = false;
    if (uidNow && hid) { try { localStorage.removeItem(outboxKey(uidNow, hid)); } catch (e) {} }
  }
  function readOutbox(uidNow, hid) {
    var ob = null;
    try { ob = JSON.parse(localStorage.getItem(outboxKey(uidNow, hid)) || 'null'); } catch (e) {}
    return ob && typeof ob === 'object' && ob.v === 1 ? ob : null;
  }
  // At boot, once the first entries snapshot is applied (from this phone's cache): put back each entry
  // whose copy here still equals the base it was saved with. Returns how many it put back.
  function replayOutboxEvents(saved) {
    var put = 0;
    Object.keys(saved || {}).forEach(function (id) {
      var o = saved[id];
      if (!o || typeof o !== 'object') return;
      if (evCanon(knownEvents[id]) !== (o.baseSer === undefined ? null : o.baseSer)) return; // it moved: landed, or changed elsewhere
      var list = state.events = state.events || [];
      var i = list.findIndex(function (e) { return String(e.id) === String(id); });
      if (o.evData && typeof o.evData === 'object') { if (i >= 0) list[i] = o.evData; else list.push(o.evData); }
      else if (i >= 0) list.splice(i, 1); // a delete that never landed
      else return;
      put++;
    });
    return put;
  }
  function flushPendingPush() {
    if (pushTimer) {
      clearTimeout(pushTimer); pushTimer = null;
      var pushed = pushNow(); // issues every entry and blob write before its first await, so all of them in this tick
      if (pushed && pushed.catch) pushed.catch(function (e) { console.warn('push on hide', e); });
      var u = auth.currentUser && auth.currentUser.uid;
      if (u && hhRef && hhHydrated) { syncPregJourney(u); syncMaternal(u); syncPregArchive(u); } // each skips what it already sent
    }
    saveOutbox();
  }
  function flushOnPageHide(win, doc) {
    // Capture, so it runs before Firestore's own pagehide handler queues its shutdown behind these writes.
    win.addEventListener('pagehide', flushPendingPush, true);
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') flushPendingPush();
      else if (outboxSaved) { var u = auth.currentUser; dropOutbox(u && u.uid, hhRef && hhRef.id); } // alive again: memory is the record
    });
  }
  flushOnPageHide(window, document);

  // Swap the app's persistence + photo storage for the cloud versions.
  // With no household there is nowhere to push: pushNow returns on the spot, so before this a woman
  // tracking on her own before she signs in or joins a circle wrote nothing anywhere and lost every
  // edit on reload. Her period starts now feed the fertile window and the "update your period"
  // card, so that loss is not cosmetic. The local blob is the record until a household exists, and
  // it is the same blob buildMigrationPayload reads at first sign-in. Once hhRef is set the cloud
  // is the record and nothing is written locally, exactly as before.
  persist = async function () {
    if (!hhRef) { try { await Store.save(state); } catch (e) {} }
    scheduledPush();
  };

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
  /* Can this person tick the shared preparation checklist? True for the owner, true for anyone the
     journey is shared with until a write is actually refused, and true with no cloud at all (solo
     on one device). index.html renders the list read-only whenever this is false, so a partner is
     never handed a control that will not hold. */
  window.LL.preconCanWrite = function () {
    var u = auth.currentUser, p = state.pregnancy;
    if (!u || !p) return true;
    if (!p.ownerUid || p.ownerUid === 'local' || p.ownerUid === u.uid) return true;
    return !preconDenied;
  };
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
    knownPrecon = stableStringify(data.precon || []);
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
    pregShared = []; knownPregJourney = null; knownPrecon = null; pregOwner = null;
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
  /* A deletion that stops once she has left her family, with only the login itself left (Firebase asked at the
     very end for a sign-in she closed, or the connection went at that step), signs her out (Nov 2026). Kept
     signed in, she was left on this phone's copy of a family she had already left: anything she logged there
     vanished, refused, under "If you've been removed from this circle, sign out and back in", and keeping that
     page usable for a retry took a ledger of what each earlier attempt had done (the family she left, whether
     her purge was asked, whether the "no longer in this family" note may show), which still left her stuck.
     Signed out, the retry is one clean path whatever stopped: she signs in, which is a fresh sign-in, so
     nothing asks again, and deletes; each attempt starts from what the server holds. The sign-in screen says
     what is left (app/index.html doDeleteAccount, window.LL.signInNote above).
     Nothing of the family she left travels into her next Cubby: a sign-in with no family of hers makes one
     from this phone's local copy (buildMigrationPayload), which step 4 deleted, and from what this phone
     holds in memory, which is emptied here, so anything that saves locally from now on saves an empty family.
     Its entries go, and its settings with them: the family's name and its Pro taste counts came back as her
     new Cubby's own (Nov 2026). Only the units are kept (ml or oz, kg or lb and the like): how she reads
     amounts, nothing about that family. The theme and reminders are this phone's own, and applyAppBlob keeps
     them. Nothing waiting to be pushed is pushed (LL.signOut would flush it,
     into a family that now refuses her).
     tools/usage_tracker_check.js S23 and S23b drive it under this tree's firestore.rules. */
  var UNIT_KEYS = ['unit', 'wUnit', 'hUnit', 'hcUnit', 'tempUnit'];
  function dropFamilyFromMemory() {
    var units = {}, was = state.settings || {};
    UNIT_KEYS.forEach(function (k) { if (was[k] != null) units[k] = was[k]; });
    applyAppBlob({ settings: units }); state.events = []; state.activeBabyId = null;
  }
  /* Every sign-out from a family empties this phone's memory of it the same way: Log out (LL.signOut), a
     deletion that stopped (above), and a sign-out that arrives from elsewhere (another tab, a revoked session).
     Only the deletion stop used to; the others left the family's babies and entries in memory, and
     the next save with no family attached wrote them into this phone's record (persist), where the next account
     to sign in here with no family of its own was given them: copied into her new family, or, carrying entries
     the rules refuse her, a sign-in that never finished and a half-made family holding them. Her screen showed
     them meanwhile (docs/postmortems/2026-11-19-pre-sign-in-data-reaches-next-account.md).
     A sign-out from elsewhere lands after auth has gone, so LL.signOut's flush never ran: what this phone still
     owed the family is put into HER outbox first (keyed by her uid and that family; startSync replays it to her
     alone at her next sign-in), so emptying memory loses nothing of hers. Never for an account being deleted
     (its own sign-out lands here too): nothing of hers is kept on the phone. */
  function leaveFamily() {
    if (!auth.currentUser && syncUid && hhHydrated && !deletingAccount) saveOwedFor(syncUid);
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    try { dropFamilyFromMemory(); } catch (e) {}
  }
  // The entries pushNow would have written (its own diff), marked owed so buildOutbox carries them, then saved.
  function saveOwedFor(uid) {
    try {
      var cur = {};
      (state.events || []).forEach(function (e) { cur[e.id] = e; });
      Object.keys(cur).forEach(function (id) { if (knownEvents[id] !== JSON.stringify(stripMeta(cur[id]))) noteEvWrite(id, knownEvents[id]); });
      Object.keys(knownEvents).forEach(function (id) { if (!cur[id]) noteEvWrite(id, knownEvents[id]); });
      var ob = buildOutbox();
      if (ob) localStorage.setItem(outboxKey(uid, hhRef.id), JSON.stringify(ob));
    } catch (e) {}
  }
  async function signOutAfterStop() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    try { dropFamilyFromMemory(); } catch (e) {}
    teardown();
    try { await auth.signOut(); } catch (e) { console.warn('sign-out after a deletion stopped at the login', e && (e.code || e.message)); }
  }
  /* Does the server refuse her this family's record? Every member may read it (firestore.rules, isMember), so a
     refusal from the server, never the phone's cache, means she is no longer in it, or it no longer exists. */
  async function refusedHere(ref) {
    try { await ref.get({ source: 'server' }); return false; }
    catch (e) { return !!(e && e.code === 'permission-denied'); }
  }
  window.LL.isDeletingAccount = function () { return deletingAccount; };
  window.LL.deleteAccount = async function () {
    var u = auth.currentUser;
    if (!u) throw deletionStage(new Error('not_signed_in'), 'nothing');
    var uid = u.uid;
    var email = (u.email || '').toLowerCase();
    // A recent sign-in first, or none of what follows starts (see freshSignIn).
    try { await freshSignIn(u); } catch (e) { throw deletionStage(e, 'nothing', uid); }
    // Removing ourselves from members makes the household snapshot fire "you were removed". Suppress
    // that mid-deletion so the calm access-lost screen can't race the flow we are already running.
    deletingAccount = true;
    /* app/cubby-track.js sends nothing more, and keeps nothing it had queued, from here on. Set only now
       that a deletion has really started (AR-1): a call refused at the door above used to set it first and
       leave it set, so the tracker stayed silent for the rest of the page. What happens to it when the
       deletion does not finish is decided in the catch below. */
    window.__cubbyDeleting = true;
    var loginLeft = false;

    try {
      /* 0. Families she is no longer in (D2). Removed by an owner, her journey, private health and
         pregnancy photos stayed under that family, readable by whoever she had shared them with, and
         deleting her account used to leave them there: it only ever looked in the family it had open.
         The rules let her own uid delete exactly those without membership, so they go first, before
         anything else (private records first is this function's rule). Under the rules published
         before that, the deletes are refused and the rest carries on as it always did. lostHere is the
         family this phone still has open after "you're no longer in this family": there is nothing to
         leave there, so steps 1 and 2 skip it. Asked of the server, not assumed from the note: only a
         family that really refuses her is skipped (and step 2 asks again when its leave is refused). */
      var lostHere = null;
      if (hhRef && accessLostShown && await refusedHere(hhRef)) lostHere = hhRef;
      var formerIds = [];
      try {
        var meSnap = await db.collection('users').doc(uid).get();
        formerIds = ((meSnap.exists && meSnap.data().formerHouseholdIds) || []).slice();
      } catch (e) { console.warn('former families', e && e.code); }
      if (lostHere && formerIds.indexOf(lostHere.id) < 0) formerIds.push(lostHere.id);
      var openId = (hhRef && !lostHere) ? hhRef.id : null;
      for (var fi = 0; fi < formerIds.length; fi++) {
        if (!formerIds[fi] || formerIds[fi] === openId) continue;
        var formerRef = db.collection('households').doc(String(formerIds[fi]));
        try { await deleteOwnRecords(formerRef, uid); } catch (e) { console.warn('del records in a former family', e && e.code); }
        // Her gated email there goes too (self-delete has never needed membership).
        try { await formerRef.collection('memberEmails').doc(uid).delete(); } catch (e) {}
      }

      // 1. Private records FIRST. Their rules require membership, so once we drop out of members we
      //    could never reach them again — they would sit in the household forever, unreadable by
      //    everyone including her, but still stored. That is the exact failure the existing
      //    removeMember() path already has for a removed member.
      if (hhRef && !lostHere) {
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
      /* Lane B, D4: decided on the family AS THE SERVER HOLDS IT, in a transaction, not on what this
         phone last saw. When the owner (handing over) and her heir (leaving) deleted their accounts
         at the same moment, each wrote from a stale picture: the departed heir came back as owner,
         or nobody was left and no deletion was scheduled, so the purge never came. A transaction
         re-reads the family and is retried if anyone else's write lands in between, so the second
         one out sees she is the last one out. The rules refuse both stale shapes too, for an older
         build. Deleting an account needs the network anyway, so a transaction costs nothing here.
         The last one out schedules the deletion 30 days after the SERVER's clock (what the privacy
         page promises), so a phone whose clock is wrong cannot move it. That clock and her
         withdrawn invites are fetched outside the transaction, and the transaction is run again.
         A family that already refuses her (lostHere, step 0) has nothing to leave and is skipped. */
      if (hhRef && !lostHere) {
        var leaveRef = hhRef, prep = { serverNow: 0, invitesWithdrawn: false }, out = null, refused = null;
        for (var round = 0; round < 5; round++) {
          try {
            out = await db.runTransaction(async function (tx) {
              var snap = await tx.get(leaveRef);
              var d = (snap.exists && snap.data()) || {};
              var members = d.members || {};
              // Removed meanwhile: nothing to leave. Only under rules that still let her read the family; these refuse
              // that read, and that refusal is settled after the rounds below.
              if (!Object.prototype.hasOwnProperty.call(members, uid)) return { gone: true };
              var others = Object.keys(members).filter(function (m) { return m !== uid; });
              var last = !others.length, owner = members[uid] === 'owner';
              if (last && (!prep.serverNow || (owner && !prep.invitesWithdrawn))) return { prepare: true, isOwner: owner, data: d };
              var mi = (d.memberInfo || {})[uid] || {};
              var del = firebase.firestore.FieldValue.delete();
              var upd = {};
              upd['members.' + uid] = del;
              upd['memberInfo.' + uid] = del;
              upd['formerMemberInfo.' + uid] = { name: '', relationship: mi.relationship || '', avatar: null };
              if (!last) {
                if (owner) {
                  var heir = pickHeir(others, members, d.memberInfo || {});
                  // A co-owner is already in charge: she only becomes ownerId, and nobody is promoted.
                  if (members[heir] !== 'owner') upd['members.' + heir] = 'owner';
                  upd.ownerId = heir;
                }
              } else {
                // Last one out. 30 days is a grace window, not retention: the cron hard-deletes after it,
                // and privacy/index.html states the window.
                upd.deleteAfter = prep.serverNow + 30 * 24 * 60 * 60 * 1000;
                upd.deletionRequestedBy = uid;
                if (owner && d.pendingInvites) upd.pendingInvites = del;
                if (owner && d.pendingLinks) upd.pendingLinks = del;
              }
              tx.update(leaveRef, upd);
              return { done: true };
            });
          } catch (e) {
            /* When the other phone's write lands between this read and this write, the rules judge
               this write against the family as it NOW is, and refuse it before Firestore's own
               "changed since you read it" check would have retried it. So read again and decide
               again; a refusal that is still there after that is settled below. */
            var again = e && (e.code === 'permission-denied' || e.code === 'aborted' || e.code === 'failed-precondition');
            if (!again) throw e;
            refused = e; out = null;
            continue;
          }
          if (!out || !out.prepare) break;
          /* Withdraw every invite and link she still has out, while she is still owner (the rules
             let an owner delete both). Left behind, they asked a newcomer to join a family that no
             longer exists, and Join could only fail. Best effort: the family is closing either way,
             and the rules refuse any join into a household flagged for deletion. The link tokens are
             in the owner-only ownerLinks docs (lane B, D1), which go too. */
          if (out.isOwner && !prep.invitesWithdrawn) {
            try {
              var hd = out.data || {}, outs = [];
              Object.keys(hd.pendingInvites || {}).forEach(function (em) {
                outs.push(db.collection('invites').doc(em).delete().catch(function () {}));
                outs.push(familyInviteRef(em, leaveRef.id).delete().catch(function () {})); // this family's own invite too
              });
              var tokens = {};
              Object.keys(hd.pendingLinks || {}).forEach(function (rk) { if (!isLinkRowId(rk)) tokens[rk] = 1; });
              try {
                var ols = await leaveRef.collection('ownerLinks').get();
                ols.forEach(function (od) {
                  var t = (od.data() || {}).token; if (t) tokens[t] = 1;
                  outs.push(od.ref.delete().catch(function () {}));
                });
              } catch (e2) { /* rules published before ownerLinks: every row is still keyed by its token */ }
              Object.keys(tokens).forEach(function (tk) { outs.push(db.collection('inviteLinks').doc(tk).delete().catch(function () {})); });
              await Promise.all(outs);
            } catch (e) { console.warn('withdraw invites', e && e.code); }
            prep.invitesWithdrawn = true;
          }
          if (!prep.serverNow) prep.serverNow = (await serverClockMs(uid)) || Date.now();
        }
        /* Refused every round. That is a write the rules will not take while she is still in the family
           (the caller hears it, and she is asked to try again), or a family that no longer lets her read it at
           all: her own leave reached the server and only its answer was lost (Firestore runs the transaction
           again, and that read is refused), or an owner removed her while this ran. Asked of the server, the
           second kind is certain (refusedHere): there is nothing left to leave, so her own records there go as
           a former family's do (step 0) and the deletion goes on. It used to stop here, "Could not finish
           deleting", on every retry on that page (tools/usage_tracker_check.js S24). */
        if ((!out || out.prepare) && refused && refused.code === 'permission-denied' && await refusedHere(leaveRef)) {
          try { await deleteOwnRecords(leaveRef, uid); } catch (e) { console.warn('del records in the family she is out of', e && e.code); }
          try { await leaveRef.collection('memberEmails').doc(uid).delete(); } catch (e) {}
        }
        // Never go on to delete the login while she is still in the family.
        else if (!out || out.prepare) throw refused || new Error('leave_not_written');
      }

      // 3. Everything keyed to them outside the household.
      if (email) {
        try { await db.collection('invites').doc(email).delete(); } catch (e) {}
        // Every family's own invite to her address as well: each is a document named by her address.
        try {
          var mineFrom = await db.collection('invites').doc(email).collection('from').get();
          await Promise.all(mineFrom.docs.map(function (dd) { return dd.ref.delete().catch(function () {}); }));
        } catch (e) { /* refused by the rules live before this change, which have none to delete */ }
      }
      try { await db.collection('waitlist').doc(uid).delete(); } catch (e) {}
      // users/{uid} carries the push tokens, so deleting it also stops delivery at the cron.
      // It also carries her kept-after-loss archive — deletion takes it along (correct: her
      // pregnancy photo bytes were purged above), and the device cache must not outlive it.
      try { await db.collection('users').doc(uid).delete(); } catch (e) { console.warn('del user doc', e); }
      try { localStorage.removeItem(pregArchCacheKey(uid)); } catch (e) {}
      try { if (window.cubbyDisableNativePush) await window.cubbyDisableNativePush(); } catch (e) {}
      // Guessing-game hubs live in D1, keyed by this uid, and rules do not reach them. So do her usage
      // rows and feedback notes (worker.js purgeAccountData).
      try {
        // From this line her usage rows may be gone from the server, whatever answer comes back (or none);
        // only step 5 is left after it, so a stop from here on is a stop at the login (see the catch).
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
      loginLeft = true;
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
      // Only the login left: she is signed out (see signOutAfterStop). Before the leave: still in her family.
      if (loginLeft) await signOutAfterStop();
      deletingAccount = false;
      /* AR-1: the tracker after a deletion that did not finish, decided here once.
         - It stopped before her usage rows were asked to go (the leave in step 2 refused: she is still in her
           family, still signed in, and is asked to try again). Nothing the tracker sent has been erased, so it
           carries on as before.
         - It stopped after (steps 3 and 4 never stop a deletion, so that is step 5, the login itself). She has
           just been signed out, and signing out ends the silence, as it always has (teardown): whoever signs in
           next is tracked as anyone is. Were the sign-out itself to fail she would still be the account she
           asked to delete, so nothing new is recorded under it until she signs out herself or the page reloads
           (tools/usage_tracker_check.js S21). No later attempt on this page can switch it back on before then:
           with her family torn down there is no leave left to refuse, so each one reaches step 5 or stops at the
           door, before this flag is touched. */
      if (!loginLeft || !auth.currentUser) window.__cubbyDeleting = false;
      throw deletionStage(e, loginLeft ? 'login' : 'partly', uid);
    }
  };
  // Who inherits the circle when a departing owner leaves others behind. We do not record a join
  // date anywhere, so "longest-standing" is not actually knowable — prefer a co-parent, which is
  // what the household means by a guardian, and fall back to a stable pick so two devices racing
  // the same deletion cannot promote two different people.
  function pickHeir(others, members, info) {
    // Lane B, D4: deleteAccount passes the family as its transaction read it; the defaults are the
    // last snapshot this phone saw.
    info = info || window.LL.memberInfo || {};
    members = members || window.LL.members || {};
    var sorted = others.slice().sort();
    /* Someone who is ALREADY an owner stays in charge. Promoting a caregiver beside a co-owner gave the
       caregiver the power to remove her, the very person the family had chosen to share control with. */
    var owners = sorted.filter(function (m) { return members[m] === 'owner'; });
    if (owners.length) return owners[0];
    // The app's own labels count: nobody picked "mother" from the list, they picked "Mama Bear".
    var parent = ['mother', 'mom', 'mama', 'father', 'dad', 'papa', 'parent', 'guardian', 'mama bear', 'papa bear'];
    var coParent = sorted.filter(function (m) {
      return parent.indexOf((((info[m] || {}).relationship) || '').toLowerCase()) >= 0;
    });
    return coParent.length ? coParent[0] : sorted[0];
  }

  /* The server's clock, in ms, or 0. Written as a server timestamp on her own users doc (self-only by
     rule, and deleted with the account a moment later), then read back from the server itself. */
  async function serverClockMs(uid) {
    try {
      var ref = db.collection('users').doc(uid);
      await ref.set({ clockProbe: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      var snap = await ref.get({ source: 'server' });
      var t = snap.exists ? snap.get('clockProbe') : null;
      return (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
    } catch (e) { return 0; }
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
    if (!wasPriv || circlePhotoIds[id]) { try { await photosRef.doc(docKey(id)).delete(); } catch (e) {} }
    var uidNow = auth.currentUser && auth.currentUser.uid;
    if (wasPriv && uidNow && hhRef) {
      try { await hhRef.collection('pregnancy').doc(uidNow).collection('photos').doc(docKey(id)).delete(); } catch (e) {}
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

  /* Fold a block away without taking it out of the DOM. The content is still built and still
     wired, so every id the caller wires afterwards is there whether the parent opens it or not,
     and nothing has to be re-rendered when she does. */
  function llFold(id, label, inner) {
    return '<details class="ll-fold" id="' + id + '"><summary>' + esc(label)
      + '<span class="ll-fold-c">›</span></summary><div class="ll-fold-b">' + inner + '</div></details>';
  }

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

  /* Which door the parent came in by, remembered so the modal's own reopens (cancel a link, cancel
     an invite, remove someone) rebuild the order she is standing in rather than snapping her back
     to the Settings layout mid-task. Settings passes nothing and therefore clears it. */
  var familyMode = '';
  function reopenFamily() { openFamily(familyMode); }

  /* Two doors into one modal. Settings is somewhere you go to look after your circle, so it opens
     on the circle. Every "Invite someone" button in the app belongs to a parent who has already
     decided, and it used to land her on the family portrait and her own name field with the
     one-tap share three blocks further down. openFamily('invite') reorders the SAME blocks: the
     link leads, and the slower ways are one tap away instead of gone. */
  function openFamily(mode, entry) {
    var me = auth.currentUser; if (!me) return;
    // The invite FORM opened. Anonymous; see cubbyStep in index.html.
    if (mode === 'invite' && typeof window.cubbyStep === 'function') {
      window.cubbyStep('invite.sheet_opened', { stage: window.funnelStage ? window.funnelStage() : 'none', entry_point: entry || 'other' });
    }
    try { if (mode === 'invite' && window.cubbyTrack) window.cubbyTrack('feature.used', { feature: 'invite', action: 'opened' }); } catch (_ut) {}
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
    var pendEmails = Object.keys(pendMap).filter(function (em) { return !joinedEmails[em]; }).sort();
    var pendRows = pendEmails.map(function (em) { return pendingEmailRow(em, pendMap[em] || {}); }).join('');

    /* Pending LINKS. Until now an owner could make a link, lose the share sheet, and have no way to
       tell whether it went — the modal still said "Just you so far". Expired ones are shown as
       expired rather than hidden, because "I sent that yesterday and heard nothing" deserves an
       answer on screen instead of silence. */
    // Keyed by row id (lane B, D1), or by the token for a row written before; the buttons carry the
    // row key and look the token up only when tapped (linkTokenFor), so no token sits in the page.
    var linkMap = (myRole === 'owner') ? (window.LL.hhPendingLinks || {}) : {};
    var linkRows = Object.keys(linkMap).sort(function (a, b) {
      return ((linkMap[b] || {}).at || 0) - ((linkMap[a] || {}).at || 0);
    }).map(function (rk) {
      var lv = linkMap[rk] || {};
      var dead = !lv.expiresAt || lv.expiresAt < Date.now();
      var when = lv.at ? new Date(lv.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      var status = dead ? 'Link expired' : (lv.sentTo ? ('Emailed to ' + esc(lv.sentTo)) : 'Link waiting');
      return '<div class="ll-mem"><div><div class="ll-mem-name">Invite link</div>'
        + '<div class="ll-mem-email">' + esc(status) + (when ? (' · ' + esc(when)) : '') + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + (dead ? '' : '<button class="ll-rm ll-reshare-link" data-row="' + esc(rk) + '">Send again</button>')
        + '<button class="ll-rm ll-cancel-link" data-row="' + esc(rk) + '">Cancel</button></div></div>';
    }).join('');
    pendRows += linkRows;

    /* Only an owner can make a link or write an invite, so for a caregiver the invite door has
       nothing to lead with: it would put an empty block at the top and fold her own profile away
       for no reason. She gets the ordinary order, whichever button she pressed. Decided here,
       above the blocks, because three of them read it while they are being built. */
    var leadInvite = (mode === 'invite') && (myRole === 'owner');
    familyMode = leadInvite ? 'invite' : '';

    // Whoever set the circle up, so a caregiver who cannot invite is told a name and not a role.
    var ownerName = '';
    Object.keys(info).forEach(function (uid) {
      if (!ownerName && uid !== me.uid && (info[uid] || {}).role === 'owner') ownerName = (info[uid] || {}).name || '';
    });

    var myName = (info[me.uid] && info[me.uid].name) || me.displayName || '';
    // In the invite door this block sits inside a fold already headed "Your profile", and its own
    // heading was printing the same two words again directly underneath.
    var youRow = '<div class="ll-invite" style="border-top:none;padding-top:4px">' + (leadInvite ? '' : '<label style="font-weight:800;font-size:15px">Your profile</label>')
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
      /* Said in people, not in roles, and it names who to ask where it can: "an owner" is a word
         from the permissions table, not a person a grandmother can go and speak to. No pronoun,
         because the app is not told anyone's. */
      : '<div class="ll-auth-msg">Only the person who set up this circle can add people.'
        + (ownerName ? (' Ask ' + esc(ownerName) + ' to send an invite.') : ' Ask them to send an invite.') + '</div>';

    // Owner-only, like the invite form above it: sharing a working invite needs an email to pair the
    // link with, and only an owner can create one. Showing this to a caregiver offered a bare link
    // that could only ever strand the recipient (they have no invite to pair it with).
    var share = (myRole === 'owner')
      ? '<div class="ll-invite"><label>Invite link</label>'
        + '<div class="ll-linkrow"><input id="llAppLink" readonly placeholder="Tap to make a one-time link" value=""><button id="llCopyLink" class="ll-modal-btn">Make a link</button></div>'
        + '<div class="ll-auth-msg">One link, for one person, good for a day. Whoever opens it joins your circle, so send it to them and not to a group. You do not need to know which email address they will sign in with.</div>'
        /* The link block's own message line. It used to borrow llInvMsg, which sits inside the
           email-invite block: in the invite door that block is folded shut, so "could not make a
           link" was written into something the parent could not see and the button just went
           quiet on her. */
        + '<div id="llLinkErr" class="ll-auth-msg" style="text-align:left"></div>'
        + '<div id="llLinkMail" style="display:none;margin-top:8px"><label>Or let Cubby email it</label>'
        + '<input id="llLinkEmail" type="email" placeholder="Their email address" autocomplete="off" autocapitalize="off">'
        + '<button id="llLinkMailBtn" class="ll-modal-btn ll-ghost" style="margin-top:6px">Email the link</button>'
        + '<div id="llLinkMailMsg" class="ll-auth-msg"></div></div>'
        /* "above" is only true in the Settings order. In the invite door the email form is folded
           below, so this has to name the fold and ask her to open it: telling her to "add their
           exact email under X" points at a form that is not on screen yet. */
        + '<div class="ll-auth-msg" style="margin-top:6px">'
        + (leadInvite
            ? 'Prefer the stricter way? Open “Invite by their email address” below, and that invite will only work for the address you type.'
            : 'Prefer the stricter way? Add their exact email above instead: that invite only works for that address.')
        + '</div></div>'
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
        + (!hhSet && myRole === 'owner' && !leadInvite
            ? '<div class="ll-auth-msg" style="text-align:left;margin:-4px 0 12px">Naming it means an invite can say what someone is joining, instead of "someone\'s Cubby".</div>'
            : ''))
      : '';

    /* The one thing on the invite screen that only helps BEFORE the link is sent. In the Settings
       order it is the second thing she reads; the reorder pushed it five blocks below the button
       that sends the link, so she was told why the name matters after the invite already said
       "someone's Cubby". It leads instead, one line, with the same Name it button. The full name
       row stays where it is under "Who is already here" (its explanatory line is dropped there in
       this door, so the point is made once). Its own id, because llHhName is still down there and
       getElementById would only ever find one of them. */
    var nameFirst = (leadInvite && hhName && !hhSet)
      ? '<div class="ll-namefirst"><div>Name your family first and the invite can say what they are joining.</div>'
        + '<button id="llHhNameTop" class="ll-modal-btn ll-ghost">Name it</button></div>'
      : '';

    /* The same blocks, named once, so the two doors are an ORDER and not a second copy of this
       screen. Anything added to one of these is in both by construction. */
    var memsBlock = '<div class="ll-mems">' + rows + '</div>';
    var pendBlock = pendRows ? ('<div class="ll-auth-msg" style="text-align:left;margin:6px 0 2px;font-weight:800">Invited, not joined yet</div><div class="ll-mems">' + pendRows + '</div>') : '';
    var seenByAll = '<div class="ll-auth-msg" style="text-align:left;margin:-2px 0 12px">When you invite people, everyone in your circle can see each other\'s name here, so you know who is who. Email addresses stay between each person and the circle owner. Only you can change your own.</div>';
    var signOutBtn = '<button id="llSignOut" class="ll-modal-btn ll-ghost">Sign out</button>';
    var versionLine = '<div class="ll-auth-msg" style="margin-top:10px">Cubby v' + (window.CUBBY_VERSION || '') + ' · made with families like you</div>';

    if (leadInvite) {
      /* Invite door. The link and its button first; then whoever the last link went to, because
         "did that one ever arrive" is the question she comes back with; then the two slower
         things, folded. Sign out lives inside the profile fold here: on a screen she reached by
         tapping "Invite someone" it is only a mis-tap waiting to happen, and it is a profile
         action anyway. It stays in the DOM either way, so the wiring below is unchanged. */
      modal('Invite someone', nameFirst + share + pendBlock
        + llFold('llFoldEmail', 'Invite by their email address', invite)
        + '<div class="ll-auth-msg" style="text-align:left;margin:16px 0 2px;font-weight:800">Who is already here</div>'
        + nameRow + memsBlock + seenByAll
        + llFold('llFoldProfile', 'Your profile', youRow + signOutBtn)
        + versionLine);
    } else {
      /* She pressed a button that said Invite someone and she cannot invite. Same blocks, same
         order, with the one sentence that answers her moved to the top: it used to sit in faint
         grey at the very bottom, under her own profile form, so the answer to "why is there
         nothing to tap" was the last thing on the screen. */
      var askedToInvite = (mode === 'invite');
      modal('Family & sharing', (askedToInvite ? invite : '') + nameRow + memsBlock + pendBlock + seenByAll
        + youRow + (askedToInvite ? '' : invite) + share + signOutBtn + versionLine);
    }

    // Naming the family closes this modal, so from the invite door it says which door to come
    // back through. Settings passes nothing and lands where it always did.
    var hhOpen = function () { closeModal(); if (window.openHouseholdName) window.openHouseholdName(leadInvite ? 'invite' : ''); };
    var hhBtn = document.getElementById('llHhName');
    if (hhBtn) hhBtn.onclick = hhOpen;
    var hhBtnTop = document.getElementById('llHhNameTop');
    if (hhBtnTop) hhBtnTop.onclick = hhOpen;
    document.getElementById('llSignOut').onclick = function () { closeModal(); window.LL.signOut(); };
    document.getElementById('llMyRelBtn').onclick = saveMyRelationship;
    wireRelCustom('llMyRel', 'llMyRelCustom');
    document.getElementById('llMyBearBtn').onclick = function () { if (window.openBearPicker) window.openBearPicker('member', me.uid); };
    document.getElementById('llMyFeedbackBtn').onclick = openFeedback;
    var copyBtn = document.getElementById('llCopyLink'); if (copyBtn) copyBtn.onclick = copyAppLink; // owner-only now
    if (myRole === 'owner') document.getElementById('llInvBtn').onclick = submitInvite;
    Array.prototype.forEach.call(document.querySelectorAll('.ll-rm'), function (b) {
      if (b.classList.contains('ll-cancel-inv') || b.classList.contains('ll-reinvite')) return; // pending-invite rows are wired below
      b.onclick = function () { removeMember(b.getAttribute('data-uid'), b.getAttribute('data-email'), b.getAttribute('data-name')); };
    });
    wirePendingEmailRows(document);
    if (myRole === 'owner') checkPendingInvites(pendEmails);
    Array.prototype.forEach.call(document.querySelectorAll('.ll-reshare-link'), function (b) {
      b.onclick = function () { reshareLink(b.getAttribute('data-row'), b); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ll-cancel-link'), function (b) {
      b.onclick = function () { cancelInviteLink(b.getAttribute('data-row')); };
    });
  }

  /* Send the SAME link again rather than minting a new one. Minting a second link would quietly
     invalidate nothing (both would work) and double the number of live invites into her household,
     which is the opposite of what "send again" should mean.
     Takes the row key (lane B, D1). The token comes from the owner-only copy already on this device,
     with nothing awaited first, because a share sheet only opens straight from the tap. */
  function reshareLink(rowKey, btn) {
    var token = linkTokenFor(rowKey);
    if (!token) {
      try { if (window.toast) window.toast('Cubby could not find that link just now. Make a fresh one instead.'); } catch (e) {}
      return;
    }
    var url = location.origin + '/app/?join=' + token;
    var text = 'Join me on Cubby\n\n' + url + '\n\nIt works once and only for a day, so it is just for you.';
    if (navigator.share) { navigator.share({ title: 'Join me on Cubby', text: text }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (btn) { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1500); }
      }).catch(function () {});
    }
  }
  /* Revoke. Deleting the link document is the real revocation — the mirror is only the visible
     list, so it goes second and its failure cannot leave a live link behind. */
  async function cancelInviteLink(rowKey) {
    if (!rowKey || !hhRef) return;
    // Lane B, D1: the row key opens nothing; the token is the owner-only copy (or the key itself, for
    // a row written before row ids). If this device has not loaded it yet, ask the server once.
    var token = linkTokenFor(rowKey), copyGone = false;
    if (!token && isLinkRowId(rowKey)) {
      try {
        var os = await hhRef.collection('ownerLinks').doc(rowKey).get();
        token = (os.exists && (os.data() || {}).token) || '';
        copyGone = !os.exists && !os.metadata.fromCache;
      } catch (e) {}
    }
    /* The server itself says there is no copy (offline, a copy this phone never saw is a refused read,
       never "absent"). A copy only ever goes once its link no longer works: Cancel and Remove delete
       the link first, and the tidy drops a copy with its link or after the link is used. So this row
       points at nothing that still opens a door (an interrupted removal can leave one behind), and
       clearing it strands nothing. Without this it would sit on her list for good. */
    if (!token && copyGone) {
      try { await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', rowKey), firebase.firestore.FieldValue.delete()); }
      catch (e) { try { if (window.toast) window.toast('Could not cancel that link just now. Try again in a moment.'); } catch (e2) {} return; }
      try { if (window.toast) window.toast('That link was already gone, so it has been tidied away.'); } catch (e) {}
      reopenFamily();
      return;
    }
    /* Still no token (offline, say, on a phone whose copy has not arrived): the row id opens nothing,
       so the link cannot be reached from here. Clearing the row and the copy anyway would leave a
       live link she can neither see nor cancel. Touch nothing, as removeMember does, and say so. */
    if (!token) {
      try { if (window.toast) window.toast('Could not cancel that link just now. Try again in a moment.'); } catch (e) {}
      return;
    }
    try { await db.collection('inviteLinks').doc(token).delete(); }
    catch (e) { try { if (window.toast) window.toast('Could not cancel that link'); } catch (e2) {} return; }
    try { await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', rowKey), firebase.firestore.FieldValue.delete()); } catch (e) {}
    if (isLinkRowId(rowKey)) { try { await hhRef.collection('ownerLinks').doc(rowKey).delete(); } catch (e) {} }
    try { if (window.toast) window.toast('Link cancelled'); } catch (e) {}
    reopenFamily();
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
    // Record who it went to, so the pending row can say so instead of just "waiting". On the row,
    // which is keyed by its row id now (lane B, D1), or by the token for a row written before.
    // Only onto a row that is there: a field path write to a missing row would make one, keyed by
    // the token, which is exactly what every member must not be able to read.
    var rk = linkRowFor(token);
    if (Object.prototype.hasOwnProperty.call(window.LL.hhPendingLinks || {}, rk)) {
      try { await hhRef.update(new firebase.firestore.FieldPath('pendingLinks', rk, 'sentTo'), String(email).trim().toLowerCase()); } catch (e) {}
    }
    return { ok: true };
  };

  /* A pending EMAIL invite's row on the circle screen. Gone means Cubby asked the server and this
     family's own invite is no longer there: she started her own Cubby instead, or it was taken back
     somewhere else. It used to keep saying "Invited · waiting" until the owner tapped Cancel and was
     told it had already gone. Now it says so, and offers to send it again. Only a row marked
     perFamily is ever checked: the address-keyed invite cannot be read by an owner, so its row stays
     exactly as it was. Touch targets are 44px tall, and the words are drawn in the theme's ink rungs,
     inline, so this adds no CSS class: the shared pink role label measures 2.8:1 on this row in Light
     and the shared red button 4.2:1; --preg-ink and --danger-ink clear 5.3:1 in both themes, and
     "Invite again" is not a warning, so it is plain --ink. */
  var inviteGone = {}; // householdId|email -> true once the server said that invite is no longer there
  function goneKey(email) { return (window.LL.householdId || '') + '|' + email; }
  function pendingEmailRow(em, pv) {
    var gone = inviteGone[goneKey(em)] === true;
    var tap = 'min-height:44px;padding:0 6px;';
    return '<div class="ll-mem" data-pend-email="' + esc(em) + '"><div><div class="ll-mem-name">' + esc(pv.name || em) + '</div><div class="ll-mem-email">' + esc(em) + '</div></div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end"><span class="ll-mem-role" style="color:var(--preg-ink,#8C547A)">' + (gone ? 'Not joined yet' : 'Invited · waiting') + '</span>'
      + (gone ? '<button class="ll-rm ll-reinvite" data-email="' + esc(em) + '" style="' + tap + 'color:var(--ink,#2C2521)">Invite again</button>' : '')
      + '<button class="ll-rm ll-cancel-inv" data-email="' + esc(em) + '" style="' + tap + 'color:var(--danger-ink,#9F4C3B)">Cancel</button></div></div>';
  }
  function wirePendingEmailRows(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.ll-cancel-inv'), function (b) {
      b.onclick = function () { cancelInvite(b.getAttribute('data-email')); };
    });
    Array.prototype.forEach.call(root.querySelectorAll('.ll-reinvite'), function (b) {
      b.onclick = function () { inviteAgain(b.getAttribute('data-email'), b); };
    });
  }
  // Redraw one row in place once its check comes back, so a parent typing in the invite form below
  // does not lose what she typed to a rebuilt sheet.
  function redrawPendingRow(em) {
    var pv = (window.LL.hhPending || {})[em];
    Array.prototype.forEach.call(document.querySelectorAll('[data-pend-email]'), function (row) {
      if (row.getAttribute('data-pend-email') !== em) return;
      if (!pv) { row.remove(); return; }
      var tmp = document.createElement('div');
      tmp.innerHTML = pendingEmailRow(em, pv);
      var fresh = tmp.firstChild;
      row.parentNode.replaceChild(fresh, row);
      wirePendingEmailRows(fresh);
    });
  }
  // Ask the server about each of this family's own invites. Offline, refused, or any doubt: the row
  // stays as it is drawn. Only a definite "not there" from the server turns a row to "Not joined yet".
  function checkPendingInvites(emails) {
    var hid = window.LL.householdId; if (!hid) return;
    (emails || []).forEach(function (em) {
      var pv = (window.LL.hhPending || {})[em] || {};
      if (pv.perFamily !== true) return;
      familyInviteRef(em, hid).get({ source: 'server' }).then(function (snap) {
        var gone = !snap.exists, k = hid + '|' + em;
        if ((inviteGone[k] === true) === gone) return;
        if (gone) inviteGone[k] = true; else delete inviteGone[k];
        redrawPendingRow(em);
      }, function () {});
    });
  }
  // "Invite again": the same invite, made again through the one path that makes invites.
  function inviteAgain(em, btn) {
    var pv = (window.LL.hhPending || {})[em] || {};
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    var settle = function (text) {
      redrawPendingRow(em);
      try { window.toast && window.toast(text); } catch (e) {}
    };
    createEmailInvite({ email: em, name: pv.name || '', rel: pv.relationship || '', role: pv.role || 'caregiver' }).then(function (kind) {
      if (kind === 'withdrawn') { redrawPendingRow(em); return; }
      // The mirror row was rewritten by createEmailInvite; keep the local copy in step for the redraw.
      if (window.LL.hhPending) window.LL.hhPending[em] = Object.assign({}, pv, { perFamily: kind === 'family' });
      settle('Invite ready for ' + em + '.');
    }, function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Invite again'; }
      try {
        window.toast && window.toast((e && e.code === 'permission-denied')
          ? 'Cubby couldn’t make an invite for that address. Try sending them an invite link instead.'
          : errText(e, 'Could not make the invite just now. Mind trying again?', true));
      } catch (e2) {}
    });
  }

  // Withdraw a pending invite: the invite doc is what grants join rights, so deleting it is the
  // real revocation; the household mirror entry is just the visible list. firestore.rules lets the
  // household's owner delete this family's own invite, and the address-keyed one when it points at
  // her household. Both doors are closed, because an older build may have written the other one.
  function cancelInvite(email) {
    if (!email || !hhRef) return;
    var hid = window.LL.householdId;
    function tidy(text) {
      try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', email), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e) {}
      if (window.LL.hhPending) delete window.LL.hhPending[email];
      delete inviteGone[goneKey(email)];
      if (getLastInvite() === email) setLastInvite('');
      try { window.toast && window.toast(text); } catch (e) {}
      reopenFamily();
    }
    // A row Cubby already found gone has nothing live to withdraw: it only comes off the list.
    if (inviteGone[goneKey(email)] === true) {
      noteInviteCancelled(hid, email);
      try { familyInviteRef(email, hid).delete().catch(function () {}); } catch (e) {}
      try { db.collection('invites').doc(email).delete().catch(function () {}); } catch (e) {}
      tidy('Taken off your list.');
      return;
    }
    var doCancel = function () {
      var done = false;
      noteInviteCancelled(hid, email);
      // Same optimistic exit as saves: offline the delete is queued and will land; don't hang.
      var t = setTimeout(function () { if (done) return; done = true; tidy('Invite cancelled.'); }, 6000);
      var settled = function (p) { return p.then(function () { return null; }, function (e) { return e || { code: 'unknown' }; }); };
      Promise.all([settled(familyInviteRef(email, hid).delete()), settled(db.collection('invites').doc(email).delete())]).then(function (r) {
        if (done) return; done = true; clearTimeout(t);
        if (!r[0] || !r[1]) { tidy('Invite cancelled.'); return; }
        // Both refused: under the rules live before this change the per-family delete always is, and
        // a refused address-keyed delete almost always means that invite is already gone (used, or
        // cleaned up elsewhere). Tidy the stale row rather than erroring forever.
        if (r[0].code === 'permission-denied' && r[1].code === 'permission-denied') { tidy('That invite was already gone, so it has been tidied away.'); return; }
        try { window.toast && window.toast(errText(r[1].code === 'permission-denied' ? r[0] : r[1], 'Could not cancel that invite just now. Mind trying again?', true)); } catch (e2) {}
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
    modal(isJoin ? 'You\'re in' : 'Welcome to Cubby',
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

  /* Lane B, P4. Someone who joined by link (with Hide My Email, say) can still have an email invite
     waiting at ANOTHER address, her real one, and after she is removed that invite lets her straight
     back in. The owner's pending list carries the name she typed for each invite, so a removal also
     cancels every pending invite under the same name: whole name, trimmed, any case. The confirm
     sheet names each address first, so nothing is cancelled that the owner was not shown. */
  function inviteNameKey(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
  function namesakeInvites(uid, email) {
    var nm = inviteNameKey(((window.LL.memberInfo || {})[uid] || {}).name);
    if (!nm) return [];
    var own = String(email || '').toLowerCase(), pend = window.LL.hhPending || {};
    return Object.keys(pend).filter(function (em) {
      return em !== own && inviteNameKey((pend[em] || {}).name) === nm;
    }).sort();
  }
  function listOf(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

  function removeMember(uid, email, name) {
    if (!hhRef) return;
    var linkRowKeys = function () { return Object.keys(window.LL.hhPendingLinks || {}); };
    var alsoInvites = namesakeInvites(uid, email);   // lane B, P4: asked about on the sheet below
    var doRemove = async function () {
      try {
        var del = firebase.firestore.FieldValue.delete();
        var u = {}; u['members.' + uid] = del; u['memberInfo.' + uid] = del;
        // Keep a tombstone so their past entries stay attributed by name forever.
        var mi = (window.LL.memberInfo || {})[uid] || {};
        u['formerMemberInfo.' + uid] = { name: mi.name || name || '', relationship: mi.relationship || '', avatar: mi.avatar || null };
        /* Every member can read this document. The owner's list of pending links on it was keyed by each
           link's secret token, and a row written before row ids (or by an older build) still is. So the
           person being removed may have copied a live token while she was in, or been forwarded one,
           and could walk straight back in with it. Every unused link is cancelled in the same
           action: the link documents first (deleting one is the real revocation), then the write that
           removes her, which clears their rows.
           NOTHING IS AWAITED BETWEEN THEM. Firestore queues writes in the order they are made, applies
           each to this phone at once, and sends them in that order when it can, so the deletes still
           land ahead of the removal. Waiting for the deletes first meant that offline the removal was
           never even issued: her Remove did nothing, and was lost if she closed Cubby before the
           connection came back (round-5 review VJ-1; circle-manage section A2 is the gate). */
        var pending = window.LL.hhPendingLinks || {};
        /* Lane B, D1: rows are keyed by row id now, and the token comes from the owner-only copy on
           this device (linkTokenFor), so the deletes are still issued at once with nothing awaited. A
           row whose token this device does not have is left where it is, for her to cancel. */
        var linkDeletes = linkRowKeys().map(function (tk) {
          var token = linkTokenFor(tk);
          if (!token) return Promise.resolve(null);
          u['pendingLinks.' + tk] = del;
          var dropDoc = function () { if (isLinkRowId(tk)) hhRef.collection('ownerLinks').doc(tk).delete().catch(function () {}); return null; };
          return db.collection('inviteLinks').doc(token).delete().then(dropDoc, function (e) {
            // Refused means it no longer exists (the rules cannot read a missing link's family).
            return (e && (e.code === 'permission-denied' || e.code === 'not-found')) ? dropDoc() : tk;
          });
        });
        // Lane B, P4: her invites to her other addresses, the invite first (that is the revocation).
        // Both kinds: the address-keyed one and this family's own (invites/{email}/from/{hid}).
        alsoInvites.forEach(function (em) {
          try { db.collection('invites').doc(em).delete().catch(function () {}); } catch (e) {}
          try { familyInviteRef(em, hhRef.id).delete().catch(function () {}); } catch (e) {}
        });
        var removal = hhRef.update(u);
        alsoInvites.forEach(function (em) {
          try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', em), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e) {}
          if (window.LL.hhPending) delete window.LL.hhPending[em];
        });
        // PRIV-2: drop the removed member's gated email doc too (owner may, by rule). Their
        // address should not linger in a circle they are no longer part of.
        try { hhRef.collection('memberEmails').doc(uid).delete().catch(function () {}); } catch (e) {}
        if (email) {
          try { db.collection('invites').doc(email).delete().catch(function () {}); } catch (e) {}
          // And this family's own invite to that address, which an owner may always delete.
          try { familyInviteRef(String(email).toLowerCase(), hhRef.id).delete().catch(function () {}); } catch (e) {}
          // Drop any pending-invite mirror entry too, so a removed member's email doesn't linger
          // in the "Invited, waiting" list once they're gone from memberInfo.
          try { hhRef.update(new firebase.firestore.FieldPath('pendingInvites', String(email).toLowerCase()), firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e) {}
        }
        // A link that could not be cancelled gets its row back, so the owner still sees it and can
        // cancel it herself.
        Promise.all(linkDeletes).then(function (left) {
          var back = {}; left.forEach(function (tk) { if (tk && pending[tk]) back['pendingLinks.' + tk] = pending[tk]; });
          if (Object.keys(back).length) hhRef.update(back).catch(function () {});
        });
        await removal;
        reopenFamily();
      } catch (e) { try { window.toast && window.toast('Could not remove ' + (name || 'this person') + ' just now.'); } catch (e2) {} }
    };
    // Use the app's own confirm sheet (calm, on-brand); native confirm is only a defensive fallback.
    if (window.confirmSheet) {
      window.confirmSheet({ title: 'Remove ' + (name || 'this person') + '?',
        body: 'They’ll lose access, but everything they logged stays part of the baby’s story.'
          + (linkRowKeys().length ? ' Any unused invite links are cancelled too, so you can send fresh ones.' : '')
          + (alsoInvites.length ? ' This also cancels your invite' + (alsoInvites.length > 1 ? 's' : '') + ' to ' + listOf(alsoInvites) + '.' : ''),
        confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true, onConfirm: doRemove });
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
    // The link block's own line first: llInvMsg belongs to the email form, which the invite door
    // folds shut, and a failure written in there is a failure the parent never sees.
    var msg = document.getElementById('llLinkErr') || document.getElementById('llInvMsg');
    if (btn) { btn.disabled = true; btn.textContent = 'Making…'; }
    var made = await window.LL.createInviteLink({ role: 'caregiver' });
    if (btn) btn.disabled = false;
    if (!made) {
      if (btn) btn.textContent = 'Make a link';
      if (msg) msg.textContent = 'Could not make a link just now. You can still invite by email instead.';
      return;
    }
    if (msg) msg.textContent = '';
    if (inp) inp.value = made.url;
    // Reveal the email option only once a link exists, and remember which token it belongs to.
    var mailWrap = document.getElementById('llLinkMail');
    if (mailWrap) { mailWrap.style.display = ''; mailWrap.setAttribute('data-token', made.token); }
    var mailBtn = document.getElementById('llLinkMailBtn');
    if (mailBtn) mailBtn.onclick = function () { emailTheLink(made.token); };
    var text = inviteLinkText(made);
    var done = function () { if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Make another'; }, 1600); } };
    if (navigator.share) {
      navigator.share({ title: 'Join me on Cubby', text: text }).then(function () {
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
    return 'Join me on Cubby\n\n' + made.url + '\n\n'
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
      navigator.share({ title: 'Join me on Cubby', text: text }).then(function () {
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
      var subject = 'Join me on Cubby';
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
    createEmailInvite({ email: email, name: name, rel: rel, role: owner ? 'owner' : 'caregiver' }).then(function () {
      if (done) return; done = true; clearTimeout(t); showReady();
    }).catch(function (e) {
        if (done) return; done = true; clearTimeout(t);
        /* Refused. With one invite per family this is no longer another family holding the address;
           it is the rules saying no to this owner (an address nobody proved, say). Saying more would
           tell anyone with a Cubby who else has invited an address, so the copy names the way
           forward instead. */
        msg.textContent = (e && e.code === 'permission-denied')
          ? 'Cubby couldn’t make an invite for that address. Try sending them an invite link instead.'
          : errText(e, 'Could not create the invite just now. Mind trying again?');
        btn.textContent = 'Create invite'; btn.disabled = false;
      });
  }
  /* A Cancel can come before the server's answer to the invite it withdraws (offline, say). The answer
     then wrote the perFamily mark, and that put back the row the Cancel had taken off her list: a
     "Not joined yet" row with "Invite again", for an invite she had withdrawn. So each invite made on
     this phone takes a number, a Cancel records the number it came after (householdId|email), and an
     answer marks its row only when no Cancel came after it and the row is still on her list here. */
  var inviteSeq = 0, inviteCancelled = {};
  function noteInviteCancelled(hid, email) { inviteCancelled[hid + '|' + email] = ++inviteSeq; }
  /* The one way an email invite is made: the invite form above and "Invite again" on the circle screen.
     o: { email, name, rel, role }. Resolves 'family' when this family's own invite
     (invites/{email}/from/{hid}) is in, 'legacy' when the address-keyed one was written instead, or
     'withdrawn' when she cancelled it on this phone before Cubby knew which to write (nothing is
     written then). Rejects with the refusal.
     WHICH ONE. The client ships before the rules that allow the per-family invite, and a write the
     rules will refuse must never be the one left queued: offline, the refusal only arrives after she
     has closed Cubby, with nobody left to write the other one, and her list would say "Invited ·
     waiting" for an invite that never existed. So it asks first, by reading this family's own invite
     to that address (an owner may, under the new rules; the older rules refuse it). Refused: the
     address-keyed invite, as before. Read: this family's own. No answer (offline): whatever the rules
     said last time on this phone, and the address-keyed one if they have never said, which every
     version of the rules accepts. */
  var FAMILY_RULES_KEY = 'cubby-invite-family-rules';
  function familyRulesKnown() { try { return localStorage.getItem(FAMILY_RULES_KEY) === '1'; } catch (e) { return false; } }
  function familyRulesSeen() { try { localStorage.setItem(FAMILY_RULES_KEY, '1'); } catch (e) {} }
  function familyInvitesAllowed(email, hid) {
    return familyInviteRef(email, hid).get({ source: 'server' }).then(function () { familyRulesSeen(); return true; }, function (e) {
      if (e && e.code === 'permission-denied') return false;
      return familyRulesKnown();
    });
  }
  function createEmailInvite(o) {
    var hid = window.LL.householdId;
    var mySeq = ++inviteSeq;
    var invDoc = {
      householdId: hid, role: o.role === 'owner' ? 'owner' : 'caregiver',
      relationship: o.rel || '', name: o.name || '',
      invitedBy: auth.currentUser.uid, status: 'pending', createdAt: window.LL.serverTimestamp()
    };
    /* Shown to a newcomer on the sheet that asks whether to join (askNewcomerToJoin): she cannot
       read the household before joining, so the invite has to carry who sent it. The rules check
       fromEmail against this account's own sign-in address, and only accept a name that travels
       with it, so the sheet can show her something the sender could not have made up. */
    var fromEmail = ((auth.currentUser && auth.currentUser.email) || '').toLowerCase();
    if (fromEmail) { invDoc.fromEmail = fromEmail; invDoc.invitedByName = inviterName(); }
    /* Mirror the pending invite onto the household doc so the circle screen can list and cancel it
       (owners cannot query /invites: reads there are invitee-only by rule). FieldPath keeps the dots
       in the email from being read as a nested path. Written NOW, queued alongside the invite, so an
       invite made offline is on her list when she opens Cubby again: a mirror written only once the
       server answered never was, and she had a live invite she could neither see nor cancel. If the
       rules refuse the invite, its row comes off again below, so nobody shows as "Invited, waiting"
       who was never invited. */
    var pendingRow = new firebase.firestore.FieldPath('pendingInvites', o.email);
    try {
      if (hhRef) hhRef.update(pendingRow, { name: invDoc.name, relationship: invDoc.relationship, role: invDoc.role, at: Date.now() }).catch(function () {});
    } catch (e) {}
    var dropRow = function () {
      try { if (hhRef) hhRef.update(pendingRow, firebase.firestore.FieldValue.delete()).catch(function () {}); } catch (e2) {}
    };
    var legacy = function () {
      return db.collection('invites').doc(o.email).set(invDoc).then(function () { delete inviteGone[hid + '|' + o.email]; return 'legacy'; }, function (e2) {
        // A refusal that arrives after the form's optimistic exit still takes the row.
        if (e2 && e2.code === 'permission-denied') dropRow();
        throw e2;
      });
    };
    return familyInvitesAllowed(o.email, hid).then(function (allowed) {
      /* Cancelled while Cubby was still asking which invite to write (a slow connection): her Cancel
         had nothing to delete yet, so writing it now would leave a live invite she has withdrawn. */
      if ((inviteCancelled[hid + '|' + o.email] || 0) > mySeq) return 'withdrawn';
      if (!allowed) return legacy();
      return familyInviteRef(o.email, hid).set(invDoc).then(function () {
        familyRulesSeen();
        /* The server has it. Only now is the row marked as this family's own invite, which is what lets
           the circle screen check on it later (an owner may read her own family's invite, never the
           address-keyed one). A mark written before the answer could call a live invite gone. */
        var withdrawn = (inviteCancelled[hid + '|' + o.email] || 0) > mySeq;
        var listed = !!(window.LL.hhPending && window.LL.hhPending[o.email]);
        if (!withdrawn && listed) {
          try { if (hhRef) hhRef.update(new firebase.firestore.FieldPath('pendingInvites', o.email, 'perFamily'), true).catch(function () {}); } catch (e) {}
        }
        delete inviteGone[hid + '|' + o.email];
        return 'family';
      }, function (e) {
        // Refused although the rules seemed to allow it (they were changed back): the old way, once.
        if (e && e.code === 'permission-denied') return legacy();
        throw e;
      });
    });
  }

  /* ---------- feedback ---------- */
  function openFeedback() {
    modal('Send feedback',
      '<div class="ll-auth-msg" style="margin:0 0 8px">Bugs, ideas, anything, it goes straight to the Cubby team. Thank you for testing!</div>'
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
        modal('Thank you', '<div class="ll-auth-msg" style="margin:0 0 12px">Your feedback was sent, we read every one.</div><button id="llFbDone" class="ll-modal-btn">Close</button>');
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
    householdSeen('*');   // the usage tracker (PRIV-4): a local-only page has no family record to wait for
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
          /* Store.load hands it back through the same ingest checks the snapshots get, for the same
             reason: a gate must boot the shape the real app produces. */
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
    signInNote = '';   // said what was left to do; she has signed in to do it
    try { localStorage.setItem('cubby-member', '1'); } catch (e) {}
    try { var _sm = sessionStorage.getItem('cubby-signin-method'); if (_sm) { sessionStorage.removeItem('cubby-signin-method'); signinTrack(_sm, 'signed_in', 'succeeded'); } } catch (e) {}
    try {
      showStatus('Setting things up…');
      ensureConfigListener(); // runs beside the household read, never in front of it
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
