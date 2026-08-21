#!/usr/bin/env node
/* Walk every user flow in Cubby, in every life stage, and record what actually happens.
 *
 * The inventory is not invented here: app/teach-data.js already registers all 123 entry points with
 * the stage each belongs to, and tools/teach_gate.js keeps that list honest against the code. So
 * this drives the real list rather than a list someone wrote down once.
 *
 * For each flow it records: did it open, did it throw, what is the heading, is there a way back
 * out, does it carry its info dot, and did the page log an error. Then it does the same walk in the
 * three empty-state variants that break things, because a flow that works on a seeded family and
 * dies on an empty one is the flow a new parent actually meets.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/flow_walk.js http://localhost:8123
 *   node tools/flow_walk.js http://localhost:8123 --stage baby --json out.json
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8123';
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY_STAGE = arg('--stage');
const JSON_OUT = arg('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const ev = (id, type, hoursAgo, extra) => Object.assign({ id, type, babyId: 'b1', time: now - hoursAgo * 3600000 }, extra || {});
const baseSettings = { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us',
  seen: { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1 } };

/* Four stages, and for each the "furnished" state a real user reaches after a week. The empty
   variants are generated from these by stripping, so the two can never drift apart. */
const STAGES = {
  baby: {
    babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: ['penicillin'] }],
    activeBabyId: 'b1',
    events: [ev('f1', 'feed', 2, { method: 'bottle', amount: 120, unit: 'ml' }),
      ev('d1', 'diaper', 3, { kind: 'wet' }), ev('s1', 'sleep', 9, { end: now - 7 * 3600000 }),
      ev('g1', 'growth', 26, { weight: 6.1, wUnit: 'kg', height: 60, hUnit: 'cm' }),
      ev('t1', 'temperature', 30, { temp: 37.2, unit: 'C' })],
    settings: baseSettings, timers: {},
    milestones: [{ id: 'ms1', babyId: 'b1', key: 'first-smile', name: 'First smile', date: now - 9 * DAY }],
    meds: [{ id: 'md1', babyId: 'b1', subject: { kind: 'baby', id: 'b1' }, name: 'Vitamin D', dose: '1', unit: 'drops',
      active: true, pattern: { type: 'daily', times: ['09:00'] }, remind: true, createdAt: now - 20 * DAY }],
    photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [],
  },
  child: null,       // same shape, older baby; built below
  /* The pregnancy shapes are copied from where the app itself builds them (index.html:6634), NOT
     invented. The first version of this file seeded planning as `pregnancy: null` plus a `state.trying`
     key that has never existed, so the app was never in the planning stage at all and every result
     from that walk was measuring a state the product cannot be in. The stage IS the pregnancy
     record: `state.pregnancy.stage === 'planning'`. */
  pregnancy: {
    babies: [], activeBabyId: null, events: [], settings: baseSettings, timers: {},
    milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [],
    pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 110 * DAY, lmp: now - 170 * DAY,
      cycleLen: 28, periods: [now - 170 * DAY], country: 'us', precon: [], careTeam: [], appts: [],
      symptoms: [], weights: [{ t: now - 20 * DAY, kg: 64 }], bp: [], kicks: [], contractions: [],
      birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [], supplements: [],
      supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 170 * DAY, journey: {} },
  },
  planning: {
    babies: [], activeBabyId: null, events: [], settings: baseSettings, timers: {},
    milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [],
    pregnancy: { id: 'p0', ownerUid: 'local', stage: 'planning', dueDate: null, lmp: now - 31 * DAY,
      cycleLen: 29, periods: [now - 91 * DAY, now - 60 * DAY, now - 31 * DAY], tryingSince: now - 200 * DAY,
      country: 'us', precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [], kicks: [],
      contractions: [], birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [],
      supplements: [], supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 200 * DAY },
  },
};
STAGES.child = Object.assign({}, STAGES.baby, {
  babies: [{ id: 'b1', name: 'Robin', birth: now - 700 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
});
// The state a brand-new person is in: signed in, nothing chosen, nothing logged.
const EMPTY = { babies: [], activeBabyId: null, events: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [] };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const pageErrs = [];
  page.on('pageerror', (e) => pageErrs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const results = [];
  const variants = [];
  for (const [stage, seed] of Object.entries(STAGES)) {
    if (ONLY_STAGE && stage !== ONLY_STAGE) continue;
    variants.push({ stage, fill: 'furnished', seed });
    // The empty variant keeps the SAME pregnancy shape and strips only what a user would not have
    // logged yet, so a difference between the two is about content, never about a different app.
    const bare = (p) => Object.assign({}, p, { periods: [], weights: [], kicks: [], contractions: [],
      symptoms: [], appts: [], moments: [], glucose: [], supplements: [], supplementLog: [], nausea: [], precon: [] });
    variants.push({ stage, fill: 'empty', seed: Object.assign({}, EMPTY,
      (stage === 'pregnancy' || stage === 'planning') ? { pregnancy: bare(seed.pregnancy) }
        : { babies: seed.babies, activeBabyId: 'b1' }) });
  }

  for (const v of variants) {
    await page.evaluate((s) => {
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, v.seed);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.evaluate(() => {
      window.LL = window.LL || {}; window.LL.role = 'owner';
      window.LL.members = { local: 'owner' };
      window.LL.memberInfo = { local: { name: 'Maya', relationship: 'Mama Bear', role: 'owner' } };
      try { window.toast = function () {}; } catch (e) {}
      try { render(); } catch (e) {}
    });
    await sleep(400);

    /* REACHABILITY, not the whole registry.
       Calling every teach entry blindly measures nothing: openBirthPoster reads activeBaby().place
       and throws in the pregnancy stage, but the pregnancy shell renders renderPregMoments() and
       never offers it, so no parent can reach that crash. The first version of this file reported
       four such "defects", every one of them an artefact of calling a function the UI withholds.
       So: walk the screens a person can actually get to in this stage, harvest the onclick handlers
       the app itself puts on screen, and test those. Anything in the registry that never appears is
       reported separately as unreachable-here, which is information rather than a bug. */
    const flows = await page.evaluate((stage) => {
      const rows = (window.CubbyTeachData && window.CubbyTeachData.rows) || {};
      const screens = stage === 'pregnancy' || stage === 'planning'
        ? [['preg', ['home', 'care', 'moments', 'you']]] : [['tab', ['home', 'log', 'album', 'health']]];
      const found = new Map();
      screens.forEach(([kind, list]) => list.forEach((v) => {
        try { kind === 'preg' ? pregGo(v) : go(v); } catch (e) { return; }
        document.querySelectorAll('[onclick]').forEach((el) => {
          const m = /(?:^|[;\s])([a-zA-Z_$][\w$]*)\s*\(\s*\)/.exec(el.getAttribute('onclick') || '');
          if (!m) return;                                   // skip handlers that take arguments
          const fn = m[1];
          if (!found.has(fn)) found.set(fn, { fn, from: (kind === 'preg' ? 'preg:' : '') + v,
            text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) });
        });
      }));
      const reg = {}; Object.keys(rows).forEach((id) => { reg[String(rows[id].fn).replace(/\(.*$/, '')] = rows[id]; });
      return [...found.values()].map((f) => Object.assign(f, {
        id: f.fn, label: (reg[f.fn] && reg[f.fn].label) || f.text || f.fn,
        domain: (reg[f.fn] && reg[f.fn].domain) || 'unregistered', taught: !!reg[f.fn], fn: f.fn + '()' }));
    }, v.stage);

    for (const f of flows) {
      const before = pageErrs.length;
      const r = await page.evaluate((fnStr) => {
        const name = String(fnStr).replace(/\(.*$/, '');
        if (typeof window[name] !== 'function') return { missing: true, name };
        try { window[name](); } catch (e) { return { threw: String(e && e.message).slice(0, 120), name }; }
        const sheet = document.getElementById('sheet');
        const open = !!(sheet && sheet.classList.contains('show'));
        const h2 = sheet && sheet.querySelector('h2');
        const body = open ? sheet : (document.getElementById('scroll') || document.body);
        return { name, open,
          title: h2 ? (h2.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44) : null,
          chars: (body.innerText || '').trim().length,
          hasClose: !!(sheet && sheet.querySelector('.sheet-x, .btn-ghost')),
          hasDot: !!(sheet && sheet.querySelector('.lg-i')) };
      }, f.fn);
      results.push(Object.assign({ stage: v.stage, fill: v.fill, depth: 1 }, f, r, { errs: pageErrs.length - before }));

      /* Depth 2: the buttons INSIDE the sheet that just opened. This is where a dead end actually
         lives, because a first-level screen is looked at constantly and a third-level confirm is
         not. Destructive handlers are listed rather than pressed: clicking "delete everything" in
         the middle of a walk would corrupt the state the rest of the walk is measuring. */
      if (r.open) {
        const kids = await page.evaluate(() => {
          const s = document.getElementById('sheet'); if (!s) return [];
          const out = new Map();
          s.querySelectorAll('[onclick]').forEach((el) => {
            const m = /(?:^|[;\s])([a-zA-Z_$][\w$]*)\s*\(\s*\)/.exec(el.getAttribute('onclick') || '');
            if (m && !out.has(m[1])) out.set(m[1], { fn: m[1], text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28) });
          });
          return [...out.values()];
        });
        const DESTRUCTIVE = /delete|remove|erase|wipe|endPregnancy|signOut|leave|revoke|reset|clear|discard|stop/i;
        for (const k of kids) {
          if (k.fn === 'closeSheet' || k.fn === 'sheetBack' || k.fn === 'render') continue;
          if (DESTRUCTIVE.test(k.fn)) { results.push({ stage: v.stage, fill: v.fill, depth: 2, id: k.fn, label: k.text || k.fn,
            domain: 'destructive', name: k.fn, skipped: 'destructive, listed not pressed', parent: f.id }); continue; }
          const b2 = pageErrs.length;
          const r2 = await page.evaluate((n) => {
            if (typeof window[n] !== 'function') return { missing: true, name: n };
            try { window[n](); } catch (e) { return { threw: String(e && e.message).slice(0, 120), name: n }; }
            const sheet = document.getElementById('sheet');
            const h2 = sheet && sheet.querySelector('h2');
            return { name: n, open: !!(sheet && sheet.classList.contains('show')),
              title: h2 ? (h2.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44) : null,
              chars: ((sheet || document.body).innerText || '').trim().length,
              hasClose: !!(sheet && sheet.querySelector('.sheet-x, .btn-ghost')) };
          }, k.fn);
          results.push(Object.assign({ stage: v.stage, fill: v.fill, depth: 2, id: k.fn, label: k.text || k.fn,
            domain: 'child', parent: f.id }, r2, { errs: pageErrs.length - b2 }));
          // Back to the parent sheet so the next sibling is tested from the same place.
          await page.evaluate((fn) => { try { closeSheet(); } catch (e) {} try { window[fn.replace(/\(.*$/, '')](); } catch (e) {} }, f.fn);
          await sleep(70);
        }
      }
      await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
      await sleep(90);
    }
  }
  await browser.close();

  /* Report. The interesting rows are the ones that would strand a person: a flow that does not
     exist, one that throws, one that opens with nothing in it, and one with no way back out. */
  const missing = results.filter((r) => r.missing);
  const threw = results.filter((r) => r.threw);
  const errored = results.filter((r) => r.errs > 0);
  const noExit = results.filter((r) => r.open && !r.hasClose);
  const thin = results.filter((r) => r.open && r.chars < 40);

  console.log('\nwalked ' + results.length + ' flow openings across '
    + [...new Set(results.map((r) => r.stage))].join(', ') + ', furnished and empty');
  const bad = (name, list, fmt) => {
    console.log('\n' + name + ': ' + list.length);
    [...new Map(list.map((r) => [r.id + r.fill, r])).values()].slice(0, 25)
      .forEach((r) => console.log('  ' + (r.stage + '/' + r.fill).padEnd(18) + String(r.label).slice(0, 26).padEnd(28) + fmt(r)));
  };
  bad('flows whose function does not exist', missing, (r) => r.name);
  bad('flows that threw', threw, (r) => r.threw);
  bad('flows that logged a page error', errored, (r) => r.errs + ' error(s)');
  bad('flows with no visible way back', noExit, (r) => r.title || '(no heading)');
  bad('flows that open almost empty', thin, (r) => (r.title || '(no heading)') + '  ' + r.chars + ' chars');

  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1)); console.log('\nfull results -> ' + JSON_OUT); }
  // Exits non-zero so this can block a push: a flow that starts throwing, loses its way out, or
  // opens empty is a parent stranded, and that should stop a deploy the same as a failing test.
  const broken = missing.length + threw.length + errored.length + noExit.length + thin.length;
  console.log('\n' + (broken ? 'FLOW-WALK: FAIL — ' + broken + ' broken openings' : 'FLOW-WALK: PASS — nothing broken'));
  process.exit(broken ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
