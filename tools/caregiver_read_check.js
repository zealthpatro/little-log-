#!/usr/bin/env node
/* A caregiver could see what he was never given, and export the whole household.
 *
 * Cubby's wedge is private-within-shared, and it has to be LEGIBLE: she chooses, per category,
 * what her partner sees of her pregnancy (MAT_CATS in app/store-firebase.js: health, careteam,
 * conditions, and mood which is hers forever). Four screens read that record without ever asking.
 *
 *  1. pregRecentLogs printed her weights, her blood pressure and her symptoms under "Recent, from
 *     Maya" with no pregCanSee gate at all. Four rows further down the same screen said "These
 *     health details are private to her." A screen that shows private data while CLAIMING it is
 *     private is worse than either mistake on its own: she reads that line and believes it.
 *
 *  2. openPregDoctorReport had no gate whatsoever. The health check sat on ONE of its four doors
 *     (renderPregCare's button), which made it decorative: openVisitPrep drew the same button
 *     unconditionally, openPregRecord drew a third, and ?go=doctorreport (PREG_GO) routes straight
 *     into the function. A partner with no health consent got her blood pressure, her glucose, her
 *     weight, her symptoms, her flagged conditions and her obstetrician's mobile number on one
 *     page, with Share and Print on top, so it could leave his phone entirely.
 *
 *  3. pregDoctorCard put her obstetrician's name and a live tel: link on the partner's HOME screen
 *     whatever she had chosen, on the same account whose Care tab was correctly hiding that very
 *     section. careTeam is MAT_CATS.careteam.
 *
 *  4. exportData handed a non-guardian caregiver the entire household record in one tap and with no
 *     confirmation: every feed, every photo BYTE (out.photoData embeds them), the pregnancy, the
 *     lot. A nanny walking off with the family record is a different act from a parent taking their
 *     own copy, and only the second one is a data-portability right.
 *
 * The fix gates the READS, not the buttons, because a door reached another way must not leak: the
 * checks live in pregRecentLogs, pregVisitSummary, openPregDoctorReport, pregDoctorCard and
 * exportData themselves, and the buttons ask the same predicate (pregReportCanSee) so nobody is
 * shown a control that will refuse them. A partner's copy of those keys also SURVIVES a revoke
 * (applyMatDoc folds them into state.pregnancy and persist() writes them to his device; the
 * permission-denied that follows a revoke clears nothing), so the render is the only thing that can
 * stop it.
 *
 * Every absence assertion below is paired with a presence assertion on the same screen, because
 * "her weight is not on this page" passes for free on a page that failed to render. Nothing asserts
 * on document.body.textContent: that string contains the inline script's own source, so it can
 * match a check against the code that implements it and pass a screen that never drew.
 *
 *   PORT=19288 node tools/serve.js &
 *   node tools/caregiver_read_check.js http://localhost:19288
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:19288';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam', NINA = 'uidNina';

/* Her record, mid third trimester, with one reading in every category the consent screen names, so
   a leak in any single category is visible as a distinct string on the page. */
const preg = () => ({
  ownerUid: MAYA, stage: 'pregnant', country: 'UK',
  dueDate: now + 70 * DAY, lmp: now - 210 * DAY,
  bloodGroup: 'O', rh: '+',
  weights: [{ id: 'w1', at: now - 2 * DAY, kg: 68.4, unit: 'kg' }],
  bp: [{ id: 'p1', at: now - 1 * DAY, sys: 128, dia: 84 }],
  glucose: [{ id: 'g1', at: now - 4 * DAY, val: 5.4 }],
  symptoms: [{ id: 's1', at: now - 3 * DAY, kind: 'Heartburn', note: 'after dinner' }],
  careTeam: [{ name: 'Dr Anita Shah', role: 'Obstetrician', phone: '+44 7700 900123' }],
  conditions: { gdm: true },
  appts: [{ id: 'a1', week: 28, title: 'Growth scan', when: now + 5 * DAY, timed: 1, place: "St Mary's" }],
  visitQs: [],
});

/* NO baby, deliberately. With a baby on file the app boots into baby mode and pregGo('care') never
   reaches the pregnancy Care tab, so every "her weight is not on his screen" passes on the nursery
   home screen instead. That is the exact free pass the paired presence assertions exist to catch,
   and it caught this: the first run of this gate failed 15 on the presence half while every absence
   half went green. A household expecting its first is also the household these defects describe. */
const seed = (p, over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [], notes: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: p,
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
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  /* WHICH CHECKOUT is on that port? A dead server exits 2, but a live server belonging to another
     agent's tree answers 200 and gets graded happily. pregReportCanSee is created by this change,
     so its absence means one of exactly two things and the banner says which, so a red run is never
     misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.pregReportCanSee === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has pregReportCanSee. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO pregReportCanSee.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.\n'
      + '             Every gate assertion below is expected to fail. Check the port first.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => {
      window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); };
      // exportData ends at saveFile(); stubbing it is how we tell "refused" from "downloaded".
      window.__saved = []; window.__realSaveFile = window.saveFile;
      window.saveFile = function (u, n) { window.__saved.push(n); };
    });
    await sleep(200);
  };

  /* Sign somebody in. matIsOwner / pregIsOwner are copied VERBATIM from store-firebase.js so the
     gate exercises the real predicate and not a stub of its own invention: the uid decides when the
     record has an ownerUid, and the household role decides only for a legacy record that never got
     one. matCanRead mirrors the real one: the owner sees everything, everyone else sees exactly the
     categories in `mr`.
     pregIsOwner matters as much as matIsOwner here. Leave it out and pregJourneyIsOwner() falls
     back to true, the Care tab draws its whole write half, and the run silently grades a screen the
     partner never sees. */
  const signIn = (who, role, matRead) => page.evaluate((w, r, mr) => {
    window.LL = window.LL || {};
    window.LL.auth = { currentUser: { uid: w } };
    window.LL.role = r;
    window.LL.members = { uidMaya: 'owner', uidSam: 'caregiver', uidNina: 'caregiver' };
    window.LL.memberInfo = {
      uidMaya: { name: 'Maya Rao', relationship: 'Mama Bear', role: 'owner' },
      uidSam: { name: 'Sam Rao', relationship: 'Papa Bear', role: 'caregiver' },
      uidNina: { name: 'Nina Costa', relationship: 'Nanny', role: 'caregiver' },
    };
    window.LL.pregIsOwner = function () {
      var u = window.LL.auth.currentUser; if (!u) return true;
      var p = state.pregnancy; if (!p) return true;
      if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
      return window.LL.role === 'owner';
    };
    window.LL.matIsOwner = window.LL.pregIsOwner;
    window.LL.matCanRead = function (c) {
      if (window.LL.matIsOwner()) return true;
      if (c === 'mood') return false;            // hers forever, exactly as the real one
      return (mr || []).indexOf(c) >= 0;
    };
    window.LL.pregJourneyShared = function () { return [w]; };
  }, who, role, matRead || []);

  const care = () => page.evaluate(() => {
    pregGo('care');
    const s = document.getElementById('scroll');
    const rows = [].slice.call(s.querySelectorAll('.log-list-item'));
    return {
      // innerText is the rendered screen. body.textContent would carry the inline script's source.
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      handlers: [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')),
      /* The care-team row reuses .log-list-item, so a bare count of that class conflates two
         sections that answer to two different consents. Count the reading icons pregRecentLogs
         actually emits (symptom / weight / blood pressure) and count the care-team rows apart. */
      readingRows: rows.filter((e) => /📝|⚖️|🩺/.test(((e.querySelector('.lli-ico') || {}).textContent) || '')).length,
      teamRows: rows.filter((e) => /👩‍⚕️/.test(((e.querySelector('.lli-ico') || {}).textContent) || '')).length,
    };
  });
  /* pregGo, not go: `go` is the baby app's router and is a no-op while the pregnancy shell is up, so
     calling it leaves the previous pregnancy view on screen. An earlier run of this gate read the
     Care tab, found the care-team row's "Dr Anita Shah" on it and graded that as the Home card. */
  const home = () => page.evaluate(() => {
    pregGo('home');
    const s = document.getElementById('scroll');
    return {
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
      tels: [].slice.call(s.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute('href')),
      cards: s.querySelectorAll('.next-appt').length,
    };
  });
  const report = () => page.evaluate(() => {
    var old = document.getElementById('reportOv'); if (old) old.remove();
    window.__toasts = [];
    openPregDoctorReport();
    var ov = document.getElementById('reportOv');
    return {
      open: !!ov,
      txt: ov ? (ov.innerText || '').replace(/\s+/g, ' ') : '',
      // The read itself, independent of the overlay: this is what a deep link would print.
      summary: (typeof pregVisitSummary === 'function') ? pregVisitSummary() : 'NOFN',
      toasts: window.__toasts.slice(),
    };
  });
  const wires = (r, fn) => r.handlers.filter((h) => h.indexOf(fn) >= 0).length;

  // ---------------------------------------------------------------------------------------------
  console.log('\n1. her own record is untouched (the control: none of this is about hiding it from HER)');
  {
    await load(seed(preg()));
    await signIn(MAYA, 'owner', []);
    const c = await care();
    ok('she is the owner', await page.evaluate(() => pregIsOwner()) === true);
    ok('her three readings are on her Care tab', c.readingRows === 3, c.readingRows);
    ok('and her care team is on it too', c.teamRows === 1, c.teamRows);
    ok('her weight is there', /68\.4/.test(c.txt), c.txt.slice(0, 160));
    ok('her blood pressure is there', /128\/84/.test(c.txt));
    ok('her symptom is there', /Heartburn/.test(c.txt));
    ok('and she is offered the doctor report', wires(c, 'openPregDoctorReport') === 1, c.handlers.filter((h) => /DoctorReport/.test(h)));
    const r = await report();
    ok('the report opens for her', r.open === true, r.toasts);
    ok('with her blood pressure', /128\/84/.test(r.txt));
    ok('her glucose', /5\.4/.test(r.txt));
    ok('her weight', /68\.4/.test(r.txt));
    ok('her care team', /Dr Anita Shah/.test(r.txt));
    ok('and her flagged condition, in words a clinician reads', /Flagged: Gestational diabetes/.test(r.txt), (r.txt.match(/Flagged:[^·]*/) || [''])[0]);
    const h = await home();
    ok('her doctor is one tap away on Home', /Dr Anita Shah/.test(h.txt));
    ok('with a real phone link', h.tels.length === 1, h.tels);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n2. the partner she has NOT shared health with (defect 1: the screen that lied)');
  {
    await load(seed(preg()));
    await signIn(SAM, 'caregiver', []);          // she has shared nothing
    const c = await care();
    ok('he is not the owner', await page.evaluate(() => pregIsOwner()) === false);
    ok('no reading rows at all', c.readingRows === 0, c.readingRows);
    ok('and her care team is gone from the Care tab too', c.teamRows === 0, c.teamRows);
    ok('her weight is not on his screen', !/68\.4/.test(c.txt), c.txt.slice(0, 200));
    ok('nor her blood pressure', !/128\/84/.test(c.txt));
    ok('nor her symptom', !/Heartburn/.test(c.txt));
    ok('nor the "Recent, from" heading over an empty list', !/Recent, from/i.test(c.txt));
    /* Paired presence, three ways: the screen DREW, it kept the part he was invited to, and it says
       whose the rest is. Without these, every absence above passes on a blank page. */
    ok('the screen still rendered', c.txt.length > 200, c.txt.length);
    ok('he still has the appointment he is driving her to', /Growth scan/.test(c.txt));
    ok('and the screen says whose the rest is', /private to her/i.test(c.txt));
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n3. the doctor report, from every door (defect 10: the gate was on one of four)');
  {
    const c = await care();
    ok('the Care tab offers him no report button', wires(c, 'openPregDoctorReport') === 0, c.handlers.filter((h) => /DoctorReport/.test(h)));

    // Door two: the visit-prep sheet drew its own copy of the same button unconditionally.
    const vp = await page.evaluate(() => {
      openVisitPrep('a1');
      const s = document.getElementById('sheet');
      return {
        open: !!(s && s.classList.contains('show')),
        txt: (s.innerText || '').replace(/\s+/g, ' '),
        reportBtns: [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick')).filter((h) => /openPregDoctorReport/.test(h)).length,
      };
    });
    ok('the visit-prep sheet opened', vp.open === true);
    ok('and it still shows him the visit', /Growth scan/.test(vp.txt), vp.txt.slice(0, 160));
    ok('but offers no report there either', vp.reportBtns === 0, vp.reportBtns);

    // Door three: the function itself, which is where ?go=doctorreport (PREG_GO) lands.
    await page.evaluate(() => closeSheet());
    const r = await report();
    ok('reaching the function directly opens nothing', r.open === false, r.txt.slice(0, 200));
    ok('and it says so out loud rather than doing nothing', r.toasts.length === 1, r.toasts);
    ok('naming her, not refusing blankly', /private to Maya/i.test(r.toasts[0] || ''), r.toasts);

    // Door four: the read. Gate the source, so a surface we have not thought of cannot print it.
    ok('the summary itself carries no blood pressure', !/128\/84/.test(r.summary), String(r.summary).slice(0, 200));
    ok('no glucose', !/5\.4/.test(r.summary));
    ok('no weight', !/68\.4/.test(r.summary));
    ok('no symptom', !/Heartburn/.test(r.summary));
    ok('no care team phone number', !/7700 900123/.test(r.summary));
    ok('and no flagged condition', !/Flagged/.test(r.summary));
    ok('while the summary is still a real document', String(r.summary).length > 40 && /Week 30/.test(r.summary), String(r.summary).slice(0, 120));
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n4. one consent does not open the rest (health shared, care team and conditions not)');
  {
    await signIn(SAM, 'caregiver', ['health']);
    const c = await care();
    ok('now he sees the three readings she shared', c.readingRows === 3, c.readingRows);
    ok('her weight is there', /68\.4/.test(c.txt));
    ok('but still not her care team', c.teamRows === 0, c.teamRows);
    ok('and the report button comes back', wires(c, 'openPregDoctorReport') === 1, c.handlers.filter((h) => /DoctorReport/.test(h)));
    const r = await report();
    ok('the report opens', r.open === true, r.toasts);
    ok('with the health she shared', /128\/84/.test(r.txt) && /68\.4/.test(r.txt), r.txt.slice(0, 200));
    ok('but not her obstetrician', !/Dr Anita Shah/.test(r.txt), (r.txt.match(/Care team:[^·]*/) || [''])[0]);
    ok('nor his phone number', !/7700 900123/.test(r.txt));
    ok('nor her flagged condition', !/Flagged/.test(r.txt));
    ok('and the delete bins stay hers alone', await page.evaluate(() => document.querySelectorAll('#scroll .lli-x').length) === 0);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n5. her care team on his HOME screen (qa-circle defect 4)');
  {
    await signIn(SAM, 'caregiver', []);          // nothing shared
    let h = await home();
    ok('her obstetrician is not on his home screen', !/Dr Anita Shah/.test(h.txt), h.txt.slice(0, 200));
    ok('and neither is a live phone link to him', h.tels.length === 0, h.tels);
    /* Not replaced by the owner-only prompt either: "Add your doctor or midwife" sent a partner to a
       Care tab that has no care-team section and no add button on it. */
    ok('nor an add prompt that goes nowhere for him', !/Add your doctor/i.test(h.txt));
    ok('while his home screen still rendered', h.txt.length > 200 && /Growth scan|week|Week/.test(h.txt), h.txt.length);

    await signIn(SAM, 'caregiver', ['careteam']);
    h = await home();
    ok('once she shares the care team, it is there', /Dr Anita Shah/.test(h.txt), h.txt.slice(0, 200));
    ok('with the phone link she meant him to have', h.tels.length === 1, h.tels);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n6. the nanny cannot export the household (qa-settings defect 1)');
  {
    /* Guardians are Maya (owner) and Sam ("Papa Bear" matches GUARDIAN_WORDS). Nina is "Nanny":
       a real caregiver, in the circle, and not a guardian. */
    await signIn(NINA, 'caregiver', []);
    const g = await page.evaluate(() => ({ guardians: householdGuardians(), amG: isGuardian() }));
    ok('the household has two guardians', g.guardians.length === 2, g.guardians);
    ok('and the nanny is not one of them', g.amG === false, g);

    const d = await page.evaluate(() => {
      window.__toasts = []; window.__saved = [];
      openDataSheet();
      const s = document.getElementById('sheet');
      const handlers = [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      return {
        open: !!(s && s.classList.contains('show')),
        txt: (s.innerText || '').replace(/\s+/g, ' '),
        exportWired: handlers.filter((h) => /requestExport|exportData/.test(h)).length,
        rows: s.querySelectorAll('.set-item').length,
      };
    });
    ok('her data sheet opened', d.open === true);
    ok('with no export control on it', d.exportWired === 0, d.txt.slice(0, 240));
    /* Read-only row rather than a hidden one: she can see the door exists and whose it is. A control
       that silently refuses on the tap would be worse; one that is simply absent is worse still,
       because then the promise is unreadable. */
    ok('the export row is still visible, and says whose it is', /Export data/.test(d.txt) && /stays with/.test(d.txt), d.txt.slice(0, 240));
    ok('naming the guardians', /Mama Bear/.test(d.txt) && /Papa Bear/.test(d.txt), d.txt.slice(0, 240));
    ok('and the sheet still has its other rows', d.rows >= 3, d.rows);

    const e = await page.evaluate(() => {
      window.__toasts = []; window.__saved = [];
      exportData();                                  // the door reached another way
      return { saved: window.__saved.slice(), toasts: window.__toasts.slice() };
    });
    ok('calling the function directly downloads nothing', e.saved.length === 0, e.saved);
    ok('and it explains rather than failing silently', e.toasts.length === 1, e.toasts);
    ok('naming who holds the copy', /stays with/.test(e.toasts[0] || ''), e.toasts);
  }

  // ---------------------------------------------------------------------------------------------
  console.log('\n7. a guardian taking her own family\'s copy is untouched');
  {
    await signIn(MAYA, 'owner', []);
    const d = await page.evaluate(() => {
      window.__toasts = []; window.__saved = [];
      openDataSheet();
      const s = document.getElementById('sheet');
      const handlers = [].slice.call(s.querySelectorAll('[onclick]')).map((e) => e.getAttribute('onclick'));
      const txt = (s.innerText || '').replace(/\s+/g, ' ');
      exportData();
      return { exportWired: handlers.filter((h) => /requestExport/.test(h)).length, txt, saved: window.__saved.slice(), toasts: window.__toasts.slice() };
    });
    ok('she is a guardian', await page.evaluate(() => isGuardian()) === true);
    ok('the export row is a live control for her', d.exportWired === 1, d.exportWired);
    ok('and it actually downloads', d.saved.length === 1 && /cubby-export/.test(d.saved[0]), d.saved);
    ok('the sheet no longer claims export waits for consent', !/with consent/i.test(d.txt), (d.txt.match(/Export data[^]{0,90}/) || [''])[0]);
    ok('it says the copy is hers whenever she wants it', /yours whenever you want it/i.test(d.txt), d.txt.slice(0, 260));
    ok('and deleting still asks both guardians', /both guardians must agree/i.test(d.txt), d.txt.slice(0, 300));

    /* A solo mother has no second guardian, and the sheet used to tell her erasing "asks both
       guardians (usually mama and papa) to agree" while her own Guardians row said "you". */
    await page.evaluate(() => { closeSheet(); window.LL.members = { uidMaya: 'owner' }; });
    const solo = await page.evaluate(() => {
      openDataSheet();
      const s = document.getElementById('sheet');
      return { gs: householdGuardians().length, txt: (s.innerText || '').replace(/\s+/g, ' ') };
    });
    ok('a solo mother is the only guardian', solo.gs === 1, solo.gs);
    ok('and the sheet stops inventing a second one', !/both guardians must agree/i.test(solo.txt), solo.txt.slice(0, 300));
    ok('saying plainly that erasing happens straight away', /only guardian/i.test(solo.txt) && /straight away/i.test(solo.txt), solo.txt.slice(0, 300));
    ok('while her own copy is still hers to take', /yours to do whenever you like/i.test(solo.txt), solo.txt.slice(0, 300));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CAREGIVER_READ: FAIL' : 'CAREGIVER_READ: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
