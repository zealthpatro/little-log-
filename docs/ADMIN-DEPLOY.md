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
| `INTERNAL_UIDS` | your own account uids, comma-separated, no spaces needed (Firebase console, Authentication, Users, search your address, copy "User UID") |

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
