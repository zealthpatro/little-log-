/* Does every word on the marketing site clear WCAG AA against the ground it actually sits on?
 *
 *   node tools/marketing_contrast_check.js [http://localhost:8080]
 *   node tools/marketing_contrast_check.js --self-test     prove the predicate can go red
 *
 * WHY THIS EXISTS. On 2026-09-08 every light-band eyebrow and every .hx-more link on the site
 * measured 2.89:1, and white on the primary CTA measured 2.99:1. Both under the 4.5 that normal
 * text needs. The colour was --h-accent #C97FA0 doing two jobs with opposite pressures: text on
 * cream, and a fill under white text. Nothing measured either, so both had been red since the day
 * they shipped. The fix was one token, #96496C, which clears every surface as text (worst case
 * 4.77 on --h-cream3) and clears the CTA as a fill (6.06). This gate is what stops the next accent
 * change, or the next "lighter pink looks nicer", from quietly undoing that.
 *
 * WHAT IT MEASURES. Computed colour of every visible text element versus the EFFECTIVE background:
 * the first non-transparent ancestor background, alpha-composited over the page body. Not the
 * token, not the stylesheet, the pixels the person gets. Large text (>= 24px, or >= 18.66px at
 * weight >= 700) is held to 3.0 per WCAG; everything else to 4.5.
 *
 * WHAT IT DOES NOT MEASURE, said plainly. Text over images or gradients, where "the background" is
 * not a colour; those are skipped and counted, never passed. And it cannot see anti-aliasing or a
 * font's weight rendering, so it is a floor, not a design review.
 */
const path = require('path');

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8080';
const SELFTEST = process.argv.includes('--self-test');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES = ['/', '/pregnancy/', '/features/', '/how-it-works/', '/why/', '/pricing/', '/faq/', '/vaccination-schedule/in/'];
/* The four selectors that were red, named so their status is legible in the output rather than
   buried in a count. */
const NAMED = ['.hx-eyebrow', '.hx-more a', '.nav-cta', '.hero-cta', '.hx-bigcta'];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ok   ' + m); };
const bad = (m) => { fail++; console.log('  FAIL ' + m); };

/* The predicate, kept pure so --self-test can hit it with known numbers. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
}
function needed(px, weight) { return (px >= 24 || (px >= 18.66 && weight >= 700)) ? 3.0 : 4.5; }

if (SELFTEST) {
  console.log('\nself-test: the predicate against numbers we already know\n');
  const oldPink = [201, 127, 160], newPlum = [150, 73, 108], cream = [253, 251, 246], white = [255, 255, 255];
  const r1 = ratio(oldPink, cream);
  ok(`old accent on cream computes ${r1} (independently measured 2.89)`) ; if (Math.abs(r1 - 2.89) > 0.02) bad('predicate disagrees with the measured 2.89');
  if (r1 < needed(12, 800)) ok('and a 12px eyebrow in it is judged a failure'); else bad('a 2.89 eyebrow was judged fine, predicate broken');
  const r2 = ratio(white, oldPink);
  if (r2 < needed(15, 800)) ok(`white on the old accent (${r2}) fails a 15px bold button`); else bad('white on 2.99 passed');
  /* The large-text rule, asserted on the thresholds themselves rather than on a colour that happens
     to sit at 2.99: WCAG large is >= 24px, or >= 18.66px at weight >= 700, and it needs 3.0 not 4.5. */
  if (needed(24, 400) === 3.0 && needed(18.66, 700) === 3.0) ok('large text is held to 3.0'); else bad('large-text thresholds wrong');
  if (needed(18, 700) === 4.5 && needed(23.9, 400) === 4.5 && needed(15, 800) === 4.5) ok('and anything smaller to 4.5'); else bad('normal-text threshold wrong');
  const r3 = ratio(newPlum, cream);
  if (r3 >= 4.5) ok(`the new accent on cream is ${r3}, clear`); else bad('new accent fails its own gate');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('MARKETING-CONTRAST: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
}

(async () => {
  console.log('\nmarketing contrast: the pixels, not the tokens · ' + BASE + '\n');
  const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  let worst = { r: 99 }, measured = 0, skipped = 0;
  const namedSeen = {};
  /* Two widths. The phone is where most parents read this; the desktop pass exists because some
     elements (.hx-bigcta among them) only render wide, and a gate that never sees them cannot fail them. */
  const VIEWS = [{ w: 375, h: 812, mobile: true }, { w: 1280, h: 900, mobile: false }];
  for (const v of VIEWS) for (const p0 of PAGES) {
    const p = p0 + (v.mobile ? '' : ' @1280');
    await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1, isMobile: v.mobile, hasTouch: v.mobile });
    const res = await page.goto(BASE + p0, { waitUntil: 'networkidle2', timeout: 45000 });
    if (!res || res.status() !== 200) { bad(`${p} did not load (${res && res.status()})`); continue; }
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    const out = await page.evaluate((NAMED) => {
      const parse = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
      const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
      /* Effective background: walk up until a non-transparent colour; composite alpha over what is
         beneath. A background-image anywhere on the way up means "not a colour": skip, count. */
      const effBg = (el) => {
        let stack = [];
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
          const c = parse(cs.backgroundColor);
          if (c && (c[3] === undefined || c[3] > 0)) { stack.push(c); if (c[3] === undefined || c[3] >= 1) break; }
        }
        let bg = bodyBg.slice(0, 3);
        for (const c of stack.reverse()) { const a = c[3] === undefined ? 1 : c[3]; bg = bg.map((v, i) => Math.round(c[i] * a + v * (1 - a))); }
        return bg;
      };
      const rows = [], named = {};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      let t;
      while ((t = walker.nextNode())) {
        if (!t.nodeValue.trim()) continue;
        const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
        if (el.closest('[aria-hidden="true"]')) continue;   // decorative, exempt under WCAG 1.4.3
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const fg = parse(cs.color); if (!fg || (fg[3] !== undefined && fg[3] === 0)) continue;
        const bg = effBg(el);
        const px = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight, 10) || 400;
        /* Every matching selector, not the first: .hx-bigcta and .hero-cta sit on ONE element, and
           first-match left .hx-bigcta "never seen" while it was measured under the other name. */
        const tags = NAMED.filter((sel) => el.matches(sel) || el.closest(sel));
        rows.push({ fg: fg.slice(0, 3), bg, px, w, tags, txt: t.nodeValue.trim().slice(0, 28) });
      }
      return rows;
    }, NAMED);

    let pageWorst = { r: 99 }, pageFails = [];
    for (const row of out) {
      if (!row.bg) { skipped++; continue; }
      measured++;
      const r = ratio(row.fg, row.bg), need = needed(row.px, row.w);
      for (const tg of row.tags) { namedSeen[tg] = namedSeen[tg] || { min: 99, n: 0 }; namedSeen[tg].n++; namedSeen[tg].min = Math.min(namedSeen[tg].min, r); }
      if (r < pageWorst.r) pageWorst = { r, need, ...row };
      if (r < need) pageFails.push(`${r} < ${need} "${row.txt}" ${row.px}px/${row.w}${row.tags.length ? ' ' + row.tags.join(',') : ''}`);
    }
    if (pageWorst.r < worst.r) worst = { page: p, ...pageWorst };
    if (pageFails.length) bad(`${p} ${pageFails.length} below AA: ${pageFails.slice(0, 3).join(' · ')}`);
    else ok(`${p} every measured text clears AA (worst ${pageWorst.r} "${pageWorst.txt}")`);
  }

  console.log('\nthe four that were red on 2026-09-08, by name');
  for (const sel of NAMED) {
    const s = namedSeen[sel];
    if (!s) { bad(`${sel} was never seen on any page, so it is not being measured`); continue; }
    if (s.min >= 4.5) ok(`${sel} clears 4.5 everywhere (${s.n} seen, worst ${s.min})`);
    else bad(`${sel} worst ${s.min} across ${s.n} seen`);
  }

  /* Paired, so a green run cannot be a run that measured nothing. */
  console.log('');
  if (measured > 600) ok(`${measured} text elements measured across ${PAGES.length} pages at two widths, ${skipped} over images skipped`);
  else bad(`only ${measured} elements measured, this run did not see the site`);
  ok(`site-wide worst ${worst.r} on ${worst.page} "${worst.txt}"`);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('MARKETING-CONTRAST: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
