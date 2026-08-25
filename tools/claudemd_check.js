#!/usr/bin/env node
/* Gate for the repo-root CLAUDE.md — the context file every Claude session loads before
 * touching anything else.
 *
 * A context file is the one document that is read on every single session and maintained on
 * none of them, so it rots in two directions: pointers go stale (a renamed tool gets followed
 * into a 404) and the file silently grows into a filing cabinet nobody can find the front desk
 * in. Both failure modes are checkable, so per house rule they are checked, not remembered:
 *   1. every repo path CLAUDE.md names must exist in THIS tree,
 *   2. the file stays under MAX_LINES (depth belongs in the docs it points to),
 *   3. .assetsignore keeps excluding it — [assets] directory="./" deploys the whole repo, so
 *      losing that line would publish the founder's working notes to the public site.
 *
 *   node tools/claudemd_check.js               check the real file
 *   node tools/claudemd_check.js --self-test   first prove each check can go RED, then check
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_LINES = 60;
const EXT = /\.(md|js|py|rules|toml|css|html|sh|json|xml|txt)$/;
// Gitignored by design and absent in fresh worktrees and CI checkouts, but still worth naming
// in CLAUDE.md (the symlink instruction is the whole point of mentioning it).
const SKIP = new Set(['tools/node_modules']);

// Pull the path-shaped tokens out of prose: anything with a slash, a known file extension, or
// a dotfile name. Globs, URLs, shell substitutions and relative escapes are prose, not paths.
function pathTokens(text) {
  const out = new Set();
  for (const raw of text.split(/[\s`"'()]+/)) {
    let t = raw.replace(/[.,:;!?—]+$/, '');
    if (!t || t.includes('*') || t.includes('..') || t.includes('$') || /^https?:/.test(t)) continue;
    if (t.startsWith('/')) t = t.slice(1); // a site URL like /app/ maps to a repo dir
    if (!t) continue;
    if (!(t.includes('/') || EXT.test(t) || /^\.[A-Za-z][A-Za-z0-9_.]*$/.test(t))) continue;
    out.add(t.replace(/\/$/, ''));
  }
  return [...out];
}

function checkDoc(text, assetsignore) {
  const fails = [];
  const lines = text.split('\n').length;
  if (lines > MAX_LINES) {
    fails.push(`CLAUDE.md is ${lines} lines (cap ${MAX_LINES}) — front desk, not filing cabinet; move the detail into a doc it points to`);
  }
  for (const t of pathTokens(text)) {
    if (SKIP.has(t)) continue;
    if (!fs.existsSync(path.join(ROOT, t))) {
      fails.push(`CLAUDE.md names "${t}" which does not exist in this tree — stale pointers get followed`);
    }
  }
  if (!/^\s*(\*\.md|CLAUDE\.md)\s*$/m.test(assetsignore)) {
    fails.push('.assetsignore no longer excludes CLAUDE.md ("*.md" or "CLAUDE.md" line) — the file would deploy to the public site');
  }
  return fails;
}

// Prove each check can go red before trusting its green (a gate nobody has watched fail
// proves nothing — see docs/postmortems for the preg-4 lesson).
function selfTest(realAssetsignore) {
  const good = 'DESIGN.md and tools/gates.js\n';
  const cases = [
    ['fabricated path goes RED', 'see tools/this_should_go_red_check.js\n', realAssetsignore, true],
    ['line-cap breach goes RED', new Array(MAX_LINES + 2).join('x\n'), realAssetsignore, true],
    ['lost deploy exclusion goes RED', good, 'nothing-relevant-here\n', true],
    ['clean doc stays green', good, realAssetsignore, false],
  ];
  let ok = true;
  for (const [label, doc, assets, wantFail] of cases) {
    const failed = checkDoc(doc, assets).length > 0;
    const pass = failed === wantFail;
    console.log(`  self-test ${pass ? 'ok ' : 'BAD'} — ${label}`);
    if (!pass) ok = false;
  }
  return ok;
}

(function main() {
  const selfTestMode = process.argv.includes('--self-test');
  const mdPath = path.join(ROOT, 'CLAUDE.md');
  const assetsPath = path.join(ROOT, '.assetsignore');
  const assetsignore = fs.existsSync(assetsPath) ? fs.readFileSync(assetsPath, 'utf8') : '';

  if (selfTestMode && !selfTest(assetsignore)) {
    console.error('claude-md: FAIL — self-test broken; a gate that cannot go red proves nothing');
    process.exit(1);
  }
  if (!fs.existsSync(mdPath)) {
    console.error('claude-md: FAIL — no CLAUDE.md at the repo root');
    process.exit(1);
  }
  const text = fs.readFileSync(mdPath, 'utf8');
  const fails = checkDoc(text, assetsignore);
  if (fails.length) {
    for (const f of fails) console.error('  ✗ ' + f);
    console.error('claude-md: FAIL');
    process.exit(1);
  }
  console.log(`claude-md: PASS — ${text.split('\n').length} lines (cap ${MAX_LINES}), ${pathTokens(text).filter((t) => !SKIP.has(t)).length} named paths verified, deploy exclusion intact${selfTestMode ? ', self-test ok' : ''}`);
})();
