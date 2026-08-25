#!/usr/bin/env node
/* The three PWA manifest screenshots, captured from the running app.
 *
 * What was wrong: icons/screenshots/*.png were drawn by tools/gen_pwa_screenshots.py — a warm
 * gradient, a bear, and a hand-typed faux log card with the words "Feed / left side, 12 min" set in
 * Arial. They are posters about Cubby, not Cubby. They are what Chrome's install sheet, every PWA
 * directory and the schema.org SoftwareApplication entry show at the exact moment a parent is
 * deciding, so the two things Cubby is genuinely alone in doing — holding a family after a loss, and
 * a private note that is private for real — were invisible at the only moment they could have won
 * her, and everything she did see was a claim rather than the product.
 *
 * These three are the product: a real timeline carrying two caregivers' names, the real wellbeing
 * sheet with its own never-shared sentence on it, and the real screen a parent lands on after a
 * pregnancy ends with no baby to come back to.
 *
 * 390 x 844 CSS at deviceScaleFactor 3 is 1170 x 2532, a real phone frame, well inside Chrome's
 * richer-install rules (both sides between 320 and 3840, long side under 2.3x the short side, all
 * three the same aspect ratio).
 *
 * Fictional family throughout ("Bo Bear", Maya and Sam), per the fictional-baby rule. No real
 * child's data and no real photo ever goes into a store or install asset.
 *
 *   PORT=9427 node tools/serve.js &
 *   node tools/gen_manifest_shots.js http://localhost:9427
 *
 * Output: icons/screenshots/NN-name.png. tools/manifest_shots_check.js is the gate that proves each
 * shipped file is still the screen the manifest says it is.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

/* PNG width and height out of the IHDR header. `sips` is macOS only and this generator has no other
   reason to need a Mac. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (f) => {
  const b = fs.readFileSync(f);
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(f + ' is not a PNG (no IHDR header)');
  }
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9427';
const OUT = path.join(__dirname, '..', 'icons', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = require(__dirname + '/manifest_shot_scenes.js');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument(SCENES.pinClock, SCENES.OFFSET);
  await page.setViewport(SCENES.VIEWPORT);

  const made = [];
  for (const s of SCENES.SHOTS) {
    await SCENES.stage(page, BASE, s, sleep);
    const seen = (await SCENES.onScreenText(page)).toLowerCase();
    const missing = s.must.filter((m) => seen.indexOf(m.toLowerCase()) < 0);
    const banned = (s.mustNot || []).filter((m) => seen.indexOf(m.toLowerCase()) >= 0);
    const hit = !missing.length && !banned.length;
    const f = path.join(OUT, s.file + '.png');
    await page.screenshot({ path: f });
    const { w, h } = pngSize(f);
    made.push({ file: s.file, why: s.why, hit, missing, banned, w, h, kb: Math.round(fs.statSync(f).size / 1024) });
  }
  await browser.close();

  console.log('\nfile                 shows                                on screen?  pixels      size');
  made.forEach((m) => console.log('  ' + m.file.padEnd(19) + m.why.padEnd(37)
    + (m.hit ? 'ok          ' : 'WRONG SCREEN ') + (m.w + 'x' + m.h).padEnd(12) + m.kb + 'kb'
    + (m.missing.length ? '  missing: ' + m.missing.join(' | ') : '')
    + (m.banned.length ? '  should not be here: ' + m.banned.join(' | ') : '')));
  const wrong = made.filter((m) => !m.hit || m.w !== 1170 || m.h !== 2532);
  console.log('\npage errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
  console.log(wrong.length ? '\nMANIFEST SHOTS: FAIL — ' + wrong.length + ' wrong screen or wrong size'
                           : '\nMANIFEST SHOTS: PASS — ' + made.length + ' at 1170x2532 in ' + OUT);
  process.exit(wrong.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
