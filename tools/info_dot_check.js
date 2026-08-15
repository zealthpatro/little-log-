/* The info dot must actually be on the sheet.
 *
 * Almost none of the "i" buttons in Cubby are placed by hand. openSheet runs every sheet's html
 * through CubbyTeachUI.sheetDot, which finds the matching teach row by comparing the sheet's own
 * <h2> against the labels in app/teach-data.js. That is a good design and it has one sharp edge:
 * when the two drift apart, sheetDot returns the html UNTOUCHED. No error, no warning, the help
 * just quietly stops existing.
 *
 * It happened the day the Nappy rename shipped. The sheet heading became "Nappy" while teach-data
 * still said 'Diaper', so the info dot vanished from the sheet while the one on the home strip
 * stayed, and tools/teach_gate.js passed 4813/4813 throughout, because it validates the teach data
 * against itself and never opens a sheet.
 *
 * This opens real sheets in a real browser and checks the dot is on each one. It does not cover
 * every row (many sheets need specific state to reach); it covers the ones a parent meets most and
 * the shapes most likely to drift: a plain noun, a possessive, and a heading phrased as a question.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/info_dot_check.js http://localhost:8123
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

// Sheets a parent actually opens, by the function that opens them.
const SHEETS = [
  ['openFeed', 'Feed'], ['openDiaper', 'Nappy'], ['openMoreLogs', 'More logs'],
  ['openQuickLog', 'Quick log'], ['openSettings', 'Settings'], ['openFamily', 'Family'],
  ['openMedSheet', 'Medicine'], ['openVisitSummary', 'Visit summary'], ['openGrowth', 'Growth'],
  ['openMilestone', 'Milestone'], ['openDataSheet', 'Your data'], ['openHouseholdName', 'Family name'],
];

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
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate((n) => {
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('little-log-v1', JSON.stringify({
      babies: [{ id: 'b1', name: 'Robin', birth: n - 120 * 86400000, sex: 'F', routines: [] }], activeBabyId: 'b1',
      events: [{ id: 'f1', type: 'feed', babyId: 'b1', method: 'bottle', amount: 120, unit: 'ml', time: n - 2 * 3600000 }],
      settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
      timers: {}, milestones: [], meds: [{ id: 'm1', babyId: 'b1', name: 'Vitamin D', dose: '1', unit: 'drops', active: true }],
      photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [],
    }));
  }, CLOCK);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1700);

  console.log('\n1. every teach label still matches the heading its sheet paints');
  for (const [fn, name] of SHEETS) {
    const r = await page.evaluate((f) => {
      try {
        if (typeof window[f] !== 'function') return { missing: true };
        window[f]();
        const h2 = document.querySelector('#sheet h2');
        return { title: h2 ? (h2.textContent || '').replace(/\s+/g, ' ').trim() : null,
                 dot: !!(h2 && h2.querySelector('.lg-i')) };
      } catch (e) { return { err: String(e.message) }; }
    }, fn);
    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await sleep(200);
    if (r.missing) { ok(name + ': ' + fn + ' exists', false, 'function not defined'); continue; }
    if (r.err) { ok(name + ': opens without throwing', false, r.err); continue; }
    ok(name + ' (' + String(r.title).replace(/i$/, '').slice(0, 30) + ') carries its info dot', r.dot === true, r);
  }

  console.log('\n2. the dot leads somewhere, rather than being decoration');
  {
    const r = await page.evaluate(() => {
      openDiaper();
      const b = document.querySelector('#sheet h2 .lg-i');
      if (!b) return { noDot: true };
      const onclick = b.getAttribute('onclick') || '';
      b.click();
      const overlay = document.querySelector('#teachOv,#logGuide,.teach-ov,[id*="each"]');
      const text = overlay ? (overlay.textContent || '').replace(/\s+/g, ' ').trim() : '';
      return { onclick, opened: !!overlay, chars: text.length, head: text.slice(0, 70) };
    });
    ok('tapping it calls the teaching layer', /CubbyTeachUI\.(page|chapter|brief)\('openDiaper'\)/.test(r.onclick || ''), r.onclick);
    ok('and something with real content opens', r.opened && r.chars > 80, { opened: r.opened, chars: r.chars, head: r.head });
  }

  console.log('\n3. the regression that started this');
  {
    const r = await page.evaluate(() => {
      const rows = (window.CubbyTeachData && window.CubbyTeachData.rows) || {};
      return { label: rows.openDiaper && rows.openDiaper.label, aka: (rows.openDiaper && rows.openDiaper.aka) || [] };
    });
    ok('teach-data calls it what the sheet calls it', r.label === 'Nappy', r);
    ok('and the old word is kept as an alias, so older references still resolve', r.aka.indexOf('diaper') >= 0, r);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INFO-DOT: FAIL' : 'INFO-DOT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
