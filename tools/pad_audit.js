/* Padding and radius audit across every tab.
 *
 * WHY THIS IS A TOOL AND NOT A ONE-OFF. Three separate padding fixes were made against measurements
 * of the top fifth of the home screen, because Cubby scrolls inside #scroll rather than the document
 * and puppeteer's fullPage silently captures only the viewport. Everything below the fold was
 * invisible to every audit until somebody said "scroll down". So this always renders into a viewport
 * tall enough that nothing is below any fold, and it walks every tab rather than the first one.
 *
 * It reports, it does not enforce. tools/grid_check.js is the blocking gate; this is the instrument
 * that tells you what to put in it.
 *
 *   node tools/serve.js &   &&   node tools/pad_audit.js [baseUrl]
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8099';
const DAY = 86400000;

// The insets and radii the card family is supposed to use. Anything else is reported.
const OK_INSET = [14, 16];
const OK_RADIUS = [16, 26];

/* Not cards. A first run flagged twenty-two things and most of them were correct, which is the
   fastest way to make an audit worthless: if the output is mostly noise nobody reads the signal.
   Each of these has a reason, and the reason is the point of the list. */
const NOT_A_CARD = {
  'btn-primary': 'a button. its own radius and centred label are correct',
  'vs-btn': 'a button',
  'es-cta': 'a pill. 99 is the pill radius, not a drifted card',
  'es-bear': 'a circle',
  'nav-inner': 'the bottom nav bar',
  'nav-btn': 'a nav item',
  seg: 'a segmented control',
  on: 'the selected segment',
  'tip-line': 'an inline hint inside a section, not a card on the page',
  'today-strip': 'three-up grid of CENTRED content, so its padding sets column widths rather than a text edge. See tools/grid_check.js',
  'ph-drop': 'an empty-state drop target. centred on purpose'
};

const seed = () => ({
  babies: [{ id: 'b1', name: 'Aanya', birth: Date.now() - 60 * DAY, sex: 'F',
             routines: [{ id: 'r1', name: 'Bath time', days: {} }] }],
  activeBabyId: 'b1',
  events: [
    { id: 'e1', type: 'feed', time: Date.now() - 3600000, babyId: 'b1', amount: 120 },
    { id: 'e2', type: 'diaper', time: Date.now() - 7000000, babyId: 'b1', kind: 'wet' },
    { id: 'e3', type: 'sleep', time: Date.now() - 20000000, end: Date.now() - 14000000, babyId: 'b1' },
    { id: 'e4', type: 'temperature', time: Date.now() - 5400000, babyId: 'b1', temp: 37.9 },
    { id: 'e5', type: 'growth', time: Date.now() - 4 * DAY, babyId: 'b1', weight: 5.2 },
    { id: 'e6', type: 'growth', time: Date.now() - 30 * DAY, babyId: 'b1', weight: 4.6 },
    { id: 'e7', type: 'activity', time: Date.now() - 9000000, babyId: 'b1', activity: 'Tummy time' }
  ],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
  timers: {}, milestones: [], meds: [{ id: 'm1', name: 'Vitamin D', dose: '1 drop', times: ['09:00'] }],
  photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
});

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  // TALL. Nothing may be below a fold, or the audit measures a fifth of the screen again.
  await p.setViewport({ width: 390, height: 6000, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));

  await p.evaluateOnNewDocument((s) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'u_audit');
    localStorage.setItem('cubby-seen-u_audit', JSON.stringify({
      tip_getstarted: 1, tip_install: 1, tip_logguide: 1, home: 1, log: 1, album: 1, health: 1
    }));
    localStorage.setItem('cubby-theme:u_audit', 'light');
  }, seed());

  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1400));

  const measure = () => p.evaluate(() => {
    const px = v => Math.round(parseFloat(v) || 0);
    const out = [], seen = {};
    document.querySelectorAll('#app *').forEach(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 34) return;
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const rad = px(cs.borderTopLeftRadius);
      const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || px(cs.borderTopWidth) > 0;
      if (!filled || rad < 8) return;                  // cards only: filled, and rounded
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
      if (!cls || seen[cls]) return;
      seen[cls] = 1;
      // does its own text start where its padding says, or is it centred?
      out.push({ cls, w: Math.round(r.width), L: Math.round(r.left),
        pt: px(cs.paddingTop), pr: px(cs.paddingRight), pb: px(cs.paddingBottom), pl: px(cs.paddingLeft),
        rad, align: cs.textAlign });
    });
    return out;
  });

  const TABS = ['home', 'log', 'album', 'health'];
  const all = {};
  for (const t of TABS) {
    await p.evaluate(v => go(v), t);
    await new Promise(r => setTimeout(r, 450));
    all[t] = await measure();
  }
  // Settings is a sheet, not a tab, and it is where half the app's rows live.
  await p.evaluate(() => { go('home'); openSettings(); });
  await new Promise(r => setTimeout(r, 500));
  all.settings = await p.evaluate(() => {
    const px = v => Math.round(parseFloat(v) || 0);
    const out = [], seen = {};
    document.querySelectorAll('#sheet *').forEach(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 34) return;
      const rad = px(cs.borderTopLeftRadius);
      if (rad < 8) return;
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && px(cs.borderTopWidth) === 0) return;
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
      if (!cls || seen[cls]) return;
      seen[cls] = 1;
      out.push({ cls, w: Math.round(r.width), L: Math.round(r.left),
        pt: px(cs.paddingTop), pr: px(cs.paddingRight), pb: px(cs.paddingBottom), pl: px(cs.paddingLeft),
        rad, align: cs.textAlign });
    });
    return out;
  });

  let flagged = 0;
  for (const tab of Object.keys(all)) {
    const rows = all[tab];
    console.log('\n' + tab.toUpperCase() + '  (' + rows.length + ' cards)');
    console.log('  ' + 'class'.padEnd(18) + 'w'.padEnd(6) + 'pad T/R/B/L'.padEnd(17) + 'radius'.padEnd(8) + 'align');
    rows.forEach(r => {
      const why = NOT_A_CARD[r.cls];
      const badInset = !OK_INSET.includes(r.pl) || r.pl !== r.pr;
      const badRadius = !OK_RADIUS.includes(r.rad);
      const badAlign = r.align === 'center';
      const flag = why ? '' : [badInset ? 'INSET' : '', badRadius ? 'RADIUS' : '', badAlign ? 'CENTRED' : '']
        .filter(Boolean).join(' ');
      if (flag) flagged++;
      console.log('  ' + r.cls.padEnd(18) + String(r.w).padEnd(6)
        + `${r.pt}/${r.pr}/${r.pb}/${r.pl}`.padEnd(17) + String(r.rad).padEnd(8)
        + r.align.padEnd(8) + (flag ? '<-- ' + flag : (why ? 'ok: ' + why : '')));
    });
  }
  console.log('\n' + flagged + ' card(s) outside the family (inset 14 or 16, radius 16 or 26, not centred)');
  console.log('page errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
})();
