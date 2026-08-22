#!/usr/bin/env node
/* The pregnancy Care tab handed a partner a whole screen of controls that could not work.
 *
 * A pregnancy journey belongs to ONE person. firestore.rules /pregnancy/{owner} allows create and
 * update from that uid alone, and syncPregJourney in app/store-firebase.js returns early for anyone
 * else. Nothing in renderPregLog knew that. So a partner she had shared the journey with opened
 * Care and got the live screen: he could tick an appointment done, open and save the whole
 * visit-outcome form (fundal height, estimated weight, position, Hb, blood pressure), type in her
 * blood group and GBS result, add and delete her questions for the visit, and log a symptom, a
 * weight or a blood pressure reading against her health. Every one of those moved on his screen,
 * reached nothing, and was wiped by the next journey snapshot. Merely opening the tab wrote too:
 * renderPregLog seeded six default questions and called persist(), so a partner saw a list of
 * questions that were never hers and watched them disappear.
 *
 * That is the exact failure the trying stage already named "a lie dressed as a feature"
 * (renderPlanningPartnerHome). It is worse here than a missing feature, because Cubby's whole
 * promise is private-within-shared and LEGIBLE privacy: a screen that pretends he can write is a
 * screen that also implies she can see his changes. She cannot. He is writing to nowhere.
 *
 * Fixed: renderPregLog takes canWrite = pregJourneyIsOwner() and renders appointments, the
 * antenatal record, the visit questions and her health readings READ-ONLY for everyone else, keeps
 * them visible so a partner still sees the appointment he is driving her to, says once whose they
 * are, and drops only the pure write affordances. Every mutator behind those controls got the same
 * guard, because a deep link and an already-open sheet are the second door.
 *
 * A first pass of this gate asserted only the ABSENCE OF NAMED handlers, so a write door it had not
 * thought to name was invisible to it. It missed one, and it was the worst one: the "Due date &
 * schedule" row in renderPregCare, which renders on the same screen and was, after the read-only
 * split, the ONLY control a partner could still tap. It moved her EDD, rewrote her LMP, switched
 * her country and pushed a whole new schedule of appointments into the list the tab had just
 * stopped letting him add to, then toasted "Updated". Section 10 now asserts the opposite way
 * round: the partner's whole #scroll carries ZERO handlers outside a named read-only allowlist.
 * Add to that allowlist deliberately, never to make a run go green.
 *
 * Forking a screen also costs something that is invisible from the diff. openSheet runs every
 * sheet through CubbyTeachUI.sheetDot, which finds that sheet's teaching row by matching its own
 * <h2> against the labels in app/teach-data.js, and returns the html UNTOUCHED when it cannot
 * match. So giving the partner his own heading on the visit-prep sheet silently deleted his "i",
 * on the one pregnancy sheet he reaches from Home. teach_gate walks the registry against itself
 * and info_dot_check opens baby-stage sheets as the owner, so neither could see it. Section 11
 * asserts the dot on BOTH headings, and that it opens the right chapter.
 *
 * WHAT THIS DOES NOT COVER, so a PASS is not read as more than it is.
 *   - SCOPE. The harness runs the app in local mode (cubby-quick-uid=local) and injects window.LL
 *     by hand after boot, so app/store-firebase.js is never loaded and firestore.rules is never
 *     evaluated. A PASS attests that the RENDER and the GUARDS are correct GIVEN the ownership
 *     predicate. It says nothing about the server side. The claim that firestore.rules and
 *     syncPregJourney reject the write is read from the source, not exercised here.
 *   - the round quick-log button (quickFab, fed by QUICK_ACTIONS at app/index.html:3289) still
 *     offers a non-owner kicks, contractions and symptom, all of which write where he cannot sync.
 *     The mechanism to fix it already exists and is one word: ownerOnly:true on those three
 *     entries, the way 'mood' already carries it. It is a floating button, not inside #scroll, so
 *     section 10's allowlist does not see it either.
 *   - a tracker she already switched on still opens its detail sheet for a partner (openCondition,
 *     into glucose / urine / blood-pressure logging). That is a whole logging subsystem, not this
 *     item. Section 10 asserts it as a KNOWN GAP so it prints on every run rather than sitting
 *     silently inside the allowlist; when it is fixed, that assertion flips and says so.
 * The bag, the birth plan, the moments and the scan photos are also still writable by a non-owner;
 * they live in renderPregHome and renderPregMoments, not here.
 *
 *   PORT=9744 node tools/serve.js &
 *   node tools/preg_log_canwrite_check.js http://localhost:9744
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a stale server from another
 * checkout on a shared port grades that tree and reports PASS on work you never wrote.
 */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam';

// A 30-week pregnancy owned by Maya, with one appointment and one question already in it.
const preg = (over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now + 10 * 7 * DAY, lmp: now - 30 * 7 * DAY, cycleLen: 28, periods: [],
  country: 'uk', precon: [], careTeam: [],
  appts: [{ id: 'a1', week: 28, title: 'Growth scan', note: '', done: false, at: null }],
  symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 30 * 7 * DAY,
  visitQs: [{ id: 'q1', text: 'Is my baby growing on track?', done: false }],
}, over || {});
const seed = (p) => ({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p,
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

  /* Which checkout is actually on that port? A dead server exits 2, but a LIVE server belonging to
     another agent's tree answers 200 and gets graded happily. pregJourneyCanWrite exists only in
     this branch's app/index.html, so its absence means one of exactly two things, and the banner
     says which so a red run is never misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.pregJourneyCanWrite === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has pregJourneyCanWrite. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO pregJourneyCanWrite.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.\n'
      + '             Every guard assertion below is expected to fail. Check the port first.');

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

  /* Sign in as somebody, then open Care. window.LL.pregIsOwner / matIsOwner are copied VERBATIM
     from store-firebase.js so the gate exercises the real predicate rather than a stub of its own
     invention: uid wins when the pregnancy has an ownerUid, and household role decides only for a
     legacy record that never got one. `who` of null means no cloud at all (a solo mother offline),
     which must leave her with her whole screen. */
  const openCare = (who, role, matRead) => page.evaluate((w, r, mr) => {
    if (!w) { try { delete window.LL; } catch (e) { window.LL = undefined; } }
    else {
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
    }
    pregGo('care');
    var s = document.getElementById('scroll');
    var handlers = [].slice.call(s.querySelectorAll('[onclick]')).map(function (e) { return e.getAttribute('onclick'); });
    return {
      owner: pregJourneyIsOwner(),
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      handlers: handlers,
      // innerText is the rendered screen, never the inline script's own source.
      hasQInput: !!s.querySelector('#vqNew'),
      apptRows: s.querySelectorAll('.appt-row').length,
      qRows: s.querySelectorAll('.bag-row').length,
      binCount: s.querySelectorAll('.lli-x').length,
      logRows: s.querySelectorAll('.log-list-item').length,
    };
  }, who, role, matRead || []);
  const wires = (r, fn) => r.handlers.some((h) => h.indexOf(fn) >= 0);

  console.log('\n1. the owner\'s Care tab is untouched');
  {
    await load(seed(preg()));
    const r = await openCare(MAYA, 'owner');
    ok('she is the owner', r.owner === true, r.owner);
    ok('her appointment is tickable', wires(r, 'toggleAppt('), r.handlers);
    ok('and openable', wires(r, 'openApptEdit('), r.handlers);
    ok('she can add an appointment', wires(r, 'openAddAppt('), r.handlers);
    ok('her questions tick and delete', wires(r, 'toggleVisitQ(') && wires(r, 'removeVisitQ('), r.handlers);
    ok('the add-a-question box is there', r.hasQInput === true, r);
    ok('Quick log is there', wires(r, 'openLogBP(') && wires(r, 'openLogWeight(') && wires(r, 'openLogSymptom('), r.handlers);
    ok('the antenatal record opens', wires(r, 'openAntenatalFacts('), r.handlers);
    ok('and the invite row still asks who is coming', /Who's coming with you/.test(r.txt), r.txt.slice(0, 200));
  }

  console.log('\n2. a partner she shared the journey with gets the same screen, read-only');
  {
    await load(seed(preg()));
    const r = await openCare(SAM, 'caregiver');
    ok('he is NOT the owner', r.owner === false, r.owner);
    ok('he still sees her appointment', r.apptRows === 1 && /Growth scan/.test(r.txt), r.txt.slice(0, 300));
    ok('he still sees her question', r.qRows === 1 && /Is my baby growing on track/.test(r.txt), r.txt.slice(0, 400));
    ok('no tick on the appointment', !wires(r, 'toggleAppt('), r.handlers);
    ok('no way into the appointment sheet', !wires(r, 'openApptEdit('), r.handlers);
    ok('no add-an-appointment button', !wires(r, 'openAddAppt('), r.handlers);
    ok('no tick or bin on her questions', !wires(r, 'toggleVisitQ(') && !wires(r, 'removeVisitQ('), r.handlers);
    ok('no add-a-question box', r.hasQInput === false, r);
    ok('no Quick log at all', !wires(r, 'openLogBP(') && !wires(r, 'openLogWeight(') && !wires(r, 'openLogSymptom('), r.handlers);
    ok('no door into her blood group', !wires(r, 'openAntenatalFacts('), r.handlers);
    ok('the invite line aimed at her is gone', !/Who's coming with you/.test(r.txt), r.txt.slice(0, 300));
    ok('it says once whose this is', /What stays with her/i.test(r.txt), r.txt.slice(0, 300));
    ok('and names her rather than saying "the owner"', /Maya/.test(r.txt), r.txt.slice(0, 300));
    /* Positive anchor FIRST, then the jargon veto. A bare negative passes on a blank card and on
       the broken build alike, because the owner copy has none of those words either. */
    ok('the card actually explains what he can and cannot do',
      /you can see the appointments/i.test(r.txt) && /adding and ticking off stays with maya/i.test(r.txt), r.txt.slice(0, 500));
    ok('no jargon in the explanation', !/permission|read-only|sync|owner/i.test(r.txt.slice(0, 400)), r.txt.slice(0, 400));
    // Voice: the partner's copy contracts exactly the way the mother's does, two lines away.
    ok('and it is written the way the rest of Cubby talks', /what's coming/i.test(r.txt), r.txt.slice(0, 500));
    // No duty handed to him, and no implication that she is the one who forgets.
    ok('the questions line does not make him the one who has to remember',
      !/the one in the room who remembers/i.test(r.txt), r.txt.slice(0, 800));
    ok('and it does not call what he is reading the unreal plan', !/the real plan/i.test(r.txt), r.txt.slice(0, 800));
  }

  console.log('\n3. with no data, a partner is not shown a list that was never hers');
  {
    /* Merely OPENING the pregnancy used to write to it: three separate places seeded six default
       questions and called persist(). renderPregHome is the one that fires first, because Home is
       the tab a partner lands on. The harness has to sign him in after boot (window.LL only exists
       once firebase-init has run), so the pre-sign-in boot render is a harness artifact: clear the
       field it touched, then drive Home and Care as him for real. */
    await load(seed(preg({ appts: [], bloodGroup: null, rh: null, gbs: 'unknown' })));
    await openCare(SAM, 'caregiver');
    const home = await page.evaluate(() => {
      delete state.pregnancy.visitQs;
      pregGo('week');                                  // the tab he actually lands on
      return { seeded: (state.pregnancy.visitQs || null), view: pregView };
    });
    ok('Home does not invent a list for him', home.seeded === null, home);
    const r = await openCare(SAM, 'caregiver');
    ok('and neither does Care', r.qRows === 0, r.qRows);
    const st = await page.evaluate(() => (state.pregnancy.visitQs || null));
    ok('nothing at all was written into her record', st === null, st);
    ok('the empty appointment line does not tell him to add one', !/Add your first/.test(r.txt), r.txt.slice(0, 300));
    ok('the antenatal record is not offered as a blank he cannot fill', !/Add the one-time results/.test(r.txt), r.txt.slice(0, 400));
    // Case-insensitive: .sec-title is text-transform:uppercase and innerText returns it uppercased,
    // so a case-sensitive regex here would pass on the broken build and prove nothing.
    ok('and the whole questions block is absent rather than an empty heading', !/questions for/i.test(r.txt), r.txt.slice(0, 400));

    // Same empty record, opened by her: the seed still happens, because it is her list.
    const r2 = await openCare(MAYA, 'owner');
    ok('she still gets her six starter questions', r2.qRows === 6, r2.qRows);
    const st2 = await page.evaluate(() => (state.pregnancy.visitQs || []).length);
    ok('and they are on her record', st2 === 6, st2);
  }

  console.log('\n4. the second door: calling the writes directly changes nothing');
  {
    await load(seed(preg()));
    await openCare(SAM, 'caregiver');
    const r = await page.evaluate(() => {
      const before = JSON.stringify(state.pregnancy);
      toggleAppt('a1');
      toggleVisitQ('q1');
      removeVisitQ('q1');
      markApptDone('a1');
      saveApptOutcome('a1');
      saveAntenatalFacts();
      openAntenatalFacts();
      openApptEdit('a1');
      openAddAppt();
      const sheet = document.getElementById('sheet');
      return { changed: JSON.stringify(state.pregnancy) !== before,
        sheetOpen: !!(sheet && sheet.classList.contains('show')),
        toasts: window.__toasts.slice() };
    });
    ok('her record is byte-identical afterwards', r.changed === false, r);
    ok('no sheet opened on him', r.sheetOpen === false, r);
    ok('he is told once, plainly, whose this is', /Only the person whose journey this is/.test((r.toasts || []).join(' ')), r.toasts);

    // addVisitQ reads an input that is no longer rendered for him; it must still refuse.
    const r2 = await page.evaluate(() => {
      const el = document.createElement('input'); el.id = 'vqNew'; el.value = 'Can I fly at 34 weeks?';
      document.body.appendChild(el);
      addVisitQ(); resetVisitQsDone();
      const n = (state.pregnancy.visitQs || []).length;
      el.remove();
      return n;
    });
    ok('and a typed-in question still goes nowhere', r2 === 1, r2);
  }

  console.log('\n5. her own writes still work, twice, and reach her screen');
  {
    /* The guard runs on every tap, not once, so the repeat matters: a one-shot flag would leave her
       unable to un-tick something she ticked by mistake. Measured on state and on the repainted DOM,
       never on storage: store-firebase.js replaces persist() with its cloud push, so localStorage is
       not the thing under test here and asserting on it would prove nothing either way. */
    await load(seed(preg()));
    await openCare(MAYA, 'owner');
    const r = await page.evaluate(() => {
      toggleAppt('a1');
      const row = document.querySelector('#scroll .appt-row');
      // (a||{}) throughout: on an UNGUARDED build the earlier sections really do delete this
      // appointment, and a TypeError here aborts the whole run at exit 2 instead of reporting the
      // failures. A gate that crashes when the bug is present hides the sections after it.
      return { done: (state.pregnancy.appts[0] || {}).done, painted: row ? row.className : null };
    });
    ok('she can tick the appointment', r.done === true, r);
    ok('and the row repaints as done', /\bdone\b/.test(r.painted || ''), r);
    const r2 = await page.evaluate(() => { toggleAppt('a1'); return state.pregnancy.appts[0].done; });
    ok('a second tap un-ticks it, so a mis-tap is recoverable', r2 === false, r2);
    const r3 = await page.evaluate(() => { toggleAppt('a1'); return state.pregnancy.appts[0].done; });
    ok('and a third tap still works', r3 === true, r3);
    // Her real add-a-question box, typed into and submitted the way the sheet does it.
    const r4 = await page.evaluate(() => {
      document.getElementById('vqNew').value = 'Can I fly at 34 weeks?';
      addVisitQ();
      return (state.pregnancy.visitQs || []).map((q) => q.text);
    });
    ok('and her own new question is added', r4.indexOf('Can I fly at 34 weeks?') >= 0, r4);
  }

  console.log('\n6. a partner\'s taps leave her record exactly as it was');
  {
    await load(seed(preg({ visitQs: [{ id: 'q1', text: 'Is my baby growing on track?', done: false }, { id: 'q2', text: 'When is the next scan?', done: true }] })));
    await openCare(SAM, 'caregiver');
    const before = await page.evaluate(() => JSON.stringify(state.pregnancy));
    await page.evaluate(() => { toggleAppt('a1'); markApptDone('a1'); removeVisitQ('q1'); resetVisitQsDone(); deleteAppt('a1'); });
    await sleep(300);
    const r = await page.evaluate(() => ({
      done: (state.pregnancy.appts[0] || {}).done, appts: state.pregnancy.appts.length,
      qs: (state.pregnancy.visitQs || []).length, ticked: (state.pregnancy.visitQs || []).filter((q) => q.done).length,
    }));
    ok('the appointment is still not done', r.done === false, r);
    ok('it was not deleted either', r.appts === 1, r);
    ok('both her questions are still there', r.qs === 2, r);
    ok('and the one she had already ticked is still ticked', r.ticked === 1, r);
    const after = await page.evaluate(() => JSON.stringify(state.pregnancy));
    ok('her whole record is byte-identical', before === after, { len: [before.length, after.length] });
    // And the screen agrees with the record, rather than showing him an optimistic change.
    const r2 = await openCare(SAM, 'caregiver');
    ok('the repainted screen still shows the appointment', r2.apptRows === 1 && /Growth scan/.test(r2.txt), r2.txt.slice(0, 300));
    ok('and both questions', r2.qRows === 2, r2.qRows);
  }

  console.log('\n7. her health readings: visible when she shared them, never deletable by him');
  {
    const readings = { bp: [{ id: 'b1', at: now - 2 * DAY, sys: 118, dia: 74 }], weights: [{ id: 'w1', at: now - DAY, kg: 68.2, unit: 'kg' }] };
    await load(seed(preg(readings)));
    const mine = await openCare(MAYA, 'owner');
    ok('she sees her two readings', mine.logRows === 2, mine.logRows);
    ok('with a bin on each', mine.binCount === 2, mine.binCount);

    const his = await openCare(SAM, 'caregiver', ['health']);
    ok('he sees them too, because she shared her health', his.logRows === 2, his.logRows);
    ok('but there is no bin anywhere', his.binCount === 0, his.binCount);
    const r = await page.evaluate(() => { deletePregLog('bp', 'b1'); return state.pregnancy.bp.length; });
    ok('and calling the delete directly does nothing', r === 1, r);
  }

  console.log('\n8. the boundaries: no cloud, and a legacy record with no owner');
  {
    /* A solo mother offline. pregJourneyIsOwner throws and answers true, and defaulting canWrite to
       false here would silently take her own Care tab away from her.
       HONESTY NOTE: these first two assertions pass identically on unmodified code. They guard a
       plausible WRONG FIX (fail-closed), not the bug, so they are not evidence the fix works.
       Keep them; do not count them when asking whether this gate can go red. */
    await load(seed(preg({ ownerUid: 'local' })));
    const r = await openCare(null);
    ok('with no cloud at all she keeps every control', r.owner === true && wires(r, 'toggleAppt(') && r.hasQInput === true, r.handlers);
    ok('and Quick log', wires(r, 'openLogBP('), r.handlers);

    // A legacy record that never got an ownerUid: household role decides, exactly as the cloud does.
    await load(seed(preg({ ownerUid: null })));
    const rOwner = await openCare(MAYA, 'owner');
    ok('the household owner of a legacy record can write', rOwner.owner === true && wires(rOwner, 'toggleAppt('), rOwner.handlers);
    const rCare = await openCare(SAM, 'caregiver');
    ok('a caregiver on the same legacy record cannot', rCare.owner === false && !wires(rCare, 'toggleAppt('), rCare.handlers);
    ok('and still sees the appointment', rCare.apptRows === 1, rCare.apptRows);
  }

  console.log('\n9. the tab is honest about what it is at 390px');
  {
    await load(seed(preg()));
    await openCare(SAM, 'caregiver');
    const r = await page.evaluate(() => {
      const s = document.getElementById('scroll');
      const card = [].slice.call(s.querySelectorAll('.preg-card')).find((e) => /What stays with her/i.test(e.innerText || ''));
      const tick = s.querySelector('.appt-row .ar-tick');
      const firstRow = s.querySelector('.appt-row');
      return {
        cardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
        rowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
        tickCursor: tick ? getComputedStyle(tick).cursor : null,
        bodyCursor: s.querySelector('.appt-row .ar-body') ? getComputedStyle(s.querySelector('.appt-row .ar-body')).cursor : null,
        overflow: s.scrollWidth - s.clientWidth,
      };
    });
    ok('the "whose is this" card is the first thing on the screen', r.cardTop !== null && r.cardTop < 200, r);
    /* Order, not width. "it fits 390px" was tautological: the card lives inside a padded 390px
       #scroll, so it could only fail when the card was missing, which the line above already
       catches. What actually matters is that he reads whose this is BEFORE he reads her rows. */
    ok('and he reads it before he reaches her appointments', r.rowTop !== null && r.cardTop < r.rowTop, r);
    ok('the dead tick no longer pretends to be a button', r.tickCursor === 'default', r);
    ok('nor does the row body', r.bodyCursor === 'default', r);
    ok('nothing scrolls sideways', r.overflow <= 0, r); // hygiene; passes on any build
  }

  console.log('\n10. the whole partner screen, counted the other way round');
  {
    /* The assertions above name the doors they expect to be shut. That is how the first version of
       this gate passed 62/62 while renderPregCare's "Due date & schedule" row sat on the same
       screen, unnamed and fully live. Count from the opposite end instead: EVERY onclick inside the
       partner's #scroll must be on this list. Adding to the list is a decision; it should show up
       in a diff and be argued for.
       openFamily is the circle sheet (his own household, not her journey). openDangerSigns is a
       static read. openPregDoctorReport and addApptToCalendar produce a document from data he can
       already see. openCondition is the ONE entry here that is not read-only: it opens a tracker
       detail sheet (glucose, urine, blood pressure) with its own logging flows, a subsystem outside
       this item. It is asserted separately below so it is printed rather than filtered away. */
    const ALLOW = [
      'openDangerSigns(', 'openFamily', 'openPregDoctorReport(', 'addApptToCalendar(',
      'pregGo(', 'openPregRecord(', 'openCondition(',
    ];
    await load(seed(preg({ bloodGroup: 'O', rh: 'positive', gbs: 'negative' })));
    const r = await openCare(SAM, 'caregiver', ['health', 'careteam', 'conditions']);
    const stray = r.handlers.filter((h) => !ALLOW.some((a) => h.indexOf(a) >= 0));
    ok('every control on a partner\'s Care tab is on the allowlist', stray.length === 0, stray);

    /* The known gap, asserted rather than hidden. With a tracker switched on, the row into it is
       still there for a partner and the sheet behind it still logs. Fixing that is the glucose /
       urine / BP logging item, not this one. When it IS fixed, this assertion flips and says so. */
    await load(seed(preg({ conditions: { gdm: true } })));
    const cond = await openCare(SAM, 'caregiver', ['health', 'conditions']);
    ok('KNOWN GAP: a tracker row is still live for him (openCondition, out of scope here)',
      cond.handlers.some((h) => h.indexOf('openCondition(') >= 0), cond.handlers);
    ok('but the trackers settings door is shut', !cond.handlers.some((h) => h.indexOf('openManageConditions(') >= 0), cond.handlers);
    ok('and the health heading names her, not him', /Maya's pregnancy health/i.test(cond.txt) && !/your pregnancy health/i.test(cond.txt), cond.txt.slice(-500));
    const mc = await page.evaluate(() => {
      const before = JSON.stringify(state.pregnancy);
      openManageConditions(); setCondition('gdm', false);
      const sheet = document.getElementById('sheet');
      return { open: !!(sheet && sheet.classList.contains('show')), changed: JSON.stringify(state.pregnancy) !== before };
    });
    ok('and calling it directly turns nothing off', mc.open === false && mc.changed === false, mc);

    // The one that got through the first version of this gate: the dates row. Visible, not
    // tappable, and the sheet behind it still refuses.
    await load(seed(preg({ bloodGroup: 'O', rh: 'positive', gbs: 'negative' })));
    const dates = await openCare(SAM, 'caregiver', ['health', 'careteam', 'conditions']);
    ok('he can still read the due date and the schedule', /Due date & schedule/i.test(dates.txt), dates.txt.slice(-400));
    ok('but there is no way into the date sheet', !wires(dates, 'openEditPregnancy('), dates.handlers);
    const edd = await page.evaluate(() => {
      const before = JSON.stringify(state.pregnancy);
      openEditPregnancy();
      const sheet = document.getElementById('sheet');
      const open = !!(sheet && sheet.classList.contains('show'));
      saveEditPregnancy();
      return { open, changed: JSON.stringify(state.pregnancy) !== before, toasts: window.__toasts.slice() };
    });
    ok('calling it directly opens nothing', edd.open === false, edd);
    ok('and saving over her dates changes nothing', edd.changed === false, edd);
    ok('he is told whose dates they are', /Only the person whose journey this is/.test(edd.toasts.join(' ')), edd.toasts);

    // Care team lives in the same owner-owned doc; same two doors, same answer.
    const ct = await page.evaluate(() => {
      const before = JSON.stringify(state.pregnancy);
      openAddCareTeam();
      const sheet = document.getElementById('sheet');
      return { open: !!(sheet && sheet.classList.contains('show')), changed: JSON.stringify(state.pregnancy) !== before };
    });
    ok('nor can he add to her care team', ct.open === false && ct.changed === false, ct);

    // Her own screen keeps all of it. The fix must not cost her the dates row.
    const hers = await openCare(MAYA, 'owner');
    ok('she still has her dates row', wires(hers, 'openEditPregnancy('), hers.handlers);
    const eddOwn = await page.evaluate(() => {
      openEditPregnancy();
      const sheet = document.getElementById('sheet');
      const open = !!(sheet && sheet.classList.contains('show'));
      if (open) closeSheet();
      return open;
    });
    ok('and it still opens for her', eddOwn === true, eddOwn);
  }

  console.log('\n11. the visit-prep sheet he opens from Home');
  {
    /* Guarding the handlers alone would have left him a tick and a bin that answer only with a
       toast. A dead control is not read-only, it is a control that lies more quietly. */
    await load(seed(preg()));
    await openCare(SAM, 'caregiver');
    const r = await page.evaluate(() => {
      openVisitPrep('a1');
      const sheet = document.getElementById('sheet');
      const h = [].slice.call(sheet.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const i = sheet.querySelector('h2 .lg-i');
      return {
        txt: (sheet.innerText || '').replace(/\s+/g, ' ').trim(),
        handlers: h, hasInput: !!sheet.querySelector('#vqNew'),
        qRows: sheet.querySelectorAll('.bag-row').length,
        bins: sheet.querySelectorAll('.bag-row .bg-x').length,
        h2: (sheet.querySelector('h2') || {}).textContent,
        dot: i ? i.getAttribute('onclick') : null,
      };
    });
    ok('he still sees her question', r.qRows === 1 && /Is my baby growing on track/.test(r.txt), r.txt.slice(0, 300));
    ok('no tick that only toasts', !r.handlers.some((h) => h.indexOf('toggleVisitQ(') >= 0), r.handlers);
    ok('no bin either', r.bins === 0, r.bins);
    ok('no add-a-question box', r.hasInput === false, r);
    ok('and no "we have been, mark done" he cannot mark', !r.handlers.some((h) => h.indexOf('markApptDone(') >= 0), r.handlers);
    ok('the invite written to her is not shown to him', !/Who's coming with you/.test(r.txt), r.txt.slice(0, 400));
    ok('he can still take the report and the calendar entry',
      r.handlers.some((h) => h.indexOf('addApptToCalendar(') >= 0), r.handlers);

    /* The heading is forked, and openSheet runs EVERY sheet through CubbyTeachUI.sheetDot, which
       finds the teaching row by matching that heading against the labels in teach-data. When they
       drift apart sheetDot returns the html untouched: no error, no warning, the "i" just stops
       existing. So forking the heading silently took the explainer away from the partner, who is
       the one reader on this sheet with no other route to it, since he lands here from Home.
       teach_gate cannot see this (it walks the registry against itself, never a rendered sheet) and
       neither can info_dot_check (it opens baby-stage sheets as the owner). Hence here.
       Assert the fork is real first, or the rest of this block would pass by un-forking. */
    ok('his heading really is the forked one', /Before the visit/.test(r.h2), r.h2);
    ok('and it still carries the "i"', !!r.dot, { h2: r.h2, dot: r.dot });
    ok('pointing at the visit-prep chapter, not whatever else half-matched',
      /CubbyTeachUI\.chapter\('openVisitPrep'\)/.test(r.dot || ''), r.dot);

    /* And the dot has to reach real copy. It opens the guide overlay, not another sheet.
       Null-safe on purpose: when the dot is missing this assertion must FAIL and let the rest of
       the run report, not throw and abort every section after it. */
    await page.evaluate(() => { const b = document.querySelector('#sheet h2 .lg-i'); if (b) b.click(); });
    await sleep(300);
    const chap = await page.evaluate(() => {
      const g = document.getElementById('logGuide');
      return { open: !!g, txt: g ? (g.innerText || '').replace(/\s+/g, ' ').trim() : '' };
    });
    ok('and tapping it tells him what this screen is for',
      chap.open && /gathered before you go in/i.test(chap.txt) && /car park/i.test(chap.txt), chap);
    await page.evaluate(() => { try { CubbyGuide.close(); } catch (e) {} closeSheet(); });

    // Hers is untouched: every control still there.
    await openCare(MAYA, 'owner');
    const r2 = await page.evaluate(() => {
      openVisitPrep('a1');
      const sheet = document.getElementById('sheet');
      const h = [].slice.call(sheet.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const i = sheet.querySelector('h2 .lg-i');
      return { hasInput: !!sheet.querySelector('#vqNew'), bins: sheet.querySelectorAll('.bag-row .bg-x').length,
        done: h.some((x) => x.indexOf('markApptDone(') >= 0), tick: h.some((x) => x.indexOf('toggleVisitQ(') >= 0),
        h2: (sheet.querySelector('h2') || {}).textContent, dot: i ? i.getAttribute('onclick') : null };
    });
    ok('her own prep sheet is unchanged', r2.hasInput === true && r2.bins === 1 && r2.done === true && r2.tick === true, r2);
    ok('and hers keeps its "i" too, on the unforked heading',
      /Prep for your visit/.test(r2.h2) && /CubbyTeachUI\.chapter\('openVisitPrep'\)/.test(r2.dot || ''), r2);
    await page.evaluate(() => closeSheet());
  }

  console.log('\n12. the de-verdicting sentence has to work for the person reading it');
  {
    /* The fundal-height chart is deliberately kept for a partner. That chart has a dashed reference
       line on it, so the caption underneath is the ONLY thing stopping a low-looking point reading
       as bad news. It was written in the second person TO HER: "your week number", "your provider".
       He has no week number and no provider, which left the calming sentence weakest for exactly
       the reader most likely to misread the chart. */
    const withSfh = { appts: [
      { id: 'a1', week: 28, title: 'Growth scan', note: '', done: true, at: now - 7 * DAY, sfh: 27 },
      { id: 'a2', week: 30, title: 'Midwife check', note: '', done: true, at: now - DAY, sfh: 29 },
    ] };
    await load(seed(preg(withSfh)));
    const mine = await openCare(MAYA, 'owner');
    ok('she gets her own chart', /Fundal height/i.test(mine.txt), mine.txt.slice(0, 400));
    ok('and the caption is written to her', /close to your week number/i.test(mine.txt) && /Your provider watches the trend/i.test(mine.txt), mine.txt);

    const his = await openCare(SAM, 'caregiver');
    ok('he sees the same chart', /Fundal height/i.test(his.txt), his.txt.slice(0, 400));
    ok('but it is not his week number', !/close to your week number/i.test(his.txt), his.txt);
    ok('and it is her provider watching, named', /Maya's provider watches the trend/i.test(his.txt), his.txt);
    ok('the reassurance itself survives the fork', /not any single reading/i.test(his.txt), his.txt);

    // Her readings under a heading that says whose they are.
    await load(seed(preg({ bp: [{ id: 'b1', at: now - DAY, sys: 118, dia: 74 }] })));
    const hr = await openCare(SAM, 'caregiver', ['health']);
    ok('and her readings are labelled hers, not just "Recent"', /Recent, from Maya/i.test(hr.txt), hr.txt.slice(-300));
    /* With no tracker switched on and no way to switch one on, the health block would otherwise be
       a section heading with nothing under it. And no line on his screen is addressed to him as
       though he were the pregnant one. */
    ok('no empty "pregnancy health" heading is left standing for him', !/pregnancy health/i.test(hr.txt), hr.txt.slice(-500));
    /* Everything EXCEPT the standing safety disclaimer, which is deliberately generic ("follow your
       midwife, doctor or health visitor") and reads correctly for whoever is holding the phone.
       preg_safety_check owns that string; forking it here would be a safety change in disguise. */
    const body = hr.txt.split(/Informational only/i)[0];
    ok('and nothing else on his screen calls it his visit or his provider',
      !/your visit/i.test(body) && !/your provider/i.test(body) && !/your week number/i.test(body), body);
    const hrOwn = await openCare(MAYA, 'owner');
    ok('while her own screen just says Recent', /Recent/i.test(hrOwn.txt) && !/Recent, from/i.test(hrOwn.txt), hrOwn.txt.slice(-300));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-LOG-CANWRITE: FAIL' : 'PREG-LOG-CANWRITE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
