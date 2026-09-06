/* Does production serve only what a parent should see? The repo IS the deploy.
 *
 *   node tools/deploy_exclusion_check.js                 static: .assetsignore names every internal path
 *   node tools/deploy_exclusion_check.js https://little-cubby.com   also ask production for each one
 *   node tools/deploy_exclusion_check.js --self-test     prove the static half can go red
 *
 * WHY. wrangler.toml deploys [assets] directory="./", the whole repository, and .assetsignore is the
 * only thing standing between a tracked file and a public URL. On 2026-09-07 production was serving
 * .githooks/pre-push, .github/workflows/gates.yml, test/rules-test.js and firebase.json. None held a
 * secret. That is luck: the next test fixture or workflow that embeds a key would be live the moment
 * it was pushed. So this holds two things: the deny-list NAMES each internal path (static, every run),
 * and production ANSWERS 404 for each of them (live, with a 200 control so it cannot pass on a dead
 * host). A 404 from a host that is down looks the same as a 404 from an exclusion; the control is
 * what tells them apart.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');
const BASE = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');

/* Internal and never a parent's business. Each must appear in .assetsignore as a bare name. ios and
   android are gitignored (never tracked, so never deployed); they are listed so the intent is explicit
   if that ever changes, not because they were exposed. The five that WERE exposed on 2026-09-07 were
   .githooks, .github, test and firebase.json. */
const INTERNAL = ['.git', '.claude', '.githooks', '.github', 'tools', 'test', 'workers', 'worker.js',
  'wrangler.toml', 'firestore.rules', 'firebase.json', '.assetsignore', '.gitignore', 'package.json',
  'package-lock.json', 'node_modules', 'serviceAccountKey.json', 'articles-drafts', 'ios', 'android'];
/* One concrete public URL per excluded class, asked of production. */
const MUST_404 = ['.githooks/pre-push', '.githooks/pre-commit', '.github/workflows/gates.yml', 'test/rules-test.js',
  'firebase.json', 'tools/gates.js', 'wrangler.toml', 'worker.js', 'firestore.rules', '.assetsignore', 'CLAUDE.md',
  'ios/App/App/capacitor.config.json', 'android/app/build.gradle', '.claude/settings.json'];
const MUST_200 = ['/', '/app/'];

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 220) : '')); } };

function checkStatic(text, label) {
  const names = new Set(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  console.log('\n' + label);
  ok('*.md is excluded, so no doc in this repo deploys', names.has('*.md'));
  const missing = INTERNAL.filter((p) => !names.has(p));
  ok('every internal path is named in .assetsignore', missing.length === 0, 'missing: ' + missing.join(', '));
  return missing.length === 0;
}

(async () => {
  console.log('\ndeploy exclusion: the repo is the deploy, so what is the deny-list missing?');
  const real = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8');
  checkStatic(real, 'static, this checkout');

  if (BASE) {
    console.log('\nlive, ' + BASE);
    const status = async (u) => { try { const r = await fetch(BASE + (u.startsWith('/') ? u : '/' + u), { redirect: 'manual' }); return r.status; } catch (e) { return 0; } };
    const ctrl = await Promise.all(MUST_200.map(status));
    ok('the host is up and serving the app (control, so 404s below mean something)', ctrl.every((s) => s === 200), MUST_200.map((u, i) => u + '=' + ctrl[i]).join(' '));
    for (const u of MUST_404) {
      const s = await status(u);
      ok('production does NOT serve ' + u + ' (' + s + ')', s === 404 || s === 403, 'got ' + s);
    }
  } else {
    console.log('\n(pass a base URL to also ask production; the pre-push suite runs the static half)');
  }

  if (SELF_TEST) {
    console.log('\nself-test');
    const before = fail; const quiet = console.log; console.log = () => {};
    const stripped = real.split('\n').filter((l) => l.trim() !== '.githooks' && l.trim() !== 'test').join('\n');
    checkStatic(stripped, 'scratch');
    console.log = quiet;
    const staged = fail - before; fail = before;
    ok('a deny-list missing .githooks and test goes RED', staged >= 1, staged);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('DEPLOY-EXCLUSION: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})();
