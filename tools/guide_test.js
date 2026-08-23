// Gate for "What to log, and why" (app/log-guide.js) and the Notes lane fixes that shipped with it.
//
// Everything here is behaviour a screenshot cannot show and the contrast walk does not look at:
// which chapters a baby's age actually surfaces, that the owner-only gate survives the trip into a
// separate module, that a bereaved parent can never have it open on top of the holding screen, and
// that the four Notes bugs stay fixed.
//
// Uses the localhost-only ?e2e=1 boot hook, same as tools/uitest.js and tools/perf_check.js.
// NOTE: ?e2e=1 never attaches Firestore, so LL.addNote is absent by design. The notes cases stub it
// and drive the real saveNote/toggleNotePin/daySurface, which is where all four bugs lived.
//
//   node tools/serve.js &   &&   node tools/guide_test.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const APP = BASE + '/app/?e2e=1';

const DAY = 86400000;
let fails = 0, passes = 0;
function check(ok, what, detail) {
  if (ok) { passes++; console.log('  ok   ' + what); }
  else { fails++; console.log('  FAIL ' + what + (detail ? '  ' + detail : '')); }
}

function seed(ageDays) {
  return {
    babies: [{ id: 'b1', name: 'Aria', birth: ageDays == null ? null : Date.now() - ageDays * DAY, sex: 'F', routines: [] }],
    activeBabyId: 'b1', events: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
  };
}

async function boot(browser, state) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
    localStorage.removeItem('cubby-seen-local');
  }, state);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1600));
  page.__errs = errs;
  return page;
}

// The chapter labels the contents screen offers, split by group.
async function chapterLabels(page) {
  return page.evaluate(() => {
    if (typeof cubbyOpenGuide !== 'function') return null;
    cubbyOpenGuide();
    var o = document.getElementById('logGuide');
    if (!o) return null;
    function labels(scope) {
      return [].slice.call(scope.querySelectorAll('.lg-row .lg-rt')).map(function (n) { return n.textContent; });
    }
    var more = document.getElementById('lgMore');
    var all = labels(o), moreLabels = more ? labels(more) : [];
    var hasNow = /Right now/.test(o.textContent);
    // With no "Right now" group there is no collapsed group either: everything is listed flat,
    // so all of it counts as "more".
    var res = {
      now: hasNow ? all.filter(function (l) { return moreLabels.indexOf(l) < 0; }) : [],
      more: hasNow ? moreLabels : all,
      sub: (o.querySelector('.lg-sub') || {}).textContent || '',
      hasNowGroup: /Right now/.test(o.textContent),
      foot: (o.querySelector('.lg-foot') || {}).textContent || ''
    };
    cubbyCloseGuide();
    return res;
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  // ---- 1. IT LOADS, AND IT DOES NOT TOUCH THE APP SHELL ----------------------------------------
  console.log('\n1. the module loads and the overlay leaves the shell alone');
  let page = await boot(browser, seed(45));
  const load = await page.evaluate(() => ({
    open: typeof cubbyOpenGuide === 'function',
    close: typeof cubbyCloseGuide === 'function',
    ctx: typeof cubbyGuideCtx === 'function',
    api: typeof CubbyGuide === 'object'
  }));
  check(load.open && load.close && load.ctx && load.api, 'cubbyOpenGuide, cubbyCloseGuide, cubbyGuideCtx and CubbyGuide are all defined', JSON.stringify(load));

  const shell = await page.evaluate(() => {
    var before = document.getElementById('scroll');
    cubbyOpenGuide();
    var during = document.getElementById('scroll');
    var overlay = document.getElementById('logGuide');
    var parent = overlay && overlay.parentNode === document.body;
    cubbyCloseGuide();
    return { survived: !!during && during === before, onBody: !!parent, gone: !document.getElementById('logGuide') };
  });
  // The #scroll node surviving is what keeps iOS inertial scroll alive; a shell repaint would kill it.
  check(shell.survived, 'the #scroll node is the same node before, during and after the guide');
  check(shell.onBody, 'the overlay is appended to document.body, not into the app shell');
  check(shell.gone, 'closing removes the overlay entirely');

  const foot = await chapterLabels(page);
  check(/A quiet day is a day too/.test(foot.foot), 'the no-obligation footer is on the contents screen');
  check(!/\d\s*of\s*\d/.test(foot.sub + foot.foot), 'no progress meter or "n of n" counter anywhere on the contents screen');

  // ---- 2. THE CHAPTER LIST ACTUALLY CHANGES WITH THE BABY'S AGE ---------------------------------
  console.log('\n2. a six-week-old and a twenty-month-old are offered different logs');
  const newborn = await chapterLabels(page);
  await page.close();

  page = await boot(browser, seed(610));            // ~20 months: the child stage
  const toddler = await chapterLabels(page);
  await page.close();

  check(newborn && toddler, 'both ages produced a contents screen');
  check(JSON.stringify(newborn.now) !== JSON.stringify(toddler.now),
    'the "Right now" set differs between the two ages', JSON.stringify({ newborn: newborn.now, toddler: toddler.now }));
  check(newborn.now.indexOf('Pump') >= 0, 'a six-week-old surfaces Pump', JSON.stringify(newborn.now));
  check(toddler.now.indexOf('Pump') < 0 && toddler.more.indexOf('Pump') >= 0,
    'a twenty-month-old finds Pump under "there is more", not up front', JSON.stringify(toddler));
  check(toddler.now.indexOf('Milestone') >= 0, 'a twenty-month-old surfaces Milestone', JSON.stringify(toddler.now));
  check(/weeks old/.test(newborn.sub), 'the contents screen states the real age', newborn.sub);

  // ---- 3. NO BIRTHDAY ON FILE MEANS NO CLAIM ABOUT AGE -----------------------------------------
  console.log('\n3. with no birthday on file the guide makes no age claim');
  page = await boot(browser, seed(null));
  const noBirth = await chapterLabels(page);
  check(noBirth && !noBirth.hasNowGroup, 'no "Right now" group without a birthday', JSON.stringify(noBirth && noBirth.now));
  check(noBirth && noBirth.more.length > 0, 'every log is still listed, just without a claim about which matters');
  check(noBirth && !/old/.test(noBirth.sub), 'the sub line does not invent an age', noBirth && noBirth.sub);
  await page.close();

  // ---- 4. THE OWNER-ONLY GATE SURVIVES THE TRIP INTO A SEPARATE MODULE -------------------------
  /* Mood is owner-only forever (Privacy Max). The gate lives in quickAvailable(); the guide reads
     its chapter list from there rather than from its own copy, so this proves the two cannot drift.
     The option itself leaks that the record exists, so its absence is the assertion. */
  console.log('\n4. Mood never reaches a caregiver, even as a chapter title');
  page = await boot(browser, seed(45));
  const mood = await page.evaluate(() => {
    var s = JSON.parse(localStorage.getItem('little-log-v1'));
    s.pregnancy = { stage: 'expecting', due: Date.now() + 60 * 86400000 };
    s.babies = []; s.activeBabyId = null;
    Object.assign(state, s);
    window.LL = window.LL || {};
    var out = {};
    window.LL.matIsOwner = function () { return true; };
    out.owner = cubbyGuideCtx().actions.map(function (a) { return a.k; });
    window.LL.matIsOwner = function () { return false; };
    out.caregiver = cubbyGuideCtx().actions.map(function (a) { return a.k; });
    out.caregiverChapters = CubbyGuide._chapters(cubbyGuideCtx());
    return out;
  });
  check(mood.owner.indexOf('mood') >= 0, 'the carrier is offered Mood', JSON.stringify(mood.owner));
  check(mood.caregiver.indexOf('mood') < 0, 'a caregiver is not', JSON.stringify(mood.caregiver));
  const cgKeys = [].concat(mood.caregiverChapters.now, mood.caregiverChapters.more).map(x => x.k);
  check(cgKeys.indexOf('mood') < 0, 'and no Mood chapter is rendered for them either', JSON.stringify(cgKeys));

  // The labour tools arrive when they are useful, not at week 12.
  const weeks = await page.evaluate(() => {
    function keys(w) {
      /* Move the pregnancy rather than the number. ctx.week and ctx.actions both come off the record
         now that quickAvailable applies the same 28/36 rule the guide does, so faking one and not
         the other describes a mother who cannot exist. */
      state.pregnancy.dueDate = Date.now() + (40 - w) * 7 * 86400000;
      var c = cubbyGuideCtx();
      var ch = CubbyGuide._chapters(c);
      return [].concat(ch.now, ch.more).map(function (x) { return x.k; });
    }
    return { w12: keys(12), w30: keys(30), w38: keys(38) };
  });
  check(weeks.w12.indexOf('contractions') < 0 && weeks.w12.indexOf('kicks') < 0,
    'week 12 is offered neither kick counting nor contraction timing', JSON.stringify(weeks.w12));
  check(weeks.w30.indexOf('kicks') >= 0 && weeks.w30.indexOf('contractions') < 0,
    'week 30 gets kicks but not contractions', JSON.stringify(weeks.w30));
  check(weeks.w38.indexOf('contractions') >= 0, 'week 38 gets contractions', JSON.stringify(weeks.w38));
  await page.close();

  // ---- 5. LOSS SAFETY --------------------------------------------------------------------------
  /* The holding screen is the whole screen on purpose. Nothing opens on top of it, and nothing
     offers itself from underneath it. */
  console.log('\n5. nothing opens on top of the after-loss holding screen');
  page = await boot(browser, seed(45));
  const loss = await page.evaluate(() => {
    state.babies = []; state.activeBabyId = null;
    window.myLossHolding = function () { return true; };
    var c = cubbyGuideCtx();
    cubbyOpenGuide();
    return {
      flagged: c.lossHolding === true,
      card: CubbyGuide.homeCard(false),
      opened: !!document.getElementById('logGuide')
    };
  });
  check(loss.flagged, 'the context reports lossHolding');
  check(loss.card === '', 'the home card renders nothing');
  check(!loss.opened, 'and open() refuses even when called directly (a stale link or old notification)');
  await page.close();

  // ---- 6. WHO THE HOME CARD IS FOR -------------------------------------------------------------
  /* The card must retire on being used and on nothing else. Gating it on "has logged something"
     would hide it from exactly the person it is for: a second caregiver joining a household that
     already has 400 feeds in it and has never been told what any of them are for. */
  console.log('\n6. the home card retires when used, and not because the household is busy');
  page = await boot(browser, seed(45));
  const card = await page.evaluate(() => {
    var out = {};
    out.fresh = CubbyGuide.homeCard(false).length > 0;
    out.whileGetStarted = CubbyGuide.homeCard(true);
    out.getStartedRow = /See what to log, and why/.test(renderGetStarted());
    /* Counted against the PAINTED #scroll, never document.body: body.textContent also contains the
       inline app script's own source, so every string literal in this file reads as "rendered".
       That false positive hid a real ordering bug once already — log-guide.js loaded after
       store-firebase.js, so the boot paint had no CubbyGuide and the row silently went missing. */
    var sc = document.getElementById('scroll');
    out.scrollFound = !!sc;
    out.offersOnFirstPaint = sc ? sc.textContent.split('See what to log, and why').length - 1 : -1;
    // a busy household: 40 events, a photo, a co-parent
    state.events = Array.from({ length: 40 }, function (_, i) {
      return { id: 'e' + i, babyId: state.activeBabyId, type: 'feed', time: Date.now() - i * 3600000 };
    });
    window.LL = window.LL || {}; window.LL.members = { local: {}, other: {} };
    out.stillThereWhenBusy = CubbyGuide.homeCard(false).length > 0;
    markSeen('tip_logguide');
    out.afterUse = CubbyGuide.homeCard(false);
    return out;
  });
  check(card.fresh, 'a new parent is offered the card');
  check(card.getStartedRow, 'Get started carries the guide as one of its rows');
  check(card.whileGetStarted === '', 'and while Get started is up the standalone card stands down, so the offer appears once');
  check(card.scrollFound && card.offersOnFirstPaint === 1,
    'the guide is on the home screen at FIRST paint, exactly once (not one render later)',
    'occurrences: ' + card.offersOnFirstPaint);
  check(card.stillThereWhenBusy, '40 logged feeds and a co-parent do not hide it');
  check(card.afterUse === '', 'once opened or dismissed it is gone for good');

  // Notes are a handoff; with a circle of one there is nobody to hand off to.
  const soloNotes = await page.evaluate(() => {
    function keys() {
      var ch = CubbyGuide._chapters(cubbyGuideCtx());
      return [].concat(ch.now, ch.more).map(function (x) { return x.k; });
    }
    window.LL.members = { local: {} };
    var solo = keys();
    window.LL.members = { local: {}, other: {} };
    return { solo: solo, shared: keys() };
  });
  check(soloNotes.solo.indexOf('note') < 0, 'a solo parent is not taught Notes', JSON.stringify(soloNotes.solo));
  check(soloNotes.shared.indexOf('note') >= 0, 'a circle of two is', JSON.stringify(soloNotes.shared));

  // ---- 7. EVERY "TRY IT" REACHES A REAL FUNCTION -----------------------------------------------
  console.log('\n7. no chapter is a dead end');
  const dead = await page.evaluate(() => {
    var ch = CubbyGuide._chapters(cubbyGuideCtx());
    return [].concat(ch.now, ch.more).filter(function (x) {
      var name = String(x.fn || '').replace(/\(.*$/, '');
      return !name || typeof window[name] !== 'function';
    }).map(function (x) { return x.k + ' -> ' + x.fn; });
  });
  check(dead.length === 0, 'every chapter\'s "Try it" resolves to a function that exists', JSON.stringify(dead));

  const reads = await page.evaluate(() => {
    var bad = [], keys = ['feed', 'sleep', 'diaper', 'measure', 'activity', 'milestone'];
    [0, 2, 5.6, 8, 14, 22].forEach(function (mo) {
      keys.forEach(function (k) {
        var s = CubbyGuide._readSlug(k, mo);
        if (s && !readBySlug(s)) bad.push(k + '@' + mo + ' -> ' + s);
      });
    });
    return bad;
  });
  check(reads.length === 0, 'every "Quick read" slug resolves to a real article at every age', JSON.stringify(reads));
  await page.close();

  // ---- 8. THE NOTES LANE FIXES -----------------------------------------------------------------
  console.log('\n8. the Notes lane keeps its promises');
  page = await boot(browser, seed(45));
  const notes = await page.evaluate(async () => {
    var out = {};
    var me = myUid();
    var today = dayKey(Date.now());

    // N4: "Pin to today (your note stays up top)" has to be true on today too.
    state.notes = [
      { id: 'n_new', createdBy: me, createdByName: 'Me', at: Date.now(), day: today, text: 'newer chatter', audience: 'circle', pinned: false },
      { id: 'n_pin', createdBy: me, createdByName: 'Me', at: Date.now() - 3600000, day: today, text: 'formula is in the top cupboard', audience: 'circle', pinned: true }
    ];
    var html = daySurface();
    out.pinFirst = html.indexOf('formula is in the top cupboard') < html.indexOf('newer chatter');

    // N7: one pin PER MEMBER, so two caregivers' pins both stay on the screen. Rules make a note
    // editable only by its author, so nobody can clear anyone else's — but the lane took
    // pinnedNote()[0] and dropped the rest, silently. Papa's pin is from two days ago (it reaches
    // today only because it is pinned); Mama's is today's, so it also proves the de-dup holds.
    state.notes = [
      { id: 'p_mama', createdBy: me, createdByName: 'Mama', at: Date.now() - 60000, day: today, text: 'the sling is in the car', audience: 'circle', pinned: true },
      { id: 'p_papa', createdBy: 'u_papa', createdByName: 'Papa', at: Date.now() - 2 * 86400000, day: dayKey(Date.now() - 2 * 86400000), text: 'formula is in the top cupboard', audience: 'circle', pinned: true },
      { id: 'p_chat', createdBy: 'u_papa', createdByName: 'Papa', at: Date.now(), day: today, text: 'newer chatter', audience: 'circle', pinned: false }
    ];
    var two = daySurface();
    out.keepsMama = /the sling is in the car/.test(two);
    out.keepsPapa = /formula is in the top cupboard/.test(two);
    out.pinBadges = (two.match(/nt-pin/g) || []).length;   // each pin rendered once, not twice
    out.pinsAboveChatter = two.indexOf('formula is in the top cupboard') < two.indexOf('newer chatter')
      && two.indexOf('the sling is in the car') < two.indexOf('newer chatter');

    // N2: three impatient taps.
    var calls = 0;
    window.LL = window.LL || {};
    window.LL.addNote = function () { calls++; return new Promise(function (r) { setTimeout(function () { r(true); }, 120); }); };
    openNoteCompose();
    document.getElementById('ntText').value = 'slight cold today';
    saveNote(); saveNote(); saveNote();
    await new Promise(function (r) { setTimeout(r, 500); });
    out.addCalls = calls;

    // N3: the pin toast said the opposite of what happened, because it read the object the store
    // had just mutated.
    var said = [];
    var realToast = window.toast;
    window.toast = function (m) { said.push(m); };
    window.LL.setNotePinned = function (id, v) {
      var t = state.notes.find(function (x) { return x.id === id; });
      if (t) t.pinned = !!v;
      return Promise.resolve(true);
    };
    state.notes = [{ id: 'n1', createdBy: me, createdByName: 'Me', at: Date.now(), day: today, text: 'x', audience: 'circle', pinned: false }];
    await toggleNotePin('n1');
    out.onPin = said[said.length - 1];
    await toggleNotePin('n1');
    out.onUnpin = said[said.length - 1];

    // N7b: your own second pin takes your first one down. Say so, rather than letting it go the
    // way another member's pin used to.
    state.notes = [
      { id: 'q1', createdBy: me, createdByName: 'Me', at: Date.now() - 1000, day: today, text: 'first', audience: 'circle', pinned: true },
      { id: 'q2', createdBy: me, createdByName: 'Me', at: Date.now(), day: today, text: 'second', audience: 'circle', pinned: false }
    ];
    await toggleNotePin('q2');
    out.onReplace = said[said.length - 1];
    window.toast = realToast;

    // N7c: the pin control says whose pin it is.
    openNoteCompose();
    out.pinLabel = (document.querySelector('.ds-pinlbl') || {}).textContent || '';
    closeSheet();

    // N6 + the empty state.
    state.notes = [];
    var empty = daySurface();
    out.saysEmpty = /Nothing yet today/.test(empty);
    out.quoteKept = /qod/.test(empty);
    openNoteCompose();
    out.maxlen = document.getElementById('ntText').getAttribute('maxlength');
    closeSheet();
    return out;
  });
  check(notes.pinFirst, 'a note pinned today renders above the day\'s chatter');
  check(notes.keepsMama && notes.keepsPapa, 'two members\' pins BOTH stay on home, neither is dropped',
    'mama: ' + notes.keepsMama + ' papa: ' + notes.keepsPapa);
  check(notes.pinBadges === 2, 'and each of the two renders exactly once', 'badges: ' + notes.pinBadges);
  check(notes.pinsAboveChatter, 'both pins sit above the day\'s ordinary notes');
  check(notes.onReplace === 'Pinned to top, your earlier pin came down',
    'pinning a second note of your own says the first one came down', notes.onReplace);
  check(/your note/i.test(notes.pinLabel), 'the pin control says whose pin it is', notes.pinLabel);
  check(notes.addCalls === 1, 'three taps on "Leave note" write one note, not three', 'calls: ' + notes.addCalls);
  check(notes.onPin === 'Pinned to top', 'pinning says "Pinned to top"', notes.onPin);
  check(notes.onUnpin === 'Unpinned', 'unpinning says "Unpinned"', notes.onUnpin);
  check(notes.saysEmpty, 'the empty lane says in plain words that it is empty');
  check(notes.quoteKept, 'and the quote of the day is still there, nothing was removed');
  check(notes.maxlen === '1000', 'the composer caps a note at 1000 characters', String(notes.maxlen));

  // ---- 9. THE EMPTY LOG IS A DOOR, NOT A SIGNPOST ----------------------------------------------
  /* It used to say "log your first moment" and then send her to another screen to find the button,
     which is the moment most people put the phone down. Both the action and its label come off the
     quick-log registry, so this also proves a toddler's parent is offered a nap, not a feed. */
  console.log('\n9. the empty Log tab opens a sheet instead of pointing at one');
  const door = await page.evaluate(() => {
    state.events = []; state.babies[0].birth = Date.now() - 45 * 86400000;
    go('log');
    var html = document.getElementById('scroll').innerHTML;
    var out = { navigates: /es-cta[^>]*onclick="go\(/.test(html), label: '' };
    var btn = document.querySelector('.es-cta');
    out.label = btn ? btn.textContent.trim() : '';
    if (btn) btn.click();
    out.sheetOpen = !!document.querySelector('#sheet.show');
    out.sheetTitle = (document.querySelector('#sheet h2') || {}).textContent || '';
    closeSheet();
    // A toddler leads with sleep, not a feed. Leave the tab and come back rather than re-rendering
    // in place: the empty state is painted by the windowed timeline, which reconciles by day
    // signature and correctly leaves an unchanged empty list alone. Every real path to a changed
    // birthday goes out through Settings and back, so this is the walk a parent actually takes.
    state.babies[0].birth = Date.now() - 610 * 86400000;
    go('home'); go('log');
    var b2 = document.querySelector('.es-cta');
    out.toddlerLabel = b2 ? b2.textContent.trim() : '';
    return out;
  });
  check(!door.navigates, 'the empty-state button no longer just navigates to another tab');
  check(door.label === 'Log a feed', 'a six-week-old\'s parent is offered "Log a feed"', door.label);
  check(door.sheetOpen, 'tapping it opens a log sheet there and then', door.sheetTitle);
  check(door.toddlerLabel === 'Start a nap', 'a twenty-month-old\'s parent is offered "Start a nap"', door.toddlerLabel);

  // ---- 10. THE FIRST FORM'S PROMISE MATCHES ITS VALIDATION -------------------------------------
  /* It said "just a name to get started" and then refused to save without a birthday. Whatever the
     copy names as needed has to be exactly what saveBaby enforces, or the very first thing a parent
     does in this product is get told off for believing it. */
  console.log('\n10. the add-baby sheet asks for what it actually requires');
  const form = await page.evaluate(() => {
    openAddBaby({ onboarding: false });
    var sub = (document.querySelector('#sheet .sub') || {}).textContent || '';
    var said = [];
    var realToast = window.toast; window.toast = function (m) { said.push(m); };
    var before = (state.babies || []).length;
    document.querySelector('#bName').value = 'Aria';
    saveBaby();                                   // name only: must be refused
    var refusedOnBirthday = /birthday/i.test(said.join(' ')) && (state.babies || []).length === before;
    window.toast = realToast;
    closeSheet();
    return { sub: sub, refusedOnBirthday: refusedOnBirthday };
  });
  check(form.refusedOnBirthday, 'a name alone is still refused, so the birthday really is required', form.sub);
  check(/birthday/i.test(form.sub), 'and the sub line says so instead of promising "just a name"', form.sub);

  // ---- 11. THE CHECKLIST TICKS WHEN YOU FOLLOW IT ----------------------------------------------
  /* "Log your first entry" opened the feed sheet, whose primary button starts a nursing TIMER — and
     a timer writes state.timers, while this row's own completion test reads state.events. A parent
     did exactly what the app told her and the box stayed empty. Whatever the row points at has to
     be able to tick the row. */
  console.log('\n11. following "log your first entry" actually ticks it');
  const list = await page.evaluate(async () => {
    state.events = []; markSeen('tip_logguide'); go('home');
    const html = renderGetStarted();
    const out = { rowAction: (html.match(/onclick="([^"]*)"[^>]*>\s*<span class="gs-check">/g) || []).length };
    const m = html.match(/<div class="gs-row"[^>]*onclick="([^"]+)"[^>]*>(?:(?!<\/div>).)*?Log your first entry/s);
    out.action = m ? m[1] : (html.split('Log your first entry')[0].match(/onclick="([^"]+)"[^>]*$/) || [])[1] || '';
    out.notFeedTimer = !/openFeed/.test(out.action);
    out.doneBefore = /gs-row done[^>]*>(?:(?!<\/div>).)*?/.test(html) && false;
    // follow it end to end
    try { eval(out.action); } catch (e) { out.err = e.message; }
    await new Promise(r => setTimeout(r, 250));
    out.sheetOpened = !!document.querySelector('#sheet.show');
    const opt = document.querySelector('#sheet.show .opt');
    if (opt) opt.click();
    await new Promise(r => setTimeout(r, 350));
    out.eventsAfter = (state.events || []).length;
    /* The row must STOP ASKING. It used to have to be ticked in place, and this went red when the
       card started retiring itself the moment you log — renderGetStarted() now returns '' once a
       first entry exists, which is the charter working as intended: the card is called "Get started",
       and once you have started it stops nagging. Demanding a visible tick was demanding the old
       design back. What must never come back is the bug this section is named for: a parent does
       exactly what the app told her and it still asks. Ticked in place or gone entirely both satisfy
       that; still pending does not. */
    const gsAfter = renderGetStarted();
    out.gsRetired = gsAfter.trim() === '';
    out.rowTicked = /class="gs-row done"[^>]*>(?:(?!gs-row)[\s\S])*?Log your first entry/.test(gsAfter);
    out.stillAsking = /Log your first entry/.test(gsAfter) && !out.rowTicked;
    out.rowNowDone = !out.stillAsking && (out.gsRetired || out.rowTicked);
    return out;
  });
  check(list.notFeedTimer, 'the row no longer points at the sheet whose button writes a timer', list.action);
  check(list.sheetOpened, 'tapping the row opens a log sheet', list.action);
  check(list.eventsAfter > 0, 'following it through writes a real entry', 'events: ' + list.eventsAfter);
  check(list.rowNowDone, 'and it stops asking for it — ticked in place, or the card retires',
    'retired: ' + list.gsRetired + '  ticked: ' + list.rowTicked + '  stillAsking: ' + list.stillAsking);

  // ---- 12. A PARTNER IS NOT ASSUMED TO BE THE CARRIER ------------------------------------------
  /* Relationship is optional at identity, and an empty one used to fall through the "is he one of
     the bears that cannot be pregnant" list as carrier — so a father who skipped the dropdown was
     shown "First day of your last period". Unknown now falls back to who set the journey up. */
  console.log('\n12. an unnamed relationship does not assume the carrier');
  const carrier = await page.evaluate(() => {
    var me = myUid();
    window.LL = window.LL || {};
    window.LL.memberInfo = {}; window.LL.memberInfo[me] = { relationship: '' };
    var out = {};
    window.LL.matIsOwner = function () { return true; };
    out.blankOwner = viewerIsCarrier();
    window.LL.matIsOwner = function () { return false; };
    out.blankInvited = viewerIsCarrier();
    window.LL.memberInfo[me] = { relationship: 'Papa Bear' };
    out.namedPapa = viewerIsCarrier();
    window.LL.memberInfo[me] = { relationship: 'Mama Bear' };
    out.namedMama = viewerIsCarrier();
    return out;
  });
  check(carrier.blankOwner === true, 'the person who set the journey up is still treated as the carrier');
  check(carrier.blankInvited === false, 'someone invited into it, who never named a relationship, is not');
  check(carrier.namedPapa === false, 'a named Papa Bear is never the carrier');
  check(carrier.namedMama === true, 'a named Mama Bear always is');

  // ---- 13. QUIET AFTER A LOSS, FOR A PARENT WHO STILL HAS A CHILD ------------------------------
  /* The holding screen is the whole screen and it is gated on having no babies, which is right — you
     cannot lock a mother out of her living child's feed log. But the conclusion drawn from that was
     "give her nothing": the flag was only ever seeded when babies.length was 0, and cleared on the
     next paint if a baby appeared. A mother who lost one twin got "A fresh day with Aria 🌿", the
     Get started checklist and the photo prompt. She gets quiet now, and an exit only she can take. */
  console.log('\n13. a bereaved parent who still has a child gets quiet, not cheer');
  const quiet = await page.evaluate(() => {
    const me = myUid();
    state.babies = [{ id: 'b1', name: 'Aria', birth: Date.now() - 400 * 86400000, routines: [] }];
    state.activeBabyId = 'b1'; state.events = []; state.photos = [];
    markSeen('tip_logguide');
    state.lossHolding = {}; state.lossHolding[me] = { at: Date.now() };
    go('home');
    const held = !!myLossHolding();
    const txt = document.getElementById('scroll').innerText;
    return {
      survives: held,
      quietLine: /keeping things quiet/.test(txt),
      hasExit: /Everyday view/.test(txt),
      noChecklist: !/Get started/.test(txt),
      noTicker: !/Tap Sleep to start a live nap timer/.test(txt),
      noPhotoAsk: !/Saved photos appear here/.test(txt),
      noFreshDay: !/A fresh day with/.test(txt),
      stillHasLog: /notes/i.test(txt),          // the lane heading renders uppercased
      getStartedEmpty: renderGetStarted() === '',
      guideCardEmpty: (window.CubbyGuide ? CubbyGuide.homeCard(false) : '') === ''
    };
  });
  check(quiet.survives, 'the quiet state is not silently cleared by the presence of a baby');
  check(quiet.noFreshDay && quiet.quietLine, 'the cheerful greeting line is replaced by a quiet one', JSON.stringify(quiet.quietLine));
  check(quiet.hasExit, 'and she has a way back to the everyday view');
  check(quiet.noChecklist && quiet.getStartedEmpty, 'no setup checklist');
  check(quiet.noTicker, 'no animated tips ticker');
  check(quiet.noPhotoAsk, 'the empty photo state asks for nothing');
  check(quiet.guideCardEmpty, 'the guide does not offer itself either');
  check(quiet.stillHasLog, 'she keeps full access to her living child\'s log');

  const takeover = await page.evaluate(() => {
    state.babies = []; state.activeBabyId = null; render();
    return { holding: /renderLossHolding|When you're ready|quiet/i.test(document.body.innerHTML) && !document.querySelector('.gs-card') };
  });
  check(takeover.holding, 'with no baby at all, the full holding screen still takes over');

  // ---- 14. NOTHING IS DESTROYED AT AN ACT BREAK ------------------------------------------------
  console.log('\n14. an act break keeps what she gave us');
  let page2 = await boot(browser, seed(45));
  const keep = await page2.evaluate(() => {
    const out = {};
    // a pregnancy that ended in a birth, with a moment and a written journey card
    state.pregnancy = { id: 'p1', ownerUid: myUid(), stage: 'expecting', dueDate: Date.now(), lmp: Date.now() - 280 * 86400000,
      country: 'us', careTeam: [], appts: [], moments: [{ photoId: 'ph1', week: 20, at: Date.now(), note: 'first scan' }],
      journey: { saved: { card_a: { photoId: null, note: 'the day we told my mother', date: '2026-03-01', at: Date.now() } } },
      bornBabyId: 'b1', birthAt: Date.now() - 86400000 };
    state.pregnancyArchive = [];
    // She starts a second pregnancy. openStartPregnancy resets pregDraft to date mode, so the draft
    // has to be set AFTER it opens or savePregnancy bails on an empty date field.
    openStartPregnancy();
    pregDraft.mode = 'weeks'; pregDraft.weeks = 8; pregDraft.days = 0;
    var w = document.getElementById('pgWeeks'); if (w) w.value = '8';
    savePregnancy();
    const arr = state.pregnancyArchive || [];
    out.archived = arr.length === 1;
    out.notLoss = arr.length ? arr[0].loss === false : false;
    out.keptMoment = arr.length ? (arr[0].moments || []).some(m => m.note === 'first scan') : false;
    out.keptCard = arr.length ? Object.keys(arr[0].journey || {}).length === 1 : false;
    out.newPregnancyFresh = !!(state.pregnancy && !state.pregnancy.bornBabyId);
    if (typeof closeSheet === 'function') closeSheet();
    return out;
  });
  check(keep.archived, 'a second pregnancy archives the first instead of overwriting it');
  check(keep.notLoss, 'and archives it as a birth, not a loss', String(keep.notLoss));
  check(keep.keptMoment, 'her scan survives');
  check(keep.keptCard, 'the card she wrote survives');
  check(keep.newPregnancyFresh, 'and the new pregnancy starts clean');

  const lossKeep = await page2.evaluate(() => {
    state.pregnancy = { id: 'p2', ownerUid: myUid(), stage: 'expecting', dueDate: Date.now() + 100 * 86400000,
      moments: [{ photoId: null, week: 12, at: Date.now(), note: 'twelve weeks' }],
      journey: { saved: { card_b: { photoId: null, note: 'what I would have called you', date: '', at: Date.now() } } } };
    state.pregnancyArchive = [];
    endPregnancy(true);
    const a = (state.pregnancyArchive || [])[0] || {};
    openKeptMemories();
    const sheet = (document.querySelector('#sheet.show') || {}).innerText || '';
    const out = { archivedCard: Object.keys(a.journey || {}).length === 1, rendered: /what I would have called you/.test(sheet) };
    if (typeof closeSheet === 'function') closeSheet();
    return out;
  });
  check(lossKeep.archivedCard, 'the journey cards she wrote are archived at a loss, not destroyed');
  check(lossKeep.rendered, 'and Kept memories actually shows them');
  await page2.close();

  // ---- 15. THE IN-APP TEACHING LAYER -----------------------------------------------------------
  /* Info affordances beside the core journeys, each opening a few-step story that ends in the real
     action. Same rule as the guide: pull only. If a story ever opens itself it has become the tour
     ONBOARDING.md rules out, so "never auto-opens" is an assertion, not a comment. */
  console.log('\n15. info affordances open a short story and end in the real thing');
  page = await boot(browser, seed(45));
  const st = await page.evaluate(async () => {
    const out = { keys: CubbyGuide.stories(), bad: [], steps: {} };
    // every story ends somewhere real
    out.keys.forEach(k => {
      CubbyGuide.story(k, 0);
      const o = document.getElementById('logGuide');
      const dots = o ? o.querySelectorAll('.lg-dot').length : 0;
      out.steps[k] = dots;
      if (dots < 3 || dots > 4) out.bad.push(k + ' has ' + dots + ' steps');
      CubbyGuide.close();
    });
    // the dot itself
    const html = CubbyGuide.info('logging');
    out.dotIsButton = /^<button class="lg-i"/.test(html);
    out.dotStopsBubbling = /stopPropagation/.test(html);
    out.dotHasLabel = /aria-label="[^"]+"/.test(html);
    out.unknownKeyEmpty = CubbyGuide.info('does-not-exist') === '';

    // walking a story
    CubbyGuide.story('sharing', 0);
    const first = (document.querySelector('#logGuide .lg-h') || {}).textContent || '';
    const noBackOnFirst = !document.querySelector('#logGuide .lg-back');
    document.querySelector('#logGuide .lg-try').click();
    const second = (document.querySelector('#logGuide .lg-h') || {}).textContent || '';
    const hasBack = !!document.querySelector('#logGuide .lg-back');
    document.querySelector('#logGuide .lg-back').click();
    const backAgain = (document.querySelector('#logGuide .lg-h') || {}).textContent || '';
    out.advances = first !== second && first !== '';
    out.backWorks = backAgain === first;
    out.noBackOnFirst = noBackOnFirst;
    out.gainsBack = hasBack;
    // the last step's action closes the overlay and calls the real function
    CubbyGuide.story('logging', 99);           // clamps to last
    out.lastCta = (document.querySelector('#logGuide .lg-try') || {}).textContent || '';
    let opened = false;
    const realFeed = window.openFeed; window.openFeed = function () { opened = true; };
    document.querySelector('#logGuide .lg-try').click();
    await new Promise(r => setTimeout(r, 150));
    out.ctaRan = opened;
    out.ctaClosed = !document.getElementById('logGuide');
    window.openFeed = realFeed;
    out.noProgressStored = !JSON.stringify(localStorage).match(/story|lg-step/i);
    return out;
  });
  check(st.keys.length >= 5, 'the core journeys each have a story', JSON.stringify(st.keys));
  check(st.bad.length === 0, 'every story is three or four steps, never a tour', JSON.stringify(st.bad));
  check(st.dotIsButton && st.dotHasLabel, 'the info affordance is a real labelled button');
  check(st.dotStopsBubbling, 'and it does not also fire the row it sits inside');
  check(st.unknownKeyEmpty, 'an unknown key renders nothing rather than a dead dot');
  check(st.noBackOnFirst && st.advances && st.gainsBack && st.backWorks, 'you can step forward and back',
    JSON.stringify({ advances: st.advances, back: st.backWorks }));
  check(st.ctaRan && st.ctaClosed, 'the last step does the real thing and closes', st.lastCta);
  check(st.noProgressStored, 'no progress or completion state is stored for a story');

  const noPush = await page.evaluate(() => {
    // nothing may open a story on its own: a render must never mount the overlay
    CubbyGuide.close(); render();
    const afterRender = !document.getElementById('logGuide');
    // and loss safety applies to stories exactly as it does to the guide
    state.babies = []; window.myLossHolding = function () { return true; };
    CubbyGuide.story('sharing', 0);
    return { afterRender: afterRender, refusedInLoss: !document.getElementById('logGuide') };
  });
  check(noPush.afterRender, 'a render never opens a story by itself');
  check(noPush.refusedInLoss, 'and a story refuses to open over the holding screen');
  await page.close();

  // ---- 16. THE HOME ANSWERS ITS THREE QUESTIONS FIRST ------------------------------------------
  console.log('\n16. the three answers come before the day surface');
  page = await boot(browser, seed(45));
  const order = await page.evaluate(() => {
    go('home');
    const html = document.getElementById('scroll').innerHTML;
    const since = html.indexOf('since-row');
    const day = html.indexOf('day-surface');
    const quick = html.indexOf('Quick log');
    return { since, day, quick, ok: since > -1 && day > -1 && since < day && quick < day };
  });
  check(order.ok, 'last feed / sleep / nappy render above the notes day-surface, and Quick log does too',
    JSON.stringify(order));
  // deliberately left open: section 17 reads this page's collected errors, then closes it

  // ---- 17. WAKE WINDOWS, AND THE RULE THAT PERMITS THEM ----------------------------------------
  /* "Refuse to predict where the parent cannot check the answer" (guardrails, restated 2026-08-08).
     This is legal because it resolves within the hour and because it is a statement about HER OWN
     logged fortnight. Everything below is the boundary of that permission: a range and never a
     clock time, her own data and never a population table, silence rather than a guess. */
  console.log('\n17. the wake-window line stays inside what the rule permits');
  const ww = await page.evaluate(() => {
    const H = 3600000, D = 86400000;
    function seedNaps(days, windowMin, spreadMin) {
      const ev = []; let id = 0;
      for (let d = 1; d <= days; d++) {
        const base = new Date(Date.now() - d * D); base.setHours(7, 0, 0, 0);
        let wake = base.getTime();
        for (let n = 0; n < 3; n++) {
          const at = wake + (windowMin + (n % 2 ? spreadMin : 0)) * 60000;
          ev.push({ id: 'w' + (id++), babyId: 'b1', type: 'sleep', time: at, end: at + 45 * 60000 });
          wake = at + 45 * 60000;
        }
        // a 2am resettle every night: a real gap, and the wrong answer to "when this afternoon?"
        const n2 = new Date(Date.now() - d * D); n2.setHours(2, 0, 0, 0);
        ev.push({ id: 'w' + (id++), babyId: 'b1', type: 'sleep', time: n2.getTime() - 3 * H, end: n2.getTime() });
        ev.push({ id: 'w' + (id++), babyId: 'b1', type: 'sleep', time: n2.getTime() + 20 * 60000, end: n2.getTime() + 3 * H });
      }
      state.events = ev;
    }
    const out = {};
    state.babies = [{ id: 'b1', name: 'Aria', birth: Date.now() - 100 * D, routines: [] }];
    state.activeBabyId = 'b1'; state.timers = {};
    try { localStorage.removeItem('cubby-ww-hidden-local'); } catch (e) {}

    // too little of her own history: say nothing at all rather than guess
    state.events = [];
    out.emptySilent = wakeWindowLine() === '';
    out.notEnoughFlag = (wakeWindow() || {}).enough === false;

    seedNaps(12, 105, 5);
    const w = wakeWindow();
    out.enough = w.enough;
    out.nightExcluded = w.lo >= 90 * 60000;      // a counted 20m resettle would drop this to ~20m

    /* Pin the daytime boundary rather than depending on the wall clock, so these cases run at 3am
       too. The seeded naps are already stamped at real daytime hours, so only the "is it daytime
       NOW" question needs forcing; wakeWindow's own sample filter is left alone. */
    const realDaytime = window.wwIsDaytime;
    window.wwIsDaytime = function (ts) { return ts > Date.now() - 60000 ? true : realDaytime(ts); };
    out.daytime = true;
    state.events.unshift({ id: 'recent', babyId: 'b1', type: 'sleep', time: Date.now() - 2 * H, end: Date.now() - 70 * 60000 });
    const line = wakeWindowLine();
    out.rendered = line.length > 0;
    out.hasRange = /between/.test(line);
    out.noClockTime = !/\d{1,2}:\d{2}/.test(line);
    out.noWill = !/\bwill\b|\bshould\b|\bdue\b/i.test(line);
    /* PROPERTY, not phrasing. This asserted the literal strings "own logs" and "Every day is
       different", and went red the day the copy was IMPROVED to
       "From 12 gaps between naps in your family's last 14 days. Just what happened, not a forecast."
       — which names the sample far more precisely and disclaims prediction more firmly than the
       wording it replaced. A gate that fails on a better sentence is worse than no gate: it trains
       people to ignore it, and it very nearly had a regression reported that never happened.
       What actually matters is that the line CITES A COUNTABLE SAMPLE (so a parent can see how thin
       the evidence is) and REFUSES TO PREDICT. Assert those two, and let the words move. */
    const cites = (line.match(/\d+/g) || []).length >= 2;
    const refuses = /(not a forecast|every day is different|just what happened|what happened, not)/i.test(line);
    out.namesSample = cites && refuses;
    out.sampleLine = line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

    // asleep right now -> nothing to say
    timersFor('b1').sleep = { start: Date.now() - 10 * 60000 };
    out.silentWhileAsleep = wakeWindowLine() === '';
    delete state.timers['b1'].sleep;

    // a range too wide to mean anything stays quiet
    seedNaps(12, 60, 200);
    state.events.unshift({ id: 'recent2', babyId: 'b1', type: 'sleep', time: Date.now() - 2 * H, end: Date.now() - 70 * 60000 });
    const wide = wakeWindow();
    out.wideSuppressed = (wide.hi - wide.lo) > 2 * H ? wakeWindowLine() === '' : 'n/a';

    // hideable, per person
    seedNaps(12, 105, 5);
    state.events.unshift({ id: 'recent3', babyId: 'b1', type: 'sleep', time: Date.now() - 2 * H, end: Date.now() - 70 * 60000 });
    out.backBeforeHide = wakeWindowLine().length > 0;
    hideWakeWindow();
    out.hidden = wakeWindowLine() === '';
    try { localStorage.removeItem('cubby-ww-hidden-local'); } catch (e) {}

    // and it is never spoken over a bereaved parent
    window.myLossHolding = function () { return true; };
    out.silentInLoss = wakeWindowLine() === '';
    return out;
  });
  check(ww.emptySilent && ww.notEnoughFlag, 'with too little history it says nothing rather than guessing');
  check(ww.enough && ww.nightExcluded, 'a 2am resettle is not counted as a daytime wake window',
    'low end: ' + Math.round((ww.nightExcluded ? 1 : 0)) );
  if (ww.daytime) {
    check(ww.rendered && ww.hasRange, 'it offers a range, from her own logs');
    check(ww.noClockTime, 'and never a clock time, which would be a forecast she cannot check');
    check(ww.noWill, 'no "will", no "should", no "due" — it describes the past, not an obligation');
    check(ww.namesSample, 'it names the sample it came from and refuses to forecast', ww.sampleLine);
    check(ww.silentWhileAsleep, 'it says nothing while the baby is actually asleep');
    check(ww.backBeforeHide && ww.hidden, 'and it can be hidden for good, per person');
  } else {
    console.log('  note: skipped the rendering cases, the clock is outside daytime hours');
  }
  check(ww.wideSuppressed === true || ww.wideSuppressed === 'n/a', 'a range too wide to be useful stays quiet', String(ww.wideSuppressed));
  check(ww.silentInLoss, 'and it never speaks over a bereaved parent');

  // ---- 18. A LONG SLEEP IS RARELY UNBROKEN -----------------------------------------------------
  /* Logging "7pm to 6am" used to credit eleven hours whether the baby woke twice or not, so every
     sleep total in the app — including the doctor report — was the optimistic number. Wakings are a
     property of the sleep, not six sheets at 3am. Absent on every entry logged before this existed,
     which must still sum exactly as it always did. */
  console.log('\n18. wakings make the sleep totals honest');
  const wk = await page.evaluate(() => {
    const H = 3600000, out = {};
    const plain = { id: 'sl1', babyId: 'b1', type: 'sleep', time: Date.now() - 12 * H, end: Date.now() - 1 * H };
    out.legacyUnchanged = netSleepMs(plain) === 11 * H;
    const broken = Object.assign({}, plain, { wakings: { n: 2, mins: 40 } });
    out.subtracted = netSleepMs(broken) === 11 * H - 40 * 60000;
    out.label = wakingsLabel(broken);
    out.noLabelWhenNone = wakingsLabel(plain) === '';
    out.onceReadsOnce = wakingsLabel(Object.assign({}, plain, { wakings: { n: 1, mins: 15 } }));
    // a mistyped waking longer than the sleep can never produce negative sleep
    out.neverNegative = netSleepMs(Object.assign({}, plain, { wakings: { n: 1, mins: 5000 } })) === 0;
    // the day total uses the net number
    state.babies = [{ id: 'b1', name: 'Aria', birth: Date.now() - 100 * 86400000, routines: [] }];
    state.activeBabyId = 'b1'; state.timers = {};
    state.events = [broken];
    out.summaryShowsWakings = /woke twice/.test(eventDetail(broken));
    return out;
  });
  check(wk.legacyUnchanged, 'a sleep with no wakings recorded sums exactly as it always did');
  check(wk.subtracted, 'wakings come off the total');
  check(wk.neverNegative, 'and a mistyped waking longer than the sleep cannot produce negative sleep');
  check(/woke twice for about 40m/.test(wk.label), 'it reads in words, not numbers', wk.label);
  check(/woke once/.test(wk.onceReadsOnce), 'once is "once", not "1 times"', wk.onceReadsOnce);
  check(wk.noLabelWhenNone, 'and a straight-through sleep says nothing extra');

  // ---- 19. THE RECORD SURVIVES THE BIRTH, AND KEEPS ITS PRIVACY --------------------------------
  /* After a birth the pregnancy shell has no tabs, so care team, appointments, readings, birth plan
     and her private wellbeing notes all became unreachable while still syncing. They are reachable
     again — and every category obeys the same pregCanSee() gate the live screen used, so nothing
     becomes visible to a caregiver that was not visible before. Mood is owner-only forever. */
  console.log('\n19. the pregnancy record is reachable after birth, with its gates intact');
  const rec = await page.evaluate(() => {
    const out = {};
    window.LL = window.LL || {};
    state.babies = [{ id: 'b1', name: 'Aria', birth: Date.now() - 20 * 86400000, routines: [] }];
    state.activeBabyId = 'b1';
    state.pregnancy = {
      id: 'p1', ownerUid: myUid(), stage: 'expecting', dueDate: Date.now() - 20 * 86400000,
      careTeam: [{ id: 'c1', name: 'Dr Khan', role: 'Obstetrician', phone: '+971500000000' }],
      appts: [{ id: 'a1', week: 28, title: 'Glucose test', done: true, at: Date.now() - 60 * 86400000, outcome: 'all clear' }],
      weights: [{ id: 'w1', at: Date.now(), kg: 68 }], bp: [{ id: 'b1', at: Date.now() }],
      birthPlan: 'Low lights, my own music.', moodLog: [{ id: 'm1', at: Date.now(), mood: 'Tired', note: 'private' }],
      bornBabyId: 'b1', birthAt: Date.now() - 20 * 86400000
    };
    function asOwner() { window.LL.matIsOwner = () => true; window.LL.matCanRead = () => true; }
    function asCaregiver(canRead) { window.LL.matIsOwner = () => false; window.LL.matCanRead = c => !!canRead[c]; }

    // before a birth there is no "record" door: the live screen already has everything
    asOwner();
    const born = state.pregnancy.bornBabyId; state.pregnancy.bornBabyId = null;
    out.noRowBeforeBirth = pregRecordAvailable() === false;
    state.pregnancy.bornBabyId = born;
    out.rowAfterBirth = pregRecordAvailable() === true;

    function sheetText() { openPregRecord(); const t = (document.querySelector('#sheet.show') || {}).innerText || ''; closeSheet(); return t; }
    const asHer = sheetText();
    out.ownerSeesTeam = /Dr Khan/.test(asHer);
    out.ownerSeesPhone = /\+971500000000/.test(asHer);
    out.ownerSeesAppt = /Glucose test/.test(asHer) && /all clear/.test(asHer);
    out.ownerSeesPlan = /Low lights/.test(asHer);
    out.ownerSeesMood = /How you are, in yourself/.test(asHer);
    // read-only: none of the live screen's actions come with it
    out.noAdd = !/Add to care team/.test(asHer);
    out.noArrived = !/Baby has arrived/.test(asHer);
    out.noEnd = !/End this pregnancy/.test(asHer);
    out.noDueEdit = !/Due date/.test(asHer);

    // a caregiver she shared the care team with, and nothing else
    asCaregiver({ careteam: true });
    const asHim = sheetText();
    out.cgSeesTeam = /Dr Khan/.test(asHim);
    out.cgNoPlan = !/Low lights/.test(asHim);
    out.cgNoAppt = !/Glucose test/.test(asHim);
    out.cgNoMood = !/How you are, in yourself/.test(asHim);
    out.cgNoPrivateNote = !/private/.test(asHim);

    // a caregiver she shared nothing with
    asCaregiver({});
    out.cgNothingAvailable = pregRecordAvailable() === false;
    // and openMoodNote refuses outright, whatever calls it
    const before = document.querySelector('#sheet.show');
    openMoodNote();
    out.moodRefused = document.querySelector('#sheet.show') === before;
    asOwner();
    return out;
  });
  check(rec.noRowBeforeBirth && rec.rowAfterBirth, 'the record door appears only once the pregnancy is a keepsake');
  check(rec.ownerSeesTeam && rec.ownerSeesPhone, 'she gets her care team back, phone numbers included');
  check(rec.ownerSeesAppt, 'and the appointments she kept, with their outcomes');
  check(rec.ownerSeesPlan, 'and her birth plan');
  check(rec.ownerSeesMood, 'and her private wellbeing notes, which had no door at all after a birth');
  check(rec.noAdd && rec.noArrived && rec.noEnd && rec.noDueEdit,
    'it asks nothing of her: no add, no "baby has arrived", no ending a pregnancy that is over');
  check(rec.cgSeesTeam, 'a caregiver sees exactly the category she shared');
  check(rec.cgNoPlan && rec.cgNoAppt, 'and not the ones she did not');
  check(rec.cgNoMood && rec.cgNoPrivateNote, 'mood never appears for anyone but her, not even as a row');
  check(rec.cgNothingAvailable, 'and with nothing shared, the door does not exist');
  check(rec.moodRefused, 'openMoodNote refuses a non-owner outright, whatever reaches it');

  const carried = await page.evaluate(() => {
    // her wellbeing log is hers, not the pregnancy's: a new pregnancy must not erase it
    state.pregnancy = { id: 'p1', ownerUid: myUid(), stage: 'expecting', bornBabyId: 'b1', birthAt: Date.now(),
      moments: [], journey: { saved: {} }, moodLog: [{ id: 'm1', at: Date.now(), mood: 'Tired', note: 'kept' }] };
    state.pregnancyArchive = [];
    openStartPregnancy();
    pregDraft.mode = 'weeks'; pregDraft.weeks = 8; pregDraft.days = 0;
    const w = document.getElementById('pgWeeks'); if (w) w.value = '8';
    savePregnancy();
    const out = { survived: ((state.pregnancy.moodLog) || []).some(m => m.note === 'kept') };
    if (typeof closeSheet === 'function') closeSheet();
    return out;
  });
  check(carried.survived, 'and starting a second pregnancy does not erase what she wrote during the first');

  // ---- 20. THE INVITE TOKEN SURVIVES THE TRIP --------------------------------------------------
  /* The rules are what keep the wrong person out and they are proved in test/invite-link.test.js
     against the emulator. What is proved HERE is the plumbing either side of them: that a token in
     the URL reaches sessionStorage intact (it has to survive the OAuth redirect), that the older
     ?join=1 links still read as intent, and that the token generator is actually unguessable —
     uid() would have been timestamp-and-Math.random, which is not a secret. */
  console.log('\n20. the invite token survives the round trip');
  const tokPage = await browser.newPage();
  await tokPage.setViewport({ width: 390, height: 850 });
  await tokPage.goto(APP + '&join=Ab3xY9zQ7mKp2LsW4nR1td', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  const tk = await tokPage.evaluate(() => ({
    stored: sessionStorage.getItem('cubby-join'),
    hasCreate: !!(window.LL && typeof window.LL.createInviteLink === 'function')
  }));
  check(tk.stored === 'Ab3xY9zQ7mKp2LsW4nR1td', 'a token in the link reaches sessionStorage intact', String(tk.stored));
  check(tk.hasCreate, 'the owner-side mint function is wired up');

  await tokPage.goto(APP + '&join=1', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 900));
  const legacy = await tokPage.evaluate(() => sessionStorage.getItem('cubby-join'));
  check(legacy === '1', 'an older ?join=1 link still reads as plain intent', String(legacy));

  const rnd = await tokPage.evaluate(() => {
    // the generator, exercised through the same crypto path the app uses
    const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    function gen() { const b = new Uint8Array(22); crypto.getRandomValues(b); let s = ''; for (let i = 0; i < b.length; i++) s += A[b[i] % A.length]; return s; }
    const seen = new Set(); for (let i = 0; i < 500; i++) seen.add(gen());
    const one = gen();
    return { unique: seen.size, len: one.length, charset: /^[A-Za-z0-9]{22}$/.test(one) };
  });
  check(rnd.unique === 500, '500 tokens, 500 distinct values', String(rnd.unique));
  check(rnd.len === 22 && rnd.charset, 'each is 22 base62 characters, about 130 bits');
  await tokPage.close();

  // ---- 21. NO PAGE ERRORS THROUGHOUT -----------------------------------------------------------
  console.log('\n21. clean console');
  check(page.__errs.length === 0, 'no uncaught page errors', page.__errs.join(' | '));
  await page.close();

  await browser.close();
  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
