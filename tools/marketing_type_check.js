/* The marketing site's type + fold contract, enforced. Canon: design/MARKETING-SYSTEM.md.
 *
 * WHY THIS EXISTS. Three separate bugs shipped to production in one week, all of them invisible in
 * the source and all of them the same shape:
 *
 *   1. `.homex .hx-lede`      declared 21px, rendered at body size
 *   2. `.homex .hx-fineprint` declared 13.5px, rendered at body size
 *   3. `.homex .hx-kick`      declared its own size, rendered at body size
 *
 * All three lost a specificity contest nobody ran. `.homex .hx-copy p` is (0,2,1); a bare
 * `.homex .hx-someclass` on a <p> inside .hx-copy is (0,2,0), so the container rule wins and the
 * class silently does nothing. Reading site.css tells you the intended size. Only the browser tells
 * you the real one. The founder found #2 and #3 by looking at the page and asking why the subtitle
 * was the same size as the body; it had been live for weeks.
 *
 * The fold half is the same lesson in colour. A tinted band was compared against "the page", but
 * the page was a FIXED gradient (vax.css --bg1 -> --bg2), so the contrast changed as you scrolled
 * and at the bottom of the viewport it collapsed to 8.2 luminance. A single sample would have
 * called that passing. This gate samples the same boundary at two scroll positions and requires
 * both the gap AND its constancy.
 *
 *   node tools/serve.js &   &&   node tools/marketing_type_check.js [baseUrl]
 *   node tools/marketing_type_check.js --self-test    # proves the gate can fail
 */
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:8080';
const SELFTEST = process.argv.includes('--self-test');

// Pages that carry the .homex band system. Others keep the site gradient and have no folds.
const PAGES = ['/', '/pregnancy/', '/features/', '/how-it-works/'];
const WIDTHS = [320, 390, 1440];

const MIN_STEP = 1.5;   // px a subtitle must clear its own body copy by
const MIN_FOLD = 12;    // luminance a band must differ from the page by
const MAX_DRIFT = 1.5;  // luminance that difference may vary across scroll positions

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ok   ' + m); };
const bad = m => { fail++; console.log('  FAIL ' + m); };

const lum = c => {
  const m = String(c).match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const [r, g, b] = m.map(Number);
  return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
};

/* The three-tier ladder, per section shape. Each entry is title / subtitle / body, and the rule is
   the same everywhere: strictly descending, with a real step between subtitle and body. A subtitle
   that merely differs in typeface reads as "two fonts", not as a hierarchy. */
const LADDERS = [
  { name: 'hero',    title: '.hx-hero-split .hx-copy h1', sub: '.hx-hero-split .hx-copy .hx-kick', body: '.hx-hero-split .hx-lede' },
  { name: 'split',   title: '.hx-band .hx-copy h2',       sub: '.hx-band .hx-copy .hx-kick',       body: '.hx-band .hx-copy .hx-kick + p' },
  { name: 'two-col', title: '.hx-twocol .hx-tcol h2',     sub: '.hx-twocol .hx-tcol .hx-kick',     body: '.hx-twocol .hx-tcol .hx-kick + p' },
];

async function measure(page) {
  return page.evaluate((LADDERS) => {
    const size = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return parseFloat(getComputedStyle(el).fontSize);
    };
    const out = { ladders: [], fineprint: null, body: null };
    for (const L of LADDERS) {
      out.ladders.push({ name: L.name, title: size(L.title), sub: size(L.sub), body: size(L.body) });
    }
    out.fineprint = size('.hx-copy .hx-fineprint');
    out.body = size('.hx-copy p:not(.hx-kick):not(.hx-lede):not(.hx-fineprint)');
    return out;
  }, LADDERS);
}

/* Walks up from a point until it finds an element that actually paints a background. A transparent
   body over a gradient is exactly how the fold bug hid: elementFromPoint alone reports nothing. */
async function effectiveBg(page, x, y) {
  return page.evaluate(([px, py]) => {
    let el = document.elementFromPoint(px, py);
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)') return c;
      el = el.parentElement;
    }
    const bi = getComputedStyle(document.body).backgroundImage;
    return bi && bi !== 'none' ? 'GRADIENT' : 'none';
  }, [x, y]);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

  console.log('1. type ladder: title > subtitle > body, with a real step');
  for (const w of WIDTHS) {
    for (const url of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 900 });
      await page.goto(BASE + url, { waitUntil: 'networkidle0' });
      if (SELFTEST) {
        await page.addStyleTag({ content: '.homex .hx-copy p{font-size:40px !important}' });
      }
      const m = await measure(page);
      for (const L of m.ladders) {
        if (L.title == null || L.sub == null || L.body == null) continue; // section absent on this page
        const label = `${url} @${w} ${L.name}: ${L.title}/${L.sub}/${L.body}`;
        if (!(L.title > L.sub)) bad(label + ' — title not larger than subtitle');
        else if (!(L.sub - L.body >= MIN_STEP)) bad(label + ` — subtitle only ${(L.sub - L.body).toFixed(1)}px over body (need ${MIN_STEP})`);
        else ok(label);
      }
      /* The specificity trap, named. Any typographic class on a <p> inside .hx-copy must be written
         as `p.that-class` or .hx-copy p beats it. Fineprint is the canary: it is the furthest from
         body size, so if it has collapsed to body size the whole family has. */
      if (m.fineprint != null && m.body != null) {
        if (m.fineprint >= m.body) bad(`${url} @${w} fineprint ${m.fineprint}px >= body ${m.body}px — .hx-copy p is winning; write the rule as p.hx-fineprint`);
        else ok(`${url} @${w} fineprint ${m.fineprint}px stays below body ${m.body}px`);
      }
      await page.close();
    }
  }

  console.log('\n2. folds: a band differs from the page, and by the SAME amount at any scroll');
  for (const url of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE + url, { waitUntil: 'networkidle0' });
    if (SELFTEST) {
      await page.addStyleTag({ content: 'html:has(.homex) body{background:none !important}' });
    }
    const docY = await page.evaluate(() => {
      const t = document.querySelector('.hx-tint');
      return t ? Math.round(t.getBoundingClientRect().top + window.scrollY) : null;
    });
    if (docY == null) { ok(`${url} has no tinted band, nothing to compare`); await page.close(); continue; }

    const deltas = [];
    for (const vy of [450, 120]) {
      await page.evaluate((d, v) => window.scrollTo(0, d - v), docY, vy);
      await new Promise(r => setTimeout(r, 320));
      const above = await effectiveBg(page, 30, vy - 40);
      const below = await effectiveBg(page, 30, vy + 40);
      if (above === 'GRADIENT' || above === 'none') {
        bad(`${url} the band's neighbour is a gradient, not a colour — contrast cannot be constant (see MARKETING-SYSTEM.md, "the fold model")`);
        deltas.length = 0;
        break;
      }
      deltas.push(+(lum(above) - lum(below)).toFixed(1));
    }
    if (!deltas.length) { await page.close(); continue; }

    const min = Math.min(...deltas.map(Math.abs));
    const drift = Math.abs(deltas[0] - deltas[1]);
    if (min < MIN_FOLD) bad(`${url} fold contrast only ${min} luminance (need ${MIN_FOLD}) — deltas ${deltas.join(', ')}`);
    else if (drift > MAX_DRIFT) bad(`${url} fold contrast drifts ${drift} across scroll (deltas ${deltas.join(', ')}) — the base is not flat`);
    else ok(`${url} fold contrast ${deltas[0]} luminance, constant across scroll`);
    await page.close();
  }

  console.log('\n3. no page scrolls sideways');
  for (const w of WIDTHS) {
    for (const url of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 900 });
      await page.goto(BASE + url, { waitUntil: 'networkidle0' });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w) bad(`${url} @${w} scrollWidth ${sw}`); else ok(`${url} @${w}`);
      await page.close();
    }
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (SELFTEST) {
    console.log(fail > 0 ? 'SELF-TEST OK: the gate can fail.' : 'SELF-TEST BROKEN: sabotage did not trip it.');
    process.exit(fail > 0 ? 0 : 1);
  }
  console.log(fail ? 'MARKETING-TYPE: FAIL' : 'MARKETING-TYPE: PASS');
  process.exit(fail ? 1 : 0);
})();
