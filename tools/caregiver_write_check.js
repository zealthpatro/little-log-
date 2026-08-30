#!/usr/bin/env node
/* A caregiver was writing into the mother's private record, and being told he had.
 *
 * The pregnancy JOURNEY (kicks, contractions, the bump & scan album, the gentle library) lives in
 * households/{hid}/pregnancy/{owner}. Her HEALTH record (weights, blood pressure, glucose, urine,
 * nausea, supplements, symptoms) lives in households/{hid}/mhealth/{owner}. firestore.rules lets
 * only that uid write either one, and store-firebase.js returns early for everybody else. The Care
 * tab was taught this once (preg_log_canwrite_check). Nothing else was.
 *
 * So a partner she had shared the journey with got, on his own phone:
 *
 *   - a live kick counter. He tapped, the number moved, he tapped "Stop and save" and was told
 *     "Session saved". The row went into HER kicks, reached nothing, and came off again on her next
 *     snapshot. In between it fed kickBaseline, so his idle tapping was setting what "usual" looks
 *     like for her baby, on the one screen in this product that exists to catch a change.
 *   - a contraction timer with a Start button. One tap filed a contraction she never had, and every
 *     filed row dragged the average duration and the 5-1-1 read she leans on in labour. Each old row
 *     also carried a bin with no guard at all.
 *   - a bin on every bump and scan card. One tap, no confirm, and her 20-week scan and its photo
 *     bytes were gone from his copy. Irreversible for him, invisible to her, and back again on his
 *     next snapshot. The same bare bin was there for HER, which is its own defect: a scan photo is
 *     not a log line.
 *   - the round quick-log button, offering Kicks, Contractions and Symptom. All three wrote nowhere.
 *   - every health sheet she had shared with him to READ. He could type a symptom and be told
 *     "Logged", a weight and be told "Saved". A reading that came and went out of the record she
 *     takes to a midwife.
 *
 * Two failures, and the fix has to close both. Writes that should be refused were not. Writes that
 * WERE refused (pregWriteSession already declined to persist his open session) still said they had
 * worked. Nothing may say "Logged" or "Session saved" for something that was discarded.
 *
 * The birth plan sheet already had the shape: keep it visible, make it read-only, say once whose it
 * is, drop only the pure write affordances, and guard the mutator behind them for the deep link.
 * Every surface below now matches it. The owner's own screen is asserted unchanged throughout, and
 * so is a solo mother with no cloud at all.
 *
 *   PORT=19473 node tools/serve.js &
 *   node tools/caregiver_write_check.js http://localhost:19473
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:19473';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* Week 38, so both week gates (kicks 28, contractions 36) are open and neither absence below can be
   the calendar rather than the fix. Owned by Maya, shared with Sam. One filed kick session, two
   filed contractions, one 20-week scan, and one row in each health list, so every read-only screen
   has something on it to be read-only ABOUT. */
const seed = (over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [],
  pregnancy: {
    id: 'pg1', ownerUid: 'uidMaya', stage: 'expecting', country: 'generic',
    lmp: now - 266 * DAY, dueDate: now + 14 * DAY,
    careTeam: [], appts: [], visitQs: [],
    kicks: [{ id: 'k0', start: now - 2 * DAY, end: now - 2 * DAY + 22 * MIN, count: 10 }],
    contractions: [{ id: 'c0', start: now - 40 * MIN, end: now - 40 * MIN + 50000 },
      { id: 'c1', start: now - 34 * MIN, end: now - 34 * MIN + 52000 }],
    moments: [{ id: 'm1', photoId: 'p1', week: 20, note: 'The 20 week scan, waving at us', at: now - 60 * DAY }],
    symptoms: [{ id: 's0', at: now - 3 * DAY, kind: 'Heartburn', note: '' }],
    weights: [{ id: 'w0', at: now - 7 * DAY, kg: 68, unit: 'kg' }],
    bp: [{ id: 'b0', at: now - 2 * DAY, sys: 118, dia: 74 }],
    glucose: [{ id: 'g0', at: now - 1 * DAY, val: 5.1, unit: 'mmol', context: 'fasting' }],
    glucoseUnit: 'mmol',
    urine: [{ id: 'u0', at: now - 2 * DAY, result: 'Negative' }],
    nausea: [{ id: 'n0', at: now - 4 * DAY, vomits: 1, keptFluids: true, water: 6 }],
    supplements: [{ id: 'sup0', name: 'Folic acid' }], supplementLog: [],
    conditions: { gdm: true, bp: true, nausea: true, supplements: true },
    moodLog: [], guesses: [], bag: [], precon: [], journey: { saved: {} }
  }
}, over || {});

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

  /* Which checkout is on that port? A dead server exits 2, but a LIVE server belonging to another
     agent's tree answers 200 and gets graded happily. pregHealthCanWrite exists only in this branch,
     so its absence means exactly one of two things and the banner says which, rather than letting a
     red run be misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.pregHealthCanWrite === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has pregHealthCanWrite. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO pregHealthCanWrite.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.\n'
      + '             Every guard assertion below is expected to fail. Check the port first.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      Object.keys(sessionStorage).forEach((k) => { if (k.indexOf('cubby-quick-hidden') === 0) sessionStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };

  /* window.LL.pregIsOwner and matIsOwner are copied VERBATIM from store-firebase.js so this gate
     exercises the real predicate rather than a stub of its own invention: uid wins when the record
     carries an ownerUid, household role decides only for a legacy one that never got assigned.
     `who` of null means no cloud at all, which is a solo mother on one device: she owns everything
     and must keep her whole product. */
  const sign = (who, role) => page.evaluate((w, r) => {
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
      // She shared her health and her trackers with him. That is the whole point: he can READ them.
      window.LL.matCanRead = function (c) { return window.LL.pregIsOwner() || ['health', 'careteam', 'conditions'].indexOf(c) >= 0; };
      window.LL.pregJourneyShared = function () { return ['uidSam']; };
    }
    window.__toasts = [];
    render();
    return typeof pregJourneyIsOwner === 'function' ? pregJourneyIsOwner() : null;
  }, who, role);

  // Nothing may claim a save. Kept as one predicate so every screen below is held to the same line.
  const CLAIM = /\b(saved|logged|added|kept|removed|session saved)\b/i;
  const claims = (list) => (list || []).filter((t) => CLAIM.test(t));

  // ---------------------------------------------------------------------------------------------
  console.log('\n1. the round quick-log button offers him nothing, because there is nothing');
  {
    await load(seed());

    const her = await sign('uidMaya', 'owner');
    const o = await page.evaluate(() => ({
      fab: !!document.querySelector('.qadd'),
      chosen: quickChosen('pregnancy'),
      catalog: quickCatalog('pregnancy').map((a) => a.k)
    }));
    ok('she is the owner', her === true, her);
    ok('her round button is there', o.fab === true, o);
    ok('and it carries all three of her pregnancy logs', o.chosen.length === 3
      && ['kicks', 'contractions', 'symptom'].every((k) => o.chosen.indexOf(k) >= 0), o.chosen);

    const his = await sign('uidSam', 'caregiver');
    const s = await page.evaluate(() => {
      const sc = document.getElementById('scroll');
      return {
        fab: !!document.querySelector('.qadd'),
        chosen: quickChosen('pregnancy'),
        catalog: quickCatalog('pregnancy').map((a) => a.k),
        heldBack: quickHeldBack('pregnancy'),
        // Paired with every absence below: the screen he IS on has to be a real screen.
        screenLen: ((sc && sc.innerText) || '').replace(/\s+/g, ' ').trim().length,
        week: pregWeek()
      };
    });
    ok('he is not the owner', his === false, his);
    ok('the week gates are both open, so nothing below is the calendar', s.week >= 36, s.week);
    ok('his round button is gone', s.fab === false, s);
    ok('nothing is left for it to show', s.chosen.length === 0, s.chosen);
    ok('and they are gone from the customiser too, not just the sheet', s.catalog.length === 0, s.catalog);
    ok('it is not the "arrives later on" state either', s.heldBack === false, s);
    ok('and he is looking at a real screen, not a blank one', s.screenLen > 200, s.screenLen);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n2. the kick counter: he keeps her sessions, the counting stays with her');
  {
    await load(seed());
    await sign('uidSam', 'caregiver');
    const r = await page.evaluate(() => {
      openKickCounter();
      const sh = document.getElementById('sheet');
      const handlers = [].slice.call(sh.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const out = {
        // innerText is the rendered sheet, never the inline script's own source.
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim(),
        h2: (sh.querySelector('h2') || {}).textContent,
        rows: sh.querySelectorAll('.log-list-item').length,
        tapBtn: !!sh.querySelector('.kick-big'),
        handlers: handlers,
        watch: !!sh.querySelector('.kick-watch')
      };
      const before = (state.pregnancy.kicks || []).length;
      window.__toasts = [];
      tapKick(); tapKick(); tapKick(); finishKicks();
      out.before = before;
      out.after = (state.pregnancy.kicks || []).length;
      out.toasts = window.__toasts.slice();
      out.openSession = !!state.pregnancy.kickOpen;
      return out;
    });
    ok('the sheet still opens for him', /kick counter/i.test(r.h2 || ''), r.h2);
    ok('her filed session is still on it', r.rows === 1, r);
    ok('and the movements-changed line is still there, which is his job', r.watch === true, r);
    ok('but there is no counter to tap', r.tapBtn === false, r);
    ok('and nothing wired to tapKick', !r.handlers.some((h) => /tapKick/.test(h)), r.handlers);
    ok('nor to finishKicks', !r.handlers.some((h) => /finishKicks/.test(h)), r.handlers);
    ok('the sheet says whose the counting is', /stays with Maya/i.test(r.txt), r.txt.slice(0, 180));
    ok('three taps and a save write nothing', r.after === r.before && r.after === 1, r);
    ok('no open session was left on her record', r.openSession === false, r);
    ok('and it never says "Session saved"', claims(r.toasts).length === 0, r.toasts);
    ok('it says whose it is instead', r.toasts.length > 0 && /journey|Maya/i.test(r.toasts[0]), r.toasts);

    // Her own counter is untouched. Without this the fix could be "delete the feature".
    await sign('uidMaya', 'owner');
    const m = await page.evaluate(() => {
      openKickCounter();
      const sh = document.getElementById('sheet');
      const out = { tapBtn: !!sh.querySelector('.kick-big'), before: (state.pregnancy.kicks || []).length };
      window.__toasts = [];
      tapKick(); tapKick(); finishKicks();
      out.after = (state.pregnancy.kicks || []).length;
      out.count = (state.pregnancy.kicks || [])[out.after - 1].count;
      out.toasts = window.__toasts.slice();
      return out;
    });
    ok('she still has the big counter', m.tapBtn === true, m);
    ok('her session is filed', m.after === m.before + 1, m);
    ok('with the taps she actually made', m.count === 2, m);
    ok('and she is still told it saved', m.toasts.some((t) => /session saved/i.test(t)), m.toasts);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n3. the contraction timer: he sees the labour she is in, he cannot file it');
  {
    await load(seed());
    await sign('uidSam', 'caregiver');
    const r = await page.evaluate(() => {
      openContractions();
      const sh = document.getElementById('sheet');
      const handlers = [].slice.call(sh.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const out = {
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim(),
        rows: sh.querySelectorAll('.log-list-item').length,
        bins: sh.querySelectorAll('.lli-x').length,
        stats: !!sh.querySelector('.tool-stat'),
        handlers: handlers
      };
      const before = (state.pregnancy.contractions || []).length;
      window.__toasts = [];
      toggleContraction(); toggleContraction();
      out.afterToggle = (state.pregnancy.contractions || []).length;
      deleteContraction('c0');
      out.afterDelete = (state.pregnancy.contractions || []).length;
      out.stillHers = (state.pregnancy.contractions || []).some((c) => c.id === 'c0');
      out.toasts = window.__toasts.slice();
      out.openSession = !!state.pregnancy.contractionOpen;
      out.before = before;
      return out;
    });
    ok('her timed contractions are all still listed', r.rows === 2 && r.before === 2, r);
    ok('and the working-out is still on his screen', r.stats === true, r);
    ok('there is no start button', !r.handlers.some((h) => /toggleContraction/.test(h)), r.handlers);
    ok('and no bin on her rows', r.bins === 0, r);
    ok('the sheet says whose the timing is', /stays with Maya/i.test(r.txt), r.txt.slice(0, 180));
    ok('a start and a stop file nothing', r.afterToggle === 2, r);
    ok('no half-open contraction is left on her record', r.openSession === false, r);
    ok('and her own contraction survives his bin', r.afterDelete === 2 && r.stillHers === true, r);
    ok('nothing claimed a save', claims(r.toasts).length === 0, r.toasts);
    ok('he was told whose it is', r.toasts.length > 0, r.toasts);

    await sign('uidMaya', 'owner');
    const m = await page.evaluate(() => {
      openContractions();
      const sh = document.getElementById('sheet');
      const handlers = [].slice.call(sh.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const out = { start: handlers.some((h) => /toggleContraction/.test(h)), bins: sh.querySelectorAll('.lli-x').length };
      toggleContraction(); toggleContraction();
      out.after = (state.pregnancy.contractions || []).length;
      deleteContraction('c0');
      out.afterDelete = (state.pregnancy.contractions || []).length;
      return out;
    });
    ok('she still has the start button', m.start === true, m);
    ok('and a bin on each of her own rows', m.bins === 2, m);
    ok('her contraction files', m.after === 3, m);
    ok('and her delete still deletes', m.afterDelete === 2, m);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n4. the bump & scan album: no bare bin on her scan, and hers asks first');
  {
    await load(seed());
    await sign('uidSam', 'caregiver');
    const r = await page.evaluate(() => {
      pregGo('moments');
      const sc = document.getElementById('scroll');
      const out = {
        cards: sc.querySelectorAll('.moment-card').length,
        bins: sc.querySelectorAll('.moment-card .lli-x').length,
        addRow: !!sc.querySelector('.add-row[onclick*="openAddMoment"]'),
        createBtn: !!sc.querySelector('.gl-create'),
        promptRail: sc.querySelectorAll('.jr-card, .jr-rail .jr-t').length,
        txt: (sc.innerText || '').replace(/\s+/g, ' ').trim()
      };
      window.__toasts = [];
      deleteMoment('m1');
      out.afterDelete = (state.pregnancy.moments || []).length;
      openAddMoment();
      out.sheetOpened = !!document.getElementById('momWeek');
      out.toasts = window.__toasts.slice();
      return out;
    });
    ok('her scan is still on his screen', r.cards === 1, r);
    ok('with no bin on it', r.bins === 0, r);
    ok('no "add a bump or scan photo" row', r.addRow === false, r);
    ok('no "add your own moment" in the library either', r.createBtn === false, r);
    ok('and no rail telling him to capture the bump', r.promptRail === 0, r);
    ok('the album says whose it is', /stays with Maya/i.test(r.txt), r.txt.slice(-260));
    ok('her 20-week scan survives a delete call', r.afterDelete === 1, r);
    ok('the add sheet does not open for him', r.sheetOpened === false, r);
    ok('and nothing claimed a save or a removal', claims(r.toasts).length === 0, r.toasts);
    ok('he was told whose it is', r.toasts.length > 0, r.toasts);

    // Hers: the bin is back, and it asks first. A scan photo has one copy and no undo.
    await sign('uidMaya', 'owner');
    const step1 = await page.evaluate(() => {
      pregGo('moments');
      const sc = document.getElementById('scroll');
      const out = { bins: sc.querySelectorAll('.moment-card .lli-x').length, addRow: !!sc.querySelector('.add-row[onclick*="openAddMoment"]') };
      deleteMoment('m1');
      const sh = document.getElementById('sheet');
      out.confirmH2 = (sh.querySelector('h2') || {}).textContent || '';
      out.confirmTxt = (sh.innerText || '').replace(/\s+/g, ' ').trim();
      out.stillThere = (state.pregnancy.moments || []).length;
      return out;
    });
    ok('she has the bin', step1.bins === 1, step1);
    ok('and the add row', step1.addRow === true, step1);
    ok('her first tap opens a confirm, it does not delete', /delete this photo/i.test(step1.confirmH2), step1.confirmH2);
    ok('the photo is still there while the confirm is up', step1.stillThere === 1, step1);
    ok('and the confirm names the week that goes', /week 20/i.test(step1.confirmTxt), step1.confirmTxt.slice(0, 200));
    ok('it says there is no undo', /no undo/i.test(step1.confirmTxt), step1.confirmTxt.slice(0, 200));

    await page.evaluate(() => { __confirmYes(); });
    await sleep(200);
    const step2 = await page.evaluate(() => ({ left: (state.pregnancy.moments || []).length }));
    ok('confirming does delete it', step2.left === 0, step2);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n5. her health record: shared to read, and it stays a read');
  {
    await load(seed());
    await sign('uidSam', 'caregiver');
    const r = await page.evaluate(() => {
      window.__toasts = [];
      const out = { threw: [] };
      const p = state.pregnancy;
      const before = { sym: p.symptoms.length, w: p.weights.length, bp: p.bp.length, gl: p.glucose.length,
        ur: p.urine.length, nz: p.nausea.length, sup: p.supplements.length, supLog: (p.supplementLog || []).length };
      /* Each call is caught on its own. Before the fix, saveGlucose and saveNausea read their input
         off a sheet that never opened and threw, which would abort the whole block and turn a red
         run into a crash with no counts in it. A gate has to survive the bug it is describing. */
      const T = (n, f) => { try { f(); } catch (e) { out.threw.push(n); } };
      /* Fill whatever field the sheet put up before pressing its save. Without this every save
         bounces off its own "enter a number" and the run passes for free: on the tree before the
         fix, savePregSymptom on an empty box said "Add a note first" and never reached the "Logged"
         this section exists to catch. */
      const fill = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; return true; } return false; };

      T('openLogSymptom', openLogSymptom); out.symptomSheet = fill('symK', 'mild nausea after lunch');
      T('savePregSymptom', savePregSymptom);
      T('openLogWeight', openLogWeight);   out.weightSheet = fill('wKg', '69');
      T('saveWeightPreg', () => saveWeightPreg('kg'));
      T('openLogBP', openLogBP);           out.bpSheet = fill('bpS', '124'); fill('bpD', '78');
      T('saveBP', saveBP);
      T('openUrineLog', openUrineLog);     out.urineSheet = fill('urResult', 'Trace');
      T('saveUrine', saveUrine);
      T('openGlucoseLog', openGlucoseLog); out.glucoseSheet = fill('glVal', '5.4');
      T('saveGlucose', saveGlucose);
      T('openNausea', openNausea);         out.nauseaSheet = fill('nzV', '2');
      T('saveNausea', saveNausea);
      T('addSupplement', () => addSupplement('Iron'));
      T('toggleSupplementToday', () => toggleSupplementToday('sup0'));
      T('removeSupplement', () => removeSupplement('sup0'));
      T('deleteGlucose', () => deleteGlucose('g0')); T('deleteUrine', () => deleteUrine('u0'));
      T('deleteNausea', () => deleteNausea('n0')); T('deletePregLog', () => deletePregLog('bp', 'b0'));

      out.after = { sym: p.symptoms.length, w: p.weights.length, bp: p.bp.length, gl: p.glucose.length,
        ur: p.urine.length, nz: p.nausea.length, sup: p.supplements.length, supLog: (p.supplementLog || []).length };
      out.before = before;
      out.toasts = window.__toasts.slice();
      return out;
    });
    ok('the symptom sheet does not open for him', r.symptomSheet === false, r);
    ok('nor the weight sheet', r.weightSheet === false, r);
    ok('nor the blood-pressure sheet', r.bpSheet === false, r);
    ok('nor the urine sheet', r.urineSheet === false, r);
    ok('nor the glucose sheet', r.glucoseSheet === false, r);
    ok('nor the nausea check-in', r.nauseaSheet === false, r);
    ok('every refusal is a clean return, not a throw', (r.threw || []).length === 0, r.threw);
    ok('nothing he typed reached her record', JSON.stringify(r.after) === JSON.stringify(r.before), r);
    ok('and nothing he deleted left it', r.after.gl === 1 && r.after.ur === 1 && r.after.nz === 1 && r.after.bp === 1, r);
    ok('the word "Logged" is never said to him', !r.toasts.some((t) => /logged/i.test(t)), r.toasts);
    ok('nor "Saved", nor "Added", nor "Removed"', claims(r.toasts).length === 0, r.toasts);
    ok('he was told, every time, and told whose it is', r.toasts.length >= 10 && r.toasts.every((t) => /Maya|journey|health record|hers/i.test(t)), r.toasts);

    // The trackers she shared stay READABLE. Hiding them would be the opposite mistake.
    const v = await page.evaluate(() => {
      openGlucoseTracker();
      let sh = document.getElementById('sheet');
      const g = { rows: sh.querySelectorAll('.log-list-item').length, bins: sh.querySelectorAll('.lli-x').length,
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim(),
        handlers: [].slice.call(sh.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')) };
      closeSheet();
      openBPWatch();
      sh = document.getElementById('sheet');
      const b = { rows: sh.querySelectorAll('.log-list-item').length, bins: sh.querySelectorAll('.lli-x').length,
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim(),
        handlers: [].slice.call(sh.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')) };
      return { g: g, b: b };
    });
    ok('he can still read her glucose readings', v.g.rows >= 1, v.g.rows);
    ok('with no bin on them', v.g.bins === 0, v.g);
    ok('and no "log a reading" button', !v.g.handlers.some((h) => /openGlucoseLog/.test(h)), v.g.handlers);
    ok('the glucose sheet says she shared it to read', /shared this with you to read/i.test(v.g.txt), v.g.txt.slice(0, 200));
    ok('he can still read her blood pressure and urine', v.b.rows >= 2, v.b.rows);
    ok('with no bins', v.b.bins === 0, v.b);
    ok('and neither write button', !v.b.handlers.some((h) => /openLogBP|openUrineLog/.test(h)), v.b.handlers);
    ok('the pre-eclampsia symptom list is still there, which is the point of sharing it',
      /vision|headache|swelling/i.test(v.b.txt), v.b.txt.slice(0, 300));

    // Hers still works end to end.
    await sign('uidMaya', 'owner');
    const m = await page.evaluate(() => {
      window.__toasts = [];
      const p = state.pregnancy;
      const out = { symBefore: p.symptoms.length };
      openLogSymptom();
      out.sheet = !!document.getElementById('symK');
      if (out.sheet) document.getElementById('symK').value = 'mild nausea after lunch';
      savePregSymptom();
      out.symAfter = p.symptoms.length;
      out.toasts = window.__toasts.slice();
      openGlucoseTracker();
      const sh = document.getElementById('sheet');
      out.glLogBtn = [].slice.call(sh.querySelectorAll('[onclick]')).some((e) => /openGlucoseLog/.test(e.getAttribute('onclick')));
      out.glBins = sh.querySelectorAll('.lli-x').length;
      return out;
    });
    ok('her symptom sheet opens', m.sheet === true, m);
    ok('her symptom is written', m.symAfter === m.symBefore + 1, m);
    ok('and she is still told "Logged"', m.toasts.some((t) => /^logged$/i.test(t)), m.toasts);
    ok('her glucose tracker keeps its log button', m.glLogBtn === true, m);
    ok('and its bins', m.glBins >= 1, m);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n6. a solo mother with no cloud keeps the whole product');
  {
    await load(seed({ pregnancy: Object.assign(seed().pregnancy, { ownerUid: 'local' }) }));
    await sign(null, null);
    const r = await page.evaluate(() => {
      const out = { owner: pregJourneyIsOwner(), fab: !!document.querySelector('.qadd'), chosen: quickChosen('pregnancy') };
      openKickCounter();
      out.tapBtn = !!document.getElementById('sheet').querySelector('.kick-big');
      closeSheet();
      pregGo('moments');
      const sc = document.getElementById('scroll');
      out.bins = sc.querySelectorAll('.moment-card .lli-x').length;
      out.addRow = !!sc.querySelector('.add-row[onclick*="openAddMoment"]');
      window.__toasts = [];
      openLogSymptom();
      out.symptomSheet = !!document.getElementById('symK');
      if (out.symptomSheet) document.getElementById('symK').value = 'tired';
      savePregSymptom();
      out.symptoms = state.pregnancy.symptoms.length;
      out.toasts = window.__toasts.slice();
      return out;
    });
    ok('she counts as the owner with no auth at all', r.owner === true, r);
    ok('her round button is there', r.fab === true, r);
    ok('with all three logs', r.chosen.length === 3, r.chosen);
    ok('her kick counter taps', r.tapBtn === true, r);
    ok('her album has its bin and its add row', r.bins === 1 && r.addRow === true, r);
    ok('and her symptom still writes and still says so', r.symptoms === 2 && r.toasts.some((t) => /logged/i.test(t)), r);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n7. a legacy record with no ownerUid: the household owner writes, a caregiver does not');
  {
    const legacy = seed();
    delete legacy.pregnancy.ownerUid;
    await load(legacy);
    await sign('uidMaya', 'owner');
    const her = await page.evaluate(() => ({ owner: pregJourneyIsOwner(), fab: !!document.querySelector('.qadd') }));
    ok('the household owner is treated as the owner', her.owner === true && her.fab === true, her);

    await sign('uidSam', 'caregiver');
    const his = await page.evaluate(() => {
      const out = { owner: pregJourneyIsOwner(), fab: !!document.querySelector('.qadd'), before: state.pregnancy.kicks.length };
      window.__toasts = [];
      tapKick(); finishKicks();
      out.after = state.pregnancy.kicks.length;
      out.toasts = window.__toasts.slice();
      return out;
    });
    ok('a caregiver never becomes the owner by default', his.owner === false, his);
    ok('his round button is gone here too', his.fab === false, his);
    ok('and his kick session still writes nothing', his.after === his.before, his);
    ok('with nothing claimed', claims(his.toasts).length === 0, his.toasts);
  }

  console.log('\n8. the page itself');
  ok('no page errors anywhere in this run', errs.length === 0, errs);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('CAREGIVER_WRITE: ' + (fail === 0 ? 'PASS' : 'FAIL'));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
