#!/usr/bin/env node
/* The boundary conditions a real family hits, driven against the real app.
 *
 * Each probe seeds one awkward state and asserts what Cubby SAYS about it, because the failure mode
 * here is almost never a crash. tools/flow_walk.js already showed 362 flow openings with zero
 * crashes. The failure mode is the app saying something confidently wrong, which is worse on a page
 * a parent trusts about a baby.
 *
 * A probe that says EXPECTED is a documented, deliberate behaviour. A probe that says LOOK is a
 * judgement call worth a human eye, not automatically a bug.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/edge_probe.js http://localhost:8123
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const S = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us',
    seen: { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: [],
}, over || {});
const ev = (id, type, hoursAgo, extra) => Object.assign({ id, type, babyId: 'b1', time: now - hoursAgo * HOUR }, extra || {});

const PROBES = [
  { name: 'twins: two babies, one circle',
    seed: S({ babies: [{ id: 'b1', name: 'Robin', birth: now - 40 * DAY, sex: 'F', routines: [] },
                       { id: 'b2', name: 'Wren', birth: now - 40 * DAY, sex: 'M', routines: [] }],
      events: [ev('f1', 'feed', 1, { method: 'bottle', amount: 90, unit: 'ml' }),
        Object.assign(ev('f2', 'feed', 2, { method: 'bottle', amount: 80, unit: 'ml' }), { babyId: 'b2' })] }),
    ask: 'does home name WHICH baby, and can the other be reached?',
    read: (t) => ({ namesActive: /Robin/.test(t), namesOther: /Wren/.test(t) }) },

  { name: 'nap running across midnight',
    seed: S({ timers: { b1: { sleep: { start: now - 15 * HOUR } } },
      events: [ev('s0', 'sleep', 30, { end: now - 28 * HOUR })] }),
    ask: 'a 15h nap started yesterday: what does today say?',
    read: (t) => ({ sleepToday: (t.match(/([\dhm. ]+)\s*Sleep today/i) || [])[1],
      banner: (t.match(/SLEEPING\s*([\d:]+)/i) || [])[1] }) },

  { name: 'timer left running for three days',
    seed: S({ timers: { b1: { sleep: { start: now - 3 * DAY } } } }),
    ask: 'does Cubby notice, or claim a 72 hour nap?',
    read: (t) => ({ banner: (t.match(/SLEEPING\s*([\d:]+)/i) || [])[1], warns: /still running|forgot|so long|check/i.test(t) }) },

  { name: 'a future-dated feed',
    seed: S({ events: [ev('f1', 'feed', -3, { method: 'bottle', amount: 100, unit: 'ml' })] }),
    ask: 'a mis-scrolled AM/PM puts a feed 3h in the future',
    read: (t) => ({ lastFeed: (t.match(/LAST FEED\s*([^\n]{0,18})/i) || [])[1] }) },

  { name: 'newborn, first day, nothing logged',
    seed: S({ babies: [{ id: 'b1', name: 'Wren', birth: now - 6 * HOUR, sex: 'M', routines: [] }] }),
    ask: 'six hours old, no logs. Is the empty state kind and useful?',
    read: (t) => ({ age: (t.match(/(\d+\s*(?:hours?|days?|weeks?)\s*old)/i) || [])[1],
      pushesPhoto: /add a photo/i.test(t), pushesFirstLog: /first (entry|log)/i.test(t) }) },

  { name: 'baby with no birth date',
    seed: S({ babies: [{ id: 'b1', name: 'Robin', birth: null, sex: 'F', routines: [] }] }),
    ask: 'an adopted or not-yet-filled profile',
    read: (t) => ({ age: (t.match(/(\d+\s*(?:days?|weeks?|months?)\s*old)/i) || [])[1] || '(none shown)',
      nan: /NaN|Invalid|undefined/.test(t) }) },

  { name: 'one feed, exactly one',
    seed: S({ events: [ev('f1', 'feed', 2, { method: 'bottle', amount: 100, unit: 'ml' })] }),
    ask: 'the singular/plural boundary',
    read: (t) => ({ strip: (t.match(/(\d+)\s*\n?\s*(Feed|Feeds) today/i) || []).slice(1, 3).join(' '),
      badPlural: /\b1 Feeds today|\b1 Nappies today|1 feeds\b/i.test(t) }) },

  { name: 'a very long baby name',
    seed: S({ babies: [{ id: 'b1', name: 'Bartholomew Alexander Montgomery', birth: now - 60 * DAY, sex: 'M', routines: [] }] }),
    ask: 'does a 32-character name break the header or overflow?',
    read: (t) => ({ shown: /Bartholomew/.test(t) }) },

  { name: 'overdue pregnancy, 42 weeks',
    seed: S({ babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now - 14 * DAY, lmp: now - 294 * DAY,
        cycleLen: 28, periods: [], country: 'us', precon: [], careTeam: [], appts: [], symptoms: [], weights: [],
        bp: [], kicks: [], contractions: [], birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [],
        urine: [], supplements: [], supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 294 * DAY } }),
    ask: 'two weeks past the due date. Does it count up, or say something alarming?',
    read: (t) => ({ week: (t.match(/[Ww]eek\s*(\d+)/) || [])[1], overdue: /overdue|past|late/i.test(t),
      countdown: /\d+\s*days? (to go|left)/i.test(t) }) },

  { name: 'pregnancy with no due date and no LMP',
    seed: S({ babies: [], activeBabyId: null,
      pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: null, lmp: null, cycleLen: 28,
        periods: [], country: 'us', precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [],
        kicks: [], contractions: [], birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [],
        supplements: [], supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now } }),
    ask: 'she knows she is pregnant but not the dates yet',
    read: (t) => ({ week: (t.match(/[Ww]eek\s*(\d+)/) || [])[1] || '(none)', nan: /NaN|Invalid|undefined/.test(t) }) },

  { name: 'pregnancy AND a baby at once',
    seed: S({ pregnancy: { id: 'p1', ownerUid: 'local', stage: 'expecting', dueDate: now + 90 * DAY, lmp: now - 190 * DAY,
      cycleLen: 28, periods: [], country: 'us', precon: [], careTeam: [], appts: [], symptoms: [], weights: [], bp: [],
      kicks: [], contractions: [], birthPlan: '', bag: [], moments: [], conditions: {}, glucose: [], urine: [],
      supplements: [], supplementLog: [], nausea: [], glucoseUnit: 'mmol', bornBabyId: null, createdAt: now - 190 * DAY } }),
    ask: 'a toddler and a pregnancy in one account, which the listing promises',
    read: (t) => ({ showsBaby: /Robin/.test(t) }) },

  { name: 'a thousand events',
    seed: S({ events: Array.from({ length: 1000 }, (_, i) =>
      ev('e' + i, i % 3 === 0 ? 'feed' : i % 3 === 1 ? 'diaper' : 'sleep', i * 2,
        i % 3 === 0 ? { method: 'bottle', amount: 100, unit: 'ml' } : i % 3 === 1 ? { kind: 'wet' } : { end: now - (i * 2 - 1) * HOUR })) }),
    ask: 'eight months of real logging',
    read: (t) => ({ rendered: t.length > 400 }) },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
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

  console.log('\n' + PROBES.length + ' edge cases, driven against the real app\n');
  for (const p of PROBES) {
    const before = errs.length;
    await page.evaluate((s) => {
      localStorage.setItem('little-log-v1', JSON.stringify(s));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, p.seed);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
    await page.evaluate(() => { try { window.toast = function () {}; render(); } catch (e) {} });
    await sleep(400);
    const text = await page.evaluate(() => ((document.getElementById('scroll') || document.body).innerText || ''));
    let out = {};
    try { out = p.read(text); } catch (e) { out = { readerThrew: String(e.message) }; }
    const broke = errs.length - before;
    console.log('  ' + p.name);
    console.log('    q: ' + p.ask);
    console.log('    a: ' + JSON.stringify(out) + (broke ? '   PAGE ERRORS: ' + broke : ''));
    console.log('');
  }
  await browser.close();
  console.log(errs.length ? 'page errors during the run: ' + errs.length + '\n  ' + [...new Set(errs)].slice(0, 5).join('\n  ')
    : 'no page errors in any edge case');
})().catch((e) => { console.error(e); process.exit(2); });
