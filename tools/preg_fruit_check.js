#!/usr/bin/env node
/* THE WEEK'S FRUIT: an emoji only when it really is that fruit.
 *
 * Home says "about the size of a ..." every week of a pregnancy and puts an emoji after it
 * (PREG.sizeEmoji in app/pregnancy-data.js). Sixteen of the 38 weeks had no true emoji, so the map
 * filled them with stand-ins: coloured circles for a poppy seed, a kumquat, a fig, a lime and a
 * pomegranate; a strawberry for a raspberry, beans for a lentil, a mango for a papaya, broccoli for
 * a cauliflower, a tangerine for a grapefruit, a lettuce for a leek, and a carved jack-o'-lantern
 * for butternut squash, squash and pumpkin. So week 40, the week she is due, read "about the size
 * of a pumpkin" next to a Halloween face. The moments cards were worse: every card said
 * "🍐 about the size of a ..." whatever the week. Founder, 28 Nov 2026: show the fruit only where
 * the emoji is the fruit; every other week has the words alone. The week card widget (F4) reads
 * the same function, so this is the one map for every surface.
 *
 * 1. The map itself, week by week (no browser). Plant: the old map must fail the same table.
 * 2. Home's hero line at week 30 (an emoji week) and week 40 (words only, nothing after them).
 *    Plant: the old sizeEmoji swapped back in must put an emoji after "pumpkin" again.
 * 3. The week sheets: the "Baby this week" tile keeps a neutral sprout when there is no fruit, and
 *    the size sheet draws no big empty emoji block.
 * 4. The moments cards: no pear, the week's own fruit or none. The kept memories (after the pregnancy
 *    ended, a loss included) show the size in words alone; section 1 holds that no pear is left.
 *
 * Runs the app in local mode (cubby-quick-uid=local): a PASS attests to index.html and
 * pregnancy-data.js, not to sync. It does not judge how each emoji looks on every phone's font.
 *
 *   node tools/serve.js &   &&   node tools/preg_fruit_check.js http://localhost:8123
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const dl = require('./gate_downloads');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.argv[2] || 'http://localhost:8123').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 240) : '')); } };
const planted = (n, real) => { ok('plant caught: ' + n, real === false, 'the check stayed green on broken code'); };

/* Week -> the emoji it must show, or '' for words alone. */
const EXPECT = {
  4: '', 5: '', 6: '', 7: '🫐', 8: '', 9: '🍒', 10: '', 11: '', 12: '', 13: '🫛', 14: '🍋', 15: '🍎',
  16: '🥑', 17: '', 18: '🫑', 19: '🥭', 20: '🍌', 21: '🥕', 22: '', 23: '', 24: '🌽', 25: '', 26: '🥬',
  27: '🥬', 28: '🍆', 29: '', 30: '🥕', 31: '🥥', 32: '', 33: '🍍', 34: '🍈', 35: '🍈', 36: '🥬', 37: '🥬',
  38: '', 39: '🍉', 40: '', 41: '',
};

/* The map as it stood before this fix, kept verbatim so the plant is the real old behaviour. */
const OLD_MAP = {
  'poppy seed': '⚫', 'sesame seed': '⚪', 'lentil': '🫘', 'blueberry': '🫐', 'raspberry': '🍓', 'cherry': '🍒',
  'kumquat': '🟠', 'fig': '🟣', 'lime': '🟢', 'pea pod': '🫛', 'lemon': '🍋', 'apple': '🍎', 'avocado': '🥑',
  'pomegranate': '🔴', 'bell pepper': '🫑', 'mango': '🥭', 'banana': '🍌', 'carrot': '🥕', 'papaya': '🥭',
  'grapefruit': '🍊', 'corn cob': '🌽', 'cauliflower': '🥦', 'lettuce': '🥬', 'cabbage': '🥬', 'aubergine': '🍆',
  'butternut squash': '🎃', 'large carrot': '🥕', 'coconut': '🥥', 'squash': '🎃', 'pineapple': '🍍',
  'cantaloupe': '🍈', 'honeydew melon': '🍈', 'romaine lettuce': '🥬', 'chard': '🥬', 'leek': '🥬',
  'small watermelon': '🍉', 'pumpkin': '🎃',
};
const oldSizeEmoji = (s) => OLD_MAP[(s || '').toLowerCase()] || '🌱';

/* ---- 1. the map ---------------------------------------------------------------------------- */
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'pregnancy-data.js'), 'utf8'), sandbox);
const PREG = sandbox.window.PREG;
const tableMisses = (fn) => Object.keys(EXPECT).filter((w) => fn(PREG.weeks[w].size) !== EXPECT[w])
  .map((w) => w + ' ' + PREG.weeks[w].size + ' -> ' + JSON.stringify(fn(PREG.weeks[w].size)));

console.log('\n1. the map, week by week');
ok('every week 4 to 41 has a size', Object.keys(EXPECT).every((w) => PREG.weeks[w] && PREG.weeks[w].size));
const miss = tableMisses(PREG.sizeEmoji);
ok('sizeEmoji gives each week its true fruit, or nothing (38 weeks)', miss.length === 0, miss.join('; '));
ok('an unknown size gets nothing, not a sprout', PREG.sizeEmoji('quince') === '' && PREG.sizeEmoji('') === '');
ok('22 weeks with a fruit, 16 with the words alone',
  Object.values(EXPECT).filter(Boolean).length === 22 && Object.values(EXPECT).filter((e) => !e).length === 16);
planted('the old map (circles, jack-o\'-lantern, sprout fallback)', tableMisses(oldSizeEmoji).length === 0);
/* The moments cards and the kept memories once hard-coded a pear before every size. */
const pears = (src) => (src.match(/🍐/gu) || []).length;
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
ok('no hard-coded pear left in index.html', pears(indexSrc) === 0, pears(indexSrc) + ' found');
planted('a pear staged in the old moments line', pears("${size?'🍐 about the size of a '+escapeHtml(size):''}") === 0);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  const errs = [];
  const now = Date.now(), DAY = 86400000, HOUR = 3600000;
  const base = { babies: [], activeBabyId: null, events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1, log: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [] };
  /* An hour of margin either side of the week turn; the page clock only moves further along. */
  const atWeek = (w) => Object.assign({}, base, { pregnancy: {
    id: 'p1', stage: 'expecting', dueDate: now + (40 - w) * 7 * DAY - HOUR, appts: [], bp: [], weights: [], periods: [],
    moments: [{ id: 'm40', week: 40, note: '', at: now - 2 * DAY }, { id: 'm30', week: 30, note: '', at: now - 3 * DAY }],
  } });
  const arrive = async (state) => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844 });
    await p.evaluateOnNewDocument((x) => {
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('little-log-v1', JSON.stringify(x));
    }, state);
    await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(2200);
    return p;
  };
  const text = (p) => p.evaluate(() => { const s = document.getElementById('scroll'); return ((s && s.innerText) || '').replace(/\s+/g, ' '); });
  const sheet = (p, kind) => p.evaluate((k) => {
    openWeekDetail(k);
    const s = document.getElementById('sheet');
    const big = s ? [...s.querySelectorAll('div')].filter((d) => d.style && d.style.fontSize === '60px') : [];
    const ico = s ? s.querySelector('.preg-card .pc-ico') : null;
    const out = { text: s ? s.innerText.replace(/\s+/g, ' ') : '', big: big.map((d) => d.textContent.trim()), ico: ico ? ico.textContent.trim() : null };
    closeSheet();
    return out;
  }, kind);
  const hero = (p) => p.evaluate(() => { const h = document.querySelector('.wh-count'); return h ? h.textContent.trim() : null; });
  const after = (t, size) => { const i = t.indexOf('about the size of a ' + size); return i < 0 ? null : t.slice(i + ('about the size of a ' + size).length, i + ('about the size of a ' + size).length + 4); };

  try {
    const probe = await arrive(atWeek(30));
    const wk = await probe.evaluate(() => typeof pregWeek === 'function' ? pregWeek() : null);
    console.log('\n  [checkout] ' + BASE + (wk === 30 ? ' boots a pregnancy at week 30. Good.' : ' answered week ' + wk + '. Wrong port or a changed pregWeek.'));

    console.log('\n2. Home\'s hero line');
    const t30 = await text(probe);
    ok('week 30: "about the size of a large carrot 🥕"', /about the size of a large carrot 🥕/u.test(t30), t30.slice(0, 160));
    const p40 = await arrive(atWeek(40));
    const t40 = await text(p40);
    const h40 = await hero(p40);
    ok('week 40: "about the size of a pumpkin" is on Home', after(t40, 'pumpkin') !== null, t40.slice(0, 160));
    ok('week 40: the hero line ends at "pumpkin", no jack-o\'-lantern', !!h40 && /about the size of a pumpkin$/.test(h40), JSON.stringify(h40));
    ok('no 🎃 anywhere on Home at week 40', !t40.includes('🎃'));
    const planH = await p40.evaluate((src) => { PREG.sizeEmoji = eval('(' + src + ')'); render(); const h = document.querySelector('.wh-count'); return h ? h.textContent.trim() : null; },
      '(s) => (' + JSON.stringify(OLD_MAP) + ')[(s || "").toLowerCase()] || "🌱"');
    planted('old sizeEmoji on Home', !!planH && /about the size of a pumpkin$/.test(planH));
    await p40.close();

    console.log('\n3. the week sheets');
    const p40b = await arrive(atWeek(40));
    const b40 = await sheet(p40b, 'baby');
    ok('week 40 "Baby this week": tile is the neutral sprout', b40.ico === '🌱', JSON.stringify(b40.ico));
    const s40 = await sheet(p40b, 'size');
    ok('week 40 size sheet: no big emoji block at all', s40.big.length === 0, JSON.stringify(s40.big));
    ok('week 40 size sheet: still names the pumpkin', /About the size of a pumpkin/.test(s40.text), s40.text.slice(0, 120));
    const b30 = await sheet(probe, 'baby');
    ok('week 30 "Baby this week": tile is the carrot', b30.ico === '🥕', JSON.stringify(b30.ico));
    const s30 = await sheet(probe, 'size');
    ok('week 30 size sheet: one big carrot', s30.big.length === 1 && s30.big[0] === '🥕', JSON.stringify(s30.big));

    console.log('\n4. the moments cards');
    const m = await p40b.evaluate(() => {
      const d = document.createElement('div'); d.innerHTML = renderPregMoments();
      return [...d.querySelectorAll('.moment-card')].map((c) => ({ week: (c.querySelector('.mc-week') || {}).textContent, size: ((c.querySelector('.mc-size') || {}).textContent || '').trim() }));
    });
    const by = (w) => (m.find((c) => c.week === 'Week ' + w) || {}).size;
    ok('two moment cards drawn', m.length === 2, JSON.stringify(m));
    ok('no pear on any card', m.every((c) => !c.size.includes('🍐')), JSON.stringify(m));
    ok('week 30 card: "about the size of a large carrot 🥕"', by(30) === 'about the size of a large carrot 🥕', JSON.stringify(by(30)));
    ok('week 40 card: "about the size of a pumpkin", nothing after', by(40) === 'about the size of a pumpkin', JSON.stringify(by(40)));
    await p40b.close();
    await probe.close();
  } catch (e) {
    ok('the run finished', false, e.stack);
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FAIL' : 'PASS');
  process.exit(fail ? 1 : 0);
})();
