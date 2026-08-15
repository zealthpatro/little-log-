/* WHO invited you, and to WHAT, on the screen you actually land on.
 *
 * The email said "Meera has invited you to the Patro family"; this screen said "Someone has added
 * you". A name, a tap, then "someone", at the highest-intent moment in the funnel and for the one
 * behaviour the product rests on.
 *
 * ONE navigation, in a FRESH browser context, per case. The app registers a service worker, and once
 * it controls the page it answers /api/invite-peek itself, so the request mock is never consulted.
 * That bites twice: a second goto in the same page, and a second CASE in the same context. Earlier
 * versions of this file did both and reported the feature broken while it was working.
 *
 *   PORT=8123 node tools/serve.js &
 *   node tools/invite_arrival_check.js http://localhost:8123
 */
const p = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const B = process.argv[2] || 'http://localhost:8123';
const TOK = 'Ab3xQ7mZ9pLk2RtVwY5nQz';
const s = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + JSON.stringify(x).slice(0, 200))); };

const CASES = [
  [{ ok: true, state: 'live', by: 'Meera', family: 'the Patro family' }, /Meera invited you/, /part of the Patro family/, 'live link, family named'],
  [{ ok: true, state: 'live', by: 'Meera', family: '' }, /Meera invited you/, /Meera's circle/, 'live link, family unnamed'],
  [{ ok: true, state: 'live', by: '', family: '' }, /You're invited/, /Someone has added you/, 'live link, no name at all'],
  [{ ok: true, state: 'spent', by: 'Meera' }, /link has been used/, /Ask Meera for a fresh one/, 'a spent link'],
  [{ ok: true, state: 'expired', by: '' }, /link has expired/, /whoever invited you/, 'an expired link, no name'],
  [null, /You're invited/, /Someone has added you/, 'the lookup fails entirely'],
];

(async () => {
  const b = await p.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  for (const [body, expectT, expectS, label] of CASES) {
    /* A FRESH browser context per case. The service worker registers on the first load and then
       persists across pages in the same context, answering /api/invite-peek itself so the mock is
       never consulted again. Isolating storage per case is what makes each one honest. */
    const ctx = await b.createBrowserContext();
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await pg.setRequestInterception(true);
    pg.on('request', (req) => {
      if (req.url().includes('/api/invite-peek')) {
        if (!body) return req.respond({ status: 500, contentType: 'text/plain', body: 'nope' });
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      req.continue();
    });
    await pg.setViewport({ width: 390, height: 900 });
    await pg.goto(B + '/app/?join=' + TOK, { waitUntil: 'networkidle2' });
    await s(2800);
    const r = await pg.evaluate(() => ({
      t: (document.getElementById('lpInvTitle') || {}).textContent || '',
      sub: (document.getElementById('lpInvSub') || {}).textContent || '',
      body: document.body.innerText || '',
    }));
    console.log('\n' + label);
    console.log('   "' + r.t + '"');
    console.log('   "' + r.sub.slice(0, 96) + '"');
    ok('title', expectT.test(r.t), r.t);
    ok('sub', expectS.test(r.sub), r.sub);
    ok('never names a baby', !/Robin|Wren/.test(r.body));
    ok('the right-email rule survives', /email address they invited/i.test(r.body) || /link has (been used|expired)/.test(r.t), r.t);
    ok('no page errors', errs.length === 0, errs);
    await pg.close();
    await ctx.close();
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'INVITE-ARRIVAL: FAIL' : 'INVITE-ARRIVAL: PASS');
  process.exit(fail ? 1 : 0);
})();
