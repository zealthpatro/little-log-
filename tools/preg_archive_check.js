#!/usr/bin/env node
/* Starting a second pregnancy destroyed the first one's record, and then hid what was left.
 *
 * savePregnancy archived the outgoing pregnancy as five keys — id, endedAt, weeks, loss,
 * bornBabyId, moments, journey — and then replaced state.pregnancy wholesale. Everything else went
 * with it: her care team's names and phone numbers, every appointment the midwife had signed off
 * with a fundal height and a blood pressure, her blood group, her Rh, her GBS result, her birth
 * plan, every weight and BP reading she had logged for nine months. openPregRecord, the one screen
 * built to read that record, reads exactly the keys the archive dropped, and it is reachable only
 * through the look-back shell, which needs state.pregnancy.bornBabyId — so the moment the second
 * journey started, the first record was both deleted and unreachable. What survived, the moments
 * and the journey cards, had one door: openKeptMemories, called from the loss-holding screen and
 * from openExpectingSetup, neither of which a mother carrying a second baby can get to.
 * Meanwhile app/teach-data.js sells that screen with "A second pregnancy never writes over the
 * first." The most likely next event in this family's life made that sentence false.
 *
 * Fixed in three parts:
 *   1. the birth-handover archive entry carries the record, not just the keepsakes;
 *   2. blood group and Rh seed the new pregnancy, so she is not asked for facts about her own body
 *      that Cubby already had;
 *   3. the archive gets a door, in the switcher and in Settings, opening a read-only record.
 *
 * WHAT IS DELIBERATELY NOT WIDENED, so a PASS is not read as more than it is.
 *   - the LOSS archive (endPregnancy(true)). The closing sheet promises "Your health logs are
 *     cleared either way", so that entry stays memories-only and section 9 asserts it. A woman who
 *     was told her logs were cleared must not find them in a record sheet a year later.
 *   - a record that is not the viewer's. state.pregnancyArchive lands in users/{uid}, which nobody
 *     else can read, so a partner archiving HER pregnancy on HIS phone would put her care team and
 *     her readings somewhere her consent can never reach again. Section 8 asserts he gets the old
 *     keepsake-only shape.
 *   - SCOPE. The harness runs in local mode (?e2e=1, cubby-quick-uid=local) and injects window.LL
 *     by hand, so app/store-firebase.js never loads and firestore.rules is never evaluated. A PASS
 *     attests to the archive SHAPE and the doors. That users/{uid} is unreadable by the circle is
 *     read from the source (store-firebase.js:126-137), not exercised here.
 *
 *   PORT=9546 node tools/serve.js &
 *   node tools/preg_archive_check.js http://localhost:9546
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and grades that tree instead of this one.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9546';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, WEEK = 7 * DAY;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam';

/* Robin's pregnancy, over: born 60 days ago, two weeks before the due date, so the honest
   gestation is 38 weeks and not the 40 the old entry hardcoded. Everything a real record holds is
   in here, because everything a real record holds is what used to be thrown away. */
const bornPreg = (over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now - 46 * DAY, lmp: now - 326 * DAY, country: 'uk', cycleLen: 28,
  careTeam: [{ id: 'c1', name: 'City Midwives', role: 'Midwife', phone: '020 7946 0111' }],
  appts: [
    { id: 'a1', week: 28, title: 'Growth scan', note: '', done: true, at: now - 130 * DAY,
      outcome: 'All well, baby measuring on the line', sfh: 28, efw: 1500, hb: 11.5, bpSys: 118, bpDia: 74 },
    { id: 'a2', week: 36, title: 'Antenatal check', note: '', done: false, at: null },
  ],
  bloodGroup: 'O', rh: 'negative', gbs: 'positive',
  birthPlan: 'I would like the room quiet, and Sam to stay with me the whole time.',
  symptoms: [], weights: [{ id: 'w1', at: now - 120 * DAY, kg: 68 }],
  bp: [{ id: 'bp1', at: now - 90 * DAY, sys: 118, dia: 74 }],
  kicks: [], contractions: [], bag: [],
  moments: [{ id: 'm1', week: 20, at: now - 150 * DAY, note: 'First proper scan', photoId: null }],
  journey: { saved: { pj_test: { at: now - 140 * DAY, note: 'Told my mum today', title: 'Telling people' } } },
  conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: 'b1', birthAt: now - 60 * DAY, createdAt: now - 330 * DAY,
}, over || {});

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [], notes: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {},
  pregnancy: bornPreg(), pregnancyArchive: [],
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
  /* Every request goes to the server on BASE, never to app/sw.js's cache. Without this the second
     reload of a run can be answered by a service worker that cached the FIRST tree it saw, which
     is how a gate ends up grading code that is no longer on disk. */
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  /* Which checkout is on that port? openArchivedPregnancy exists only in this branch, so its
     absence means one of exactly two things and the banner says which, rather than letting a red
     run be misread as a broken feature. */
  const marker = await page.evaluate(() => typeof window.openArchivedPregnancy === 'function');
  console.log(marker
    ? '  [checkout] ' + BASE + ' is serving a tree that has openArchivedPregnancy. Good.'
    : '  [checkout] WARNING: ' + BASE + ' is serving a tree with NO openArchivedPregnancy.\n'
      + '             Either the change is reverted, or this port belongs to another checkout.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  /* Sign in as somebody. Solo by default: LL.members holds only the viewer, so
     startPregnancyAudit takes its no-other-members path and savePregnancy finishes without
     stopping to ask who may know. */
  const load = async (s, who) => {
    /* One retry, because a frame can detach under us between sections (a service-worker claim, a
       navigation the app made) and a harness that dies there reports one failure instead of the
       whole picture. The retry re-navigates rather than pretending nothing happened. */
    try {
      await page.evaluate((x) => {
        localStorage.setItem('little-log-v1', JSON.stringify(x));
        Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      }, s);
    } catch (e) {
      await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
      await page.evaluate((x) => {
        localStorage.setItem('cubby-quick-uid', 'local');
        localStorage.setItem('little-log-v1', JSON.stringify(x));
      }, s);
    }
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await attachLL(who || MAYA);
  };

  /* Signing in, as far as this harness can. Separated from load() because a reload wipes it, and
     an archive stamped with her uid is invisible to a page that no longer knows who she is — which
     is a property of the harness, not of the app: in production applyPregArchive only ever fills
     state.pregnancyArchive with a uid already in hand. */
  const attachLL = async (w) => {
    await page.evaluate((w) => {
      window.LL = window.LL || {};
      window.LL.auth = { currentUser: { uid: w } };
      window.LL.members = {}; window.LL.members[w] = 'owner';
      window.LL.memberInfo = { uidMaya: { name: 'Maya Rao', relationship: 'Mama Bear' }, uidSam: { name: 'Sam Rao', relationship: 'Papa Bear' } };
      /* Copied from store-firebase.js rather than stubbed true, so the gate exercises the real
         ownership predicate: the uid decides whenever the record names an owner. */
      window.LL.pregIsOwner = function () {
        var u = window.LL.auth.currentUser; if (!u) return true;
        var p = state.pregnancy; if (!p) return true;
        if (p.ownerUid && p.ownerUid !== 'local') return p.ownerUid === u.uid;
        return true;
      };
      window.LL.matIsOwner = window.LL.pregIsOwner;
      window.LL.matCanRead = function () { return window.LL.pregIsOwner(); };
      window.LL.pregJourneyShared = function () { return []; };
      try { window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; } catch (e) {}
    }, w);
    await sleep(200);
  };

  // Fill in the expecting sheet the way a thumb does, then tap Start tracking.
  const startSecond = async (dueMs) => {
    await page.evaluate((due) => {
      var d = new Date(due);
      var ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      openExpectingSetup('due');
      var f = document.getElementById('pgDate'); if (f) f.value = ymd;
      var c = document.getElementById('pgCountry'); if (c) c.value = 'uk';
      savePregnancy();
    }, dueMs);
    await sleep(700);
  };

  const sheet = () => page.evaluate(() => {
    var s = document.querySelector('#sheet.show');
    return {
      open: !!s,
      h2: s ? ((s.querySelector('h2') || {}).textContent || '').trim() : '',
      txt: s ? (s.innerText || '').replace(/\s+/g, ' ').trim() : '',
      rows: s ? [].slice.call(s.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }) : [],
      handlers: s ? [].slice.call(s.querySelectorAll('[onclick]')).map(function (x) { return x.getAttribute('onclick'); }) : [],
    };
  });
  const clickRow = (re) => page.evaluate((r) => {
    var rx = new RegExp(r, 'i');
    var els = [].slice.call(document.querySelectorAll('#sheet.show .set-item, #sheet.show .baby-item, #sheet.show button'));
    var el = els.filter(function (x) { return rx.test(x.innerText || ''); })[0];
    if (!el) return false;
    el.click(); return true;
  }, re.source || re);

  console.log('\n1. the second pregnancy no longer takes the first one with it');
  {
    await load(seed());
    const before = await page.evaluate(() => ({ arch: (state.pregnancyArchive || []).length, team: (state.pregnancy.careTeam || []).length }));
    ok('she starts with a finished pregnancy and an empty archive', before.arch === 0 && before.team === 1, before);
    await startSecond(now + 200 * DAY);
    const r = await page.evaluate(() => {
      const a = (state.pregnancyArchive || [])[0] || {};
      return {
        n: (state.pregnancyArchive || []).length, loss: a.loss, born: a.bornBabyId,
        liveTeam: (state.pregnancy.careTeam || []).length, livePlan: state.pregnancy.birthPlan,
        liveBorn: state.pregnancy.bornBabyId, weeks: a.weeks,
      };
    });
    ok('one entry is archived', r.n === 1, r);
    ok('and it is not filed as a loss', r.loss === false, r);
    ok('it knows which baby it became', r.born === 'b1', r);
    ok('the new pregnancy really is a fresh one (no care team carried over)', r.liveTeam === 0, r);
    ok('and no birth plan carried over', r.livePlan === '', r);
    ok('so the archive is the ONLY copy of the old record', r.liveBorn === null, r);
    ok('gestation is counted, not assumed: born two weeks early reads 38, not 40', r.weeks === 38, r);
  }

  console.log('\n2. the entry carries the record, key by key');
  {
    const a = await page.evaluate(() => (state.pregnancyArchive || [])[0] || {});
    // Every read below is guarded: on a reverted tree these keys are absent, and a gate that dies
    // on the first missing one reports a single failure instead of the whole hole.
    const ap0 = (a.appts || [])[0] || {}, ct0 = (a.careTeam || [])[0] || {};
    ok('care team, with the phone number she would actually call',
      (a.careTeam || []).length === 1 && ct0.phone === '020 7946 0111', a.careTeam);
    ok('every appointment, not only the ones she ticked', (a.appts || []).length === 2, (a.appts || []).length);
    ok('and the outcome the midwife dictated survives with it',
      ap0.outcome === 'All well, baby measuring on the line', ap0);
    ok('the numbers on that appointment survive too', ap0.sfh === 28 && ap0.bpSys === 118, ap0);
    ok('blood group', a.bloodGroup === 'O', a.bloodGroup);
    ok('Rh', a.rh === 'negative', a.rh);
    ok('GBS result', a.gbs === 'positive', a.gbs);
    ok('birth plan, whole', /Sam to stay with me the whole time/.test(a.birthPlan || ''), a.birthPlan);
    /* Whose record this is, stamped on the entry. Section 8 is the other half: a partner's copy
       carries her uid too, which is how the doors stay off his phone. */
    ok('and whose record it is', a.ownerUid === MAYA, a.ownerUid);
    ok('the readings she logged', (a.weights || []).length === 1 && (a.bp || []).length === 1, { w: a.weights, bp: a.bp });
    ok('when the baby arrived', a.birthAt === now - 60 * DAY, a.birthAt);
    ok('and the due date it was measured against', a.dueDate === now - 46 * DAY, a.dueDate);
    ok('the keepsakes still ride along: moments', (a.moments || []).length === 1, a.moments);
    ok('and the cards she wrote', Object.keys(a.journey || {}).length === 1, a.journey);
  }

  console.log('\n3. facts about her own body are not asked for twice');
  {
    const p = await page.evaluate(() => ({ bg: state.pregnancy.bloodGroup, rh: state.pregnancy.rh, gbs: state.pregnancy.gbs }));
    ok('blood group rides forward into the new pregnancy', p.bg === 'O', p);
    ok('so does Rh', p.rh === 'negative', p);
    /* GBS is a swab taken in the last weeks of EACH pregnancy. Carrying it forward would put a
       stale positive in front of a midwife as if it were this baby's result. */
    // Paired with the blood group above, so "nothing was carried at all" cannot pass as a rule.
    ok('GBS does NOT, because it is this pregnancy\'s swab and not hers forever', p.bg === 'O' && !p.gbs, p);
  }

  console.log('\n4. the door: Settings');
  {
    await page.evaluate(() => { closeSheet(); openSettings(); });
    await sleep(250);
    const s = await sheet();
    const row = s.rows.filter((x) => /earlier pregnanc/i.test(x))[0];
    ok('Settings still renders a full sheet', s.open && s.rows.length >= 6, s.rows.length);
    ok('and it now carries a row for the earlier pregnancy', !!row, s.rows);
    ok('named for one, not for many', /Your earlier pregnancy\b/.test(row || ''), row);
    /* The same row appears after a LOSS, where the archive is memories only and the closing sheet
       promised the health logs were cleared. "Kept in full" there reads as a broken promise. */
    ok('and it does not promise "in full" on a path where it may be memories only',
      /Kept, and still yours/.test(row || '') && !/Kept in full/.test(row || ''), row);
    const clicked = await clickRow(/earlier pregnanc/);
    await sleep(250);
    const l = await sheet();
    // Singular over one row, plural over two (section 16). Both doors already singularise.
    ok('tapping it opens the list', clicked && /Your earlier pregnancy/.test(l.h2) && !/pregnancies/.test(l.h2), l.h2);
    ok('with one row in it', l.rows.length === 1, l.rows);
    ok('the row is the pregnancy that became Robin', /Robin's pregnancy/.test(l.rows[0] || ''), l.rows);
    ok('and it says when, in plain words', /Born \w+ \d{4}/.test(l.rows[0] || ''), l.rows);
    ok('the list says the thing that used to be untrue', /never writes over an older one/i.test(l.txt), l.txt);
  }

  console.log('\n5. the record sheet shows her actual record');
  {
    const clicked = await clickRow(/Robin's pregnancy/);
    await sleep(250);
    const r = await sheet();
    ok('the record opens', clicked && /Your pregnancy, kept/.test(r.h2), r.h2);
    ok('it names the baby and the day', /Robin, born/.test(r.txt), r.txt);
    ok('and the gestation it counted', /at 38 weeks/.test(r.txt), r.txt);
    ok('her care team is there', /City Midwives/.test(r.txt), r.txt);
    ok('with the number', /020 7946 0111/.test(r.txt), r.txt);
    ok('the appointment she kept, with its outcome', /Growth scan/.test(r.txt) && /measuring on the line/.test(r.txt), r.txt);
    ok('the one she never ticked is not listed as kept', !/Antenatal check/.test(r.txt), r.txt);
    /* Counted and then withheld is the opposite of legible privacy: the values are in the entry and
       the health tab belongs to the CURRENT pregnancy, so this sheet is the only place left. */
    ok('her readings are shown, not just counted', /68 kg/.test(r.txt) && /118\/74 mmHg/.test(r.txt), r.txt);
    ok('and nothing is announced that she cannot open', !/\d+ weight reading/.test(r.txt), r.txt);
    ok('her antenatal record', /Blood group O/.test(r.txt) && /Rh negative/.test(r.txt) && /Group B strep positive/.test(r.txt), r.txt);
    ok('her birth plan, whole', /Sam to stay with me the whole time/.test(r.txt), r.txt);
    ok('and a way through to what she photographed', /kept memories/i.test(r.txt), r.txt);
    /* Read-only means read-only. Every handler on this sheet is on the allowlist below; add to it
       deliberately, never to make a run go green. A record of a pregnancy that is over has nothing
       to save. sheetBack and the teaching dot are the sheet's own chrome, not this screen's.
       openKeptMemories is on the list because it is a READER — but it is two taps above a button
       that empties things, so section 16 walks that path and checks what survives. */
    const stray = r.handlers.filter((h) => !/^(openKeptMemories\(|closeSheet\(|sheetBack\(|event\.stopPropagation\(\);CubbyTeachUI)/.test(h || ''));
    ok('nothing on it writes', stray.length === 0, stray);
    /* Unscoped, it flattened every archive entry, so the button on Robin's record opened a sheet
       holding a lost pregnancy's photos too, and the remove button under it took both. */
    const mem = r.handlers.filter((h) => /^openKeptMemories\(/.test(h || ''))[0];
    ok('its memories button is scoped to this pregnancy', /^openKeptMemories\('[^']+'\)$/.test(mem || ''), mem);
  }

  console.log('\n6. the door: the switcher');
  {
    await page.evaluate(() => { closeSheet(); openBabySheet(); });
    await sleep(250);
    const s = await page.evaluate(() => {
      var sh = document.querySelector('#sheet.show');
      return {
        items: [].slice.call(sh.querySelectorAll('.baby-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }),
        handlers: [].slice.call(sh.querySelectorAll('.baby-item')).map(function (x) { return x.getAttribute('onclick'); }),
      };
    });
    const i = s.items.findIndex((x) => /earlier pregnanc/i.test(x));
    ok('the switcher offers it too', i >= 0, s.items);
    ok('and it opens the archive', /openPregArchive/.test(s.handlers[i] || ''), s.handlers);
    ok('it is not confused with the current journey', s.items.filter((x) => /Your pregnancy\b/.test(x)).length === 1, s.items);
  }

  console.log('\n7. nothing appears when there is nothing kept');
  {
    await load(seed({ pregnancy: null, pregnancyArchive: [] }));
    const s = await page.evaluate(() => { openSettings(); var sh = document.querySelector('#sheet.show'); return [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }); });
    ok('Settings is otherwise fully rendered', s.length >= 6, s.length);
    ok('and carries no archive row', s.filter((x) => /earlier pregnanc/i.test(x)).length === 0, s);
    const b = await page.evaluate(() => { closeSheet(); openBabySheet(); var sh = document.querySelector('#sheet.show'); return [].slice.call(sh.querySelectorAll('.baby-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }); });
    ok('nor does the switcher', b.filter((x) => /earlier pregnanc/i.test(x)).length === 0, b);
    const e = await page.evaluate(() => { closeSheet(); openExpectingSetup('due'); return (document.querySelector('#sheet.show').innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('and the setup sheet promises nothing it has no record of', !/stays saved/i.test(e), e);
  }

  console.log('\n8. her record is not copied into somebody else\'s private doc');
  {
    /* Sam is a caregiver she shared careteam and health with, so those fields are in HIS memory
       too. If he taps "We're expecting" on his own phone, the archive lands in users/uidSam, which
       she can never read, never revoke and never delete. He keeps keepsakes only. */
    await load(seed(), SAM);
    /* Before he taps anything: the reassurance line is written for the person whose record is
       carried. On his phone the handover writes a keepsake stub, so telling him an earlier
       pregnancy "stays saved" promises exactly the thing Cubby is deliberately not doing. */
    const e0 = await page.evaluate(() => { openExpectingSetup('due'); return (document.querySelector('#sheet.show').innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('he is not promised her record "stays saved" on his phone', !/stays saved/i.test(e0), e0);
    await page.evaluate(() => closeSheet());
    await startSecond(now + 210 * DAY);
    const a = await page.evaluate(() => (state.pregnancyArchive || [])[0] || {});
    /* Every claim below is an ABSENCE, so first prove the thing that could be present exists on
       this tree at all. Otherwise a reverted build passes this whole section by doing nothing. */
    ok('the widening this section guards against exists on this tree',
      await page.evaluate(() => typeof openArchivedPregnancy === 'function'));
    ok('the entry is still written (his copy of the keepsakes)', !!a.id, a);
    ok('her care team is NOT in it', a.careTeam === undefined, a.careTeam);
    ok('her readings are NOT in it', a.bp === undefined && a.weights === undefined, { bp: a.bp, w: a.weights });
    ok('her blood group is NOT in it', a.bloodGroup === undefined, a.bloodGroup);
    ok('her birth plan is NOT in it', a.birthPlan === undefined, a.birthPlan);
    ok('the keepsake shape is unchanged from before this item', (a.moments || []).length === 1 && Object.keys(a.journey || {}).length === 1, a);
    const p = await page.evaluate(() => ({ bg: state.pregnancy.bloodGroup, rh: state.pregnancy.rh }));
    ok('and his new pregnancy is not seeded with her blood group', !p.bg && !p.rh, p);
    /* Presence, not absence: the stub is stamped with HER uid, which is the thing the doors read. */
    ok('and the stub records whose pregnancy it was', a.ownerUid === MAYA, a.ownerUid);
    const doors = await page.evaluate(() => {
      closeSheet(); openSettings();
      var sh = document.querySelector('#sheet.show');
      var set = [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); });
      closeSheet(); openBabySheet();
      sh = document.querySelector('#sheet.show');
      var sw = [].slice.call(sh.querySelectorAll('.baby-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); });
      closeSheet();
      return { set: set, sw: sw, list: (typeof pregArchiveList === 'function') ? pregArchiveList().length : -1 };
    });
    /* He must not be handed a row headed "Your earlier pregnancy" over a sheet saying "kept exactly
       as it was" about a record that is hers and that he was deliberately never given. The stub
       stays in his doc for the keepsakes he could already reach; it just is not his to be shown. */
    ok('Settings is still fully rendered for him', doors.set.length >= 6, doors.set.length);
    ok('and offers him no earlier-pregnancy row', doors.set.filter((x) => /earlier pregnanc/i.test(x)).length === 0, doors.set);
    ok('nor does the switcher', doors.sw.filter((x) => /earlier pregnanc/i.test(x)).length === 0, doors.sw);
    ok('so the archive list is empty on his device', doors.list === 0, doors.list);
  }

  console.log('\n9. a pregnancy that ended in a loss keeps its promise');
  {
    /* The closing sheet says "Your health logs are cleared either way". So the keep branch must
       archive memories and nothing else, and the archive row must open the sheet written for
       grief rather than a clinical record. */
    await load(seed({ pregnancy: bornPreg({ bornBabyId: null, birthAt: null, dueDate: now + 60 * DAY, lmp: now - 220 * DAY }), babies: [], activeBabyId: null }));
    await page.evaluate(() => { endPregnancy(true); });
    await sleep(300);
    const a = await page.evaluate(() => (state.pregnancyArchive || [])[0] || {});
    // Same reasoning as section 8: the absences below only mean something if widening is possible.
    ok('the widening this section guards against exists on this tree',
      await page.evaluate(() => typeof openArchivedPregnancy === 'function'));
    ok('the entry is filed as a loss', a.loss === true, a.loss);
    ok('her memories are kept', (a.moments || []).length === 1, a.moments);
    ok('and the cards she wrote', Object.keys(a.journey || {}).length === 1, a.journey);
    ok('her care team is cleared, as promised', a.careTeam === undefined, a.careTeam);
    ok('her readings are cleared, as promised', a.bp === undefined && a.weights === undefined, { bp: a.bp, w: a.weights });
    ok('her blood group is cleared, as promised', a.bloodGroup === undefined, a.bloodGroup);
    const l = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return { rows: [], handlers: [] };
      openPregArchive();
      var sh = document.querySelector('#sheet.show'); if (!sh) return { rows: [], handlers: [], h2: '', txt: '' };
      return { rows: [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }),
        handlers: [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return x.getAttribute('onclick'); }),
        h2: ((sh.querySelector('h2') || {}).textContent || '').trim(),
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('it is listed, so it is not lost again', l.rows.length === 1, l.rows);
    ok('with no birth language on it', l.rows.length === 1 && !/Born /.test(l.rows[0] || ''), l.rows);
    ok('and it opens the sheet written for it, not a record sheet', /openKeptMemories/.test(l.handlers[0] || ''), l.handlers);
    /* Scoped to this entry. Unscoped, the row on her miscarriage opened a sheet that flattened the
       whole archive, so a second-time mother tapping it was shown her living child's 20-week scan. */
    ok('scoped to this pregnancy, not to every pregnancy she has had',
      /^openKeptMemories\('[^']+'\)$/.test(l.handlers[0] || ''), l.handlers);
    // The teaching dot lives inside the h2, so match on the words rather than on the whole string.
    ok('one row, so the heading does not say pregnancies',
      /Your earlier pregnancy/.test(l.h2) && !/pregnancies/.test(l.h2), l.h2);
    /* "Starting a new one never writes over an older one" defends a promise that only matters while
       there is another pregnancy in play. Here it is the app raising her next one, unprompted. */
    ok('and it does not raise her next pregnancy while she is looking at this one',
      !/never writes over an older one/i.test(l.txt), l.txt);
    const e = await page.evaluate(() => { closeSheet(); openExpectingSetup('due'); return (document.querySelector('#sheet.show').innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('and the next setup sheet does not tell her an earlier pregnancy "stays saved"', !/stays saved/i.test(e), e);
  }

  console.log('\n10. said before she taps the button that used to destroy it');
  {
    await load(seed());
    const e = await page.evaluate(() => { openExpectingSetup('due'); return (document.querySelector('#sheet.show').innerText || '').replace(/\s+/g, ' ').trim(); });
    ok('the setup sheet says the earlier pregnancy stays', /Your earlier pregnancy stays saved/.test(e), e);
    ok('and that this one will not write over it', /never writes over it/.test(e), e);
  }

  console.log('\n11. two of them, and a reload');
  {
    // The first handover, then a second baby, then a third pregnancy.
    await startSecond(now + 200 * DAY);
    await page.evaluate(() => { state.pregnancy.bornBabyId = 'b2'; state.pregnancy.birthAt = Date.now() - 5 * 86400000; state.pregnancy.dueDate = Date.now() - 5 * 86400000; state.babies.push({ id: 'b2', name: 'Wren', birth: Date.now() - 5 * 86400000, routines: [], doctors: [], allergies: [] }); persist(); });
    await startSecond(now + 250 * DAY);
    const two = await page.evaluate(() => (state.pregnancyArchive || []).map(function (a) { return { id: a.id, born: a.bornBabyId, at: a.endedAt }; }));
    ok('both are kept', two.length === 2, two);
    ok('newest first', two.length === 2 && two[0].born === 'b2' && two[1].born === 'b1', two);
    /* A real reload, through the app's own boot, not a re-render. The state has to be written to
       storage by hand first: app/store-firebase.js:2155 replaces persist() with the cloud pusher
       for every boot including this one, so nothing this session wrote reached localStorage. In
       production the equivalent is applyPregArchive, which fills state.pregnancyArchive from
       users/{uid} BEFORE the first paint. What this asserts is the part the harness can honestly
       reach: the doors are rendered from state at boot, not from something savePregnancy happened
       to leave in memory. */
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(state)));
    await page.evaluate((s) => { localStorage.setItem('little-log-v1', JSON.stringify(s)); }, snap);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    /* Sign back in. Production never reaches this screen signed out: applyPregArchive fills
       state.pregnancyArchive from users/{uid} and needs the uid to do it. Without this the page
       is nobody, myUid() is 'local', and entries stamped with her uid are correctly hidden from
       a viewer the app cannot identify — a harness artefact, not an app bug. */
    await attachLL(MAYA);
    const after = await page.evaluate(() => {
      openBabySheet();
      var sh = document.querySelector('#sheet.show');
      return { n: (state.pregnancyArchive || []).length,
        items: [].slice.call(sh.querySelectorAll('.baby-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }) };
    });
    ok('they survive the reload', after.n === 2, after.n);
    ok('the switcher now says pregnancies, plural', after.items.filter((x) => /Your earlier pregnancies/.test(x)).length === 1, after.items);
    const list = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return [];
      openPregArchive();
      var sh = document.querySelector('#sheet.show'); if (!sh) return [];
      return [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); });
    });
    ok('both are openable', list.length === 2, list);
    ok('each named for its own baby', /Wren/.test(list[0] || '') && /Robin/.test(list[1] || ''), list);
  }

  console.log('\n12. no number is invented when the record cannot support one');
  {
    /* An older entry, or a handover where the birth time was never written, must not print a
       gestation. Cubby saying "at 40 weeks" about a baby born at 34 is the kind of small lie that
       makes a mother stop trusting the whole record. */
    await load(seed({
      pregnancy: null,
      pregnancyArchive: [{ id: 'old1', endedAt: now - 400 * DAY, weeks: 40, loss: false, bornBabyId: 'bX',
        moments: [{ id: 'm9', week: 12, at: now - 500 * DAY, note: 'The first one', photoId: null }], journey: {} }],
    }));
    const r = await page.evaluate(() => {
      if (typeof openPregArchive !== 'function') return { h2: '(no archive door on this tree)', txt: '' };
      openPregArchive();
      var row = document.querySelectorAll('#sheet.show .set-item')[0]; if (row) row.click();
      var sh = document.querySelector('#sheet.show'); if (!sh) return { h2: '(no sheet)', txt: '' };
      return { h2: ((sh.querySelector('h2') || {}).textContent || '').trim(), txt: (sh.innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('the old-shape entry still opens', /Your pregnancy, kept/.test(r.h2), r.h2);
    // Both of these are absence claims, so each is paired with "the sheet is really open and full".
    ok('it claims no gestation', r.txt.length > 40 && !/at \d+ weeks/.test(r.txt), r.txt);
    ok('it invents no care team or readings', r.txt.length > 40 && !/care team|reading/i.test(r.txt), r.txt);
    ok('it says plainly what it has', /kept before Cubby saved the whole record/i.test(r.txt), r.txt);
    ok('and still reaches the photos', /kept memories/i.test(r.txt), r.txt);
    /* The old writer set endedAt to prev.birthAt, so the day IS on the entry and the list row above
       prints it. Reading only birthAt made the row say "Born June 2026" and the sheet it opened say
       "born a while ago" one tap later. */
    ok('it says when, from the date the entry does carry', /Born \w+ \d+, \d{4}/.test(r.txt), r.txt);
    ok('and never "a while ago" while the day is sitting on the entry', !/a while ago/.test(r.txt), r.txt);

    /* The other half of the same mistake, the other way round: a brand-new-shape entry from a
       mother who simply never added a care team. The apology fired on EMPTINESS, so the lightest
       tracker was told Cubby saved this "before it saved the whole record" in the same breath as
       "kept exactly as it was". Both cannot be true, and the first reading at 3am is that Cubby
       dropped her pregnancy. */
    await load(seed({ pregnancy: null, pregnancyArchive: [{
      id: 'bare1', ownerUid: MAYA, endedAt: now - 30 * DAY, birthAt: now - 30 * DAY,
      dueDate: now - 30 * DAY, weeks: 40, loss: false, bornBabyId: 'b1',
      careTeam: [], appts: [], bloodGroup: null, rh: null, gbs: null, birthPlan: '',
      weights: [], bp: [], glucose: [], urine: [], moments: [], journey: {} }] }));
    const bare = await page.evaluate(() => {
      if (typeof openArchivedPregnancy !== 'function') return '(no record sheet on this tree)';
      openArchivedPregnancy('bare1');
      var sh = document.querySelector('#sheet.show'); return sh ? (sh.innerText || '').replace(/\s+/g, ' ').trim() : '(no sheet)';
    });
    ok('a new-shape entry with nothing logged still opens', /Robin, born/.test(bare), bare);
    ok('and is NOT told Cubby saved it before it saved the whole record', !/before Cubby saved the whole record/i.test(bare), bare);
    ok('it says the true thing instead', /Nothing else was logged in this one/.test(bare), bare);
  }

  console.log('\n13. the headings still find their teaching row');
  {
    /* Forking a heading is invisible in a diff and silently deletes the sheet's "i": sheetDot
       matches the sheet's own <h2> against the label in teach-data.js and returns the html
       untouched when it cannot. This is that invariant, asserted directly. */
    const r = await page.evaluate(() => {
      var norm = function (s) {
        return String(s || '').toLowerCase()
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
          .replace(/&amp;/g, '&').replace(/[^a-z0-9 &]/g, '').replace(/\s+/g, ' ').trim();
      };
      var rows = (window.CubbyTeachData || {}).rows || {};
      var out = { listH2: '', recH2: '', listDot: 0, recDot: 0 };
      if (typeof openPregArchive !== 'function') { out.missing = true; return out; }
      /* The dot is injected INTO the h2, so strip it before comparing, and count it separately:
         its presence is the proof the heading matched a row at runtime. */
      var head = function () {
        var h = document.querySelector('#sheet.show h2'); if (!h) return ['', 0];
        var c = h.cloneNode(true);
        var dots = c.querySelectorAll('.lg-i');
        [].forEach.call(dots, function (x) { x.parentNode.removeChild(x); });
        return [norm(c.textContent), dots.length];
      };
      openPregArchive();
      out.listH2 = head()[0]; out.listDot = head()[1];
      closeSheet();
      openArchivedPregnancy(((state.pregnancyArchive || [])[0] || {}).id);
      out.recH2 = head()[0]; out.recDot = head()[1];
      closeSheet();
      out.listLabel = norm((rows.openPregArchive || {}).label);
      /* The list heading singularises over one row, so the label alone can no longer be the test.
         aka is how teach-ui.js:471 actually resolves it, by substring, and that is what is
         asserted here — the dot count below is the proof it resolved at runtime. */
      out.listAka = ((rows.openPregArchive || {}).aka || []).map(norm);
      out.recLabel = norm((rows.openArchivedPregnancy || {}).label);
      out.recordLabel = norm((rows.openPregRecord || {}).label);
      return out;
    });
    ok('the list heading matches its row, by label or aka',
      !!r.listH2 && (r.listH2 === r.listLabel || (r.listAka || []).some((x) => x && r.listH2.indexOf(x) !== -1)), r);
    ok('the record heading matches its row', r.recH2 && r.recH2 === r.recLabel, r);
    ok('and does not collide with the live record sheet', !!r.recLabel && !!r.recordLabel && r.recLabel !== r.recordLabel, r);
    ok('so both sheets actually carry their teaching dot', r.listDot === 1 && r.recDot === 1, r);
    /* These two lines ship inside "How to use Cubby". "open-able" is not a word, "in order" is
       developer shorthand for newest first, and "in full" claims more than the sheet delivers. */
    const teach = await page.evaluate(() => {
      var rows = (window.CubbyTeachData || {}).rows || {};
      return { a: (rows.openPregArchive || {}).one || '', b: (rows.openArchivedPregnancy || {}).one || '' };
    });
    ok('the list teach line is written in English', !!teach.a && !/open-able|, in order/i.test(teach.a), teach.a);
    ok('and the record teach line does not overclaim "in full"', !!teach.b && !/in full/i.test(teach.b), teach.b);
  }

  console.log('\n14. a bad id does not strand her');
  {
    const r = await page.evaluate(() => {
      closeSheet();
      if (typeof openArchivedPregnancy !== 'function') return '(no record sheet on this tree)';
      openArchivedPregnancy('nope');
      var sh = document.querySelector('#sheet.show'); if (!sh) return '(no sheet)';
      return ((sh.querySelector('h2') || {}).textContent || '').trim();
    });
    ok('it falls back to the list rather than an empty sheet', /Your earlier pregnanc(y|ies)/.test(r), r);
  }

  console.log('\n15. gestation is counted in completed weeks, the way it is spoken');
  {
    /* Math.round turned a baby born 23 days before her due date — 36+5, preterm — into "37 weeks",
       which is the term threshold. Cubby recording a preterm birth as term is the app getting her
       birth story wrong, in the one screen built to keep it exactly as it was. */
    await load(seed({ pregnancy: bornPreg({ birthAt: now - 23 * DAY, dueDate: now }) }));
    await startSecond(now + 200 * DAY);
    const pre = await page.evaluate(() => ((state.pregnancyArchive || [])[0] || {}).weeks);
    ok('23 days early is 36 completed weeks, not 37', pre === 36, pre);
    const rec = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return '(no archive door on this tree)';
      openPregArchive();
      var row = document.querySelectorAll('#sheet.show .set-item')[0]; if (row) row.click();
      var sh = document.querySelector('#sheet.show'); return sh ? (sh.innerText || '').replace(/\s+/g, ' ').trim() : '(no sheet)';
    });
    ok('and the sheet prints what was counted', /at 36 weeks/.test(rec), rec);
    ok('it never prints the term threshold for a preterm birth', !/at 37 weeks/.test(rec), rec);
    /* Sign check, so 36 cannot pass by the arithmetic running backwards. */
    await load(seed({ pregnancy: bornPreg({ birthAt: now + 9 * DAY, dueDate: now }) }));
    await startSecond(now + 200 * DAY);
    const post = await page.evaluate(() => ((state.pregnancyArchive || [])[0] || {}).weeks);
    ok('nine days over still reads 41', post === 41, post);
  }

  console.log('\n16. "Remove these memories" takes the memories, and only the memories');
  {
    /* Four taps from Settings used to run state.pregnancyArchive=[], which persist() pushes as a
       whole-field overwrite of users/{uid} (store-firebase.js:1449) — gone on every device, for
       good. That was honest while the array held nothing but photos and cards. This item is what
       put her care team's phone number, her blood group, her Rh, her GBS result and her birth plan
       in there, and the confirm sheet still says only "your kept photos and notes". So this is the
       assertion the widening owes: the record survives its own keepsake button. */
    await load(seed());
    await startSecond(now + 200 * DAY);
    await page.evaluate((t) => {
      state.pregnancy = null;
      state.pregnancyArchive.push({ id: 'loss1', endedAt: t, weeks: 11, loss: true,
        moments: [{ id: 'ml', week: 9, at: t, note: 'The only picture', photoId: null }], journey: {} });
      persist(); render();
    }, now - 300 * DAY);
    const list = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return [];
      openSettings();
      var el = [].slice.call(document.querySelectorAll('#sheet.show .set-item'))
        .filter(function (x) { return /earlier pregnanc/i.test(x.innerText || ''); })[0];
      if (el) el.click();
      var sh = document.querySelector('#sheet.show');
      return sh ? [].slice.call(sh.querySelectorAll('.set-item')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); }) : [];
    });
    ok('she has a birth record and a loss, both listed', list.length === 2, list);
    ok('and the heading is plural for two', await page.evaluate(() => /Your earlier pregnancies/.test((document.querySelector('#sheet.show h2') || {}).textContent || '')));
    const lossSheet = await page.evaluate(() => {
      var el = [].slice.call(document.querySelectorAll('#sheet.show .set-item'))
        .filter(function (x) { return /What you kept/i.test(x.innerText || ''); })[0];
      if (el) el.click();
      var sh = document.querySelector('#sheet.show');
      return sh ? (sh.innerText || '').replace(/\s+/g, ' ').trim() : '(no sheet)';
    });
    ok('tapping the loss row opens what she kept from THAT pregnancy', /The only picture/.test(lossSheet), lossSheet);
    ok('and not her living daughter\'s 20-week scan', !/First proper scan/.test(lossSheet), lossSheet);
    ok('nor the card she wrote in that other pregnancy', !/Told my mum today/.test(lossSheet), lossSheet);
    // Two taps: "Remove these memories", then "Remove them" on the confirm sheet.
    const tapped = await page.evaluate(() => {
      var b = [].slice.call(document.querySelectorAll('#sheet.show button'))
        .filter(function (x) { return /Remove these memories/i.test(x.innerText || ''); })[0];
      if (!b) return false; b.click(); return true;
    });
    await sleep(200);
    const confirmed = await page.evaluate(() => {
      var b = [].slice.call(document.querySelectorAll('#sheet.show button'))
        .filter(function (x) { return /^Remove them$/i.test((x.innerText || '').trim()); })[0];
      if (!b) return false; b.click(); return true;
    });
    await sleep(400);
    const after = await page.evaluate(() => (state.pregnancyArchive || []).map(function (a) {
      return { id: a.id, loss: a.loss, team: (a.careTeam || []).length, bg: a.bloodGroup,
        plan: a.birthPlan, appts: (a.appts || []).length, moments: (a.moments || []).length };
    }));
    ok('both taps landed', tapped && confirmed, { tapped: tapped, confirmed: confirmed });
    ok('the archive is NOT emptied', after.length === 1, after);
    ok('the loss entry, which was only ever memories, is gone as she asked', !after.filter((x) => x.loss).length, after);
    ok('her birth record survives', after.length === 1 && after[0].loss === false, after);
    ok('with her care team still on it', (after[0] || {}).team === 1, after);
    ok('her blood group', (after[0] || {}).bg === 'O', after);
    ok('her appointments', (after[0] || {}).appts === 2, after);
    ok('and her birth plan, whole', /Sam to stay with me the whole time/.test((after[0] || {}).plan || ''), after);
    /* Now the same button from the record's own sheet: the record must survive its own keepsakes. */
    const rec2 = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return '(no archive door on this tree)';
      openPregArchive();
      var row = document.querySelectorAll('#sheet.show .set-item')[0]; if (row) row.click();
      var b = [].slice.call(document.querySelectorAll('#sheet.show button'))
        .filter(function (x) { return /kept memories/i.test(x.innerText || ''); })[0];
      if (!b) return 'no memories button';
      b.click();
      var sh = document.querySelector('#sheet.show');
      return sh ? (sh.innerText || '').replace(/\s+/g, ' ').trim() : '(no sheet)';
    });
    ok('the record sheet reaches its own keepsakes', /First proper scan|The cards you wrote/.test(rec2), rec2);
    await page.evaluate(() => {
      var b = [].slice.call(document.querySelectorAll('#sheet.show button'))
        .filter(function (x) { return /Remove these memories/i.test(x.innerText || ''); })[0];
      if (b) b.click();
    });
    await sleep(200);
    await page.evaluate(() => {
      var b = [].slice.call(document.querySelectorAll('#sheet.show button'))
        .filter(function (x) { return /^Remove them$/i.test((x.innerText || '').trim()); })[0];
      if (b) b.click();
    });
    await sleep(400);
    const end = await page.evaluate(() => {
      var a = (state.pregnancyArchive || [])[0] || {};
      return { n: (state.pregnancyArchive || []).length, moments: (a.moments || []).length,
        journey: Object.keys(a.journey || {}).length, team: (a.careTeam || []).length,
        bg: a.bloodGroup, plan: a.birthPlan };
    });
    ok('the photos and the cards go, as the sheet said they would', end.moments === 0 && end.journey === 0, end);
    ok('and the record is still there afterwards', end.n === 1 && end.team === 1 && end.bg === 'O', end);
    ok('birth plan intact', /Sam to stay with me the whole time/.test(end.plan || ''), end);
    const still = await page.evaluate(() => {
      closeSheet();
      if (typeof openPregArchive !== 'function') return { rows: -1, txt: '' };
      openPregArchive();
      var sh = document.querySelector('#sheet.show'); if (!sh) return { rows: -1, txt: '' };
      return { rows: [].slice.call(sh.querySelectorAll('.set-item')).length,
        txt: (sh.innerText || '').replace(/\s+/g, ' ').trim() };
    });
    ok('so the door still opens onto her record', still.rows === 1, still);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PREG-ARCHIVE: FAIL' : 'PREG-ARCHIVE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
