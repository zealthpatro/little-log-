#!/usr/bin/env node
/* CONTRAST, MEASURED IN BOTH THEMES, WITH THE BACKGROUND RESOLVED RATHER THAN ASSUMED.
 *
 * Every contrast bug this gate exists to catch was invisible to a reader of the stylesheet, because
 * in all of them the declared colour was fine and something else moved it:
 *
 *   - `.sec-act` CHOOSE declared --ink-soft, a rung deliberately chosen to clear AA, and then put
 *     `opacity:.85` on top. Declared 5.05:1, painted 3.74:1. You cannot see that in the rule.
 *   - The focus ring was `var(--accent,var(--feed))`, the same token the quick-log tiles are FILLED
 *     with, so on Home the ring around CHOOSE painted down onto the orange Feed tile and measured
 *     1:1. Orange on orange. The affordance a keyboard user navigates by, invisible.
 *   - In Night, `[data-theme="night"] .icon-btn{outline:1px solid var(--hairline)}` -- an ELEVATION
 *     hairline -- outranked `:focus-visible` on specificity, so the settings gear, the night toggle
 *     and every sheet close button answered a Tab with a 7%-alpha line instead of a ring. Seventeen
 *     controls. A previous audit called Night's ring a clean pass, because it read `outlineColor`
 *     without compositing the alpha and got "white".
 *
 * So the rules this file enforces are: resolve the EFFECTIVE background by walking the ancestor
 * chain and compositing alpha; apply the opacity chain to the ink; and measure the ring that the
 * cascade actually produced on a focused element, in Light AND in Night. Assert painted values,
 * never that a token exists.
 *
 * The tokens are read from :root at runtime rather than duplicated here, the same way
 * tools/type_scale_check.js reads the type scale. A gate holding its own copy of the thing it
 * checks is one edit away from asserting a world that no longer exists.
 *
 *   PORT=19477 node tools/serve.js &
 *   node tools/contrast_check.js http://localhost:19477
 *   node tools/contrast_check.js --self-test     (prove the colour maths, no browser, no server)
 *   node tools/contrast_check.js <base> --report (print every failing pair and pass anyway)
 */
const path = require('path');
const puppeteer = require(path.join(__dirname, 'node_modules/puppeteer-core'));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const SELFTEST = ARGS.includes('--self-test');
const REPORT = ARGS.includes('--report');
const BASE = ARGS.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:19477';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };

/* WCAG 2.x relative luminance and contrast ratio. Kept in Node as well as in the page so the
   --self-test can prove the maths without a browser: if these two ever disagree the self-test is
   worthless, so the page copy is generated from this source string below. */
const MATHS = `
function lum(c){ const s=c.map(function(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2]; }
function ratio(a,b){ const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
/* Composite a source colour with alpha over an already-opaque backdrop. */
function over(src, bg){ const a=src.a===undefined?1:src.a; return [src[0]*a+bg[0]*(1-a), src[1]*a+bg[1]*(1-a), src[2]*a+bg[2]*(1-a)]; }
`;
eval(MATHS);

if (SELFTEST) {
  console.log('\nself-test: the colour maths, against values with known answers');
  const near = (a, b, t) => Math.abs(a - b) < (t || 0.02);
  ok('black on white is 21:1', near(ratio([0, 0, 0], [255, 255, 255]), 21));
  ok('white on white is 1:1', near(ratio([255, 255, 255], [255, 255, 255]), 1));
  ok('#767676 on white is the canonical 4.54:1 AA boundary', near(ratio([118, 118, 118], [255, 255, 255]), 4.54, 0.01));
  ok('the ratio is symmetric, so argument order cannot change a verdict',
    near(ratio([226, 154, 59], [255, 255, 255]), ratio([255, 255, 255], [226, 154, 59])));
  /* The two defects this gate was written for, recomputed from their measured inputs. If these do
     not reproduce, the gate cannot have caught them. */
  const secActInk = over({ 0: 110, 1: 99, 2: 91, a: 0.85 }, [244, 238, 227]);
  ok('the .sec-act defect reproduces: --ink-soft at opacity .85 over cream is 3.74:1, under the 4.5 floor',
    near(ratio(secActInk, [244, 238, 227]), 3.74, 0.02), ratio(secActInk, [244, 238, 227]).toFixed(2));
  ok('and at full strength the same pair clears it at 5.05:1',
    near(ratio([110, 99, 91], [244, 238, 227]), 5.05, 0.02), ratio([110, 99, 91], [244, 238, 227]).toFixed(2));
  ok('the old ring defect reproduces: feed orange on the feed tile is 1:1',
    near(ratio([226, 154, 59], [226, 154, 59]), 1));
  ok('and the old ring on white was 2.35:1, under the 3:1 non-text floor',
    near(ratio([226, 154, 59], [255, 255, 255]), 2.35, 0.02));
  /* The alpha blind spot that made a previous audit call Night's ring a pass. */
  const hair = over({ 0: 255, 1: 255, 2: 255, a: 0.07 }, [38, 32, 28]);
  ok('compositing alpha is what catches the Night hairline: read raw it looks like white at 16:1, composited it is 1.2:1',
    ratio([255, 255, 255], [38, 32, 28]) > 15 && ratio(hair, [38, 32, 28]) < 1.3,
    'raw ' + ratio([255, 255, 255], [38, 32, 28]).toFixed(2) + ' vs composited ' + ratio(hair, [38, 32, 28]).toFixed(2));
  /* The two-tone claim: neither tone clears every Night background alone, the PAIR always does. */
  const F = [242, 234, 223], H = [26, 22, 20], feedFill = [224, 166, 85], nightPage = [26, 22, 20];
  ok('two-tone is necessary: the Night ring alone fails on the feed fill', ratio(F, feedFill) < 3, ratio(F, feedFill).toFixed(2));
  ok('two-tone is sufficient: the halo carries that same surface', ratio(H, feedFill) >= 3, ratio(H, feedFill).toFixed(2));
  ok('and the ring carries the page the halo cannot', ratio(F, nightPage) >= 3 && ratio(H, nightPage) < 3,
    'ring ' + ratio(F, nightPage).toFixed(2) + ', halo ' + ratio(H, nightPage).toFixed(2));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CONTRAST-SELFTEST: FAIL' : 'CONTRAST-SELFTEST: PASS');
  process.exit(fail ? 1 : 0);
}

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;
const seed = () => ({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
});

/* Everything below runs in the page. It resolves the effective background instead of assuming one,
   which is the whole point of the file. */
const PAGE = MATHS + `
function parse(s){
  const m=(s||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
  const p=m[1].split(/[,\\s\\/]+/).filter(Boolean).map(parseFloat);
  const o=[p[0],p[1],p[2]]; o.a = p.length>3 ? p[3] : 1; return o;
}
/* Walk up compositing every translucent background until something opaque stops it. Returns an
   opaque triple, which is the only kind a contrast ratio is defined against. */
function bgOf(el){
  var stack=[], n=el;
  while(n && n.nodeType===1){ var c=parse(getComputedStyle(n).backgroundColor); if(c && c.a>0) stack.push(c); n=n.parentElement; }
  var base=[255,255,255];
  for(var i=stack.length-1;i>=0;i--){ base=over(stack[i], base); }
  return [Math.round(base[0]),Math.round(base[1]),Math.round(base[2])];
}
/* Ink is moved by the opacity of every ancestor, which is exactly how .sec-act shipped a failing
   ratio while declaring a passing colour. */
function opacityChain(el){ var o=1,n=el; while(n && n.nodeType===1){ var v=parseFloat(getComputedStyle(n).opacity); if(!isNaN(v)) o*=v; n=n.parentElement; } return o; }
function inkOf(el, bg){ var c=parse(getComputedStyle(el).color)||[0,0,0]; c.a=(c.a===undefined?1:c.a)*opacityChain(el); var p=over(c,bg); return [Math.round(p[0]),Math.round(p[1]),Math.round(p[2])]; }
/* WCAG large text: >=24px, or >=18.66px when bold. Large text is held to 3:1 instead of 4.5:1. */
function floorFor(cs){ var px=parseFloat(cs.fontSize), w=parseInt(cs.fontWeight,10)||400; return (px>=24 || (px>=18.66 && w>=700)) ? 3 : 4.5; }
window.__measureText = function(){
  var out=[], seen={}; out.raw=0;
  var walk=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var t;
  while((t=walk.nextNode())){
    var s=(t.nodeValue||'').trim(); if(!s) continue;
    var el=t.parentElement; if(!el) continue;
    var cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none') continue;
    if(parseFloat(cs.opacity)===0) continue;
    var r=el.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) continue;
    if(r.bottom<0||r.top>window.innerHeight) continue;
    /* Colour emoji paint their own glyph colours; the computed \`color\` is not what lands. */
    if(!/[A-Za-z0-9]/.test(s)) continue;
    var bg=bgOf(el), ink=inkOf(el,bg);
    out.raw++;
    /* One row per distinct (class, ink, background, size). The raw count above is what proves the
       run did work; this dedup is only so a failure list names a rule once instead of 40 times. */
    var key=el.className+'|'+ink.join()+'|'+bg.join()+'|'+cs.fontSize;
    if(seen[key]) continue; seen[key]=1;
    out.push({ sel:(typeof el.className==='string'&&el.className)?'.'+el.className.split(' ')[0]:el.tagName.toLowerCase(),
      text:s.slice(0,28), ink:ink, bg:bg, px:parseFloat(cs.fontSize), floor:floorFor(cs), r:+ratio(ink,bg).toFixed(2) });
  }
  return out;
};
/* The focus indicator, measured as the cascade actually resolved it on a focused element, and
   sampled at the pixels it really paints on rather than at an assumed parent. */
window.__measureFocus = function(){
  var out=[];
  var els=[].slice.call(document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]'))
    .filter(function(e){ var b=e.getBoundingClientRect(); return b.width>0&&b.height>0&&b.top<window.innerHeight&&b.bottom>0; });
  els.forEach(function(el){
    try{ el.focus(); }catch(e){ return; }
    if(!el.matches(':focus-visible')) { try{el.blur();}catch(e){} return; }
    var cs=getComputedStyle(el);
    var ring=parse(cs.outlineColor), w=parseFloat(cs.outlineWidth), off=parseFloat(cs.outlineOffset)||0;
    /* The halo is the spread of the focus box-shadow. Read its colour off the computed value. */
    var halo=parse(cs.boxShadow);
    var b=el.getBoundingClientRect();
    var pts=[[b.left+b.width/2, b.top-off-1],[b.left-off-1, b.top+b.height/2],[b.left+b.width/2, b.bottom+off+1],[b.right+off+1, b.top+b.height/2]];
    pts.forEach(function(p){
      var x=p[0], y=p[1];
      if(x<1||y<1||x>window.innerWidth-1||y>window.innerHeight-1) return;
      var under=document.elementFromPoint(x,y); if(!under) return;
      var bg=bgOf(under);
      /* A translucent ring is not the colour it claims: composite it onto what is behind it. */
      var ringOn = ring ? over(ring,bg) : null;
      var haloOn = halo ? over(halo,bg) : null;
      out.push({ sel:(typeof el.className==='string'&&el.className)?'.'+el.className.split(' ')[0]:el.tagName.toLowerCase(),
        width:w, style:cs.outlineStyle, bg:bg,
        ring: ringOn?[Math.round(ringOn[0]),Math.round(ringOn[1]),Math.round(ringOn[2])]:null,
        halo: haloOn?[Math.round(haloOn[0]),Math.round(haloOn[1]),Math.round(haloOn[2])]:null,
        rRing: ringOn?+ratio(ringOn,bg).toFixed(2):0,
        rHalo: haloOn?+ratio(haloOn,bg).toFixed(2):0,
        rPair: (ringOn&&haloOn)?+ratio(ringOn,haloOn).toFixed(2):0 });
    });
    try{ el.blur(); }catch(e){}
  });
  return out;
};
/* Resolve a token through the browser so any colour syntax works, not just the hex we happen to
   have written today. */
window.__token = function(name){
  var d=document.createElement('span');
  d.style.color='var('+name+')'; d.style.display='none';
  document.body.appendChild(d);
  var v=getComputedStyle(d).color; d.remove();
  var c=parse(v); return c?[Math.round(c[0]),Math.round(c[1]),Math.round(c[2])]:null;
};
`;

const SURFACES = [['home', null], ['log', "go('log')"], ['health', "go('health')"], ['feedsheet', 'openFeed()'], ['sleepsheet', 'openSleep()'], ['settings', 'openSettings()'], ['growth', 'openGrowth()']];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });

  const results = {};
  for (const theme of ['light', 'night']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme === 'night' ? 'dark' : 'light' }]);
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
    await page.evaluate((x, t) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
      localStorage.setItem('cubby-theme:local', t);
    }, seed(), theme);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    const R = { text: [], focus: [], raw: 0, tokens: null, themeAttr: null, sheetAccent: null, selection: null, caret: null };
    for (const [name, fn] of SURFACES) {
      if (fn) { try { await page.evaluate((f) => eval(f), fn); } catch (e) {} await sleep(900); }
      /* Only what is in the viewport can be measured for contrast, because only that has a resolved
         background. Cubby scrolls inside #scroll rather than the document, so walking depths is the
         only way below-the-fold text gets seen at all. */
      for (const depth of [0, 700, 1400]) {
        await page.evaluate((d) => {
          const s = document.querySelector('#scroll') || document.querySelector('.sheet-body') || document.scrollingElement;
          if (s) s.scrollTop = d;
        }, depth);
        await sleep(320);
        await page.evaluate(PAGE);
        const got = await page.evaluate(() => { const t = __measureText(); return { text: t, raw: t.raw, focus: __measureFocus() }; });
        R.raw += got.raw;
        got.text.forEach((t) => R.text.push(Object.assign(t, { on: name + '@' + depth })));
        got.focus.forEach((f) => R.focus.push(Object.assign(f, { on: name + '@' + depth })));
      }
    }
    await page.evaluate(PAGE);
    Object.assign(R, await page.evaluate(() => ({
      tokens: { focus: __token('--focus'), halo: __token('--focus-halo'), select: __token('--select-bg'), accent: __token('--accent'), ink: __token('--ink') },
      /* The RAW property text off :root. An undeclared custom property returns '', where
         __token() would silently hand back the inherited colour instead and make the check pass on
         a stylesheet that never defined the token at all. */
      declared: ['--focus', '--focus-halo', '--select-bg'].reduce((a, n) => {
        a[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return a;
      }, {}),
      themeAttr: document.documentElement.getAttribute('data-theme'),
      /* Prove the ring does not follow --accent: on an open sheet --accent is reassigned, and the
         ring must be unmoved by that. */
      sheetAccent: (function () {
        const s = document.getElementById('sheet');
        if (!s) return null;
        const a = getComputedStyle(s).getPropertyValue('--accent').trim();
        const btn = s.querySelector('button');
        if (!btn) return { accent: a, ring: null };
        btn.focus();
        const ring = getComputedStyle(btn).outlineColor;
        btn.blur();
        return { accent: a, ring: ring };
      })(),
      selection: getComputedStyle(document.body, '::selection').backgroundColor,
      caret: (function () {
        const i = document.querySelector('input,textarea');
        return i ? getComputedStyle(i).caretColor : null;
      })(),
    })));
    results[theme] = R;
  }
  await browser.close();

  const near = (a, b) => Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) <= 1);

  for (const theme of ['light', 'night']) {
    const R = results[theme];
    console.log('\n== ' + theme.toUpperCase() + ' ==');

    /* PRESENCE first. Every "nothing failed" below is worthless without proof that something was
       actually measured, on a page that actually rendered in this theme. */
    console.log('\n' + (theme === 'light' ? '1' : '5') + '. the measurement really happened in this theme');
    ok('text pairs were measured, so a clean result is not an empty one', R.raw > 400 && R.text.length > 100,
      R.raw + ' pairs measured, ' + R.text.length + ' distinct');
    ok('focus positions were measured', R.focus.length > 150, R.focus.length + ' probes');
    ok('more than one surface contributed', new Set(R.text.map((t) => t.on.split('@')[0])).size >= 6, [...new Set(R.text.map((t) => t.on.split('@')[0]))].join(','));
    ok('the theme under test is the one that rendered',
      theme === 'night' ? R.themeAttr === 'night' : R.themeAttr !== 'night', 'data-theme=' + R.themeAttr);
    /* The backgrounds have to actually differ, or "resolving the effective background" is a claim
       the run never exercised. */
    const bgs = new Set(R.text.map((t) => t.bg.join(',')));
    ok('the resolved backgrounds are plural, so the resolver is doing work', bgs.size >= 4, bgs.size + ' distinct backgrounds');

    console.log('\n' + (theme === 'light' ? '2' : '6') + '. body text clears its WCAG floor');
    const bad = R.text.filter((t) => t.r < t.floor);
    ok('every text/background pair measured clears 4.5:1, or 3:1 where WCAG counts it large',
      bad.length === 0, bad.slice(0, 12).map((b) => b.sel + ' "' + b.text + '" ' + b.r + ':1 needs ' + b.floor + ' on ' + b.on));
    /* The specific regression this gate was born from, asserted by name so it cannot quietly come
       back under a passing aggregate. */
    const secAct = R.text.filter((t) => t.sel === '.sec-act');
    ok('.sec-act CHOOSE was measured', secAct.length > 0, secAct.length);
    ok('and it clears 4.5:1, which it did not while it carried opacity:.85',
      secAct.every((s) => s.r >= 4.5), secAct.map((s) => s.r + ':1'));

    console.log('\n' + (theme === 'light' ? '3' : '7') + '. the focus indicator');
    const rings = R.focus;
    ok('every focused control resolved a ring at least 2px wide, so none fell through to a decoration',
      rings.every((f) => f.width >= 2 && f.style !== 'none'),
      rings.filter((f) => !(f.width >= 2 && f.style !== 'none')).slice(0, 8).map((f) => f.sel + ' ' + f.width + 'px ' + f.style + ' on ' + f.on));
    ok('every focused control carries a halo band as well as a ring',
      rings.every((f) => f.halo), rings.filter((f) => !f.halo).slice(0, 8).map((f) => f.sel + ' on ' + f.on));
    /* THE CORE ASSERTION. WCAG 1.4.11 wants 3:1 against adjacent colour. A two-tone indicator meets
       it when the two tones differ from each other AND at least one of them stands off whatever is
       behind: the band that reads carries the shape. Measured per painted pixel, not per rule. */
    const ringFail = rings.filter((f) => Math.max(f.rRing, f.rHalo) < 3);
    ok('at every position it paints, one of the two bands clears 3:1 against the real background',
      ringFail.length === 0,
      ringFail.slice(0, 10).map((f) => f.sel + ' on ' + f.on + ': ring ' + f.rRing + ', halo ' + f.rHalo + ' over rgb(' + f.bg.join(',') + ')'));
    const pairFail = rings.filter((f) => f.rPair < 3);
    ok('and the two bands differ by 3:1, so the indicator carries its own contrast onto any surface',
      pairFail.length === 0, pairFail.slice(0, 6).map((f) => f.sel + ' pair ' + f.rPair));
    /* Absence assertion (the ring is not the accent) paired with its presence assertion (the accent
       really was reassigned on this sheet). Without the second, the first passes on a sheet that
       never set --accent at all. */
    if (R.sheetAccent) {
      ok('an open sheet really does reassign --accent, so the next check is not vacuous',
        !!R.sheetAccent.accent && R.sheetAccent.accent.length > 0, R.sheetAccent.accent);
      const ringRgb = (R.sheetAccent.ring || '').match(/\d+/g);
      ok('and the ring ignores it, because an affordance derived from the decoration collides with it',
        ringRgb && near(ringRgb.slice(0, 3).map(Number), R.tokens.focus),
        'ring ' + R.sheetAccent.ring + ' vs --focus rgb(' + (R.tokens.focus || []).join(',') + ')');
    }

    console.log('\n' + (theme === 'light' ? '4' : '8') + '. the parts nobody drew');
    ok('the ring tokens are actually declared on :root, not just inherited from something else',
      Object.values(R.declared).every((v) => v.length > 0), R.declared);
    ok('--focus and --focus-halo both resolve to real colours', !!R.tokens.focus && !!R.tokens.halo, R.tokens);
    ok('the ring and halo tokens are not the same colour', !near(R.tokens.focus, R.tokens.halo), R.tokens);
    ok('text selection is themed, not the browser default blue',
      !!R.selection && !/^rgba?\(0, 0, 0, 0\)/.test(R.selection) && near((R.selection.match(/\d+/g) || []).slice(0, 3).map(Number), R.tokens.select),
      R.selection + ' vs --select-bg rgb(' + (R.tokens.select || []).join(',') + ')');
    /* Selection is only useful if the text stays readable on it, which is the thing a default blue
       gets wrong in a warm dark theme. */
    const selBg = (R.selection.match(/\d+/g) || []).slice(0, 3).map(Number);
    ok('and --ink on the selection band still clears 4.5:1',
      ratio(R.tokens.ink, selBg) >= 4.5, ratio(R.tokens.ink, selBg).toFixed(2) + ':1');
    ok('the caret is pinned to a palette colour rather than left to inherit',
      !!R.caret && near((R.caret.match(/\d+/g) || []).slice(0, 3).map(Number), R.tokens.ink),
      R.caret + ' vs --ink rgb(' + (R.tokens.ink || []).join(',') + ')');
  }

  if (REPORT) {
    for (const theme of ['light', 'night']) {
      const R = results[theme];
      console.log('\n--- ' + theme + ': coverage: ' + R.raw + ' text pairs (' + R.text.length + ' distinct), '
        + R.focus.length + ' focus probes, ' + new Set(R.text.map((t) => t.bg.join(','))).size + ' distinct backgrounds ---');
      console.log('--- ' + theme + ': worst 12 text pairs ---');
      [...R.text].sort((a, b) => a.r - b.r).slice(0, 12).forEach((t) => console.log('  ' + String(t.r).padStart(6) + ':1 (needs ' + t.floor + ')  ' + t.sel + ' "' + t.text + '" on ' + t.on));
      const byPair = new Map();
      R.focus.forEach((f) => { const k = (f.ring || []).join(',') + '|' + f.bg.join(','); if (!byPair.has(k)) byPair.set(k, f); });
      console.log('--- ' + theme + ': distinct ring/background pairs: ' + byPair.size + ' ---');
      [...byPair.values()].sort((a, b) => Math.max(a.rRing, a.rHalo) - Math.max(b.rRing, b.rHalo)).slice(0, 12)
        .forEach((f) => console.log('  ring ' + String(f.rRing).padStart(6) + ':1  halo ' + String(f.rHalo).padStart(6) + ':1  on rgb(' + f.bg.join(',') + ')  ' + f.sel));
    }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'CONTRAST: FAIL' : 'CONTRAST: PASS');
  process.exit(fail ? 1 : 0);
})();
