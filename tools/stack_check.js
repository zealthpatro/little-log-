/* The stack contract, enforced on the RENDERED page. Canon: DESIGN.md A3.2.
 *
 * Vertical space is four values and nothing else:
 *
 *     16  one block to the next block            (--stack)
 *     12  a section heading to what it labels    (in .sec-title)
 *      8  one row to the next row IN one list    (--row)
 *      2  a thing and its own caption or link, which are one unit
 *
 * WHY THIS IS MEASURED AND NOT REVIEWED. Every instance of this bug was invisible in the CSS:
 *
 *   - `.actions` had `gap:13px` and no margin-bottom, so the tile grid spaced its own tiles and then
 *     butted into the next card at 0px. `gap` is not a margin. A founder photographed it twice, and the
 *     second time said plainly that the gap between the boxes was what he had been calling padding.
 *   - adjacent margins COLLAPSE to the larger of the two, so a list's 8px row rhythm beat `.sec-title`'s
 *     6px top and five section headings on Health began 8px after the previous list instead of 16.
 *   - `--stack` existed for months while four rules set 18px by hand, and three different values
 *     (8, 9, and nothing at all) were doing the row rhythm's job.
 *
 * None of that is visible in a diff. All of it is obvious in a measurement.
 *
 *   node tools/serve.js &   &&   node tools/stack_check.js [baseUrl]
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000;

const BLOCK = 16, HEAD = 12, ROW = 8, COUPLED = 2, SLOP = 1;

// A row is a member of a list with its own rhythm. Row-to-row gets ROW; anything else gets BLOCK.
const ROWS = ['.ms-row', '.note-card', '.set-item', '.add-row', '.prof-card', '.bag-row', '.si-row'];
// A heading labels the thing under it.
/* .greeting-sub is here because the greeting and its second line LABEL the screen: what follows them
   is content being introduced, not a sibling block, so it takes the heading gap. */
const HEADS = ['.sec-title', '.set-label', '.greeting-sub'];
/* Pairs that are ONE unit, so they sit at COUPLED distance. Each needs a reason: without one this list
   becomes the place violations go to be forgotten. */
const PAIRS = [
  ['.greeting', '.greeting-sub', 'a greeting and its own second line are one sentence'],
  ['.preg-card', 'div', 'the good-read card and its own "More good reads" link belong to each other'],
];

/* Still off-system, deliberately listed rather than quietly allowed. Every one is an inline
   style="margin:…" on a block, which no token can reach, so these need MARKUP edits, not CSS. Flagged
   2026-08-10; the Log and Health ones are the parallel session's declared in-flight work. Delete an entry
   when it is fixed — the gate fails if a listed exception has SILENTLY GONE AWAY too, so this list cannot
   rot into fiction. */
const KNOWN = [
  ['log', 'button.btn-ghost', 'div.tip-line', 14, 'inline margin on the tip line'],
  ['log', 'div.hm', 'div.fade-in', 18, 'the log header wrapper sets its own 18'],
  ['album', 'div.seg.seg-full', 'div', 14, 'inline margin on the album toolbar row'],
  ['album', 'div', 'div', 8, 'inline margins on the album toolbar rows'],
  ['health', 'div.prof-cards', 'div.csub', 8, 'the caption is coupled to the cards above it, but via an inline margin'],
  ['log', 'div.tip-line', 'div.hm', 12, 'inline margin on the tip line, light theme only'],
  ['health', 'div.add-row', 'div.sec-title', 24, 'not adjacent siblings, so the row+heading rule cannot reach it'],
  ['health', 'div.csub', 'div.prof-card', 14, 'inline margin between the caption and the first card'],
];

const TABS = [
  ['home', "go('home')"],
  ['log', "go('log')"],
  ['stats', "go('log'); typeof setLogTab==='function' && setLogTab('stats')"],
  ['rituals', "go('log'); typeof setLogTab==='function' && setLogTab('rituals')"],
  ['album', "go('album')"],
  ['health', "go('health')"],
];

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 21 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1',
  events: [{ id: 'e1', type: 'feed', time: Date.now() - 2 * 3600000, babyId: 'b1', method: 'bottle', amount: 90 },
  { id: 'e2', type: 'diaper', time: Date.now() - 3600000, babyId: 'b1', kind: 'wet' },
  { id: 'e3', type: 'sleep', time: Date.now() - 6 * 3600000, end: Date.now() - 4 * 3600000, babyId: 'b1' }],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1, leftnote: 1, gs: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '\n         ' + d : ''))); };

const AUDIT = `(function(rows, heads, pairs){
  var sc=document.getElementById('scroll');
  var wrap=sc.querySelector(':scope > .fade-in') || sc.firstElementChild;
  if(!wrap) return [];
  function name(n){ return n.tagName.toLowerCase()+(n.classList.length?'.'+[].slice.call(n.classList).join('.'):''); }
  function is(n, sels){ for(var i=0;i<sels.length;i++){ try{ if(n.matches(sels[i])) return true; }catch(e){} } return false; }
  var kids=[].slice.call(wrap.children).filter(function(n){ return n.getBoundingClientRect().height>2; });
  var out=[];
  for(var i=0;i<kids.length-1;i++){
    var a=kids[i], b=kids[i+1];
    var gap=Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
    // Which of the four is this pair supposed to be?
    var kind='block';
    if(is(a,heads)) kind='head';
    else if(is(a,rows) && is(b,rows)) kind='row';
    for(var p=0;p<pairs.length;p++){
      try{ if(a.matches(pairs[p][0]) && b.matches(pairs[p][1])) { kind='pair'; break; } }catch(e){}
    }
    out.push({ from:name(a).slice(0,30), to:name(b).slice(0,30), gap:gap, kind:kind,
      inline: /margin/.test(a.getAttribute('style')||'') || /margin/.test(b.getAttribute('style')||'') });
  }
  return out;
})(ROWS, HEADS, PAIRS)`;

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  // Tall enough that nothing is below a fold: this app scrolls inside #scroll, so a short viewport hides
  // most of the page from any audit. Three earlier padding fixes were made against the top fifth of one
  // screen for exactly this reason.
  await p.setViewport({ width: 390, height: 3000, deviceScaleFactor: 1 });
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2' });
  await p.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
  }, SEED);
  await p.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2200));

  const code = AUDIT
    .replace('ROWS', JSON.stringify(ROWS)).replace('HEADS', JSON.stringify(HEADS))
    .replace('PAIRS', JSON.stringify(PAIRS.map(x => [x[0], x[1]])));
  const want = { block: BLOCK, head: HEAD, row: ROW, pair: COUPLED };

  console.log('\nthe contract: block ' + BLOCK + ', heading ' + HEAD + ', row ' + ROW + ', coupled ' + COUPLED);
  console.log('  ' + KNOWN.length + ' known exceptions, all inline margins needing markup edits');

  const seen = [], hitKnown = new Set();
  for (const theme of ['light', 'night']) {
    await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    for (const [tab, step] of TABS) {
      try { await p.evaluate(s => { eval(s); }, step); } catch (e) { continue; }
      await new Promise(r => setTimeout(r, 500));
      const gaps = await p.evaluate(c => eval(c), code);
      for (const g of gaps) {
        const k = KNOWN.findIndex(x => x[0] === tab && x[1] === g.from && x[2] === g.to);
        if (k >= 0) { hitKnown.add(k); continue; }
        if (Math.abs(g.gap - want[g.kind]) > SLOP) seen.push({ theme, tab, ...g });
      }
    }
  }

  // Same rule broken on both themes is one thing to fix.
  const uniq = new Map();
  for (const v of seen) {
    const key = v.tab + '|' + v.from + '|' + v.to + '|' + v.gap;
    if (!uniq.has(key)) uniq.set(key, { ...v, themes: new Set() });
    uniq.get(key).themes.add(v.theme);
  }

  console.log('\nevery block gap is one of the four');
  ck(uniq.size === 0, 'no off-system gap on any tab, in either theme',
    [...uniq.values()].map(v => v.tab + ': ' + v.gap + 'px  ' + v.from + ' → ' + v.to
      + '  (a ' + v.kind + ' gap should be ' + want[v.kind] + ')' + (v.inline ? '  [inline margin]' : '')
      + '  [' + [...v.themes].join(',') + ']').join('\n         '));

  /* An exception list has to be able to shrink. If a listed exception no longer occurs, the entry is
     fiction and the next person will trust the rest of the list less for it. */
  console.log('\nthe exception list is honest');
  const stale = KNOWN.map((x, i) => [x, i]).filter(([, i]) => !hitKnown.has(i));
  ck(stale.length === 0, 'every listed exception still actually occurs',
    stale.map(([x]) => x[0] + ': ' + x[1] + ' → ' + x[2] + ' (' + x[4] + ') is FIXED — delete it from KNOWN').join('\n         '));

  console.log('\nthe gate can fail');
  const caught = await p.evaluate((c) => {
    // Put the original bug back: strip the tile grid's bottom margin and see if the audit notices.
    const st = document.createElement('style');
    st.id = 'stackSelfTest';
    st.textContent = '.actions{margin-bottom:0!important}';
    document.head.appendChild(st);
    go('home'); render();
    return eval(c);
  }, code);
  const zero = caught.filter(g => /\.actions/.test(g.from) && g.gap < 4);
  ck(zero.length > 0, 'it catches the tile grid losing its bottom margin, which is the original bug',
    JSON.stringify(caught.filter(g => /\.actions/.test(g.from)).map(g => g.from + '=' + g.gap + 'px')));
  await p.evaluate(() => { const n = document.getElementById('stackSelfTest'); if (n) n.remove(); });

  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));
  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
