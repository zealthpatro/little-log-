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
  ['.prof-cards', '.csub', 'the two care cards and the caption that says "tap either to update" are one unit'],
  ['.month-grid', 'p', 'the month grid and the caption telling you to tap a month are one unit'],
];

/* EMPTY, and it should stay that way. Every one of the eight original exceptions was closed on
   2026-08-11: five inline magic numbers became var(--stack) or a declared 2px pair, and two turned out
   not to be inline at all — `.hm{margin-bottom:18px}` and `.tip-line{margin:0 0 12px}` were CSS rules
   living in app/cubby-extras.js as INJECTED JAVASCRIPT STRINGS, so nobody grepping index.html for the
   18 could find it. That second CSS home is the reason this list existed as long as it did.
   The old header comment claimed "every one is an inline style=margin:". Two were not. If you add an
   entry here, check both homes before you describe the cause.

   An entry is [tab, fromSelector, toSelector, gap, reason]. The gap is part of the KEY, not a note:
   see the lookup below for why that matters. Date any entry you add, and delete it the day it is fixed. */
const KNOWN = [];

/* SUB-TABS COUNT AS TABS. Health renders `${body}${care}${visit}`, where body is the medicine, vaccine
   or illness list — so the "Doctors & allergies" heading follows a DIFFERENT last element on each of the
   three, and a fix that lands 16 on vaccines can land 0 on illness. Album is the same shape: one help-icon
   row is emitted above all three sub-tab bodies. Walking only the default sub-tab checked one of eight
   surfaces and called it a tab. */
/* EVERY entry sets its sub-tab EXPLICITLY, even the defaults. logTab/albumTab/healthTab are module-level
   variables that persist, so `go('log')` after the rituals step rendered RITUALS while the report said
   "log" — the gate was measuring one surface and naming another, in silence, and the second theme pass got
   whatever the first pass left behind. A step that does not state its own state is not a test. */
const TABS = [
  ['home', "go('home')"],
  ['log', "go('log'); typeof setLogTab==='function' && setLogTab('log')"],
  ['stats', "go('log'); typeof setLogTab==='function' && setLogTab('stats')"],
  ['rituals', "go('log'); typeof setLogTab==='function' && setLogTab('rituals')"],
  ['album', "go('album'); typeof setAlbumTab==='function' && setAlbumTab('photos')"],
  ['album/memories', "go('album'); typeof setAlbumTab==='function' && setAlbumTab('memories')"],
  ['album/milestones', "go('album'); typeof setAlbumTab==='function' && setAlbumTab('milestones')"],
  ['health', "go('health'); typeof setHealthTab==='function' && setHealthTab('meds')"],
  ['health/vaccines', "go('health'); typeof setHealthTab==='function' && setHealthTab('vaccines')"],
  ['health/illness', "go('health'); typeof setHealthTab==='function' && setHealthTab('illness')"],
];

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 21 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1',
  events: [{ id: 'e1', type: 'feed', time: Date.now() - 2 * 3600000, babyId: 'b1', method: 'bottle', amount: 90 },
  { id: 'e2', type: 'diaper', time: Date.now() - 3600000, babyId: 'b1', kind: 'wet' },
  { id: 'e3', type: 'sleep', time: Date.now() - 6 * 3600000, end: Date.now() - 4 * 3600000, babyId: 'b1' }],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1, leftnote: 1, gs: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  /* One ACTIVE illness and one past one, because health/illness renders a completely different tree when
     an episode is open (the "Mark recovered" button, then the "Past illnesses" heading) and the empty
     state exercises none of it. An empty fixture made this surface look covered while measuring nothing. */
  illnesses: [
    { id: 'i1', babyId: 'b1', name: 'Cold', startedAt: Date.now() - 2 * DAY, endedAt: null, notes: '' },
    { id: 'i2', babyId: 'b1', name: 'Cough', startedAt: Date.now() - 20 * DAY, endedAt: Date.now() - 15 * DAY, notes: '' }
  ]
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
  /* protocolTimeout: the Moments sub-tab builds the 289-card journey library, and on a cold run that one
     evaluate() blew past puppeteer's 180s default and took the whole gate down with a ProtocolError —
     which reads like a broken page rather than a slow one. */
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], protocolTimeout: 600000 });
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
  console.log(KNOWN.length ? "  " + KNOWN.length + " known exception(s) still listed" : "  0 known exceptions: every gap below is asserted against the contract");

  const seen = [], hitKnown = new Set();
  for (const theme of ['light', 'night']) {
    await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    for (const [tab, step] of TABS) {
      try { await p.evaluate(s => { eval(s); }, step); } catch (e) { continue; }
      await new Promise(r => setTimeout(r, 500));
      const gaps = await p.evaluate(c => eval(c), code);
      for (const g of gaps) {
        /* The recorded gap is part of the key. It used to match on tab+from+to alone, which meant a
           listed exception went on matching after somebody FIXED it — the pair still occurred, so it
           still counted as hit, so the honesty check below stayed quiet and the now-correct gap was
           skipped forever instead of being asserted. An exception that stops being true has to fall
           through to the contract, and its stale entry has to show up as stale. */
        const k = KNOWN.findIndex(x => x[0] === tab && x[1] === g.from && x[2] === g.to && x[3] === g.gap);
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
  /* Sabotage with an OFF-SYSTEM value, not with zero.
     This used to strip .actions' bottom margin and expect a near-zero gap. That stopped proving
     anything the day the stack started taking its spacing from the parent instead of that margin:
     zeroing it left a clean 16px, which is a correct block gap, so the self-test failed while the
     app was right. The gate exists to catch a gap that is not one of the four, so that is what the
     sabotage should produce. 21px is deliberately none of 16, 12, 8 or 2. */
  const caught = await p.evaluate((c) => {
    const st = document.createElement('style');
    st.id = 'stackSelfTest';
    st.textContent = '.actions{margin-bottom:21px!important}';
    document.head.appendChild(st);
    go('home'); render();
    return eval(c);
  }, code);
  const mine = caught.filter(g => /\.actions/.test(g.from));
  const offSystem = mine.filter(g => ![BLOCK, HEAD, ROW, COUPLED].some(w => Math.abs(g.gap - w) <= SLOP));
  ck(offSystem.length > 0, 'it catches the tile grid taking an off-system gap, which is the bug class',
    JSON.stringify(mine.map(g => g.from + '=' + g.gap + 'px')));
  await p.evaluate(() => { const n = document.getElementById('stackSelfTest'); if (n) n.remove(); });

  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));
  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
