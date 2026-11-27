/* Every path worker.js serves must be listed in wrangler.toml run_worker_first.
 *
 *   node tools/worker_first_check.js              check this tree
 *   node tools/worker_first_check.js --self-test  also prove it goes red
 *
 * WHY. run_worker_first as a list REPLACES the default: an unlisted path is answered by the asset layer
 * (the 404 page, or 405 for a POST) and never reaches the Worker. On 24 Nov 2026 the list became
 * ["/__/*", "/g/*"] to fix browser navigations, and from then until 27 Nov every /api/* call and both
 * apple-app-site-association paths failed in production (sign-in codes, invites, purge, dose, usage).
 * Every test that called the Worker directly stayed green. This reads the route literals in worker.js and
 * the list in wrangler.toml, and fails any route the list does not cover. '/' is the static site.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); } };

function routes(workerSrc) {
  const out = new Set();
  const re = /(?:pathname|\bp)\s*===?\s*'([^']+)'|startsWith\('(\/[^']*)'\)/g;
  let m; while ((m = re.exec(workerSrc))) out.add(m[1] || m[2]);
  out.delete('/');
  return [...out];
}
function list(toml) {
  const m = /^run_worker_first\s*=\s*\[([^\]]*)\]/m.exec(toml);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
function covered(route, pats) {
  return pats.some((p) => p.endsWith('/*') ? route.startsWith(p.slice(0, -1)) : route === p);
}
function judge(workerSrc, toml) {
  const pats = list(toml);
  if (!pats) return { missing: [], none: true };
  return { missing: routes(workerSrc).filter((r) => !covered(r, pats)), none: false };
}

console.log('\nworker-first: every route worker.js serves is listed in run_worker_first\n');
const w = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const t = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
const found = routes(w);
ok('worker.js names its routes (' + found.length + ')', found.length >= 10, found.join(' '));
const r = judge(w, t);
ok('run_worker_first is set', !r.none);
ok('every route reaches the Worker', !r.none && r.missing.length === 0, 'missing: ' + r.missing.join(', '));

if (process.argv.includes('--self-test')) {
  console.log('\nself-test');
  const broken = t.replace(/^run_worker_first\s*=.*$/m, 'run_worker_first = ["/__/*", "/g/*"]');
  const b = judge(w, broken);
  ok('the 24 Nov list goes red, naming /api routes and AASA', b.missing.some((x) => x.startsWith('/api/')) && b.missing.some((x) => /apple-app-site-association/.test(x)), b.missing.join(', '));
  ok('a route under a listed prefix is covered', covered('/api/health', ['/api/*']) && covered('/g/x', ['/g/*']));
  ok('a bare path is NOT covered by its /* pattern (Cloudflare does not match /g with /g/*)', !covered('/g', ['/g/*']));
  ok('a sibling prefix is not', !covered('/apix', ['/api/*']));
  const extra = w + "\nif (url.pathname === '/new-route') {}\n";
  ok('a new route added to worker.js without the list goes red', judge(extra, t).missing.includes('/new-route'));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\nWORKER-FIRST: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
