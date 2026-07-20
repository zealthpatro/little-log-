# The push cron was failing on every run, and the heartbeat said it was healthy

**Date:** 2026-07-21
**Severity:** P1. Medicine reminders are the only thing Cubby is allowed to push at all, so a
silently dead push cron is the whole feature.
**Impact on families: none.** No user currently has push enabled with a pending reminder, so no dose
reminder was actually missed. This is a latent failure caught before it could hurt anyone, not an
incident with victims.
**Status:** detection fixed and shipped. **Root cause of the 403 is still open and needs founder
access** (see Corrective actions).

## What happened

While removing the cron's full-collection scans, the new code recorded *why* a run produced nothing.
`/api/health` immediately returned:

```json
{"cron":{"ageMin":0,"due":0,"sent":0,"userErrors":0,"queryError":"403","fallback":"failed"},
 "cronHealthy":true}
```

Both the new structured query **and** the old full page of `/users` returned **403**. So this was not
the new query, and not a missing index (that is `400 FAILED_PRECONDITION`). Firestore is refusing the
service account outright.

`getAccessToken` **succeeds** — if it threw, `scheduled()` would catch it and `recordCronRun` would
never run, leaving a stale `at`. `at` is fresh on every tick. So Google is issuing a token for the
service account and Firestore is then rejecting it: an IAM or API-enablement problem on the project,
not a code problem.

## How it stayed invisible

The previous loop:

```js
let docs = [], pageToken = '';
do {
  const r = await fetch(base + '/users?pageSize=300' + ...);
  if (!r.ok) { console.error('push_users_fetch_fail', r.status); break; }   // <-- swallowed
  ...
} while (pageToken);
...
await recordCronRun(env, { users: docs.length, sent, userErrors });          // <-- reports 0
```

A 403 broke out of the loop and was then reported as `users: 0`, which is **indistinguishable from
"nobody had a reminder due"**. Every observer, including me earlier in this session, read `users: 0`
as an idle cron on a pre-launch product. It was a failing one.

`cronHealthy` then confirmed the wrong story, because it only asked whether the last run was
**recent**:

```js
const cronHealthy = cron ? (now - cron.at) < 60 * 60000 : null;
```

The run was always recent. It was never successful. The heartbeat could not go red.

## Five whys

1. **Why were no medicine reminders sent?** Every Firestore read from the cron returned 403.
2. **Why did nobody notice?** `/api/health` said `cronHealthy: true`.
3. **Why did health say healthy?** It only checked that a run had happened recently, not that the run
   had worked.
4. **Why was "recent" treated as "healthy"?** The heartbeat was built to catch a *dead* cron (the
   scheduled trigger not firing). A cron that runs perfectly on time and fails every time was not in
   the model.
5. **Why did the failure not show up in the summary either?** Because the error was swallowed at the
   fetch and converted into a legitimate-looking count of zero. The summary faithfully reported a
   number that had already lost the distinction between "none due" and "could not look".

**Root cause of the invisibility:** a failure was encoded as a valid-looking zero, and the health
check was defined on liveness rather than success. Two independent chances to notice, both spent.

**Root cause of the 403 itself: not yet known.** It requires console/IAM access.

## What I got wrong

I reported `users: 0` to the founder as evidence that "the scale ceiling was a real latent flaw
rather than an active outage." That reading was wrong, and it was wrong in the flattering direction:
it made the system sound idle and healthy when it was failing. The number was never trustworthy, and
I did not question where it came from before repeating it.

Separately, I claimed the query change was "verified" on the strength of 19 emulator assertions. The
Firestore emulator auto-creates indexes and does not enforce IAM, so it could prove the query's
semantics and never prove it would run in production. Green tests against the wrong environment are
not verification.

## Corrective actions

| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | `cronHealthy` requires recent **and** successful; `cronFresh` reported separately so a dead cron and a failing cron stay distinguishable | me | **Done** (commit on main) |
| 2 | Surface the failure in the run summary (`queryError`, `fallback`), full body to logs, only the HTTP status to the public endpoint | me | **Done** |
| 3 | Push falls back to a full page if the query fails, so an optimisation can never silently stop a medicine reminder | me | **Done** |
| 4 | **Find and fix the 403.** Check that the Firestore API is enabled on `little-log-a9caa`, that the service account in the `FIREBASE_SERVICE_ACCOUNT` Worker secret still exists and is enabled, and that it holds `roles/datastore.user`. `npx wrangler tail` prints the full `fs_query_fail` body, which names the exact reason | **founder** | **OPEN** |
| 5 | Re-verify after the fix: `/api/health` must show `cronHealthy: true` with no `queryError` | me | Blocked on 4 |
| 6 | Audit the remaining `if (!r.ok) ... break/return` sites in `worker.js` for the same "failure becomes a plausible zero" shape | me | Open |

## The rule worth keeping

**A count of zero is a claim, and it needs to be able to fail loudly.** Any code path that turns an
error into an empty result must record that it did so. And a health check that only measures
liveness will confirm whatever story the broken thing is telling.
