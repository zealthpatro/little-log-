// Headless screenshot via the system Chrome (no bundled chromium).
// Lets us actually SEE rendered marketing pages locally before shipping
// (the mcp Claude_Preview tool is broken in this workspace; it roots at the
// empty 2nd working dir, so it never finds .claude/launch.json).
//
// One-time setup (puppeteer-core only, NO chromium download; it drives the
// Chrome already on the machine):
//   npm i puppeteer-core            # installs to the gitignored node_modules
// (No root package.json on purpose: it would make Cloudflare attempt a build.)
//
// Usage:
//   node tools/serve.js &                       # serve the repo on :8080
//   node tools/shot.js <url> <out.png> [width] [mode]
//     width : viewport CSS width (default 390 = phone; try 1100 for desktop)
//     mode  : "full" (whole page, default) | a CSS selector (just that element)
//
// Examples:
//   node tools/shot.js http://localhost:8080/ /tmp/home-m.png 390 full
//   node tools/shot.js http://localhost:8080/ /tmp/ribbon.png 1100 .hx-journey
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const url = process.argv[2];
  const out = process.argv[3] || '/tmp/shot.png';
  const width = parseInt(process.argv[4], 10) || 390;
  const mode = process.argv[5] || 'full';
  if (!url) { console.error('usage: node tools/shot.js <url> <out.png> [width] [mode]'); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  // DSF 1 for full-page (keeps the tall image a sane size); 2 for a crisp element shot.
  await page.setViewport({ width, height: 900, deviceScaleFactor: mode === 'full' ? 1 : 2 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.error('goto:', e.message));
  await new Promise(r => setTimeout(r, 700)); // let fonts + entrance settle

  if (mode === 'full') {
    await page.screenshot({ path: out, fullPage: true });
  } else {
    const el = await page.$(mode);
    if (el) await el.screenshot({ path: out });
    else { console.error('selector not found:', mode, '(full page instead)'); await page.screenshot({ path: out, fullPage: true }); }
  }
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
