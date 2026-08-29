#!/usr/bin/env node
/* After the birth, Cubby took her blood pressure away from her.
 *
 * Pre-eclampsia presents AFTER delivery as well as before it. openPregRecord's own header comment
 * in app/index.html says exactly that, and then the sheet it introduces is read-only: it counts
 * "3 blood pressure readings" and tells her they still matter in the weeks after a birth, with no
 * way to add the fourth. The whole maternal surface goes with the handover. The look-back shell has
 * no tabs, the Care tab and its Blood pressure tile belong to a pregnancy that is over, and the
 * only maternal thing that survived into the baby stage was the private mood note. So a woman sent
 * home with "check it every day for a fortnight" opened Cubby, was told by Cubby that her blood
 * pressure mattered, and had nowhere to put the number, while p.bp, openLogBP, bpFlag and the
 * mhealth privacy gate all still existed and all still synced.
 *
 * Two doors, no new screen: a "Log a reading" row in the record she already opens to look back, and
 * a Settings row beside "How you are, in yourself", both owner-only. Both land in the unchanged
 * openLogBP, so a raised postpartum reading gets the same answer openBPConcern gives an antenatal
 * one instead of toast('Saved').
 *
 * WHAT THIS ASSERTS, and why each one is here rather than being assumed.
 *   - the row exists WITH NO READINGS. That is the actual case: a woman told to check it for a
 *     fortnight has zero readings by definition, and the section that carries the row used to be
 *     hidden entirely when the count was zero. Testing this only with data seeded in would have
 *     shipped a door that opens for nobody who needs it.
 *   - a partner she shared 'health' with still READS and never WRITES. syncMaternal writes mhealth
 *     for the owner alone, so his save reaches no server and the next snapshot wipes it. Same class
 *     as the read-only Care tab. The absence of the row is asserted next to a COUNT of the rows he
 *     does get, because a sheet that failed to render also contains no row.
 *   - the guard is on the FUNCTION. Section 7 opens the sheet as her, changes who is holding the
 *     phone, and presses Save, which is what an ownership snapshot landing over an open sheet looks
 *     like. A row-only gate passes every other section and fails this one.
 *   - p.bp can be MISSING. ensurePregFields never creates it; only savePregnancy and startTrying
 *     do. A record that arrived through the journey doc and the mhealth fold has whatever keys
 *     those carried, so the push could throw years later on the one screen that has to work.
 *   - the info dot survives the stage change. openSheet matches the <h2> against teach-data.js and
 *     CubbyTeach.visible() filters on stage, so leaving `who.stage` at ['pregnancy'] would have
 *     silently deleted the "i" from this sheet for the only reader who reaches it postpartum.
 *   - the row states her own number and never judges it. No "raised", no colour. bpFlag's judgement
 *     belongs in the answer to a save, not in a list row she passes on the way to Settings.
 *
 * WHAT TWO REVIEWERS FOUND, AND WHAT SECTIONS 10 AND 12 TO 14 NOW HOLD DOWN. The first version of
 * this change widened the registry row to the baby stage so the sheet would keep its "i", and
 * app/teach.js filters on stage, role and months only. So CubbyTeach.visible() offered the row to
 * every baby-stage household, and the how-to index, which renders one section per domain under a
 * fixed name, grew a lone section headed "While you are expecting" carrying one row about blood
 * pressure. A woman nine days postpartum searching the guide was told she is expecting on the line
 * above one saying she is not, and a father, an adoptive parent and anybody who signed up with the
 * baby already here got the same orphan section for a door the shell never draws for them. Under it
 * openLogBP opened for real, because pregIsOwner() answers true when there is no pregnancy at all,
 * and saveBP then threw TypeError on state.pregnancy.bp with the sheet still up and nothing saved.
 * And the gate had no scenario past nine days, so "the sheet keeps its info dot" was proven for a
 * newborn and false from eighteen months on for a row that was still on screen.
 *
 * Three answers, all asserted below. `who.needs` makes the registry ask the shell whether the door
 * is really there (ctx.has). The how-to group is named for the reader in front of it. And the door
 * itself closes twelve weeks after the birth, which is what every line of its copy already said.
 *
 * SCOPE. The harness runs the app in local mode and injects window.LL by hand after boot, so
 * app/store-firebase.js never loads and firestore.rules is never evaluated. A PASS attests the
 * render and the guards are right GIVEN the ownership predicate, which is copied verbatim from
 * store-firebase.js below. It says nothing about the server side.
 *
 *   PORT=9473 node tools/serve.js &
 *   node tools/preg_bp_row_check.js http://localhost:9473
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and gets graded happily.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
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

// A pregnancy Maya owns that ended in a birth 9 days ago: the postpartum fortnight, exactly.
const born = (over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now - 2 * DAY, lmp: now - 41 * 7 * DAY, cycleLen: 28, periods: [],
  country: 'uk', precon: [], careTeam: [{ id: 'c1', name: 'Midwife team', phone: '+44 20 7946 0000' }],
  appts: [{ id: 'a1', week: 36, title: 'Midwife appointment', note: '', done: true, at: now - 30 * DAY }],
  symptoms: [], weights: [], bp: [], kicks: [], contractions: [], birthPlan: '', bag: [],
  moments: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: 'b1', birthAt: now - 9 * DAY, createdAt: now - 41 * 7 * DAY,
}, over || {});

// The same journey still running at 30 weeks, for the stage-boundary section.
const expecting = (over) => Object.assign(born(), {
  dueDate: now + 10 * 7 * DAY, lmp: now - 30 * 7 * DAY,
  appts: [{ id: 'a1', week: 28, title: 'Growth scan', note: '', done: false, at: null }],
  bornBabyId: null, birthAt: null,
}, over || {});

const seed = (p, over) => Object.assign({
  babies: p && p.bornBabyId ? [{ id: 'b1', name: 'Robin', birth: now - 9 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] : [],
  activeBabyId: p && p.bornBabyId ? 'b1' : null,
  events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [], pregnancy: p,
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

  /* Which checkout is on that port? pregBpRowSub exists only in this branch, so its absence means
     one of exactly two things and the banner says which, so a red run is never misread. */
  const marker = await page.evaluate(() => typeof window.pregBpRowSub === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has pregBpRowSub. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO pregBpRowSub.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.\n'
      + '             Every assertion below is expected to fail. Check the port first.');

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

  /* Sign in as somebody. pregIsOwner / matIsOwner are copied VERBATIM from store-firebase.js so the
     gate exercises the real predicate: uid wins when the record carries an ownerUid, household role
     decides only for a legacy record that never got one. `who` null means no cloud at all, which is
     a solo mother offline and must leave her everything. */
  const signIn = (who, role, matRead) => page.evaluate((w, r, mr) => {
    if (!w) { try { delete window.LL; } catch (e) { window.LL = undefined; } return; }
    window.LL = window.LL || {};
    window.LL.auth = { currentUser: { uid: w } };
    window.LL.role = r;
    window.LL.members = { uidMaya: 'owner', uidSam: 'caregiver' };
    window.LL.memberInfo = { uidMaya: { name: 'Maya Rao', relationship: 'Mama Bear' }, uidSam: { name: 'Sam Rao', relationship: 'Papa Bear' } };
    window.LL.matIsOwner = function () {
      var u = window.LL.auth.currentUser; if (!u) return true;
      var p = state.pregnancy; if (!p) return true;
      if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
      return window.LL.role === 'owner';
    };
    window.LL.pregIsOwner = window.LL.matIsOwner;
    window.LL.matCanRead = function (c) { return window.LL.matIsOwner() || (mr || []).indexOf(c) >= 0; };
    window.LL.pregJourneyShared = function () { return ['uidSam']; };
  }, who, role, matRead || []);

  // Every row in an open sheet, as the DOM has it. innerText is the rendered screen; the inline
  // script's own source never appears in it, which document.body.textContent cannot promise.
  const sheetRows = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    const open = !!(s && s.classList.contains('show'));
    if (!open) return { open: false, rows: [], secTitles: [], txt: '', handlers: [] };
    const rows = [].slice.call(s.querySelectorAll('.set-item')).map((e) => ({
      on: e.getAttribute('onclick') || '', a: (e.querySelector('.a') || {}).textContent || '',
      b: (e.querySelector('.b') || {}).textContent || '',
    }));
    return {
      open: true, rows: rows,
      // textContent, not innerText: .sec-title is uppercased by CSS and innerText reports the
      // transform, so a heading written "Readings" arrives as "READINGS".
      secTitles: [].slice.call(s.querySelectorAll('.sec-title')).map((e) => (e.textContent || '').trim()),
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      handlers: [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')),
      h2: (s.querySelector('h2') || {}).textContent || '',
      dot: !!s.querySelector('h2 .lg-i'),
      hasBpInput: !!s.querySelector('#bpS'),
    };
  });
  const open = async (fn) => { await page.evaluate((f) => { window[f](); }, fn); await sleep(250); return sheetRows(); };
  // Tap a real row by its handler, the way a thumb does.
  const tapRow = async (frag) => {
    const hit = await page.evaluate((f) => {
      const el = [].slice.call(document.querySelectorAll('#sheet [onclick], #scroll [onclick]'))
        .find((e) => (e.getAttribute('onclick') || '').indexOf(f) >= 0);
      if (!el) return false; el.click(); return true;
    }, frag);
    await sleep(300);
    return hit;
  };
  const bpRows = (r) => r.rows.filter((x) => x.on.indexOf('openLogBP') >= 0);
  /* The how-to index, which is the surface two reviewers reproduced a failure on. It reads
     CubbyTeach.visible(), so it is where a row widened by stage alone shows up in front of people
     the shell would never draw the door for, under a group heading it then contradicts. Read the
     rendered guide rather than the registry: the heading is the defect. */
  const howtoIndex = async () => {
    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await sleep(200);
    await page.evaluate(() => { try { CubbyTeachUI.howto(); } catch (e) {} });
    await sleep(400);
    const r = await page.evaluate(() => {
      const g = document.getElementById('logGuide');
      if (!g) return { open: false, heads: [], labels: [], txt: '' };
      return {
        open: true,
        // textContent, not innerText: .ht-dh is uppercased by CSS.
        heads: [].slice.call(g.querySelectorAll('.ht-dh')).map((e) => (e.textContent || '').trim()),
        labels: [].slice.call(g.querySelectorAll('.ht-t')).map((e) => (e.textContent || '').trim()),
        txt: (g.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    });
    await page.evaluate(() => { try { CubbyGuide.close(); } catch (e) {} });
    await sleep(250);
    return r;
  };
  const teachSees = () => page.evaluate(() => ((window.CubbyTeach && CubbyTeach.visible()) || []).indexOf('openLogBP') >= 0);
  /* Type into the real sheet and press the real Save button. It returns false rather than throwing
     when the sheet is not up, so a run against a tree WITHOUT the fix reports every section red
     instead of dying at the first missing input and printing nothing after it. A gate that exits on
     an exception cannot be read as a count. */
  const saveReading = async (sys, dia) => {
    const r = await page.evaluate((s, d) => {
      const si = document.getElementById('bpS'), di = document.getElementById('bpD');
      if (!si || !di) return false;
      si.value = String(s); di.value = String(d);
      const btn = [].slice.call(document.querySelectorAll('#sheet [onclick]'))
        .find((e) => (e.getAttribute('onclick') || '').indexOf('saveBP') >= 0);
      if (!btn) return false;
      btn.click(); return true;
    }, sys, dia);
    await sleep(350);
    return r;
  };
  const bpCount = () => page.evaluate(() => ((state.pregnancy || {}).bp || []).length);
  /* Tomorrow morning. app/store-firebase.js replaces persist() with its own scheduledPush the moment
     it loads, so in this harness a save never reaches localStorage on its own and a naive reload
     would prove only that the harness forgot the reading. Snapshot what is in memory into the store
     the way the cloud round-trip hands it back, then boot from scratch. What is under test is the
     RENDER on load: whether the row and the record read a reading they did not just watch happen. */
  const reopen = async () => {
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(state)));
    await page.evaluate((x) => localStorage.setItem('little-log-v1', JSON.stringify(x)), snap);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {} });
    await sleep(200);
  };

  console.log('\n1. before the birth nothing moves: she still has the Care tab');
  {
    await load(seed(expecting()));
    await signIn(MAYA, 'owner');
    const set = await open('openSettings');
    ok('Settings renders rows at all', set.rows.length >= 4, set.rows.length);
    ok('no postpartum blood pressure row while she is still pregnant', bpRows(set).length === 0, set.rows.map((r) => r.a));
    await page.evaluate(() => closeSheet()); await sleep(250);
    const care = await page.evaluate(() => {
      pregGo('care');
      const s = document.getElementById('scroll');
      return [].slice.call(s.querySelectorAll('[onclick]')).filter((e) => (e.getAttribute('onclick') || '').indexOf('openLogBP') >= 0).length;
    });
    ok('the Care tab still offers her the sheet', care === 1, care);
  }

  console.log('\n2. after the birth, Settings is a door, with no readings in the record');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    // Strictly. ok()'s third argument is the payload printed on failure, not an expected value, so
    // comparing here rather than passing `true` is the difference between an assertion and a
    // truthiness check that 'child' and 'pregnancy' both satisfy.
    ok('she is in the baby stage now', await page.evaluate(() => quickStage()) === 'baby', await page.evaluate(() => quickStage()));
    const set = await open('openSettings');
    const rows = bpRows(set);
    ok('exactly one blood pressure row', rows.length === 1, set.rows.map((r) => r.a));
    ok('it is named plainly', (rows[0] || {}).a === 'Blood pressure', rows[0]);
    ok('with nothing logged it says when it is for, not a number', /if your team asked/i.test((rows[0] || {}).b || ''), rows[0]);
    ok('it sits beside her wellbeing note', set.rows.some((r) => r.on.indexOf('openMoodNote') >= 0), set.rows.map((r) => r.a));
    ok('tapping it opens the real sheet', await tapRow('openLogBP'));
    const sheet = await sheetRows();
    ok('the blood pressure sheet is up', sheet.hasBpInput === true, sheet.h2);
    ok('unchanged: it is still the antenatal sheet', /if your provider has asked you to track it/i.test(sheet.txt), sheet.txt.slice(0, 140));
  }

  console.log('\n3. after the birth, the record she looks back on is the other door');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    /* The real path, every tap of it: the switcher, the pregnancy row in it, the record, the row.
       Setting viewingPreg by hand proved the record door exists in a state the gate itself
       manufactured, and said nothing about whether a thumb can get there. */
    await open('openBabySheet');
    ok('the switcher offers the journey back to her', await tapRow('viewingPreg=true'));
    await sleep(400);
    ok('and that is the look-back shell', await page.evaluate(() => viewingPreg === true));
    const shell = await page.evaluate(() => {
      const s = document.getElementById('scroll');
      return [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
    });
    ok('the look-back shell offers the record', shell.some((h) => h.indexOf('openPregRecord') >= 0), shell);
    ok('tapping the record opens it', await tapRow('openPregRecord'));
    const rec = await sheetRows();
    ok('it is her pregnancy record', /pregnancy record/i.test(rec.h2), rec.h2);
    ok('the Readings section shows even with nothing in it', (rec.secTitles || []).indexOf('Readings') >= 0, rec.secTitles);
    ok('and says why it is there', /still matters in the weeks after a birth/i.test(rec.txt), rec.txt.slice(0, 320));
    ok('it invents no count when there is nothing', !/0 blood pressure/i.test(rec.txt), rec.txt.slice(0, 320));
    const rows = bpRows(rec);
    ok('one Log a reading row', rows.length === 1, rec.rows.map((r) => r.a));
    ok('named as the item asked', (rows[0] || {}).a === 'Log a reading', rows[0]);
    ok('tapping it opens the sheet', await tapRow('openLogBP'));
    ok('the sheet is really up', (await sheetRows()).hasBpInput === true);
  }

  console.log('\n4. a calm postpartum reading is saved and comes back');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    await open('openSettings');
    await tapRow('openLogBP');
    ok('she can type a reading and press Save', await saveReading(118, 74) === true);
    ok('it says Saved and does not alarm her', (await page.evaluate(() => window.__toasts.slice())).join(' ').indexOf('Saved') >= 0);
    ok('no concern sheet for a normal reading', (await sheetRows()).open === false);
    ok('one reading is on her record', await bpCount() === 1, await bpCount());

    await reopen();
    await signIn(MAYA, 'owner');
    ok('it is still there when she opens Cubby again', await bpCount() === 1, await bpCount());
    let set = await open('openSettings');
    ok('the row now states her own number', /Last reading 118\/74/.test((bpRows(set)[0] || {}).b || ''), bpRows(set)[0]);

    // A second save must not be swallowed, and the row must follow the newest not the first.
    await tapRow('openLogBP');
    await saveReading(122, 80);
    ok('a second reading is added, not replaced', await bpCount() === 2, await bpCount());
    set = await open('openSettings');
    ok('the row follows the newest reading', /Last reading 122\/80/.test((bpRows(set)[0] || {}).b || ''), bpRows(set)[0]);
    const rec = await open('openPregRecord');
    ok('the record counts both', /2 blood pressure readings/.test(rec.txt), rec.txt.slice(0, 300));
  }

  console.log('\n5. a raised postpartum reading gets the antenatal answer, not a toast');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    await open('openSettings');
    await tapRow('openLogBP');
    await saveReading(152, 98);
    const r = await sheetRows();
    // The heading of the concern sheet IS the reading, so this is the sheet and not some other one
    // that happened to be left open.
    ok('a sheet opens instead of Saved', r.open === true && /^\d+\s*\/\s*\d+$/.test((r.h2 || '').trim()), { h2: r.h2, toasts: await page.evaluate(() => window.__toasts.slice()) });
    ok('it repeats her own numbers back', /152\s*\/\s*98/.test(r.h2), r.h2);
    ok('it names whose threshold it is', /140\s*\/\s*90/.test(r.txt), r.txt.slice(0, 200));
    ok('her midwife number is one tap away', await page.evaluate(() => !!document.querySelector('#sheet a[href^="tel:"]')));
    ok('it is saved either way', await bpCount() === 1, await bpCount());

    await load(seed(born()));
    await signIn(MAYA, 'owner');
    await open('openSettings');
    await tapRow('openLogBP');
    await saveReading(168, 112);
    const s = await sheetRows();
    ok('a severe postpartum reading says call now, today', /call now, today/i.test(s.txt), s.txt.slice(0, 220));
    ok('and still refuses to diagnose', /not a diagnosis/i.test(s.txt), s.txt.slice(0, 260));
  }

  console.log('\n6. the row states her number and never judges it');
  {
    await load(seed(born({ bp: [{ id: 'x1', at: now - 3 * 3600000, sys: 155, dia: 99 }] })));
    await signIn(MAYA, 'owner');
    const set = await open('openSettings');
    const b = (bpRows(set)[0] || {}).b || '';
    ok('it shows the reading she took', /155\/99/.test(b), b);
    // Paired with the line above on purpose: an empty subtitle contains no verdict either.
    ok('no verdict on the row', b.length > 0 && !/raised|high|very high|normal|abnormal|warning/i.test(b), b);
    const rec = await open('openPregRecord');
    const rb = (bpRows(rec)[0] || {}).b || '';
    ok('and none in the record row either', rb.length > 0 && !/raised|very high/i.test(rb), rb);
  }

  console.log('\n7. a partner she shared her health with reads it and cannot write it');
  {
    await load(seed(born({ bp: [{ id: 'x1', at: now - 2 * DAY, sys: 118, dia: 76 }] })));
    await signIn(SAM, 'caregiver', ['health', 'careteam']);
    ok('he is not the owner of her health', await page.evaluate(() => pregIsOwner()) === false);
    const set = await open('openSettings');
    ok('Settings renders for him', set.rows.length >= 4, set.rows.length);
    ok('no blood pressure row in his Settings', bpRows(set).length === 0, set.rows.map((r) => r.a));
    ok('and no private wellbeing row either', !set.rows.some((r) => r.on.indexOf('openMoodNote') >= 0), set.rows.map((r) => r.a));

    const rec = await open('openPregRecord');
    ok('he still sees her record', rec.open === true && /pregnancy record/i.test(rec.h2), rec.h2);
    ok('he still reads the readings she shared', /1 blood pressure reading/.test(rec.txt), rec.txt.slice(0, 300));
    ok('the record has rows for him, so the next line is not an empty sheet', rec.handlers.length >= 1, rec.handlers);
    ok('but not one handler that logs one', rec.handlers.filter((h) => h.indexOf('openLogBP') >= 0).length === 0, rec.handlers);
    ok('and no Log a reading anywhere on it', !/Log a reading/.test(rec.txt), rec.txt.slice(0, 320));

    // The deep second door: the function itself, reached past every row.
    await page.evaluate(() => { closeSheet(); window.__toasts = []; });
    await sleep(300);
    await page.evaluate(() => openLogBP());
    await sleep(250);
    const forced = await sheetRows();
    ok('calling openLogBP directly opens nothing for him', forced.hasBpInput !== true, forced.h2);
    /* The refusal moved from pregJourneyCanWrite's generic "the person whose journey this is" to
       pregHealthCanWrite, which NAMES her: "Only Maya can add to her health record". That is better
       copy, so this asserts the capability rather than the old sentence: a refusal must be spoken,
       and it must say whose the record is. Matching the literal would have failed correct code and
       tempted the next person to revert the better wording to make a gate go green. */
    const said = (await page.evaluate(() => window.__toasts.slice())).join(' ');
    ok('and it says why rather than failing silently', said.trim().length > 0, said);
    ok('and the refusal says whose record it is', /\bMaya\b|\bhers\b|her health record/i.test(said), said);

    /* The sheet already open when ownership resolves. She opens it, the snapshot lands, he presses
       Save. A row-only gate passes everything above and loses this. */
    await signIn(MAYA, 'owner');
    await page.evaluate(() => openLogBP());
    await sleep(250);
    ok('as her, the sheet is up', (await sheetRows()).hasBpInput === true);
    await signIn(SAM, 'caregiver', ['health', 'careteam']);
    await saveReading(140, 95);
    ok('his save writes nothing to her record', await bpCount() === 1, await bpCount());
    ok('and her one shared reading is untouched', await page.evaluate(() => state.pregnancy.bp[0].sys) === 118);
  }

  console.log('\n8. a partner she shared nothing with sees nothing');
  {
    await load(seed(born({ bp: [{ id: 'x1', at: now - 2 * DAY, sys: 118, dia: 76 }] })));
    await signIn(SAM, 'caregiver', []);
    const rec = await open('openPregRecord');
    ok('no readings section at all', !/blood pressure reading/i.test(rec.txt), rec.txt.slice(0, 300));
    ok('no row', bpRows(rec).length === 0, rec.rows.map((r) => r.a));
    ok('and it says the details are hers', /private to her/i.test(rec.txt), rec.txt.slice(0, 300));
  }

  console.log('\n9. a record whose bp array never arrived');
  {
    // applyMatDoc folds whatever keys the mhealth doc carried. A journey from before this field, or
    // a fold that ran before the health category loaded, leaves p.bp undefined. ensurePregFields
    // does not create it, so the push used to throw on the one screen that has to work.
    const p = born(); delete p.bp;
    await load(seed(p));
    await signIn(MAYA, 'owner');
    ok('p.bp really is missing', await page.evaluate(() => state.pregnancy.bp === undefined), await page.evaluate(() => state.pregnancy.bp));
    const set = await open('openSettings');
    ok('the row still renders', bpRows(set).length === 1, set.rows.map((r) => r.a));
    await tapRow('openLogBP');
    ok('the sheet still opens', (await sheetRows()).hasBpInput === true);
    await saveReading(120, 78);
    ok('and the reading lands', await bpCount() === 1, await bpCount());
  }

  console.log('\n10. a household with no pregnancy record at all');
  {
    /* The commonest path of all, in showBirthArrival's own words: she signed up with the baby
       already here. It is also byte-for-byte what endPregnancy leaves behind. Settings was the only
       surface this section checked, and Settings was never the one that broke. */
    await load(seed(null));
    await signIn(SAM, 'owner');
    const set = await open('openSettings');
    ok('Settings still renders', set.rows.length >= 4, set.rows.length);
    ok('no blood pressure row', bpRows(set).length === 0, set.rows.map((r) => r.a));

    ok('the teaching layer does not offer her a door she has not got', await teachSees() === false);
    const ht = await howtoIndex();
    ok('the how-to index opens', ht.open === true);
    ok('it has real sections in it, so the next lines are not an empty guide', ht.heads.length >= 3, ht.heads);
    ok('no pregnancy section for a household that has never been pregnant', ht.heads.indexOf('While you are expecting') === -1 && ht.heads.indexOf('From your pregnancy, still yours') === -1, ht.heads);
    ok('and no blood pressure row anywhere in it', ht.labels.indexOf('Blood pressure') === -1, ht.labels);

    /* And the door itself, called past every row, the way a stale render or a deep link would.
       pregIsOwner() answers true when there is no pregnancy, so the ownership guard alone let this
       through and saveBP threw TypeError on state.pregnancy.bp with the sheet still open. */
    await page.evaluate(() => { closeSheet(); window.__toasts = []; });
    await sleep(250);
    await page.evaluate(() => openLogBP());
    await sleep(250);
    ok('calling openLogBP directly opens nothing', (await sheetRows()).hasBpInput !== true);
    /* Then the reviewer's reproduction exactly: real numbers typed into whatever is on screen and
       the real Save button pressed. saveReading returns false rather than throwing when the sheet is
       not up, so this measures saveBP's behaviour and not the harness's. Without the guard the sheet
       WAS up, and saveBP threw TypeError on state.pregnancy.bp from inside the click handler: sheet
       still open, no toast, nothing saved, and an uncaught error the parent never sees. */
    const before = errs.length;
    await saveReading(120, 78);
    await sleep(300);
    ok('and pressing Save throws nothing at her', errs.length === before, errs.slice(before, before + 2));
    ok('with nothing invented to hold it', await page.evaluate(() => state.pregnancy) === null);
  }

  console.log('\n11. the sheet keeps its info dot in the baby stage');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    const vis = await page.evaluate(() => ({
      stage: (window.cubbyTeachCtx && window.cubbyTeachCtx() || {}).stage,
      visible: (window.CubbyTeach && window.CubbyTeach.visible() || []).indexOf('openLogBP') >= 0,
    }));
    ok('the teaching layer sees her in the baby stage', vis.stage === 'baby', vis);
    ok('and still offers the blood pressure row there', vis.visible === true, vis);
    await open('openSettings');
    await tapRow('openLogBP');
    const sheet = await sheetRows();
    // Named, so a run where the row never opened cannot pass this on the dot Settings already has.
    ok('the blood pressure sheet is the one on screen', /^Blood pressure/.test((sheet.h2 || '').trim()), sheet.h2);
    ok('and it carries its "i"', sheet.dot === true, sheet.h2);
    // The dot must open THIS row's explainer. A dot is a promise about what it explains.
    const dotFn = await page.evaluate(() => { const b = document.querySelector('#sheet h2 .lg-i'); return b ? b.getAttribute('onclick') : ''; });
    ok('and the "i" explains blood pressure, not whatever sheet was last matched', /openLogBP/.test(dotFn || ''), dotFn);
  }

  console.log('\n12. the how-to index names the group for the reader in front of it');
  {
    /* The failure two reviewers reproduced. Widening who.stage to reach the baby stage made
       CubbyTeach.visible() offer this row there, and the how-to index renders one section per
       domain with a fixed name. So a woman nine days postpartum, searching the guide for "blood
       pressure" because she has been told to check it for a fortnight, was told she is expecting,
       on the line directly above one saying she is not. */
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    ok('the teaching layer offers her the row here', await teachSees() === true);
    const ht = await howtoIndex();
    ok('the how-to index opens', ht.open === true);
    ok('the row is in it', ht.labels.indexOf('Blood pressure') >= 0, ht.labels);
    ok('nothing tells a woman who has given birth that she is expecting', ht.heads.indexOf('While you are expecting') === -1, ht.heads);
    ok('the group is named for where she is now', ht.heads.indexOf('From your pregnancy, still yours') >= 0, ht.heads);
    ok('and the answer itself does not contradict the heading', /still counts in the weeks after a birth/i.test(ht.txt), ht.txt.slice(0, 400));

    // The other half of the same heading: while she IS expecting, the group keeps its own name.
    await load(seed(expecting()));
    await signIn(MAYA, 'owner');
    const hp = await howtoIndex();
    ok('a pregnant woman still reads "While you are expecting"', hp.heads.indexOf('While you are expecting') >= 0, hp.heads);
    ok('and the row is still hers during the pregnancy', hp.labels.indexOf('Blood pressure') >= 0, hp.labels);
    ok('the teaching layer still offers it antenatally', await teachSees() === true);
  }

  console.log('\n13. the door closes, and nothing is left on screen without its explainer');
  {
    /* The gate had no scenario past nine days, so "the sheet keeps its info dot in the baby stage"
       was proven for a newborn and false from eighteen months on, for a row that was still drawn:
       quickStage() turns 'child' at 18 months and visible() dropped the row while Settings and the
       record went on offering it. The door now closes at twelve weeks, which is what every line of
       copy on it says, so the row is never on screen in a stage that cannot explain it. */
    const old = born({ birthAt: now - 800 * DAY, bornBabyId: 'b1' });
    await load(seed(old, { babies: [{ id: 'b1', name: 'Robin', birth: now - 800 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    await signIn(MAYA, 'owner');
    ok('her child is well past the baby stage', await page.evaluate(() => quickStage()) === 'child', await page.evaluate(() => quickStage()));
    const set = await open('openSettings');
    ok('Settings renders for her', set.rows.length >= 4, set.rows.length);
    ok('no blood pressure row two years on', bpRows(set).length === 0, set.rows.map((r) => r.a));
    const rec = await open('openPregRecord');
    ok('her record still opens', /pregnancy record/i.test(rec.h2), rec.h2);
    ok('no Log a reading row in it either', bpRows(rec).length === 0, rec.rows.map((r) => r.a));
    ok('and no empty Readings section invented for a door that is shut', !/blood pressure still matters/i.test(rec.txt), rec.txt.slice(0, 320));
    ok('the record is a keepsake again, and says so', /kept exactly as it was/i.test(rec.txt), rec.txt.slice(0, 200));
    ok('the teaching layer does not offer it either', await teachSees() === false);
    const ht = await howtoIndex();
    ok('and no orphan pregnancy section in her guide', ht.heads.indexOf('While you are expecting') === -1 && ht.heads.indexOf('From your pregnancy, still yours') === -1, ht.heads);

    // The boundary itself, from both sides, so the window is a decision and not an accident.
    await load(seed(born({ birthAt: now - 83 * DAY })));
    await signIn(MAYA, 'owner');
    ok('twelve weeks minus a day: still open', bpRows(await open('openSettings')).length === 1);
    await load(seed(born({ birthAt: now - 85 * DAY })));
    await signIn(MAYA, 'owner');
    ok('twelve weeks and a day: shut', bpRows(await open('openSettings')).length === 0);
  }

  console.log('\n14. while the door is open the record admits it, and the row reads like the house');
  {
    await load(seed(born()));
    await signIn(MAYA, 'owner');
    const rec = await open('openPregRecord');
    /* The empty state said "If your team asked you to keep an eye on it" in the paragraph and then
       again, verbatim, in the row three lines under it. Once, in the row. */
    ok('the reason is given once, not twice', (rec.txt.match(/if your team asked you to keep an eye on it/gi) || []).length === 1, rec.txt.slice(0, 400));
    ok('the paragraph says where a reading goes', /whatever you add stays here with the rest of your record/i.test(rec.txt), rec.txt.slice(0, 400));
    ok('and the sheet does not promise it asks nothing while it carries a write door', !/kept exactly as it was/i.test(rec.txt), rec.txt.slice(0, 200));
    ok('it still promises nothing is asked of her', /nothing here asks anything of you/i.test(rec.txt), rec.txt.slice(0, 200));

    // The house separator. Every neighbouring row sub uses a middot: "Week 36 · Thursday, Jul 23".
    await load(seed(born({ bp: [{ id: 'x1', at: now - 3 * 3600000, sys: 118, dia: 74 }] })));
    await signIn(MAYA, 'owner');
    const b = (bpRows(await open('openSettings'))[0] || {}).b || '';
    ok('the row separates the number from the day with a middot', /^Last reading 118\/74 · /.test(b), b);
    ok('and no comma left behind', b.indexOf('118/74,') === -1, b);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-BP-ROW: FAIL' : 'PREG-BP-ROW: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
