#!/usr/bin/env node
/* Which of these staged files does the service worker PRECACHE?
 *
 * Reads staged paths on stdin, prints the ones listed in app/sw.js's ASSETS, exits 0 either way.
 * .githooks/pre-commit uses it to decide whether a CACHE bump is required.
 *
 * It replaces a hand-written `^app/.*\.(js|html|css)$`, which was not wrong so much as unable to
 * stay right: ASSETS also precaches app/manifest.webmanifest, app/spot-art/offline_balloon.webp and
 * five PNGs under /icons, none of which that pattern matched. A change to any of them shipped to new
 * installs and never reached existing ones, because their service worker had no reason to refetch.
 * Found on 2026-09-26 while adding `shortcuts` to the manifest: the change would have gone live and
 * reached nobody who already had Cubby installed.
 *
 * Deriving the list instead of restating it means the precache and the guard cannot drift apart.
 * tools/hooks_check.js asserts the hook actually calls this, and proves it both ways.
 *
 *   printf '%s\n' app/manifest.webmanifest | node tools/sw_cache_guard.js   ->  app/manifest.webmanifest
 *   printf '%s\n' README.md               | node tools/sw_cache_guard.js   ->  (nothing)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function precached() {
  const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  const m = /const ASSETS = \[([\s\S]*?)\n\];/.exec(sw);
  if (!m) return null;                                   // shape changed: say so rather than pass silently
  const body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')                    // block comments, which contain apostrophes
    .split('\n').map((l) => l.split('//')[0]).join('\n'); // line comments, same
  return new Set(
    (body.match(/'(\/[^']+)'/g) || [])
      .map((s) => s.slice(1, -1))
      .map((u) => (u === '/app/' ? 'app/index.html' : u.replace(/^\//, '')))
  );
}

const set = precached();
if (!set) { console.error('sw_cache_guard: could not read ASSETS out of app/sw.js'); process.exit(2); }

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  input.split('\n').map((s) => s.trim()).filter(Boolean).forEach((f) => {
    if (f === 'app/sw.js') return;                       // the bump lives here; it is never its own trigger
    if (set.has(f)) console.log(f);
  });
});
