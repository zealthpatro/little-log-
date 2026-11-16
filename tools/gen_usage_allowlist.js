#!/usr/bin/env node
/* Writes app/usage-allowlist.js, the phone's copy of the usage allowlist, from workers/usage/core.mjs.
 *
 *   node tools/gen_usage_allowlist.js           write it
 *   node tools/gen_usage_allowlist.js --check   exit 1 if the committed file differs (the tracking-plan gate)
 *
 * The tracker cannot import core.mjs (workers/ is not served), so the list is copied, and the copy is held
 * equal by a gate rather than by memory. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'app', 'usage-allowlist.js');
(async () => {
  const core = await import('file://' + path.join(ROOT, 'workers', 'usage', 'core.mjs'));
  const want = core.allowlistSource();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
    if (have !== want) { console.log('USAGE-ALLOWLIST: FAIL (app/usage-allowlist.js differs from core.mjs; run node tools/gen_usage_allowlist.js)'); process.exit(1); }
    console.log('USAGE-ALLOWLIST: PASS'); return;
  }
  fs.writeFileSync(FILE, want);
  console.log('wrote app/usage-allowlist.js');
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
