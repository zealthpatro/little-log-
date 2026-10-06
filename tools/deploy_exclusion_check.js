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
 *
 * A named list only covers what someone remembered. So it also walks the tree for KEY-SHAPED files
 * (*.p8, *.key, *.pem, service-account JSON, keystores, .env, provisioning profiles, and any small text
 * file holding a private key) and asks git, with real gitignore semantics, whether .assetsignore keeps
 * each one off the site. The next secret dir goes red the day it appears, not the day someone audits.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');
const BASE = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');

/* Internal and never a parent's business. Each must appear in .assetsignore as a bare name. ios and
   android are gitignored (never tracked, so never deployed); they are listed so the intent is explicit
   if that ever changes, not because they were exposed. The five that WERE exposed on 2026-09-07 were
   .githooks, .github, test and firebase.json. */
const INTERNAL = ['.git', '.claude', '.githooks', '.github', 'tools', 'test', 'workers', 'worker.js',
  'wrangler.toml', 'firestore.rules', 'firebase.json', '.assetsignore', '.gitignore', 'package.json',
  'package-lock.json', 'node_modules', 'serviceAccountKey.json', 'articles-drafts', 'ios', 'android',
  /* Gitignored, so a git-based deploy never sees them, and that is the only reason they were safe. The
     README documents a manual `npx wrangler deploy`, which uploads the FOLDER and reads .assetsignore,
     never .gitignore. On the founder's Mac, credentials/ holds the App Store .p8 keys and a Firebase
     admin service-account JSON, art-src/ holds image-API keys, native-build/ the TestFlight export
     config, and _local/ is scratch that must never ship. Nothing was exposed as of 2026-09-24 (live
     404s checked; every inspectable deploy was git-based), but that was the deploy path, not the list. */
  'credentials', 'art-src', 'native-build', '_local'];
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

/* Key-shaped by name. .p12 and .jks (Apple certificates, Android keystores) and .dev.vars (wrangler's
   local secrets file) are here because they are the same thing under another extension. */
const KEY_NAME = [/\.p8$/i, /\.key$/i, /\.pem$/i, /serviceaccount/i, /service-account/i, /adminsdk/i,
  /\.keystore$/i, /^\.env/i, /\.mobileprovision$/i, /\.p12$/i, /\.jks$/i, /^\.dev\.vars$/];
/* Key-shaped by content, for the service-account JSON somebody renamed. Small text files only. */
const KEY_BYTES = /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:/;
const TEXTY = new Set(['', '.json', '.txt', '.pem', '.key', '.p8', '.env', '.vars', '.plist', '.xml',
  '.yml', '.yaml', '.ini', '.cfg', '.conf', '.properties', '.toml', '.js', '.mjs', '.cjs', '.ts', '.html', '.py', '.sh']);
/* Not walked, for speed (node_modules alone is 40,000 entries). Each one is itself asked of
   .assetsignore below, so skipping one can never hide an uncovered key. */
const SKIP_NAME = new Set(['.git', 'node_modules']);
const SKIP_PATH = new Set(['.claude/worktrees']);

function walk(root) {
  const hits = [], skipped = [], stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_NAME.has(e.name) || SKIP_PATH.has(r)) skipped.push(r + '/');
        else stack.push(r);
        continue;
      }
      // Files, and symlinks by their own name (never followed).
      if (KEY_NAME.some((re) => re.test(e.name))) { hits.push({ rel: r, why: 'name' }); continue; }
      if (!e.isFile() || !TEXTY.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const abs = path.join(root, r);
        if (fs.statSync(abs).size <= 512 * 1024 && KEY_BYTES.test(fs.readFileSync(abs, 'utf8'))) hits.push({ rel: r, why: 'a private key inside' });
      } catch (err) {}
    }
  }
  return { hits, skipped };
}

/* git with nothing of this machine's in it. Inside a hook git exports GIT_DIR and friends, which
   would point check-ignore at the REAL repo and its .gitignore (which ignores *.p8): a false pass. */
function cleanGitEnv() {
  const env = {};
  for (const k of Object.keys(process.env)) if (!/^GIT_/.test(k)) env[k] = process.env[k];
  return Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull });
}
/* Which of `rels` would .assetsignore keep off the site? Asked of `git check-ignore --no-index` in a
   throwaway repo whose ONLY ignore file is a copy of .assetsignore: no .gitignore, an empty
   info/exclude, no global excludes. Wrangler reads .assetsignore with gitignore rules, so this is
   the same question wrangler asks. Returns path -> the pattern that covers it, or null. */
function coverage(ignoreText, rels) {
  const out = new Map(rels.map((r) => [r, null]));
  if (!rels.length) return out;
  const env = cleanGitEnv();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-assetsignore-'));
  const init = spawnSync('git', ['init', '-q', tmp], { env });
  if (init.status !== 0) throw new Error('git init failed: ' + init.stderr);
  fs.writeFileSync(path.join(tmp, '.gitignore'), ignoreText);
  fs.writeFileSync(path.join(tmp, '.git', 'info', 'exclude'), '');
  const r = spawnSync('git', ['-c', 'core.excludesFile=' + os.devNull, 'check-ignore', '--no-index', '--stdin', '-z', '-v'],
    { cwd: tmp, env, input: rels.join('\0') + '\0' });
  // 0: some matched, 1: none matched, anything else: git itself failed, and that must not read as "none".
  if (r.status !== 0 && r.status !== 1) throw new Error('git check-ignore failed (' + r.status + '): ' + r.stderr);
  const f = r.stdout.toString().split('\0');
  for (let i = 0; i + 3 < f.length; i += 4) if (!f[i + 2].startsWith('!')) out.set(f[i + 3], f[i + 2]);
  return out;
}

/* Where a manual deploy could run from: this checkout, and the primary one when this is a worktree.
   The keys live only in the primary (they are gitignored, so no worktree has them), and a gate that
   only looked here would never see them from the worktrees every push comes from. */
function roots() {
  const out = [path.resolve(ROOT)];
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { env: cleanGitEnv() });
  if (r.status === 0) {
    const main = path.dirname(r.stdout.toString().trim());
    try { if (fs.realpathSync(main) !== fs.realpathSync(ROOT) && fs.existsSync(path.join(main, '.assetsignore'))) out.push(main); } catch (e) {}
  }
  return out;
}

function checkKeys(ignoreText, root, label) {
  const { hits, skipped } = walk(root);
  const cov = coverage(ignoreText, hits.map((h) => h.rel).concat(skipped));
  console.log('\n' + label);
  const bare = skipped.filter((s) => !cov.get(s));
  ok('every directory this walk skips is itself kept off the site', bare.length === 0, 'skipped but NOT in .assetsignore: ' + bare.join(', '));
  const open = hits.filter((h) => !cov.get(h.rel));
  open.forEach((h) => ok('kept off the site: ' + h.rel + ' (key-shaped by ' + h.why + ')', false,
    'add its directory to .assetsignore (and INTERNAL above), or move it out of the repo'));
  if (!open.length) {
    const by = {};
    hits.forEach((h) => { const p = cov.get(h.rel); by[p] = (by[p] || 0) + 1; });
    const how = Object.keys(by).map((p) => p + ': ' + by[p]).join(', ');
    ok(hits.length ? hits.length + ' key-shaped files, every one kept off the site (' + how + ')' : 'no key-shaped files here', true);
  }
  return open.map((h) => h.rel);
}

(async () => {
  console.log('\ndeploy exclusion: the repo is the deploy, so what is the deny-list missing?');
  const real = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8');
  checkStatic(real, 'static, this checkout');
  for (const r of roots()) {
    try { checkKeys(real, r, 'key-shaped files, ' + r + (r === path.resolve(ROOT) ? '' : ' (the primary checkout, where the gitignored keys actually live)')); }
    catch (e) { ok('the key-shape walk ran in ' + r, false, e.message); }
  }

  if (BASE) {
    console.log('\nlive, ' + BASE);
    const status = async (u) => { try { const r = await fetch(BASE + (u.startsWith('/') ? u : '/' + u), { redirect: 'manual' }); return r.status; } catch (e) { return 0; } };
    const ctrl = await Promise.all(MUST_200.map(status));
    ok('the host is up and serving the app (control, so 404s below mean something)', ctrl.every((s) => s === 200), MUST_200.map((u, i) => u + '=' + ctrl[i]).join(' '));
    for (const u of MUST_404) {
      const s = await status(u);
      /* The HOST goes in the label, not the word "production". This gate was wired to the local
         server for months and every line still read "production does NOT serve ...", which is how a
         localhost result got reported as a production exposure. Name what you actually asked. */
      ok(BASE + ' does NOT serve ' + u + ' (' + s + ')', s === 404 || s === 403, 'got ' + s);
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

    /* Plant keys where .assetsignore has never looked, in a scratch tree carrying the real
       .assetsignore. Three decoys would each ignore them if git were allowed to ask: the scratch
       tree's own .gitignore, a global excludes file (via XDG_CONFIG_HOME), and a GIT_DIR like the
       one a hook exports. Only .assetsignore may answer, so this must still go red. */
    const scratch = (files) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-keyshape-'));
      for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
        fs.writeFileSync(path.join(d, rel), body);
      }
      return d;
    };
    const PK = '-----BEGIN ' + 'PRIVATE KEY-----\\nnot a key\\n-----END ' + 'PRIVATE KEY-----\\n';
    const tree = scratch({
      '.assetsignore': real,
      '.gitignore': 'unlisted-secrets/\n*.p8\n*.json\n',
      'unlisted-secrets/AuthKey_SELFTEST.p8': 'not a key',
      'unlisted-secrets/renamed.json': '{"type": "service_account", "private' + '_key": "' + PK + '"}',
      'credentials/AuthKey_SELFTEST.p8': 'not a key',
      'app/notes.txt': 'nothing here',
    });
    const xdg = scratch({ 'git/ignore': 'unlisted-secrets/\n*.p8\n*.json\n' });
    const decoy = scratch({});
    spawnSync('git', ['init', '-q', decoy], { env: cleanGitEnv() });
    fs.writeFileSync(path.join(decoy, '.git', 'info', 'exclude'), 'unlisted-secrets/\n*.p8\n*.json\n');
    const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GIT_DIR: process.env.GIT_DIR };
    process.env.XDG_CONFIG_HOME = xdg; process.env.GIT_DIR = path.join(decoy, '.git');
    let open = null, err = null;
    console.log = () => {};
    const before2 = fail;
    try { open = checkKeys(real, tree, 'scratch'); } catch (e) { err = e.message; }
    fail = before2; console.log = quiet;
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    open = open || [];
    ok('a .p8 planted in an unlisted dir goes RED, though three decoy ignore files cover it', open.includes('unlisted-secrets/AuthKey_SELFTEST.p8'), err || open);
    ok('so does a renamed service-account JSON, found by what is inside it', open.includes('unlisted-secrets/renamed.json'), err || open);
    ok('the same .p8 under credentials/ is kept off the site', !open.includes('credentials/AuthKey_SELFTEST.p8') && !err, err || open);
    ok('and nothing else is flagged', open.length === 2, err || open);

    /* The walk skips node_modules for speed. That is only safe while .assetsignore covers it. */
    const deps = scratch({ 'node_modules/pkg/index.js': '' });
    const noDeps = real.split('\n').filter((l) => l.trim() !== 'node_modules').join('\n');
    console.log = () => {};
    const before3 = fail; checkKeys(noDeps, deps, 'scratch'); const staged3 = fail - before3;
    const before4 = fail; checkKeys(real, deps, 'scratch'); const staged4 = fail - before4;
    fail = before3; console.log = quiet;
    ok('a skipped node_modules that .assetsignore stops covering goes RED', staged3 >= 1, staged3);
    ok('and is fine while it does', staged4 === 0, staged4);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('DEPLOY-EXCLUSION: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})();
