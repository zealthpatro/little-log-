#!/usr/bin/env node
/* The links Cubby mails and shares open in a browser, not only from a script.
 *
 * Two kinds of link are answered by worker.js and by no file on disk:
 *   /__/auth/action?mode=signIn&...   the "Tap instead" sign-in link in every sign-in email (proxied to
 *                                     Firebase's handler, which then forwards to /app/)
 *   /g/<code>                         the family guessing game a parent shares with guests
 * Workers Static Assets answers a NAVIGATION (a browser's Sec-Fetch-Mode: navigate) to a path with no file
 * by itself, with not_found_handling's 404 page, and never asks the Worker, once the compatibility date
 * is 2025-04-01 or later (ours: 2025-06-01) and not_found_handling is set (since 8 Jul 2026). A plain
 * request (curl, a test) still reached the Worker, so every check passed while every parent who tapped
 * the sign-in link, and every guest opening a game, saw "That page moved or never existed" (found
 * 17 Nov 2026). wrangler.toml's run_worker_first now lists both paths.
 *
 * This asks production the way a browser does and fails unless each link gets its real page.
 *   node tools/live_nav_check.js               production (CUBBY_LIVE_URL to point it elsewhere)
 *   node tools/live_nav_check.js --self-test   the matcher, against this repo's own 404 page
 * It reads HTML only and runs no script, so the made-up oobCode and game code are never acted on.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = (process.env.CUBBY_LIVE_URL || 'https://little-cubby.com').replace(/\/$/, '');
const NOT_FOUND = /<h1>That page moved or never existed<\/h1>/;

/* What each link must answer: a 200 with its own page, and never the branded 404. */
const LINKS = [
  { name: 'sign-in link', path: '/__/auth/action?mode=signIn&oobCode=cubby-nav-check&apiKey=cubby-nav-check&lang=en', page: /fireauth\.oob\.OobHandler/ },
  { name: 'game link', path: '/g/cubby-nav-check', page: /<title>Family games · Cubby<\/title>/ },
];
const NAV_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 cubby-nav-check',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-fetch-site': 'cross-site',
  'upgrade-insecure-requests': '1',
};

function judge(link, status, body) {
  if (NOT_FOUND.test(body)) return 'answered the 404 page ("That page moved or never existed"), status ' + status;
  if (status !== 200) return 'status ' + status + ', not 200';
  if (!link.page.test(body)) return 'status 200 but not its page (no ' + link.page + ')';
  return '';
}

/* node:https, NOT fetch(): Node's fetch (undici) replaces sec-fetch-mode with its own "cors", so a
   fetch() with these headers is no navigation at all, reaches the Worker, and passed against the broken
   production on 17 Nov 2026. https.request sends the headers exactly as written. */
function get(url) {
  const mod = url.startsWith('https:') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: NAV_HEADERS, timeout: 15000 }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 15 s')));
    req.on('error', reject);
  });
}

async function live() {
  let fail = 0;
  console.log('\nlinks opened in a browser, against ' + BASE + '\n');
  for (const link of LINKS) {
    let why;
    try {
      const r = await get(BASE + link.path);
      why = judge(link, r.status, r.body);
    } catch (e) { why = 'request failed: ' + (e && e.message || e); }
    if (why) { fail++; console.log('  FAIL ' + link.name + ' (' + link.path.split('?')[0] + '): ' + why); }
    else console.log('  ok   ' + link.name + ' (' + link.path.split('?')[0] + ') gets its own page');
  }
  console.log('\nNAV-LINKS(live): ' + (fail ? 'FAIL' : 'PASS') + ', ' + (LINKS.length - fail) + ' of ' + LINKS.length);
  return fail;
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 200) : '')); } };
  console.log('\nnav-links self-test: the matcher against this repo\'s own pages\n');
  const notFound = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const game = fs.readFileSync(path.join(ROOT, 'g', 'index.html'), 'utf8');
  /* Firebase's action handler is not in this repo: this is the page firebaseapp.com served on 17 Nov 2026. */
  const handler = '<!DOCTYPE html><html><head><script type="text/javascript" src="action.js"></script><script type="text/javascript">fireauth.oob.OobHandler.initialize(\'#actionElement\');</script></head><body><div id="actionElement"></div></body></html>';
  const [signin, games] = LINKS;
  ok('this repo\'s 404 page is still the one the check looks for', NOT_FOUND.test(notFound));
  ok('the 404 page, as served to a browser before the fix (status 404), is red for the sign-in link', !!judge(signin, 404, notFound));
  ok('and red for the game link', !!judge(games, 404, notFound));
  ok('the 404 page with a 200 is still red', !!judge(signin, 200, notFound) && !!judge(games, 200, notFound));
  ok('companion: Firebase\'s handler page with a 200 is green for the sign-in link', judge(signin, 200, handler) === '', judge(signin, 200, handler));
  ok('companion: this repo\'s game page with a 200 is green for the game link', judge(games, 200, game) === '', judge(games, 200, game));
  ok('the right page with a wrong status is red', !!judge(signin, 503, handler));
  ok('another page with a 200 is red (the game page for the sign-in link)', !!judge(signin, 200, game));
  /* The first version asked with fetch(), whose sec-fetch-mode is always "cors": it passed against the broken
     production. The live half must keep asking with node:https. */
  const src = fs.readFileSync(__filename, 'utf8');
  const liveSrc = src.slice(src.indexOf('async function live()'), src.indexOf('function selfTest()'));
  ok('the live half asks with node:https, never fetch() (which sends no navigation)', liveSrc.length > 100 && !/\bfetch\(/.test(liveSrc) && /\bget\(BASE/.test(liveSrc));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('NAV-LINKS SELF-TEST: ' + (fail ? 'FAIL' : 'PASS'));
  return fail;
}

(async () => {
  const bad = process.argv.includes('--self-test') ? selfTest() : await live();
  process.exit(bad ? 1 : 0);
})();
