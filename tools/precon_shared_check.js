#!/usr/bin/env node
/* The trying stage gave a partner nothing to do, and pretended it was privacy.
 *
 * WHAT WAS WRONG FOR A REAL PARENT. renderPlanningPartnerHome showed a non-carrier exactly three
 * things: a privacy explainer, a READ-ONLY preparation checklist, and two articles. The list is
 * folic acid, a dentist check, easing off alcohol — it carries no health data at all, it was
 * already being rendered to him, and he could not touch one line of it. He could not tick the
 * dentist appointment he booked, and he could not add the one thing he was actually responsible
 * for. Every other trying-stage function is carrier-gated or owner-gated, so the stage meant to be
 * done by two people contained nothing two people could do together, and the only thing he could
 * see was the only thing he could not do.
 *
 * The reason it was read-only was real: firestore.rules let only the journey's OWNER write that
 * document, so a caregiver-partner's tick would sit locally, never sync, and snap back on the next
 * snapshot. So this ships as one change on both sides. The rules now allow a member the journey is
 * shared with to write the single field data.precon and nothing else, the store writes that one
 * field path, and the client goes read-only again the moment a write is genuinely refused instead
 * of offering a tick that will vanish by itself.
 *
 * WHAT THIS GATE REFUSES TO LET BACK IN
 *   - a partner handed a read-only list (the original bug)
 *   - a partner handed a tick that does not hold (the reason it was read-only)
 *   - the checklist moving to the circle-shared app blob, where a nanny and a grandmother would
 *     learn that someone is trying to conceive: the audience must stay the sharedWith[] she chose
 *   - "done" with no name on a list two people work through
 *   - attribution noise on the screen of a woman preparing on her own
 *
 *   PORT=9683 node tools/serve.js &
 *   node tools/precon_shared_check.js http://localhost:9683
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9683';
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 09:00, an ordinary weekday morning. Nothing here is time-sensitive; the clock is pinned so the
// same run gives the same answer on any machine at any hour.
const CLOCK = (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();

const PRECON = () => ([
  { id: 'pc1', text: 'Take folic acid, 400 micrograms daily', done: false },
  { id: 'pc2', text: 'Check your vitamin D', done: false },
  { id: 'pc3', text: 'Book a preconception chat if you have a health condition', done: false },
]);

// A trying-stage journey owned by MAMA. `pregnancy` never rides the shared blob any more, but the
// seed is what the local Store reads, which is how ?e2e=1 stands a stage up without a network.
const seed = (over) => Object.assign({
  babies: [], activeBabyId: null, events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [],
  pregnancy: { id: 'pg1', stage: 'planning', ownerUid: 'uidMama', cycleLen: 28, precon: PRECON(), moments: [], conditions: {}, guesses: [] },
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
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  /* Who is holding the phone. ?e2e=1 has no Firestore, so the circle is stood up by hand: the same
     window.LL surface index.html actually reads (auth.currentUser.uid, members, memberInfo,
     pregIsOwner, pregJourneyShared, preconCanWrite). `denied` is the one thing the cloud tells the
     client that a seed cannot: the store sets it after a write is genuinely refused. */
  const asPerson = async (uid, opts) => {
    await page.evaluate((u, o) => {
      window.LL = {
        auth: { currentUser: { uid: u } },
        role: o.role || 'caregiver',
        members: { uidMama: 'owner', uidPapa: 'caregiver', uidNana: 'caregiver' },
        memberInfo: { uidMama: { name: 'Maya', relationship: 'Mama Bear' }, uidPapa: { name: 'Sam', relationship: 'Papa Bear' }, uidNana: { name: 'Ruth', relationship: 'Nana Bear' } },
        pregIsOwner: function () { return (state.pregnancy && state.pregnancy.ownerUid) === u; },
        pregJourneyShared: function () { return (o.shared || []).slice(); },
        preconCanWrite: function () {
          const p = state.pregnancy; if (!p) return true;
          if (!p.ownerUid || p.ownerUid === 'local' || p.ownerUid === u) return true;
          return !o.denied;
        },
      };
      render();
    }, uid, opts || {});
    await sleep(300);
  };

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
  };

  // The real rows on the real screen, read out of the DOM. Never document.body.textContent: it
  // contains this app's own inline source, so every string in the file "passes".
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#scroll .bag-row')).map((r) => ({
    text: (r.querySelector('.bg-t > div') ? r.querySelector('.bg-t > div').textContent : (r.querySelector('.bg-t') || {}).textContent || '').trim(),
    done: r.classList.contains('done'),
    tickTaps: !!(r.querySelector('.bg-tick') && r.querySelector('.bg-tick').getAttribute('onclick')),
    // The tap belongs to the text line, NOT to the whole .bg-t: the attribution sits in there too,
    // and reading who ticked a thing must not be the same gesture as un-ticking it.
    textTaps: !!(r.querySelector('.bg-t > div') && r.querySelector('.bg-t > div').getAttribute('onclick')),
    wholeCellTaps: !!(r.querySelector('.bg-t') && r.querySelector('.bg-t').getAttribute('onclick')),
    hasBin: !!r.querySelector('.bg-x'),
    sub: r.querySelector('.bg-sub') ? r.querySelector('.bg-sub').textContent.trim() : null,
  })));
  // Click a real element by CSS path inside a row. Returns false when it is not there, so a
  // reverted build fails the assertion instead of throwing and skipping the rest of the run.
  const clickIn = (i, sel) => page.evaluate((n, s) => {
    const r = document.querySelectorAll('#scroll .bag-row')[n];
    const el = r && r.querySelector(s);
    if (!el) return false;
    el.click(); return true;
  }, i, sel);
  const subs = () => page.evaluate(() => Array.from(document.querySelectorAll('#scroll .greeting-sub')).map((x) => x.textContent.trim()).join(' | '));
  // Returns false rather than throwing when the row or its tick is not there, so a reverted build
  // produces failures the run can report instead of a stack trace that hides the rest of the gate.
  const clickRow = (i) => page.evaluate((n) => {
    const r = document.querySelectorAll('#scroll .bag-row')[n];
    const t = r && r.querySelector('.bg-tick');
    if (!t) return false;
    t.click(); return true;
  }, i);

  console.log('\n1. the partner: a checklist he can actually work');
  {
    await load(seed());
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    const r = await rows();
    ok('all three preparation rows render for him', r.length === 3, r.map((x) => x.text));
    ok('and every one of them is tappable', r.length === 3 && r.every((x) => x.tickTaps && x.textTaps), r);
    /* NOT a bin on her items. Ticking is shared, removing is not: a caregiver who can make a line
       she wrote disappear for everyone with one tap on an 8px target, no confirm, no undo and no
       trace, is a worse product than the read-only list this replaced. */
    ok('but not one bin on the items she wrote', r.length === 3 && r.every((x) => !x.hasBin), r);
    const box = await page.evaluate(() => !!document.querySelector('#scroll #pcNew'));
    ok('he gets the "Add your own" box the carrier has always had', box === true);
    const dead = await page.evaluate(() => { removePrecon('pc1'); return (state.pregnancy.precon || []).map((i) => i.id); });
    ok('and calling the remove handler on her item directly still changes nothing', dead.length === 3 && dead[0] === 'pc1', dead);
    const sub = await subs();
    ok('the copy invites him in rather than describing her list', /together/i.test(sub) && !/you'll see it move/i.test(sub), sub);
  }

  console.log('\n2. his tick holds, is stored, and is stamped with him');
  {
    await clickRow(0);
    await sleep(250);
    const r = await rows();
    const st = await page.evaluate(() => state.pregnancy.precon.map((i) => ({ id: i.id, done: !!i.done, by: i.by || null })));
    ok('the row is ticked on screen', !!r[0] && r[0].done === true, r[0]);
    ok('and ticked in the record', !!st[0] && st[0].done === true, st);
    ok('the tick is stamped with the person who made it', !!st[0] && st[0].by === 'uidPapa', st);
    ok('and the other two are untouched', st.filter((i) => i.done).length === 1, st);
    ok('the row now says who ticked it', !!r[0] && r[0].sub === 'ticked by you', r[0]);
    // Reading who did it and undoing it must not be one gesture.
    const tapped = await clickIn(0, '.bg-sub');
    await sleep(250);
    const after = await page.evaluate(() => !!state.pregnancy.precon[0].done);
    ok('the attribution line itself is not a tap target', tapped === true && after === true, { tapped, after });
    const r2 = await rows();
    ok('and the tap does not sit on the whole cell either', !!r2[0] && r2[0].wholeCellTaps === false, r2[0]);
  }

  console.log('\n3. she sees his name on it, not a bare tick');
  {
    await asPerson('uidMama', { role: 'owner', shared: ['uidPapa'] });
    const r = await rows();
    ok('the same row is ticked on her screen', !!r[0] && r[0].done === true, r[0]);
    ok('and it names him rather than saying nothing', !!r[0] && r[0].sub === 'ticked by Papa Bear', r[0]);
    ok('the rows she has not touched carry no attribution line', r.slice(1).length === 2 && r.slice(1).every((x) => x.sub === null), r);
    ok('it is still her journey, so she keeps a bin on every row', r.length === 3 && r.every((x) => x.hasBin), r);
  }

  console.log('\n4. un-ticking removes the name as well as the tick');
  {
    await clickRow(0);
    await sleep(250);
    const st = await page.evaluate(() => state.pregnancy.precon[0]);
    const r = await rows();
    ok('the row is no longer done', !!st && st.done === false && !!r[0] && r[0].done === false, st);
    ok('and no longer claims anybody ticked it', !!st && st.by === undefined && !!r[0] && r[0].sub === null, st);
  }

  console.log('\n4b. a name that has left the circle degrades to "someone", it does not vanish');
  {
    /* loggerName returns '' for a uid nobody remembers. Everywhere else in the app that reads
       "edited by someone" / "deleted by someone"; dropping the whole line instead would quietly
       turn a tick somebody else made into a tick with no author. */
    await load(seed({ pregnancy: { id: 'pg1', stage: 'planning', ownerUid: 'uidMama', cycleLen: 28, moments: [], conditions: {}, guesses: [], precon: [{ id: 'pc1', text: 'Take folic acid, 400 micrograms daily', done: true, by: 'uidGone' }] } }));
    await asPerson('uidMama', { role: 'owner', shared: ['uidPapa'] });
    const r = await rows();
    ok('a tick from someone no longer in the circle still says a person did it', r.length === 1 && r[0].sub === 'ticked by someone', r);
  }

  console.log('\n5. a woman preparing on her own gets no attribution noise');
  {
    await load(seed());
    await asPerson('uidMama', { role: 'owner', shared: [] });
    await clickRow(0);
    await sleep(250);
    const r = await rows();
    const st = await page.evaluate(() => state.pregnancy.precon[0]);
    ok('her tick still saves', !!st && st.done === true && st.by === 'uidMama', st);
    ok('but nothing says "ticked by you" on a list only she can see', r.length === 3 && r.every((x) => x.sub === null), r);
    // Nobody else is on this journey, so every line on it is hers to take back.
    ok('and she keeps a bin on every row', r.length === 3 && r.every((x) => x.hasBin), r);
  }

  console.log('\n6. he can add his own item, and it survives a reload');
  {
    await load(seed());
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    /* Defensive on purpose: with the fix reverted there IS no box here, and a gate that throws at
       this line never grades sections 8 to 12 — the privacy assertions, which are the ones that
       matter most. A missing box has to be a failure, not an exception. */
    const typed = await page.evaluate(() => {
      const el = document.querySelector('#scroll #pcNew');
      if (!el) return false;
      el.value = 'Book the dentist'; addPrecon(); return true;
    });
    ok('there is a box for him to type into', typed === true);
    await sleep(250);
    const st = await page.evaluate(() => state.pregnancy.precon.map((i) => ({ t: i.text, by: i.addedBy || null })));
    ok('the item is on the record', st.length === 4 && st[3] && st[3].t === 'Book the dentist', st);
    ok('and it remembers he added it', !!st[3] && st[3].by === 'uidPapa', st);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    const r = await rows();
    /* Honest about what this proves: in ?e2e=1 the record comes back from localStorage. In the
       cloud a non-owner writes nothing locally (persist() only calls Store.save when !hhRef), so
       HIS durability is the round trip through the journey doc — that is section 14, run against
       the shipped sync code. What this line proves is that the item is on the record and renders
       again from it, which is the half a reverted build loses. */
    ok('it is still there after a re-read of the record', r.length === 4 && !!r[3] && r[3].text === 'Book the dentist', r.map((x) => x.text));
    ok('the item HE added is the only one he can take back', r.length === 4 && !r[0].hasBin && !r[1].hasBin && !r[2].hasBin && r[3].hasBin, r.map((x) => x.text + (x.hasBin ? ' [bin]' : '')));
    // A second save on top of the first: the bug class where only the first write ever lands.
    await clickRow(3);
    await sleep(250);
    await page.evaluate(() => {
      const el = document.querySelector('#scroll #pcNew');
      if (el) { el.value = 'Ask about the flu jab'; addPrecon(); }
    });
    await sleep(250);
    const st2 = await page.evaluate(() => state.pregnancy.precon.map((i) => i.text + (i.done ? '*' : '')));
    ok('a second edit lands on top of the first', st2.length === 5 && st2[3] === 'Book the dentist*' && st2[4] === 'Ask about the flu jab', st2);
    /* A row that simply appears on her list is the more startling of the two events, and it was the
       silent one: a tick was attributed, an addition was not. */
    await asPerson('uidMama', { role: 'owner', shared: ['uidPapa'] });
    const rm = await rows();
    ok('on her screen the new row says he added it', !!rm[3] && rm[3].sub === 'added by Papa Bear · ticked by Papa Bear', rm[3]);
    ok('and the one she has not been near says nothing at all', !!rm[4] && rm[4].sub === 'added by Papa Bear', rm[4]);
    ok('her own rows are still unattributed', rm.slice(0, 3).every((x) => x.sub === null), rm.slice(0, 3));
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    const rp = await rows();
    ok('and on his own screen it does not tell him he added his own item', !!rp[3] && rp[3].sub === 'ticked by you', rp[3]);
  }

  console.log('\n7. an empty list is an invitation to him, not an explanation of her');
  {
    await load(seed({ pregnancy: { id: 'pg1', stage: 'planning', ownerUid: 'uidMama', cycleLen: 28, precon: [], moments: [], conditions: {}, guesses: [] } }));
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    const r = await rows();
    const sub = await subs();
    ok('no rows render when there is nothing on the list', r.length === 0, r);
    ok('the box to start it is still there', await page.evaluate(() => !!document.querySelector('#scroll #pcNew')));
    ok('and the copy asks him to add the first thing', /add the first thing/i.test(sub), sub);
  }

  console.log('\n8. a refused write puts the list back to read-only and says so');
  {
    await load(seed());
    await asPerson('uidPapa', { shared: ['uidPapa'], denied: true });
    const r = await rows();
    ok('all three rows still render, so he still sees what he is part of', r.length === 3, r);
    ok('but not one of them is tappable', r.length === 3 && r.every((x) => !x.tickTaps && !x.textTaps), r);
    ok('and no bins are offered', r.length === 3 && r.every((x) => !x.hasBin), r);
    ok('the add box is gone too', await page.evaluate(() => !document.querySelector('#scroll #pcNew')));
    const t = await page.evaluate(() => {
      togglePrecon('pc1');
      return { toast: (document.getElementById('toast').textContent || '').trim(), done: !!state.pregnancy.precon[0].done };
    });
    ok('a tap that reaches the handler anyway changes nothing', t.done === false, t);
    /* This branch is reachable ONLY after a real refusal, so it is a save failure and never a rule
       he broke. "Only the person whose journey this is can change this list" scolded him for a rule
       he did not break, thirty pixels under a line inviting him to do it together. One short clause,
       the shape the rest of the file already uses for a failed save. */
    ok('and is answered out loud rather than silently', /^could not save that, try again$/i.test(t.toast), t);
    ok('and is not a permission lecture', !/only the person whose journey/i.test(t.toast) && !/\./.test(t.toast), t);
    const sub = await subs();
    ok('the list says once, in plain words, what actually happened', /could not save your last change/i.test(sub) && /but not change it/i.test(sub), sub);
    ok('and never tells him it is her list while his own tick is on the screen', !/keeps this list/i.test(sub) && !/you'll see it move/i.test(sub), sub);
  }

  console.log('\n9. someone she never told still learns nothing');
  {
    /* Nana is in the circle and NOT in sharedWith. In the cloud she never receives the journey doc
       at all, so state.pregnancy is null for her — which is the whole point of the list living on
       that document rather than in the shared app blob.
       WHAT THIS IS AND IS NOT. It is a regression guard on the client half: with no journey the
       trying home must render no checklist and no add box, and it would go red if some later change
       started rendering the list from anything but state.pregnancy. It is NOT proof that she cannot
       reach the document — nothing in a ?e2e=1 page can prove that. The teeth for the audience are
       in test/rules-test.js ("a member she never told cannot even read it"), which runs the real
       rules against the emulator. Do not read a pass here as the privacy check. */
    await load(seed({ pregnancy: null }));
    await asPerson('uidNana', { shared: ['uidPapa'] });
    const r = await rows();
    ok('no preparation rows exist for a member she never told', r.length === 0, r);
    ok('and no add box either', await page.evaluate(() => !document.querySelector('#scroll #pcNew')));
  }

  console.log('\n10. the checklist has not been moved into the circle-shared blob');
  {
    /* This is the item as proposed, and shipping it that way would have published "someone here is
       trying to conceive" to every member of the circle. Read the source of the two files that
       decide the audience, because no click in a ?e2e=1 page can see a Firestore document. */
    const store = fs.readFileSync(path.join(ROOT, 'app/store-firebase.js'), 'utf8');
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const blob = store.slice(store.indexOf('function appBlobFromState'), store.indexOf('function applyAppBlob'));
    ok('appBlobFromState is found and is not empty', blob.length > 400, blob.length);
    // Every absence check is paired with a length. An empty slice makes "does not contain X" true
    // for free, so a rename that empties a later slice would otherwise pass in silence.
    ok('the shared blob carries no precon key', blob.length > 400 && !/\bprecon\b/.test(blob), blob.match(/.{0,40}precon.{0,40}/));
    ok('and no pregnancy key, the invariant this sits under', blob.length > 400 && !/(^|[^.\w])pregnancy\s*:/.test(blob), blob.match(/.{0,40}pregnancy.{0,40}/));
    const preg = store.slice(store.indexOf('function pregJourneyData'), store.indexOf('function appBlobFromState'));
    ok('precon is still journey data, so it keeps the journey audience', preg.length > 100 && /MAT_PRIVATE_KEYS/.test(preg) && !/precon/.test(preg), preg);
    ok('rules still refuse a pregnancy key in the app blob', /hasAny\(\['pregnancy', 'mhealth', 'maternalHealth'\]\)/.test(rules));
  }

  console.log('\n11. the rule that makes his tick real is exactly one field wide');
  {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const i = rules.indexOf('match /pregnancy/{owner} {');
    const j = rules.indexOf('match /photos/{photoId}', i);
    const block = rules.slice(i, j);
    ok('the pregnancy journey block is found', i > 0 && j > i, { i, j });
    ok('a shared member may update, gated on sharedWith', /request\.auth\.uid in resource\.data\.sharedWith\s*\n\s*&& preconOnly\(\)/.test(block), block.slice(-700));
    ok('and only through preconOnly()', /function preconOnly\(\)/.test(block));
    ok('preconOnly lets exactly two top-level keys move', /affectedKeys\(\)\.hasOnly\(\['data', 'updatedAt'\]\)/.test(block));
    ok('and exactly one key inside data', /data\.diff\(resource\.data\.data\)\.affectedKeys\(\)\.hasOnly\(\['precon'\]\)/.test(block));
    ok('creating the journey is still owner-only', /allow create: if request\.auth != null && request\.auth\.uid == owner/.test(block));
    ok('deleting it is still owner-only', /allow delete: if request\.auth != null && request\.auth\.uid == owner/.test(block));
  }

  console.log('\n12. the store writes one field path and is honest when refused');
  {
    const store = fs.readFileSync(path.join(ROOT, 'app/store-firebase.js'), 'utf8');
    const fn = store.slice(store.indexOf('async function syncSharedPrecon'), store.indexOf('async function syncPregJourney'));
    ok('syncSharedPrecon exists', fn.length > 200, fn.length);
    ok('it writes the single field path data.precon', /update\(\{ 'data\.precon': p\.precon \|\| \[\]/.test(fn), fn);
    // Paired with the length, because an empty slice makes "contains no .set(" true for free.
    ok('it never .set()s the whole journey from a non-owner', fn.length > 200 && !/\.set\(/.test(fn), fn);
    ok('a refusal drops the signature so the owner\'s list comes back', /knownPrecon = null;/.test(fn), fn);
    ok('and a permission denial is surfaced, not swallowed', /permission-denied/.test(fn) && /preconDenied = true/.test(fn), fn);
    ok('it only writes when the CHECKLIST changed, not on every save of anything', /var sig = stableStringify\(p\.precon \|\| \[\]\);/.test(fn) && /if \(knownPrecon === sig\) return;/.test(fn), fn);
    const apply = store.slice(store.indexOf('function applyPregJourney'), store.indexOf('function clearPregJourneyState'));
    ok('an unsaved tick survives the snapshot it caused', /keepPrecon/.test(apply) && /if \(keepPrecon\) p\.precon = keepPrecon;/.test(apply), apply);
    /* The line that made this whole change lose data. `unsaved` is a WHOLE-DOCUMENT comparison and
       it is latched true on every phone a second after boot (ensurePregFields adds `gentle` and
       `guesses`, which pregJourneyData does not strip). Hanging keepPrecon off it meant both phones
       kept their own list forever and adopted nobody else's. Section 14 runs it; this asserts the
       shape so a later edit cannot quietly put it back. */
    ok('and it is kept on a checklist-only dirty flag, never on the doc-wide one', /preconDirty/.test(apply) && /knownPrecon !== null && stableStringify\(p\.precon \|\| \[\]\) !== knownPrecon/.test(apply), apply);
    ok('a device holding nothing of its own adopts the checklist it is sent', /else \{ try \{ knownPrecon = stableStringify\(data\.precon \|\| \[\]\); \}/.test(apply), apply);
  }


  /* ---------------------------------------------------------------------------------------------
     14. TWO PHONES, ONE CHECKLIST. Nothing above this line touches the sync layer: ?e2e=1 has no
     Firestore, and every window.LL the page reads is a stub this gate wrote, so a whole feature
     could be deleted from store-firebase.js and sections 1 to 9 would still be green. That is not
     a gate, it is a screenshot with opinions.

     So this section runs the SHIPPED CODE. stableStringify, pregJourneyData, applyPregJourney,
     syncSharedPrecon and syncPregJourney are cut verbatim out of app/store-firebase.js, and
     ensurePregFields out of app/index.html, and executed against a fake cloud that enforces the
     same shape firestore.rules does. Two devices, one document, snapshots delivered to both.

     ensurePregFields is in here for a reason that cost this change its first review: it adds
     `gentle` and `guesses` to state.pregnancy on the first render, pregJourneyData strips neither,
     so the whole-document `unsaved` flag in applyPregJourney is latched TRUE on every phone about
     a second after boot. Keying "keep my checklist" off that flag meant both phones kept their own
     copy forever and adopted nobody else's: his tick never arrived, and her next save wrote her
     stale list back over it, silently, on the one field this change makes two people write.
     --------------------------------------------------------------------------------------------- */
  console.log('\n14. two phones, one checklist: the real sync code, executed');
  {
    const storeSrc = fs.readFileSync(path.join(ROOT, 'app/store-firebase.js'), 'utf8');
    const idxSrc = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
    // Brace-matched slice from a function header. Returns null when the function is gone, which is
    // how a reverted build fails this section instead of throwing through it.
    const fnSrc = (src, header) => {
      const i = src.indexOf(header);
      if (i < 0) return null;
      const j = src.indexOf('{', i + header.length - 1);
      if (j < 0) return null;
      let d = 0;
      for (let k = j; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
      }
      return null;
    };
    const need = {
      stableStringify: fnSrc(storeSrc, 'function stableStringify(o)'),
      pregJourneyData: fnSrc(storeSrc, 'function pregJourneyData(p)'),
      applyPregJourney: fnSrc(storeSrc, 'function applyPregJourney(owner, d)'),
      syncSharedPrecon: fnSrc(storeSrc, 'async function syncSharedPrecon(uidNow)'),
      syncPregJourney: fnSrc(storeSrc, 'async function syncPregJourney(uidNow)'),
      ensurePregFields: fnSrc(idxSrc, 'function ensurePregFields(p)'),
    };
    const cats = storeSrc.slice(storeSrc.indexOf('var MAT_CATS = {'), storeSrc.indexOf('var matUnsub'));
    const meta = (storeSrc.match(/var PREG_META_KEYS = [^\n]*/) || [''])[0];
    const missing = Object.keys(need).filter((k) => !need[k]);
    ok('every function this run needs is still in the shipped files', missing.length === 0 && cats.length > 200 && !!meta, { missing, cats: cats.length });

    const R = { error: null };
    if (!missing.length && cats.length > 200 && meta) {
      try {
        const clone = (o) => JSON.parse(JSON.stringify(o));
        const cloud = {
          doc: { ownerUid: 'uidMama', sharedWith: ['uidPapa'], data: { id: 'pg1', stage: 'planning', cycleLen: 28, precon: PRECON() } },
          writes: [], allowShared: true,
        };
        // The fake cloud enforces what firestore.rules enforces: the owner writes anything, a
        // member in sharedWith writes data.precon and nothing else, and allowShared=false is the
        // household whose rules have not been deployed yet.
        const net = {
          update: async (from, o) => {
            const keys = Object.keys(o);
            const scoped = keys.every((k) => k === 'data.precon' || k === 'updatedAt');
            const may = from === cloud.doc.ownerUid
              || (cloud.allowShared && cloud.doc.sharedWith.indexOf(from) >= 0 && scoped);
            if (!may) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
            if (o['data.precon']) cloud.doc.data.precon = clone(o['data.precon']);
            cloud.writes.push(from + ':update');
          },
          set: async (from, o) => {
            if (from !== cloud.doc.ownerUid) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
            cloud.doc = { ownerUid: o.ownerUid, sharedWith: clone(o.sharedWith), data: clone(o.data) };
            cloud.writes.push(from + ':set');
          },
        };
        const DEVICE = `
          var state = { pregnancy: null };
          var pregShared = [], pregOwner = null;
          var knownPregJourney = null, knownPrecon = null, preconDenied = false, booted = false;
          var toasts = [];
          function rerender() {}
          var window = { toast: function (t) { toasts.push(t); }, LL: { serverTimestamp: function () { return 'TS'; } } };
          var hhRef = { collection: function () { return { doc: function () { return {
            update: function (o) { return net.update(uid, o); },
            set: function (o) { return net.set(uid, o); }
          }; } }; } };
          ${cats}
          ${meta}
          ${need.stableStringify}
          ${need.pregJourneyData}
          ${need.applyPregJourney}
          ${need.syncSharedPrecon}
          ${need.syncPregJourney}
          ${need.ensurePregFields}
          return {
            // A snapshot lands, then the app paints: exactly the order the real client runs in, and
            // the paint is where the latch is created.
            snapshot: function (d) { applyPregJourney(d.ownerUid, d); ensurePregFields(state.pregnancy); },
            push: function () { return syncPregJourney(uid); },
            edit: function (f) { f(state.pregnancy); },
            row: function (n) { var i = ((state.pregnancy || {}).precon || [])[n] || {}; return i.text + (i.done ? ' [x] by ' + (i.by || '?') : ' [ ]'); },
            denied: function () { return preconDenied; },
            lastToast: function () { return toasts[toasts.length - 1] || ''; }
          };`;
        const makeDevice = (u) => new Function('uid', 'net', DEVICE)(u, net);
        const mama = makeDevice('uidMama'), papa = makeDevice('uidPapa');
        const deliver = () => { [mama, papa].forEach((d) => d.snapshot(clone(cloud.doc))); };
        const push = async (d) => { await d.push(); await sleep(30); };

        deliver();                        // both open Cubby
        R.opened = [mama.row(0), papa.row(0)];
        // Sam ticks folic acid, the thing he actually did.
        papa.edit((p) => { p.precon[0].done = true; p.precon[0].by = 'uidPapa'; });
        await push(papa);
        R.serverAfterHisTick = clone(cloud.doc.data.precon[0]);
        deliver();
        R.mamaSees = mama.row(0);
        // Next day she opens Cycle details and taps Save. Her write is the whole document.
        mama.edit((p) => { p.cycleLen = 30; });
        await push(mama);
        R.serverAfterHerSave = clone(cloud.doc.data.precon[0]);
        deliver();
        R.papaStillSees = papa.row(0);
        // Nothing has changed since the last snapshot, so nothing should go out.
        const before = cloud.writes.length;
        await push(papa);
        R.idleWrites = cloud.writes.length - before;
        // And now the household whose rules were never deployed.
        cloud.allowShared = false;
        papa.edit((p) => { p.precon[1].done = true; p.precon[1].by = 'uidPapa'; });
        await push(papa);
        R.denied = papa.denied();
        R.toast = papa.lastToast();
        deliver();
        R.papaAfterRefusal = papa.row(1);
        R.writes = cloud.writes.slice();
      } catch (e) { R.error = e && e.message; }
    } else { R.error = 'functions missing'; }

    ok('the run completes without throwing', R.error === null, R.error);
    ok('both phones open on the same untouched list', JSON.stringify(R.opened) === JSON.stringify(['Take folic acid, 400 micrograms daily [ ]', 'Take folic acid, 400 micrograms daily [ ]']), R.opened);
    ok('his tick reaches the document', !!R.serverAfterHisTick && R.serverAfterHisTick.done === true, R.serverAfterHisTick);
    // The one the first version of this change got wrong, and the reason it could not ship.
    ok('and the next snapshot puts it on HER phone', R.mamaSees === 'Take folic acid, 400 micrograms daily [x] by uidPapa', R.mamaSees);
    ok('her next save does not write her stale list back over it', !!R.serverAfterHerSave && R.serverAfterHerSave.done === true, R.serverAfterHerSave);
    ok('and his phone still agrees with hers', R.papaStillSees === 'Take folic acid, 400 micrograms daily [x] by uidPapa', R.papaStillSees);
    ok('a save with nothing new on the checklist writes nothing at all', R.idleWrites === 0, { idleWrites: R.idleWrites, writes: R.writes });
    ok('a refused write is recorded, so the list can go read-only', R.denied === true, R.denied);
    ok('and it is said in the words a failed save deserves', /^Could not save that, try again$/.test(R.toast || ''), R.toast);
    ok('and the tick that never saved does not linger on his screen', R.papaAfterRefusal === 'Check your vitamin D [ ]', R.papaAfterRefusal);
  }

  console.log('\n13. a screenshot of the partner home, at the width a phone actually is');
  {
    await load(seed());
    await asPerson('uidPapa', { shared: ['uidPapa'] });
    await clickRow(0);
    await sleep(300);
    await page.evaluate(() => {
      const r = document.querySelectorAll('#scroll .bag-row')[0];
      if (r) r.scrollIntoView({ block: 'center' });
    });
    await sleep(300);
    // Into the temp dir, not the repo: a gate must not leave an untracked file behind for whoever
    // is merging the wave.
    const out = path.join(os.tmpdir(), 'precon-partner-390.png');
    await page.screenshot({ path: out });
    ok('written', fs.existsSync(out), out);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'PRECON-SHARED: FAIL' : 'PRECON-SHARED: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
