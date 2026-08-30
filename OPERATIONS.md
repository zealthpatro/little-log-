# Cubby — Operations & quality (right-sized for 0 → 10k active / 3k paid)

Deliberately lean. This is startup hygiene, not enterprise. The full CI/lighthouse/a11y/branch-protection
program is intentionally deferred until there's scale to justify it.

## Before you push (the gate)
The pre-commit hook (`.githooks/pre-commit`, wired via `git config core.hooksPath .githooks`) already:
- blocks an `app/*` change that didn't bump the service-worker `CACHE` in `app/sw.js`;
- `node --check`s every staged `app/*.js`.

Run these by hand before an **app** push (catches what the hook can't):
```sh
node tools/serve.js &              # serve the repo on :8080
node tools/validate.js             # JSON-LD parses, sitemap balanced, FAQ schema==visible lockstep
node tools/smoke.js                # fails on uncaught error / missing global (base url or /app/, both work)
node tools/uitest.js               # authed UI: dead taps + the contrast gate, both themes
node tools/perf_check.js           # jitter gate: render budgets on a real 4-month history
node tools/guide_test.js           # the guide + Notes lane: age bands, privacy gates, loss safety
node tools/dosecal_test.js         # the dose .ics (bounded, cancellable) + multi-baby dose alerts
node tools/vaxcard_test.js         # vaccine-card import: patch-only, never invents a dose, on-device
node tools/noteshome_test.js       # the Notes lane: bottom by default, up only for an unread note
node tools/offline_gate.js         # the connectivity states + which offline messages may promise a queue
node tools/homelogs_gate.js        # what home offers, and that the parent decides it (per person, per stage)
node tools/stack_check.js          # vertical rhythm: 16 / 12 / 8 / 2 across ten surfaces, both themes
node tools/rerender_gate.js        # entering a screen animates; a background sync repainting it does not
cd test && node preg-tick-race.test.js   # the antenatal tick survives a snapshot landing mid-push (needs Java)
cd test && node ios-signin-code.test.js  # an installed iOS app signs in WITHOUT leaving its container (needs Java)
node tools/type_check.js           # the type contract: who may wear the handwriting face, heading rank
node tools/sitesw_gate.js          # the ROOT service worker: caches no content, bypasses /app/, offline page
node tools/sitesw_gate.js https://little-cubby.com   # AND against the live host, AFTER deploying. Not optional.
node tools/thirdparty_gate.js       # the "no third-party trackers" promise, checked in a real browser
node tools/signin_live_check.js     # can a person ACTUALLY get a code from prod and sign in with it
node tools/shot.js http://localhost:8080/<page>/ /tmp/x.png 390 full   # eyeball any page (see tools/shot.js)
```
Working in a git worktree? `serve.js` takes `PORT=8099` and every gate takes the base URL as its
first argument (`node tools/guide_test.js http://localhost:8099`). Otherwise the second `serve.js`
dies on EADDRINUSE in the background and the gates quietly grade the **other** checkout's code, which
reads exactly like a fix that does not work. `serve.js` prints the directory it is serving: read it.

`tools/uitest.js` and `tools/perf_check.js` both drive the logged-in app through the localhost-only
`?e2e=1` boot hook. **Run perf_check after anything that touches rendering.** It seeds four months of
real logging (2,500+ events) and measures at 4x CPU throttle, because the failure it exists to catch is
invisible in a screenshot: the app spent months rebuilding its whole shell on every render and building
every event ever logged into the Log tab, which is ~500ms of frozen phone per repaint. Budgets are ~4x
the measured numbers, so it fails on a regression in kind (full-shell rebuild, unwindowed list,
per-second document sweep), not on laptop noise.

## If a push breaks prod — rollback
- **Site/app (Cloudflare):** the dashboard keeps every deployment → Deployments → **Rollback** to the last good one (instant). Or `git revert` + push.
- **Service worker stuck:** bump `app/sw.js` CACHE and redeploy; the SW is network-first for HTML/JS so a bump clears stale assets.
- **Firestore rules:** the pre-hardening rules are the parent of commit `c2e3389` in git history — paste that back into the Firebase console (rules deploy is NOT via git push).

## Scaling to 10k (FOUNDER actions — needed before a few hundred active users)
1. **Firestore Spark → Blaze.** Spark caps at ~50k reads + 20k writes **per day**; the app's real-time
   `onSnapshot` listeners burn reads continuously, so the free tier breaks at a few *hundred* active users and
   the app stops working. Upgrade to Blaze (pay-as-you-go) early and set a **budget alert**. At 3k subs
   (~$27k MRR) the backend bill (~$50–150/mo) is <1% of revenue — do not migrate for cost.
2. **Backups.** Blaze unlocks scheduled Firestore exports — turn one on. It's irreplaceable family health data.
3. **Recommended next build (mine):** lean first-party **error monitoring** — `window.onerror` +
   `unhandledrejection` → POST to the Worker → a table in the existing `cubby-games` D1 (no new infra). So you
   *see* breakage across users instead of waiting for a report.

## Portability (cheap insurance, no work now)
The data layer is abstracted: `index.html` has a `Store` interface and all Firebase lives in
`app/store-firebase.js`. Keep it that way (no `firebase`/`onSnapshot` calls leaking into `index.html`). That
keeps a future backend swap (e.g. to Cloudflare D1) a contained job rather than a rewrite. Don't pre-build for it.

## Tooling map
- `tools/serve.js` — local static server (:8080)
- `tools/shot.js` — headless screenshots (the mcp preview tool is broken here; uses the system Chrome)
- `tools/smoke.js` — app load smoke test
- `tools/validate.js` — marketing static validation
- `tools/uitest.js` — authed-UI harness: dead taps + WCAG contrast in both themes (`?e2e=1`)
- `tools/perf_check.js` — jitter gate: render/tick budgets on a seeded 4-month history (`?e2e=1`)
- `tools/guide_test.js` — "What to log, and why" + the Notes lane: which chapters each age gets, the
  owner-only Mood gate, loss safety, and the four Notes bugs (`?e2e=1`)
- `tools/dosecal_test.js` — the medicine calendar course (the only reminder that reaches a closed app
  today) and the multi-baby dose alert, incl. that a dose lands on the right child (`?e2e=1`)
- `tools/vaxcard_test.js` — the vaccine-card import: that it patches rows and never creates them,
  never sets `missed`, never writes events, and refuses future / pre-birth dates (`?e2e=1`)
- `tools/noteshome_test.js` — the Notes lane's place on home: bottom by default, above Quick log only
  while another member has left something unread (to the circle or to you by name), back down when it
  is read; the read-marker per member in localStorage as a set of note **ids** rather than a high-water
  timestamp, and never in the shared settings blob (`?e2e=1`)
- `tools/gen_art.js` — the illustration generator. Prompts for the birth poster's sixteen pieces are
  tracked and runnable in `docs/poster-art-jobs.json`; `docs/poster-art-brief.md` says which clauses
  in them are load-bearing (pure white ground, no numerals, generous margin) and why. `art-src/` is
  gitignored because it holds the API keys, so nothing in it counts as a record.
**OPEN, needs the founder: Cloudflare Web Analytics is injecting a third-party tracker into every page,
including `/app/`.** `static.cloudflareinsights.com/beacon.min.js` with a per-zone token, added to every
HTML response served to a browser. Nothing in the repo asks for it, `curl` cannot see it (injection is
browser-targeted), and it directly contradicts the published promise on `/privacy/`, the home page, the
FAQ, `app/index.html` and `articles/cubby-privacy/`. It cannot be disabled from `wrangler.toml`: it is
Cloudflare dashboard -> the `cubby` project -> Settings -> Web Analytics -> turn off automatic setup.
Until then `tools/thirdparty_gate.js` fails, which is the honest state.

**Run `tools/sitesw_gate.js` against the LIVE host after every deploy that touches `/sw.js` or
`/offline.html`.** Passing locally is not evidence. Cloudflare answers `/offline.html` with a **307 to
`/offline`**, and `tools/serve.js` does not, so the first version of this shipped green on 41 local
assertions and failed in production with `ERR_FAILED`: the precache was correct, but the stored response
carried `redirected: true`, and `respondWith()` of a redirected response to a navigation (whose redirect
mode is `manual`) throws. The worker now stores a reconstructed 200 so no host's URL rewriting can
reintroduce it, and the gate asserts `redirected === false` — but only the live run exercises the
redirect at all.

**Rolling back the root service worker.** Reverting `install.js` alone does NOT undo it. A browser that
already registered `/sw.js` keeps that worker until it is replaced or unregistered; removing the
registration line only stops NEW visitors picking it up. The rollback has to ship a replacement `/sw.js`
that unregisters itself:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => { e.waitUntil(
  caches.keys()
    .then((k) => Promise.all(k.filter((n) => n.startsWith('cubby-site-')).map((n) => caches.delete(n))))
    .then(() => self.registration.unregister())); });
```

Note the filter. The tombstone that used to live at this path deleted **every** cache it could
enumerate, and caches are per-origin: shipping that version today would take the app's `little-log-v*`
precache with it and leave every installed PWA unable to open offline. Copy the snippet above, not the
one in the git history.

- `tools/stack_check.js` — the stack contract (DESIGN.md A3.2), measured on the RENDERED page across **ten
  surfaces** in both themes: every gap between blocks is 16, a heading to its content 12, a row to the next
  row in one list 8, a thing to its own caption 2. Exists because none of these bugs are visible in CSS —
  `gap` is not a margin (the quick-log grid butted into the next card at 0px), adjacent margins collapse
  to the larger (a list's 8px row rhythm beat a section heading's 6px top on five Health headings), and
  `--stack` sat unused while four rules set 18 by hand. `KNOWN` is now **empty** and should stay so.

  Three things it learned on 2026-08-11, each of which had been hiding real violations:

  1. **Sub-tabs are surfaces.** It walked six tabs; Album and Health each render three different trees, so
     it was measuring one of eight and naming it "album". Widening it to ten immediately found four more
     violations. Every step now sets its own sub-tab explicitly, because `logTab`/`albumTab`/`healthTab`
     persist — `go('log')` after the rituals step was rendering rituals while the report said "log", and
     the second theme pass inherited whatever the first left behind.
  2. **An empty fixture is not coverage.** `health/illness` passed only because the seed had no illness, so
     none of the active-episode tree rendered. Seeding one active and one past illness exposed a 6px gap
     under the Mark recovered button that had shipped.
  3. **The exception list matched on tab+from+to and ignored the recorded px.** So once somebody *fixed* a
     listed gap, the entry went on matching, the honesty check stayed quiet, and the now-correct pair was
     skipped forever instead of being asserted. The gap is part of the key now.

  It needs `protocolTimeout` raised at launch: the Moments sub-tab builds the 289-card journey library and
  a cold run blew past puppeteer's 180s default, which surfaces as a `ProtocolError` that reads like a
  broken page rather than a slow one.

  **Do not point it at production.** `stack_check`, `uitest`, `perf_check`, `guide_test` and every other
  authed gate boot the signed-in shell through the local E2E path, which is hostname-guarded to
  `localhost`/`127.0.0.1` (`app/store-firebase.js:2855`) precisely so a query parameter can never bypass
  auth on a real host. Run against `https://little-cubby.com` they get the signed-out landing, no
  `#scroll`, and a `Cannot read properties of null` that looks like a product bug and is not one. If you
  ever find yourself loosening that hostname guard to make a gate run against prod, stop: the guard is the
  point. Verify a deploy by confirming the shipped bytes (a string unique to the change, plus the sw
  version) and trust the measurement taken on the identical committed code locally. The gates that DO run
  against the live host are `sitesw_gate` and `thirdparty_gate`, because neither needs to be signed in.
- `tools/type_check.js` — the type contract (DESIGN.md A3.1): the handwriting face means a person wrote
  this, so it is allowlisted (one entry, `.note-card .nt-by`), and in a block where Cubby is speaking its
  heading is the largest thing in it. Sizes are compared in **cap height**, not `px`, because the three
  faces differ at the same size and that is the blind spot the bug lived in. Both gates put the original
  bug back and require themselves to catch it.
- `tools/thirdparty_gate.js` — walks six live surfaces in a real browser and fails on any request to an
  origin the product does not need to function. Cubby publishes "No third-party trackers" on its home
  page, its privacy page, the FAQ, **inside the app**, and in an article comparing it to a competitor on
  exactly that point, and a source scan cannot verify it: nothing in the repo loads a tracker, and the
  promise can still be broken above the code by a host injecting a script into every HTML response.
  **CURRENTLY RED**, and correctly so — see the open item below.
- `tools/sitesw_gate.js` — the ROOT service worker (`/sw.js`), which serves `/offline.html` when a page
  on the marketing site or one of the ~661 articles cannot be reached. Mostly assertions about what it
  must REFUSE to do: cache no content (one precache entry, no article), navigations only, `/app/` and
  `/g/` passed straight through, activate deleting only `cubby-site-*` caches (the stub it replaced
  deleted every cache on the origin, which from the root would wipe the app's precache), and a 404
  passed through rather than dressed up as being offline. Takes the WORKER's network target offline over
  CDP, because `page.setOfflineMode()` only touches the page's session and a worker's `fetch()` sails
  straight past it — without that the test proves nothing. **Bump `CACHE` in `/sw.js` whenever
  `offline.html` changes**, or existing browsers keep the old page forever.
- `tools/homelogs_gate.js` — the Quick log row on home: that pump is not in the default set, that the
  picker still offers it and choosing it sticks, that home and the round button read the SAME per-user
  list so they cannot disagree, that choosing nothing leaves a door rather than a blank space, and that
  the list is keyed by uid in localStorage rather than the shared blob (`?e2e=1`)
- `tools/offline_gate.js` — the connectivity states: that the SDK-failure card paints (including for a
  PARTIAL SDK load), that its artwork is precached and cut out, that the guest games page survives a
  poll blip without wiping a guest's game, and the honesty line on offline copy — "Cubby will pick this
  up when you're back" is opt-in per call site, because it is a guarantee for a queued write and a lie
  for a sign-in link (`?e2e=1`)
- `tools/cutout_white.py` — art painted on white -> a cut-out with an un-multiplied edge. Needed for any
  piece taken from `art-src/` into the app UI: `--spot-paper` is transparent in Night, so a white ground
  becomes a glaring disc. See docs/poster-art-brief.md
- `tools/gen_sitemap.py` — stamps article lastmods
- `test/` — Firestore rules emulator tests (need Java): `cd test && npm i && npm run test:rules`,
  and `npm run test:invitelink` for the tokenised invite links. **Both must be green before
  publishing rules**, and rules do NOT deploy via `git push` — they are published separately:

  ```sh
  npx firebase-tools deploy --only firestore:rules
  ```

  That used to fail with **"No currently active project"** every single time, because `.firebaserc`
  was never committed — it is not gitignored, it simply was not there, so the CLI had no default and
  every publish needed `--project little-log-a9caa` typed from memory. It is committed now. A
  publishing step that fails on a fresh checkout is a publishing step people skip, and these are the
  rules that keep one family's health record out of another family's hands.

  If `java -version` reports "Unable to locate a Java Runtime", install a JDK first
  (`brew install --cask temurin`); the macOS `/usr/bin/java` is only a stub.
