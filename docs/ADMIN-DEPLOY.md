# Cubby Ops: the founder's deploy checklist (phase 1)

The admin dashboard is a separate Cloudflare Worker, `cubby-admin`, at `admin.little-cubby.com`. It is
read-only, sits behind Cloudflare Access for exactly one person, re-checks the Access token itself on
every request, and writes every look to an access log before it shows anything.

Spec: `docs/superpowers/specs/2026-11-13-admin-dashboard-design.md` (§4, §16, §17 phase 1).
Plan: `docs/superpowers/plans/2026-11-13-admin-phase1.md`.

**Nothing in this file is a secret, and your address appears nowhere in it.** Your address goes in two
places only: the Access policy (step 3) and the `ADMIN_PEOPLE` Worker secret (step 8). Every command below
is typed by you; the builder never deploys, never creates a database, never puts a secret.

Run every command from a **clean clone outside `~/Downloads`** (for example `~/cubby-ops/little-log-pwa`),
on `main`, after `git pull`. Never from a worktree.

```
cd ~/cubby-ops/little-log-pwa && git checkout main && git pull --ff-only
node tools/gates.js --only=admin        # the admin gates, green on this exact tree
```

Plan facts this is sized for: Workers **Free** (50 subrequests a run; the refresh spends at most 30 a
tick), and the Android app is not on Google Play (nothing here depends on it).

---

## 0. Before anything (F2)

Round 5's code is on `origin/main` since 13 Nov. If its Firestore rules are not published yet, publish them
first, in the same sitting:

```
npx firebase deploy --only firestore:rules --project little-log-a9caa
```

## 1. Zero Trust team and the one-time PIN

Cloudflare dashboard, **Zero Trust**.

1. If there is no team yet, create one. Its name becomes your team domain, `<team>.cloudflareaccess.com`.
   You will paste this domain in step 8. Find it later under **Settings, Custom Pages** (or **Settings,
   General**): "Team domain".
2. **Settings, Authentication, Login methods, Add new: One-time PIN.** Add no other login method for this
   application.

## 2. No DNS record by hand

Do **not** add a DNS record for `admin`. The admin's `wrangler.toml` declares
`routes = [ { pattern = "admin.little-cubby.com", custom_domain = true } ]`, so the first deploy (step 6)
creates the hostname and its DNS record itself, as a Worker record.

Check now: **little-cubby.com, DNS, Records**. If a record named `admin` already exists, remove it before
step 6, or the Custom Domain cannot be attached.

## 3. The Access application, one person, one-time PIN

Do this **before** the first deploy, so the hostname is never reachable without Access.

**Zero Trust, Access, Applications, Add an application, Self-hosted.**

| Setting | Value |
|---|---|
| Application name | `Cubby Ops` |
| Session duration | 12 hours |
| Public hostname | subdomain `admin`, domain `little-cubby.com`, path empty |
| Login methods | **One-time PIN only**; untick every other method; turn on **Instant Auth** |
| App Launcher visibility | off (hidden) |
| Cookie settings (Advanced) | SameSite **Strict**, **HTTP Only** on, **Enable Binding Cookie** on |
| CORS | leave off (no CORS settings at all) |

**Policies: add exactly one.** Name `Founder only`, Action **Allow**, Include, Selector **Emails**,
value: your address. Nothing else: no Everyone, no Bypass, no Service Auth, no second rule, no
service token.

Save. Open the application again and copy the **Application Audience (AUD) Tag** (Overview, or Basic
information). You paste it in step 8.

## 4. The read-only Google service account

Google Cloud console, the Cubby project (the id in `.firebaserc`), **IAM and Admin, Service Accounts,
Create service account**.

1. Name: `cubby-admin-reader`. Description: "Cubby Ops, read-only".
2. Grant exactly two roles, nothing else:
   - **Cloud Datastore Viewer** (`roles/datastore.viewer`)
   - **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`)
3. Skip "Grant users access".
4. Open the account, **Keys, Add key, Create new key, JSON**. Save the file **outside** the repo folder,
   for example `~/cubby-admin-reader.json`.

The same from a terminal, if you prefer (replace `<project-id>`):

```
gcloud iam service-accounts create cubby-admin-reader --project <project-id> --display-name "Cubby Ops, read-only"
gcloud projects add-iam-policy-binding <project-id> --member "serviceAccount:cubby-admin-reader@<project-id>.iam.gserviceaccount.com" --role roles/datastore.viewer
gcloud projects add-iam-policy-binding <project-id> --member "serviceAccount:cubby-admin-reader@<project-id>.iam.gserviceaccount.com" --role roles/firebaseauth.viewer
gcloud iam service-accounts keys create ~/cubby-admin-reader.json --iam-account "cubby-admin-reader@<project-id>.iam.gserviceaccount.com"
```

Check it holds those two roles and no other:

```
gcloud projects get-iam-policy <project-id> --flatten "bindings[].members" --filter "bindings.members:cubby-admin-reader@" --format "value(bindings.role)"
```

Expect exactly `roles/datastore.viewer` and `roles/firebaseauth.viewer`.

## 5. The admin database, `cubby-admin`

```
npx wrangler d1 create cubby-admin
```

If it offers to add the binding to a config file for you, say no. Copy the `database_id` it prints and
paste it into `workers/admin/wrangler.toml`, replacing the all-zeros placeholder in the `ADMIN_DB` block
(ids are not secrets; the main `wrangler.toml` carries its own). Commit that one-line change.

Create the tables:

```
npx wrangler d1 migrations apply cubby-admin --remote -c workers/admin/wrangler.toml
```

It applies `workers/admin/migrations/0001_init.sql`: the access log, its household list, the directory
cache (current state only), the read meter, and the view the access log's resume command reads
(`log_resume_next`). Check:

```
npx wrangler d1 execute cubby-admin --remote -c workers/admin/wrangler.toml --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

Expect `access_log`, `access_log_hids`, `admin_meta`, `d1_migrations`, `dir_household_days`,
`dir_households`, `dir_people` (and `sqlite_sequence`).

**The Monday digest.** Paste the same id into the commented `ADMIN_DB` block at the end of the **main**
`wrangler.toml` and uncomment it. The main Worker then reads the access log in one named function (two
SELECTs, never a write) so the Monday digest carries the chain head and the week's counts, a copy of the
log's state outside its own database. This ships with your next push to `main`.

The `GAMES_DB` (cubby-games) and `NEWSLETTER_DB` (cubby-newsletter) blocks in the admin file already carry
the ids from the main `wrangler.toml`. The admin reads them and never writes them (a gate checks the code).

## 6. First deploy, before any secret

```
npx wrangler deploy -c workers/admin/wrangler.toml
```

Deploying before the secrets is on purpose: without them the Worker answers **503 "Not configured"** to
everyone and shows nothing (fail closed), and Access is already in front. (Putting a secret on a Worker
that does not exist yet would make Wrangler create a placeholder Worker first, with its own workers.dev
address. Deploying first avoids that.)

Then **Workers and Pages, cubby-admin, Settings, Domains and Routes**:

- `admin.little-cubby.com` is listed as a **Custom domain**, on `cubby-admin` and on nothing else;
- **workers.dev** is **Disabled**, and **Preview URLs** are **Disabled** (the file sets
  `workers_dev = false` and `preview_urls = false`; this confirms Cloudflare applied them);
- the **Cron trigger** `*/15 * * * *` is listed;
- **Bindings** show `ADMIN_DB`, `GAMES_DB`, `NEWSLETTER_DB` and the service binding `MAIN` (to `cubby`).

## 7. Smoke test: nobody gets in without Access

From any terminal, with no cookie:

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://admin.little-cubby.com/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://admin.little-cubby.com/records.csv?tab=people'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://admin.little-cubby.com/static/admin.css
curl -s -o /dev/null -w '%{http_code}\n' https://little-cubby.com/workers/admin/src/index.mjs
curl -s -o /dev/null -w '%{http_code}\n' https://little-cubby.com/workers/admin/wrangler.toml
```

Expect a `302` to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...` for each of the first
three (never a `200`), and `404` for the last two (the main site never serves the admin's files).

Then the gates that ask production:

```
node tools/admin_live_check.js
node tools/deploy_exclusion_check.js https://little-cubby.com
```

Both must end in `PASS`. `admin_live_check.js` asks seven kinds of path (page, household, CSV, access
log, stylesheet, font, POST) with no session and accepts only a redirect to Access or a 401/403.

Now in a **private window**, open `https://admin.little-cubby.com`: the PIN page appears; enter your
address and the code. You should see **"Not configured"**: the Worker is refusing to show anything until
its secrets exist. That is the fail-closed rule, proven live.

## 8. The admin's secrets

From the clean clone, one at a time. Each command asks for the value; paste it and press Enter. Each one
redeploys the Worker with the new secret.

```
npx wrangler secret put ACCESS_AUD -c workers/admin/wrangler.toml
npx wrangler secret put ACCESS_TEAM_DOMAIN -c workers/admin/wrangler.toml
npx wrangler secret put ADMIN_PEOPLE -c workers/admin/wrangler.toml
npx wrangler secret put FIREBASE_READER_SA -c workers/admin/wrangler.toml < ~/cubby-admin-reader.json
npx wrangler secret put INTERNAL_UIDS -c workers/admin/wrangler.toml
```

| Secret | What to paste |
|---|---|
| `ACCESS_AUD` | the Application Audience (AUD) Tag from step 3 |
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (no `https://`, no path) |
| `ADMIN_PEOPLE` | `[{"email":"<your address>","name":"<your first name>"}]`, **exactly one** entry. Zero or two entries and the dashboard refuses everyone, you included |
| `FIREBASE_READER_SA` | piped from the key file of step 4 (the command above reads it). The Worker accepts only `cubby-admin-reader@<project-id>.iam.gserviceaccount.com`: a `firebase-adminsdk-*` key (such as `tools/serviceAccountKey.json`) or any other account turns the dashboard off with "Not configured" |
| `INTERNAL_UIDS` | your own account uids, comma-separated, no spaces needed (Firebase console, Authentication, Users, search your address, copy "User UID"). **33 at most**: a usage read binds them up to three times over, and D1 takes 100 parameters a statement, so with more every usage panel says "Usage events could not be read just now" (`SCOPE_MAX` in `workers/admin/src/usage.mjs`) |

Check the names (never the values) are there:

```
npx wrangler secret list -c workers/admin/wrangler.toml
```

Then **delete the downloaded key file** from your machine: the Worker secret is now the only copy, and a
new key can always be made.

```
rm ~/cubby-admin-reader.json
```

**Main Worker:** if `INTERNAL_UIDS` is not set on the main Worker yet (its state has been unknown since
October), set it there too, from the repo root: `npx wrangler secret put INTERNAL_UIDS`.

## 9. Check it

1. Private window, `https://admin.little-cubby.com`: PIN page, your address, the code: the overview.
2. Within 15 minutes the first cron tick fills the directory (the first full pass runs across a few ticks).
3. Untick **Hide our own accounts** and press Apply: your own households appear. Ticked (the default), they
   are hidden.
4. Open one household: the banner says "You opened this household at ... That is now in the access log,
   with your name." Open **Every record, Access log**: your look heads the list, and the line reads
   "Chain verified to entry N".
5. In another private window, try any other address: Access sends no code and the page never opens.
6. Run the production gates once more: `node tools/gates.js --live --only=admin`.
7. Turn on two-step sign-in for the mailbox that receives the PINs, if it is not on: that mailbox is now
   the key to the dashboard.
8. A day later, check the CPU on the Free plan's 10 ms: Workers and Pages, cubby-admin, Metrics, CPU time.
   The cron's median should sit well under 10 ms. Local measurements put it above 10 ms only because they
   count the database's own work, which in production runs elsewhere, so this is the real reading. If the
   cron's 99th percentile passes 10 ms, lower `CHAIN_ROWS_PER_TICK` in `workers/admin/src/log.mjs` first.

## 10. Keep your address out of the repo, locally too

Put your address in a file **outside** the repo, one address per line:

```
mkdir -p ~/.cubby && printf '%s\n' '<your address>' > ~/.cubby/private-addresses.txt
```

`tools/address_check.js` (the `no-personal-address` gate, run by the pre-push hook) then fails any tracked
file that contains it.

**App Store Connect defaults.** `tools/asc_submit.js` no longer carries the account holder's name and
address. Put them in `~/.appstore-keys/asc-contact.json`:

```
{ "firstName": "<first name>", "lastName": "<last name>", "email": "<the account holder's address>" }
```

(or pass `--first`, `--last`, `--email`, or set `ASC_CONTACT_FIRST`, `ASC_CONTACT_LAST`,
`ASC_CONTACT_EMAIL`).

## 11. Every 90 days

Make a new reader key (step 4, Keys, Add key), `npx wrangler secret put FIREBASE_READER_SA -c
workers/admin/wrangler.toml < <new key file>`, delete the old key in Google Cloud, delete the new file
from your machine.

---

## If something is wrong

- **Turn it off at once, keeping everything:** `npx wrangler secret delete ADMIN_PEOPLE -c
  workers/admin/wrangler.toml`. Every request then answers 503 and shows nothing; putting the secret back
  turns it on again. Access stays in front either way.
- **"Not configured" after step 8:** a secret is missing or malformed. `secret list` shows which names
  exist; the Worker log (Workers and Pages, cubby-admin, Logs) names the code, for example
  `admin_not_configured missing_firebase_reader_sa`, never a value. `firebase_reader_sa_is_admin_key` or
  `firebase_reader_sa_not_reader` means the wrong key file was piped in step 8: put the reader's key.
- **A page loaded "ahead" is refused:** browsers that prefetch or prerender links get "Not allowed" for
  that early load and nothing is logged; the real click loads the page as normal.
- **"Paused to protect families' quota":** today's Firestore read budget (`ADMIN_DAILY_READ_BUDGET`, 8,000
  reads a UTC day) is spent. The pages keep the last refresh and the meter resets at 00:00 UTC. It never
  borrows from the families' quota.
- **"N households could not be refreshed":** the daily pass could not read those households' details (a
  read error, or a document id the masked reader will not read by path, such as one with a dot or a space,
  which any signed-in person can create). Everyone else's numbers were refreshed; those households keep what
  the listing gave. The Worker log names each failure by code (`admin_detail_fail`), never by household.
- **"Not allowed" after signing in:** the address you signed in with is not the one in `ADMIN_PEOPLE`, or
  the AUD tag or team domain does not match this Access application.

## If the access log breaks

Every page says **"Access log broken"** and names entries, for example "Entries 7 to 9 of the access log
are missing." The newest entries no longer match the log's own record of its newest entry
(`admin_meta.log_head`), or numbers were handed out past both: something deleted, rewrote or added entries
outside the dashboard, or set the head record back over them. The log knows the highest number it ever
handed out from SQLite's own count (`sqlite_sequence`, which a delete never lowers) and from the cron's
checkpoint, so setting the head record back does not hide the newest entries. Nothing is shown, and
nothing more is written, until you carry on. The numbers of the missing entries are never handed out again.

1. Look first. Compare with the chain head in the last Monday digest ("Chain head at entry N"), and ask
   who has write access to `cubby-admin`: your Cloudflare login, any API token, and the main Worker if its
   `ADMIN_DB` binding is set. Rotate what you no longer trust.
2. Then carry on, from the clean clone. This records that you looked, and lets the log continue from its
   head record (or from the newest entry, if the page says the head record itself is missing). The record
   it writes names the missing range, so it covers this break and nothing else:

   ```
   npx wrangler d1 execute cubby-admin --remote -c workers/admin/wrangler.toml --command "INSERT OR REPLACE INTO admin_meta (key, value, at) SELECT key, value, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM log_resume_next"
   ```

3. The next page loads. The Access log tab then says, in red and for good, "Chain verified to entry N,
   except entries 7 to 9, which are missing." A resume never hides a gap, and it only covers the break it
   was made for: a later deletion stops the log again, and so do entries deleted just below a gap you have
   already looked into. If the page still says "Access log broken" with new numbers, something changed
   between your look and the command: look again, then run step 2 again.

### What the log cannot catch

The chain has no secret in it: anyone who can write to `cubby-admin` (your Cloudflare login, an API token
with D1 edit, the main Worker once `ADMIN_DB` is bound) can rewrite it whole. The dashboard catches every
change that leaves a trace inside the database: a deleted, edited or reordered entry, a deleted tail, a
head record set back, a head record deleted. It cannot catch someone who deletes the newest entries AND
lowers `sqlite_sequence` AND sets back the head record and the cron's checkpoint (`log_check`), or who
re-hashes every entry from the one they changed onward and rewrites the head record and the checkpoint to
match. What is left then is outside the database: the chain head
in each Monday digest. Compare it with the Access log tab: the entry the digest names must still be there,
with the same hash. Entries written since the last digest have no outside copy, so they cannot be checked
that way. Keep D1 write access to your own login, and treat any token with D1 edit like the dashboard itself.

## Phase 2: the usage panels (after `cubby-usage` exists)

Once you have created `cubby-usage` (spec §16 step 12), uncomment the `USAGE_DB` block in
`workers/admin/wrangler.toml` with the same database id as the main `wrangler.toml`, and deploy the admin
again. Nothing else changes, and no secret is added.

- **What you see.** Until families are told what our team can see (phase 3), the overview's usage tiles,
  "Saving and sync", "What people use", "Time in Cubby" and "Where they use it", the household page's
  usage panels, and the Visits, Usage events, Sign-ins and Devices tabs show your own accounts only, the
  uids in `INTERNAL_UIDS`. "Hide our own accounts" is ticked by default, so every one of them says
  "Waiting for usage events" until you untick it. That is expected, not a fault.
- **Why only yours.** One function, `usageScope` in `workers/admin/src/usage.mjs`, limits every read of a
  table that names a person to `INTERNAL_UIDS`. Even if the main Worker stored a family's events by
  mistake, no page, tab or CSV would show them (`admin-no-content` stages exactly that). The one exception
  is by design and is said on the page: a pregnancy or trying tool's use has no person in it, so it joins
  the overview's total (below).
- **Read only.** The admin holds `USAGE_DB` through a handle that can only run a SELECT, and no admin code
  writes it (`admin-access-log` section 5).
- **Times.** Usage times are the family's own time zone. A visit that logged or edited medicine or a
  health entry shows the hour its visit started, everywhere, CSV included (F5): every event of that visit
  reads that same hour, even one sent after the clock turned. A visit whose end has not come in yet shows
  the hour only too, since it can still log a dose (its first batch reaches the server before its dose
  does); it gains its minute when its end arrives, if it logged none. The notes under the lists say both. (A visit whose
  start row is not stored, for example events sent while Cubby was in the background, or a visit whose
  start the retention or an erasure has taken, shows the hour of its earliest stored row, which can be
  later than its start; it never shows a length.) A device's first and last seen are when a visit
  started, shown exactly as that visit's own row shows it, never when its data arrived (an arrival is as
  good as the minute of a dose); a device whose oldest visit is past the 90 days shows the day it was
  first seen, no time.
- **"Saving and sync"** shows when a batch arrived, and refreshing shows when it changes, so it is read
  only from writes whose visits have all ended with no medicine or health entry, and only once the batch
  that carried each visit's end held nothing else but finished visits like that. A phone that could not
  send a visit's end when Cubby closed sends it with the next visit's first batch; if that next visit is
  still open, or logs a dose, the earlier visit's writes are never read. So no dose's arrival, and no
  visit still open, moves the line. That makes it blind to your newest saves until their visit ends, and
  for good to saves in a dose or health visit (the household page's "Failed saves, 7 days" still counts
  failures there), so it never calls a save the last or the newest, never says "Not working", which it
  cannot know, and a note under it says what it reads:
  - "Working · a save came in 5 minutes ago": a save it may read arrived then, and no failure it may
    read came after it within the hour. A newer save, or a newer failure, may have arrived since.
  - "Check saves · a save failed 30 minutes ago, with no save shown since": a failure it may read, and no
    save it may read after it. Saving may well be working again: a feed logged since, in a visit still
    open, does not clear it, because clearing it then would time that visit. It clears when a save it may
    read comes in, or an hour after the failure.
  - "Check saves · saves failed for 3 people in the last hour": three people's failures it may read, in
    the hour (the threshold is the builder's call). It stays red for that hour even when a save it reads
    comes in after them, so it says "Check saves", never "Not working", which it cannot know: that later
    save, or one it may not read, can mean saving works again. The count leaves out failures it may not
    read.
  - "No save to show yet": no save it may read, whether you have none at all or only saves in dose
    visits and visits still open. It cannot tell those apart without timing a dose.
- **Order, and whole visits (F5).** Every list is sorted by the time it shows: by the family's own day and
  hour, then, inside an hour, the rows with minutes, then the hour-only rows, as if at the start of the
  hour. So a dose visit's place never narrows its minute, and a device's first and last seen are picked the
  same way. A visit reaches the server in several batches, so the dose is judged over every stored row of
  the visit, never the share inside a window: "Visits, last 48 hours" finds its visits by arrival, reads
  each whole, and lists one while what it shows is inside the 48 hours (an hour-only visit leaves at the
  start of an hour). A visit can lose its start or its end. The 90-day retention and the erasure of a
  deleted person or household take a visit whole when they can, but a day's delete allowance or a
  statement's row limit can run out partway through one, and the retention also cuts a visit whose rows
  arrived more than a day apart (an offline phone's later batches). Before any other row of a visit they
  take its start (retention), or its start or its end (erasure), so what is left lacks its start, its end
  or both until a later run. The one shape that order misses, a visit whose start arrived after some of
  its other rows, is one Cubby's own app never sends (`workers/usage/core.mjs`, above `retentionSteps`).
  A visit can also arrive without its start (an event the app sent from the background, outside any
  visit, a first batch over the daily cap, or a phone offline long enough to queue more than 500 events,
  which drops the oldest). That order only makes sure a cut visit has lost its start
  or its end; what keeps a dose visit's minute hidden after that is the admin's rule. One whose start is
  gone may have lost its dose: it shows the hour of its earliest stored row only, and one that kept its
  end (its length) is not shown at all. One that lost only its end shows the hour of its start only, like
  a visit still open. A Getting started screen is never shown per person, like a pregnancy or trying
  screen, so a journey shared with nobody and none look alike (S41).
- **A failed read is said.** A usage CSV whose read fails answers 503, "Usage events could not be read just
  now, so nothing was exported.", with no file and no export in the log.
- **Pregnancy and trying tools** are kept by the main Worker only as daily totals with no person or
  household in them (§8.4), so the uses beside them on "What people use" count everyone the server stored,
  not only our own accounts. The note under the table says so. Their households and people are counted
  inside the scope, and they never appear on a per-person page.
- **Not built yet.** The household page's per-person columns (Last seen, Opens Cubby on, Visits 7 days,
  Time 7 days) and the People tab's Last seen and usage columns are "internal accounts from phase 2" in
  spec §6.2 and §6.3, but they were not in this phase's list (§17). They wait, with the line that says they
  switch on once families are told. Building them for our own accounts is a later change through
  `usageScope`. The Devices tab's Reminders column shows each phone's newest notification answer, which the
  main Worker records in `devices.push` from `push.permission`; a phone that never sent one reads "Not recorded".
- **Every view and export is logged** as for the other tabs: `view_records` or `export_csv`, with the tab
  and every household shown, written before anything is served.
- **Check it.** Use Cubby for a day from each way in (iPhone app, home-screen app, Android app, browser
  tab), open the dashboard, untick "Hide our own accounts", and look for your own visits on the Visits tab.
  Then delete a test account in the app and check its rows are gone from the Devices tab.

## Phase 3 checklist: before `usageScope()` widens

Phase 2 reads your own accounts only, a few uids, and every number below is small. Phase 3 only widens
`usageScope()` in `workers/admin/src/usage.mjs`, and the costs below then grow with everyone in it. Work
through this list, and measure on D1 itself, before that change ships. The numbers come from a probe that
runs the admin's real read functions over the real schema in `node:sqlite` (SQLite 3.53.4, Node 26, an
M1): a synthetic 1,000 people, two to a household, 6 visits a day of 5 rows each, 90 days. That is 2,700
rows a person, against about 1,200 for the dev sample's founder (13 rows a day). `EXPLAIN QUERY PLAN` gives
which rows each statement visits; D1 counts those as rows read, and D1's own planner can choose
differently, so read `meta.rows_read` from a real response before trusting any of this.

Below, U is the people in the scope, R the rows each keeps (90 days), S = U × R, and D the devices.

- **The bound-parameter ceiling comes first.** D1 refuses a statement with more than 100 bound
  parameters, and the scope is bound one uid at a time, up to three times. Measured per read: overview
  3U+1 ("Saving and sync" binds it for the row read, the rows that arrived with it, and the rows that
  arrived with each visit's end), household page 2U+2, the tab counts 2U+10, Visits U+2, Usage events
  2U+12, Sign-ins 2U, Devices U. The first scope that breaks is **34 uids** (the overview, 103
  parameters); Usage events follows at 45, the tab counts at 46, the household page at 50. A refused read
  shows "Usage events could not be read just now" (a
  count shows a dash), so phase 3 needs a scope that does not bind every uid: for example a column or
  small table that marks who is in scope, joined on, with one parameter.
- **Rows read per view.** Every records page, People and Households included, also runs the four tab
  counts, and each count groups every scoped row: about 5S + D rows read for the counts alone. Then the
  Visits tab reads about 2S more, Usage events and Sign-ins about 4S more, Devices about S + 2D more. The
  overview reads about 4S (households measured, gone quiet, visit lengths and busiest hours each scan the
  scope). At 1,000 people (R from 1,200 to 2,700) that is 6 to 13.5 million rows for the counts on one
  records page and 4.8 to 10.8 million for one overview, against the Free plan's 5 million rows read a
  day (Cloudflare's published D1 limit when this was written; check the pricing page). Even at 100 people,
  a few views a day use it up. In `node:sqlite` the counts took 14.8 s and the Usage events page 13.9 s at
  1,000 people.
- **One household's page** read about 1,000 rows at any scope size in the probe (5.5 ms of SQL at 1,000
  people): SQLite drove "Visits, last 48 hours" from that household's own recent rows (`ue_hid_at`, then
  `ue_visit` for each visit). An earlier review, of the version before this one, saw it planned on
  `ue_uid_at` for every scoped uid, with the household's rows only as a filter, which would read S rows
  per view. Pin it with a shape that cannot scan the scope: pick that household's (uid, visit) keys from
  `ue_hid_at` first, then join back for each visit's rows.
- **Devices.** The tab reads every device in scope and runs one subquery per device to find its time
  zone, then pages in JavaScript, where each time zone is checked by building an Intl formatter (`okTz`,
  three a device): 101.8 ms of JavaScript at 1,000 devices (31.6 ms at 300), against the Free plan's 10 ms
  of CPU a request, so about 100 devices is the edge. Store the order key (the last visit's shown hour) and
  the time zone on the device row, read one page, and check each time zone once.
- **The overview's JavaScript** builds formatters the same way for each person's recent visit starts
  ("Active today"): 275.7 ms at 1,000 people. One formatter per time zone fixes it.
- **"Saving and sync"** is not on this list: its three reads walk `ue_at` newest first and stop at the
  newest row they may read, checking each moment by one arrival time on `ue_at` and each visit on
  `ue_visit` (11.6 ms for the newest write at 1,000 people, in a probe where 20 people share every arrival
  moment, so each check reads 40 rows of 40 visits; left to SQLite's own choice of `ue_uid_at` for one
  visit's facts, 1.8 s, and with no plan pinned at all, 781 ms before the riding-end rule). Every table
  each read names carries `INDEXED BY`, so D1's own statistics cannot choose another plan: with skewed
  statistics, the one lookup that had no hint (a visit's end) became a scan of the whole table. Section 6
  of `test/admin-screens.test.js` pins every one of those plans, with the test database's statistics and
  with skewed ones. Read `meta.rows_read` for the three reads on D1 itself before trusting the numbers.
- **What an erasure reads.** D1 Free also caps rows read, at 5 million a day for the account, and a pending
  erasure is carried on every tick until it is done (at most five steps a UTC day that delete rows, and
  one more when a person's marker's hold ends, which clears it and takes any row of hers stored during
  the hold; `wrangler.toml` says when, and the race that can
  add more). For visits as Cubby's own app sends them (a visit's start arrives with its first other
  rows, or shortly before them, not ahead of a batch's worth of the household's other rows), a step reads about one batch of visits whatever was stored: measured on workerd's D1, at
  most 7,647 rows for a person and 21,210 for a household in visits of five rows (36,014 in visits of
  two), as `wrangler.toml` states. Two things grow once everyone is measured:
  - **The membership table.** It has no index on its household column, so a household step reads it whole in
    every step's plan, again in the step that unlinks its members (up to whole: it stops once it has them
    all) and whole again in the step that clears its marker; a household small enough to go in one step
    can do all three. With 10,000 other people's rows, that is 10,000 to 30,000 more rows a step (30,027 a
    middle step instead of 20,027, and 33,579 instead of 3,579 for a 200-row household's one step).
    `CREATE INDEX IF NOT EXISTS mem_hid ON membership(hid)` turns all three into lookups, but then each new
    membership row bills 4 written rows, not 3: the worst UTC day in `wrangler.toml` goes from 45,086 to
    46,086 (the arithmetic in `test/usage-erasure.test.js`, run with the index added), and its stated
    figures must change with it. Decide before phase 3.
  - **Open question: a client that is not Cubby's app.** From phase 3 the server stores the events of any
    signed-in account, whatever client sends them, and two shapes cost far more than Cubby's app makes. One
    visit id reused across a huge number of rows: the statements that name a step's batch read every row of
    its visits, so the step grows with the visit. On workerd's D1, a household step read 89,037 rows with
    one visit of 20,000 in its batch and 17,037 with one of 2,000 (four times the visit, plus about 9,000),
    and a person's step 45,006 and 9,006 (twice the visit, plus about 5,000). Retention reads every row of
    each visit it picks, whatever their arrival, about twice over on every statement that picks it, though
    it deletes only the rows that arrived up to a day after its cutoff: 40,017 rows to delete the one
    expired row of a visit of 20,000, and 88,402 for a day's 3,100 rows once all of them had expired. It
    needs no erasure to do that, only an expired row in the visit. And many visits' starts sent first with
    their other rows later: every household step re-reads all of those starts until their other rows go.
    Measured on workerd's D1, a household step with 10,000 such visits read up to 116,014 rows, against up
    to 36,014 for the same 10,000 visits sent start with body, and with 30,000 such visits up to 316,014;
    the cost falls as their other rows go. No ingest rule stops either today beyond the daily cap on stored
    events. Accept it and say so, or cap it at ingest (rows per visit id, or no second burst of starts),
    before phase 3.
- **Open question: what still moves when ANY batch of a dose visit lands (F5 by arrival).** No time is
  shown to the minute for a dose visit, or for a visit still open, and "Saving and sync" does not move for
  either. But every other usage surface changes when each batch of a dose visit arrives, so an observer
  who refreshes learns the arrival of every one of them, and with it the dose's own time, not only the
  hour:
  - **Its first batch** (its start, sent about 5 s after Cubby opens): a new row on the Visits, Usage
    events and Sign-ins tabs and the household page (hour only), the tab counts beside them, a device's
    row or its last seen hour, the overview's per-arrival tiles ("Active today") and busiest hours, and,
    on an account's very first batch, the overview turning from "Waiting for usage events" to numbers. A
    clean visit whose end rode in with that batch also gains its minute then.
  - **The dose's own batch** (sent about 5 s after the dose is logged): "logged a dose" appears on that
    row on the household page and the Visits tab, the Medicine and doses (or Health log) rows of "What
    people use" and "Who uses what" step, and the Usage events count steps. So an observer who refreshes
    often times the dose itself to within about 5 seconds.
  - **Its end's batch**: the visit's length appears ("5m 4s"), the Usage events count steps, and "Time in
    Cubby" may. The end's arrival minus that length gives the visit's start to the second.
  - **"Failed saves, 7 days" and "Sign-in problems, 7 days"** on the household page step with the batch
    that carries the failure, often the failed dose save itself.
  - **And again one window later.** A window keyed on arrival also moves one window after a batch, so
    someone who refreshes later, without having watched that batch land, can still time it to the second.
    Which batches depends on what the window counts. A window that counts rows steps back one window after
    each batch that carried one: "Failed saves, 7 days" and "Sign-in problems, 7 days", 7 days after the
    batch that carried the failure. A window that counts households, people or devices moves one window
    after the last batch that kept each of them in it: "Active this week" and "Went quiet" 7 days after the
    household's newest visit start; the households and people beside a pregnancy or trying tool on "What
    people use" 30 days after that household's, or that person's, newest use of it; and "the newest version"
    on "Where they use it" a day after the newest batch of the last device on it, and only if another device
    was seen in that day. So a dose visit's batch is timed again later when it carried a failure, held its
    household's newest visit start, held a household's or a person's newest use of a pregnancy or trying
    tool, or (a day later) was the newest batch from any device on the newest version. A batch that carries
    only the dose can do only the last of these, because "What people use" counts doses by the family's own
    day. (The hour of failures behind "Saving and sync" is keyed on arrival too, but only on moments that
    held nothing but finished visits with no dose or health entry.) A probe lands a dose visit's start at
    T0, and its dose, a kick count, a failed save and a failed sign-in together at T1 = T0 + 3m 7s, in a
    household with no other visit. One second before T0 + 7 days it reads "Active this week" 1 and "Went
    quiet" 0, and one second after, 0 and 1. Either side of T1 + 7 days, "Failed saves, 7 days" and "Sign-in
    problems, 7 days" go from 1 to None. Either side of T1 + 30 days, "Kick counts" goes from 1 household
    and 1 person to 0 and 0, its uses staying at 1. A second probe lands the same dose visit, its dose and a
    kick count at T1 (no failure), and then a clean visit of the same household with a kick count, landing
    whole a day after T0. Then neither T0 + 7 days nor T1 + 30 days moves anything: "Active this week" and
    "Went quiet" read 1 and 0 on both sides of T0 + 7 days and turn to 0 and 1 either side of the clean
    visit's arrival plus 7 days, and "Kick counts" still reads 1 household and 1 person one second after T1
    + 30 days, and 0 and 0 one second after the clean visit's arrival plus 30 days. And when a phone on v370
    sends a dose batch as its last, and a laptop on v369 is seen an hour later, "the newest version" reads
    v370 one second before that batch's arrival plus a day, and v369 one second after, the same with a
    tablet on v370 last seen three hours before that batch; with the laptop last seen two days before that
    batch instead, it reads v370 on both sides.

  Before phase 3, decide whether these are read only from ended visits at closed moments too (as the
  saving line is), held back to a cutoff that moves only at whole days, or accepted and said. A cutoff
  has to align these windows to whole UTC days too (counted back from the cutoff, not from now), or each
  still moves at a batch's arrival plus one window. A probe that lands one dose visit's three batches (its
  start, its dose, its end, 30, 27 and 25 minutes ago) reads its household row as "Today 2pm · Sam · iPhone
  app", then "... · logged a dose" as a Medicine and doses row appears on the overview (1 household,
  1 person, 1 use), then "... · logged a dose · 5m 4s", with the Usage events count at 3, 4 and 5.
- **The shape that removes most of this:** let the main Worker keep one row per visit (its uid,
  household, device, start, health, start kept, ended) as it ingests, so the counts and the Visits and
  Devices tabs page through an index instead of grouping 90 days of rows on every view, and the overview's
  scans read `usage_daily` or that table. Until something like it ships, phase 3 stays off.
