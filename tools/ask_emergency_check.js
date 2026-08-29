#!/usr/bin/env node
/* THE ASK BOX DID NOT RECOGNISE AN EMERGENCY.
 *
 * Two things a QA pass typed into "Ask Cubby" and what came back:
 *
 *   "my babys lips look blue"  ->  "The closest question in Cubby's reads: How is postnatal anxiety
 *                                   different from baby blues?"
 *   "her tongue looks grey"    ->  "What does eczema look like on a baby?"
 *
 * Blue lips are an ambulance. That answer was an article about the mother's mood, and there was no
 * phone number anywhere on the screen. The flag list already carried "blue lips", "turning blue",
 * "went blue" and "blue around the mouth", and every one of those fixes the word order the wrong way
 * round: a frightened parent types the body part first and the colour last. Item 37 had already
 * shipped the repair for exactly this class, order-free pairs in ASK_FLAG_BABY_BOTH, for the
 * fontanelle and the stiff neck. Cyanosis had simply never been put through it.
 *
 *   "my baby is 3 weeks old and has a temperature of 38.5"  ->  headlined "Could this be teething?"
 *   "my newborn has a fever"                                ->  "Cubby does not have this one"
 *
 * A fever in a three-week-old is a phone call. It is also the one red flag in this library whose
 * answer depends on WHO the baby is, so it can be neither a phrase nor a pair: 38.5 in a
 * six-month-old really is a read. askFeverFlag is that check, and it lives in askRun and nowhere
 * else, because askFlag also runs over the corpus at index time and a flag that read the active
 * baby would make the search index depend on whose phone it is.
 *
 * WHAT THIS GATE IS FOR. Section 2 is the widened net: every phrasing added for this item, asserted
 * one at a time, so that nobody can quietly narrow it back to the word order an editor happened to
 * write. Section 5 is the other half, and it is the half that keeps the first half honest: the
 * ordinary sentences that share a word with an emergency ("the baby blues", a blue birthmark, blue
 * veins through new skin, a blotchy face after a bath, a room temperature) must still be answered
 * out of the library. A red-flag list that fires on a well baby teaches a parent to scroll past the
 * card that matters.
 *
 * Nothing here reads document.body.textContent. That string contains the page's own inline script,
 * so every phrase this gate looks for appears in it whatever the screen is doing, and an assertion
 * against it passes for free. Everything below reads #askOut. Every "it is NOT urgent" assertion is
 * paired with a positive one (a real question came back from the corpus), because "no urgent card"
 * is also true of a blank screen.
 *
 *   PORT=19613 node tools/serve.js &
 *   node tools/ask_emergency_check.js http://localhost:19613
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

/* Twenty days old by default: the QA report's baby, and the age at which the fever rule is live. */
const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 20 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
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

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
  };

  /* Drives the real box: opens the sheet, waits for the corpus, types, and reads #askOut only.
     `question` is the retrieved corpus question, and it is null on every urgent card, which is what
     makes "she was answered instead of escalated" a thing this gate can actually tell apart. */
  const ask = async (q) => page.evaluate(async (q) => {
    if (!document.getElementById('askQ')) openAskBox();
    for (let i = 0; i < 100 && window.ASK_LOAD !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
    ASK_Q = q; askRun();
    await new Promise((r) => setTimeout(r, 120));
    const o = document.getElementById('askOut');
    if (!o) return { missing: true };
    const kickEl = o.querySelector('.ask-kick');
    return {
      urgent: !!o.querySelector('.ask-urgent'),
      kick: kickEl ? kickEl.textContent.trim() : null,
      question: o.querySelector('.ask-q') ? o.querySelector('.ask-q').textContent.trim() : null,
      answer: o.querySelector('.ask-a') ? o.querySelector('.ask-a').textContent.trim() : null,
      buttons: [...o.querySelectorAll('button,a')].map((b) => (b.getAttribute('onclick') || b.getAttribute('href') || '')),
      tel: [...o.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')),
      discHidden: (document.getElementById('askDisc') || {}).style ? document.getElementById('askDisc').style.display === 'none' : null,
      text: (o.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  }, q);

  /* Section 7 reads ASK_INDEX directly, and the corpus is only fetched once the box has been
     opened. Without this the index is null and the assertion crashes rather than failing. */
  const ensureIndex = async () => page.evaluate(async () => {
    if (!document.getElementById('askQ')) openAskBox();
    for (let i = 0; i < 100 && window.ASK_LOAD !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
    return window.ASK_LOAD;
  });

  const READS_A_PHONE = (r) => r.urgent === true && r.question === null
    && /call your doctor now|prompt call to your doctor/i.test(r.answer || '')
    && /local emergency number/i.test(r.answer || '');

  console.log('\n1. the two questions from the QA report');
  {
    await load(seed());
    /* Defect 2, exactly as measured. Before the fix this returned the postnatal-anxiety pair. */
    const lips = await ask('my babys lips look blue');
    ok('"my babys lips look blue" gets the urgent card', lips.urgent === true, { kick: lips.kick, q: lips.question });
    ok('and is NOT answered out of the library', lips.question === null, lips.question);
    ok('and specifically not with the postnatal-anxiety read', !/anxiety|baby blues/i.test(lips.text), lips.text.slice(0, 160));
    ok('and it reaches a phone', READS_A_PHONE(lips), lips.answer);
    ok('the publishing footer is hidden on it', lips.discHidden === true, lips.discHidden);

    const tongue = await ask('her tongue looks grey');
    ok('"her tongue looks grey" gets the urgent card', tongue.urgent === true, { kick: tongue.kick, q: tongue.question });
    ok('and not the eczema read', tongue.question === null && !/eczema/i.test(tongue.text), tongue.text.slice(0, 160));
    ok('and it reaches a phone', READS_A_PHONE(tongue), tongue.answer);

    /* Defect 3, exactly as measured: this was headlined "Could this be teething?". */
    const three = await ask('my baby is 3 weeks old and has a temperature of 38.5');
    ok('a 3-week-old with 38.5 gets the urgent card', three.urgent === true, { kick: three.kick, q: three.question });
    ok('and is NOT headlined "Could this be teething?"',
      three.question === null && !/teething/i.test(three.text), { q: three.question, t: three.text.slice(0, 160) });
    ok('and it reaches a phone', READS_A_PHONE(three), three.answer);
    ok('the line names the under-3-months rule and does not diagnose',
      /under 3 months/i.test(three.answer || '') && !/probably|likely|sounds like|infection|sepsis/i.test(three.answer || ''), three.answer);

    const nb = await ask('my newborn has a fever');
    ok('"my newborn has a fever" is no longer "Cubby does not have this one"',
      nb.urgent === true && !/does not have this one/i.test(nb.text), { kick: nb.kick, t: nb.text.slice(0, 120) });
    ok('and it reaches a phone', READS_A_PHONE(nb), nb.answer);
  }

  console.log('\n2. every phrasing added for this item, one at a time');
  {
    /* THE WIDE GATE. Each line below is a phrasing that fell through to retrieval before this item.
       They are asserted individually and not as a set, so a regression names itself. Removing one of
       these is removing a phrasing a parent uses. */
    const danger = [
      // cyanosis and mottling: the colour last, which is how it is actually typed
      'my babys lips look blue', 'her lips are blue', 'his lips went blue', 'lips are turning blue',
      'her lips have gone purple', 'her lips look dusky',
      'my babys tongue looks grey', 'his tongue is a bit grey', 'her tongue has gone blue',
      'my babys skin looks blue', 'her skin is grey', 'my babys skin has gone gray',
      'her skin is mottled', 'she is mottled all over', 'she is grey all over',
      'my babys face went grey', 'her face looks blue', 'my babys face is ashen',
      'his mouth went blue', 'my baby looks dusky around the mouth', 'her gums look blue',
      // breathing, subject last
      'her breathing stopped', 'she keeps stopping breathing',
      'i cannot tell if she is breathing', 'i am not sure she is breathing',
      'her breathing is laboured', 'her breathing is a struggle',
      'breathing is such an effort for her', 'her breathing looks like hard work',
      'she is having difficulty breathing',
      'i can see her ribs sucking in', 'i can see her ribs pulling in', 'her nostrils are flaring',
      // hard to rouse, the quieter version of "will not wake"
      'she is very hard to wake', 'she is difficult to wake', 'i cannot rouse her', 'she is hard to rouse',
      // a seizure described rather than named
      'she went stiff and started jerking', 'her body went rigid and she was shaking',
      'my baby is convulsing', 'her whole body went rigid',
      // and the 999 list's own projectile vomiting
      'she projectile vomited', 'my baby is projectile vomiting',
    ];
    let reached = 0;
    for (const q of danger) {
      const r = await ask(q);
      const good = r.urgent === true && r.question === null;
      if (good) reached++;
      ok('"' + q + '" reaches a phone', good, { urgent: r.urgent, answeredInstead: r.question });
    }
    /* Paired with a count, so this section cannot pass by asserting nothing. */
    ok('all ' + danger.length + ' of them escalated', reached === danger.length, { reached: reached, of: danger.length });
  }

  console.log('\n3. the fever card depends on the age, and the typed age wins');
  {
    await load(seed());   // 20 days old
    const bare = await ask('my babys temperature is 38.9');
    ok('a bare reading escalates for a 20-day-old', bare.urgent === true && bare.question === null, { kick: bare.kick, q: bare.question });
    /* The age SHE typed beats the profile, because a grandmother asks in the same box. */
    const older = await ask('my baby is 8 months old and has a fever');
    ok('but "8 months old" in the question is answered, not escalated',
      older.urgent === false && !!older.question && !!older.answer, { urgent: older.urgent, q: older.question });

    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const old = await ask('my babys temperature is 38.9');
    ok('the same reading for an 8-month-old is answered out of the library',
      old.urgent === false && !!old.question && !!old.answer, { urgent: old.urgent, q: old.question });
    const typedNb = await ask('my baby is 3 weeks old and has a temperature of 38.5');
    ok('and "3 weeks old" still escalates even with an older baby on file',
      typedNb.urgent === true && typedNb.question === null, { urgent: typedNb.urgent, q: typedNb.question });
  }

  console.log('\n4. the card reaches a real phone when there is one, and never invents one');
  {
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 20 * DAY, sex: 'F', routines: [],
      doctors: [{ id: 'd1', name: 'Dr Okafor', phone: '01632 960123' }], allergies: [] }] }));
    const lips = await ask('my babys lips look blue');
    ok('a saved paediatrician becomes a tel: link on the cyanosis card', lips.tel.length === 1 && /960123/.test(lips.tel[0]), lips.tel);
    const fev = await ask('my newborn has a fever');
    ok('and on the fever card too', fev.tel.length === 1 && /960123/.test(fev.tel[0]), fev.tel);
    ok('the fever card offers the "call sooner" list', fev.buttons.some((b) => /openFeverSafetyNet/.test(b)), fev.buttons);

    await load(seed());   // no doctor saved
    const none = await ask('my newborn has a fever');
    ok('with no number saved it offers no tel: link at all', none.tel.length === 0, none.tel);
    /* And does not turn into a form. The line already tells her to call. */
    ok('and no filled primary asking her to fill one in',
      none.buttons.filter((b) => /openDoctor/.test(b)).length === 1
      && !/btn-primary[^>]*openDoctor/.test(none.text), none.buttons);
    ok('but it still says to call, so the card is never a dead end', READS_A_PHONE(none), none.answer);
  }

  console.log('\n5. the ordinary sentences that share a word with an emergency');
  {
    await load(seed());
    /* Every line here shares a half of a new pair, or a fever word, with a real emergency, and was
       measured against the corpus before it was written down. Each is asserted BOTH ways: not
       urgent, AND a real question came back, so a blank screen cannot pass this section. */
    const calm = [
      ['what are the baby blues', 'the baby blues are a section of this library, not a blue baby'],
      ['how long do the baby blues last', 'and so is how long they last'],
      ['i can see blue veins through my babys skin', 'blue veins through new skin are what new skin looks like'],
      ['my baby has a blue spot on her back', 'a blue spot is a birthmark'],
      ['my baby has blue eyes will they change', 'and blue eyes are blue eyes'],
      ['her skin looks pale is that normal', 'pale is deliberately not one of the colours: a well baby is pale'],
      ['is a blotchy face normal after a bath', 'nor is blotchy: that is a warm bath'],
      ['my babys hands and feet are blue is that normal', 'blue hands and feet are what a well newborn does all day'],
      ['why are my newborns feet purple', 'and purple feet are the same thing'],
      ['is it hard to wake a newborn', 'asking whether newborns are sleepy is not reporting one who will not rouse'],
      ['why is my baby not waking for feeds at night', 'and not waking FOR FEEDS is a sleep question'],
      ['how do i fit a car seat', 'fitting a car seat is still not a fit'],
      ['is my babys breathing normal when she sleeps', 'a question about normal breathing is not a report of distress'],
      ['why does my newborn grunt when she breathes', 'newborn grunting is deliberately not a flag'],
      ['is fast breathing normal in a newborn', 'nor is fast breathing on its own'],
      ['how do i take my babys temperature', 'a how-to is not a reading'],
      ['what temperature should a babys room be in summer', 'a room has a temperature, only a baby has a fever'],
      ['what water temperature is safe for babies in a pool', 'and so does the water in a pool'],
      ['how can i tell if my night sweats are caused by a fever', 'her own night sweats are not her babys fever'],
      ['when do babies start rolling over', 'rolling over is still a milestone'],
      ['why does my baby throw up milk', 'and being sick with no blood in it stays a feeding question'],
    ];
    /* Two of these the library genuinely does not hold, and it says so. "Cubby does not have this
       one" is the honest refusal, not an escalation, so it counts as calm. What is NOT allowed is an
       empty #askOut: a blank screen is not urgent either, and without the kick and the text length
       below this whole section would pass for free on one. */
    let calmOk = 0, fromLibrary = 0;
    for (const [q, why] of calm) {
      const r = await ask(q);
      const showsSomething = !!r.kick && r.text.length > 20;
      const good = r.urgent === false && showsSomething
        && (!!r.question || /does not have this one/i.test(r.text));
      if (good) calmOk++;
      if (r.question) fromLibrary++;
      ok(why, good, { q: q, urgent: r.urgent, kick: r.kick, answered: r.question });
    }
    ok('all ' + calm.length + ' stayed calm and put something on the screen', calmOk === calm.length, { calm: calmOk, of: calm.length });
    /* Paired with the count above so "calm" can never be satisfied by refusing everything. */
    ok('and at least 18 of them came back with a real answer from the library', fromLibrary >= 18, { fromLibrary: fromLibrary, of: calm.length });
  }

  console.log('\n6. the widened net did not swallow the corpus');
  {
    /* The pairs are matched against a canonical form of her words, so a list that is too wide shows
       up as the library escalating ITSELF. Measured before this item: 4 of 1990. It must still be 4,
       and the fever check must add nothing at all for a baby the rule does not cover. */
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    const r = await page.evaluate(async () => {
      if (typeof askFeverFlag !== 'function') return { absent: true };
      const d = await (await fetch('ask-data.json')).json();
      const qs = []; (d.d || []).forEach((doc) => (doc.q || []).forEach((p) => qs.push(p[0])));
      return { n: qs.length,
        flagged: qs.filter((q) => askFlag(q)),
        fever: qs.filter((q) => !askFlag(q) && askFeverFlag(q)) };
    });
    /* Reported as a failure and not thrown, so a build without the fix still prints its counts. */
    ok('askFeverFlag exists at all', !r.absent, r);
    if (r.absent) { r.n = -1; r.flagged = []; r.fever = []; }
    ok('the corpus is the full index, not a truncated fetch', r.n === 1990, r.n);
    ok('exactly 4 of its own 1990 questions carry a flag', r.flagged.length === 4, r.flagged);
    ok('and for an 8-month-old the fever check escalates none of them', r.fever.length === 0, r.fever);
  }

  console.log('\n7. askFlag stays pure, so the search index never depends on whose phone it is');
  {
    /* askBuildIndex calls askFlag over the corpus. If the age check had gone in there, two parents
       would have had two different libraries, and the "dropped" count would move with the baby's
       birthday. This asserts the separation directly. */
    await load(seed());   // 20 days old
    await ensureIndex();
    const young = await page.evaluate(() => ({ n: (window.ASK_INDEX || {}).n, dropped: (window.ASK_INDEX || {}).dropped,
      flag: askFlag('my baby has a temperature of 38.5'),
      fever: typeof askFeverFlag === 'function' ? askFeverFlag('my baby has a temperature of 38.5') : 'absent' }));
    await load(seed({ babies: [{ id: 'b1', name: 'Robin', birth: now - 240 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }] }));
    await ensureIndex();
    const old = await page.evaluate(() => ({ n: (window.ASK_INDEX || {}).n, dropped: (window.ASK_INDEX || {}).dropped,
      flag: askFlag('my baby has a temperature of 38.5'),
      fever: typeof askFeverFlag === 'function' ? askFeverFlag('my baby has a temperature of 38.5') : 'absent' }));
    ok('the index is the same size for a newborn and an 8-month-old', young.n === old.n && young.n > 0, { young: young.n, old: old.n });
    ok('and drops the same pairs', young.dropped === old.dropped, { young: young.dropped, old: old.dropped });
    ok('askFlag returns the same thing for both', young.flag === old.flag && young.flag === '', { young: young.flag, old: old.flag });
    ok('while askFeverFlag is the half that moves', young.fever === true && old.fever === false, { young: young.fever, old: old.fever });
  }

  console.log('\n8. the other urgent cards still behave, and the fever card is not one of them');
  {
    await load(seed());
    /* A mother frightened of her own thoughts must not be handed a list about baby fevers. That is
       an existing promise and the new kind must not have widened its way into it. */
    const mind = await ask('i want to hurt myself');
    ok('the mind card still fires', mind.urgent === true && /holding this alone/i.test(mind.kick || ''), mind.kick);
    ok('and is still not offered the fever list', mind.buttons.filter((b) => /openFeverSafetyNet/.test(b)).length === 0, mind.buttons);
    ok('and still gets no baby doctor', mind.tel.length === 0, mind.tel);
    const loss = await ask('we lost our baby');
    ok('bereavement is still not answered as a search', loss.urgent === true && loss.question === null, loss.question);
    ok('and is not handed a phone to ring tonight', loss.tel.length === 0 && !/emergency number/i.test(loss.answer || ''), loss.answer);
    /* A baby who is BOTH feverish and floppy is a floppy baby: the specific card wins. */
    const both = await ask('my baby has a fever and has gone floppy');
    ok('feverish AND floppy gets the floppy card, not the fever one',
      both.urgent === true && /call your doctor now/i.test(both.answer || '') && !/under 3 months/i.test(both.answer || ''), both.answer);
  }

  console.log('\n9. the copy passes the 3am test');
  {
    await load(seed());
    const fev = await ask('my newborn has a fever');
    ok('no em-dash on the card', !/—|--/.test(fev.text), fev.text);
    ok('it is written to her, in the second person', /your doctor/i.test(fev.answer || ''), fev.answer);
    ok('it names no condition and makes no guess',
      !/sepsis|meningitis|infection|virus|bacterial|probably|likely|might be|could be/i.test(fev.answer || ''), fev.answer);
    ok('it does not tell her off for waiting', !/should have|you failed|too late|why did/i.test(fev.text), fev.text);
    const shared = await page.evaluate(() => {
      if (typeof FEVER_UNDER3 !== 'string' || !ASK_URGENT['baby-fever']) return { absent: true };
      return { card: ASK_URGENT['baby-fever'].line.indexOf(FEVER_UNDER3) === 0,
        guide: feverGuidance().indexOf(FEVER_UNDER3) === 0, line: feverGuidance() };
    });
    ok('and the shared sentence is the one feverGuidance uses', shared.card === true, shared);
    ok('feverGuidance still opens with it too', shared.guide === true, shared.line);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'ASK-EMERGENCY: FAIL' : 'ASK-EMERGENCY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
