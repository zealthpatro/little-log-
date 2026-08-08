// Authed-equivalent UI harness — NO credentials. Uses the localhost-only ?e2e=1 boot hook
// (app/store-firebase.js) to skip Firebase + the sign-in gate and drive the logged-in UI from
// seeded localStorage. Catches dead taps (a control that opens nothing) + uncaught errors —
// the class of bug the load-only smoke test can't see.
//
// It also runs the CONTRAST GATE (Definition of Done, "Accessibility"): it walks the screens in
// BOTH themes and fails on any settled, readable text below its WCAG AA threshold. Cubby shipped
// a whole night mode and a whole light mode with hundreds of sub-AA strings precisely because no
// automated check ever looked, and because this file only ever seeded one theme.
//
//   node tools/serve.js &   &&   node tools/uitest.js [baseUrl] [out.png]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const SHOT = process.argv[3] || '/tmp/uitest.png';
const APP = BASE + '/app/?e2e=1';

const SEED = {
  babies: [{ id: 'b1', name: 'Test Baby', birth: Date.now() - 120 * 86400000, sex: 'F', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, growth: 1, album: 1, health: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

// Screens the contrast gate walks. Cheap on purpose: this runs on every ship, so it covers the
// surfaces a parent actually lives on rather than all 60 states the full audit sweeps.
const CONTRAST_STEPS = [
  ['home', "go('home')"],
  ['log', "go('log')"],
  ['stats', "go('log'); typeof setLogTab==='function' && setLogTab('stats')"],
  ['album', "go('album')"],
  ['health', "go('health')"],
  ['sheet: feed', "go('home'); openFeed()"],
  ['sheet: settings', "closeSheet(); openSettings()"],
  ['sheet: baby profile', "closeSheet(); openBabyProfile()"],
  /* States that hid real failures until they were seeded here. The note composer carries the
     audience chips (accent-on-its-own-soft-wash); rituals carries the heatmap weekday letters;
     a running timer paints a gradient banner, which is exactly the case the probe used to
     mis-read as 1.0 because it only saw backgroundColor. */
  ['sheet: note', "closeSheet(); openNoteCompose()"],
  ['rituals', "closeSheet(); go('log'); typeof setLogTab==='function' && setLogTab('rituals')"],
  /* Set in memory rather than via startSleep(): that persists, which kicks off a sync the offline
     test page retries forever, and the next page.goto never reaches networkidle2. */
  ['home: sleep timer running', "closeSheet(); go('home'); timersFor(state.activeBabyId).sleep={start:Date.now()-3600000}; render()"],
  /* The medicine alert and its way out. This pill is the loudest thing Cubby ever shows a parent
     and no theme walk had ever looked at it, so its quiet "Not now" shipped unmeasured. Seeded in
     memory (never persisted) for the same reason as the sleep timer above. Last in the list because
     it mutates meds/events and every step after it would inherit the pill. */
  ['home: dose due + dismiss', "closeSheet(); go('home'); state.meds=[{id:'m1',babyId:state.activeBabyId,name:'Calpol',dose:'2.5',unit:'ml',pattern:{type:'everyX',hours:6},remind:true,active:true}]; state.events=[{id:'e1',babyId:state.activeBabyId,type:'medicine',medId:'m1',medName:'Calpol',time:Date.now()-7*3600000}].concat(state.events); render()"],
  ['sheet: reminders', "closeSheet(); openReminders()"],
  /* The guide is a body-level overlay with its own injected stylesheet, so none of the app's own
     surfaces cover it and nothing else in this walk would ever measure its text. Last in the list
     because it sits over everything: any step after it would measure the overlay, not the app. */
  ['guide: contents', "closeSheet(); typeof cubbyOpenGuide==='function' && cubbyOpenGuide()"],
  /* Two chapters, not one: the "Try it" button takes the log's own accent as its fill, so feed and
     sleep exercise different ink-on-accent rungs (sleep is the one accent that declares its own
     --on-sleep). One chapter would only ever measure the fallback. */
  ['guide: chapter (feed)', "typeof CubbyGuide!=='undefined' && CubbyGuide.chapter('feed')"],
  ['guide: chapter (sleep)', "typeof CubbyGuide!=='undefined' && CubbyGuide.chapter('sleep')"],
  /* The vaccine-card table: its own injected stylesheet, its own overlay, and ~25 rows of small
     secondary text next to native date inputs. Nothing else in this walk renders it. */
  ['vaccine card: table', "typeof CubbyVaxCard!=='undefined' && (CubbyVaxCard.close(), CubbyVaxCard.begin(false))"]
];

/* Runs in the page. One row per element that renders its own text, measured against the real
   composited background and the full opacity chain. Deliberate exemptions, each of which would
   otherwise be a false positive:
     - colour emoji / punctuation-only nodes: the glyph paints its own bitmap, `color` never
       reaches it, so the ratio is meaningless
     - aria-hidden subtrees and disabled controls: WCAG 1.4.3 exempts inactive components
     - anything mid entrance-fade: transient by definition, so callers finish animations first
       and this drops whatever is still below full opacity                                     */
const CONTRAST_PROBE = function () {
  function parse(c) {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    var m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function over(f, b) { var a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; }
  function lum(c) { function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function sel(el) { var s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; var c = (el.getAttribute('class') || '').trim(); if (c) s += '.' + c.split(/\s+/).join('.'); return s; }
  function ownText(el) { var t = ''; for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].nodeValue; return t.replace(/\s+/g, ' ').trim(); }
  function up(el, fn) { var n = el; while (n && n.nodeType === 1) { if (fn(n)) return true; n = n.parentElement; } return false; }
  var READABLE = /[A-Za-z0-9]/;   // a string with no letter or digit carries nothing to read

  var out = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i], txt = ownText(el);
    if (!txt || !READABLE.test(txt)) continue;
    if (up(el, function (n) { return n.getAttribute && n.getAttribute('aria-hidden') === 'true'; })) continue;
    if (up(el, function (n) { return n.disabled === true || (n.getAttribute && n.getAttribute('aria-disabled') === 'true'); })) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < -4000 || r.top > 20000) continue;

    // Composite the background from every painted ancestor layer, root-first.
    // backgroundColor alone is not what a parent sees: a gradient layer paints over it and is
    // invisible to getComputedStyle().backgroundColor, so body's radial wash used to vanish here
    // and text was scored against the flat --bg. Gradient layers therefore contribute every one of
    // their colour stops as a candidate, and the element is scored against its WORST stop.
    var stack = [], node = el, chain = 1;
    while (node && node.nodeType === 1) {
      var ncs = getComputedStyle(node);
      var op = parseFloat(ncs.opacity); if (!isNaN(op)) chain *= op;
      var bi = ncs.backgroundImage;
      if (bi && bi !== 'none' && /gradient/i.test(bi)) {
        var stops = (bi.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(function (c) { return c && c[3] > 0; });
        if (stops.length) stack.push(stops);            // an array marks "one of these"
      }
      var bc = parse(ncs.backgroundColor);
      if (bc && bc[3] > 0) stack.push([bc]);
      node = node.parentElement;
    }
    if (chain < 0.999) continue;                       // mid-fade, or a deliberately inactive control
    var base = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!base || base[3] === 0) base = [255, 255, 255, 1];

    var fg = parse(cs.color); if (!fg) continue;
    // Worst stop per gradient layer, chosen up front: the stop whose luminance sits closest to the
    // text is the one that yields the lowest ratio. One candidate per layer keeps the walk O(n).
    var flum = lum(fg);
    var bg = [base[0], base[1], base[2], 1];
    for (var j = stack.length - 1; j >= 0; j--) {
      var layer = stack[j], worst = layer[0];
      for (var s = 1; s < layer.length; s++)
        if (Math.abs(lum(layer[s]) - flum) < Math.abs(lum(worst) - flum)) worst = layer[s];
      bg = over(worst, bg);
    }
    var cr = ratio(over(fg, bg), bg);
    var fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10) || 400;
    var need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3.0 : 4.5;
    if (cr + 0.005 < need) out.push({ sel: sel(el), text: txt.slice(0, 46), ratio: Math.round(cr * 100) / 100, need: need, fs: fs, fw: fw });
  }
  return out;
};

async function settle(page) {
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { } }); });
  await new Promise(r => setTimeout(r, 200));
}

// Walks CONTRAST_STEPS in one theme and returns the distinct failures.
async function contrastWalk(browser, theme) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate((s, t) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', t);
  }, SEED, theme);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1600));
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  const found = new Map();
  for (const [label, code] of CONTRAST_STEPS) {
    await page.evaluate(c => { try { eval(c); } catch (e) { } }, code);
    await settle(page);
    const rows = await page.evaluate(CONTRAST_PROBE);
    for (const r of rows) {
      const k = theme + ' ' + r.sel + ' ' + r.fs + '/' + r.fw;
      if (!found.has(k) || r.ratio < found.get(k).ratio) found.set(k, Object.assign({ key: k, screen: label }, r));
    }
  }
  await page.close();
  return [...found.values()].sort((a, b) => a.ratio - b.ratio);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // boot once (hook runs), seed, reload so Store.load picks up the seed
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(s => localStorage.setItem('little-log-v1', JSON.stringify(s)), SEED);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const booted = await page.evaluate(() => {
    const g = n => { try { return eval(n); } catch (e) { return undefined; } };
    const st = g('state');
    return { babies: (st && st.babies && st.babies.length) || 0, seesBaby: /Test Baby/.test(document.body.innerText), view: g('view') || null };
  });

  await page.screenshot({ path: SHOT });  // clean logged-in home, before any probing

  // dead-tap probe: call each sheet-opener and confirm a sheet actually opens (this is exactly
  // what would have caught the no-baby dead 'Profile' tap). Skips toggles/share/logout and the
  // auth-only Family modal (needs a real signed-in user the e2e mock doesn't provide).
  const OPENERS = ['openBabyProfile', 'openSettings', 'openBabySheet', 'openReminders', 'openDataSheet', 'openPro'];
  let deadTaps = [];
  for (const fn of OPENERS) {
    await page.evaluate(() => { if (typeof closeSheet === 'function') closeSheet(); });  // ensure clean before opening
    await new Promise(r => setTimeout(r, 500));
    const ran = await page.evaluate((f) => { try { var g = eval(f); if (typeof g === 'function') { g(); return true; } return 'no-fn'; } catch (e) { return 'threw:' + e.message; } }, fn);
    await new Promise(r => setTimeout(r, 450));                 // let the sheet's slide-in apply .show
    const opened = await page.evaluate(() => { var s = document.querySelector('.sheet.show'); return !!(s && (s.textContent || '').trim().length > 20); });
    if (ran !== true) deadTaps.push(fn + ' (' + ran + ')');
    else if (!opened) deadTaps.push(fn + ' (no sheet)');
  }

  // ---- contrast gate: the same walk, once per theme ----
  const contrast = [];
  for (const theme of ['light', 'night']) {
    const bad = await contrastWalk(browser, theme);
    console.log(`contrast (${theme}): ${bad.length ? bad.length + ' below AA' : 'all text clears AA'}`);
    bad.slice(0, 12).forEach(b => console.log(`  ✕ ${b.ratio.toFixed(2)}/${b.need} ${b.sel} ${b.fs}px/${b.fw} "${b.text}" [${b.screen}]`));
    contrast.push(...bad);
  }

  await browser.close();
  console.log('booted logged-in UI:', booted.babies > 0 && booted.seesBaby, '| babies:', booted.babies, '| view:', booted.view);
  console.log('uncaught errors:', errs.length); errs.slice(0, 8).forEach(e => console.log('  ✕', e));
  console.log('dead taps (settings rows that opened nothing):', deadTaps.length ? deadTaps.join(', ') : 'none');
  const ok = booted.babies > 0 && booted.seesBaby && errs.length === 0 && deadTaps.length === 0 && contrast.length === 0;
  console.log(ok ? '\nUITEST: PASS ✅' : '\nUITEST: FAIL ❌');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('runner error:', e.message); process.exit(2); });
