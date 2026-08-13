# Push: guaranteed delivery, categories, and server-enforced caps

**Written 2026-08-13. Every claim below carries a file:line and was read, not assumed.**

The founder's policy, which supersedes the old "medicine-critical only, never non-critical" rule:

1. Every **intended** push must actually arrive. Reliability is the headline requirement.
2. **Marketing**: at most 2 per month, and only to non-paying users. Pro users get none.
3. **Feature-release nudges**: at most 5 per month per user.
4. Those caps are enforced **server-side**. A client-side cap is not a cap.
5. Every user-intended alert should be deliverable as push, on every device and OS we support.

---

## 0. The thing to read first

**Push does not work today. On any platform. Not "is switched off" — cannot work.**

| Surface | Why it cannot deliver |
|---|---|
| Web, Android, desktop | Two service workers register at the **same scope** `/app/`. `app/index.html:5101` registers `firebase-messaging-sw.js` (the only file with `onBackgroundMessage`, at `app/firebase-messaging-sw.js:20`), and `app/index.html:12322` registers `sw.js` on every page load. `app/sw.js` has **zero** push listeners. A registration is keyed by scope, so the second script evicts the first on every load. |
| iOS wrapper | `ios/App/App/App.entitlements` declares `aps-environment: development`. `tools/cap_ios_build.sh:72` hand-signs the archive with that literal file, which bypasses the production substitution Xcode would normally do on export. A TestFlight or App Store build therefore carries a **development** APNs token, which production APNs rejects. |
| Android native | There is no shippable app. `android/` is a bare `npx cap add android` scaffold with no `google-services.json`, no signing config, and no build script in `tools/`. `android/app/build.gradle:48-53` logs "google-services.json not found ... Push Notifications won't work". |

On top of that, `REMINDERS_LIVE=false` gates the UI so nobody can register, and there are **zero push tokens** across all user documents.

The guard that was supposed to catch the iOS half has a hole exactly where it matters: `tools/cap_ios_build.sh:75-79` greps that the entitlement **key** is present and never checks its **value**.

So "deliver every intended push for sure" starts from zero delivered, not from a working system that needs caps bolted on. Build order matters more than usual here.

---

## 1. Reliability defects in the existing sender

These are live in `worker.js` today and each one silently loses a medicine reminder.

### R1. A failed send is recorded as delivered
`maxAt` advances in the collection loop **before** any FCM call, and `push.sentUpTo` is PATCHed regardless of the result. `fcmOk` only increments a counter.

```js
if (at > maxAt) maxAt = at;                     // cursor advances here
...
const fcmOk = await fetch(FCM).then(r => r.ok)  // result is never consulted
if (fcmOk) sent++;                              // only a metric
```

One transient 429 or 503, or the network throw caught on the same line, permanently consumes the message. There is no retry because from the cursor's point of view it was sent.

### R2. A run where every send fails reports healthy
`recordCronRun` stores only `{due, sent, userErrors, queryError}`, and `cronHealthy` is `fresh && !queryError && fallback !== 'failed'`. A tick that queued 40 reminders and delivered 0 logs `due:40, sent:0, userErrors:0` and `/api/health` says `cronHealthy: true`. This is the same shape as the July silent-403 incident.

**Fix:** record `failed` and make `cronHealthy` false when `sent === 0 && due > 0`, or when the failure ratio crosses a threshold.

### R3. A message dropped for being late is never reconsidered
A pre-dose reminder is dropped once `now > due`, and a digest once it is 20 minutes stale. That rule is correct on its own (better nothing than a late dose reminder). The bug is that `maxAt` already advanced, so the drop is indistinguishable from a delivery and nothing is recorded. The parent is told nothing, ever, and we cannot tell afterwards that it happened.

**Fix:** keep the drop, but log it as `dropped_late` in the delivery ledger so it is visible.

### R4. Dead tokens are never pruned
Nothing reads the FCM error body, so `UNREGISTERED` and `INVALID_ARGUMENT` tokens stay in `users/{uid}.push.tokens` forever, costing a request per fire.

### R5. `disablePush()` does not actually remove tokens
```js
set({push:{enabled:false, due:[], tokens:{}, nextAt:FieldValue.delete()}}, {merge:true})
```
Under `merge:true` an empty map merges nothing, so existing `push.tokens.<key>` entries survive. The comment directly above asserts the opposite. The web path also never calls `firebase.messaging().deleteToken()`; only the native path revokes at FCM (`app/native-bridge.js:233-235`).

**This is the opt-out path.** Under Apple 4.5.4 and GDPR, an opt-out that leaves a live token is not an opt-out.

---

## 2. Why the current shape cannot carry caps at all

### C1. A cap stored on `users/{uid}` is not a cap
`firestore.rules:11-13` is a blanket `allow read, write: if request.auth.uid == uid`. The user can write any field in their own document, including a send counter. Any cap kept there is advisory.

### C2. The send queue is authored by the client
`syncReminderIndex` writes `push.due` into that same self-writable document and the cron sends whatever it finds. Fine while the only category is "your own medicine on your own device". Not fine once the same pipe carries operator-authored categories, because a modified client could author them.

### C3. A queued entry has no category
The shape is `{at, due, title, body, tag}` and the Worker builds the FCM payload from title/body/tag only. Nothing to cap, count, or consent against.

### C4. A campaign cannot ride the existing array
`syncReminderIndex` does `set({push:{due: slice, ...}}, {merge:true})`. Firestore **replaces** an array field wholesale rather than unioning it, and the client rewrites this on enable, on any medicine change, and every 10 minutes via `maybeSyncReminders`. Anything the server appended is destroyed on the next client sync.

### C5. The Pro exclusion has no server-side path
`isPro()` is a client read of `window.LL.pro`, hydrated from `households/{hid}.pro`. The Worker's loop reads only `users/{uid}` documents and never resolves `householdId` to a household, so it cannot currently tell a paying user from a non-paying one.

### C6. Consent is in the shared household blob
`pushCfg()` reads and writes `state.settings.push`, and `state.settings` rides `households/{hid}.app`, which is last-write-wins and shared by every caregiver. So one person enabling push enables it for the circle, and one person's withdrawal is pushed into everyone's synced state. Consent is personal; this is the same class as the A5 per-user-prefs bug.

### C7. The Worker cannot evaluate quiet hours
Quiet hours are applied only client-side while building `push.due`. `_inQuiet()` is defined in `worker.js` and never called. No timezone is persisted anywhere; `Intl.DateTimeFormat().resolvedOptions().timeZone` is read once to guess a country for vaccine schedules and thrown away.

A server-initiated campaign therefore has no way to avoid 3am. **A marketing push at 3am to a parent of a newborn is indefensible**, so this is a gate on the whole feature, not a refinement.

---

## 3. Target design

### 3.1 Data model

Three documents. The split exists so that nothing a user can write can affect what they are sent.

**`users/{uid}`** — client-writable, unchanged ownership.
```json
{
  "householdId": "hh_abc",
  "push": {
    "enabled": true,
    "tokens": { "<fcmToken>": { "ua": "...", "at": 1786... , "platform": "web|ios" } },
    "tz": "Asia/Dubai",
    "quietStart": 21,
    "quietEnd": 7,
    "allow": { "critical": true, "feature": true, "marketing": false },
    "due": [ { "at": 1786..., "due": 1786..., "cat": "critical", "title": "...", "body": "...", "tag": "med-x-1786" } ],
    "nextAt": 1786...
  }
}
```
- `tz` is new and required before any server-initiated send.
- `allow` is per-user consent. `marketing` defaults **false** and can only become true by an explicit tap (Apple 4.5.4).
- `cat` is new on each queued entry. The Worker **only ever trusts `cat: "critical"` from this document**; anything else here is ignored, which neutralises C2 without needing to lock down the whole doc.

**`pushLedger/{uid}`** — service-account only, `allow read, write: if false` for clients.
```json
{
  "caps": { "ym": "2026-08", "marketing": 1, "feature": 3 },
  "sends": { "camp_septnews": { "at": 1786..., "state": "sent" } },
  "attempts": { "med-x-1786": { "n": 2, "lastAt": 1786..., "lastErr": "503" } }
}
```
- `caps.ym` is the month key. Rolling over is "if `ym !== currentYm`, reset to zero". Month boundary is decided in **the user's `tz`**, falling back to UTC when absent.
- `sends` gives per-campaign idempotency: a campaign is delivered to a user at most once, ever.
- `attempts` gives retry bookkeeping so R1 can retry without double-sending.

**`campaigns/{id}`** — service-account only.
```json
{
  "cat": "marketing|feature",
  "title": "...", "body": "...", "url": "https://little-cubby.com/app/?go=...",
  "audience": { "nonPayingOnly": true, "stage": null },
  "sendAfter": 1786..., "expiresAt": 1786...,
  "state": "draft|sending|done",
  "cursor": null,
  "stats": { "eligible": 0, "sent": 0, "capped": 0, "noConsent": 0, "failed": 0 }
}
```
`cursor` is the last uid processed, so a fan-out that runs out of Worker time resumes on the next tick instead of restarting.

### 3.2 The delivery algorithm, per cron tick

1. **Critical reminders** — as today, but:
   - process due entries in ascending `at`
   - only advance the cursor past an entry that was **delivered to at least one token**, or **deliberately dropped as late** (recorded as `dropped_late`)
   - on a send failure, freeze the cursor there and write `attempts` — the next tick retries. Duplicate risk is bounded by the FCM `tag`, which collapses in the OS notification centre.
   - prune any token FCM reports `UNREGISTERED` / `INVALID_ARGUMENT`
   - `cat` is forced to `critical`; never capped, never consent-gated beyond `allow.critical`, and quiet hours only **soften** it (existing behaviour: a due dose still speaks, more gently)
2. **Campaign fan-out** — for each `campaigns/*` with `state: sending` and `sendAfter <= now`:
   1. page users from `cursor` (bounded batch, so a tick never runs long)
   2. skip if `push.enabled` is false or there are no tokens
   3. skip unless `push.allow[cat]` is true → count `noConsent`
   4. if `audience.nonPayingOnly`, resolve `householdId` → `households/{hid}.pro`; skip if Pro → count `capped`
   5. read `pushLedger/{uid}`; roll the month over if `ym` is stale; skip if `caps[cat] >= limit` (marketing 2, feature 5) → count `capped`
   6. skip if `sends[campaignId]` already exists (idempotency)
   7. **quiet hours in the user's `tz`**: if now is inside their quiet window, do not send and do not consume the cap — defer to the next tick
   8. send; on success increment `caps[cat]` **and** write `sends[campaignId]` in the same PATCH
   9. advance `cursor`
3. **Health** — record `{due, sent, failed, dropped, capped}` and make `cronHealthy` false when `due > 0 && sent === 0`.

**Which way we err on a partial failure:** increment the counter only after a successful send. So a crash between send and increment can allow one extra send in a month. Over-counting would silently swallow a message the founder intended to deliver, and requirement 1 outranks a strict cap.

### 3.3 Firestore rules

```
match /pushLedger/{uid} { allow read, write: if false; }   // service account only, bypasses rules
match /campaigns/{id}   { allow read, write: if false; }   // no client ever reads or writes a campaign
```
`users/{uid}` keeps its blanket self-write; the Worker's "only trust `cat: critical` here" rule is what makes that safe.

### 3.4 Client changes

- `pushCfg()` moves off `state.settings.push` to `users/{uid}.push` so consent is per person, not per household. This is the same fix pattern as the A5 per-user-prefs bug.
- Persist `tz` on enable and on any change.
- `disablePush()` must actually clear tokens: use `FieldValue.delete()` per token key, and call `firebase.messaging().deleteToken()` on web.
- Register **one** service worker at `/app/`, with the push handler in it. Either fold `onBackgroundMessage` into `sw.js`, or register `firebase-messaging-sw.js` at a distinct scope. Folding is simpler and removes a whole class of ordering bug.
- New consent UI in the Reminders sheet, three rows, marketing off by default:

> **Dose alerts** — a nudge when a medicine is due. Always on when reminders are on.
> **New in Cubby** — an occasional note when we add something. At most five a month.
> **Offers** — news about Pro and anything we charge for. At most two a month, and never if you are on Pro.
>
> You can change any of these whenever you like, and turning them off takes effect straight away.

### 3.5 Copy that becomes false

| Where | Now | Must become |
|---|---|---|
| `features/index.html:202` | "The only notification Cubby ever pushes is a medicine dose, around the time it's due." | "We never push a feed, a streak, or guilt. Dose reminders are the only thing that is on by default." |
| `faq/index.html:97` + `:351` | "medicine-only" | reminders are medicine by default; anything else is separately opted in. **JSON-LD and visible copy must move together.** |
| `faq/index.html:101` + `:359` | "medicine-only" | same |
| `privacy/index.html:53-73` | no notification data disclosed | add device token, timezone, quiet hours, notification consent to "What we collect", a notification purpose to "How we use it", and notifications to the withdraw-consent list |

### 3.6 Tests

| File | Proves |
|---|---|
| `test/push-delivery.test.js` | a failed send does **not** advance `sentUpTo`; a retry sends exactly once; a late drop is recorded, not silently consumed; dead tokens are pruned. Fails on today's `worker.js`. |
| `test/push-caps.test.js` | the 3rd marketing and 6th feature push in a month are refused; the counter rolls over on the month boundary in the user's tz; a Pro user gets zero marketing; a non-consenting user gets nothing; **critical is never capped**. |
| `test/rules-test.js` (extend) | a signed-in user cannot read or write `pushLedger/{uid}` or `campaigns/{id}`. |
| `tools/push_consent_test.js` | the Reminders sheet shows three categories, marketing is off by default, and turning one off writes to `users/{uid}` and not to the shared blob. |
| `tools/cap_ios_build.sh` | assert the entitlement **value** is `production`, not merely that the key exists. |

---

## 4. Build order

Nothing about caps matters until a push can arrive, so:

**Phase 1, foundation (nothing is deliverable without these)**
1. One service worker at `/app/` with a push handler — fixes web, Android, desktop
2. `aps-environment: production` + the build-script value assertion — fixes iOS
3. R1 cursor fix, R2 health accounting, R4 token pruning, R5 real opt-out
4. Prove one real push reaches one real device. Until this happens everything else is theory.

**Phase 2, categories and consent**
5. `cat` on queued entries; Worker trusts only `critical` from the client doc
6. Consent off the shared blob onto `users/{uid}`, three categories, marketing default false
7. Persist `tz`
8. Copy updates ship **with** this, never after

**Phase 3, caps and campaigns**
9. `pushLedger` + `campaigns` collections and rules
10. Cron fan-out with cap, consent, Pro and quiet-hour checks
11. An authoring path in `tools/ops.js` (localhost-only admin console)

**Founder-gated throughout:** the APNs key state in Firebase, publishing the rules, and Pro going live (until then `nonPayingOnly` matches everyone, which is correct but untested against a real Pro user).

---

## 5. Open decisions for the founder

1. **The vow.** `features/index.html:202` is a marked product vow with an ✕ icon. Marketing and feature pushes break it literally. Proposed reconciliation is in 3.5: keep the spirit ("never a feed, never a streak, never guilt"), drop the absolute.
2. **"2 per month" reading.** Implemented as 2 marketing per calendar month per non-paying user, Pro users zero. Say if you meant 2 ever, or 2 per campaign.
3. **Quiet hours vs a capped marketing send.** Design defers rather than consuming the cap, so a deferred offer still gets its slot. The alternative is to drop it and burn the slot.
4. **Android.** There is no app. Android users get web push through the PWA once Phase 1 lands. A native Android app is a separate project, not a setting.
