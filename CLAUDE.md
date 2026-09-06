# Cubby (little-log-pwa) — read me first

One calm, private place for a parent to track pregnancy and baby life. PWA at app/
(entry URL /app/), marketing site at the repo root, one Cloudflare Worker (worker.js)
for sign-in mail, push crons and the tiny APIs. Deploy = push to main; Cloudflare
serves this whole directory, and .assetsignore (*.md) is why root docs like this one
never reach production.

## Verify against THIS tree, then ship
- `node tools/gates.js` runs every gate against this checkout on a port it picks
  itself (`--live` adds production checks, `--emulator` the Firestore rules suites,
  `--only=name` one gate). A browser gate run bare may grade a DIFFERENT checkout —
  always pass an explicit base URL, or let tools/gates.js do it.
- Local preview: `PORT=8123 node tools/serve.js`. It serves the repo that CONTAINS it
  (root from __dirname) whatever directory you run it from; a scratch tree must run its
  OWN copy, and curl the changed string before trusting any verdict from it.
- Screenshots: `node tools/shot.js`, then actually read the PNG. The app scrolls
  inside `#scroll`, so a full-page screenshot is only the viewport — walk every tab
  and check 320px width before calling a layout fixed.
- A gate's green is only trusted after you have watched it go red once (break it on
  purpose, or run its `--self-test`). Never report a pass you have not seen fail.
- Ship = verify here → commit → push main → confirm on the live site (asset cache
  can lag ~3 min) → keep the three surfaces in step: PWA, native wrapper, marketing.

## New worktree? Do this first
Worktrees share the repo but not tools/node_modules, so every browser gate dies
until you link it:

    ln -s "$(git rev-parse --git-common-dir)/../tools/node_modules" tools/node_modules

## Hard rules (each has a reason; most have a gate)
- No third-party ad or analytics pixels, ever. Growth measurement is first-party
  (tools/thirdparty_gate.js checks production; five public pages promise it).
- Never long-cache app assets; caching headers live only in `_headers`.
- Never remove a live page or feature without the founder's explicit OK.
- The household doc is a whole-field overwrite: read-merge-write, never blind-set
  (test/blob-clobber.test.js is the gate; an invite once ate a field this way).
- Customer-facing copy: warm, brief, second person, sentence case, no em-dashes.
  DESIGN.md §A1 Personality and §A7 Voice are the law here.
- Secrets never enter the repo; Worker secrets go in via `wrangler secret put`.
- Never delete anything, local included (worktrees, branches, dirs), without a yes; run
  ListAgents and message live sessions first. A directory name says nothing about who is in it.
- Clock-pinned gates pin the DAY as well as the hour; two month-boundary flakes in one week.
- A test not wired into tools/gates.js does not exist: wire it or delete it. Five incident
  tests were orphaned, one of them red, until someone looked.

## Where the depth lives
- DESIGN.md — product design system and voice. design/MARKETING-SYSTEM.md — the
  marketing-site system.
- HANDOFF.md — master build spec. docs/postmortems/ — every P0 or P1 gets a 5-whys.
- tools/ — every gate and generator. Hooks are TRACKED in .githooks/ (core.hooksPath
  points there, so .git/hooks is never read): pre-commit guards SW bumps, JS syntax and
  page SEO; pre-push runs the full suite, because push = deploy. tools/hooks_check.js
  asserts git resolves both — a hook installed elsewhere is a hook that never runs.
- firestore.rules, storage.rules — security rules; test/ holds their suites.

This file is validated by `node tools/claudemd_check.js` (wired into tools/gates.js):
every path it names must exist and it stays under 60 lines. Front desk, not filing
cabinet — details go in the docs above, corrections go where they can block: a gate.
