#!/usr/bin/env node
/* admin(live): does the DEPLOYED admin refuse everyone who has not signed in through Access?
 *
 *   node tools/admin_live_check.js                       ask https://admin.little-cubby.com (the live tier)
 *   node tools/admin_live_check.js https://<host>        ask another base (never needed in normal use)
 *   node tools/admin_live_check.js --self-test           stage each answer against local servers (127.0.0.1)
 *
 * Admin spec S1, S5, S8. With no Access session, every path must answer with a redirect to the team's
 * Access login or a 401/403, never a page: the root, a household, a CSV, a static file, a POST. A 403 the
 * Worker itself produced must still carry no-store, noindex and the CSP. Run it after every admin deploy
 * (docs/ADMIN-DEPLOY.md, the smoke test). It asks with no cookie and no token: nothing here can sign in.
 */
'use strict';
const http = require('http');

const SELF = process.argv.includes('--self-test');
const BASE = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || process.env.ADMIN_LIVE_URL || 'https://admin.little-cubby.com').replace(/\/$/, '');
const PATHS = [['GET', '/'], ['GET', '/household/1'], ['GET', '/records.csv?tab=people'], ['GET', '/records?tab=access'],
  ['GET', '/static/admin.css'], ['GET', '/static/fonts/fraunces-latin.woff2'], ['POST', '/api/manual-access']];

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 300) : '')); } };

/* The only two places a sign-in redirect may send a stranger: the team's Access login,
   https://<team>.cloudflareaccess.com/cdn-cgi/access/login/..., or the admin host's OWN /cdn-cgi/access/login.
   The Location is parsed and resolved against the URL that was asked, never substring-matched: the login
   PATH on someone else's host (https://evil.example.com/cdn-cgi/access/login/...) is a redirect elsewhere. */
function accessLogin(loc, asked) {
  let u, a;
  try { u = new URL(loc, asked); a = new URL(asked); } catch (e) { return false; }
  if (u.username || u.password) return false;
  const team = u.protocol === 'https:' && u.port === '' && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(u.hostname)
    && u.pathname.startsWith('/cdn-cgi/access/login/');
  const own = u.origin === a.origin && (u.pathname === '/cdn-cgi/access/login' || u.pathname.startsWith('/cdn-cgi/access/login/'));
  return team || own;
}

function judge(status, headers, body, asked) {
  const loc = headers.get('location') || '';
  if (status >= 300 && status < 400) {
    return accessLogin(loc, asked)
      ? { ok: true, why: 'redirect to the Access login' } : { ok: false, why: 'a redirect somewhere other than Access: ' + loc.slice(0, 80) };
  }
  if (status === 401) return { ok: true, why: '401' };
  if (status === 403) {
    /* A 403 the Worker wrote (its page says "Not allowed") must carry the headers; one from Access need not. */
    if (/Not allowed/.test(body) || headers.get('content-security-policy')) {
      const miss = [];
      if (headers.get('cache-control') !== 'no-store') miss.push('no-store');
      if (!/noindex/.test(headers.get('x-robots-tag') || '')) miss.push('noindex');
      if (!/default-src 'self'/.test(headers.get('content-security-policy') || '')) miss.push('csp');
      if ([...headers.keys()].some((k) => /^access-control-/i.test(k))) miss.push('a CORS header');
      return miss.length ? { ok: false, why: 'the Worker\'s 403 lacks ' + miss.join(', ') } : { ok: true, why: '403 from the Worker, with its headers' };
    }
    return { ok: true, why: '403' };
  }
  return { ok: false, why: 'answered ' + status + ' to a request with no Access session' };
}

async function check(base, label) {
  console.log('\n' + label + ', ' + base);
  let any = false;
  for (const [method, p] of PATHS) {
    let r = null, body = '';
    try {
      r = await fetch(base + p, { method, redirect: 'manual', headers: method === 'POST' ? { 'content-type': 'application/json', origin: base } : {}, body: method === 'POST' ? '{}' : undefined });
      body = await r.text().catch(() => '');
    } catch (e) { ok(method + ' ' + p + ': the host answered', false, e.message); continue; }
    any = true;
    const v = judge(r.status, r.headers, body, base + p);
    ok(method + ' ' + p + ' with no Access session: ' + v.why, v.ok, v.why);
  }
  return any;
}

/* A local stand-in on a port the OS picks, so the self-test never collides with anything running.
   ADMIN_LIVE_PORT_BASE=<n> pins them to n, n+1, ... instead, for a machine that allows only a port range. */
let nextPort = Number(process.env.ADMIN_LIVE_PORT_BASE) || 0;
async function serve(handler) {
  const port = nextPort ? nextPort++ : 0;
  return new Promise((res) => { const s = http.createServer((q, r) => handler(q, r, s.address().port)); s.listen(port, '127.0.0.1', () => res(s)); });
}

(async () => {
  console.log('\nadmin(live): nobody gets in without Access');
  if (!SELF) {
    await check(BASE, 'live');
  } else {
    /* The real handler over sample data (workers/admin/dev/fixture.mjs), asked exactly as a stranger would:
       no Cf-Access-Jwt-Assertion. Its own 403 must pass this gate as it stands. */
    const path = require('path');
    const { pathToFileURL } = require('url');
    const F = await import(pathToFileURL(path.join(__dirname, '..', 'workers', 'admin', 'dev', 'fixture.mjs')).href);
    let fx = null;
    const realWorker = async (q, s, port) => {
      if (!fx) fx = await F.buildFixture({ host: '127.0.0.1:' + port, origin: 'http://127.0.0.1:' + port, scheme: 'http' });
      const chunks = []; for await (const c of q) chunks.push(c);
      const r = await fx.handler.fetch(new Request('http://127.0.0.1:' + port + q.url, { method: q.method, headers: { 'content-type': q.headers['content-type'] || '' },
        body: q.method === 'POST' ? Buffer.concat(chunks) : undefined }), fx.env, {});
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      s.writeHead(r.status, h); s.end(Buffer.from(await r.arrayBuffer()));
    };
    const H = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive', 'content-security-policy': "default-src 'self'", 'content-type': 'text/html' };
    const stages = [
      ['Access in front (302 to the login)', (q, s) => { s.writeHead(302, { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/admin.little-cubby.com?redirect_url=%2F' }); s.end(); }, true],
      ['the REAL admin Worker, asked with no Access token', realWorker, true],
      ['a page served to anyone', (q, s) => { s.writeHead(200, H); s.end('<h1>Cubby Ops</h1>'); }, false],
      ['the Worker refusing WITHOUT no-store', (q, s) => { const h = Object.assign({}, H); delete h['cache-control']; s.writeHead(403, h); s.end('<h1>Not allowed</h1>'); }, false],
      ['a redirect that is not Access', (q, s) => { s.writeHead(302, { location: 'https://evil.example.com/' }); s.end(); }, false],
      /* Access may also send the browser to the admin host's OWN login path (a relative Location). */
      ['Access in front (302 to the admin host\'s own /cdn-cgi/access/login)', (q, s) => { s.writeHead(302, { location: '/cdn-cgi/access/login/admin.little-cubby.com?redirect_url=%2F' }); s.end(); }, true],
      /* N9: the Access login PATH on someone else's host is a redirect somewhere else. Each must be RED. */
      ...[
        'https://evil.example.com/cdn-cgi/access/login/admin.little-cubby.com?redirect_url=%2F',
        'https://team.cloudflareaccess.com.evil.example.com/cdn-cgi/access/login/admin.little-cubby.com',
        'https://team.cloudflareaccess.com' + '@' + 'evil.example.com/cdn-cgi/access/login/admin.little-cubby.com',   // user info; split so the address gate never reads it as an inbox
        'https://evil.example.com\\@team.cloudflareaccess.com/cdn-cgi/access/login/admin.little-cubby.com',
        '//evil.example.com/cdn-cgi/access/login/admin.little-cubby.com',
        'http://team.cloudflareaccess.com/cdn-cgi/access/login/admin.little-cubby.com',
        'https://team.cloudflareaccess.com:8443/cdn-cgi/access/login/admin.little-cubby.com',
        'https://team.cloudflareaccess.com/evil/cdn-cgi/access/login/admin.little-cubby.com',
      ].map((loc) => ['a redirect to the Access login path on another host or scheme (' + loc.slice(0, 60) + ')', (q, s) => { s.writeHead(302, { location: loc }); s.end(); }, false]),
      ['a 404 (not deployed, or the route is wrong)', (q, s) => { s.writeHead(404); s.end(); }, false],
    ];
    for (const [label, h, shouldPass] of stages) {
      const srv = await serve(h);
      const quiet = console.log; const before = fail; console.log = () => {};
      await check('http://127.0.0.1:' + srv.address().port, label);
      console.log = quiet;
      const red = fail - before; fail = before;
      srv.close();
      ok('self-test, ' + label + ': ' + (shouldPass ? 'green' : 'RED'), shouldPass ? red === 0 : red >= 1, red + ' failures');
    }
    const gone = await serve(() => {}); const deadPort = gone.address().port; await new Promise((r) => gone.close(r));
    const quiet = console.log; const before = fail; console.log = () => {};
    await check('http://127.0.0.1:' + deadPort, 'nothing listening');
    console.log = quiet; const red = fail - before; fail = before;
    ok('self-test, an admin host that does not answer: RED', red >= 1);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-LIVE: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})();
