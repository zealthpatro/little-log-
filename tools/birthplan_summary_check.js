#!/usr/bin/env node
/* The one document written to be handed to somebody else had no hand-over in it.
 *
 * A birth plan is written for a day she cannot explain it out loud. teach-data.js:607 says so in
 * those words: "something you or your partner can hand over". And there was no way to hand it over.
 * openBirthPlan was a textarea and a Save button: the text went into the pregnancy doc and stayed
 * there. The only door out of the app was the Pro doctor report, which spends her single free pdf
 * taste and carries her whole antenatal record with it, so getting four sentences about skin to
 * skin to the person who will be in the room meant sending him her blood pressure readings too, or
 * retyping the lot into a message.
 *
 * And pregVisitSummary, which assembles ten sections for exactly that visit, touched neither the
 * birth plan nor the bag. So the report handed over at 40 weeks said what her Hb was in week 28 and
 * nothing at all about what she wants to happen.
 *
 * The bag was nine generic lines that missed the two things the teach copy itself advertises, a
 * going-home outfit one size up and snacks for the birth partner, and it was one flat list, which
 * is not how a bag is packed or how anybody else finds a thing in it at midnight.
 *
 * WHAT THIS ASSERTS, and why each is here rather than assumed.
 *   - the plan on the report is GATED, on the same health gate openPregRecord uses. A caregiver
 *     who was never shown her health details must not meet them through the report instead, and
 *     "he does not see the plan" is asserted beside a COUNT of the sections he does get, because a
 *     summary that failed to build also contains no birth plan.
 *   - THE SEND ROW ITSELF IS GATED on that same predicate, and this is asserted on the rendered
 *     sheet and not on the summary string. An earlier draft of this gate guarded the report and
 *     never the new door: it signed a caregiver in WITH health access, asserted he could send, and
 *     scored identically with the leak present and with it fixed. A caregiver she never gave health
 *     access to can read this sheet, which is older than this change; a one-tap outbound export of
 *     her plan on it would not be.
 *   - NOBODY BUT HER WRITES. saveBirthPlan and the three bag mutators are tapped as a caregiver and
 *     her stored plan and her stored ticks are read back. A journey doc is hers; a local write is
 *     wiped by the next snapshot, so a save that says it worked is a lie told at the worst moment.
 *   - the Send row is there THE FIRST TIME SHE WRITES A PLAN. The sheet HTML is built once at open,
 *     so a row rendered from the saved plan is absent for the whole of the first write, which is the
 *     moment the hand-over exists for.
 *   - the report carries the count and WHAT IS PACKED, and not what is left. Asserted as an absence
 *     of the unpacked item names, beside the count, so a report that failed to build cannot pass it.
 *   - the share sends the PLAN AND NOTHING ELSE. Asserted as an absence of her care team and her
 *     readings in the shared string, not just a presence of the plan.
 *   - the share SPENDS NO TASTE. tasteLeft('pdf') is read before and after. A free door that
 *     quietly costs her the one free report is worse than no door.
 *   - the share sends WHAT IS ON SCREEN. She types a line and taps Send without tapping Save
 *     first; the old text going out instead is the exact failure this feature exists to avoid.
 *   - a NON-OWNER's edit is not pretended to be saved. The journey doc is his to read only, so a
 *     local write would be taken back by the next snapshot with a toast saying it worked.
 *   - the bag section knows about STAGE. Week 12 with nothing packed gets no "0 of 14 packed" nag
 *     on a report; week 12 with one thing ticked does, because that is her own signal; after the
 *     birth it goes entirely.
 *   - a BAG SAVED BEFORE THIS CHANGE is not rearranged under her. Items with no `who` render as
 *     the flat list she left, with the same rows in the same order.
 *   - p.bag can be MISSING. ensurePregFields does not create it, so the summary has to survive a
 *     record that arrived through the journey doc without one.
 *
 * SCOPE. The harness runs the app in local mode and injects window.LL by hand after boot, so
 * app/store-firebase.js never loads and firestore.rules is never evaluated. A PASS attests the
 * render and the gates are right GIVEN the ownership predicate, which is copied verbatim from
 * store-firebase.js below. It says nothing about the server side.
 *
 *   PORT=9427 node tools/serve.js &
 *   node tools/birthplan_summary_check.js http://localhost:9427
 *
 * Pass an explicit base URL. The default is deliberately NOT 8080: a live server from another
 * checkout on a shared port answers 200 and gets graded happily.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, WEEK = 7 * DAY;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

const CLOCK = (() => { const d = new Date(); d.setHours(11, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const MAYA = 'uidMaya', SAM = 'uidSam';

const PLAN = 'I would like to try without an epidural, but please offer it if I ask twice.\nSkin to skin straight away if she is well.\nSam cuts the cord.';

// A pregnancy Maya owns. `wk` is the week she is in; everything else is a real antenatal record so
// the report has other sections to be counted against.
const preg = (wk, over) => Object.assign({
  id: 'p1', ownerUid: MAYA, stage: 'expecting',
  dueDate: now + (40 - wk) * WEEK, lmp: now - wk * WEEK, cycleLen: 28, periods: [],
  country: 'uk', precon: [],
  careTeam: [{ id: 'c1', name: 'Midwife team', role: 'Midwives', phone: '+44 20 7946 0000' }],
  appts: [{ id: 'a1', week: 28, title: 'Growth scan', note: '', done: true, outcome: 'All well', hb: '11.4' }],
  symptoms: [], weights: [], bp: [{ id: 'r1', at: now - 5 * DAY, sys: 118, dia: 74 }],
  kicks: [], contractions: [], birthPlan: '', bag: [], moments: [], conditions: {},
  glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
  glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - wk * WEEK,
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

  /* Which checkout is on that port? shareBirthPlan exists only in this branch, so its absence
     means one of exactly two things and the banner says which, so a red run is never misread. */
  const marker = await page.evaluate(() => typeof window.shareBirthPlan === 'function');
  if (!marker) console.log('  [checkout] WARNING: ' + BASE + ' is serving a tree with NO shareBirthPlan.\n'
    + '             Either the change is reverted, or this port belongs to another checkout.\n'
    + '             Every assertion below is expected to fail. Check the port first.');
  else console.log('  [checkout] ' + BASE + ' is serving a tree that has shareBirthPlan. Good.');
  ok('the tree on ' + BASE + ' has the change in it', marker, marker);

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      localStorage.removeItem('cubby-pro-dev');
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    // Capture toasts and every outbound share, so "it was handed over" is a real string, not a hope.
    await page.evaluate(() => {
      window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(m); try { t(m); } catch (e) {} };
      window.__shared = null;
      window.cubbyNativeShareText = function (title, text) { window.__shared = { title: title, text: text }; return true; };
    });
    await sleep(150);
  };

  /* Sign in as somebody. matIsOwner / pregIsOwner are copied VERBATIM from store-firebase.js so the
     gate exercises the real predicate. `who` null means no cloud at all: a solo mother offline, who
     must keep everything. */
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

  const summary = () => page.evaluate(() => pregVisitSummary());

  // The open sheet as the DOM has it. innerText is the rendered screen; the inline script's own
  // source never appears in it, which document.body.textContent cannot promise.
  const sheet = () => page.evaluate(() => {
    const s = document.getElementById('sheet');
    if (!(s && s.classList.contains('show'))) return { open: false, buttons: [], secTitles: [], bagRows: [], txt: '' };
    return {
      open: true,
      readonly: !!(s.querySelector('#bpTxt') && s.querySelector('#bpTxt').hasAttribute('readonly')),
      h2: (s.querySelector('h2') || {}).textContent || '',
      // textContent, not innerText: .sec-title is uppercased by CSS and innerText reports the
      // transform, so a heading written "For the baby" would arrive as "FOR THE BABY".
      secTitles: [].slice.call(s.querySelectorAll('.sec-title')).map((e) => (e.textContent || '').trim()),
      buttons: [].slice.call(s.querySelectorAll('button')).map((e) => ({ on: e.getAttribute('onclick') || '', t: (e.textContent || '').trim() })),
      bagRows: [].slice.call(s.querySelectorAll('.bag-row')).map((e) => ({ t: (e.querySelector('.bg-t') || {}).textContent || '', done: e.classList.contains('done') })),
      // Every heading and row in document order, so grouping can be asserted as an ORDER and not
      // just as a set of headings that happen to exist somewhere on the sheet.
      flow: [].slice.call(s.querySelectorAll('.sec-title, .bag-row')).map((e) => (e.classList.contains('sec-title') ? '## ' : '- ') + ((e.querySelector('.bg-t') || e).textContent || '').trim()),
      txt: (s.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });
  const open = async (fn) => { await page.evaluate((f) => { window[f](); }, fn); await sleep(250); return sheet(); };
  const tap = async (frag) => {
    const hit = await page.evaluate((f) => {
      const b = [].slice.call(document.querySelectorAll('#sheet button')).filter((e) => (e.getAttribute('onclick') || '').indexOf(f) >= 0)[0];
      if (!b) return false; b.click(); return true;
    }, frag);
    await sleep(250); return hit;
  };

  console.log('\n1. the report carries the plan she wrote');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(MAYA, 'owner');
    const txt = await summary();
    ok('the report has a Birth plan section', /\nBirth plan:\n/.test(txt), txt.slice(-400));
    const lines = txt.split('\n');
    const i = lines.indexOf('Birth plan:');
    const body = lines.slice(i + 1, i + 4).map((s) => s.trim());
    ok('all three of her lines are on it, not just the first', body.length === 3 && body.join(' ') === PLAN.split('\n').join(' '), body);
    ok('it still carries the antenatal record it always did', /Care team: Midwife team/.test(txt) && /Blood pressure/.test(txt), txt.slice(0, 300));

    // The printable overlay, not just the string: this is what she actually hands over.
    const ov = await page.evaluate(() => {
      openPregDoctorReport();
      const o = document.getElementById('reportOv');
      return o ? (o.innerText || '').replace(/\s+/g, ' ').trim() : '';
    });
    ok('and the printed report on screen shows it', /Birth plan:/.test(ov) && /Sam cuts the cord/.test(ov), ov.slice(-300));
    await page.evaluate(() => closePregReport());
  }

  console.log('\n2. nothing written, nothing printed');
  {
    await load(seed(preg(34, { birthPlan: '   \n  ' })));
    await signIn(MAYA, 'owner');
    const txt = await summary();
    ok('an empty plan gets no heading with nothing under it', !/Birth plan/.test(txt), txt.slice(-300));
    ok('the rest of the report is there, so this is a gate and not a blank page', /Care team: Midwife team/.test(txt), txt.slice(0, 200));
  }

  console.log('\n3. it obeys the health gate she set, the same one openPregRecord uses');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(SAM, 'caregiver', ['careteam']);          // she shared the care team, not her health
    const txt = await summary();
    ok('a caregiver without health access does not meet the plan through the report', !/Birth plan/.test(txt), txt.slice(-300));
    ok('and he really did get a report, so the absence above means something', /Care team: Midwife team/.test(txt) && txt.split('\n').length > 4, txt.split('\n').length);

    /* THE DOOR, not the report. Guarding pregVisitSummary is belt-and-braces: he cannot reach the
       report anyway. The reachable surface is the sheet, one tap from his home screen at wk>=30,
       and putting a Send row on it hands him a one-tap export of a document she never shared with
       him. Asserted on the rendered sheet, with Save asserted present in the same breath so a sheet
       that failed to open cannot pass this. */
    const noHealth = await open('openBirthPlan');
    ok('a caregiver without health access is given no way to send her plan on', noHealth.open && !noHealth.buttons.some((b) => /shareBirthPlan/.test(b.on)), noHealth.buttons);
    ok('and the sheet really did open for him, so that absence is the gate and not a blank screen', noHealth.open && !!noHealth.h2 && noHealth.readonly === true,
      { open: noHealth.open, h2: noHealth.h2, buttons: noHealth.buttons.map((b) => b.on) });
    /* The control may NOT key on the plan text. The assertion above requires that exact text to
       be hidden from him, so demanding it here to prove the sheet opened contradicts the thing
       being guarded and goes red against correct code. The heading and his own controls prove
       the sheet rendered without asserting he can read what she wrote. */
    /* A box he can type into whose Save always refuses is a way to lose work: he could write out a
       whole plan and tap Save to a toast that says no. pregJourneyCanWrite already toasts, so the
       refusal was legible; what was not is that the box invited the writing in the first place. */
    ok('the box does not invite writing he can never save', noHealth.readonly === true, noHealth);
    ok('and no Save button sits under a box he cannot edit', !noHealth.buttons.some((b) => /saveBirthPlan/.test(b.on)), noHealth.buttons.map((b) => b.on));
    ok('the sheet says whose it is, in the same words the refusal uses', /Only the person whose journey this is/.test(noHealth.txt), noHealth.txt.slice(0, 200));

    await page.evaluate(() => closeSheet()); await sleep(200);

    await signIn(SAM, 'caregiver', ['careteam', 'health']); // now she has shared her health
    const txt2 = await summary();
    ok('once she shares health with him, he sees it', /Birth plan:/.test(txt2) && /Sam cuts the cord/.test(txt2), txt2.slice(-300));
    const withHealth = await open('openBirthPlan');
    ok('and the Send row comes back with it, because handing it on is his job on the day', withHealth.buttons.some((b) => /shareBirthPlan/.test(b.on)), withHealth.buttons);
    await page.evaluate(() => closeSheet()); await sleep(200);
  }

  console.log('\n4. the bag goes on the report, ticked and unticked');
  {
    const bag = [
      { id: 'g1', text: 'Maternity notes or records', done: true, who: 'you' },
      { id: 'g2', text: 'Toiletries and lip balm', done: false, who: 'you' },
      { id: 'g3', text: 'A going-home outfit, one size up', done: true, who: 'baby' },
      { id: 'g4', text: 'Car seat fitted and ready', done: false, who: 'baby' },
      { id: 'g5', text: 'Snacks and a water bottle', done: false, who: 'partner' },
    ];
    await load(seed(preg(34, { birthPlan: PLAN, bag: bag })));
    await signIn(MAYA, 'owner');
    const txt = await summary();
    ok('the report says how much of the bag is done', /Hospital bag: 2 of 5 packed/.test(txt), txt.slice(-400));
    const packed = (txt.match(/\n {2}Packed: (.+)/) || [])[1] || '';
    /* Split on · and not on a comma. Half the list has a comma inside one item, "a going-home
       outfit, one size up", so a comma-separated count is wrong before the code is. */
    ok('the packed line names exactly the two ticked things', packed.split(' · ').length === 2 && /Maternity notes/.test(packed) && /one size up/.test(packed), packed);

    /* THE ANXIETY TEST, and the reason the unpacked run came off. She is admitted at 38 weeks for
       reduced movements and prints this to hand to a midwife. Nobody in that room needs to read
       "Still to pack: Blanket or shawl", and she does not need her own document listing the things
       she has not managed. The count stays, because the count is information. Asserted against the
       item names as well as the label, so renaming the label would not slip it past. */
    ok('the report does not print her unpacked list back at her', !/Still to pack/.test(txt), (txt.match(/Hospital bag[\s\S]{0,240}/) || [])[0]);
    ok('and none of the three unpacked things is named anywhere on it', !/Toiletries and lip balm/.test(txt) && !/Car seat/.test(txt) && !/Snacks and a water bottle/.test(txt), (txt.match(/Hospital bag[\s\S]{0,240}/) || [])[0]);
    ok('while the two she did pack are still named, so this is a cut and not a broken section', /Maternity notes/.test(txt) && /one size up/.test(txt), packed);
  }

  console.log('\n5. the bag only appears when it is a real question');
  {
    const early = [{ id: 'g1', text: 'Maternity notes or records', done: false, who: 'you' },
      { id: 'g2', text: 'Car seat fitted and ready', done: false, who: 'baby' }];
    await load(seed(preg(12, { bag: early })));
    await signIn(MAYA, 'owner');
    const t1 = await summary();
    ok('at 12 weeks with nothing packed, the report does not hand her a job', !/Hospital bag/.test(t1), t1.slice(-300));
    ok('the week 12 report is otherwise a real report', /Care team: Midwife team/.test(t1), t1.slice(0, 200));

    await load(seed(preg(12, { bag: [Object.assign({}, early[0], { done: true }), early[1]] })));
    await signIn(MAYA, 'owner');
    const t2 = await summary();
    ok('but once she has started packing it follows her, whatever the week', /Hospital bag: 1 of 2 packed/.test(t2), t2.slice(-300));

    await load(seed(preg(38, { bag: early })));
    await signIn(MAYA, 'owner');
    const t3 = await summary();
    ok('and from week 30 it is there unpacked, because by then it is the question', /Hospital bag: 0 of 2 packed/.test(t3), t3.slice(-300));
  }

  console.log('\n6. after the birth the bag is a thing that happened');
  {
    const bag = [{ id: 'g1', text: 'Maternity notes or records', done: true, who: 'you' },
      { id: 'g2', text: 'Car seat fitted and ready', done: false, who: 'baby' }];
    await load(seed(preg(41, { birthPlan: PLAN, bag: bag, bornBabyId: 'b1', birthAt: now - 9 * DAY })));
    await signIn(MAYA, 'owner');
    const txt = await summary();
    ok('the postpartum report drops the bag', !/Hospital bag/.test(txt), txt.slice(-300));
    ok('and keeps the birth plan, which is part of the record now', /Birth plan:/.test(txt), txt.slice(-300));
  }

  console.log('\n7. a record with no bag at all does not break the report');
  {
    const p = preg(34, { birthPlan: PLAN });
    delete p.bag;                                   // ensurePregFields never creates it
    await load(seed(p));
    await signIn(MAYA, 'owner');
    const txt = await summary();
    ok('the report builds', /Care team: Midwife team/.test(txt) && /Birth plan:/.test(txt), txt.slice(-200));
    ok('with no bag section invented', !/Hospital bag/.test(txt), txt.slice(-200));
    ok('and no error thrown', errs.length === 0, errs.slice(0, 3));
  }

  console.log('\n8. the plan has a way out of the app');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(MAYA, 'owner');
    const s = await open('openBirthPlan');
    ok('the birth plan sheet opens', s.open && /Birth plan/.test(s.h2), s.h2);
    const share = s.buttons.filter((b) => /shareBirthPlan/.test(b.on));
    ok('it offers exactly one Send row', share.length === 1, s.buttons);
    /* "Send this to whoever will be with you" was addressed to the wrong reader twice over: her
       partner taps it too, and at 320px it wrapped to two lines with an orphan "you" on the second.
       The sheet heading already says Birth plan, so nothing is lost. */
    ok('worded for either reader, and short', ((share[0] || {}).t || '') === 'Send the plan', (share[0] || {}).t);
    ok('and Save is still the primary thing', s.buttons.some((b) => /saveBirthPlan/.test(b.on)), s.buttons.map((b) => b.on));
    const wrap = await page.evaluate(() => {
      const b = [].slice.call(document.querySelectorAll('#sheet button')).filter((e) => /shareBirthPlan/.test(e.getAttribute('onclick') || ''))[0];
      if (!b) return null;
      const cs = getComputedStyle(b), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const inner = b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      return { lines: Math.round(inner / lh), h: Math.round(b.getBoundingClientRect().height) };
    });
    await page.setViewport({ width: 320, height: 844 }); await sleep(300);
    const wrap320 = await page.evaluate(() => {
      const b = [].slice.call(document.querySelectorAll('#sheet button')).filter((e) => /shareBirthPlan/.test(e.getAttribute('onclick') || ''))[0];
      if (!b) return null;
      const cs = getComputedStyle(b), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const inner = b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      return { lines: Math.round(inner / lh), h: Math.round(b.getBoundingClientRect().height) };
    });
    await page.setViewport({ width: 390, height: 844 }); await sleep(200);
    ok('it stays on one line at 390px', wrap && wrap.lines === 1, wrap);
    ok('and on one line at 320px, the width she is most likely on', wrap320 && wrap320.lines === 1, wrap320);
  }

  console.log('\n9. the hand-over is there the FIRST time she writes a plan');
  {
    /* The sheet HTML is built once at open. A Send row rendered from state.pregnancy.birthPlan is
       therefore absent for the entire first write: she would have to Save (which closes the sheet),
       reopen, then send. The first write is the moment this feature exists for. */
    await load(seed(preg(34, { birthPlan: '' })));
    await signIn(MAYA, 'owner');
    const s = await open('openBirthPlan');
    ok('she opens an empty plan and the Send row is already there', s.open && s.buttons.some((b) => /shareBirthPlan/.test(b.on)), s.buttons);
    // And it does not send a blank message: the empty check on shareBirthPlan does that work.
    await tap('shareBirthPlan');
    const empty = await page.evaluate(() => ({ shared: window.__shared, toasts: window.__toasts.slice() }));
    ok('tapping it with nothing written sends nothing', empty.shared === null, empty.shared);
    ok('and says so, rather than doing nothing at all', empty.toasts.some((t) => /Write your plan first/i.test(t)), empty.toasts);

    // Now she types her first plan and taps Send WITHOUT saving. This is the whole flow.
    await page.evaluate((t) => { document.getElementById('bpTxt').value = t; }, PLAN);
    await tap('shareBirthPlan');
    const first = await page.evaluate(() => ({ shared: window.__shared, saved: state.pregnancy.birthPlan }));
    ok('her first plan goes out on the first tap, with no save-reopen-send dance', /Sam cuts the cord/.test((first.shared || {}).text || ''), first.shared);
    ok('and it is kept', /Sam cuts the cord/.test(first.saved || ''), first.saved);
  }

  console.log('\n10. it sends the plan, and only the plan');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(MAYA, 'owner');
    await open('openBirthPlan');
    const before = await page.evaluate(() => tasteLeft('pdf'));
    ok('she has her one free report taste in hand', before === 1, before);
    ok('the Send row is really tapped', await tap('shareBirthPlan'), 'no button');
    const r = await page.evaluate(() => ({ shared: window.__shared, left: tasteLeft('pdf'), toasts: window.__toasts.slice() }));
    ok('something was handed over', !!r.shared && (r.shared.text || '').length > 0, r.shared);
    const out = (r.shared || {}).text || '';
    ok('it is her plan, all of it', /Sam cuts the cord/.test(out) && /without an epidural/.test(out), out);
    ok('it does NOT carry her care team', out.length > 0 && !/Midwife team/.test(out), out);
    ok('it does NOT carry her readings', out.length > 0 && !/118\/74/.test(out) && !/Blood pressure/.test(out), out);
    /* No brand signature. A birth plan handed to a midwife is the wrong document to sign, and
       sharePregReport does not sign the report either, so a footer here was inconsistent as well as
       ours-not-hers. Asserted against her last line so an empty share cannot pass it. */
    ok('it ends on her words and not on ours', /Sam cuts the cord\.$/.test(out.trim()) && !/Written in Cubby/i.test(out), out.slice(-80));
    ok('and it costs her nothing: the free report taste is untouched', r.left === 1, r);
    const proUp = await page.evaluate(() => { const s = document.getElementById('sheet'); return s ? (s.innerText || '') : ''; });
    ok('the birth plan sheet is still what she is looking at', /Birth plan/.test(proUp) && !/Cubby Pro/i.test(proUp), proUp.slice(0, 120));
  }

  console.log('\n11. it sends what is in front of her, not the last save');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(MAYA, 'owner');
    await open('openBirthPlan');
    await page.evaluate((t) => { document.getElementById('bpTxt').value = t; }, PLAN + '\nNo photographs in the room.');
    await tap('shareBirthPlan');
    const r = await page.evaluate(() => ({ shared: window.__shared, saved: state.pregnancy.birthPlan }));
    ok('the line she just typed goes out', /No photographs in the room/.test((r.shared || {}).text || ''), r.shared);
    ok('and it is kept, so the box she comes back to is not older than the message she sent', /No photographs in the room/.test(r.saved || ''), r.saved);

    // A reload: the write has to have gone through persist(), not just sat in memory.
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const after = await page.evaluate(() => state.pregnancy.birthPlan);
    ok('it survives a reload', /No photographs in the room/.test(after || ''), after);
  }

  console.log('\n12. a partner sharing it is not told a lie about saving');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(SAM, 'caregiver', ['careteam', 'health']);   // the journey doc is hers, not his
    await open('openBirthPlan');
    await page.evaluate(() => { document.getElementById('bpTxt').value = 'He typed over it.'; });
    await tap('shareBirthPlan');
    const r = await page.evaluate(() => ({ shared: window.__shared, saved: state.pregnancy.birthPlan }));
    ok('he can still hand the plan on, which is the whole point of it', /He typed over it/.test((r.shared || {}).text || ''), r.shared);
    ok('but her saved plan is untouched, because his write would be wiped by the next snapshot', r.saved === PLAN, r.saved);

    /* Save was the other door into the same hole, and it was open. A caregiver tapping Save put his
       words into her plan in memory AND on disk, told him "Birth plan saved", and the next snapshot
       took it back: he believes he changed something he did not, and she may find his sentences in
       her plan in the meantime. */
    await page.evaluate(() => { document.getElementById('bpTxt').value = 'He typed over it again.'; });
    await tap('saveBirthPlan');
    const sv = await page.evaluate(() => ({
      mem: state.pregnancy.birthPlan,
      disk: (JSON.parse(localStorage.getItem('little-log-v1') || '{}').pregnancy || {}).birthPlan,
      toasts: window.__toasts.slice(),
    }));
    ok('a caregiver tapping Save does not get into her plan in memory', sv.mem === PLAN, sv.mem);
    ok('nor onto the disk under her', sv.disk === PLAN, sv.disk);
    ok('and he is told why rather than told it worked', sv.toasts.some((t) => /Only the person whose journey this is/i.test(t)) && !sv.toasts.some((t) => /Birth plan saved/i.test(t)), sv.toasts);
    await page.evaluate(() => closeSheet()); await sleep(200);
  }

  console.log('\n12b. and he does not repack her bag either');
  {
    /* Newly load-bearing: what is ticked here is what prints on the document she hands a clinician,
       so a caregiver ticking a row was editing her report. Every other journey mutator carries this
       guard; these three did not. */
    const bag = [{ id: 'g1', text: 'Maternity notes or records', done: false, who: 'you' },
      { id: 'g2', text: 'Car seat fitted and ready', done: true, who: 'baby' }];
    await load(seed(preg(34, { bag: bag })));
    await signIn(SAM, 'caregiver', ['careteam', 'health']);
    await open('openBag');
    const before = await page.evaluate(() => JSON.stringify(state.pregnancy.bag));
    await page.evaluate(() => { const r = [].slice.call(document.querySelectorAll('#sheet .bag-row')).filter((e) => /Maternity/.test(e.textContent))[0]; if (r) r.querySelector('.bg-tick').click(); });
    await sleep(250);
    await page.evaluate(() => { const el = document.getElementById('bagNew'); if (el) { el.value = 'Sam brought a football'; addBag(); } });
    await sleep(250);
    await page.evaluate(() => { const r = [].slice.call(document.querySelectorAll('#sheet .bag-row')).filter((e) => /Car seat/.test(e.textContent))[0]; if (r) r.querySelector('.bg-x').click(); });
    await sleep(250);
    const after = await page.evaluate(() => ({ bag: JSON.stringify(state.pregnancy.bag), toasts: window.__toasts.slice() }));
    ok('his tick, his added item and his delete all leave her bag exactly as she packed it', after.bag === before, [before, after.bag]);
    ok('and every one of the three said why', after.toasts.filter((t) => /Only the person whose journey this is/i.test(t)).length === 3, after.toasts);
    // The owner is not caught by the same guard: the control that makes the three above mean something.
    await signIn(MAYA, 'owner');
    await open('openBag');
    await page.evaluate(() => { const r = [].slice.call(document.querySelectorAll('#sheet .bag-row')).filter((e) => /Maternity/.test(e.textContent))[0]; r.querySelector('.bg-tick').click(); });
    await sleep(250);
    const hers = await page.evaluate(() => (state.pregnancy.bag.filter((b) => b.done).length));
    ok('but she can still tick her own bag', hers === 2, hers);
    await page.evaluate(() => closeSheet()); await sleep(200);
  }

  console.log('\n13. the full report still charges the way it always did');
  {
    await load(seed(preg(34, { birthPlan: PLAN })));
    await signIn(MAYA, 'owner');
    const r = await page.evaluate(() => {
      openPregDoctorReport();
      const before = tasteLeft('pdf');
      sharePregReport();
      return { before: before, after: tasteLeft('pdf'), shared: window.__shared, toasts: window.__toasts.slice() };
    });
    ok('the whole antenatal record still goes out on Share', /Care team: Midwife team/.test((r.shared || {}).text || ''), (r.shared || {}).text);
    ok('and it still spends the one free taste', r.before === 1 && r.after === 0, r);
    await page.evaluate(() => closePregReport());
  }

  console.log('\n14. the bag is packed by owner, the way it is unpacked');
  {
    await load(seed(preg(34)));                    // no bag seeded: confirmPositiveTest never ran here
    await signIn(MAYA, 'owner');
    const built = await page.evaluate(() => { state.pregnancy.bag = defaultBag(); persist(); openBag(); return state.pregnancy.bag.length; });
    await sleep(250);
    const s = await sheet();
    ok('the starter bag has real depth to it', built >= 12, built);
    ok('it is headed by who each thing is for, in order', s.secTitles.join('|') === 'For you|For the baby|For whoever is with you', s.secTitles);
    const heads = s.flow.filter((x) => x.indexOf('## ') === 0);
    ok('every row sits under a heading and none float free', s.flow[0].indexOf('## ') === 0 && heads.length === 3, s.flow.slice(0, 4));
    ok('the row count on screen matches the list she has', s.bagRows.length === built, [s.bagRows.length, built]);
    /* Walk the sheet in document order and hand each row to the heading above it, so what is
       asserted below is which GROUP a thing is in. "the sheet contains the word Snacks somewhere"
       was true of the flat nine-line list this replaces, and would have passed on a bag with no
       groups at all. */
    const G = {}; let cur = null;
    s.flow.forEach((x) => { if (x.indexOf('## ') === 0) { cur = x.slice(3); G[cur] = []; } else if (cur) G[cur].push(x.slice(2)); });
    ok('the going-home outfit the teach copy promises is under the baby', (G['For the baby'] || []).some((t) => /one size up/.test(t)), G['For the baby']);
    ok('the snacks are filed under whoever stays with her, not under her', (G['For whoever is with you'] || []).some((t) => /Snacks/.test(t)) && !(G['For you'] || []).some((t) => /Snacks/.test(t)), G);
    // The count is paired with the every(), because every() over no groups at all is true.
    ok('and all three groups have something in them', Object.keys(G).length === 3 && Object.keys(G).every((k) => G[k].length >= 3), G);
    ok('nothing arrives pre-ticked', s.bagRows.filter((r) => r.done).length === 0 && s.bagRows.length > 0, s.bagRows.filter((r) => r.done));

    /* The report prints these lines with the headings stripped off, so an item that leans on its
       heading arrives with the wrong antecedent: "Snacks and a water bottle for them" printed under
       a baby item reads as snacks for the baby. Every line has to stand up alone. */
    const texts = s.bagRows.map((r) => r.t);
    ok('no item leans on the heading above it to say who it is for', !texts.some((t) => /\bfor them\b|\bof their own\b|^Something to sleep on$/i.test(t)), texts.filter((t) => /them|their/i.test(t)));
    ok('the partner items read on their own', texts.indexOf('Snacks and a water bottle') >= 0 && texts.indexOf('A second phone charger') >= 0, (G['For whoever is with you'] || []));
    // "Change or a card for parking" reads first as a verb at the head of a list of things.
    ok('parking money is a noun', texts.indexOf('Coins or a card for parking') >= 0 && !texts.some((t) => /^Change or a card/.test(t)), texts.filter((t) => /parking/.test(t)));

    /* Inverted proximity, measured. .sec-title has margin-top:6px and .bag-row margin-bottom:8px,
       which COLLAPSE to 8px, so every heading sat 8px under the group above it and 12px above its
       own rows: "For the baby" belonged to the "For you" block. The hand-maintained collapse list
       in the stylesheet had never been extended with .bag-row, and the structural rule beside it is
       scoped `#scroll > .fade-in > *` so it does not reach inside a sheet. */
    const gaps = await page.evaluate(() => {
      const kids = [].slice.call(document.querySelectorAll('#sheet .sec-title, #sheet .bag-row'));
      const out = [];
      kids.forEach((el, i) => {
        if (!el.classList.contains('sec-title')) return;
        const prev = kids[i - 1], next = kids[i + 1];
        if (!prev || !next) return;
        out.push({ h: (el.textContent || '').trim(),
          above: Math.round(el.getBoundingClientRect().top - prev.getBoundingClientRect().bottom),
          below: Math.round(next.getBoundingClientRect().top - el.getBoundingClientRect().bottom) });
      });
      return out;
    });
    ok('there are headings between rows to measure', gaps.length >= 2, gaps);
    ok('every heading sits closer to its own rows than to the group above it', gaps.length >= 2 && gaps.every((g) => g.above > g.below), gaps);
  }

  console.log('\n15. a bag she packed before this change is not rearranged under her');
  {
    const old = ['Maternity notes or records', 'ID and any paperwork', 'Phone and a long charger']
      .map((t, i) => ({ id: 'o' + i, text: t, done: i === 0 }));
    await load(seed(preg(34, { bag: old })));
    await signIn(MAYA, 'owner');
    await open('openBag');
    const s = await sheet();
    ok('no headings appear over a list that never had them', s.secTitles.length === 0, s.secTitles);
    ok('the same three rows, in the same order', s.bagRows.map((r) => r.t).join('|') === old.map((o) => o.text).join('|'), s.bagRows.map((r) => r.t));
    ok('and her tick is still where she put it', s.bagRows.filter((r) => r.done).map((r) => r.t).join() === 'Maternity notes or records', s.bagRows);

    /* The contrast that makes the three above mean something. A fixture with no `who` never enters
       the grouping branch at all, so on its own this section passes with the grouping arm deleted.
       Same sheet, one item given a `who`, and the branch has to fire: headings appear, and the
       legacy items fall to the bucket at the end rather than vanishing between the groups. */
    const mixed = old.map((o, i) => (i === 1 ? Object.assign({}, o, { who: 'baby' }) : Object.assign({}, o)));
    await load(seed(preg(34, { bag: mixed })));
    await signIn(MAYA, 'owner');
    await open('openBag');
    const m = await sheet();
    ok('one grouped item is enough to turn the headings on', m.secTitles.length === 2 && m.secTitles.join('|') === 'For the baby|Yours to add', m.secTitles);
    ok('and no row is lost on the way', m.bagRows.length === 3, m.bagRows.map((r) => r.t));
    ok('the grouped one goes to its group and the two ungrouped ones stay together at the end', m.flow.join(' ') === '## For the baby - ID and any paperwork ## Yours to add - Maternity notes or records - Phone and a long charger', m.flow);
  }

  console.log('\n16. a thing she adds herself does not vanish between the groups');
  {
    await load(seed(preg(34)));
    await signIn(MAYA, 'owner');
    await page.evaluate(() => { state.pregnancy.bag = defaultBag(); persist(); openBag(); });
    await sleep(250);
    const beforeN = (await sheet()).bagRows.length;
    await page.evaluate(() => { document.getElementById('bagNew').value = 'Birth ball'; addBag(); });
    await sleep(250);
    const s = await sheet();
    ok('it is on the list', s.bagRows.some((r) => /Birth ball/.test(r.t)), s.bagRows.map((r) => r.t));
    ok('exactly one more row than before', s.bagRows.length === beforeN + 1, [beforeN, s.bagRows.length]);
    /* "Anything else" filed her own contributions as the leftovers bin, on a sheet whose subtitle
       invites her to tweak the list, and it sat 8px above the "Add an item" field label in the same
       grey uppercase register. "Yours to add" names them as hers and reads differently from the
       label under it. */
    ok('under a heading of its own rather than loose at the bottom', s.secTitles.indexOf('Yours to add') >= 0 && s.secTitles.indexOf('Anything else') < 0, s.secTitles);
    ok('and it is the last thing on the sheet, where she just put it', s.flow[s.flow.length - 1] === '- Birth ball', s.flow.slice(-3));
    const tick = await page.evaluate(() => { const r = [].slice.call(document.querySelectorAll('#sheet .bag-row')).filter((e) => /Birth ball/.test(e.textContent))[0]; r.querySelector('.bg-tick').click(); return true; });
    await sleep(250);
    const s2 = await sheet();
    ok('and it ticks like everything else', tick && s2.bagRows.filter((r) => r.done).map((r) => r.t).join() === 'Birth ball', s2.bagRows.filter((r) => r.done));
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 5));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'BIRTHPLAN-SUMMARY: FAIL' : 'BIRTHPLAN-SUMMARY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
