// Composes finished journey cards = Layer 1 (your illustration, text-free) + Layer 2 (the caption,
// rendered here from the catalogue). Reads docs/journey-cards.json; for each card it looks for the
// Layer-1 file in the source dir (default ./art-src/<file>) and, if missing, falls back to the card's
// pastel ground so it still produces a card. Outputs app/journey-art/<slug>.webp + manifest.json.
//
//   Drop your Layer-1 PNGs into  art-src/  named exactly as the catalogue `file` (e.g. 001_pregnancy_we_found_out.png)
//   Run:  node tools/compose_cards.js            (or: node tools/compose_cards.js /path/to/art-src)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2] || path.join(ROOT, 'art-src');
const OUT = path.join(ROOT, 'app', 'journey-art');
const TEMPLATE = 'file://' + path.join(__dirname, 'journey-compose.html');

// catalogue palette name -> muted hex ground (used when a Layer-1 file isn't present yet)
const PALETTE = {
  'muted sage': '#DDE3D5', 'pale beige': '#EFE7DA', 'dusty cream': '#F1E8D6', 'warm oat': '#ECE2CF',
  'soft blush': '#F4E2DE', 'cream beige': '#F2EADD', 'pale sage': '#E4E9DA', 'warm cream': '#F4EDDE',
  'muted pastel': '#ECE5DB', 'muted cream': '#F1E9DB', 'pale blush': '#F5E7E3', 'warm oatmeal': '#EDE4D3',
  'pastel seasonal': '#EEE7DE', 'cream blank': '#F7F1E7'
};

// Variant cards intentionally share their base card's illustration (less-is-more: one painted
// scene deepens across many related moments; never generate these separately). A variant without
// its own art-src file bakes with the base card's file — so it inherits the art automatically the
// day the base illustration lands.
const ART_ALIAS = {
  'LC-031': 'LC-019',                                                        // nine months pregnant -> the bump is growing
  'LC-183': 'LC-150',                                                        // I love dancing -> I danced today
  'LC-179': 'LC-067',                                                        // I love bath time -> My first bath
  'LC-215': 'LC-060',                                                        // First family photo (With family) -> First family photo (Newborn)
  'LC-232': 'LC-214',                                                        // First time meeting family -> My family
  'LC-216': 'LC-155',                                                        // First cousin photo -> Made a new friend (two cubs)
  'LC-235': 'LC-164',                                                        // Birthday (recurring) -> First birthday party
  'LC-236': 'LC-162',                                                        // Holiday (recurring) -> First holiday
  'LC-242': 'LC-159',                                                        // First beach trip -> First beach day
  'LC-241': 'LC-160',                                                        // First vacation -> First road trip
  'LC-085': 'LC-087', 'LC-086': 'LC-087', 'LC-088': 'LC-087', 'LC-089': 'LC-087',  // journaling set -> one journal design
  'LC-082': 'LC-081', 'LC-083': 'LC-081', 'LC-084': 'LC-081',                      // weeks-old markers -> one-week pose
  'LC-253': 'LC-252',                                                        // First passport photo -> First photoshoot
  'LC-255': 'LC-161',                                                        // First trip abroad -> First flight
  'LC-218': 'LC-210', 'LC-220': 'LC-210', 'LC-222': 'LC-210', 'LC-224': 'LC-210',   // Mama variants -> Mama and me
  'LC-221': 'LC-211', 'LC-223': 'LC-211', 'LC-225': 'LC-211',                       // Papa variants -> Papa and me
  'LC-219': 'LC-214', 'LC-226': 'LC-214', 'LC-227': 'LC-214', 'LC-228': 'LC-214', 'LC-229': 'LC-214', // family variants -> My family

  // --- shares that used to be duplicated PNG BYTES in art-src/ (35 copies, ~40.6 MB) ---
  // One painted scene was copied on disk under every slug that reuses it, so the reuse was
  // invisible to anyone reading this file and the sources cost 40 MB more than they needed to.
  // Same baked output, stated once, here.
  'LC-077': 'LC-076', 'LC-078': 'LC-076', 'LC-079': 'LC-076', 'LC-080': 'LC-076', // days 3-6 old -> the two-days-old sleeping newborn
  'LC-196': 'LC-192', 'LC-197': 'LC-192',                                          // growing fast / tiny but mighty -> I am brave
  'LC-199': 'LC-194', 'LC-205': 'LC-194', 'LC-207': 'LC-194',                      // smiles + laughter -> I am happy
  'LC-201': 'LC-191',                                                              // I made a funny face -> I am cheeky
  'LC-206': 'LC-190',                                                              // Today I surprised everyone -> I am curious
  'LC-198': 'LC-193',                                                              // I had a big day -> I am sleepy
  'LC-208': 'LC-195', 'LC-209': 'LC-195',                                          // today was special / a moment to remember -> I am loved
  'LC-265': 'LC-202',                                                              // I ate... -> I had a messy meal
  'LC-276': 'LC-275',                                                              // a hard day we got through -> something sweet happened
  'LC-279': 'LC-278',                                                              // this made us proud -> a big milestone
  'LC-268': 'LC-264', 'LC-269': 'LC-264', 'LC-274': 'LC-264',                      // said/smiled/laughed prompts -> one speech-bubble design
  'LC-272': 'LC-270', 'LC-285': 'LC-270',                                          // letter prompts -> one "note from" design
  // the open-ended journaling prompts all share one deliberately near-empty design
  'LC-261': 'LC-260', 'LC-262': 'LC-260', 'LC-263': 'LC-260', 'LC-266': 'LC-260',
  'LC-273': 'LC-260', 'LC-277': 'LC-260', 'LC-280': 'LC-260', 'LC-281': 'LC-260',
  'LC-282': 'LC-260', 'LC-283': 'LC-260', 'LC-284': 'LC-260', 'LC-286': 'LC-260',
  // NOTE: month 2 borrowing month 1 is a stand-in, not a design choice — at one and two months
  // pregnant the bump reads the same, but this is the one entry worth replacing with its own art.
  'LC-024': 'LC-023'
  // Monthly growth 18-23 months (LC-107..LC-112) is deliberately NOT aliased: each month has
  // its own illustration so a toddler's months don't repeat down the list.
};

(async () => {
  const cat = require(path.join(ROOT, 'docs', 'journey-cards.json'));
  const fileById = {}; cat.cards.forEach(c => { fileById[c.id] = c.file; });
  fs.mkdirSync(OUT, { recursive: true });
  const haveSrc = fs.existsSync(SRC);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 600, deviceScaleFactor: 2 });
  await page.goto(TEMPLATE, { waitUntil: 'networkidle2', timeout: 30000 });
  // Inject the self-hosted caption font (Caveat) as base64 and AWAIT it, so headless never bakes a
  // plain fallback (the old CDN @import raced the screenshot). FontFace API guarantees it's ready.
  const capFontB64 = fs.readFileSync(path.join(ROOT, 'app', 'fonts', 'caveat-700-latin.woff2')).toString('base64');
  await page.evaluate(async (b64) => {
    var ff = new FontFace('Caveat', 'url(data:font/woff2;base64,' + b64 + ') format("woff2")', { weight: '700' });
    document.fonts.add(ff); await ff.load();
    try { await document.fonts.ready; } catch (e) {}
  }, capFontB64);

  // JOURNEY_ONLY=<id|slug>[,<id|slug>...] bakes just those cards (fast iteration); merges into
  // the existing manifest so the other cards' entries are preserved.
  const ONLY = process.env.JOURNEY_ONLY || '';
  const ONLYSET = ONLY ? new Set(ONLY.split(',').map(s => s.trim()).filter(Boolean)) : null;
  const manifest = ONLYSET && fs.existsSync(path.join(OUT, 'manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) : {};
  let withArt = 0, fallback = 0;
  for (const c of cat.cards) {
    if (ONLYSET && !ONLYSET.has(c.id) && !ONLYSET.has(c.slug)) continue;
    let raw = path.join(SRC, c.file);
    if (!(haveSrc && fs.existsSync(raw)) && ART_ALIAS[c.id]) raw = path.join(SRC, fileById[ART_ALIAS[c.id]] || c.file);
    let img = null;
    if (haveSrc && fs.existsSync(raw)) { img = 'data:image/png;base64,' + fs.readFileSync(raw).toString('base64'); withArt++; }
    else fallback++;
    await page.evaluate((o) => window.renderCard(o), { img: img, caption: c.caption, bg: PALETTE[c.bg] || '#EFE7DA' });
    await page.evaluate(() => { const l = document.getElementById('layer1'); if (l.style.display === 'none' || l.complete) return true; return new Promise(r => { l.onload = () => r(true); l.onerror = () => r(true); }); });
    await new Promise(r => setTimeout(r, 60));
    const el = await page.$('#card');
    const outFile = c.slug + '.webp';
    await el.screenshot({ path: path.join(OUT, outFile), type: 'webp', quality: 86 });
    manifest[c.id] = { file: outFile, caption: c.caption, section: c.section };
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log('composed ' + cat.cards.length + ' cards -> app/journey-art/  (' + withArt + ' with Layer-1 art, ' + fallback + ' on pastel fallback)');
  if (!haveSrc) console.log('note: no art-src/ dir yet — drop Layer-1 PNGs there (named by catalogue `file`) and re-run to bake them in.');
})().catch(e => { console.error(e); process.exit(1); });
