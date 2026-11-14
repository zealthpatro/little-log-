# Cubby Ops, phase 1: implementation plan

**Spec:** `docs/superpowers/specs/2026-11-13-admin-dashboard-design.md` (founder-approved 13 Nov 2026; every
recommended answer F1 to F17 accepted: "all good"). This plan covers **phase 1 only** (§17): the separate
admin Worker, read-only, behind Cloudflare Access with the Access JWT re-checked on every request, the
access log shipping with the very first page, noindex and no-store everywhere, the read-only service
account with its daily read budget, and the phase-1 screens. Nothing that measures families, no notes,
no erasure, and **the app does not change**.

**Founder facts that shape it:** Workers plan is Free (F10: 50 subrequests a run, small CPU, so the daily
pass is chunked); the Android app is not on Google Play (F16: nothing here depends on it); exactly one
person may sign in, and his address lives only in the Access policy and in the `ADMIN_PEOPLE` secret.

**Decisions now settled by the accepted answers (no longer defaults):** F4, a pregnancy shows as
"Pregnant" without weeks, and "Trying" is only ever a count in the overview's stage bars (so the Records
stage filter offers Any, Pregnant, Baby, No stage shared; never Trying). F7, the manual-access form takes
a reason code and an optional `R-0001` number, no free text. F15, the access log ships with the first page.

## Ground rules for every task

- Red first. Each task writes its assertion, runs it against the tree **without** the code (or a mutated
  copy) and records the red line, then writes the code and records the green line. A green that was never
  red is not reported.
- A test not in `tools/gates.js` does not exist: every test file below is wired in the task that adds it.
- Firestore REST shapes are proven on the **real emulator** (task 15), never only on the recorder.
- Sample data only: names from the canvas (Maya, Rosa, Usha, Arjun, Priya, Leena, Sam, Aisha, Nora),
  `example.com` addresses, ids shaped `UID_sample_*` and `HHID_sample_*`. No real person, address or uid.
- Ports 7701 to 7739 only. Wrangler only for `dev --local` and config validation; never deploy, never a
  remote D1, never a secret, never the Cloudflare API.

## File map

```
workers/shared/fs-values.mjs     Firestore REST value <-> plain JS (pure)
workers/shared/google-auth.mjs   service-account token minting, cached per isolate
workers/shared/fs-read.mjs       THE masked reader: §5.1 allowlist, a mask on every call, the hold reader
workers/shared/auth-read.mjs     Identity Toolkit accounts:batchGet, kept fields only (§4.3)
workers/admin/wrangler.toml      the separate Worker: own name, route, D1, no [assets], no workers.dev
workers/admin/migrations/0001_init.sql   §9.2 schema (cubby-admin)
workers/admin/src/index.mjs      default export {fetch, scheduled}; createHandler(deps) for tests
workers/admin/src/config.mjs     secrets parsed, fail closed (S3, S4)
workers/admin/src/access.mjs     Access JWT re-check (S1, S2), certs cache, unknown-kid throttle
workers/admin/src/headers.mjs    §4.8 headers on every response (S8)
workers/admin/src/log.mjs        access log: hash chain, access_log_hids, verifier, denied throttle (S16-S18)
workers/admin/src/meter.mjs      the daily Firestore read budget (S37)
workers/admin/src/reduce.mjs     masked docs -> directory rows; nothing else survives (S11, S13, S41)
workers/admin/src/directory.mjs  per-tick Auth check, 15-minute pass, chunked daily pass (§4.7)
workers/admin/src/data.mjs       D1 reads for the screens
workers/admin/src/html.mjs       escaping template (S14)
workers/admin/src/views/*.mjs    overview, household, records, manual access, errors
workers/admin/src/assets.mjs     stylesheet, one script, fonts (served after the JWT check, S6)
workers/admin/src/fonts.gen.mjs  generated from app/fonts by tools/admin_assets_build.js
workers/admin/dev/sample.mjs     sample families (and the ZZ- content seed for the no-content gate)
workers/admin/dev/fixture.mjs    fixture mode: local preview only; refuses any production secret or host
workers/admin/dev/preview.mjs    local preview server (127.0.0.1, ports 7701-7739)
test/helpers/admin-kit.js        D1 over node:sqlite (transactional batch), RSA keys + Access tokens,
                                 a fake Google (token, Firestore with masks, Identity Toolkit), recorder
```

## Tasks

Each task: **test first** (file and the assertion that must go red), then the code, then the green run.

### Task 1. Plan
Write this file, commit it. (No test.)

### Task 2. Test kit and sample families
- Test first: `test/helpers/admin-kit.js` is exercised by every later test; its own sanity lines live in
  `test/admin-access.test.js` section 0 (the D1 shim rolls a failed batch back; the fake Firestore honours
  and can ignore a mask; a token signed with the test key verifies, a token from another key does not).
- Code: the kit, and `workers/admin/dev/sample.mjs` (sample households; content-bearing records seeded
  with recognisable `ZZ-` strings for task 12).

### Task 3. Fail-closed configuration (S3, S4)
- Test first (`test/admin-access.test.js` §1): each of `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_PEOPLE`,
  `FIREBASE_READER_SA` missing, then malformed, gives 503 "Not configured" with no data; `ADMIN_PEOPLE`
  with zero entries and with two entries gives 503 to everyone, including the one listed address; a
  missing `ADMIN_DB` gives 503.
- Code: `config.mjs`.

### Task 4. The Access JWT, re-checked on every request (S1, S2)
- Test first (§2): missing header, forged signature (signed by another key), expired, `iat` and `nbf` in
  the future beyond 60s, wrong `aud`, wrong `iss`, `alg` none and HS256, a service token
  (`common_name`, no email), no email, an address Access allowed but `ADMIN_PEOPLE` does not list: each
  403, no data, and a `denied` row. A burst of unknown `kid`s fetches the certs at most once a minute;
  `Cache-Control: max-age` is honoured. A valid token for the listed address gets 200.
- Code: `access.mjs`.

### Task 5. Headers on every response, host check, state changes (S5, S7, S8)
- Test first (§3): every status the Worker can produce (200 page, 200 CSV, 200 static, 403, 404, 405,
  503, 500 from a thrown route) carries `no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`,
  `Referrer-Policy`, `nosniff`, HSTS and the exact §4.8 CSP; HTML carries the robots meta; no response
  carries any `Access-Control-*` header. A request whose Host is not `admin.little-cubby.com` gets 403
  even with a valid token. A POST without the admin Origin, or with a form body, gets 403.
- Code: `headers.mjs`, routing in `index.mjs`.

### Task 6. Static files are behind the check (S6)
- Test first (§4): `/static/admin.css`, `/static/admin.js` and each font without a token get 403; with
  one, 200, and each font's bytes equal the app's own `app/fonts` file (so the admin uses Cubby's real
  fonts and the generated module cannot drift).
- Code: `assets.mjs`, `tools/admin_assets_build.js`, `fonts.gen.mjs`.

### Task 7. Fixture mode refuses production (§6, my call 51)
- Test first (§5): `fixture.mjs` refuses to start when the host is `admin.little-cubby.com`, and when
  any of `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_PEOPLE`, `FIREBASE_READER_SA`, `INTERNAL_UIDS`,
  `MAIN`, `WRITES`, `GAMES_DB`, `NEWSLETTER_DB`, `USAGE_DB` is present (each staged). The production
  `wrangler.toml` carries no fixture variable, and `src/` contains no fixture branch at all (static scan):
  the Worker that deploys has no way to skip the check.
- Code: `dev/fixture.mjs`, `dev/preview.mjs`.

### Task 8. The access log and its chain (S16, S17, S18)
- Test first (`test/admin-access-log.test.js`):
  1. every family-data route (`/`, `/household/<n>`, `/records` each tab, the CSV, the manual-access
     page) writes its row **before** it answers; with the log write failing (D1 stub throws on
     `INSERT INTO access_log`) each answers 503 and the body holds none of the seeded names;
  2. the chain verifies from row 1; editing a row's `detail`, deleting a middle row, deleting the last
     row's household list entry, or re-pointing `prev_hash` each make the verifier name that row;
  3. `view_records` and `export_csv` record every household they showed (`access_log_hids`);
  4. `detail` refuses any key outside the fixed list and any free string (staged: a request number
     `"owner's email"`, a search term), and the actor is a first name plus a 16-hex id, never an address;
  5. a static scan finds no `UPDATE` or `DELETE` against `access_log` or `access_log_hids` anywhere in
     `workers/`; two concurrent appends never fork the chain.
- Code: `log.mjs`, wiring in `index.mjs`.

### Task 9. The masked reader and the hold reader (S10, S12)
- Test first (`test/admin-no-content.test.js` §1, `test/admin-hold.test.js`): a path or field outside
  §5.1 throws **before** any fetch (recorder sees nothing); every recorded Firestore request carries a
  mask (`mask.fieldPaths` or a `select`) that is a subset of §5.1; `lossHolding` appears in exactly one
  function under `workers/`; the hold reader returns held for absent, moved (`app.loss.holding`), a
  non-map value, an unknown shape, a 404, a 500 and a timeout, and not-held only for `null` and `{}`
  (companion stagings: `{uid: {at}}` and the legacy `{at}` are held).
- Code: `fs-values.mjs`, `google-auth.mjs`, `fs-read.mjs`.

### Task 10. The read budget (S37)
- Test first (`admin-no-content` §4): with `ADMIN_DAILY_READ_BUDGET` at 40 and a seed far larger, a
  full day of ticks never reserves more than 40 reads; the refresh stops; every page then says
  "Paused to protect families' quota."; the meter resets on the next UTC day (clock pinned to a day and
  an hour).
- Code: `meter.mjs`.

### Task 11. The per-tick Auth check (dir-erasure)
- Test first (`test/admin-dir-erasure.test.js`): a uid Auth no longer returns loses its `dir_people` row
  on the next tick **while the Firestore budget is exhausted**; an Auth failure (a 500 on page two)
  drops nothing; a household with no remaining member loses every `dir_*` row; a `dir_household_days`
  row 91 days old does not survive the pinned-clock run; the 90-day-old one does.
- Code: `auth-read.mjs`, the Auth step of `directory.mjs`.

### Task 12. Reducers, the 15-minute pass and the chunked daily pass (S11, S13, S41, S42, S45)
- Test first (`admin-no-content` §2-§3, with `--self-test` mutations): run the full refresh and fetch
  every page against a recorder that **ignores masks** and is seeded with `ZZ-BABYNAME-7731`,
  `ZZ-NOTE-...`, `ZZ-DOSE-...`, an invitee `zz-invitee@example.com` as a `pendingInvites` key, a link
  token `ZZLINKTOKEN7731` as a `pendingLinks` key with a `sentTo` address, a forged `users.email` and
  `users.name`, an entry `time` with a recognisable minute, a pregnancy journal string, an mhealth string
  and a hostile name. None reaches D1, any response or any log line. A pregnancy with `sharedWith: []`
  (and one keyed by a carrier who is not `ownerId`) leaves every stored and shown stage, count and label
  identical to no document at all. No raw record type and no dated kind reach D1. No non-internal person
  has `last_sign_in`, `last_refresh` or `entries_7d`. `--self-test` re-runs the suite on temp copies with
  each mutation (keep the baby's name; keep the `pendingLinks` keys; drop the `sharedWith` check; skip a
  mask) and requires each to go red.
- Code: `reduce.mjs`, `directory.mjs`.

### Task 13. Screens, CSV and the manual access
- Test first (inside `admin-access-log` and `admin-no-content`): the overview's three phase-1 checks
  read `/api/canary` through `MAIN` and `GAMES_DB` (`push_last_run`, `push_daily`, `digest_last`,
  `funnel_snapshots`); usage panels say "Waiting for usage events"; "Two people logging" equals
  `core.mjs` `sharedLoggingAt` on the same entries; the CSV prefixes `=`, `+`, `-`, `@`, tab and CR with an
  apostrophe and is `attachment` and `no-store`; the manual-access POST takes only the fixed reasons and
  `^R-\d{4}$`, writes `target_uid` when it concerns one person, and refuses a uid not in that household.
- Code: `data.mjs`, `html.mjs`, `views/*`.

### Task 14. Hostile names and the browser (S9, S14), screenshots
- Test first (`test/admin-ui.test.js`, a browser gate): a member named `<img src=x onerror=...>` and
  `"><script>...` renders as text on every screen, no handler fires and no element is injected; no
  request leaves for another origin; at 390px and 320px no page scrolls sideways (tables scroll inside
  their card). `--shots <dir>` writes 1440 and 390 screenshots of every screen.
- Code: CSS and layout fixes until green.

### Task 15. The real emulator (Firestore and Auth)
- Test first (`test/admin-read-emulator.test.js`, emulator tier, self-hosting on ports 7711-7715):
  seed sample families and the `ZZ-` content into the Firestore emulator and accounts into the Auth
  emulator; drive the real masked reader, the Auth reader and the refresh against them; every Firestore
  response body the reader received holds no `ZZ-` string (the real server honours each mask); the
  directory and every page hold none; the hold reader's real 404 reads as held.
- Code: fixes only.

### Task 16. The main site never serves the admin (S35)
- Test first (`tools/deploy_exclusion_check.js`, extended, `--self-test`): every tracked file under
  `workers/admin/` is fenced by `.assetsignore` as git's check-ignore reads it, and stays fenced when the
  broad `workers` line is removed (the explicit `workers/admin` line); no key-shaped file exists under
  `workers/admin/` at all; the admin wrangler file has `workers_dev = false`, `preview_urls = false`, and
  no `[assets]` (or `run_worker_first = true`); live: production 404s the admin entry file.
- Code: `.assetsignore`, the check.

### Task 17. No personal address in the tree (S34)
- Test first (`tools/address_check.js --self-test`): red on today's tree (the four documents and the
  App Store tool), a staged address goes red, `icon@2x.png` does not match, an address named in a local
  file outside the repo fails wherever it appears.
- Code: `tools/asc_submit.js` reads the contact from flags, the environment or a file under
  `~/.appstore-keys/`; the four documents are redacted.

### Task 18. The reminders tally (§6.1)
- Test first (`test/push-daily.test.js`): two cron runs on one UTC day add up in `ops_state.push_daily`;
  the next day starts again; `/api/health` does not gain the key.
- Code: `recordCronRun` in `worker.js`.

### Task 19. The chain head leaves the database every Monday (S19)
- Test first (`admin-access-log` §6): the Monday digest carries the chain head hash and the week's
  counts when `ADMIN_DB` is bound, and the main Worker's only `ADMIN_DB` use is that one named `SELECT`.
- Code: `adminChainSummary` in `worker.js`; a commented `ADMIN_DB` block in `wrangler.toml`.

### Task 20. `admin(live)`
- Test first (`tools/admin_live_check.js --self-test`): against local stub servers, a 200 to an
  unauthenticated request is red, a missing header is red, a redirect to Access or a 403 is green.
- Code: the check; wired in the live tier, its self-test in the tree tier.

### Task 21. Deployment kit (prepared, not executed)
- `workers/admin/wrangler.toml`, `workers/admin/migrations/0001_init.sql`, `docs/ADMIN-DEPLOY.md` (the
  founder's ordered checklist with exact commands and clicks, no secret values and no address).
- Validated locally: `wrangler deploy --dry-run` bundles it; `wrangler dev --local` answers 403 to a
  request without the Access header and 503 when a secret is missing.

### Task 22. Wire and run
- Every new test into `tools/gates.js`; run the new gates and every existing gate the change could touch
  (deploy-excl, harness, claude-md, design-doc, funnel-core, funnel-worker, funnel-report, tracking-plan,
  worker-routes, signin-canary, push-delivery, page-stats, purge-guard), and the emulator test.

## Status, 14 Nov 2026

Tasks 1 to 22 are built and each test was watched red before it was trusted (by its `--self-test`
mutants, or by a red run on the old code noted in the commit). What changed from the plan as written:

- **The schema is a D1 migration**, `workers/admin/migrations/0001_init.sql`, applied with
  `wrangler d1 migrations apply` (the admin `wrangler.toml` sets `migrations_dir`), rather than the
  spec's `schema/admin.sql` with `d1 execute`. Same tables; migrations record what ran.
- **The first deploy comes before the secrets** in `docs/ADMIN-DEPLOY.md`. Without them the Worker answers
  503 to everyone, and `wrangler secret put` on a Worker that does not exist yet would create a
  placeholder Worker with its own workers.dev address first.
- **No time zone chip on the household page in phase 1** (spec §6.2: "time zone from 3"); a line in
  `admin-no-content` holds it.
- **The Access log tab lists the look that drew it**, so its first row, its count and "Chain verified to
  entry N" agree.
- **`admin-ui`** (task 14) found three layout faults on the real pages (a long name pushed the page
  sideways at 320px; short values and "Caregiver" broke mid-word) and they are fixed.
- **`wrangler dev --local` could not start on the builder's machine** (esbuild's spawn fails with EBADF
  under Node 26 in that sandbox), so the "main Worker refuses the admin's files" proof is the git
  check-ignore one the spec names (`deploy-excl`), plus the live 404s in `deploy-excl(live)` and the smoke
  test. `wrangler deploy --dry-run -c workers/admin/wrangler.toml` bundles and lists the expected bindings.

### After the hostile review (N1 to N11), 14 Nov 2026

- **The access log chains to its head record, and stops when its tail does not match it (N1).** Deleting
  the newest entries used to be covered by the next look, which chained onto the shortened log and reused
  the numbers. Now every data route answers 503 naming the entries, nothing more is written, and only the
  resume command in `docs/ADMIN-DEPLOY.md` lets the log carry on, from the head, leaving a red, named gap.
- **A rewound head record cannot hide the newest looks, and a lost one cannot reuse their numbers (V2-1,
  V2-3).** The next entry takes the number after the high-water mark: the newest entry, the head record, the
  cron's checkpoint and `sqlite_sequence`, whichever is highest. `sqlite_sequence` is AUTOINCREMENT's own
  record of the highest number `access_log` ever held, and a DELETE never lowers it: proven on Miniflare's
  D1 (5.20261110.1-beta, workerd SQLite) on 14 Nov, where it stayed at 8 with the newest 3 deleted and at
  13 with every row deleted (`q/G-r3/d1/d1proof.mjs` in the session scratchpad; `admin-access-log` 2d holds
  the same on real SQLite). When the head record stands below the high-water mark, every page answers 503
  naming the entries, so deleting the newest looks and setting the head back to the survivor is refused,
  where it used to be accepted and the numbers reused. A lost head record now names the missing entries too
  ("The record of the newest access log entry is missing, and so are entries 6 to 8."). The founder's
  resume is ONE command for every break, copying the view `log_resume_next` (in `0001_init.sql`): the record
  `log_resume:<high-water mark>` = `<first missing>:<hash to chain to>` names its range, so the gap stays
  named for good, and entries deleted just below it later are a new break, never folded in.

  **What a holder of the D1 credentials can still do** (also in `docs/ADMIN-DEPLOY.md`, "What the log
  cannot catch"). The chain has no secret, so anyone with write access to `cubby-admin` (the founder's
  Cloudflare login, an API token with D1 edit, the main Worker once `ADMIN_DB` is bound) can rewrite it
  whole. D1 lets such a writer UPDATE `sqlite_sequence` (verified locally), so deleting the newest entries
  AND lowering `sqlite_sequence` AND setting back `log_head` and `log_check` together is not caught inside
  the database, nor is re-hashing every entry from a changed one onward with the head and checkpoint
  rewritten to match. Each extra record raises the work but none is a wall. The only copy outside the
  database is the chain head in the Monday digest, which nothing compares automatically; entries written
  since the last digest have no outside copy at all. Not done this round, each a possible next step: BEFORE
  UPDATE/DELETE triggers on the two log tables (they work on D1 locally, and a writer can drop them), and
  the digest keeping last week's head elsewhere and saying BROKEN when it no longer matches.
- **Every append re-hashes the newest entry (V2-4).** The tail read brings back the newest entry with its
  household list and the high-water mark in one statement, and one SHA-256 checks it. An edit to the newest
  entry that left its hash column alone (a household cleared, the detail or actor changed, a household added
  to or taken off its list) used to be seen only by the Access log tab; now every data route answers 503,
  "Entry N of the access log was changed after it was written." (`admin-access-log` 2e).
- **Looks at the same moment land, and an overlapping one is never taken for a break (V2-6).** Two
  requests that read the same head collide on the primary key and the loser retries; a burst used to retry
  in step, so of twenty at once five landed on the fixture and about ten on Miniflare's D1, and the rest got
  "Not shown". Each loser now waits a random moment first, up to 50, 100, 200, then 400 ms (full jitter, at
  most 750 ms, never after the fifth and last try): twenty at once landed in 8 of 8 bursts on Miniflare's
  D1. The tail was also read in two statements, the newest entry and then the head record, so a look whose
  read straddled another look's write saw the head one past the newest entry and was refused as "Access log
  broken" (staged in `admin-access-log` 2f: "log_broken_missing" before, lands after; nobody had reported
  it). It is one statement now, one snapshot. 2f fixes the dice and records every timer asked for, so the
  waits are checked exactly; the burst line asks for at least 10 of 20, twice what retrying in step reaches.
- **The chain is checked by the cron, in chunks, and the tab only from the checkpoint (N5, V2-2).** A tick
  has ONE budget of 150 entries: it walks forward from the checkpoint to the head first (after looks, a few
  entries), then spends the rest on the sweep from entry 1, which runs to where the checkpoint stood when it
  began. That is 6 D1 statements on a quiet tick and 10 after new looks. An earlier version walked forward
  only, whenever there were new looks, so while the dashboard was in use the sweep never ran and an old
  entry deleted or edited was never named (the round-2 review's V2-2); `admin-access-log` 2c now stages a
  look before every tick, and 100 looks a tick, and requires the deletion or edit named within
  ceil(N / (150 - looks - 1)) + 1 ticks. The Access log tab says when the last full sweep finished. A sweep
  that runs out of entries before the checkpoint names them missing; it used to report clean. Measured 14 Nov under workerd (Miniflare 5.20261110.1-beta, `wrangler` 4.160.1's
  runtime), 10,000-entry log, CPU of the whole workerd process (ps, 10 ms resolution) averaged over 20 to
  40 requests, three runs each (`q/G-fix2/cpu/measure.mjs` in the session scratchpad):

  | | before (b95414b5) | after |
  |---|---|---|
  | Access log tab, a cron tick between looks | 119 to 136 ms | 7.5 to 13 ms |
  | Access log tab, back to back | 120 to 140 ms | 6.5 to 11 ms |
  | `/records?tab=people` (a list, no chain) | 3.5 to 4.5 ms | 4.0 to 5.5 ms |
  | cron tick, steady state | 5.0 to 7.5 ms | 10 to 15 ms (8 ms with the chain check removed, one run) |
  | pure chain hashing (canonical JSON and SHA-256), no D1 | 7 to 8 µs an entry | the same: 150 entries 0.9 to 1.1 ms, 10,000 entries 68 to 78 ms |

  These are upper bounds, and noisy (about 3 ms run to run on this Mac, whose cores differ in speed). In
  Miniflare, D1's SQLite and its Durable Object run inside the same workerd process and are counted here; in
  production they run elsewhere and are not the Worker's CPU. The Worker's own share of the chain work is
  the hashing, about 1.1 ms for a tick's 150 entries and at most 0.8 ms for the tab's 100 (usually a few,
  since the cron keeps the checkpoint current). The old tab spent 68 to 78 ms hashing alone at 10,000
  entries. Two attempts to measure the Worker's share without D1 did not isolate it: D1 in a second workerd
  over HTTP cost more per statement than the SQLite it removed, and workerd's inspector never answered
  `Profiler.enable`. So the tick, which reads above 10 ms under this measure, needs one look after the
  deploy: Workers and Pages, cubby-admin, Metrics, CPU time (median and 99th percentile) for the cron.

- **The rest, each with its gate:**
  - N2: a household id the masked reader refuses is counted, never queued, and any other detail failure takes
    only that household off the queue; every page says "N households could not be refreshed" (`dir-erasure`).
  - N3: a read reservation is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE used + n <= budget RETURNING`,
    and a settlement adds a difference (`admin-no-content` 5b: 20 concurrent requests, never past the cap).
    Also run on Miniflare's real D1: 5 of 20 granted with room for 55; the old meter granted all 20.
  - N4: `FIREBASE_READER_SA` must be `cubby-admin-reader@<project_id>.iam.gserviceaccount.com`; a
    `firebase-adminsdk-*` key or any other account is 503 "Not configured" (`admin-access`).
  - N6: a cold isolate shares the one certs fetch in flight (`admin-access`).
  - N7: a person is listed under a household only when their own `users/{uid}.householdId` names it, in the
    refresh and on the live household page (`dir-erasure`; `admin-read-emu` reads the extra masked field).
  - N8: at little-cubby.com and mail.little-cubby.com only named role inboxes pass (`no-personal-address`).
  - N9: the live check accepts only a redirect to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...`
    or the admin host's own `/cdn-cgi/access/login`, parsed, never substring-matched (`admin-live-self`).
  - N10: `.wrangler` and `proof` are in `.gitignore` and `.assetsignore`, and `deploy-excl` walks for them.
  - N11: a request marked as loaded ahead (`Sec-Purpose`, `Purpose`, `X-Purpose`, `X-Moz`) is 403 before any
    access-log row (`admin-access`).
