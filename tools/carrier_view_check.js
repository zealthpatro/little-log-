#!/usr/bin/env node
/* Who is pregnant is a fact about the DATA, never about a relationship label.
 *
 * viewerIsCarrier() decides whether the person looking at a pregnancy is the person carrying it.
 * Until 2026-10-26 it answered from the relationship label: only "Papa Bear", "Grandpa Bear" and
 * "Uncle Bear" were treated as not pregnant, and everything else was. Labels are free text in the
 * circle (a partner can be "Dad", "Husband", anything), and the preset list itself has Nana Bear,
 * Auntie Bear, Nanny, Caregiver and Other. So anyone she had shared her journey with, under any
 * label but those three, got HER screens:
 *
 *   expecting  "You and baby", "You this week", "How are you, in yourself?" and her Symptom and
 *              Weight tiles, on his home.
 *   trying     her fertile-window dates, her cycle lengths, her latest "Today I noticed" notes and
 *              the doctor report, read from the journey doc she shared, on the home screen whose
 *              partner version promises "Cycle details stay with her unless she shares them".
 *
 * And the other way round: a pregnant owner whose label is "Papa Bear" lost her own view.
 *
 * Fixed: viewerIsCarrier() asks the ownership predicates (LL.matIsOwner, LL.pregIsOwner), which
 * read state.pregnancy.ownerUid against the signed-in uid. The label is never read.
 *
 * Sections 1-3 grade the real tree. Section 4 plants the OLD label rule into the same page and
 * requires the partner sections to go red, so this gate shows on every run that it can still fail.
 * The owner sections are also the companions for every absence assertion in the partner ones: the
 * same matcher that finds nothing on his screen must find the thing on hers.
 *
 * WHAT THIS DOES NOT COVER.
 *   - Rules. Like preg_log_canwrite_check, it runs local mode and injects window.LL after boot with
 *     the ownership predicates copied VERBATIM from app/store-firebase.js. firestore.rules is graded
 *     by test/rules-test.js (--emulator tier), not here.
 *   - A partner who CREATED the journey owns it in the data, so he is its carrier here too. Cubby has
 *     no field that says who is carrying apart from who created the record, and no way to hand a
 *     journey over. That is a product gap, not something a label should paper over.
 *
 *   node tools/carrier_view_check.js http://localhost:9745
 *
 * Pass an explicit base URL; tools/gates.js passes its own.
 */
const puppeteer = require('puppeteer-core');
const dl = require('./gate_downloads');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

// Pinned to a DAY and an hour (14 Oct 2026, 1 pm local), so no month boundary can move a window.
const CLOCK = new Date(2026, 9, 14, 13, 0, 0, 0).getTime();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam';
const OBS_NOTE = 'Faint line on the morning test';

const base = {
  id: 'p1', ownerUid: MAYA, country: 'uk', precon: [{ id: 'c1', text: 'Take folic acid', done: false }],
  careTeam: [], symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null,
};
// Thirty weeks along: every tile row this screen has is on it.
const expecting = () => Object.assign({}, base, {
  stage: 'expecting', dueDate: now + 10 * 7 * DAY, lmp: now - 30 * 7 * DAY, cycleLen: 28, periods: [],
  appts: [], createdAt: now - 30 * 7 * DAY, visitQs: [],
});
// Trying, ten days into a 28-day cycle: her window is open today, and she wrote a note yesterday.
const trying = () => Object.assign({}, base, {
  stage: 'planning', dueDate: null, lmp: now - 10 * DAY, cycleLen: 28, periods: [now - 10 * DAY],
  tryingSince: null, appts: [], createdAt: now - 200 * DAY,
  observations: [{ id: 'o1', at: now - DAY, tags: [], note: OBS_NOTE }],
});
const seed = (p) => ({
  babies: [], activeBabyId: null, events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [], pregnancy: p,
});

// The labels a shared partner might carry. The first three are the ones the founder named.
const PARTNER_LABELS = ['Dad', 'Nanny', 'Husband', 'Nana Bear', 'Auntie Bear', 'Caregiver', 'Other', 'Papa Bear', ''];
// Labels on HER. "Papa Bear" and "Dad" are there because a label must not take her own view away.
const OWNER_LABELS = ['Mama Bear', '', 'Papa Bear', 'Dad'];
// Under the old rule these must go red. If the planted rule ever stops failing them, the gate is blind.
const MUST_CATCH = ['Dad', 'Nanny', 'Husband'];

/* The pre-fix predicate, verbatim in behaviour, planted by section 4. */
function plantOldRule() {
  window.viewerIsCarrier = function () {
    try {
      var info = (window.LL && window.LL.memberInfo) || {}; var rel = ((info[myUid()] && info[myUid()].relationship) || '').toLowerCase();
      if (!rel) return (window.LL && typeof window.LL.matIsOwner === 'function') ? !!window.LL.matIsOwner() : true;
      return ['papa bear', 'grandpa bear', 'uncle bear'].indexOf(rel) < 0;
    } catch (_) { return true; }
  };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
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
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s, mutate) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-fertile-hidden') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.toast = function () {}; } catch (e) {} });
    if (mutate) await page.evaluate(plantOldRule);
  };

  /* Sign in as somebody with a label, then paint the pregnancy home and open the cycle sheet.
     The predicates are store-firebase.js's own. `who` null means no cloud at all: a solo mother. */
  const view = (who, role, label) => page.evaluate((w, r, lab) => {
    try { closeSheet(); } catch (e) {}
    if (!w) { try { delete window.LL; } catch (e) { window.LL = undefined; } }
    else {
      window.LL = window.LL || {};
      window.LL.auth = { currentUser: { uid: w } };
      window.LL.role = r;
      window.LL.members = { uidMaya: 'owner', uidSam: 'caregiver' };
      window.LL.memberInfo = {
        uidMaya: { name: 'Maya Rao', relationship: w === 'uidMaya' ? lab : 'Mama Bear' },
        uidSam: { name: 'Sam Rao', relationship: w === 'uidSam' ? lab : 'Papa Bear' },
      };
      window.LL.pregIsOwner = function () {
        var u = window.LL.auth.currentUser; if (!u) return true;
        var p = state.pregnancy; if (!p) return true;
        if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
        return window.LL.role === 'owner';
      };
      window.LL.matIsOwner = window.LL.pregIsOwner;
      window.LL.matCanRead = function () { return window.LL.pregIsOwner(); };
      window.LL.pregJourneyShared = function () { return ['uidSam']; };
      window.LL.preconCanWrite = function () { return true; };
    }
    pregGo('week');
    var s = document.getElementById('scroll');
    var out = {
      carrier: viewerIsCarrier(),
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      greeting: ((s.querySelector('.greeting') || {}).textContent || '').trim(),
      hero: ((s.querySelector('.wh-count') || {}).textContent || '').trim(),
      titles: [].slice.call(s.querySelectorAll('.pc-t, .label')).map(function (e) { return (e.textContent || '').trim(); }),
      handlers: [].slice.call(s.querySelectorAll('[onclick]')).map(function (e) { return e.getAttribute('onclick'); }),
    };
    // The deep link (?stage=planning) opens this sheet whatever home he is on, so ask it directly.
    if (state.pregnancy.stage === 'planning') {
      openPlanningSetup();
      var sh = document.getElementById('sheet');
      out.sheetLmp = !!(sh && sh.querySelector('#plLmp'));
      out.sheetCycle = !!(sh && sh.querySelector('#plCycle'));
      closeSheet();
    }
    return out;
  }, who, role, label);
  const wires = (r, fn) => r.handlers.some((h) => h.indexOf(fn) >= 0);
  const hasTitle = (r, t) => r.titles.some((x) => x.indexOf(t) === 0);

  async function suite(mutate) {
    let pass = 0, fail = 0; const failed = [];
    const ok = (tag, n, c, x) => {
      if (c) { pass++; if (!mutate) console.log('  ok   ' + n); }
      else { fail++; failed.push(tag); if (!mutate) console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x).slice(0, 400) : '')); }
    };
    const say = (s) => { if (!mutate) console.log(s); };

    say('\n1. expecting: she sees her own screen, whatever her label');
    await load(seed(expecting()), mutate);
    for (const lab of OWNER_LABELS) {
      const r = await view(MAYA, 'owner', lab);
      const tag = 'owner:' + lab, as = ' (she is "' + (lab || 'no label') + '")';
      ok(tag, 'she is the carrier' + as, r.carrier === true, r.carrier);
      ok(tag, '"You and baby"' + as, /^You and baby/.test(r.hero), r.hero);
      ok(tag, '"You this week"' + as, hasTitle(r, 'You this week') && wires(r, "openWeekDetail('you')"), r.titles);
      ok(tag, 'her private note card' + as, hasTitle(r, 'How are you, in yourself?') && wires(r, 'openMoodNote('), r.titles);
      ok(tag, 'her Symptom and Weight tiles' + as, wires(r, 'openLogSymptom(') && wires(r, 'openLogWeight('), r.handlers);
      ok(tag, 'and no partner card' + as, !hasTitle(r, 'How to support your partner'), r.titles);
    }
    {
      const r = await view(null);
      ok('solo', 'with no cloud at all she is still the carrier', r.carrier === true && /^You and baby/.test(r.hero), r);
    }

    say('\n2. expecting: a partner she shared it with never gets her screen, whatever his label');
    for (const lab of PARTNER_LABELS) {
      const r = await view(SAM, 'caregiver', lab);
      const tag = 'partner:' + lab, as = ' (he is "' + (lab || 'no label') + '")';
      ok(tag, 'he is not the carrier' + as, r.carrier === false, r.carrier);
      ok(tag, 'the hero says "Baby", not "You and baby"' + as, /^Baby/.test(r.hero) && !/You and baby/.test(r.txt), r.hero);
      ok(tag, 'no "You this week"' + as, !hasTitle(r, 'You this week') && !wires(r, "openWeekDetail('you')"), r.titles);
      ok(tag, 'no private note card' + as, !/How are you, in yourself/.test(r.txt) && !wires(r, 'openMoodNote('), r.titles);
      ok(tag, 'no Symptom or Weight tile' + as, !wires(r, 'openLogSymptom(') && !wires(r, 'openLogWeight('), r.handlers);
      ok(tag, 'his own card instead' + as, hasTitle(r, 'How to support your partner this week'), r.titles);
    }

    say('\n3. trying: her cycle is hers. He gets the shared home; she gets her window and her notes');
    await load(seed(trying()), mutate);
    for (const lab of OWNER_LABELS) {
      const r = await view(MAYA, 'owner', lab);
      const tag = 'owner:' + lab, as = ' (she is "' + (lab || 'no label') + '")';
      ok(tag, 'her home' + as, /^Getting ready 🌱/.test(r.greeting), r.greeting);
      ok(tag, 'her fertile window' + as, r.titles.some((t) => /fertile window/i.test(t)), r.titles);
      ok(tag, 'her own note' + as, r.txt.indexOf(OBS_NOTE) >= 0, r.txt.slice(0, 300));
      ok(tag, 'her period and cycle doors' + as, wires(r, 'openPeriodUpdate(') && wires(r, 'openPlanningSetup('), r.handlers);
      ok(tag, 'the cycle sheet asks her about her period' + as, r.sheetLmp === true && r.sheetCycle === true, r);
    }
    for (const lab of PARTNER_LABELS) {
      const r = await view(SAM, 'caregiver', lab);
      const tag = 'partner:' + lab, as = ' (he is "' + (lab || 'no label') + '")';
      ok(tag, 'the shared home' + as, /Getting ready, together/.test(r.greeting) && /What stays private/.test(r.txt), r.greeting);
      ok(tag, 'no fertile window' + as, !r.titles.some((t) => /fertile window/i.test(t)) && !/fertile window/i.test(r.txt), r.titles);
      ok(tag, 'not her note' + as, r.txt.indexOf(OBS_NOTE) < 0, r.txt.slice(0, 300));
      ok(tag, 'no door into her period, cycle, notes or report' + as,
        !wires(r, 'openPeriodUpdate(') && !wires(r, 'openPlanningSetup(') && !wires(r, 'openObservation(') && !wires(r, 'openTtcDoctorReport('), r.handlers);
      ok(tag, 'and the cycle sheet does not show him her period or cycle' + as, r.sheetLmp === false && r.sheetCycle === false, r);
    }
    return { pass, fail, failed };
  }

  console.log('Carrier view: who is pregnant comes from the data, never the label  (' + BASE + ')');
  const real = await suite(false);

  console.log('\n4. the gate can go red: plant the old label rule and the partner sections must fail');
  const bad = await suite(true);
  const caught = (lab) => bad.failed.some((t) => t === 'partner:' + lab);
  let selfFail = 0;
  for (const lab of MUST_CATCH) {
    const c = caught(lab);
    console.log((c ? '  ok   ' : '  FAIL ') + 'the old rule is caught for a partner labelled "' + lab + '"');
    if (!c) selfFail++;
  }
  const ownerCaught = bad.failed.some((t) => t === 'owner:Papa Bear');
  console.log((ownerCaught ? '  ok   ' : '  FAIL ') + 'and for a pregnant owner labelled "Papa Bear"');
  if (!ownerCaught) selfFail++;
  console.log('         (' + bad.fail + ' assertions fail under the old rule)');

  if (errs.length) console.log('\n  page errors: ' + errs.slice(0, 3).join(' | '));
  await browser.close();
  const fails = real.fail + selfFail + (errs.length ? 1 : 0);
  console.log('\n' + (real.pass + MUST_CATCH.length + 1 - selfFail) + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
