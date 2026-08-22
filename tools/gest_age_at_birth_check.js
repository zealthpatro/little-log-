#!/usr/bin/env node
/* WHAT WAS WRONG FOR A REAL PARENT
 *
 * welcomeBaby() held the due date and the birth timestamp in the same function and threw the
 * difference between them away, and grepping the baby stage for gestation, corrected, preterm or
 * premature returned nothing at all. So for a mother whose baby arrived eight weeks early, every
 * age Cubby stated was the wrong age:
 *
 *   THE GROWTH CHART plotted her son against WHO curves built from babies who reached 40 weeks, at
 *   his birthday age. A perfectly-tracking 32-weeker was drawn below the 5th band for months, with
 *   no explanation and nothing to tap, on the screen a parent opens after a weigh-in.
 *
 *   THE MILESTONE NUDGE measured from the birthday too, so she was handed a rolling list of things
 *   babies "are working on around now" that her baby was two months short of, forever.
 *
 *   THE FEVER RULE, the one clinical line in the baby stage where an age error costs something
 *   real, dropped "under 3 months, any fever is worth a prompt call" eight weeks early, because it
 *   asked how long he had been alive rather than how old he was.
 *
 * The fix is one optional field, weeks and days, pre-filled from her own due date, plus corrected
 * age wherever the answer depends on it and a plain sentence saying which age is on screen. A term
 * baby is 40 weeks and nothing changes, and a baby born LATE is never aged down.
 *
 *   PORT=<your own free port> node tools/serve.js &
 *   node tools/gest_age_at_birth_check.js http://127.0.0.1:<that port>
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/gest_age_at_birth_check.js http://127.0.0.1:<port>\n(no default port: a default silently grades whatever tree happens to be listening)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 10:00, well clear of any midnight boundary, so a day-count never depends on when the gate ran.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const baby = (over) => Object.assign({
  id: 'b1', name: 'Robin', birth: now - 120 * DAY, sex: 'F', routines: [], doctors: [], allergies: [],
}, over || {});

const seed = (over) => Object.assign({
  babies: [baby()], activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// A weight measurement `d` days after the birth, in the shape saveGrowth writes.
const growthAt = (id, birth, d, kg) => ({ id: id, type: 'growth', babyId: 'b1', time: birth + d * DAY, weight: kg, wUnit: 'kg', authorId: 'local' });

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

  /* A gate has to be able to report "that behaviour is not here" as a failed assertion. Run this
     file against the tree before the fix and every probe throws ReferenceError on the first missing
     helper, which exits 2 and prints no counts at all, so nobody can watch it go red. `ev` turns a
     dead page into a poisoned result instead: every property comes back undefined, so the
     assertions below fail one by one and say so. Negative assertions are written to require a real
     value of the right type, because "no due date was mentioned" is also true of a page that never
     loaded. */
  const missing = [];
  const ev = async (fn, ...args) => {
    try { return await page.evaluate(fn, ...args); }
    catch (e) {
      const m = String((e && e.message) || e).split('\n')[0];
      missing.push(m);
      return { __missing: m };
    }
  };
  const str = (v) => typeof v === 'string' ? v : '';
  const obj = (v) => (v && typeof v === 'object') ? v : {};
  const arr = (v) => Array.isArray(v) ? v : [];
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-growthage:') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
  };
  // The growth chart lives on Log > Stats, and renderStats short-circuits to an empty state with no
  // events at all, so every chart assertion below seeds real measurements first.
  const openStats = async () => {
    await page.evaluate(() => { go('log'); logTab = 'stats'; render(); });
    await sleep(400);
  };
  /* DURABILITY, THE ONLY WAY THIS HARNESS CAN HONESTLY ASK FOR IT.
     store-firebase.js:2155 replaces the app's persist() with the cloud push, and it does that on the
     ?e2e=1 boot too, where pushNow() returns immediately because there is no household ref. So under
     this harness persist() writes nothing anywhere, and a gate that reloaded and found its value
     gone would be reporting on the harness, not the product. Store.save is the app's own serializer,
     the same one the cloud blob is built from, so driving it directly asks the real question: is the
     number on the baby record that gets written and read back, or only on something transient? */
  const saveAndReload = async () => {
    await page.evaluate(async () => { await Store.save(state); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
  };

  console.log('\n1. a term baby is exactly as she was before this shipped');
  {
    await load(seed());
    const r = await ev(() => ({
      corr: correctionDays(),
      same: Math.abs(correctedMonths() - babyMonths()) < 1e-9,
      chron: babyAgeMonths(now()),
      raw: (now() - activeBaby().birth) / 2629800000,
      line: growthAgeLine(),
      fever: feverGuidance(),
    }));
    ok('nothing is corrected', r.corr === 0, r.corr);
    ok('corrected months is chronological months', r.same === true, r);
    ok('the chart plots chronological age', Math.abs(r.chron - r.raw) < 1e-9, r);
    ok('no caption about ages appears', r.line === '', r.line);
    /* Item 27 replaced the duration sentence this used to look for. Asserting the old text here
       would quietly demand a live safety fix be reverted, so it asserts the wording that shipped. */
    ok('a four-month-old gets the ordinary fever wording',
      /how they seem in themselves/i.test(r.fever) && !/under 3 months/i.test(r.fever), r.fever);
    ok('and never the duration item 27 removed', !/day or two/i.test(r.fever), r.fever);
    ok('and it says nothing about a due date', !!str(r.fever) && !/due date/i.test(r.fever), r.fever);
  }

  console.log('\n2. gestation typed as 40 weeks changes nothing');
  {
    await load(seed({ babies: [baby({ gestWeeks: 40, gestDays: 0 })] }));
    const r = await ev(() => ({
      corr: correctionDays(), line: growthAgeLine(),
      chron: babyAgeMonths(now()), raw: (now() - activeBaby().birth) / 2629800000,
    }));
    ok('40 + 0 corrects by nothing', r.corr === 0, r.corr);
    ok('and draws no caption', r.line === '', r.line);
    ok('and leaves the plotted age alone', Math.abs(r.chron - r.raw) < 1e-9, r);
  }

  console.log('\n3. a baby born late is never aged DOWN');
  {
    // 2.9 months old, born at 41 + 3. A signed correction would push her to 3.2 corrected months and
    // silently take away the under-three-months line she is entitled to today.
    await load(seed({ babies: [baby({ birth: now - 88 * DAY, gestWeeks: 41, gestDays: 3 })] }));
    const r = await ev(() => ({
      corr: correctionDays(), months: babyMonths(), cmo: correctedMonths(), fever: feverGuidance(),
    }));
    ok('the correction is floored at zero', r.corr === 0, r.corr);
    ok('she is still under three months', r.months < 3 && r.cmo < 3, r);
    ok('so she keeps the under-three-months line', /under 3 months/i.test(r.fever), r.fever);
  }

  console.log('\n4. the growth chart plots corrected age, says so, and can be switched');
  {
    const birth = now - 122 * DAY;   // four months old, born eight weeks early
    await load(seed({
      babies: [baby({ birth: birth, gestWeeks: 32, gestDays: 0 })],
      events: [growthAt('g1', birth, 70, 4.1), growthAt('g2', birth, 118, 5.2)],
    }));
    const r = await ev(() => ({
      corr: correctionDays(),
      plotted: babyAgeMonths(now()),
      raw: (now() - activeBaby().birth) / 2629800000,
      mode: growthAgeMode(),
    }));
    ok('eight weeks of correction', r.corr === 56, r.corr);
    ok('corrected is the default', r.mode === 'corrected', r.mode);
    ok('the plotted age is 56 days younger', Math.abs((r.raw - r.plotted) - (56 * 86400000 / 2629800000)) < 1e-6, r);

    await openStats();
    const before = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /corrected age/i.test(n.textContent || ''));
      const svg = document.querySelector('#scroll .growth-line');
      const dots = svg ? Array.from(svg.querySelectorAll('circle')).map((c) => +c.getAttribute('cx')) : [];
      return {
        text: el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '',
        btn: el ? !!el.querySelector('button') : false,
        btnText: el && el.querySelector('button') ? el.querySelector('button').textContent.trim() : '',
        dots: dots,
      };
    });
    ok('the caption names corrected age', /plotted at corrected age/i.test(before.text), before.text);
    ok('and names the due date it counts from', /due date/i.test(before.text), before.text);
    ok('and says how early she was', /due date, 8 weeks after they arrived\./i.test(before.text), before.text);
    ok('there is a control to switch', before.btn === true, before);
    ok('labelled as a whole sentence, not a lowercase fragment', before.btnText === 'Show their actual age instead.', before.btnText);
    ok('both measurements are on the chart', before.dots.length === 2, before.dots);

    const after = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /corrected age/i.test(n.textContent || ''));
      el.querySelector('button').click();
      return null;
    });
    await sleep(400);
    const flipped = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /actual age|corrected age/i.test(n.textContent || ''));
      const svg = document.querySelector('#scroll .growth-line');
      return {
        text: el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '',
        stored: localStorage.getItem('cubby-growthage:local:b1'),
        onRecord: activeBaby().growthAge,
        plotted: babyAgeMonths(now()),
        raw: (now() - activeBaby().birth) / 2629800000,
        dots: svg ? Array.from(svg.querySelectorAll('circle')).map((c) => +c.getAttribute('cx')) : [],
      };
    });
    ok('tapping it switches to actual age', /plotted at actual age/i.test(flipped.text), flipped.text);
    ok('and the chart really replots there', Math.abs(flipped.plotted - flipped.raw) < 1e-9 && flipped.plotted > r.plotted, { flipped: flipped, corrected: r.plotted });
    ok('the dots moved right', flipped.dots.length === 2 && flipped.dots[0] > before.dots[0] && flipped.dots[1] > before.dots[1], { before: before.dots, after: flipped.dots });
    ok('the choice is written down', flipped.stored === 'actual', flipped.stored);
    /* PER PERSON, not per household. state.babies rides out whole in appBlobFromState(), so a mode
       parked on the baby record reflipped the co-parent's chart on their own phone. */
    ok('and kept off the circle-shared baby record', flipped.onRecord === undefined, flipped.onRecord);
    ok('and the way back is offered', /Show their corrected age instead\./.test(flipped.text), flipped.text);

    await saveAndReload();
    await openStats();
    const kept = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /actual age|corrected age/i.test(n.textContent || ''));
      return { text: el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '', mode: growthAgeMode() };
    });
    ok('and survives a reload', kept.mode === 'actual' && /plotted at actual age/i.test(kept.text), kept);
  }

  console.log('\n5. correcting stops at 24 months corrected');
  {
    // Born eight weeks early. At 25 chronological months she is 23.2 corrected: still inside the
    // convention. At 27 she is past it, and correcting one baby forever would leave her chart
    // disagreeing with the clinic's.
    await load(seed({ babies: [baby({ birth: now - Math.round(25 * 30.4375) * DAY, gestWeeks: 32, gestDays: 0 })] }));
    const inside = await ev(() => ({
      corr: growthCorrectionMonths(), plotted: babyAgeMonths(now()), raw: (now() - activeBaby().birth) / 2629800000, able: growthCorrectable(),
    }));
    ok('at 23 months corrected it still corrects', inside.able === true && inside.corr > 1.8, inside);
    ok('and the plotted age is shifted', inside.raw - inside.plotted > 1.8, inside);

    await load(seed({ babies: [baby({ birth: now - Math.round(27 * 30.4375) * DAY, gestWeeks: 32, gestDays: 0 })] }));
    const outside = await ev(() => ({
      corr: growthCorrectionMonths(), plotted: babyAgeMonths(now()), raw: (now() - activeBaby().birth) / 2629800000,
      able: growthCorrectable(), line: growthAgeLine(),
    }));
    ok('past 24 months corrected it stops', outside.able === false && outside.corr === 0, outside);
    ok('the chart is back on chronological age', Math.abs(outside.plotted - outside.raw) < 1e-9, outside);
    ok('and the caption goes quiet', outside.line === '', outside.line);
  }

  console.log('\n6. weigh-ins from before the due date are accounted for, not silently dropped');
  {
    // Born at 30 weeks, ten weeks early, now 90 days old. The day-zero birth weight sits ten weeks
    // BEFORE her due date, which is off the left edge of a term curve.
    const birth = now - 90 * DAY;
    await load(seed({
      babies: [baby({ birth: birth, gestWeeks: 30, gestDays: 0 })],
      events: [Object.assign(growthAt('g0', birth, 0, 1.4), { birthWeight: true }), growthAt('g1', birth, 80, 3.6)],
    }));
    await openStats();
    const r = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /corrected age/i.test(n.textContent || ''));
      const svg = document.querySelector('#scroll .growth-line');
      return {
        dropped: growthDroppedPoints(),
        dots: svg ? svg.querySelectorAll('circle').length : -1,
        text: el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '',
      };
    });
    ok('the pre-due-date weigh-in is off the term curve', r.dropped === 1, r);
    ok('so one dot is drawn, not two', r.dots === 1, r);
    ok('and the caption says where the other one went', /1 measurement from before the due date sits off the start of this curve\./.test(r.text), r.text);
    /* The 3am question the old wording left open: a mother watches three dots become one and is
       told only that two "are not on this curve". Nothing said they still existed. */
    ok('and that it is still saved', /It is still saved in the log\./.test(r.text), r.text);

    await ev(() => { toggleGrowthAge(); });
    await sleep(400);
    const back = await ev(() => {
      const el = Array.from(document.querySelectorAll('#scroll .csub')).find((n) => /actual age|corrected age/i.test(n.textContent || ''));
      const svg = document.querySelector('#scroll .growth-line');
      return { dropped: growthDroppedPoints(), dots: svg ? svg.querySelectorAll('circle').length : -1, text: el ? el.textContent : '' };
    });
    ok('switching to actual age brings it back', back.dropped === 0 && back.dots === 2, back);
    ok('and the missing-measurement clause goes with it', !!str(back.text) && !/off the start of this curve/i.test(back.text), back.text);
  }

  console.log('\n7. the milestone nudge counts from the due date');
  {
    const birth = now - 244 * DAY;   // eight months old
    const photo = { id: 'p1', babyId: 'b1', photoId: 'ph1', time: now - DAY };
    await load(seed({ babies: [baby({ birth: birth })], photos: [photo] }));
    const term = await ev(() => renderNudge().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    await load(seed({ babies: [baby({ birth: birth, gestWeeks: 32, gestDays: 0 })], photos: [photo] }));
    const pre = await ev(() => ({
      text: renderNudge().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      cmo: correctedMonths(), mo: babyMonths(),
    }));
    const title = (s) => { const m = str(s).match(/working on "([^"]+)"/); return m ? m[1] : null; };
    ok('the term baby gets a milestone', !!title(term), term);
    ok('and no talk of a due date', !!str(term) && !/due date/i.test(term), term);
    ok('the preterm baby is measured from the due date', pre.mo - pre.cmo > 1.7, pre);
    ok('so she is offered a different milestone', !!title(pre.text) && title(pre.text) !== title(term), { term: title(term), pre: title(pre.text) });
    ok('and the nudge says why, not just what', /Robin arrived early, so we're counting from their due date\./.test(pre.text), pre.text);
    ok('without losing the every-baby-in-their-own-time line', /own time/i.test(pre.text), pre.text);
  }

  console.log('\n8. the fever rule follows the due date, and only ever widens');
  {
    const b105 = now - 105 * DAY;    // 3.45 chronological months
    await load(seed({ babies: [baby({ birth: b105 })] }));
    const term = await ev(() => feverGuidance());
    ok('a term three-and-a-half-month-old gets the ordinary wording', /how they seem in themselves/i.test(str(term)) && !/under 3 months/i.test(term), term);

    await load(seed({ babies: [baby({ birth: b105, gestWeeks: 32, gestDays: 0 })] }));
    const pre = await ev(() => ({ g: feverGuidance(), cmo: correctedMonths(), mo: babyMonths() }));
    ok('the same age born eight weeks early is 1.6 months corrected', pre.cmo < 2 && pre.mo > 3, pre);
    ok('so the prompt-call line still applies', /under 3 months, any fever/i.test(pre.g), pre.g);
    ok('and it explains why, in one clause', /counting from Robin's due date/i.test(pre.g), pre.g);

    // 5.4 chronological months, 3.5 corrected: the rule has genuinely run out, and saying otherwise
    // would be Cubby inventing a clinical window of its own.
    await load(seed({ babies: [baby({ birth: now - 165 * DAY, gestWeeks: 32, gestDays: 0 })] }));
    const over = await ev(() => ({ g: feverGuidance(), cmo: correctedMonths() }));
    ok('past three months corrected the rule ends', over.cmo > 3 && /how they seem in themselves/i.test(str(over.g)) && !/under 3 months/i.test(over.g), over);

    // The sheet a parent actually reads, not just the string.
    await load(seed({ babies: [baby({ birth: b105, gestWeeks: 32, gestDays: 0 })] }));
    const sheet = await ev(() => {
      openFeverNudge(38.4, 'C');
      const el = document.querySelector('.sheet') || document.querySelector('#sheet');
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    });
    ok('and the fever sheet on screen carries it', /under 3 months, any fever/i.test(sheet) && /due date/i.test(sheet), sheet.slice(0, 240));
  }

  console.log('\n9. the birth handover asks once, pre-filled from her own due date');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 56 * DAY, lmp: null, country: 'uk' },
    }));
    const shown = await ev(() => {
      openWelcomeBaby();
      const w = document.getElementById('wbGw'), d = document.getElementById('wbGd');
      return { w: w ? w.value : null, d: d ? d.value : null, auto: w ? w.getAttribute('data-auto') : null,
        label: (function () { const f = w && w.closest('.field'); return f ? f.querySelector('label').textContent : ''; })() };
    });
    ok('the field is there', shown.w !== null, shown);
    ok('pre-filled at 32 weeks', shown.w === '32', shown);
    ok('and 0 days', shown.d === '0', shown);
    ok('marked as Cubby\'s guess, not hers', shown.auto === '1', shown);
    ok('and it is optional in the label', /optional/i.test(shown.label), shown.label);

    const saved = await ev(() => {
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return { name: b.name, gw: b.gestWeeks, gd: b.gestDays, corr: correctionDays(b) };
    });
    ok('welcoming the baby stores the gestation', saved.gw === 32 && saved.gd === 0, saved);
    ok('and it corrects by eight weeks', saved.corr === 56, saved);
  }

  console.log('\n10. moving the birth date re-derives a guess she never touched');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 14 * DAY, lmp: null, country: 'uk' },
    }));
    const r = await ev(() => {
      openWelcomeBaby();
      const shown = document.getElementById('wbGw').value;
      // She is welcoming a baby born three weeks ago, so the sheet's opening guess is stale.
      setWhen('when', now() - 21 * 86400000);
      const after = { w: document.getElementById('wbGw').value, d: document.getElementById('wbGd').value };
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return { shown: shown, after: after, gw: b.gestWeeks, gd: b.gestDays };
    });
    ok('the sheet opened at 38 weeks', r.shown === '38', r);
    /* THE SCREEN AND THE STORED NUMBER ARE ONE FACT. The box used to keep the opening guess on
       screen forever while a different figure went to the record, so a mother could read
       "42 weeks + 6 days" and have 28 + 0 saved, or type one digit and have the stale guess saved
       instead. Asserting the store alone wrote that divergence down as correct. */
    ok('the box on screen follows the birth date she picked', obj(r.after).w === '35' && obj(r.after).d === '0', r.after);
    ok('and the stored figure is the same number she can see', r.gw === 35 && r.gd === 0 && String(r.gw) === obj(r.after).w, r);
  }

  console.log('\n11. a number she typed herself is hers');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 14 * DAY, lmp: null, country: 'uk' },
    }));
    const r = await ev(() => {
      openWelcomeBaby();
      const w = document.getElementById('wbGw'), d = document.getElementById('wbGd');
      w.value = '34'; w.dispatchEvent(new Event('input', { bubbles: true }));
      d.value = '2'; d.dispatchEvent(new Event('input', { bubbles: true }));
      setWhen('when', now() - 21 * 86400000);
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return { gw: b.gestWeeks, gd: b.gestDays };
    });
    ok('her 34 + 2 is what is stored', r.gw === 34 && r.gd === 2, r);
  }

  console.log('\n12. no due date, no guess');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: null, lmp: null, country: 'uk' },
    }));
    const r = await ev(() => {
      openWelcomeBaby();
      const w = document.getElementById('wbGw');
      const shown = w.value, auto = w.getAttribute('data-auto');
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return { shown: shown, auto: auto, gw: b.gestWeeks, corr: correctionDays(b), line: growthAgeLine() };
    });
    ok('the field is left blank', r.shown === '', r);
    ok('but still marked as Cubby\'s to fill, in case a date arrives', r.auto === '1', r);
    ok('nothing is invented on save', r.shown === '' && r.gw === undefined, r);
    ok('and the baby is treated as term', r.corr === 0 && r.line === '', r);
  }

  console.log('\n13. the parent who joined after the birth can still say it');
  {
    await load(seed({ babies: [baby({ birth: now - 120 * DAY })] }));
    const first = await ev(() => {
      openBirthDetails();
      const w = document.getElementById('dGw'), d = document.getElementById('dGd');
      const blank = w.value === '' && d.value === '';
      w.value = '31'; d.value = '4';
      saveBabyDetails('b1');
      const b = state.babies[0];
      return { blank: blank, gw: b.gestWeeks, gd: b.gestDays, corr: correctionDays(b) };
    });
    ok('the row starts empty for a baby who has none', first.blank === true, first);
    ok('saving details writes 31 + 4', first.gw === 31 && first.gd === 4, first);
    ok('which corrects by 59 days', first.corr === 59, first);

    await saveAndReload();
    const round = await ev(() => {
      const b = state.babies[0];
      openBirthDetails();
      return { gw: b.gestWeeks, gd: b.gestDays, w: document.getElementById('dGw').value, d: document.getElementById('dGd').value };
    });
    ok('it survives a reload', round.gw === 31 && round.gd === 4, round);
    ok('and her own two numbers come back unrounded', round.w === '31' && round.d === '4', round);

    const cleared = await ev(() => {
      document.getElementById('dGw').value = '';
      saveBabyDetails('b1');
      const b = state.babies[0];
      return { gw: b.gestWeeks, gd: b.gestDays, corr: correctionDays(b), fever: feverGuidance() };
    });
    ok('a second save that blanks it clears it', /how they seem in themselves/i.test(str(cleared.fever)) && cleared.gw === undefined && cleared.gd === undefined, cleared);
    ok('and the corrected age goes with it', cleared.corr === 0, cleared);
  }

  console.log('\n14. one baby being early is not another baby being early');
  {
    const birth = now - 105 * DAY;
    await load(seed({
      babies: [
        baby({ id: 'bA', name: 'Ada', birth: birth, gestWeeks: 30, gestDays: 0 }),
        baby({ id: 'bB', name: 'Bo', birth: birth }),
      ],
      activeBabyId: 'bB',
      events: [Object.assign(growthAt('g1', birth, 100, 5.0), { babyId: 'bB' })],
    }));
    const bo = await ev(() => ({ corr: correctionDays(), line: growthAgeLine(), fever: feverGuidance() }));
    ok('the term sibling is not corrected', bo.corr === 0, bo);
    ok('and gets no caption', bo.line === '', bo.line);
    ok('and gets the ordinary fever wording',
      /how they seem in themselves/i.test(str(bo.fever)) && !/under 3 months/i.test(bo.fever), bo.fever);

    const ada = await ev(() => {
      state.activeBabyId = 'bA'; render();
      toggleGrowthAge();
      return {
        corr: correctionDays(),
        aMode: localStorage.getItem('cubby-growthage:local:bA'),
        bMode: localStorage.getItem('cubby-growthage:local:bB'),
        onRecord: state.babies.map((x) => typeof x.growthAge),
        fever: feverGuidance(),
      };
    });
    ok('her preterm sibling is corrected by ten weeks', ada.corr === 70, ada);
    ok('and keeps the under-three-months line', /under 3 months/i.test(ada.fever), ada.fever);
    ok('the age switch is stored on the baby it was tapped for', ada.aMode === 'actual', ada);
    ok('and not on the other one', ada.aMode === 'actual' && ada.bMode === null, ada);
    ok('and on neither shared baby record', arr(ada.onRecord).length === 2 && arr(ada.onRecord).every((v) => v === 'undefined'), ada.onRecord);
  }


  console.log('\n15. the NICU mother, welcoming her baby home weeks past the due date');
  {
    /* THE POPULATION THIS FEATURE EXISTS FOR, and the one it silently skipped. Baby born at 32 + 0,
       eight weeks in NICU, welcomed 49 days PAST the due date. The sheet's opening guess is derived
       from now, which is 329 days of "gestation", out of range, so the box was blank AND carried no
       data-auto mark, so nothing re-derived it against the birth she picked, so gestWeeks was
       deleted and she got a term baby's chart, milestones and fever rule with both numbers sitting
       in the app the whole time. */
    const birth = now - 105 * DAY;
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now - 49 * DAY, lmp: null, country: 'uk' },
    }));
    const r = await ev((birthMs) => {
      openWelcomeBaby();
      const w = document.getElementById('wbGw');
      const open = { v: w ? w.value : null, auto: w ? w.getAttribute('data-auto') : null };
      setWhen('when', birthMs);
      const shown = { w: document.getElementById('wbGw').value, d: document.getElementById('wbGd').value };
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return {
        open: open, shown: shown, gw: b.gestWeeks, gd: b.gestDays,
        corr: correctionDays(b), cmo: correctedMonths(), mo: babyMonths(), fever: feverGuidance(),
      };
    }, birth);
    ok('a guess out of range leaves the box empty', obj(r.open).v === '', r.open);
    /* The mark is on the BOX, not on a value. Marking it only when a guess landed there was the
       whole bug: no mark, no re-derivation, and the number was dropped. */
    ok('but the box is still marked as Cubby’s to fill', obj(r.open).auto === '1', r.open);
    ok('picking the real birth date fills it in on screen', obj(r.shown).w === '32' && obj(r.shown).d === '0', r.shown);
    ok('and 32 + 0 is what gets stored', r.gw === 32 && r.gd === 0, r);
    ok('so she is corrected by eight weeks', r.corr === 56, r);
    ok('her three-and-a-half-month-old is 1.6 months corrected', r.mo > 3 && r.cmo < 2, r);
    ok('and keeps the under-three-months fever line', /under 3 months, any fever/i.test(str(r.fever)), r.fever);
  }

  console.log('\n16. the due date is stored at 08:00, so days are counted between days');
  {
    /* p.dueDate is written as new Date(dv + \'T08:00\'), while a birth carries the real clock time.
       Subtracting the two instants and rounding therefore moved a whole day for every birth in the
       late evening, and filed the wrong gestation without anyone able to see it. */
    const bd = new Date(now); bd.setDate(bd.getDate() - 60); bd.setHours(22, 30, 0, 0);
    const birth = bd.getTime();
    const dd = new Date(birth); dd.setDate(dd.getDate() + 3); dd.setHours(8, 0, 0, 0);
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: dd.getTime(), lmp: null, country: 'uk' },
    }));
    const r = await ev((birthMs) => {
      openWelcomeBaby();
      setWhen('when', birthMs);
      document.getElementById('wbName').value = 'Wren';
      welcomeBaby();
      const b = state.babies[state.babies.length - 1];
      return { gw: b.gestWeeks, gd: b.gestDays, shown: document.getElementById('wbGw') ? null : null };
    }, birth);
    ok('a baby born at 22:30, three days before the due date, is 39 + 4', r.gw === 39 && r.gd === 4, r);
  }

  console.log('\n17. a baby born a few days early is never told they were "0 weeks" early');
  {
    /* Math.round(correctionDays/7) rounded one to three days to zero and printed
       "counting from Robin’s due date 0 weeks after they arrived" on the growth screen, for an
       enormous share of all births, along with a sub-day chart shift and a nudge clause that
       explained nothing. Correction starts at the clinical preterm line, 37 + 0, and nowhere else. */
    for (const g of [{ w: 39, d: 6 }, { w: 39, d: 4 }, { w: 38, d: 0 }, { w: 37, d: 0 }]) {
      await load(seed({ babies: [baby({ birth: now - 122 * DAY, gestWeeks: g.w, gestDays: g.d })] }));
      const r = await ev(() => ({
        corr: correctionDays(), line: growthAgeLine(), fever: feverGuidance(),
        chron: babyAgeMonths(now()), raw: (now() - activeBaby().birth) / 2629800000,
      }));
      ok(g.w + ' + ' + g.d + ' is a term baby: nothing corrected', r.corr === 0, r.corr);
      ok(g.w + ' + ' + g.d + ' draws no caption at all', r.line === '', r.line);
      ok(g.w + ' + ' + g.d + ' leaves the plotted age alone', Math.abs(r.chron - r.raw) < 1e-9, r);
      ok(g.w + ' + ' + g.d + ' says nothing about a due date', !!str(r.fever) && !/due date/i.test(r.fever), r.fever);
    }
    await load(seed({ babies: [baby({ birth: now - 122 * DAY, gestWeeks: 36, gestDays: 6 })] }));
    const pre = await ev(() => ({ corr: correctionDays(), line: growthAgeLine() }));
    ok('36 + 6 is preterm and does correct', pre.corr === 22, pre.corr);
    ok('and the caption rounds to 3 weeks, never 0', /due date, 3 weeks after they arrived\./.test(pre.line), pre.line);
    ok('no caption anywhere can say "0 weeks after they arrived"', !!str(pre.line) && !/0 weeks? after they arrived/.test(pre.line), pre.line);
  }

  console.log('\n18. the household that welcomed a baby before this shipped');
  {
    /* The pregnancy record keeps dueDate, bornBabyId and birthAt after the birth, so Cubby is
       holding both numbers for every household that has already been through the handover. The
       Birth details sheet used to open blank at them and ask a question it could answer itself. */
    const birth = now - 105 * DAY;
    await load(seed({
      babies: [baby({ birth: birth })],
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now - 49 * DAY, lmp: null, country: 'uk', bornBabyId: 'b1', birthAt: birth },
    }));
    const r = await ev(() => {
      openBirthDetails();
      const w = document.getElementById('dGw'), d = document.getElementById('dGd');
      const help = (function () { const f = w && w.closest('.field'); const c = f.querySelectorAll('.csub'); return f ? (c[c.length - 1].textContent || '').replace(/\s+/g, ' ').trim() : ''; })();
      const pre = { w: w ? w.value : null, d: d ? d.value : null };
      saveBabyDetails('b1');
      const b = state.babies[0];
      return { pre: pre, help: help, gw: b.gestWeeks, gd: b.gestDays, corr: correctionDays(b), fever: feverGuidance() };
    });
    ok('the box opens pre-filled at 32 + 0 from the due date it already has', obj(r.pre).w === '32' && obj(r.pre).d === '0', r.pre);
    ok('and says out loud that it filled it in', /Filled in from the due date\. Change it if that is not right\./.test(str(r.help)), r.help);
    ok('saving keeps it', r.gw === 32 && r.gd === 0, r);
    ok('and the correction reaches the fever rule', r.corr === 56 && /under 3 months, any fever/i.test(str(r.fever)), r);
  }

  console.log('\n19. the helper text does not assume who is reading it');
  {
    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 56 * DAY, lmp: null, country: 'uk' },
    }));
    const withGuess = await ev(() => {
      openWelcomeBaby();
      const c = document.getElementById('wbGw').closest('.field').querySelectorAll('.csub');
      return (c[c.length - 1].textContent || '').replace(/\s+/g, ' ').trim();
    });
    /* Papa Bear, Nana Bear and an adoptive parent all reach this row, and none of them had a due
       date. "the way their doctor will" was also a promise about a third party. */
    ok('it never says "your due date"', !!str(withGuess) && !/your due date/i.test(withGuess), withGuess);
    ok('it does not promise what a doctor will do', !!str(withGuess) && !/their doctor will/i.test(withGuess), withGuess);
    ok('it still explains what the field is for', /count their age from the due date/i.test(withGuess), withGuess);
    /* She is hours postpartum and the pre-filled box looks exactly like the ones she typed, while
       this number quietly drives the chart, the milestone list and the fever rule. */
    ok('and it admits the number in the box is a guess', /Filled in from the due date\. Change it if that is not right\./.test(withGuess), withGuess);

    await load(seed({
      babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: null, lmp: null, country: 'uk' },
    }));
    const noGuess = await ev(() => {
      openWelcomeBaby();
      const c = document.getElementById('wbGw').closest('.field').querySelectorAll('.csub');
      return { help: (c[c.length - 1].textContent || '').replace(/\s+/g, ' ').trim(), v: document.getElementById('wbGw').value };
    });
    ok('with nothing filled in, it does not claim it filled anything in', noGuess.v === '' && !!str(noGuess.help) && !/Filled in from/i.test(noGuess.help), noGuess);
  }

  console.log('\n20. no percentile curve means no silent correction');
  {
    /* Without a sex there is no WHO curve, the chart falls back to a plain time line, and
       growthAgeLine() draws nothing. A correction applied there would shift an age nothing plots
       and no caption explains, with no way on screen to see it or switch it off. */
    await load(seed({ babies: [baby({ birth: now - 122 * DAY, gestWeeks: 32, gestDays: 0, sex: '' })] }));
    const r = await ev(() => ({
      able: growthCorrectable(), corrMo: growthCorrectionMonths(), line: growthAgeLine(),
      plotted: babyAgeMonths(now()), raw: (now() - activeBaby().birth) / 2629800000,
      corr: correctionDays(), fever: feverGuidance(),
    }));
    ok('the chart cannot correct', r.able === false && r.corrMo === 0, r);
    ok('and the plotted age is untouched', Math.abs(r.plotted - r.raw) < 1e-9, r);
    ok('with no caption to explain a shift that is not there', r.line === '', r.line);
    /* The fever rule and the milestone list are not chart features and are not gated on a sex. */
    ok('but the fever rule still counts from the due date', r.corr === 56 && /under 3 months, any fever/i.test(str(r.fever)), r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  /* The one that used to be free. page.on('pageerror') never fires for a throw inside evaluate(),
     so on a tree with these helpers missing the old assertion sailed through green while every
     probe above was quietly poisoned. Now the swallowed throws are counted and named. */
  ok('and no probe hit a missing helper', missing.length === 0, missing.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'GEST-AGE-AT-BIRTH: FAIL' : 'GEST-AGE-AT-BIRTH: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
