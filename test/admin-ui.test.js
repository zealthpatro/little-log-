/* Cubby Ops in a real browser: hostile names stay text, nothing loads from anywhere else, nothing scrolls
 * sideways on a phone (admin spec §6, S9, S14).
 *
 *   node test/admin-ui.test.js <url>                 the browser gate (the <url> is unused: it marks this
 *                                                    as a browser gate, so CI without Chrome skips it)
 *   node test/admin-ui.test.js <url> --shots <dir>   also save 1440px and 390px screenshots of every screen
 *   node test/admin-ui.test.js <url> --self-test     also stage a page that runs a hostile name, and one that
 *                                                    scrolls sideways, and require both to go RED
 *
 * The real admin handler over SAMPLE families (one of them named <img src=x onerror=...>"><script>...),
 * served on 127.0.0.1 by the fixture, which signs each request with its own Access key. Chrome is the
 * machine's own; downloads go to a temp dir (tools/gate_downloads.js).
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const puppeteer = require(path.join(__dirname, '..', 'tools', 'node_modules', 'puppeteer-core'));
const dl = require(path.join(__dirname, '..', 'tools', 'gate_downloads.js'));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const SHOTS = ARGS.includes('--shots') ? path.resolve(ARGS[ARGS.indexOf('--shots') + 1]) : null;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 400) : '')); } };

async function serveFixture(F, extra) {
  let fx = null;
  const srv = http.createServer(async (q, s) => {
    const chunks = []; for await (const c of q) chunks.push(c);
    const port = srv.address().port;
    if (extra && extra[q.url]) { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(extra[q.url]); return; }
    const headers = new Headers();
    for (const [k, v] of Object.entries(q.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers.set(k, v);
    headers.set('cf-access-jwt-assertion', fx.token());
    const r = await fx.handler.fetch(new Request('http://127.0.0.1:' + port + q.url, { method: q.method, headers, body: ['GET', 'HEAD'].includes(q.method) ? undefined : Buffer.concat(chunks) }), fx.env, {});
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    s.writeHead(r.status, h); s.end(Buffer.from(await r.arrayBuffer()));
  });
  /* Port 0 lets the OS pick; ADMIN_UI_PORT pins it, for a machine that allows only a port range. */
  await new Promise((res) => srv.listen(Number(process.env.ADMIN_UI_PORT) || 0, '127.0.0.1', res));
  const port = srv.address().port;
  fx = await F.buildFixture({ host: '127.0.0.1:' + port, origin: 'http://127.0.0.1:' + port, scheme: 'http', hostile: true });
  const o = [console.log, console.error]; console.log = () => {}; console.error = () => {};
  try { await fx.tickUntilDone(); } finally { [console.log, console.error] = o; }
  return { fx, srv, base: 'http://127.0.0.1:' + port };
}

async function inspect(browser, url, width) {
  const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  const requests = [], dialogs = [], errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
  });
  const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(() => {
    const small = [], seen = new Set();
    for (const el of document.querySelectorAll('.btn, .seg a, .tabs a, .pill, .back, .toggle, input:not([type=hidden]), select, button')) {
      /* A checkbox inside its label is tapped through the label: the label is the target that counts. */
      const target = (el.tagName === 'INPUT' && el.closest('label')) || el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (r.width && r.height && !el.hidden && r.height < 43.5) small.push(target.tagName + '.' + target.className + ' ' + Math.round(r.height));
    }
    /* A one-word value ("Off", "No") must never be split across lines to make room for a long label. */
    const split = [];
    for (const el of document.querySelectorAll('.kv>span:last-child, td:not(:first-child)')) {
      const t = (el.textContent || '').trim();
      if (!t || /[\s-]/.test(t) || t.length > 40) continue;   // a break at a space or a hyphen is ordinary
      /* Count the text's own line boxes (the span itself stretches to the row's height in a flex row). */
      const range = document.createRange(); range.selectNodeContents(el);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) split.push(t);
    }
    return {
      split,
      pwned: window.__pwned || null,
      imgs: document.querySelectorAll('img').length,
      scripts: [...document.scripts].map((s) => s.src || 'inline'),
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      csp: window.__csp,
      fraunces: document.fonts.check('600 22px Fraunces'), nunito: document.fonts.check('700 15px "Nunito Sans"'),
      small, robots: (document.querySelector('meta[name=robots]') || {}).content || null,
    };
  });
  return { page, ctx, status: res && res.status(), requests, dialogs, errors, facts };
}

(async () => {
  const F = await import(pathToFileURL(path.join(ROOT, 'workers', 'admin', 'dev', 'fixture.mjs')).href);
  console.log('\nadmin UI in Chrome: hostile names inert, same-origin only, no sideways scroll at 390 and 320');
  const STAGED = {
    '/staged-hostile': '<!doctype html><meta charset=utf-8><body><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>',
    '/staged-wide': '<!doctype html><meta charset=utf-8><body style="margin:0"><div style="width:900px;height:20px">wide</div>',
    '/staged-small': '<!doctype html><meta charset=utf-8><body><label class="toggle" style="display:inline-block;height:20px"><input type="checkbox"> tiny</label><button class="btn" style="height:24px">x</button>',
  };
  const { fx, srv, base } = await serveFixture(F, STAGED);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'], downloadBehavior: dl.downloadBehavior() });
  try {
    const no = (hid) => fx.admin.raw.prepare('SELECT display_no FROM dir_households WHERE hid = ?').get(hid).display_no;
    const SCREENS = [
      ['overview', '/?own=show'], ['overview-default', '/'],
      ['household-maya', '/household/' + no('HHID_sample_maya')], ['household-leena', '/household/' + no('HHID_sample_leena')],
      ['household-hostile', '/household/' + no('HHID_sample_hostile')],
      ['records-people', '/records?tab=people&own=show'], ['records-households', '/records?tab=households&own=show'],
      ['records-access', '/records?tab=access'], ['records-visits', '/records?tab=visits'],
      ['records-saved-view', '/records?tab=households&view=invite_waiting&own=show'],
      ['manual-access', '/manual-access?household=' + no('HHID_sample_maya')],
    ];
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    for (const [name, p] of SCREENS) {
      for (const width of [1440, 390, 320]) {
        const r = await inspect(browser, base + p, width);
        const f = r.facts;
        const foreign = r.requests.filter((u) => !u.startsWith(base + '/'));
        if (width === 1440) {
          ok(name + ': 200, with the robots meta', r.status === 200 && f.robots === 'noindex', [r.status, f.robots]);
          ok(name + ': no handler ran, no dialog, nothing injected (S14)', !f.pwned && !r.dialogs.length && f.imgs === 0 && f.scripts.every((s) => s === base + '/static/admin.js'), [f.pwned, r.dialogs, f.imgs, f.scripts]);
          ok(name + ': every request went to the admin host only (S9)', foreign.length === 0, foreign);
          ok(name + ': no CSP violation (no inline style or script anywhere)', f.csp.length === 0 && !r.errors.length, [f.csp, r.errors]);
          ok(name + ': Cubby\'s own Fraunces and Nunito Sans loaded', f.fraunces && f.nunito);
        } else {
          ok(name + ' at ' + width + 'px: the page does not scroll sideways (tables scroll inside their card)', f.scrollW <= f.innerW, [f.scrollW, f.innerW]);
          if (width === 390) ok(name + ' at 390px: every control is at least 44px tall', f.small.length === 0, f.small);
          ok(name + ' at ' + width + 'px: no one-word value is split across lines', f.split.length === 0, f.split);
        }
        if (SHOTS && width !== 320) await r.page.screenshot({ path: path.join(SHOTS, 'admin-' + name + '-' + width + '.png'), fullPage: true });
        await r.ctx.close();
      }
    }
    /* The manual-access form posts JSON through the one script, and the result is written as text. */
    {
      const r = await inspect(browser, base + '/manual-access?household=' + no('HHID_sample_maya'), 1440);
      await r.page.select('select[name=reason]', 'family_asked');
      await r.page.type('input[name=request]', 'R-0042');
      await r.page.click('#manual-form button[type=submit]');
      await r.page.waitForFunction(() => /Recorded as entry \d+/.test(document.getElementById('manual-result').textContent), { timeout: 10000 }).catch(() => {});
      const said = await r.page.$eval('#manual-result', (e) => e.textContent);
      ok('the manual-access form records through the page\'s own script', /Recorded as entry \d+ in the access log\./.test(said), said);
      const row = fx.admin.raw.prepare("SELECT detail FROM access_log WHERE action = 'manual_access' ORDER BY seq DESC LIMIT 1").get();
      ok('as a reason code and a request number', row && row.detail === '{"reason":"family_asked","request":"R-0042"}', row);
      await r.ctx.close();
    }
    if (ARGS.includes('--self-test')) {
      console.log('\nself-test: the same checks on staged pages must go RED');
      const h = await inspect(browser, base + '/staged-hostile', 1440);
      ok('a page that runs a hostile name is caught', !!h.facts.pwned || h.facts.imgs > 0);
      await h.ctx.close();
      const w = await inspect(browser, base + '/staged-wide', 390);
      ok('a page that scrolls sideways at 390px is caught', w.facts.scrollW > w.facts.innerW, [w.facts.scrollW, w.facts.innerW]);
      await w.ctx.close();
      const sm = await inspect(browser, base + '/staged-small', 390);
      ok('a 24px button and a checkbox in a 20px label are both caught as too small', sm.facts.small.length === 2, sm.facts.small);
      await sm.ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  /* And the real pages, broken one rule at a time in a temp copy: each must turn this suite RED. */
  if (ARGS.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    const { selfTest } = require('./helpers/admin-selftest.js');
    selfTest(__filename, [
      { name: 'names are not escaped', file: 'workers/admin/src/html.mjs',
        find: "export const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"'`]/g, (c) => MAP[c]);",
        replace: "export const esc = (s) => String(s == null ? '' : s);" },
      { name: 'a long name pushes the page sideways', file: 'workers/admin/src/assets.mjs',
        find: '.kv>span:first-child{min-width:0;overflow-wrap:anywhere}', replace: '' },
      { name: 'a value breaks mid-word beside a long name', file: 'workers/admin/src/assets.mjs',
        find: '.kv>span:first-child{min-width:0;overflow-wrap:anywhere}', replace: '.kv>span{min-width:0;overflow-wrap:anywhere}' },
      { name: 'a role breaks mid-word in a table', file: 'workers/admin/src/assets.mjs',
        find: 'vertical-align:top;overflow-wrap:break-word}', replace: 'vertical-align:top;overflow-wrap:anywhere}' },
      { name: 'a font comes from Google Fonts', file: 'workers/admin/src/assets.mjs',
        find: "src:url(/static/fonts/", replace: "src:url(https://fonts.gstatic.com/s/" },
    ], ok);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-UI: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-UI: FAIL'); process.exit(1); });
