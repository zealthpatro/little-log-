// Bakes a small set of TEXT-FREE watercolour art tiles for the keepsake studio's bear-art
// overlay chips (app/journey-art/ov_<slug>.webp). The normal card webps carry baked captions,
// so overlays get their own caption-less bake from the Layer-1 sources in art-src/.
// Run: node tools/bake_overlays.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art-src');
const OUT = path.join(ROOT, 'app', 'journey-art');
const TEMPLATE = 'file://' + path.join(__dirname, 'journey-compose.html');

// slug -> pastel ground (matched to each illustration's own palette family)
const OVERLAYS = {
  'hero-cub': '#EFE7DA',
  '124_baby_i_smiled': '#F4E2DE',
  '125_baby_i_laughed': '#F1E8D6',
  '178_baby_i_love_cuddles': '#F2EADD',
  '132_baby_first_steps': '#E4E9DA',
  '115_baby_my_first_birthday': '#F5E7E3',
  '056_baby_hello_world': '#F4EDDE',
  '009_pregnancy_and_then_there_were_three': '#DDE3D5'
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 600, deviceScaleFactor: 1 });
  await page.goto(TEMPLATE, { waitUntil: 'networkidle2', timeout: 30000 });
  let done = 0;
  for (const slug of Object.keys(OVERLAYS)) {
    const src = path.join(SRC, slug + '.png');
    if (!fs.existsSync(src)) { console.warn('missing art-src: ' + slug); continue; }
    const img = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
    await page.evaluate((o) => window.renderCard(o), { img: img, caption: '', bg: OVERLAYS[slug] });
    await page.evaluate(() => { const l = document.getElementById('layer1'); if (l.style.display === 'none' || l.complete) return true; return new Promise(r => { l.onload = () => r(true); l.onerror = () => r(true); }); });
    await new Promise(r => setTimeout(r, 50));
    const el = await page.$('#card');
    await el.screenshot({ path: path.join(OUT, 'ov_' + slug + '.webp'), type: 'webp', quality: 82 });
    done++;
  }
  await browser.close();
  console.log('baked ' + done + ' overlay tiles -> app/journey-art/ov_*.webp');
})().catch(e => { console.error(e); process.exit(1); });
