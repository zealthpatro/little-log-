/* Can a person actually sign in? Asked by driving the button, not by reading a header.
 *
 *   node tools/signin_gate.js [baseUrl]        default https://little-cubby.com
 *
 * WHY THIS EXISTS. On 2026-08-14 a script-src was added to _headers to stop the Cloudflare Web
 * Analytics beacon. It also blocked https://apis.google.com/js/api.js, which Firebase Auth loads at
 * the moment a sign-in begins in order to build its OAuth iframe. Google and Apple both die there
 * because they share that iframe; the email link dies with them because the failure strands the
 * sign-in screen. Every user of every platform was locked out of a working account for five days.
 * It was found by a parent on WhatsApp at 3:49am, not by us.
 *
 * TWO THINGS PASSED WHILE IT WAS BROKEN, and this gate exists to close both.
 *
 * 1. A CRAWL OF EVERY SURFACE PASSED. The change was verified by loading all 16 pages and finding
 *    zero CSP violations, which was true: apis.google.com is not requested at page load, only on the
 *    first TAP of a sign-in button. A policy can pass a full crawl of the app and still be broken for
 *    every human being. Loading a page is not using it — so this gate CLICKS.
 *
 * 2. FIXING THE HEADER CHANGED NOTHING FOR ANYONE. A Content-Security-Policy is a response HEADER, so
 *    the service worker had cached it along with the HTML and kept serving the old policy from
 *    little-log-v323 no matter what the edge returned. The fix was invisible until the cache name
 *    changed. So this gate also compares the policy in the CACHE against the policy on the WIRE, and
 *    fails when they disagree — that mismatch IS the bug, and nothing else looks for it.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.argv[2] || 'https://little-cubby.com').replace(/\/+$/, '');

/* The origins Firebase Auth genuinely needs. Anything here that the policy refuses is an outage, not
   a tracker. Keep the reason attached to each one so nobody prunes the list to tidy it up. */
const AUTH_ORIGINS = [
  ['https://apis.google.com/js/api.js', 'Firebase Auth loads this to build the OAuth iframe. Google AND Apple both go through it.'],
];

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '\n         ' + d : ''))); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], protocolTimeout: 180000 });
  const p = await b.newPage();
  const csp = [], errs = [];
  p.on('console', m => { const t = m.text(); if (/Content Security Policy/i.test(t)) csp.push(t); });
  p.on('pageerror', e => errs.push(e.message));

  console.log('\nsign-in, driven rather than inspected — ' + BASE);
  await p.goto(BASE + '/app/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3500));   // let the SW install and take control

  /* 1. The policy on the wire must allow every origin auth needs. */
  const wireCsp = await p.evaluate(async (base) => {
    const r = await fetch(base + '/app/?bust=' + Math.random(), { cache: 'reload' });
    return r.headers.get('content-security-policy') || '';
  }, BASE);
  console.log('\nthe policy on the wire');
  for (const [url, why] of AUTH_ORIGINS) {
    const origin = new URL(url).origin;
    ck(wireCsp.indexOf(origin) > -1, 'script-src allows ' + origin, why + '\n         policy: ' + wireCsp);
  }

  /* 2. The policy the SERVICE WORKER hands back must be the same one. This is the check that was
        missing: the edge can be correct while every installed user is served a stale policy. */
  console.log('\nthe policy the service worker serves');
  const cached = await p.evaluate(async () => {
    const names = await caches.keys();
    for (const n of names) {
      const c = await caches.open(n);
      for (const u of ['/app/index.html', '/app/']) {
        const hit = await c.match(u);
        if (hit) return { cache: n, csp: hit.headers.get('content-security-policy') || '' };
      }
    }
    return null;
  });
  if (!cached) {
    ck(true, 'no cached copy of the app document yet (nothing stale to serve)');
  } else {
    ck(cached.csp === wireCsp, 'the cached policy matches the wire',
      'cache ' + cached.cache + '\n         cached: ' + cached.csp + '\n         wire:   ' + wireCsp
      + '\n         A CSP is a response header, so it is cached with the HTML. Bump CACHE in app/sw.js.');
  }

  /* 3. The script must actually load under the policy, in the page, as the browser sees it. */
  console.log('\nthe scripts auth needs actually load');
  for (const [url, why] of AUTH_ORIGINS) {
    const res = await p.evaluate(u => new Promise(done => {
      const s = document.createElement('script');
      s.src = u + (u.indexOf('?') > -1 ? '&' : '?') + 'probe=' + Math.random();
      s.onload = () => done('LOADED');
      s.onerror = () => done('BLOCKED');
      document.head.appendChild(s);
      setTimeout(() => done('TIMEOUT'), 10000);
    }), url);
    ck(res === 'LOADED', url + ' loads', res === 'LOADED' ? '' : 'got ' + res + '. ' + why);
  }

  /* 4. And the thing itself: press the button a parent presses. */
  console.log('\npressing the button a parent presses');
  const before = csp.length;
  const clicked = await p.evaluate(() => {
    const b = [].slice.call(document.querySelectorAll('button'))
      .find(n => /continue with google/i.test(n.textContent || ''));
    if (!b) return false;
    b.click(); return true;
  });
  ck(clicked, 'the Google button is on the page and clickable');
  await new Promise(r => setTimeout(r, 5000));
  ck(csp.length === before, 'no CSP violation after tapping sign in',
    csp.slice(before).join('\n         '));

  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  /* 5. Put the outage back and prove this gate notices. A check nobody has watched go red is not a
        check. Here the real policy from 2026-08-14 is applied to a scratch document, and the probe
        must report the script refused — if this passes, step 3 above is measuring nothing. */
  console.log('\nthe gate can fail');
  const sp = await b.newPage();
  await sp.setContent(
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">'
    + '<title>signin gate self test</title>');
  const caught = await sp.evaluate(u => new Promise(done => {
    const s = document.createElement('script');
    s.src = u;
    s.onload = () => done('LOADED');
    s.onerror = () => done('BLOCKED');
    document.head.appendChild(s);
    setTimeout(() => done('TIMEOUT'), 10000);
  }), AUTH_ORIGINS[0][0]);
  ck(caught === 'BLOCKED', 'it catches the exact policy that locked everyone out',
    'expected BLOCKED under "script-src \'self\' \'unsafe-inline\'", got ' + caught);
  await sp.close();

  console.log('\n' + (fails ? 'SIGNIN: FAIL' : 'SIGNIN: PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
