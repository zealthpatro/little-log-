#!/usr/bin/env node
/* The question a parent asks most, and the answer Cubby refused to give.
 *
 * "Is this normal?" is the repeated job of the first year, and it had no answer anywhere inside the
 * app. Cubby publishes 658 articles, each one carrying a hand-written FAQ, and the only two search
 * fields in the product (glSearch, pglSearch) filter MOMENTS. goodReadCard is pull-only and picks by
 * stage rather than by what she asked. So at 3am, holding a baby, she left Cubby for a search engine
 * and read whatever a forum said. That was the whole failure: the library was already written, in
 * the right voice, and the app could not serve one line of it in response to a question.
 *
 * What this gate holds down, because each of them is a way the fix could be WORSE than the gap:
 *   - it must RETRIEVE, never generate. Every paragraph shown has to be byte-for-byte a published
 *     answer out of app/ask-data.json, and this checks that literally rather than trusting the code.
 *   - it must SAY WHEN IT DOES NOT KNOW instead of showing the nearest thing it found.
 *   - a red-flag phrase must short-circuit to a phone BEFORE any retrieval, and must not answer.
 *   - it must not hand a mother who says she wants to hurt herself a list about baby fevers.
 *   - the corpus must not contain the pregnancy view, which is where every loss article lives.
 *   - the same words twice must give the same answer, because a retriever that drifts is a guesser.
 *
 * And five things it did NOT hold down, each one measured failing in a browser before it was fixed:
 *   - the flag list was written in editorial third person and matched itself, so "blood in my babys
 *     poo" was answered "there is a wide range of normal" instead of reaching a phone (13).
 *   - and then it still only matched one WORD ORDER, so "my babys soft spot is bulging" got the
 *     soft-spot explainer and "her poo has blood in it" got the constipation read (13, 14). Section
 *     13 also had no doctor in its household, so "reaches a phone" was being measured on a card
 *     that had no phone to give: the seed is now part of the assertion.
 *   - nothing tested COVERAGE of the danger, only false positives, so ASK_FLAG_BABY could be cut
 *     from 60 phrases to the 6 this file literally typed and still report PASS (14).
 *   - the retriever volunteered "Is it safe to shake my baby to stop them crying?" to "my baby wont
 *     stop crying", an accusation nobody made, from a phrase the flag list already knew (15).
 *   - "was a confident hit returned" was measured, never "was it the right answer": "mortgage rate"
 *     answered, and a two-month-old's weight answered about one-month-olds (16).
 *   - the sheet heading resolved to no registry row, so the chapter shipped with a dead teach dot
 *     while teach_gate.js stayed green, because it checks labels and never checks a shipped h2 (18).
 *
 *   PORT=9296 node tools/serve.js &
 *   node tools/ask_box_check.js http://localhost:9296
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9296';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 03:00. This feature exists for the middle of the night, so the pinned clock is the middle of the night.
const CLOCK = (() => { const d = new Date(); d.setHours(3, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const WITH_DOC = () => seed({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], allergies: [],
    doctors: [{ id: 'd1', role: 'Pediatrician', name: 'Dr Anand', clinic: 'Jumeirah', phone: '+971 4 555 0101', nextVisit: '' }] }],
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // Counted rather than assumed: the corpus is 836KB and must be fetched ONCE per session, not per ask.
  let corpusFetches = 0;
  page.on('request', (r) => { if (/ask-data\.json/.test(r.url())) corpusFetches++; });
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
  // One ask, end to end, through the real input event the app listens to. Waits for the corpus.
  const EMPTY = { html: '(no ask box)', kick: null, question: null, answer: null, href: null, others: [], tel: [], buttons: [], urgent: false, primaries: [], ghosts: [], disc: '(missing)' };
  const ask = async (q) => {
    const there = await page.evaluate((text) => {
      const el = document.getElementById('askQ');
      if (!el) return false;
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, q);
    if (!there) return EMPTY;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const busy = await page.evaluate(() => {
        const o = document.getElementById('askOut');
        return !o || /Looking through the reads/.test(o.textContent || '');
      });
      if (!busy) break;
    }
    await sleep(120);
    return page.evaluate(() => {
      const o = document.getElementById('askOut');
      const q2 = o.querySelector('.ask-q'), a = o.querySelector('.ask-a');
      const src = o.querySelector('a.ask-src');
      return {
        html: o.innerHTML,
        kick: o.querySelector('.ask-kick') ? o.querySelector('.ask-kick').textContent.trim() : null,
        question: q2 ? q2.textContent : null,
        answer: a ? a.textContent : null,
        href: src ? src.getAttribute('href') : null,
        others: [].slice.call(o.querySelectorAll('.set-item')).map((x) => x.querySelector('.a').textContent),
        tel: [].slice.call(o.querySelectorAll('a[href^="tel:"]')).map((x) => x.getAttribute('href')),
        buttons: [].slice.call(o.querySelectorAll('button')).map((b) => (b.getAttribute('onclick') || '') + '|' + b.textContent.trim()),
        urgent: !!o.querySelector('.ask-urgent'),
        // A filled primary is the biggest thing on the card. On an emergency card it must never be a form.
        primaries: [].slice.call(o.querySelectorAll('.btn-primary')).map((b) => b.textContent.trim()),
        ghosts: [].slice.call(o.querySelectorAll('.btn-ghost')).map((b) => b.textContent.trim()),
        disc: (function () { const d = document.getElementById('askDisc'); return d ? getComputedStyle(d).display : '(missing)'; })(),
      };
    });
  };

  // The corpus, read the same way the app reads it, so "verbatim" is checked against the real file.
  const corpus = await page.evaluate(() => fetch('ask-data.json').then((r) => r.json()));
  const answers = new Set(), questions = new Set(), bySlug = {};
  let pairCount = 0;
  corpus.d.forEach((doc) => { bySlug[doc.s] = doc; doc.q.forEach((p) => { pairCount++; questions.add(p[0]); answers.add(p[1]); }); });

  console.log('\n1. the corpus is what it claims to be');
  ok('it is not empty', corpus.d.length > 200 && pairCount > 1000, { docs: corpus.d.length, pairs: pairCount });
  ok('every doc carries at least one Q&A pair', corpus.d.length > 0 && corpus.d.filter((d) => d.q && d.q.length).length === corpus.d.length,
    corpus.d.filter((d) => !d.q || !d.q.length).map((d) => d.s).slice(0, 5));
  {
    // LOSS SAFETY, checked against the site's own taxonomy rather than a slug guess. Every
    // miscarriage, stillbirth and bereavement read in the library sits under data-view="pregnancy",
    // and none of them may be reachable from a baby-stage ask box.
    const hub = await page.evaluate(() => fetch('/articles/').then((r) => r.text()));
    const preg = new Set();
    const re = /data-view="pregnancy"[^>]*href="\/articles\/([a-z0-9-]+)\//g;
    const re2 = /href="\/articles\/([a-z0-9-]+)\/"[^>]*data-view="pregnancy"/g;
    let m; while ((m = re.exec(hub))) preg.add(m[1]);
    while ((m = re2.exec(hub))) preg.add(m[1]);
    const leaked = corpus.d.map((d) => d.s).filter((s) => preg.has(s));
    ok('the pregnancy view was actually found in the hub (the check can fire)', preg.size > 50, preg.size);
    ok('and not one of its ' + preg.size + ' articles is in the ask corpus', leaked.length === 0, leaked.slice(0, 6));
  }

  console.log('\n2. the door is on Home and on Health, and nowhere it does not belong');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      const home = renderHome();
      go('health');
      const onHealth = document.querySelectorAll('[onclick="openAskBox()"]').length;
      go('home');
      const onHome = document.querySelectorAll('[onclick="openAskBox()"]').length;
      return { homeHtml: /openAskBox\(\)/.test(home), onHealth: onHealth, onHome: onHome };
    });
    ok('Home renders a row that opens it', r.onHome === 1, r);
    ok('Health renders one too', r.onHealth === 1, r);
    /* The pregnancy home cannot be rendered without a pregnancy, so this reads the builder itself.
       Both halves are asserted, so a typo that made BOTH false could not pass as a result. */
    const preg = await page.evaluate(() => ({
      inBaby: String(renderHome).indexOf('askBoxRow()') !== -1,
      inPreg: String(renderPregHome).indexOf('askBoxRow()') !== -1,
    }));
    ok('the baby home is where the row is built', preg.inBaby === true, preg);
    ok('the pregnancy home does NOT build one, because this corpus is the baby library', preg.inPreg === false, preg);
  }

  console.log('\n3. a real question is answered word for word out of the library');
  {
    await load(seed());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const opened = await page.evaluate(() => !!document.getElementById('askQ'));
    ok('tapping the row really opens the box', opened === true);
    const empty = await page.evaluate(() => { const o = document.getElementById('askOut'); return o ? (o.innerHTML || '').trim() : '(no ask box)'; });
    ok('with nothing shown before she types anything', empty === '', empty.slice(0, 80));

    const r = await ask('how many wet nappies should a newborn have');
    /* Not just "an .ask-a exists": the refusal card and all four urgent cards carry one too, so the
       old form of this passed on every card type. It has to be the ANSWER card. */
    ok('it shows an answer', !!r.answer && !!r.question && !r.urgent && /closest question/i.test(r.kick || ''), r.kick);
    ok('the question shown is one Cubby actually published', questions.has(r.question), r.question);
    ok('the answer is that answer, byte for byte, not a summary of it', answers.has(r.answer), (r.answer || '').slice(0, 90));
    ok('and it links to the full read', /^\/articles\/[a-z0-9-]+\/$/.test(r.href || ''), r.href);
    {
      const slug = (r.href || '').split('/')[2];
      const doc = bySlug[slug];
      ok('the link goes to the article the answer came from', !!doc && doc.q.some((p) => p[1] === r.answer), slug);
    }
    ok('it offers more than one, so a near miss is recoverable', r.others.length >= 1, r.others.length);
    ok('and every one of those ' + r.others.length + ' is a published question too',
      r.others.length > 0 && r.others.filter((q) => questions.has(q)).length === r.others.length,
      r.others.filter((q) => !questions.has(q)));
  }

  console.log('\n4. tapping one of the others swaps the answer, still verbatim');
  {
    const before = await page.evaluate(() => { const e = document.querySelector('#askOut .ask-q'); return e ? e.textContent : null; });
    const r = await page.evaluate(() => {
      const s = document.querySelector('#askOut .set-item');
      if (!s) return { q: null, a: null, others: [] };
      s.click();
      const o = document.getElementById('askOut');
      return { q: o.querySelector('.ask-q').textContent, a: o.querySelector('.ask-a').textContent,
        others: [].slice.call(o.querySelectorAll('.set-item')).map((x) => x.querySelector('.a').textContent) };
    });
    ok('the headline question changed', r.q !== before, { before: before, after: r.q });
    ok('the new answer is published text too', answers.has(r.a), (r.a || '').slice(0, 90));
    /* This used to read `r.others >= 1 && !!r.q`, which is the label of one assertion attached to
       the body of another: it never looked inside the list at all, so section 3 passing made it a
       free pass. It now checks the membership its own name claims. */
    ok('and the one now on top is no longer in the list below',
      r.others.length >= 1 && !!r.q && r.others.indexOf(r.q) === -1, { top: r.q, others: r.others });
    ok('and the one that was on top has taken its place in the list', r.others.indexOf(before) !== -1, { was: before, others: r.others });
  }

  console.log('\n5. it says when it does not know, instead of showing the nearest thing');
  {
    const r = await ask('how do i fix my car engine');
    ok('no answer paragraph is presented as an answer', r.question === null, r.question);
    ok('it says so in words', /does not have this one/i.test(r.kick || ''), r.kick);
    ok('it does not quote a published answer anyway', !r.answer || !answers.has(r.answer), (r.answer || '').slice(0, 80));
    ok('and it offers the library instead', /\/articles\//.test(r.html), r.html.slice(0, 200));
  }
  {
    const r = await ask('who won the world cup');
    ok('a second unanswerable question is refused too', r.question === null, r.question);
  }
  {
    const r = await ask('the');
    ok('a query made only of stop words shows nothing at all', r.html.trim() === '', r.html.slice(0, 80));
  }

  console.log('\n6. the same words twice give the same answer');
  {
    const a = await ask('is it normal for my baby to have hiccups');
    const mid = await ask('when can a baby start on finger foods');
    const b = await ask('is it normal for my baby to have hiccups');
    ok('identical question, identical screen', a.html === b.html && !!a.question, { first: a.question, second: b.question });
    // Without this the test above would also pass on a box that never repaints at all.
    ok('and the question asked in between really did change the screen', !!mid.question && mid.html !== a.html, mid.question);
  }

  console.log('\n7. a red flag gives her the phone, not a paragraph');
  {
    await load(WITH_DOC());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const r = await ask('my baby has gone floppy and wont wake');
    ok('the urgent card is what she gets', r.urgent === true, r.html.slice(0, 160));
    ok('NO answer is retrieved at all', r.question === null && (!r.answer || !answers.has(r.answer)), r.question);
    ok('her doctor is one tap away', r.tel.length === 1 && /5550101|555%200101|555\+0101/.test(decodeURIComponent(r.tel[0]).replace(/\s/g, '')), r.tel);
    ok('the warning-signs sheet is offered', r.buttons.filter((b) => /openFeverSafetyNet/.test(b)).length === 1, r.buttons);
    ok('and the local emergency number is named', /emergency number/i.test(r.html), r.html.slice(0, 200));
    /* It opened "Cubby is not going to answer that one out of an article." A parent holding a floppy
       baby is read the product's editorial policy before she is told to call anyone. */
    ok('the first words are what to do, not what Cubby will not do', /^Call your doctor now/.test(r.answer || ''), r.answer);
    ok('and no sentence on it is about what Cubby publishes', !/out of an article|published reads/i.test(r.html), r.html.slice(0, 240));
    /* The footer is a note about publishing policy. Under an emergency card it is Cubby clearing
       its throat. */
    ok('the publishing footnote is not sitting under an emergency', r.disc === 'none', r.disc);
    const sheet = await page.evaluate(() => {
      const b = document.querySelector('#askOut button[onclick="openFeverSafetyNet()"]');
      if (!b) return '(no such button)';
      b.click();
      return document.querySelector('#sheet h2').textContent.trim();
    });
    ok('and it really opens it', /when to call sooner/i.test(sheet), sheet);
  }

  console.log('\n8. with no doctor saved it still gives her somewhere to go');
  {
    await load(seed());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const r = await ask('the baby has stopped breathing');
    ok('still the urgent card', r.urgent === true, r.html.slice(0, 140));
    ok('no broken tel: link is offered', r.tel.length === 0, r.tel);
    ok('it offers to save the number instead', r.buttons.filter((b) => /openDoctor\(\)/.test(b)).length === 1, r.buttons);
    ok('and still no retrieved answer', r.question === null, r.question);
    /* THE BIGGEST BUTTON ON AN EMERGENCY CARD WAS DATA ENTRY. With no number saved this card led
       with a filled red primary reading "Add your doctor's number": a parent holding a baby that has
       stopped breathing, asked to open a form and type. The line already tells her to call, so with
       nothing on file the card now offers no primary at all. */
    ok('nothing on this card is a filled primary', r.primaries.length === 0, r.primaries);
    ok('saving the number is a ghost, not the headline act', r.ghosts.filter((g) => /save your doctor/i.test(g)).length === 1, r.ghosts);
    ok('and it sits below the warning signs, not above them',
      r.ghosts.length === 2 && /call sooner/i.test(r.ghosts[0]) && /save your doctor/i.test(r.ghosts[1]), r.ghosts);
    ok('the line itself carries her to a phone', /Call your doctor now/.test(r.answer || '') && /emergency number/i.test(r.answer || ''), r.answer);
  }

  console.log('\n9. a mother in trouble is not handed a list about fevers, or the wrong phone');
  {
    await load(WITH_DOC());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const r = await ask('i want to hurt myself');
    ok('the urgent card fires', r.urgent === true, r.html.slice(0, 140));
    ok('the fever list is NOT offered', r.buttons.filter((b) => /openFeverSafetyNet/.test(b)).length === 0, r.buttons);
    ok('nothing from the library is quoted at her', r.question === null && !answers.has(r.answer), r.question);
    /* It opened by explaining Cubby's editorial policy and then told her to talk to a person
       "rather than to a search box", which corrects her behaviour at the moment she is least able to
       absorb a correction. The card now opens with her. */
    ok('it opens with her, not with Cubby', /^You should not be holding this alone/.test(r.kick || ''), r.kick);
    ok('and it does not tell her off for using a search box', !/rather than to a search box|out of an article/i.test(r.html), r.html.slice(0, 300));
    ok('it tells her these thoughts are common and treatable', /more common after a baby/i.test(r.answer || '') && /treatable/i.test(r.answer || ''), r.answer);
    ok('and it names someone to tell tonight', /tell your doctor|health visitor/i.test(r.answer || '') && /emergency number/i.test(r.answer || ''), r.answer);
    /* The seeded household HAS a paediatrician with a phone, and the baby card would have offered
       it. Hers is a different emergency and Dr Anand is the baby's doctor, not hers. */
    ok('the baby\'s paediatrician is not offered as her number', r.tel.length === 0, r.tel);
    ok('and it does not push her at the doctor form either', r.buttons.filter((b) => /openDoctor\(\)/.test(b)).length === 0, r.buttons);
    ok('there is no chore of any kind on this card', r.buttons.length === 0 && r.primaries.length === 0, { b: r.buttons, p: r.primaries });
    ok('and the publishing footnote is gone from under it too', r.disc === 'none', r.disc);
  }

  console.log('\n9b. a closed pregnancy\'s midwife is not the answer to a suicidal thought');
  {
    /* Her care team is on file, from a pregnancy that ended when this baby was born. For a
       haemorrhage that team is exactly right. For "i want to hurt myself" it was offering
       "Call Sister Maryam", a clinician whose relationship with this family closed months ago, in
       the same class of mis-targeting the two-list split was written to fix on the baby side. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], allergies: [],
        doctors: [{ id: 'd1', role: 'Pediatrician', name: 'Dr Anand', phone: '+971 4 555 0101' }] }],
      pregnancyArchive: [{ id: 'p1', ownerUid: 'local', endedAt: now - 60 * DAY, loss: false,
        careTeam: [{ id: 'c1', name: 'Nadia Haddad', role: 'Midwife', phone: '+971 4 555 0777' }] }],
    }));
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const mind = await ask('i want to hurt myself');
    ok('with her whole care team on file, still no number at all', mind.tel.length === 0, mind.tel);
    ok('and her ex-midwife is not named on the card', !/Nadia Haddad/.test(mind.html), mind.html.slice(0, 300));

    const body = await ask('i am bleeding heavily and soaking a pad');
    ok('but bleeding is a different emergency and gets a different card', body.urgent === true && !/holding this alone/i.test(body.kick || ''), body.kick);
    ok('it opens with the act, not with Cubby', /^This needs someone now/.test(body.kick || ''), body.kick);
    ok('it names the maternity unit', /maternity unit/i.test(body.answer || '') && /Do not wait/i.test(body.answer || ''), body.answer);
    ok('and HER midwife is the number offered', body.tel.length === 1 && /5550777/.test(decodeURIComponent(body.tel[0]).replace(/[^0-9]/g, '')), body.tel);
    ok('by name', /Nadia Haddad/.test(body.html), body.html.slice(0, 300));
    /* The two cards were byte-identical strings before this split. */
    ok('and the two are not the same card with the same words', body.html !== mind.html, 'identical');

    const baby = await ask('my baby has gone floppy and wont wake');
    ok('while the baby emergency still reaches the paediatrician', baby.tel.length === 1 && /5550101/.test(decodeURIComponent(baby.tel[0]).replace(/[^0-9]/g, '')), baby.tel);
  }

  console.log('\n9c. a parent whose baby has died is not asked to try plainer words');
  {
    /* The pregnancy view is excluded from the corpus, which is right for keeping miscarriage reads
       away from a baby-stage parent, but it also left every bereavement read unreachable. "my baby
       died" fell to the ordinary refusal, which invited her to rephrase her child's death as a
       search term, and "we lost our baby" retrieved "My baby lost weight in the first week." */
    const r = await ask('my baby died');
    ok('this is not answered as a search at all', r.urgent === true && r.question === null, { urgent: r.urgent, q: r.question });
    ok('and it says so', /^This one is not a search/.test(r.kick || ''), r.kick);
    ok('it does not ask her to try different words', !/different words|plainer words|closely enough/i.test(r.html), r.html.slice(0, 300));
    ok('it offers a person rather than an article', /put you in touch/i.test(r.answer || '') && !/\/articles\//.test(r.html), r.answer);
    ok('and asks nothing of her tonight', r.buttons.length === 0 && r.primaries.length === 0 && r.tel.length === 0, { b: r.buttons, t: r.tel });
    const b = await ask('we lost our baby');
    ok('"we lost our baby" is the same card, not a weight-gain read', b.urgent === true && b.question === null, b.question);
    const s = await ask('stillbirth');
    ok('and so is stillbirth', s.urgent === true && s.question === null, s.question);
    /* Deliberately NOT flagged: these two are what a frightened but not bereaved parent types when
       she is reading about prevention, and a bereavement card would be its own cruelty. */
    const sids = await ask('how do i reduce the risk of sids');
    ok('but reading about reducing the risk of SIDS is not a bereavement', sids.urgent === false && questions.has(sids.question), sids.question);
  }

  console.log('\n10. the flag list matches whole phrases, not words inside other questions');
  {
    await load(WITH_DOC());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const a = await ask('what are the choking hazards when starting solids');
    ok('a weaning question is answered, not escalated', a.urgent === false && questions.has(a.question), { urgent: a.urgent, q: a.question });
    const b = await ask('when should i be fitting the next car seat');
    ok('fitting a car seat is not a seizure', b.urgent === false, b.html.slice(0, 140));
    /* The widened list has to stay narrow in the other direction. Every one of these contains a word
       the list cares about, and not one of them is an emergency. */
    const calm = [
      ['when does the umbilical cord fall off', 'a cord falling off is not a fall'],
      ['my baby fell off the growth chart', 'falling off a growth chart is not falling off the sofa'],
      ['does the heel prick test hurt my baby', 'asking whether a test hurts is not a thought about harming her baby'],
      ['can too much vitamin d harm my baby', 'nor is asking whether a vitamin can harm one'],
      ['is it normal for a rash to fade when pressed', 'a rash that DOES fade is the reassuring case, not the emergency one'],
      ['my baby fell asleep on me', 'falling asleep is not a fall either'],
      /* The order-free pairs widened the net a long way, so this is the other half of that fix.
         Every line below shares BOTH halves of a pair with a real emergency, or shares a word with
         one, and each was measured against the pairs before it was written down. */
      ['will there be a blood test at the six week check', 'a blood test is not blood in a nappy'],
      ['does my sick baby need a blood test', 'and a sick baby needing a blood test is not blood in the sick'],
      ['will a sick baby need blood work', 'nor is blood work on one'],
      ['does the blood spot screening hurt', 'nor is the blood spot card'],
      ['how do i take my babys blood sugar', 'nor is a blood sugar reading'],
      ['is it normal to see blood in breast milk', 'and blood in milk is a question about her, not an emergency card'],
      ['i dropped a dummy on the floor', 'a dropped dummy is not a dropped baby'],
      ['my babys head circumference has dropped off the centile chart', 'and dropping off a centile is not a fall on the head'],
      ['how do i stop my baby rolling off the changing mat', 'asking how to PREVENT a fall is not reporting one'],
      ['when do babies start rolling over', 'rolling over is a milestone'],
      ['when does the fontanelle close', 'a fontanelle question is not a bulging one'],
      ['is it normal for the soft spot to pulse', 'nor is a pulsing soft spot'],
      ['is it normal for a rash to blanch', 'a rash that blanches is the reassuring case'],
      ['why is my baby not waking for feeds at night', 'not waking FOR FEEDS is a sleep question, not a baby who will not wake'],
      ['green poo in the nappy', 'a nappy question with no blood in it stays a nappy question'],
      ['why does my baby throw up milk', 'and being sick with no blood in it stays a feeding question'],
    ];
    for (const [q, name] of calm) {
      const r = await ask(q);
      ok(name, r.urgent === false, { q: q, kick: r.kick });
    }
  }

  console.log('\n11. it survives a reload and does not refetch the corpus every ask');
  {
    const before = corpusFetches;
    await ask('when do babies sleep through the night');
    ok('a further ask fetched nothing more', corpusFetches === before, { before: before, after: corpusFetches });
    await load(seed());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const r = await ask('how much tummy time does a baby need');
    ok('after a reload it still answers', answers.has(r.answer), (r.answer || '').slice(0, 80));
    ok('and it did go back for the corpus once', corpusFetches > before, { before: before, after: corpusFetches });
  }

  console.log('\n11b. closing and reopening the box starts clean');
  {
    const stale = await page.evaluate(() => {
      closeSheet();
      const d = document.querySelector('[onclick="openAskBox()"]');
      if (d) d.click();
      const o = document.getElementById('askOut');
      const box = document.getElementById('askQ');
      return { out: o ? (o.innerHTML || '').trim() : '(gone)', value: box ? box.value : '(gone)' };
    });
    ok('the previous answer is not still sitting there', stale.out === '', stale.out.slice(0, 120));
    ok('and the box is empty', stale.value === '', stale.value);
    // Proves the emptiness above is a reset and not a box that simply stopped working.
    const again = await ask('how much tummy time does a baby need');
    ok('it still answers on the second visit', answers.has(again.answer), (again.answer || '').slice(0, 70));
  }

  console.log('\n12. nothing here reads the baby');
  {
    // A different household, a different baby, no events at all: the answer must be identical,
    // because a retriever that varies with her data has started being about her case.
    const first = await page.evaluate(() => { const e = document.querySelector('#askOut .ask-a'); return e ? e.textContent : null; });
    await load(seed({ babies: [{ id: 'b9', name: 'Wren', birth: now - 400 * DAY, sex: 'M', routines: [], doctors: [], allergies: [] }], activeBabyId: 'b9',
      events: [{ id: 'e1', type: 'feed', babyId: 'b9', method: 'bottle', amount: 120, unit: 'ml', time: now - 2 * HOUR, authorId: 'local' }] }));
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const r = await ask('how much tummy time does a baby need');
    ok('a 13-month-old in another household gets the same paragraph', !!first && r.answer === first, { a: (first || '').slice(0, 60), b: (r.answer || '').slice(0, 60) });
  }

  console.log('\n13. the red flags match the way a parent types, not only the way an editor writes');
  {
    /* THE REPRODUCED FAILURE. The list was written in editorial third person and matched on whole
       phrases, so it only ever matched itself. "there is blood in their poo" escalated; "there is
       blood in my babys poo", which is how a parent actually types it, fell through to retrieval and
       came back with "There is a wide range of normal... Frequency alone is not a reliable sign of
       constipation" out of the constipation read, with no phone on the screen at all. Six of
       fourteen ordinary first-person phrasings of dangers ALREADY NAMED in the list did not
       escalate. Each line below is one of those phrasings, end to end through the real input.
       THE SEED IS PART OF THE ASSERTION. This block used to inherit section 12's household, which
       has no doctor on file, so "reaches a phone" was being measured on a card that could not put a
       phone on the screen. It loads its own household with a paediatrician, the same one section 7
       uses, and asserts the tel: link is really there. */
    await load(WITH_DOC());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(250);
    const first = [
      'there is blood in their poo',
      'there is blood in my babys poo',
      'blood in my babys stool',
      "blood in my baby's nappy",
      'blood in her nappy',
      'my baby vomited blood',
      'my baby threw up blood',
      'my baby has a rash that will not fade',
      'my baby has fallen off the sofa',
      'my baby fell off the changing table',
      'i dropped my baby',
      /* And these are the same dangers again with the words in the order a parent puts them, which
         is the order a phrase list can never anticipate. Every one of them was measured falling
         through to a retrieved article before the order-free pairs went in. */
      'her poo has blood in it',
      'there is blood when she poos',
      'blood when she threw up',
      'my baby was sick and there was blood in it',
      'i found blood in the nappy',
      'streaks of blood in her poo',
      'my babys soft spot is bulging',
      'my babys neck is stiff',
      'the rash doesnt fade when i press a glass on it',
      'her rash does not go away when pressed',
      'i dropped her on her head',
      'she fell from the changing table',
      'my baby rolled off the changing table',
      'she is not waking up',
      'she had a fit',
    ];
    for (const q of first) {
      const r = await ask(q);
      ok('"' + q + '" reaches a phone', r.urgent === true && r.question === null && r.tel.length === 1, { urgent: r.urgent, answered: r.question, tel: r.tel });
    }
  }

  console.log('\n14. the danger the list names is the danger it catches');
  {
    /* Section 7/8/9 only ever typed phrases that were already in the list verbatim, so cutting
       ASK_FLAG_BABY from 60 phrases to the 6 the gate literally typed left it at 57 passed, 0
       failed while blue lips, seizure, meningitis, a non-blanching rash, a bulging fontanelle, a
       button battery, blood in vomit and a head injury all quietly stopped escalating. These are
       typed the way a frightened parent types them, one per danger, so gutting the list goes red. */
    const dangers = [
      ['my babys lips are turning blue', 'blue lips'],
      ['my baby had a seizure', 'a seizure'],
      ['i think my baby has meningitis', 'meningitis'],
      ['my baby has a rash that does not fade when i press a glass on it', 'a non-blanching rash'],
      ['my babys soft spot is bulging', 'a bulging fontanelle'],
      ['she swallowed a button battery', 'a button battery'],
      ['there is blood in the vomit', 'blood in vomit'],
      ['my baby hit their head on the floor', 'a head injury'],
      ['my baby is choking', 'choking'],
      ['my baby is unresponsive', 'unresponsive'],
      ['my baby has stopped breathing', 'stopped breathing'],
      ['my baby has gone floppy', 'a floppy baby'],
      ['my babys neck is stiff', 'a stiff neck'],
      ['her neck seems stiff', 'a stiff neck said another way'],
      ['she wont bend her neck', 'a neck she will not bend'],
      ['the soft spot on his head is bulging', 'a bulging fontanelle said another way'],
      ['my baby is struggling to breathe', 'struggling to breathe'],
    ];
    for (const [q, name] of dangers) {
      const r = await ask(q);
      ok(name + ' escalates', r.urgent === true && r.question === null, { q: q, urgent: r.urgent, answered: r.question });
    }
  }

  console.log('\n15. what Cubby refuses to answer, it also refuses to volunteer');
  {
    /* "my baby wont stop crying" is the most ordinary sentence of the first year, and it retrieved
       "Is it safe to shake my baby to stop them crying? / Never shake your baby..." under the kicker
       "the closest question in Cubby's reads". Cubby volunteered an accusation nobody made, at 3am,
       to the parent least able to take it. `shake my baby` was already in the flag list: the author
       knew the phrase was dangerous to answer and let the retriever hand it out unprompted. */
    for (const q of ['my baby wont stop crying', 'why is my baby crying so much', 'my baby cries all night']) {
      const r = await ask(q);
      ok('"' + q + '" is not answered with shaking', !/shake|shaking|shaken/i.test(r.html), (r.question || '') + ' | ' + (r.answer || '').slice(0, 80));
      ok('and it is still answered out of the library', r.urgent === false && questions.has(r.question), r.question);
    }
    const ix = await page.evaluate(() => {
      const bad = [], keep = [];
      ASK_INDEX.chunks.forEach((c) => { const f = askFlag(c.q); if (f === 'parent-mind' || f === 'loss') bad.push(c.q); });
      ASK_INDEX.chunks.forEach((c) => { if (askFlag(c.q) === 'baby') keep.push(c.q); });
      return { bad: bad, keep: keep.length, n: ASK_INDEX.n, dropped: ASK_INDEX.dropped };
    });
    ok('not one retrievable question imputes an act or a death to her', ix.bad.length === 0, ix.bad.slice(0, 4));
    ok('and the censoring really did remove something', ix.dropped >= 1, ix.dropped);
    /* The other direction, because the first cut of this dropped every flagged question and cost
       real answers: a question about the baby's state is the library working, not an accusation. */
    ok('but a safety read about the baby is still reachable', ix.keep >= 3, ix.keep);
    ok('and the corpus did not lose more than a handful to it', ix.n > 1900 && ix.dropped < 20, { n: ix.n, dropped: ix.dropped });
  }

  console.log('\n16. it does not answer a question she did not ask');
  {
    /* The report measured "did a confident hit come back", never "was it the right answer". */
    const junk = [
      ['mortgage rate', 'a mortgage rate is not grandmother support improving breastfeeding rates'],
      ['football scores', 'a football score is not the Apgar score'],
      ['should i be worried', 'a query made only of worry has no topic to retrieve against'],
      ['baby sleep', 'two of the commonest words in the corpus are not a question'],
      ['sleep', 'and neither is one of them on its own'],
    ];
    for (const [q, name] of junk) {
      const r = await ask(q);
      ok(name, r.question === null && /does not have this one/i.test(r.kick || ''), { q: q, got: r.question });
    }
    /* Positive controls, so "refuse everything" cannot pass this section. */
    for (const q of ['cradle cap', 'colic', 'teething']) {
      const r = await ask(q);
      ok('"' + q + '" is still answered word for word', answers.has(r.answer) && questions.has(r.question), r.question);
    }
    /* "how much should my 2 month old weigh" was answered "Most one-month-olds weigh between 4 and
       5 kg", a specific kilogram range in serif headline type, for an age that is not her baby's. */
    const w = await ask('how much should my 2 month old weigh');
    ok('a question about a two-month-old is not answered about one-month-olds', !/one.month.old/i.test(w.html), (w.question || '') + ' | ' + (w.answer || '').slice(0, 90));
    ok('and if it does answer, it is still published text', !w.question || answers.has(w.answer), (w.answer || '').slice(0, 80));
    const six = await ask('how many wet nappies should a 6 week old have');
    ok('while naming an age does not cost her the answer she came for', /nappies/i.test(six.question || '') && answers.has(six.answer), six.question);
  }

  console.log('\n17. no em-dash reaches a Cubby screen');
  {
    /* Quoting verbatim shipped the corpus's punctuation too, and four pairs carry em-dashes. The
       house voice has none, and one of the four was reachable from an ordinary query. The articles
       are not edited here; the index the app reads from is where it is fixed. */
    let dashes = 0;
    corpus.d.forEach((d) => d.q.forEach((p) => { if (/[—–]/.test(p[0]) || /[—–]/.test(p[1])) dashes++; }));
    ok('not one of the ' + pairCount + ' pairs carries an em-dash or an en-dash', dashes === 0, dashes);
    ok('and the four that did now read as sentences', questions.has('My baby will only sleep on me. Is something wrong?')
      && questions.has('My baby is 14 months and not walking. Should I be worried?'), 'not rewritten');
  }

  console.log('\n18. the chapter can be learned from the sheet it lives in');
  {
    /* Registry label is "Ask a question", the sheet ships <h2>Ask Cubby</h2>, and normLabel resolves
       neither to the other, so sheetDot returned the html untouched and the whole chapter had no
       "i" on it. teach_gate.js passed throughout: it checks label uniqueness, never that a shipped
       <h2> resolves to a row. */
    await load(seed());
    await page.evaluate(() => { const d = document.querySelector('[onclick="openAskBox()"]'); if (d) d.click(); });
    await sleep(300);
    const dot = await page.evaluate(() => {
      const h = document.querySelector('#sheet h2');
      return { h2: h ? h.textContent.trim() : '(no sheet)', dot: !!(h && h.querySelector('.lg-i')) };
    });
    ok('the sheet heading carries its explainer dot', dot.dot === true, dot);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'ASK-BOX: FAIL' : 'ASK-BOX: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
