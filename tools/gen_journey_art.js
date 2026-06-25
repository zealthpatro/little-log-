// Cubby journey-art generator. Renders tools/journey-card.html (a parametric textured
// milestone card) headless via the system Chrome and rasterizes one PNG per card into
// app/journey-art/, plus a manifest.json (cardKey -> file). The app shows the PNG when
// present and falls back to the inline SVG otherwise, so you can hand-replace any single
// card with painted art later by dropping a file of the same name.
//
// Usage:  npm i puppeteer-core   (once)
//         node tools/gen_journey_art.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '..', 'app', 'journey-art');
const TEMPLATE = 'file://' + path.join(__dirname, 'journey-card.html');

// key = the journey prompt key it backs. pal rotates for variety. acc/motif vary the art.
const CARDS = [
  // ----- timeline: one per MONTH_SLOTS slot (key 'bmonth:<slot>') -----
  { key: 'bmonth:0',  big: 'Newborn',  sm: '',            pal: 'cream',  motif: 'leaves'   },
  { key: 'bmonth:1',  big: 'One',      sm: 'month old',   pal: 'sage',   motif: 'leaves'   },
  { key: 'bmonth:2',  big: 'Two',      sm: 'months old',  pal: 'blush',  motif: 'sparkles' },
  { key: 'bmonth:3',  big: 'Three',    sm: 'months old',  pal: 'butter', motif: 'leaves'   },
  { key: 'bmonth:4',  big: 'Four',     sm: 'months old',  pal: 'rose',   motif: 'sparkles' },
  { key: 'bmonth:5',  big: 'Five',     sm: 'months old',  pal: 'sky',    motif: 'leaves'   },
  { key: 'bmonth:6',  big: 'Six',      sm: 'months old',  pal: 'sage',   motif: 'both'     },
  { key: 'bmonth:7',  big: 'Seven',    sm: 'months old',  pal: 'blush',  motif: 'leaves'   },
  { key: 'bmonth:8',  big: 'Eight',    sm: 'months old',  pal: 'cream',  motif: 'sparkles' },
  { key: 'bmonth:9',  big: 'Nine',     sm: 'months old',  pal: 'butter', motif: 'leaves'   },
  { key: 'bmonth:10', big: 'Ten',      sm: 'months old',  pal: 'rose',   motif: 'sparkles' },
  { key: 'bmonth:11', big: 'Eleven',   sm: 'months old',  pal: 'sky',    motif: 'leaves'   },
  { key: 'bmonth:12', big: 'One',      sm: 'year old',    pal: 'coral',  acc: 'hat', motif: 'both' },
  { key: 'bmonth:15', big: 'Fifteen',  sm: 'months old',  pal: 'sage',   motif: 'leaves'   },
  { key: 'bmonth:18', big: 'Eighteen', sm: 'months old',  pal: 'blush',  motif: 'sparkles' },
  { key: 'bmonth:24', big: 'Two',      sm: 'years old',   pal: 'butter', acc: 'hat', motif: 'both' },
  // ----- common milestones (key 'bms:<milestoneKey>') -----
  { key: 'bms:smile',  big: 'I smiled!',   sm: 'for the first time', pal: 'butter', motif: 'sparkles' },
  { key: 'bms:tooth',  big: 'First',       sm: 'tooth!',             pal: 'blush',  motif: 'leaves'   },
  { key: 'bms:sit',    big: 'I sat up!',   sm: 'all by myself',      pal: 'sage',   motif: 'sparkles' },
  { key: 'bms:steps',  big: 'First',       sm: 'steps!',             pal: 'coral',  motif: 'both'     },
  { key: 'bms:words',  big: 'First',       sm: 'words!',             pal: 'sky',    motif: 'sparkles' },
  { key: 'bms:rollover',big:'I rolled',    sm: 'over!',              pal: 'rose',   motif: 'leaves'   },
  // ----- relationship cards (key 'rel:<relationKey>') -----
  { key: 'rel:nana',    big: 'With',  sm: 'Nana',     pal: 'rose',   acc: 'flower', motif: 'leaves' },
  { key: 'rel:grandma', big: 'With',  sm: 'Grandma',  pal: 'rose',   acc: 'flower', motif: 'leaves' },
  { key: 'rel:papa',    big: 'With',  sm: 'Papa',     pal: 'sky',    motif: 'leaves' },
  { key: 'rel:grandpa', big: 'With',  sm: 'Grandpa',  pal: 'sage',   motif: 'leaves' },
  { key: 'rel:auntie',  big: 'With',  sm: 'Auntie',   pal: 'blush',  acc: 'flower', motif: 'sparkles' },
  { key: 'rel:uncle',   big: 'With',  sm: 'Uncle',    pal: 'butter', motif: 'sparkles' },
  { key: 'rel:sibling', big: 'With',  sm: 'my sibling',pal: 'cream', motif: 'both' },
  { key: 'rel:other',   big: 'Together', sm: '',      pal: 'sage',   motif: 'both' },
  // ----- fallbacks for anything not explicitly listed -----
  { key: 'bmonth:_',    big: 'A month',  sm: 'to remember', pal: 'cream',  motif: 'leaves'   },
  { key: 'bms:_',       big: 'A first',  sm: 'to remember', pal: 'butter', motif: 'sparkles' },
  { key: 'bday',        big: 'Happy',    sm: 'birthday!',   pal: 'coral',  acc: 'hat', motif: 'both' }
];

const fileFor = (k) => k.replace(/[:]/g, '-').replace(/_/g, 'default') + '.webp';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 480, deviceScaleFactor: 2 });
  await page.goto(TEMPLATE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
  await new Promise(r => setTimeout(r, 400));

  const manifest = {};
  const EXPS = ['calm', 'giggly', 'sleepy', 'surprised'];
  const EXP_OVERRIDE = { 'bmonth:0': 'sleepy', 'bms:smile': 'giggly', 'bms:sit': 'surprised', 'bms:steps': 'surprised', 'bms:words': 'giggly', 'bms:rollover': 'surprised', 'bday': 'giggly', 'rel:nana': 'giggly', 'rel:sibling': 'giggly' };
  let i = 0;
  for (const c of CARDS) {
    c.exp = EXP_OVERRIDE[c.key] || EXPS[i % EXPS.length]; i++;
    await page.evaluate((o) => window.renderCard(o), c);
    await new Promise(r => setTimeout(r, 120));
    const el = await page.$('#card');
    const file = fileFor(c.key);
    await el.screenshot({ path: path.join(OUT, file), type: 'webp', quality: 82 });
    manifest[c.key] = 'journey-art/' + file;
    console.log('  ', c.key, '->', file);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log('wrote', CARDS.length, 'cards + manifest.json to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
