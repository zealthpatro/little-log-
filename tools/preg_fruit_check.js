#!/usr/bin/env node
/* THE WEEK'S FRUIT, PAINTED: every week has its painting, and none of it outlives a loss.
 *
 * Home says "about the size of a ..." every week of a pregnancy. It used to put an emoji after it
 * (sixteen weeks had none that was true; week 40, the week she is due, got a carved jack-o'-lantern;
 * every moments card got a pear). Founder, 28 Nov 2026: paint them, "vibrant and better than the
 * emojis". PREG.sizeArt(size) names one painting per size in app/fruit-art/, shown on the Home week
 * card, in the week detail sheets and on her pregnancy moments. Kept memories, which outlive the
 * pregnancy and a loss, keep the size in words alone.
 *
 * 1. The set (no browser): every week 4 to 41 names a painting, each file exists, is a real WebP
 *    within its weight, nothing in app/fruit-art/ is orphaned, the set's total is bounded, and no
 *    emoji map or emoji fallback is left in the data or in index.html.
 *    Plants: a week dropped from the map, an oversized file, a stray emoji fallback.
 * 2. Home's week card at weeks 30 and 40: the painting is there, loaded, and the line ends in words.
 *    Plant: the map emptied must leave the card without its painting.
 * 3. The week sheets: the size sheet shows the painting large, the baby tile shows it small.
 * 4. Her moments: each card shows its own week's painting, no emoji, no pear.
 * 5. A loss: nothing painted on the holding screen (with and without a living child), and in the
 *    race where the loss has synced but the journey has not, she lands on the quiet screen, never
 *    on her week. Plant: pregFruitImg with its loss guard stripped must paint during the race.
 * 6. Kept memories months later, the quiet state over (so pregFruitImg's own guard is off): words
 *    only. Plant: the same sheet with pregFruitImg added must be caught.
 * Also: nothing is precached, pregFruitImg keeps alt="", an onerror fallback and its guard, a
 * failed tile falls back to the sprout, and moments paintings load lazily.
 *
 * Runs the app in local mode (cubby-quick-uid=local): a PASS attests to index.html,
 * pregnancy-data.js and app/fruit-art/, not to sync. It does not judge how the paintings look.
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

const ROOT = path.join(__dirname, '..');
const ART_DIR = path.join(ROOT, 'app', 'fruit-art');
const MAX_FILE = 28 * 1024;      // one painting, fetched for her current week only
const MAX_SET = 800 * 1024;      // the whole folder, so the set cannot quietly grow
const PICTO = /\p{Extended_Pictographic}/u;
const WEEKS = []; for (let w = 4; w <= 41; w++) WEEKS.push(w);

/* ---- 1. the set ---------------------------------------------------------------------------- */
const sandbox = { window: {} };
vm.createContext(sandbox);
const dataSrc = fs.readFileSync(path.join(ROOT, 'app', 'pregnancy-data.js'), 'utf8');
vm.runInContext(dataSrc, sandbox);
const PREG = sandbox.window.PREG;
const indexSrc = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');

const isWebp = (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
const setProblems = (artOf, readFile, listDir) => {
  const out = [];
  const used = new Set();
  for (const w of WEEKS) {
    const size = PREG.weeks[w] && PREG.weeks[w].size;
    const url = artOf(size);
    if (!url) { out.push('week ' + w + ' (' + size + ') has no painting'); continue; }
    const m = /^\/app\/fruit-art\/([a-z0-9-]+)\.webp$/.exec(url);
    if (!m) { out.push('week ' + w + ' names ' + url); continue; }
    used.add(m[1] + '.webp');
    const buf = readFile(m[1] + '.webp');
    if (!buf) out.push(m[1] + '.webp is missing');
    else if (!isWebp(buf)) out.push(m[1] + '.webp is not a WebP');
    else if (buf.length > MAX_FILE) out.push(m[1] + '.webp is ' + buf.length + ' bytes, over ' + MAX_FILE);
  }
  const files = listDir();
  for (const f of files) if (!used.has(f)) out.push('orphan ' + f);
  const total = files.reduce((t, f) => t + ((readFile(f) || []).length || 0), 0);
  if (total > MAX_SET) out.push('the set is ' + total + ' bytes, over ' + MAX_SET);
  return out;
};
const realRead = (f) => { try { return fs.readFileSync(path.join(ART_DIR, f)); } catch (e) { return null; } };
const realList = () => { try { return fs.readdirSync(ART_DIR).filter((f) => !f.startsWith('.')); } catch (e) { return []; } };
const emojiLeft = (data, html) => /sizeEmoji|SIZE_EMOJI/.test(data) || /sizeEmoji|pregSizeEmojiAfter/.test(html) || /🍐/u.test(html);

console.log('\n1. the set');
ok('PREG.sizeArt exists', typeof PREG.sizeArt === 'function');
const probs = typeof PREG.sizeArt === 'function' ? setProblems(PREG.sizeArt, realRead, realList) : ['no sizeArt'];
ok('every week 4 to 41 has a painting, each a WebP of at most 28 KB, no orphans, set at most 800 KB', probs.length === 0, probs.slice(0, 6).join('; '));
const names = new Set(WEEKS.map((w) => PREG.sizeArt && PREG.sizeArt(PREG.weeks[w].size)).filter(Boolean));
ok('one painting can serve two look-alike sizes, so 34 paintings cover 38 weeks', names.size === 34, names.size);
ok('no emoji map, emoji fallback or pear left in the data or index.html', !emojiLeft(dataSrc, indexSrc));
if (typeof PREG.sizeArt === 'function') {
  planted('a week dropped from the map', setProblems((s) => (s === 'pumpkin' ? '' : PREG.sizeArt(s)), realRead, realList).length === 0);
  planted('an oversized painting', setProblems(PREG.sizeArt, (f) => (f === 'lime.webp' ? Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(40000)]) : realRead(f)), realList).length === 0);
}
planted('an emoji fallback staged in index.html', !emojiLeft(dataSrc, indexSrc + "\nconst e=PREG.sizeEmoji(size)||'';"));
/* Paintings are fetched when a screen shows them, never precached: the set would add 700 KB to install. */
const assetsBlock = ((fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8').match(/const ASSETS\s*=\s*\[([\s\S]*?)\]/) || [])[1]) || '';
const noArtIn = (block) => !!block && !/fruit-art/.test(block);
ok('nothing painted is precached (sw.js ASSETS has no fruit-art)', noArtIn(assetsBlock), assetsBlock.length + ' chars of ASSETS');
planted('a painting staged in ASSETS', noArtIn(assetsBlock + "\n  '/app/fruit-art/lime.webp',"));
/* The one function that draws a painting: decorative alt, a fallback when the file fails, its loss guard. */
const fnSrc = (indexSrc.match(/function pregFruitImg\([\s\S]*?\n\}/) || [''])[0];
const fnOk = (src) => /alt=""/.test(src) && /onerror=/.test(src) && /myLossHolding\(\)/.test(src);
ok('pregFruitImg: alt="", an onerror fallback and its loss guard', fnOk(fnSrc), fnSrc.slice(0, 160));
planted('pregFruitImg without alt, onerror or guard', fnOk(fnSrc.replace(/alt=""/g, '').replace(/onerror=/g, '').replace(/myLossHolding\(\)/g, '')));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  const errs = [];
  const now = Date.now(), DAY = 86400000, HOUR = 3600000;
  const base = { babies: [], activeBabyId: null, events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1, log: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [], pregnancy: null };
  const ROBIN = { id: 'b1', name: 'Robin', birth: now - 400 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] };
  const MOMENTS = [{ id: 'm40', week: 40, note: '', at: now - 2 * DAY }, { id: 'm30', week: 30, note: '', at: now - 3 * DAY }];
  /* An hour of margin either side of the week turn; the page clock only moves further along. */
  const preg = (w) => ({ id: 'p1', stage: 'expecting', dueDate: now + (40 - w) * 7 * DAY - HOUR, appts: [], bp: [], weights: [], periods: [], moments: MOMENTS });
  const atWeek = (w) => Object.assign({}, base, { pregnancy: preg(w) });
  const ARCHIVE = [{ id: 'p0', endedAt: now - DAY, outcome: 'loss', moments: MOMENTS, journey: {} }];
  const loss = Object.assign({}, base, { lossHolding: { local: { at: now } }, pregnancyArchive: ARCHIVE });
  const lossWithChild = Object.assign({}, loss, { babies: [ROBIN], activeBabyId: 'b1' });
  const lossRace = Object.assign({}, loss, { pregnancy: preg(30) });
  /* Months later: a baby since, the quiet state ended, the archive still there. pregFruitImg's own
     guard is OFF here, so only the kept-memories code itself can keep the paintings out. */
  const keptLater = Object.assign({}, base, { babies: [ROBIN], activeBabyId: 'b1', pregnancyArchive: ARCHIVE });

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
  /* Every painted fruit in the document: where it points and whether it really loaded. */
  const fruits = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s || 'img')]
    .filter((i) => /\/fruit-art\//.test(i.getAttribute('src') || ''))
    .map((i) => ({ src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0, cls: i.className })), sel);
  const settle = (p) => p.evaluate(() => Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))));
  const hero = (p) => p.evaluate(() => { const h = document.querySelector('.wh-count'); return h ? h.textContent.trim() : null; });

  try {
    console.log('\n2. Home\'s week card');
    const p30 = await arrive(atWeek(30));
    const wk = await p30.evaluate(() => typeof pregWeek === 'function' ? pregWeek() : null);
    console.log('  [checkout] ' + BASE + (wk === 30 ? ' boots a pregnancy at week 30. Good.' : ' answered week ' + wk + '. Wrong port or a changed pregWeek.'));
    await settle(p30);
    const f30 = await fruits(p30, '.week-hero img');
    ok('week 30: the card shows the carrot painting, loaded', f30.length === 1 && /\/carrot\.webp$/.test(f30[0].src) && f30[0].loaded, JSON.stringify(f30));
    ok('week 30: the line ends in words', /about the size of a large carrot$/.test(await hero(p30) || ''), await hero(p30));
    const planH = await p30.evaluate(() => { const keep = PREG.sizeArt; PREG.sizeArt = () => ''; render(); const n = document.querySelectorAll('.week-hero img[src*="fruit-art"]').length; PREG.sizeArt = keep; render(); return n; });
    planted('the map emptied leaves the card without a painting', planH === 1);

    const p40 = await arrive(atWeek(40));
    await settle(p40);
    const f40 = await fruits(p40, '.week-hero img');
    ok('week 40: the card shows the pumpkin painting, loaded', f40.length === 1 && /\/pumpkin\.webp$/.test(f40[0].src) && f40[0].loaded, JSON.stringify(f40));
    const h40 = await hero(p40);
    ok('week 40: the line ends at "pumpkin", no emoji', !!h40 && /about the size of a pumpkin$/.test(h40) && !PICTO.test(h40), JSON.stringify(h40));

    console.log('\n3. the week sheets');
    const sheet = (p, kind) => p.evaluate((k) => { openWeekDetail(k); return 1; }, kind).then(() => sleep(400)).then(() => settle(p)).then(() => fruits(p, '#sheet img')).then(async (f) => { await p.evaluate(() => closeSheet()); await sleep(300); return f; });
    const s40 = await sheet(p40, 'size');
    ok('week 40 size sheet: one large pumpkin painting, loaded', s40.length === 1 && /pumpkin\.webp$/.test(s40[0].src) && s40[0].loaded, JSON.stringify(s40));
    const b40 = await sheet(p40, 'baby');
    ok('week 40 "Baby this week": the tile holds the pumpkin painting', b40.length === 1 && /pumpkin\.webp$/.test(b40[0].src) && b40[0].loaded, JSON.stringify(b40));
    /* Offline, or a file that never arrives: the tile keeps the sprout, never an empty 40 px box. */
    const tile = await p40.evaluate(async () => {
      openWeekDetail('baby');
      const i = document.querySelector('#sheet .pc-ico img'); if (!i) return 'no img';
      i.src = '/app/fruit-art/not-there.webp';
      await new Promise((r) => setTimeout(r, 900));
      const t = document.querySelector('#sheet .pc-ico'); const out = t ? t.textContent.trim() + '|' + t.querySelectorAll('img').length : 'no tile';
      closeSheet(); return out;
    });
    await sleep(300);
    ok('a painting that fails to load leaves the sprout in the tile', tile === '🌱|0', tile);

    console.log('\n4. her moments');
    const m = await p40.evaluate(() => {
      const d = document.createElement('div'); d.innerHTML = renderPregMoments();
      return [...d.querySelectorAll('.moment-card')].map((c) => { const i = c.querySelector('.mc-size img'); return { week: (c.querySelector('.mc-week') || {}).textContent, text: ((c.querySelector('.mc-size') || {}).textContent || '').trim(), art: i ? i.getAttribute('src') : '' }; });
    });
    const by = (w) => m.find((c) => c.week === 'Week ' + w) || {};
    ok('two moment cards drawn', m.length === 2, JSON.stringify(m));
    ok('week 30 card: words and the carrot painting', by(30).text === 'about the size of a large carrot' && /carrot\.webp$/.test(by(30).art), JSON.stringify(by(30)));
    ok('week 40 card: words and the pumpkin painting', by(40).text === 'about the size of a pumpkin' && /pumpkin\.webp$/.test(by(40).art), JSON.stringify(by(40)));
    ok('no emoji or pear on any card', m.every((c) => !PICTO.test(c.text)), JSON.stringify(m));
    const lazy = await p40.evaluate(() => { const d = document.createElement('div'); d.innerHTML = renderPregMoments(); return [...d.querySelectorAll('.mc-size img')].map((i) => i.getAttribute('loading')); });
    ok('moments paintings load lazily (a long album fetches only what scrolls into view)', lazy.length === 2 && lazy.every((v) => v === 'lazy'), JSON.stringify(lazy));
    /* Laid out for real: the moments photo rule (.moment-card img, width 100%) once stretched the
       small painting into a banner across the card. */
    const sz = await p40.evaluate(() => {
      const s = document.getElementById('scroll'); s.innerHTML = renderPregMoments();
      return [...s.querySelectorAll('.mc-size img')].map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    });
    ok('the moments painting is a small square, not a banner (at most 32 by 32)', sz.length === 2 && sz.every(([w, h]) => w > 0 && w <= 32 && h <= 32 && Math.abs(w - h) <= 1), JSON.stringify(sz));
    await p30.close(); await p40.close();

    console.log('\n5. after a loss');
    for (const [name, st] of [['loss', loss], ['loss with a living child', lossWithChild], ['loss synced, journey not yet gone', lossRace]]) {
      const p = await arrive(st);
      const f = await fruits(p);
      /* Rendered elements only: the app's own inline script mentions fruit-art in a comment. */
      const refs = await p.evaluate(() => document.querySelectorAll('[src*="fruit-art"],[style*="fruit-art"],[srcset*="fruit-art"]').length);
      ok(name + ': nothing painted anywhere', f.length === 0 && refs === 0, JSON.stringify(f) + ' refs=' + refs);
      if (st === loss) {
        /* The companion: stage one painting on this same screen and the same two matchers must see it. */
        const staged = await p.evaluate(() => { const i = document.createElement('img'); i.src = '/app/fruit-art/pumpkin.webp'; document.body.appendChild(i); return document.querySelectorAll('[src*="fruit-art"],[style*="fruit-art"],[srcset*="fruit-art"]').length; });
        const stagedF = await fruits(p);
        planted('a painting staged on the holding screen', !(stagedF.length || staged));
        await p.evaluate(() => { document.querySelectorAll('img[src*="fruit-art"]').forEach((i) => i.remove()); });
      }
      if (st === loss) {
        await p.evaluate(() => openKeptMemories()); await sleep(500);
        const kept = await p.evaluate(() => { const s = document.getElementById('sheet'); return { open: !!(s && s.classList.contains('show')), text: s ? s.innerText.replace(/\s+/g, ' ') : '', art: s ? s.querySelectorAll('img[src*="fruit-art"]').length : -1 }; });
        ok('kept memories open with both cards', kept.open && /Week 40/.test(kept.text) && /Week 30/.test(kept.text), kept.text.slice(0, 160));
        ok('kept memories: the size in words, no painting, no emoji', kept.art === 0 && /about the size of a pumpkin/.test(kept.text) && !/about the size of a (pumpkin|large carrot) *\p{Extended_Pictographic}/u.test(kept.text), JSON.stringify(kept).slice(0, 200));
      }
      if (st === lossRace) {
        /* The Anxiety Test: the loss has reached this phone, the journey has not cleared. She must
           land on the quiet screen, never on her week. */
        const raceText = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
        ok('race: the quiet screen, never her week (no "week 30", no "about the size of")', /Take all the time you need/.test(raceText) && !/about the size of/i.test(raceText) && !/\bweek 30\b/i.test(raceText), raceText.slice(0, 200));
        const real = await p.evaluate(() => /fruit-art/.test(typeof renderPregHome === 'function' ? renderPregHome() : ''));
        ok('race: renderPregHome itself paints nothing', real === false);
        const plant = await p.evaluate(() => {
          if (typeof pregFruitImg !== 'function') return false;
          const src = pregFruitImg.toString().replace(/if\s*\(\s*typeof myLossHolding[^;]*;/, '');
          const keep = window.pregFruitImg; window.pregFruitImg = eval('(' + src + ')');
          let out = ''; try { out = renderPregHome(); } finally { window.pregFruitImg = keep; }
          return /fruit-art/.test(out);
        });
        planted('pregFruitImg without its loss guard paints during the race', !plant);   // the check is "paints nothing"; stripped, it must paint
      }
      await p.close();
    }
    console.log('\n6. kept memories, with the quiet state long over');
    const pk = await arrive(keptLater);
    await pk.evaluate(() => openKeptMemories()); await sleep(600);
    const kept2 = await pk.evaluate(() => { const s = document.getElementById('sheet'); return { open: !!(s && s.classList.contains('show')), text: s ? s.innerText.replace(/\s+/g, ' ') : '', art: s ? s.querySelectorAll('img[src*="fruit-art"]').length : -1 }; });
    ok('kept memories open with both cards', kept2.open && /Week 40/.test(kept2.text) && /Week 30/.test(kept2.text), kept2.text.slice(0, 160));
    ok('kept memories: the size in words, no painting', kept2.art === 0 && /about the size of a pumpkin/.test(kept2.text), JSON.stringify(kept2).slice(0, 200));
    const plantK = await pk.evaluate(async () => {
      const real = openKeptMemories.toString();
      const src = real.replace("'about the size of a '+escapeHtml(size):''", "'about the size of a '+escapeHtml(size)+pregFruitImg(size,'mc-fruit'):''");
      if (src === real) return -1;
      const keep = window.openKeptMemories; window.openKeptMemories = eval('(' + src + ')');
      try { closeSheet(); await new Promise((r) => setTimeout(r, 300)); window.openKeptMemories(); await new Promise((r) => setTimeout(r, 500)); return document.querySelectorAll('#sheet img[src*="fruit-art"]').length; }
      finally { window.openKeptMemories = keep; closeSheet(); }
    });
    planted('kept memories with pregFruitImg added', !(plantK > 0));
    await pk.close();
  } catch (e) {
    ok('the run finished', false, e.stack);
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'FAIL' : 'PASS');
  process.exit(fail ? 1 : 0);
})();
