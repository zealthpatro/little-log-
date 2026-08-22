#!/usr/bin/env node
/* THE THIRD NUMBER.
 *
 * Every well-baby visit in the UK, US, India and the UAE measures three things: weight, length and
 * head circumference. A parent leaving that room could write down two. The measurement sheet had a
 * weight box and a height box, saveGrowth refused to write anything unless one of those two was
 * filled, and app/growth-data.js carried no head-circumference bands at all, so there was not even
 * a reference curve to plot a head against. The number a clinician asks for at six weeks, four
 * months and one year lived on a paper red book and nowhere in Cubby.
 *
 * What this gate holds down:
 *   - a head-only entry saves (the old guard threw it away),
 *   - cm and inches for the head are remembered apart from the height unit,
 *   - the timeline says WHICH centimetres, because length and head are both cm,
 *   - visitSummary carries the latest of each measurement separately, so a head-only visit does
 *     not blank a fortnight-old weight off the page a doctor reads,
 *   - the WHO 0-24mo and CDC 0-36mo head bands exist, are monotone, and plot real dots,
 *   - past the end of a band nothing is claimed rather than something invented,
 *   - the DOCTOR PDF carries the latest of each of the three, not whatever was in the newest
 *     entry, because it prints on the same page as the visit summary and the two must agree,
 *   - three stat boxes fit on one line at 390 and 320 without one of them wrapping taller,
 *   - a mistyped measurement can be corrected instead of only deleted,
 *   - "~72th" never reaches a parent,
 *   - the public FAQ, the two feature cards, the teaching registry and the log guide all say the
 *     app charts three numbers, in lockstep with the JSON-LD copy of the same answer.
 *
 * The base URL is argv[2] and the FIRST thing this does is prove the listener is this checkout:
 * ten agents run servers on this machine and a gate that graded somebody else's tree has already
 * happened here.
 *
 *   PORT=9283 node tools/serve.js &
 *   node tools/head_circ_check.js http://localhost:9283
 *   node tools/head_circ_check.js --self-test http://localhost:9283
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const crypto = require('crypto');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2).filter((a) => a !== '--self-test');
const SELF_TEST = process.argv.includes('--self-test');
const BASE = ARGS[0] || 'http://localhost:9283';
const ROOT = __dirname + '/..';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

/* Fetch a file from the server AND from disk, and refuse to grade anything until they match.
   Ports get reused: 9473 was another agent's tree inside five minutes, and a run that grades a
   checkout without the feature in it reports a clean pass on the wrong code. */
const getText = async (path) => {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error('GET ' + path + ' -> ' + r.status);
  return r.text();
};
const proveListener = async () => {
  for (const f of ['/app/index.html', '/app/growth-data.js', '/faq/index.html']) {
    const served = sha(Buffer.from(await getText(f)));
    const local = sha(fs.readFileSync(ROOT + f));
    console.log('  listener ' + f + ' served=' + served + ' disk=' + local);
    if (served !== local) {
      console.error('\nHEAD-CIRC: ABORT. ' + BASE + ' is not serving this checkout (' + f + ').');
      console.error('Start this tree\'s server on a free port and pass it as argv[2].');
      process.exit(3);
    }
  }
};
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// Mid-morning, so nothing here depends on a night-time branch anywhere else in the app.
const CLOCK = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

/* renderStats bails to "No patterns yet" when the log is completely empty, and the growth section
   lives inside it, so every seed carries one ordinary feed. It is the state of any household that
   has used Cubby for an afternoon, which is the only state in which the growth section is reachable
   at all. */
const BASE_FEED = { id: 'seedfeed', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: now - 3 * HOUR, authorId: 'local' };
const seed = (over) => {
  const s = Object.assign({
    babies: [{ id: 'b1', name: 'Robin', birth: now - 120 * DAY, sex: 'F', country: 'gb', routines: [], doctors: [], allergies: [] }],
    activeBabyId: 'b1', events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  }, over || {});
  s.events = [BASE_FEED].concat(s.events || []);
  return s;
};

(async () => {
  await proveListener();
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

  /* Store.load() is async and lands well after networkidle2. Sleeping a fixed 1.3s raced it: a write
     made before the load resolved was overwritten by the state that arrived afterwards, which looks
     exactly like a save that does not persist. Wait for the seeded log to actually be in memory. */
  const ready = async () => {
    await page.waitForFunction(() => typeof state !== 'undefined' && (state.events || []).some((e) => e.id === 'seedfeed'), { timeout: 20000 });
    await sleep(600);
  };
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await ready();
  };

  /* Typing into a box that does not exist throws and takes the whole run down at section 2, which
     is exactly how a gate ends up never having been watched fail. Missing box = a failed assertion,
     not a dead process. */
  const typeInto = async (sel, text) => {
    const el = await page.$(sel);
    if (!el) return false;
    await el.type(text);
    return true;
  };
  const saveSheet = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /save measurement/i.test(x.textContent));
    if (b) b.click();
    return !!b;
  });

  // Walk there the way a parent does: the Log tab, then the Stats segment.
  const openStats = async () => {
    await page.evaluate(() => {
      go('log');
      const seg = [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Stats');
      if (seg) seg.click();
    });
    await sleep(400);
  };

  // Everything the growth section actually renders, read off the live DOM.
  const growthDom = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.gx-stat .gx-box')].map((x) => ({
      label: (x.querySelector('.l') || {}).textContent || '',
      num: ((x.querySelector('.n') || {}).textContent || '').trim(),
      delta: ((x.querySelector('.d') || {}).textContent || '').trim(),
    }));
    const cards = [...document.querySelectorAll('.stat-card')].filter((c) => c.querySelector('h3')).map((c) => ({
      title: c.querySelector('h3').textContent.trim(),
      sub: ((c.querySelector('.csub') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      dots: c.querySelectorAll('svg.growth-line circle').length,
      paths: c.querySelectorAll('svg.growth-line path').length,
    }));
    return { boxes, cards };
  });

  const growthEventsOf = () => page.evaluate(() => state.events.filter((e) => e.type === 'growth' && !e.deleted)
    .map((e) => ({ w: e.weight, wU: e.wUnit, h: e.height, hU: e.hUnit, hc: e.head, hcU: e.hcUnit, baby: e.babyId })));

  /* Real rects, not the class list. line-height on .n is 1, so a number that wrapped comes back
     twice its font-size, and a number that is merely too wide comes back with scrollWidth past the
     box. Both are the same bug to a parent: the third box stops lining up with the other two. */
  const rowGeom = () => page.evaluate(() => {
    const row = document.querySelector('.gx-stat');
    if (!row) return null;
    const boxes = [...row.querySelectorAll('.gx-box')].map((b) => {
      const n = b.querySelector('.n'), l = b.querySelector('.l');
      const cs = getComputedStyle(n), fs = parseFloat(cs.fontSize);
      const nr = n.getBoundingClientRect(), br = b.getBoundingClientRect();
      return {
        text: n.textContent.trim(),
        label: (l ? l.textContent : '').trim(),
        nLines: Math.round(nr.height / fs),
        nH: +nr.height.toFixed(1),
        spills: n.scrollWidth > n.clientWidth + 1,
        boxW: +br.width.toFixed(1),
        boxH: +br.height.toFixed(1),
        labelH: l ? +l.getBoundingClientRect().height.toFixed(1) : 0,
      };
    });
    return { boxes, rowSpills: row.scrollWidth > row.clientWidth + 1, pageSpills: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });

  /* openPrintable calls window.open, which in headless is a real popup target. Stub it so the
     report HTML the parent would print lands in a string this gate can read. */
  const doctorReportHtml = () => page.evaluate(() => {
    window.__rep = '';
    window.open = () => ({ document: { write: (h) => { window.__rep += h; }, close: () => {} }, focus: () => {} });
    try { openDoctorReport(); } catch (e) { window.__rep = 'THREW: ' + e.message; }
    return window.__rep;
  });
  const reportSection = (html, title) => {
    const m = new RegExp('<h2>' + title + '</h2><pre>([\\s\\S]*?)</pre>').exec(html || '');
    return m ? m[1].replace(/&middot;/g, '\u00b7').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null;
  };

  console.log('\n1. the measurement sheet offers all three numbers');
  {
    await load(seed());
    await openStats();
    /* The empty growth section's own button, read before it is clicked. It is the first thing a
       parent with no measurements sees, and it used to advertise "Add weight & height" over a
       sheet with three fields, in an app that writes "and" everywhere else. The matcher is
       deliberately loose so the assertion below, not the lookup, is what goes red. */
    const emptyBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /add (a measurement|weight)/i.test(x.textContent));
      return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('the empty growth section still offers a way in', emptyBtn !== null, emptyBtn);
    ok('it names the whole sheet, not two of the three', /add a measurement/i.test(emptyBtn || ''), emptyBtn);
    ok('it no longer says weight & height', !/weight/i.test(emptyBtn || ''), emptyBtn);
    ok('and it carries no ampersand', !/&/.test(emptyBtn || ''), emptyBtn);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /add (a measurement|weight)/i.test(x.textContent));
      if (b) b.click();
    });
    await sleep(400);
    const r = await page.evaluate(() => ({
      hasW: !!document.querySelector('#gW'), hasH: !!document.querySelector('#gH'), hasHC: !!document.querySelector('#gHC'),
      numeric: document.querySelectorAll('.sheet input[type=number]').length,
      sub: ((document.querySelector('.sheet .sub') || {}).textContent || '').trim(),
      help: (() => { const hc = document.querySelector('#gHC'); if (!hc) return ''; const c = hc.closest('.field').querySelector('.csub'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
      draft: growthDraft ? JSON.parse(JSON.stringify(growthDraft)) : null,
    }));
    ok('the weight box is still there', r.hasW === true, r);
    ok('the height box is still there', r.hasH === true, r);
    ok('and there is a head circumference box', r.hasHC === true, r);
    ok('exactly three number boxes, no fourth thing crept in', r.numeric === 3, r);
    ok('the draft carries a head field', !!r.draft && 'head' in r.draft, r.draft);
    ok('the draft carries its own head unit', !!r.draft && r.draft.hcUnit === 'cm', r.draft);
    ok('the sub line no longer promises only two', !/or both/i.test(r.sub), r.sub);
    /* Cubby records what a clinician measured. "around the widest part of the head" is measuring
       technique, and it nudges a parent into taking the number herself with a tape measure and
       then reading a percentile off it at 3am. "they" also had no antecedent. */
    ok('the head helper line exists', r.help.length > 0, r.help);
    ok('it does not teach a parent how to measure a head', !/widest part|tape/i.test(r.help), r.help);
    ok('and it has no dangling "they"', !/\bthey\b/i.test(r.help), r.help);
    ok('it still says the field is optional', /skip it/i.test(r.help), r.help);
    ok('no em-dash in it', !/\u2014/.test(r.help), r.help);
  }

  console.log('\n2. the head unit is remembered apart from the height unit');
  {
    // Real clicks on the two toggles: inches for the head must not drag the length into inches.
    const r = await page.evaluate(() => {
      const hc = document.querySelector('#gHC'), h = document.querySelector('#gH');
      if (!hc || !h) return { head: null, height: null, draft: growthDraft ? JSON.parse(JSON.stringify(growthDraft)) : {} };
      const inBtn = [...hc.closest('.field').querySelectorAll('.unit-toggle button')].find((b) => b.textContent.trim() === 'in');
      if (inBtn) inBtn.click();
      const on = (el) => { const b = [...el.closest('.field').querySelectorAll('.unit-toggle button')].find((x) => x.classList.contains('on')); return b ? b.textContent.trim() : null; };
      return { head: on(document.querySelector('#gHC')), height: on(document.querySelector('#gH')), draft: JSON.parse(JSON.stringify(growthDraft)) };
    });
    ok('the head toggle moves to inches', r.head === 'in', r);
    ok('the height toggle stays on cm', r.height === 'cm', r);
    ok('and the draft agrees', r.draft.hcUnit === 'in' && r.draft.hUnit === 'cm', r.draft);
    // Put it back, the rest of this section works in cm.
    await page.evaluate(() => {
      const hc = document.querySelector('#gHC'); if (!hc) return;
      const b = [...hc.closest('.field').querySelectorAll('.unit-toggle button')].find((x) => x.textContent.trim() === 'cm');
      if (b) b.click();
    });
    await sleep(150);
  }

  console.log('\n3. a head-only measurement saves');
  {
    const typed = await typeInto('#gHC', '42.47');
    ok('the head box takes a number', typed === true, typed);
    await saveSheet();
    await sleep(500);
    const evs = await growthEventsOf();
    ok('one growth entry was written', evs.length === 1, evs);
    ok('it holds the head measurement, rounded to a tenth', evs.length === 1 && evs[0].hc === 42.5, evs);
    ok('with its own unit key', evs.length === 1 && evs[0].hcU === 'cm', evs);
    ok('and no invented weight or height', evs.length === 1 && evs[0].w === undefined && evs[0].h === undefined, evs);
    const rem = await page.evaluate(() => state.settings.hcUnit);
    ok('the head unit is remembered for next time', rem === 'cm', rem);
  }

  console.log('\n4. an entirely empty sheet still refuses, and says what it wants');
  {
    await load(seed());
    await openStats();
    await page.evaluate(() => openGrowth());
    await sleep(400);
    await saveSheet();
    await sleep(400);
    const r = await page.evaluate(() => ({
      n: state.events.filter((e) => e.type === 'growth').length,
      toast: ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      sheetStillOpen: !!document.querySelector('#gHC'),
    }));
    ok('nothing was written', r.n === 0, r);
    ok('the sheet stays open so nothing is lost', r.sheetStillOpen === true, r);
    ok('and the ask names the head measurement too', /head/i.test(r.toast), r.toast);
  }

  console.log('\n5. all three in one entry, and the timeline says which is which');
  {
    await load(seed());
    await openStats();
    await page.evaluate(() => openGrowth());
    await sleep(400);
    await typeInto('#gW', '6.2');
    await typeInto('#gH', '62.4');
    await typeInto('#gHC', '41.8');
    await saveSheet();
    await sleep(500);
    const evs = await growthEventsOf();
    ok('all three landed on one entry', evs.length === 1 && evs[0].w === 6.2 && evs[0].h === 62.4 && evs[0].hc === 41.8, evs);

    await page.evaluate(() => { go('log'); const s = [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Log'); if (s) s.click(); });
    await sleep(500);
    const row = await page.evaluate(() => {
      const it = [...document.querySelectorAll('.tl-item')].find((x) => /Measured/.test((x.querySelector('.t1') || {}).textContent || ''));
      if (!it) return null;
      return { t1: it.querySelector('.t1').textContent.trim(), t2: ((it.querySelector('.t2') || {}).textContent || '').trim() };
    });
    ok('the measurement row is on the timeline', !!row, row);
    ok('the detail line has three parts', !!row && row.t2.split(' · ').length === 3, row);
    ok('weight first', !!row && row.t2.split(' · ')[0] === '6.2 kg', row);
    ok('height second', !!row && row.t2.split(' · ')[1] === '62.4 cm', row);
    // Both length and head are centimetres, so the third number has to name itself or a parent is
    // left decoding "62.4 cm · 41.8 cm" at a clinic desk.
    ok('and the head is labelled, not a second bare cm', !!row && row.t2.split(' · ')[2] === 'head 41.8 cm', row);
  }

  console.log('\n6. the visit summary keeps the latest of EACH measurement');
  {
    // A weight from a fortnight ago and a head-only visit this morning. Both belong on the page.
    await load(seed({ events: [
      { id: 'g1', type: 'growth', babyId: 'b1', time: now - 14 * DAY, weight: 5.9, wUnit: 'kg', height: 60.1, hUnit: 'cm', authorId: 'local' },
      { id: 'g2', type: 'growth', babyId: 'b1', time: now - 2 * HOUR, head: 41.8, hcUnit: 'cm', authorId: 'local' },
    ] }));
    const line = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => l.indexOf('Latest growth:') === 0) || ''));
    const parts = line.replace('Latest growth: ', '').split(', ');
    ok('the line exists', line.length > 0, line);
    ok('it names three measurements', parts.length === 3, parts);
    /* These two also pass on the unmodified build: lastGrowth was already per-field for weight and
       height. They stay because they are what breaks if someone "simplifies" this line back to a
       single newest event, which is exactly what the doctor report below was still doing. */
    ok('the fortnight-old weight survives a head-only visit', parts[0] === '5.9 kg', parts);
    ok('so does the height', parts[1] === '60.1 cm', parts);
    ok('and the head is there, labelled', parts[2] === 'head 41.8 cm', parts);
  }

  console.log('\n6b. and so does the doctor PDF, on the same page');
  {
    /* The two clinical blocks print one above the other. visitSummary was rebuilt per-field and
       openDoctorReport was left reading babyEvents().find(type==='growth'), which is the NEWEST
       event, so a head-only visit this morning printed "head 41.8 cm" and silently dropped a
       weight and a length the same page was still quoting three lines higher. Pre-change this was
       unreachable, because saveGrowth refused an entry without a weight or a height. */
    const html = await doctorReportHtml();
    const sec = reportSection(html, 'Latest measurement');
    ok('the report renders without throwing', !/^THREW/.test(html || ''), (html || '').slice(0, 120));
    ok('it has a Latest measurement section', sec !== null, sec);
    ok('the weight is on it', /(^|\s)5\.9 kg/.test(sec || ''), sec);
    ok('the length is on it', /(^|\s)60\.1 cm/.test(sec || ''), sec);
    ok('the head is on it, labelled', /head 41\.8 cm/.test(sec || ''), sec);
    // They are no longer one visit, so each has to carry its own date or the page implies they are.
    ok('each number carries its own date', ((sec || '').match(/\(\d/g) || []).length === 3, sec);
    const vs = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => l.indexOf('Latest growth:') === 0) || ''));
    const nums = (t) => (t.match(/\d+\.\d+/g) || []).filter((x) => x !== '14').sort().join(',');
    ok('the two blocks on one page quote the same three numbers', nums(sec || '') === nums(vs), { report: sec, summary: vs });
  }

  console.log('\n7. the reference bands exist and behave');
  {
    const r = await page.evaluate(() => {
      const R = window.GROWTH_REF;
      const out = { srcs: Object.keys(R), shapes: {}, checkedRows: 0, monotoneRows: 0, sixWide: 0 };
      ['who', 'cdc'].forEach((s) => ['M', 'F'].forEach((x) => {
        const b = R[s] && R[s].head && R[s].head[x];
        out.shapes[s + x] = b ? { rows: b.length, first: b[0][0], last: b[b.length - 1][0] } : null;
        (b || []).forEach((row) => {
          out.checkedRows++;
          if (row.length === 6) out.sixWide++;
          if (row[1] < row[2] && row[2] < row[3] && row[3] < row[4] && row[4] < row[5]) out.monotoneRows++;
        });
      }));
      const at = (s, x, i) => { try { return R[s].head[x][i][3]; } catch (e) { return null; } };
      out.whoBoyBirthMedian = at('who', 'M', 0);
      out.cdcBoyBirthMedian = at('cdc', 'M', 0);
      out.whoGirlTwoYearMedian = at('who', 'F', 24);
      return out;
    });
    ok('WHO boys head band runs 0 to 24 months', !!r.shapes.whoM && r.shapes.whoM.rows === 25 && r.shapes.whoM.first === 0 && r.shapes.whoM.last === 24, r.shapes.whoM);
    ok('WHO girls head band runs 0 to 24 months', !!r.shapes.whoF && r.shapes.whoF.rows === 25 && r.shapes.whoF.last === 24, r.shapes.whoF);
    ok('CDC boys head band reaches 36 months', !!r.shapes.cdcM && r.shapes.cdcM.rows === 38 && r.shapes.cdcM.last === 36, r.shapes.cdcM);
    ok('CDC girls head band reaches 36 months', !!r.shapes.cdcF && r.shapes.cdcF.rows === 38 && r.shapes.cdcF.last === 36, r.shapes.cdcF);
    // .every() over an empty array is true, so the count is the assertion and the shape is a check.
    ok('126 band rows were actually inspected', r.checkedRows === 126, r.checkedRows);
    ok('every one of them is [month,p5,p25,p50,p75,p95]', r.sixWide === 126, r.sixWide);
    ok('every one of them rises p5 to p95', r.monotoneRows === 126, r.monotoneRows);
    // Anchors against the published tables, so a silently mangled paste cannot pass.
    ok('WHO boys birth median is 34.46 cm', r.whoBoyBirthMedian === 34.46, r.whoBoyBirthMedian);
    ok('CDC boys birth median is 35.81 cm', r.cdcBoyBirthMedian === 35.81, r.cdcBoyBirthMedian);
    ok('WHO girls 24-month median is 47.18 cm', r.whoGirlTwoYearMedian === 47.18, r.whoGirlTwoYearMedian);
  }

  console.log('\n8. it plots, with a dot per measurement');
  {
    const evs = [];
    [0, 30, 60, 90].forEach((d, i) => evs.push({ id: 'g' + i, type: 'growth', babyId: 'b1', time: now - (120 - d) * DAY,
      weight: 4 + i * 0.7, wUnit: 'kg', head: 37 + i * 1.4, hcUnit: 'cm', authorId: 'local' }));
    await load(seed({ events: evs }));
    await openStats();
    const d = await growthDom();
    const head = d.cards.find((c) => c.title === 'Head circumference');
    const weight = d.cards.find((c) => c.title === 'Weight');
    ok('there is a head circumference card', !!head, d.cards.map((c) => c.title));
    ok('it draws four dots for four measurements', !!head && head.dots === 4, head);
    ok('the weight card is untouched, still four dots', !!weight && weight.dots === 4, weight);
    ok('no height card, because no height was measured', !d.cards.find((c) => c.title === 'Height'), d.cards.map((c) => c.title));
    /* "Latest head" next to "Latest weight" and "Latest height" reads as a fragment, and this is
       the one number a frightened parent is most likely to be scanning. */
    ok('a Latest head size box appears', d.boxes.some((b) => b.label === 'Latest head size'), d.boxes);
    const box = d.boxes.find((b) => /Latest head/.test(b.label));
    ok('showing the newest reading', !!box && box.num === '41.2 cm', box);
    ok('and the change since the one before it', !!box && box.delta === '+1.4 cm', box);
    ok('WHO is the band for a baby outside the US', !!head && /WHO/.test(head.sub), head && head.sub);
    ok('and a percentile is offered', !!head && /~\d+th|<5th|>95th/.test(head.sub), head && head.sub);
  }

  console.log('\n9. past the end of a band, nothing is claimed');
  {
    // Thirty months old. WHO head stops at 24, CDC runs to 36. The WHO view must say nothing rather
    // than extrapolate a percentile onto a toddler, and switching source must bring one back.
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 30 * 30.44 * DAY, sex: 'M', country: 'gb', routines: [], doctors: [], allergies: [] }],
      events: [{ id: 'g1', type: 'growth', babyId: 'b1', time: now - HOUR, head: 49.2, hcUnit: 'cm', authorId: 'local' }],
    }));
    const r = await page.evaluate(() => {
      const ref = growthRef('head');
      return {
        whoSrc: effGrowthSource(), who: pctLabel('head', 'cm'), whoPct: estPercentile('head', 'cm'),
        // "nothing is claimed" is free on a build with no head bands at all. Prove the band is
        // THERE and the child is simply past the end of it, which is the behaviour under test.
        refRows: ref ? ref.length : 0, refLastMonth: ref ? ref[ref.length - 1][0] : null,
      };
    });
    ok('a UK toddler is on WHO', r.whoSrc === 'who', r);
    ok('a WHO head band does exist for this baby', r.refRows === 25, r);
    ok('and it genuinely stops before their age', r.refLastMonth === 24, r);
    ok('WHO stops at two, so no percentile is invented', r.who === '' && r.whoPct === null, r);
    await page.evaluate(() => toggleGrowthSource());
    await sleep(300);
    const r2 = await page.evaluate(() => ({ src: effGrowthSource(), pct: estPercentile('head', 'cm'), label: pctLabel('head', 'cm') }));
    ok('CDC covers three years', r2.src === 'cdc', r2);
    ok('so it does have a percentile to give', typeof r2.pct === 'string' && /th|<5th|>95th/.test(r2.pct), r2);
    await openStats();
    const d = await growthDom();
    const head = d.cards.find((c) => c.title === 'Head circumference');
    ok('the card still draws the single dot', !!head && head.dots === 1, head);
    ok('and there is no colour-coded verdict anywhere on it', !!head && !/high|low|small|large|concern|normal/i.test(head.sub), head && head.sub);
  }

  console.log('\n10. inches in, centimetres out');
  {
    // Measured in inches at a US clinic, read back by a household set to cm.
    await load(seed({
      settings: Object.assign(seed().settings, { hcUnit: 'cm' }),
      events: [{ id: 'g1', type: 'growth', babyId: 'b1', time: now - HOUR, head: 16.5, hcUnit: 'in', authorId: 'local' }],
    }));
    await openStats();
    const d = await growthDom();
    const box = d.boxes.find((b) => /Latest head/.test(b.label));
    ok('the inch reading is shown in centimetres', !!box && box.num === '41.9 cm', box);
    const head = d.cards.find((c) => c.title === 'Head circumference');
    ok('and it still plots one dot', !!head && head.dots === 1, head);
    const pct = await page.evaluate(() => estPercentile('head', 'cm'));
    ok('the percentile reads the inch value through the same conversion', pct !== null, pct);
  }

  console.log('\n11. another baby\'s head measurements stay with that baby');
  {
    await load(seed({
      babies: [
        { id: 'b1', name: 'Robin', birth: now - 120 * DAY, sex: 'F', country: 'gb', routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 400 * DAY, sex: 'M', country: 'gb', routines: [], doctors: [], allergies: [] },
      ],
      activeBabyId: 'b1',
      events: [
        { id: 'g1', type: 'growth', babyId: 'b1', time: now - HOUR, weight: 6.1, wUnit: 'kg', authorId: 'local' },
        { id: 'g2', type: 'growth', babyId: 'b2', time: now - HOUR, head: 46.9, hcUnit: 'cm', authorId: 'local' },
      ],
    }));
    await openStats();
    const d = await growthDom();
    ok('Robin shows only the two boxes she has data for', d.boxes.length === 2, d.boxes);
    ok('no Latest head box on the wrong baby', !d.boxes.some((b) => /Latest head/.test(b.label)), d.boxes);
    ok('and no head card either', !d.cards.find((c) => c.title === 'Head circumference'), d.cards.map((c) => c.title));
    const line = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => l.indexOf('Latest growth:') === 0) || ''));
    ok('the visit summary does not borrow it', !/head/i.test(line), line);
    /* Every assertion above is an absence, and a build with no feature at all scores four out of
       four on them. Switch to the baby who WAS measured: isolation only means something if the
       measurement shows up where it belongs. */
    await page.evaluate(() => { state.activeBabyId = 'b2'; render(); });
    await sleep(300);
    await openStats();
    const d2 = await growthDom();
    const box2 = d2.boxes.find((b) => /Latest head/.test(b.label));
    ok('Wren does have his head box', !!box2 && box2.num === '46.9 cm', d2.boxes);
    ok('and his own head card', !!d2.cards.find((c) => c.title === 'Head circumference'), d2.cards.map((c) => c.title));
    const line2 = await page.evaluate(() => (visitSummary(14).split('\n').find((l) => l.indexOf('Latest growth:') === 0) || ''));
    ok('and it reaches his visit summary', /head 46\.9 cm/.test(line2), line2);
    ok('without borrowing Robin\'s weight', !/6\.1 kg/.test(line2), line2);
  }

  console.log('\n12. a second measurement is a second measurement');
  {
    /* Two saves in one sitting, no reload in between. The reload path is covered by every `load()`
       above, which boots the app from stored JSON: store-firebase.js replaces persist() with a
       cloud push the moment it attaches, so a headless page's own writes never reach localStorage
       and a save-then-reload assertion here would be measuring the harness, not the feature. */
    await load(seed());
    await openStats();
    await page.evaluate(() => openGrowth());
    await sleep(400);
    await typeInto('#gHC', '40.0');
    await saveSheet();
    await sleep(500);
    let evs = await growthEventsOf();
    ok('the first one is written', evs.length === 1 && evs[0].hc === 40, evs);
    await openStats();
    await page.evaluate(() => openGrowth());
    await sleep(400);
    const opensOn = await page.evaluate(() => ({ hc: growthDraft.hcUnit, box: (document.querySelector('#gHC') || {}).value }));
    ok('the sheet reopens on the remembered unit', opensOn.hc === 'cm', opensOn);
    ok('and with an empty box, not last time\'s number', opensOn.box === '', opensOn);
    await typeInto('#gHC', '40.6');
    await saveSheet();
    await sleep(500);
    evs = await growthEventsOf();
    ok('a second entry is a second entry, not an overwrite', evs.length === 2, evs);
    await openStats();
    const d = await growthDom();
    const head = d.cards.find((c) => c.title === 'Head circumference');
    ok('two dots on the chart', !!head && head.dots === 2, head);
    const box = d.boxes.find((b) => /Latest head/.test(b.label));
    ok('the box moves to the newer one', !!box && box.num === '40.6 cm', box);
    ok('and shows the change between them', !!box && box.delta === '+0.6 cm', box);
  }

  console.log('\n13. a head measurement stored in inches comes back after a fresh boot');
  {
    // A real reload: the app boots from stored JSON with nothing in memory to fall back on.
    await load(seed({
      settings: Object.assign(seed().settings, { hcUnit: 'in' }),
      events: [
        { id: 'g1', type: 'growth', babyId: 'b1', time: now - 40 * DAY, head: 15.5, hcUnit: 'in', authorId: 'local' },
        { id: 'g2', type: 'growth', babyId: 'b1', time: now - 2 * DAY, head: 16.1, hcUnit: 'in', authorId: 'local' },
      ],
    }));
    const evs = await growthEventsOf();
    /* Reading the seeded events straight back measures the harness, not the app: hcU is an unread
       field on a build with no feature. Ask the app's own reader instead, the one every chart and
       stat box goes through, and convert while we are at it. */
    const readBack = await page.evaluate(() => {
      try {
        const l = lastGrowth('head');
        return { n: growthEvents().filter((e) => e.head).length, cm: +measVal(l, 'head', 'cm').toFixed(1), unit: l.hcUnit };
      } catch (e) { return { err: e.message }; }
    });
    ok('the app reads both entries back after the boot', readBack.n === 2, readBack);
    ok('through the shared reader, in the unit they were stored in', readBack.unit === 'in', readBack);
    ok('and 16.1 in converts to 40.9 cm', readBack.cm === 40.9, readBack);
    await openStats();
    const d = await growthDom();
    const box = d.boxes.find((b) => /Latest head/.test(b.label));
    ok('the box reads back in inches', !!box && box.num === '16.1 in', box);
    const head = d.cards.find((c) => c.title === 'Head circumference');
    ok('and the chart draws both dots', !!head && head.dots === 2, head);
    ok('with the unit named on the card', !!head && / in$/.test(head.sub), head && head.sub);
  }

  console.log('\n14. three boxes still fit on one line');
  {
    /* .gx-stat is a plain flex row of flex:1 boxes and it was priced for two. At 390 the third box
       came in at 108.7px and "41.8 cm" broke onto a second line while "6.85 kg" did not, so one
       box stood taller than its neighbours and the labels stopped lining up. */
    /* Two datasets. The first is the one measured on the broken build, where 6.8 and 62 stayed on
       one line and 41.2 did not, so only the third box grew. The second is every number at its
       widest, which is the case that overflows rather than wraps. */
    const SETS = [
      { tag: '', ev: { weight: 6.8, wUnit: 'kg', height: 62, hUnit: 'cm', head: 41.2, hcUnit: 'cm' } },
      { tag: ' (widest)', ev: { weight: 6.85, wUnit: 'kg', height: 60.1, hUnit: 'cm', head: 41.8, hcUnit: 'cm' } },
    ];
    for (const set of SETS) {
    await load(seed({ events: [Object.assign({ id: 'g1', type: 'growth', babyId: 'b1', time: now - 2 * HOUR, authorId: 'local' }, set.ev)] }));
    for (const w of [390, 375, 360, 320]) {
      await page.setViewport({ width: w, height: 844 });
      await openStats();
      await sleep(250);
      const g = await rowGeom();
      const tag = ' @' + w + 'px' + set.tag;
      ok('three boxes are on the row' + tag, !!g && g.boxes.length === 3, g && g.boxes.length);
      ok('no number wraps to a second line' + tag, !!g && g.boxes.every((b) => b.nLines === 1), g && g.boxes.map((b) => [b.text, b.nLines]));
      ok('and none of them spills out of its box' + tag, !!g && g.boxes.every((b) => !b.spills), g && g.boxes.map((b) => [b.text, b.spills]));
      ok('all three boxes are the same height' + tag, !!g && new Set(g.boxes.map((b) => b.boxH)).size === 1, g && g.boxes.map((b) => b.boxH));
      ok('the labels line up with each other' + tag, !!g && new Set(g.boxes.map((b) => b.labelH)).size === 1, g && g.boxes.map((b) => [b.label, b.labelH]));
      ok('the row does not scroll sideways' + tag, !!g && !g.rowSpills && !g.pageSpills, g && { row: g.rowSpills, page: g.pageSpills });
    }
    }
    /* nowrap now applies to the two-box row as well, and imperial is where it is widest. A family
       with no head measurement must not be handed a number clipped by a fix they never asked for. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 300 * DAY, sex: 'F', country: 'us', routines: [], doctors: [], allergies: [] }],
      settings: Object.assign(seed().settings, { wUnit: 'lb', hUnit: 'in' }),
      events: [{ id: 'g1', type: 'growth', babyId: 'b1', time: now - 2 * HOUR, weight: 22.62, wUnit: 'lb', height: 29.75, hUnit: 'in', authorId: 'local' }],
    }));
    await page.setViewport({ width: 320, height: 844 });
    await openStats();
    await sleep(250);
    const two = await rowGeom();
    ok('a household with no head measurement still gets two boxes', !!two && two.boxes.length === 2, two && two.boxes);
    ok('and the widest imperial numbers still fit @320px', !!two && two.boxes.every((x) => !x.spills && x.nLines === 1), two && two.boxes);
    await page.setViewport({ width: 390, height: 844 });
  }

  console.log('\n15. a mistyped measurement can be corrected, not only deleted');
  {
    /* openEdit rendered a growth row zero value inputs, so 41.5 typed as 415 could only be thrown
       away and logged again, and while it sat there it rescaled the whole percentile chart. */
    await load(seed({ events: [
      { id: 'g1', type: 'growth', babyId: 'b1', time: now - 2 * HOUR, weight: 6.2, wUnit: 'kg', head: 415, hcUnit: 'cm', authorId: 'local' },
    ] }));
    await page.evaluate(() => openEdit('g1'));
    await sleep(400);
    const f = await page.evaluate(() => ({
      w: (document.querySelector('#eGW') || {}).value, h: (document.querySelector('#eGH') || {}).value,
      hc: (document.querySelector('#eGHC') || {}).value,
      labels: [...document.querySelectorAll('.sheet .field label')].map((l) => l.textContent.trim()),
    }));
    ok('the edit sheet shows the weight it stored', f.w === '6.2', f);
    ok('an empty box where nothing was measured', f.h === '', f);
    ok('and the head number, editable', f.hc === '415', f);
    ok('each box names the unit it was saved in', f.labels.some((l) => /Head circumference \(cm\)/.test(l)), f.labels);
    /* Never dereference a box that may not exist: a build without the fix has none of them, and a
       gate that dies here is a gate nobody ever watched go red. */
    const setV = (sel, v) => page.evaluate((s2, v2) => { const el = document.querySelector(s2); if (el) el.value = v2; }, sel, v);
    await setV('#eGHC', '41.5');
    await page.evaluate(() => saveEdit('g1'));
    await sleep(400);
    let evs = await growthEventsOf();
    ok('the correction lands on the same entry', evs.length === 1 && evs[0].hc === 41.5, evs);
    ok('and the weight beside it is untouched', evs.length === 1 && evs[0].w === 6.2, evs);
    // Clearing every box is a deletion, and deletion has its own button that keeps the row.
    await page.evaluate(() => openEdit('g1'));
    await sleep(400);
    await page.evaluate(() => { ['#eGW', '#eGH', '#eGHC'].forEach((x) => { const el = document.querySelector(x); if (el) el.value = ''; }); saveEdit('g1'); });
    await sleep(400);
    const after = await page.evaluate(() => ({
      evs: state.events.filter((e) => e.type === 'growth').map((e) => ({ w: e.weight, hc: e.head, t: e.time })),
      toast: ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      stillOpen: !!document.querySelector('#eGHC'),
    }));
    ok('emptying every box is refused', after.evs.length === 1 && after.evs[0].hc === 41.5 && after.evs[0].w === 6.2, after.evs);
    ok('the sheet stays open so nothing is lost', after.stillOpen === true, after);
    ok('and the ask names all three', /weight, height or head/i.test(after.toast), after.toast);
    // A refused save must not have quietly moved the entry's time on the way out.
    ok('the refusal changed nothing at all', after.evs[0].t === now - 2 * HOUR, after.evs[0]);
    // Clearing ONE box takes that measurement off and leaves the rest.
    await setV('#eGW', ''); await setV('#eGHC', '41.5');
    await page.evaluate(() => saveEdit('g1'));
    await sleep(400);
    evs = await growthEventsOf();
    ok('clearing one box removes just that measurement', evs.length === 1 && evs[0].w === undefined && evs[0].hc === 41.5, evs);
  }

  console.log('\n16. the percentile is written the way English writes it');
  {
    const r = await page.evaluate(() => {
      try { return { table: [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 53, 63, 72, 95].map((n) => pctOrdinal(n)) }; }
      catch (e) { return { err: e.message }; }
    });
    ok('there is an ordinal helper at all', !r.err, r);
    ok('1st 2nd 3rd, not 1th 2th 3th', !r.err && r.table.slice(0, 3).join(' ') === '1st 2nd 3rd', r.table);
    ok('11th 12th 13th stay th', !r.err && r.table.slice(4, 7).join(' ') === '11th 12th 13th', r.table);
    ok('21st 22nd 23rd', !r.err && r.table.slice(7, 10).join(' ') === '21st 22nd 23rd', r.table);
    ok('and 72nd, not the ~72th a parent was being shown', !r.err && r.table.indexOf('72th') === -1 && r.table.indexOf('72nd') !== -1, r.table);
    // Through the real label, on the real chart, for all three measurements.
    await load(seed({ events: [
      { id: 'g1', type: 'growth', babyId: 'b1', time: now - HOUR, weight: 6.4, wUnit: 'kg', height: 61.2, hUnit: 'cm', head: 41.2, hcUnit: 'cm', authorId: 'local' },
    ] }));
    const labels = await page.evaluate(() => ['weight', 'height', 'head'].map((m) => pctLabel(m, m === 'weight' ? 'kg' : 'cm')));
    ok('all three charts offer a percentile', labels.every((l) => /~/.test(l)), labels);
    ok('none of them reads 1th, 2th or 3th', labels.every((l) => !/[^1]?[123]th\b/.test(l.replace(/1[123]th/g, 'ok'))), labels);
  }

  console.log('\n17. every surface that describes growth now describes three numbers');
  {
    /* The site told Google in structured data that Cubby does not chart head circumference, and
       the two feature cards and the teaching copy still promised exactly two. FAQ prose and its
       JSON-LD twin are checked against each other, because they have drifted before. */
    const faq = await getText('/faq/index.html');
    const dd = /<dt>Can I track head circumference\?<\/dt>\s*<dd>([^<]*)<\/dd>/.exec(faq);
    const ld = /"name":"Can I track head circumference\?","acceptedAnswer":\{"@type":"Answer","text":"([^"]*)"\}/.exec(faq);
    ok('the FAQ still asks the question', !!dd && !!ld, { dd: dd && dd[1], ld: ld && ld[1] });
    ok('the visible answer no longer denies the feature', !!dd && !/not charted|isn't charted/i.test(dd[1]), dd && dd[1]);
    ok('the JSON-LD answer no longer denies it either', !!ld && !/not charted|isn't charted/i.test(ld[1]), ld && ld[1]);
    ok('and the two copies are identical, not merely similar', !!dd && !!ld && dd[1] === ld[1], { dd: dd && dd[1], ld: ld && ld[1] });
    const gc = /<dt>Are there growth charts\?<\/dt>\s*<dd>([^<]*)<\/dd>/.exec(faq);
    const gcl = /"name":"Are there growth charts\?","acceptedAnswer":\{"@type":"Answer","text":"([^"]*)"\}/.exec(faq);
    ok('the growth-charts answer names all three', !!gc && /head circumference/i.test(gc[1]), gc && gc[1]);
    ok('in lockstep with its JSON-LD twin', !!gc && !!gcl && gc[1] === gcl[1], { gc: gc && gc[1], gcl: gcl && gcl[1] });
    for (const path of ['/index.html', '/features/index.html']) {
      const html = await getText(path);
      const card = /<b>Growth charts<\/b><span>([^<]*)<\/span>/.exec(html);
      ok('the growth card on ' + path + ' names head circumference', !!card && /head circumference/i.test(card[1]), card && card[1]);
    }
    const t = await page.evaluate(() => {
      try { const r = window.CubbyTeachData.rows.openGrowth; return { one: r.one, matters0: r.matters[0].join(' '), how0: r.how[0], label: r.label }; }
      catch (e) { return { err: e.message }; }
    });
    ok('the teaching one-liner names the third number', !t.err && /head circumference/i.test(t.one), t.one);
    ok('and stays under 140 characters', !t.err && t.one.length < 140, t.one && t.one.length);
    ok('"one of the two is enough" became three', !t.err && /three/.test(t.matters0) && !/One of the two/.test(t.matters0), t.matters0);
    ok('the how-to offers a head measurement', !t.err && /head measurement/i.test(t.how0), t.how0);
    ok('the sheet heading still matches the registry label', !t.err && t.label === 'Measurement', t.label);
    const guide = await getText('/app/log-guide.js');
    ok('the guide chapter names all three', /Weight, height and head circumference, whenever you have them/.test(guide), null);
    ok('and so does the health story step', /Weight, height and head circumference whenever you have them\. Over a few visits each draws/.test(guide), null);
    ok('nothing left promising one of the two', !/One of the two is fine/.test(guide), null);
  }

  if (SELF_TEST) {
    console.log('\nself-test: assertions that must be able to go red');
    const before = fail;
    ok('(self-test) a deliberately false claim fails', false, 'expected');
    ok('(self-test) the harness counted it', fail === before + 1, { before, after: fail });
    pass -= 1; fail -= 1; // unwind the deliberate failure so the run's verdict is about the app
    console.log('  (self-test failure unwound; ' + pass + '/' + fail + ' carried forward)');
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'HEAD-CIRC: FAIL' : 'HEAD-CIRC: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
