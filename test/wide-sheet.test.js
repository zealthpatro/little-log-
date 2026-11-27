/* A closed sheet stays out of sight on every screen width, including the framed wide layout.
 *
 *   node test/wide-sheet.test.js http://localhost:8080
 *
 * WHY. From 900px wide the app is drawn as a framed den (DESIGN.md C-4) and the sheet is lifted to
 * bottom:28px to sit inside the frame. The closed sheet is hidden by translateY(100%), its OWN height,
 * so lifted 28px it never left the screen: a 28px white strip sat under the frame on every iPad in
 * landscape, an iPad Pro upright, and every desktop browser (found 2026-11-27 on the iPad check for the
 * App Store build). Phones never showed it, which is why nobody saw it.
 *
 * Checks, at a phone, an iPad upright and turned, an iPad Pro and a desktop: the closed sheet's top is at
 * or below the bottom of the viewport; and the opened sheet still rises fully into view (a fix that hid
 * the sheet for good would pass the first half alone).
 */
'use strict';
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'tools', 'node_modules', 'puppeteer-core'));
const dl = require('../tools/gate_downloads');

const BASE = process.argv[2] || 'http://localhost:8080';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [[390, 844], [820, 1180], [1180, 820], [1024, 1366], [1440, 900]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ok   ' + n);
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
    downloadBehavior: dl.downloadBehavior() });
  try {
    const p = await b.newPage();
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    for (const [w, h] of SIZES) {
      await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(800);
      const closed = await p.evaluate(() => {
        const s = document.getElementById('sheet');
        s.classList.remove('show');
        s.style.transition = 'none';
        const r = s.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height), vh: innerHeight };
      });
      ok(`${w}x${h}: the closed sheet is off screen (top ${closed.top} >= ${closed.vh})`, closed.top >= closed.vh, closed);
      const open = await p.evaluate(() => {
        const s = document.getElementById('sheet');
        s.innerHTML = '<div style="height:120px">open</div>';
        s.classList.add('show');
        const r = s.getBoundingClientRect();
        const out = { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
        s.classList.remove('show');
        s.innerHTML = '';
        return out;
      });
      ok(`${w}x${h}: an open sheet is fully in view`, open.top >= 0 && open.bottom <= open.vh && open.top < open.vh - 100, open);
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `WIDE SHEET: FAIL (${fail})` : 'WIDE SHEET: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
