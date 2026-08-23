#!/usr/bin/env node
/* A woman tried for a year, conceived, and lost the pregnancy. Cubby deleted the year.
 *
 * WHAT WAS WRONG, in the order she met it.
 *
 * 1. THE DAY SHE CONCEIVED, her record went dark. confirmPositiveTest flips p.stage to 'expecting'
 *    IN PLACE, so every period start date and every observation she had written stayed sitting on
 *    the same object, untouched. But periodHistory() and obsEntries() were read only by
 *    planning-stage render code and by ttcVisitSummary, and pregVisitSummary never touched either.
 *    So up to two hundred notes and a year of cycle dates became unreachable inside the app on the
 *    happiest morning of it, and the pregnancy doctor report — the one document built for the
 *    appointment where a doctor asks "how long were you trying?" — could not answer.
 *
 * 2. THEN THE KEEP BUTTON DELETED THEM. endPregnancy(true), the branch labelled "Keep my
 *    memories", archived {moments, journey} and nothing else, and pregClear() then removed the
 *    journey doc. So the button she pressed to keep things is the button that took the whole
 *    record of the trying. Her private wellbeing notes went too: moodLog lives in the owner-only
 *    mhealth 'mood' doc that matClear deletes, while savePregnancy carries that same log forward
 *    between pregnancies with a comment saying it is hers and not the pregnancy's. Both cannot be
 *    true.
 *
 * 3. AND WITH NO SCAN PHOTO SHE WAS NEVER OFFERED THE CHOICE. confirmEndPregnancy gated the whole
 *    keep card, the keep button and the "this can't be undone" line on p.moments.length. A woman
 *    who tracked a year of cycles and lost a pregnancy at seven weeks, before any scan, saw one
 *    button: "Close and clear everything". The journey cards she had written were already being
 *    archived by a branch she could not reach.
 *
 * 4. AND THE ONE SCREEN SHE COULD REACH AFTERWARDS HAD NO DOOR. renderLossHolding gated "Your kept
 *    memories" on photos too, so anything kept without a photo was saved and unreachable at once,
 *    on the screen written for the worst day.
 *
 * 5. AND THE PLANNING "STOP TRACKING" SHEET LIED BY OMISSION. It said "This clears your planning
 *    checklist and notes" while deleting every period date she had ever entered, and offered no
 *    way to take any of it with her.
 *
 * FIXED: the trying record ({tryingSince, periods, observations, precon}) is readable after
 * conception (a Care-tab door into the report, plus a summary block in pregVisitSummary), survives
 * endPregnancy(true) on the archive entry with moodLog beside it, is readable from the kept-
 * memories sheet, is not swept away by "Remove these memories", and is named in both closing
 * sheets. moodLog is archived and seeded back into her next record, and is rendered nowhere.
 *
 * PRIVACY. periods and observations are NOT in the shareable mhealth 'health' category, and the
 * trying stage's own boundary is that cycle details are the carrier's alone
 * (renderPlanningPartnerHome states it). Section 4 asserts a partner she granted 'health' consent
 * to meets neither the door nor the report block, so this item does not widen a share by accident.
 *
 * WHAT THIS DOES NOT COVER, so a PASS is not read as more than it is. The harness runs in local
 * mode and injects window.LL by hand, so store-firebase.js never loads and firestore.rules is
 * never evaluated: the claim that the archive lands owner-private in users/{uid} is read from the
 * source, not exercised here. The 'mine' ownership test on the archive write IS exercised, through
 * the same predicate the app uses.
 *
 *   PORT=9286 node tools/serve.js &
 *   node tools/trying_survivor_check.js http://localhost:9286
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and gets graded happily, and reports PASS on work you
 * never wrote. Section 0 says which tree answered.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9286';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00, so every date below is a whole number of days from the pinned clock and no assertion
// lands on a boundary that only exists because the suite ran near midnight.
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam';

/* Her real shape: fourteen months of trying, five period starts, three observations, and a
   preparation checklist she never ticked. confirmPositiveTest carried all of it into 'expecting'
   without touching a key, which is exactly why it is all still here. */
const PERIODS = [now - 200 * DAY, now - 172 * DAY, now - 141 * DAY, now - 112 * DAY, now - 84 * DAY];
const OBS = [
  { id: 'o1', at: now - 150 * DAY, note: 'Felt a little off today', tags: ['Cramps'] },
  { id: 'o2', at: now - 120 * DAY, note: '', tags: ['Test: negative'] },
  { id: 'o3', at: now - 90 * DAY, note: 'Tender and tired', tags: [] },
];
const PRECON = [{ id: 'c1', text: 'Take folic acid, 400 micrograms daily', done: true },
  { id: 'c2', text: 'Check your vitamin D', done: false }];
const MOOD = [{ id: 'm1', at: now - 60 * DAY, mood: 'Anxious', note: 'Scan tomorrow' },
  { id: 'm2', at: now - 30 * DAY, mood: 'Calm', note: '' }];

const preg = (over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now + 28 * 7 * DAY, lmp: now - 12 * 7 * DAY, cycleLen: 29,
  periods: PERIODS.slice(), tryingSince: '2025-06', observations: OBS.slice(), precon: PRECON.slice(),
  country: 'uk', careTeam: [],
  appts: [{ id: 'a1', week: 12, title: 'Dating scan', note: '', done: false, at: null }],
  symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 220 * DAY,
  visitQs: [{ id: 'q1', text: 'Is my baby growing on track?', done: false }],
}, over || {});
/* The other woman in this file: she never used the trying stage at all, she tapped "We're
   expecting". savePregnancy writes no `periods` and no `tryingSince`, so nothing below may show
   her a "before this pregnancy" anything. */
const straightToExpecting = (over) => Object.assign(preg(), {
  periods: undefined, tryingSince: null, observations: [], precon: [],
}, over || {});
const planning = (over) => Object.assign(preg(), {
  stage: 'planning', dueDate: null, lmp: PERIODS[PERIODS.length - 1], appts: [], visitQs: null,
}, over || {});

const seed = (p, archive) => ({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [],
  pregnancy: p, pregnancyArchive: archive || [],
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  console.log('\n0. which checkout answered on this port');
  {
    const marker = await page.evaluate(() => typeof window.tryingRecordCount === 'function');
    console.log(marker
      ? '  [checkout] ' + BASE + ' serves a tree that has tryingRecordCount(). Good.'
      : '  [checkout] WARNING: ' + BASE + ' serves a tree with NO tryingRecordCount().\n'
        + '             Either the change is reverted, or this port belongs to another checkout.\n'
        + '             Every assertion below is expected to fail. Check the port first.');
  }

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };

  /* An assertion that CANNOT be made is a failure, not a crash. On a tree where the fix is absent,
     tryingRecordCount and keptMoodLog do not exist, and a bare page.evaluate rejects on the Node
     side and kills the run at section 1 — which is indistinguishable from a suite that was never
     written. Every call into app code below goes through this, so a reverted build reports RED
     across all sixteen sections instead of dying on the first ReferenceError. */
  const say = async (fn, fallback) => {
    try { return await page.evaluate(fn); }
    catch (e) { return fallback; }
  };

  /* window.LL.pregIsOwner / matIsOwner are copied VERBATIM from store-firebase.js so every gate
     below exercises the real ownership predicate rather than a stub of the gate's own invention:
     uid wins when the record carries an ownerUid, and household role decides only for a legacy
     record that never got one. `who` of null means no cloud at all, a solo mother offline. */
  const signIn = (who, role, matRead) => page.evaluate((w, r, mr) => {
    if (!w) { try { delete window.LL; } catch (e) { window.LL = undefined; } return; }
    window.LL = window.LL || {};
    window.LL.auth = { currentUser: { uid: w } };
    window.LL.role = r;
    window.LL.members = { uidMaya: 'owner', uidSam: 'caregiver' };
    window.LL.memberInfo = { uidMaya: { name: 'Maya Rao', relationship: 'Mama Bear' }, uidSam: { name: 'Sam Rao', relationship: 'Papa Bear' } };
    window.LL.pregIsOwner = function () {
      var u = window.LL.auth.currentUser; if (!u) return true;
      var p = state.pregnancy; if (!p) return true;
      if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
      return window.LL.role === 'owner';
    };
    window.LL.matIsOwner = window.LL.pregIsOwner;
    window.LL.matCanRead = function (c) { return window.LL.pregIsOwner() || (mr || []).indexOf(c) >= 0; };
    window.LL.pregJourneyShared = function () { return ['uidSam']; };
  }, who, role, matRead || []);

  /* The Care tab as it renders, read from #scroll. innerText is the RENDERED screen; the inline
     script's own source (which contains every string in this file) is never in it. The card count
     travels with the text so "the wrong copy is absent" can never pass on a screen that failed to
     render at all. */
  const CARE_NONE = { n: 0, body: null, wired: '', heading: false, appts: 0, cards: 0, txt: '', threw: true };
  const care = () => say(() => {
    pregGo('care');
    const s = document.getElementById('scroll');
    const titles = Array.from(s.querySelectorAll('.pc-t')).map((e) => (e.textContent || '').trim());
    const before = Array.from(s.querySelectorAll('.preg-card'))
      .filter((c) => /Your notes from trying/.test(c.textContent || ''));
    return {
      n: before.length,
      body: before[0] ? (before[0].querySelector('.pc-b').textContent || '').replace(/\s+/g, ' ').trim() : null,
      wired: before[0] ? (before[0].getAttribute('onclick') || '') : '',
      heading: /Before this pregnancy/.test(s.innerText || ''),
      appts: s.querySelectorAll('.appt-row').length,
      cards: titles.length,
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  }, CARE_NONE);
  const clickBefore = () => say(() => {
    const s = document.getElementById('scroll');
    const c = Array.from(s.querySelectorAll('.preg-card')).find((e) => /Your notes from trying/.test(e.textContent || ''));
    if (!c) return false; c.click(); return true;
  }, false);
  const report = () => say(() => {
    const o = document.getElementById('reportOv');
    return o ? (o.innerText || '').replace(/\s+/g, ' ').trim() : null;
  }, null);
  const closeReport = () => page.evaluate(() => { const o = document.getElementById('reportOv'); if (o) o.remove(); });
  const NO_SHEET = { txt: '', buttons: [], handlers: [] };
  const sheet = () => say(() => {
    const s = document.getElementById('sheet');
    if (!s || !s.classList.contains('show')) return { txt: '', buttons: [], handlers: [] };
    return {
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      buttons: Array.from(s.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
      handlers: Array.from(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')),
    };
  }, NO_SHEET);
  /* Returns false when the control is not on the sheet, which is a FAILED assertion at the call
     site rather than a crash: on a build without the fix half these buttons do not exist. */
  const tapSheet = async (re) => {
    try {
      return await page.evaluate((r) => {
        const s = document.getElementById('sheet');
        if (!s) return false;
        const el = Array.from(s.querySelectorAll('button,[onclick]')).find((e) => new RegExp(r).test((e.textContent || '').trim()));
        if (!el) return false; el.click(); return true;
      }, re.source || String(re));
    } catch (e) { return false; }
  };
  const arch = () => say(() => (state.pregnancyArchive || []).map((a) => ({
    id: a.id, loss: !!a.loss, moments: (a.moments || []).length,
    cards: Object.keys(a.journey || {}).length,
    periods: (a.periods || []).length, obs: (a.observations || []).length,
    since: a.tryingSince || null, precon: (a.precon || []).length,
    mood: (a.moodLog || []).length,
  })), []);

  console.log('\n1. the woman who never used the trying stage is shown nothing about it');
  {
    await load(seed(straightToExpecting()));
    await signIn(MAYA, 'owner');
    const r = await care();
    ok('her Care tab rendered at all', r.appts === 1 && /Dating scan/.test(r.txt), r);
    ok('no "Your notes from trying" door', r.n === 0, r);
    ok('no "Before this pregnancy" heading', r.heading === false, r.txt.slice(0, 300));
    const s = await say(() => pregVisitSummary(), '');
    ok('her doctor report has the pregnancy in it', /Week \d+/.test(s), s.slice(0, 120));
    ok('and no invented "Before this pregnancy" block', s.indexOf('Before this pregnancy:') < 0, s.slice(-300));
    /* Her lmp IS a period start, so periodHistory() returns one entry for her. The door must key
       off what she ENTERED, not off that, or every mother in the app gets this row. */
    const h = await say(() => ({ hist: periodHistory().length, count: tryingRecordCount() }), { hist: -1, count: -1 });
    ok('periodHistory still folds her lmp in', h.hist === 1, h);
    ok('but the trying count is zero', h.count === 0, h);
  }

  console.log('\n2. after conception her trying record is readable again');
  {
    await load(seed(preg()));
    await signIn(MAYA, 'owner');
    const r = await care();
    ok('the door is there, exactly once', r.n === 1, r);
    ok('it opens the report', /openTtcDoctorReport\(\)/.test(r.wired), r.wired);
    ok('it names when she started', /Trying since June 2025/.test(r.body || ''), r.body);
    ok('it counts her period dates', /5 period dates/.test(r.body || ''), r.body);
    ok('it counts what she noticed', /3 things you noticed/.test(r.body || ''), r.body);
    ok('and it does not ask her for anything', !/add|log|track/i.test(r.body || ''), r.body);
  }

  console.log('\n3. tapping it opens her own notes, not a stub');
  {
    ok('the card took the tap', await clickBefore(), true);
    await sleep(400);
    const t = await report();
    ok('the report opened', t !== null && t.length > 100, t && t.length);
    ok('it is headed for her appointment', /For your appointment/.test(t || ''), (t || '').slice(0, 120));
    /* The kicker said "Trying to conceive" from every door. She is twelve weeks pregnant. It says
       the same words as the heading that led her here, because three names for one object is one
       object she cannot be sure she found. */
    ok('the kicker is true where she is now', /Before this pregnancy/.test(t || '') && !/Trying to conceive/.test(t || ''), (t || '').slice(0, 200));
    ok('and it is the name the door used', !/Your notes from before/.test(t || ''), (t || '').slice(0, 200));
    ok('every period start is printed', ((t || '').match(/•/g) || []).length >= 8, ((t || '').match(/•/g) || []).length);
    ok('her cycle spread is stated from her own dates', /28 to 31 days/.test(t || ''), (t || '').slice(0, 900));
    ok('her observation text is there', /Tender and tired/.test(t || ''), (t || '').slice(0, 900));
    ok('and her checklist came too', /Preparation checklist \(1 of 2 done\)/.test(t || ''), (t || '').slice(0, 900));
    await closeReport();
  }

  console.log('\n4. the pregnancy doctor report can answer "how long were you trying?"');
  {
    const s = await say(() => pregVisitSummary(), '');
    ok('it still leads with the pregnancy', /^Week \d+/.test(s), s.slice(0, 60));
    ok('it now carries the block', s.indexOf('Before this pregnancy:') > 0, s.slice(-400));
    ok('naming when she started', /trying since June 2025/.test(s), s.slice(-400));
    /* Five starts on the record, and her lmp is the newest of them, so periodHistory folds in a
       date it already has rather than counting it twice. Six here would be the bug. */
    ok('counting her period dates', /5 period start dates recorded/.test(s), s.slice(-400));
    ok('with her own cycle spread', /completed cycles 28 to 31 days/.test(s), s.slice(-400));
    ok('and her latest note, dated', /1 observation|3 observation notes/.test(s) && /Tender and tired/.test(s), s.slice(-400));
  }

  console.log('\n5. PRIVACY: a partner she gave health consent to meets none of it');
  {
    await load(seed(preg()));
    await signIn(SAM, 'caregiver', ['health', 'careteam', 'conditions']);
    const r = await care();
    ok('he is not the owner', await say(() => pregIsOwner(), null) === false);
    ok('he does see her appointment (this is a share, not a blackout)', /Dating scan/.test(r.txt), r.txt.slice(0, 300));
    ok('no trying door on his screen', r.n === 0, r);
    ok('no "Before this pregnancy" heading either', r.heading === false, r.txt.slice(0, 400));
    const s = await say(() => pregVisitSummary(), '');
    ok('his report still has her shared health in it', /Week \d+/.test(s), s.slice(0, 80));
    ok('and no period dates', s.indexOf('Before this pregnancy:') < 0 && !/trying since/i.test(s), s.slice(-300));
    ok('and no observation text', !/Tender and tired/.test(s), s.slice(-300));
  }

  console.log('\n6. the closing sheet with photos names all three things it keeps');
  {
    await load(seed(preg({ moments: [{ id: 'm1', at: now - 20 * DAY, week: 8, photoId: 'ph1', note: '' }], journey: { saved: { c1: { at: now - 10 * DAY, note: 'hello' } } } })));
    await signIn(MAYA, 'owner');
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    const s = await sheet();
    ok('the closing sheet opened', /Closing this pregnancy/.test(s.txt), s.txt.slice(0, 120));
    ok('the bereavement framing is untouched', /we're so sorry/i.test(s.txt), s.txt.slice(0, 300));
    ok('it names the photo', /your scan or photo/i.test(s.txt), s.txt);
    ok('it names the card she wrote', /the card you wrote/i.test(s.txt), s.txt);
    ok('it names the dates from before', /dates and notes you kept while trying/i.test(s.txt), s.txt);
    ok('the keep button is there', s.buttons.some((b) => /Keep what I've saved/.test(b)), s.buttons);
    ok('and clearing is still the honest second door', s.buttons.some((b) => /Close and clear everything/.test(b)), s.buttons);
    ok('no verdict, no number about her body', !/\d+ weeks|risk|normal/i.test(s.txt), s.txt);
  }

  console.log('\n7. keeping actually keeps it');
  {
    ok('the keep button took the tap', await tapSheet(/Keep what I've saved/), true);
    await sleep(600);
    const a = await arch(); const e = a[0] || {};
    ok('exactly one archive entry', a.length === 1, a);
    ok('it is marked as a loss', e.loss === true, e);
    ok('the photo is kept', e.moments === 1, e);
    ok('the card she wrote is kept', e.cards === 1, e);
    ok('all five period dates are kept', e.periods === 5, e);
    ok('all three observations are kept', e.obs === 3, e);
    ok('trying-since is kept', e.since === '2025-06', e);
    ok('the checklist is kept', e.precon === 2, e);
    ok('and the pregnancy itself is gone', await say(() => state.pregnancy, 'threw') === null);
  }

  console.log('\n8. and it is still there after a reload');
  {
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    // window.LL is injected by hand, so a reload leaves myUid() as 'local' until she is signed in
    // again; lossHolding is a per-uid map, so the screen only restores once it knows who she is.
    await signIn(MAYA, 'owner');
    await say(() => render(), null);
    await sleep(500);
    const a = await arch(); const e = a[0] || {};
    ok('the entry survived', a.length === 1, a);
    ok('with her dates', e.periods === 5 && e.obs === 3 && e.since === '2025-06', e);
  }

  console.log('\n9. the loss-holding screen has a door to it, and the door leads to her notes');
  {
    const holding = await say(() => {
      const cards = Array.from(document.querySelectorAll('.prof-card'));
      return { n: cards.length, kept: cards.filter((c) => /kept/i.test(c.textContent || '')).length,
        txt: (document.body.querySelector('.ob-wrap') || {}).innerText || '' };
    }, { n: 0, kept: 0, txt: '' });
    ok('she is on the holding screen', /Take all the time you need/.test(holding.txt), holding.txt.slice(0, 200));
    ok('with a door to what she kept', holding.kept === 1, holding);
    await say(() => { const c = Array.from(document.querySelectorAll('.prof-card')).find((e) => /kept/i.test(e.textContent || '')); if (c) c.click(); }, null);
    await sleep(400);
    const s = await sheet();
    ok('the kept sheet opened', /Kept memories/.test(s.txt), s.txt.slice(0, 120));
    ok('with a row for her trying notes', /Your notes from trying/.test(s.txt), s.txt);
    ok('naming what is in it', /5 period dates/.test(s.txt) && /3 things you noticed/.test(s.txt), s.txt);
    ok('wired to the archived entry, not to the live record', s.handlers.some((h) => /openTtcDoctorReport\('[a-z0-9]+'\)/i.test(h)), s.handlers);
    /* Her private wellbeing notes were archived too. They must be reachable by NOTHING. */
    ok('and her private mood note is nowhere on it', !/Scan tomorrow|Anxious/.test(s.txt), s.txt);
    ok('the notes row took the tap', await tapSheet(/Your notes from trying/), true);
    await sleep(400);
    const t = await report();
    ok('the report opened with no live pregnancy at all', t !== null && /For your appointment/.test(t), t && t.slice(0, 120));
    ok('read from the archive entry', /Tender and tired/.test(t || '') && /Trying since June 2025/.test(t || ''), (t || '').slice(0, 900));
    ok('and it does not leak her mood notes either', !/Scan tomorrow/.test(t || ''), (t || '').slice(0, 900));
    await closeReport();
  }

  console.log('\n10. removing the photos does not take the notes with them');
  {
    await say(() => openKeptMemories(), null);
    await sleep(300);
    ok('the remove button is there', await tapSheet(/Remove these memories/), true);
    await sleep(400);
    const c = await sheet();
    ok('the confirm names the two things that go', /photos and the cards you wrote/.test(c.txt), c.txt);
    ok('and does not say "notes", which is the row above it', !/photos and notes/.test(c.txt), c.txt);
    ok('confirm took the tap', await tapSheet(/Remove them/), true);
    await sleep(700);
    const a = await arch(); const e = a[0] || {};
    ok('the entry did NOT drop out of the archive', a.length === 1, a);
    ok('the photos went, as promised', e.moments === 0 && e.cards === 0, e);
    ok('her period dates stayed', e.periods === 5, e);
    ok('her observations stayed', e.obs === 3, e);
  }

  console.log('\n11. THE REGRESSION: no scan photo, and she was never offered the choice at all');
  {
    await load(seed(preg()));            // moments: [], no journey cards, a year of trying
    await signIn(MAYA, 'owner');
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    const s = await sheet();
    ok('the closing sheet opened', /Closing this pregnancy/.test(s.txt), s.txt.slice(0, 120));
    ok('there IS a keep button', s.buttons.some((b) => /Keep what I've saved/.test(b)), s.buttons);
    ok('it names what it keeps', /dates and notes you kept while trying/i.test(s.txt), s.txt);
    ok('it does not claim photos she never took', !/scans? (or|and) photos?/i.test(s.txt), s.txt);
    ok('the undo warning fits what is actually going', /Clearing deletes all of this for good/.test(s.txt), s.txt);
    ok('clearing is the ghost, not the primary', s.handlers.some((h) => /endPregnancy\(true\)/.test(h)) && s.handlers.some((h) => /endPregnancy\(false\)/.test(h)), s.handlers);
    ok('keep took the tap', await tapSheet(/Keep what I've saved/), true);
    await sleep(600);
    const a = await arch(); const e = a[0] || {};
    ok('one entry, holding the record and no photos', a.length === 1 && e.moments === 0, a);
    ok('with her five dates', e.periods === 5, e);
    ok('and her three notes', e.obs === 3, e);
  }

  console.log('\n12. moodLog: hers, so it survives keep and dies on clear');
  {
    await load(seed(preg({ moodLog: MOOD.slice() })));
    await signIn(MAYA, 'owner');
    await say(() => { confirmEndPregnancy(); }, null);
    await sleep(300);
    await tapSheet(/Keep what I've saved/);
    await sleep(600);
    let a = await arch();
    /* Anchor first: without this, "her notes came back" passes on a build that never closed the
       pregnancy at all, because savePregnancy would simply read them off the live record. */
    ok('the pregnancy actually closed', await say(() => state.pregnancy, 'threw') === null);
    ok('her wellbeing notes rode along on keep', (a[0] || {}).mood === 2, a);
    /* And then the next record picks them up, which is the whole reason they were kept: after a
       loss there is no `prev` for savePregnancy to read, and pregClear has deleted the mood doc. */
    await say(() => {
      openExpectingSetup('weeks');
      const w = document.getElementById('pgWeeks'); if (w) w.value = '6';
      const c = document.getElementById('pgCountry'); if (c) c.value = 'uk';
      savePregnancy();
    }, null);
    await sleep(900);
    const carried = await say(() => ({
      mood: ((state.pregnancy || {}).moodLog || []).length,
      note: (((state.pregnancy || {}).moodLog || [])[0] || {}).note || '',
      stage: (state.pregnancy || {}).stage,
    }), { mood: -1, note: '', stage: null });
    ok('the new pregnancy started', carried.stage === 'expecting', carried);
    ok('and her notes came back to her', carried.mood === 2, carried);
    ok('word for word', carried.note === 'Scan tomorrow', carried);

    // The other button says "clear everything", and it has to mean it.
    await load(seed(preg({ moodLog: MOOD.slice(), moments: [{ id: 'm1', at: now, week: 8, photoId: 'ph1', note: '' }] })));
    await signIn(MAYA, 'owner');
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    await tapSheet(/Close and clear everything/);
    await sleep(600);
    a = await arch();
    ok('clearing archives nothing at all', a.length === 0, a);
    const after = await say(() => keptMoodLog(), 'threw');
    ok('and nothing survives to be seeded back', after === null, after);
  }

  console.log('\n13. a partner running the close never writes her record into HIS own doc');
  {
    /* pregnancyArchive lands in the acting user's users/{uid}, which her consent can never reach
       again. The same `mine` test savePregnancy applies. He should not be able to reach this
       button at all, and if a stale render lets him, the record must not go with him. */
    await load(seed(preg({ moodLog: MOOD.slice(), moments: [{ id: 'm1', at: now, week: 8, photoId: 'ph1', note: '' }] })));
    await signIn(SAM, 'caregiver');
    await say(() => endPregnancy(true), null);
    await sleep(500);
    const a = await arch();
    const t = await say(() => (window.__toasts || []).slice(), []);
    ok('he is refused outright', a.length === 0 && t.some((x) => /Only the person whose journey/.test(x)), { a: a, t: t });
    ok('and her pregnancy is untouched', await say(() => !!state.pregnancy, false) === true);
  }

  console.log('\n14. the planning "stop tracking" sheet says what it is about to delete');
  {
    await load(seed(planning()));
    await signIn(MAYA, 'owner');
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    const s = await sheet();
    ok('the sheet opened', /Stop tracking/.test(s.txt), s.txt.slice(0, 120));
    ok('it counts her period dates', /5 period dates/.test(s.txt), s.txt);
    ok('and what she noticed', /3 things you noticed/.test(s.txt), s.txt);
    ok('and says it cannot be brought back', /can't be brought back/.test(s.txt), s.txt);
    ok('with a way to take it with her', /Take your notes with you/.test(s.txt), s.txt);
    ok('wired to the report, on the free exit path', s.handlers.some((h) => /openTtcDoctorReport\(null,\s*true\)/.test(h)), s.handlers);
    ok('and "Keep going" is still there', s.buttons.some((b) => /Keep going/.test(b)), s.buttons);
    /* The sub line was built by dropping the `·` card row into the middle of a sentence, so it read
       "This clears what you have kept here: Trying since June 2025 · 5 period dates · 3 things you
       noticed, and your preparation checklist" — a mid-sentence capital, separators from a list she
       is not looking at, and a `, and` continuation nothing attaches to. Prose, in prose. */
    ok('the list reads as a sentence, not a lifted card row', !/·/.test(s.txt), s.txt);
    ok('lower-case and joined with words', /your dates since June 2025, 5 period dates and 3 things you noticed/.test(s.txt), s.txt);
    /* HEAD closed this sheet with "Whenever you're ready, there's no rush." The rewrite dropped it
       in exactly the branch where the reader most needs it: the one that lists what she loses. */
    ok('the gentle close was not dropped from the branch that needs it', /Whenever you're ready, there's no rush/.test(s.txt), s.txt);
    /* "Worth doing first, whatever you decide next" reads as an instruction, and implies a pending
       decision a woman told she cannot conceive may not have. */
    ok('the card does not assume a decision she may not have', !/whatever you decide next/i.test(s.txt), s.txt);
    /* And it stops promising a delivery that used to end at a price list. */
    ok('and does not promise save or share up front', !/save or share/i.test(s.txt), s.txt);
    ok('the notes row took the tap', await tapSheet(/Take your notes with you/), true);
    await sleep(400);
    const t = await report();
    ok('her whole record is on one page', /Trying since June 2025/.test(t || '') && /Tender and tired/.test(t || ''), (t || '').slice(0, 900));
    ok('and from the trying stage the kicker is unchanged', /Trying to conceive/.test(t || ''), (t || '').slice(0, 200));
    await closeReport();
  }

  /* --------------------------------------------------------------------------------------------
     14b. THE EXIT IS NOT A SALES STEP.
     The stop-tracking sheet says this record can't be brought back and offers exactly one way out:
     "Take your notes with you". Save and Share both ran through ttcChargeOnce → useTaste('pdf'),
     which for a free user with her one taste spent CLOSES the report she is reading and shows her a
     price list. A woman stopping after a year of trying, sold to in the one step between her data
     and its deletion, on a screen whose own Pro sheet promises "your data and your privacy stay
     free, always". This opening is never charged. The control below proves the charge still
     happens everywhere else, so this is a carve-out and not a hole in Pro.
     -------------------------------------------------------------------------------------------- */
  console.log('\n14b. the one exit before a permanent delete is not behind a paywall');
  {
    const spent = seed(planning());
    spent.settings.proTaste = { pdf: 9 };            // every free taste of the report used up
    await load(spent);
    await signIn(MAYA, 'owner');
    const pro = await say(() => ({ pro: isPro(), left: tasteLeft('pdf') }), { pro: null, left: -1 });
    ok('she is a free user with no tastes left', pro.pro === false && pro.left === 0, pro);
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    ok('the exit card took the tap', await tapSheet(/Take your notes with you/), true);
    await sleep(400);
    ok('the report opened', (await report()) !== null);
    await say(() => shareTtcReport(), null);
    await sleep(400);
    const after = await say(() => ({
      open: !!document.getElementById('reportOv'),
      sheet: (function () { const s = document.getElementById('sheet'); return (s && s.classList.contains('show')) ? (s.innerText || '').replace(/\s+/g, ' ').trim() : ''; })(),
      left: tasteLeft('pdf'),
    }), { open: false, sheet: 'threw', left: -1 });
    ok('sharing did NOT close her notes', after.open === true, after);
    ok('and did NOT sell her anything', !/Cubby Pro/.test(after.sheet), after.sheet.slice(0, 200));
    ok('and charged her nothing', after.left === 0, after);
    await say(() => printTtcReport(), null);
    await sleep(300);
    ok('saving is free on this path too', await say(() => !!document.getElementById('reportOv'), false) === true);
    await closeReport();
    /* CONTROL, in the same run: the ordinary door still charges. Without this the two assertions
       above would pass just as happily on a build that made the whole report free. */
    await load(spent);
    await signIn(MAYA, 'owner');
    await say(() => openTtcDoctorReport(), null);
    await sleep(400);
    ok('the ordinary door still opens the report', (await report()) !== null);
    await say(() => shareTtcReport(), null);
    await sleep(400);
    const ctl = await say(() => ({
      open: !!document.getElementById('reportOv'),
      sheet: (function () { const s = document.getElementById('sheet'); return (s && s.classList.contains('show')) ? (s.innerText || '').replace(/\s+/g, ' ').trim() : ''; })(),
    }), { open: true, sheet: '' });
    ok('and there, out of tastes, Pro is still the answer', ctl.open === false && /Cubby Pro/.test(ctl.sheet), ctl);
    await say(() => closeSheet(), null);
  }

  console.log('\n15. a planning record with nothing in it keeps the old, calmer sheet');
  {
    await load(seed(planning({ periods: [], lmp: null, tryingSince: null, observations: [] })));
    await signIn(MAYA, 'owner');
    await say(() => confirmEndPregnancy(), null);
    await sleep(300);
    const s = await sheet();
    ok('the sheet opened', /Stop tracking/.test(s.txt), s.txt.slice(0, 120));
    ok('no invented counts', !/period date|things you noticed/.test(s.txt), s.txt);
    ok('no "take your notes" row for notes that do not exist', !/Take your notes with you/.test(s.txt), s.txt);
    ok('the original copy is intact', /Whenever you're ready, there's no rush/.test(s.txt), s.txt);
  }

  console.log('\n16. the same hole through the other door: a birth, then a second pregnancy');
  {
    /* savePregnancy replaces state.pregnancy wholesale. Her first pregnancy ended in a baby, so
       there is no loss path and no keep button, and the trying record lived nowhere else. */
    await load(seed(preg({ bornBabyId: 'b1', birthAt: now - 30 * DAY })));
    await signIn(MAYA, 'owner');
    await say(() => {
      openExpectingSetup('weeks');
      const w = document.getElementById('pgWeeks'); if (w) w.value = '9';
      const c = document.getElementById('pgCountry'); if (c) c.value = 'uk';
      savePregnancy();
    }, null);
    await sleep(1200);
    const a = await arch(); const e = a[0] || {};
    ok('her first pregnancy was archived', a.length === 1 && e.loss === false, a);
    ok('with her period dates', e.periods === 5, e);
    ok('her observations', e.obs === 3, e);
    ok('and trying-since', e.since === '2025-06', e);
    ok('the second pregnancy started', await say(() => (state.pregnancy || {}).stage, null) === 'expecting');
    ok('and it does NOT inherit the first one\'s trying record', await say(() => tryingRecordCount(), -1) === 0);
    // Archived is not the same as reachable. The record sheet is the reader.
    await say(() => openArchivedPregnancy((state.pregnancyArchive[0] || {}).id), null);
    await sleep(400);
    const sh = await sheet();
    ok('the kept-pregnancy sheet opened', /Your pregnancy, kept/.test(sh.txt), sh.txt.slice(0, 120));
    ok('with a row for what came before it', /Your notes from trying/.test(sh.txt), sh.txt);
    ok('naming what is in it', /5 period dates/.test(sh.txt) && /3 things you noticed/.test(sh.txt), sh.txt);
    ok('the row took the tap', await tapSheet(/Your notes from trying/), true);
    await sleep(400);
    const t = await report();
    ok('and it is her own record, read from that entry', /Trying since June 2025/.test(t || '') && /Tender and tired/.test(t || ''), (t || '').slice(0, 900));
    await closeReport();
  }

  console.log('\n17. nothing threw');
  ok('no page errors', errs.length === 0, errs);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('TRYING SURVIVOR: ' + (fail === 0 ? 'PASS' : 'FAIL'));
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
