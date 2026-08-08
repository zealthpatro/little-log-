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
      var c = cubbyGuideCtx(); c.week = w;
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

    // N4: "Pin to today (always shows up top)" has to be true on today too.
    state.notes = [
      { id: 'n_new', createdBy: me, createdByName: 'Me', at: Date.now(), day: today, text: 'newer chatter', audience: 'circle', pinned: false },
      { id: 'n_pin', createdBy: me, createdByName: 'Me', at: Date.now() - 3600000, day: today, text: 'formula is in the top cupboard', audience: 'circle', pinned: true }
    ];
    var html = daySurface();
    out.pinFirst = html.indexOf('formula is in the top cupboard') < html.indexOf('newer chatter');

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
    window.toast = realToast;

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
  check(notes.addCalls === 1, 'three taps on "Leave note" write one note, not three', 'calls: ' + notes.addCalls);
  check(notes.onPin === 'Pinned to top', 'pinning says "Pinned to top"', notes.onPin);
  check(notes.onUnpin === 'Unpinned', 'unpinning says "Unpinned"', notes.onUnpin);
  check(notes.saysEmpty, 'the empty lane says in plain words that it is empty');
  check(notes.quoteKept, 'and the quote of the day is still there, nothing was removed');
  check(notes.maxlen === '1000', 'the composer caps a note at 1000 characters', String(notes.maxlen));

  // ---- 9. NO PAGE ERRORS THROUGHOUT ------------------------------------------------------------
  console.log('\n9. clean console');
  check(page.__errs.length === 0, 'no uncaught page errors', page.__errs.join(' | '));
  await page.close();

  await browser.close();
  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
