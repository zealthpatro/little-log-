# Logging a dose straight from the notification, and Live Activity

Designed 2026-08-13, after push was proven end to end on every platform (a real cron-driven
notification reached a real iPhone the same night). Founder's ask, verbatim:

> "there is no live activity and nothing on the dynamic island to let me update directly with a CTA
> on the push that doesnt make me open the app just records it"

Three facts verified directly against `main` before anything below was designed:

- `worker.js:655` sends the reminder with NO `apns` block and no category. That is *why* there is no
  button: nothing ever asked for one.
- `capacitor.config.json:27` sets `skipNativeAuth: true`, documented as deliberate at
  `app/store-firebase.js:509`. The device therefore has NO native Firebase identity, which kills the
  obvious "get an ID token in the background handler" design.
- `app/store-firebase.js:1850` writes events as `eventsRef.doc(String(id)).set(...)`, keyed by the
  client's own id. A deterministic id makes the write idempotent for free.

# Dose from the notification: implementation spec

Everything below is read against `main` at `b5285a8` in `/Users/m1promax/Downloads/little-log-pwa`. The worktree at `.claude/worktrees/strange-yonath-958608` is **not** stale: both trees are `little-log-v305` (`app/sw.js:3`). Lane 2's claim that this worktree is at v228 is wrong; I checked both.

---

## 1. The honest answer

### Ask A: a button on the notification that logs the dose without opening the app

**Possible. Not cheap. Needs a new iOS binary, and the blocker is not the one you would guess.**

Three corrections to the brief's ground truth, all verified:

- **`worker.js:655` has no `apns` block at all.** The reminder send is `{ message: { token, notification:{title,body}, data:{tag}, webpush:{fcmOptions:{link}} } }`. There is no `cat` on the reminder path either (`cat` exists only on the campaign send, `worker.js:414`). The only `apns` payload in the repo is the manual test at `tools/push_send_test.js:88-92`. **No delivered notification carries an `aps.category`, so no notification can render a button today.** That is why there is "no CTA on the push": nothing ever asked for one.
- **Nothing in the current binary can register a notification category.** `@capacitor-firebase/messaging` 8.3.0 exposes 13 methods (`FirebaseMessagingPlugin.swift:16-30`) and none of them is `setNotificationCategories`. `createChannel` is Android-only. There is no JS route to a button.
- **The real blocker is that the device has no Firebase identity.** `capacitor.config.json:27` sets `"skipNativeAuth": true`, and `app/store-firebase.js:509` states the invariant deliberately: the native SDK is kept out of the auth state so the JS SDK stays the single source of truth. `Auth.auth().currentUser` is nil on the Swift side. So "write to Firestore from Swift" and "call the Firestore REST API as the user" are both dead on arrival. `FirebaseFirestore` is not even linked (`ios/App/CapApp-SPM/Package.swift:26-39` lists 9 Capacitor plugin products and nothing else), and that file carries `DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands` at line 4.

The design that works keeps every credential off the device: **the Worker signs a capability at send time, puts it in the push payload, and the device echoes it back to a new `/api/dose`.** No Firestore SDK, no Keychain, no App Group, no new Xcode target, no new founder secret.

Split:

| Piece | Ships how |
|---|---|
| `aps.category` + signed nonce in the payload | Deploy `main` |
| `/api/dose` endpoint | Deploy `main` |
| Reminder index carries `medId`/`babyId`/`dose`/`unit`/`iv`/`sch` | Deploy `main` |
| Android + desktop Chrome button (`app/sw.js`) | Deploy `main` |
| **The button on the founder's iPhone** | **New TestFlight build** |

The server half is inert on today's installs: an iPhone whose binary has never registered `CUBBY_DOSE` receives an unknown category id and renders exactly the notification it renders now. So the server half can ship and be verified against a real phone before any Xcode work starts.

**What is not possible:** a button on iOS Safari web push. WebKit does not implement `actions` in `NotificationOptions`. The `app/sw.js` work buys Android and desktop Chrome only. Note also that in the wrapper the `app/sw.js` push listener never fires at all: native push arrives through APNs and the FirebaseMessaging plugin, not through Web Push. The sw.js branch and the Swift branch are genuinely separate clients of the same endpoint.

### Ask B: Live Activity / Dynamic Island

**Possible, entirely net-new, and it should not be the medicine.**

`grep -rn 'ActivityKit|LiveActivit|NSSupportsLiveActivities|DynamicIsland|WidgetKit|AppIntent'` across the repo (excluding `node_modules`) returns **zero hits**. `ios/App/App.xcodeproj` has exactly one target, `App` (`tools/cap_ios_configure.rb:190`). A Live Activity needs a Widget Extension target with its own bundle id and provisioning profile, `NSSupportsLiveActivities` in Info.plist, and a JS-to-native channel that does not exist. Because `/ios/` is gitignored, that target has to be created by `tools/cap_ios_configure.rb` through the `xcodeproj` gem or it evaporates on the next fresh checkout.

The strategic cost is bigger than the technical one: `capacitor.config.json:5-8` remote-loads `https://little-cubby.com/app/`, so today every pixel and every rule ships over the air. A Live Activity's layout and its `ContentState` live in the signed binary. **It is the first Cubby surface where changing what it says means an App Store round trip.** See §4 for what to build first.

---

## 2. The dose-from-notification design

### 2.1 Auth model, and why this one

Three candidates. I am rejecting two on read code.

- **Rejected: Firestore from Swift.** No native identity (`capacitor.config.json:27`, `app/store-firebase.js:509`). Getting one means either flipping `skipNativeAuth` to false (two auth sessions that can drift, which is the exact thing the comment says was avoided, plus the `signOut` path at `store-firebase.js:1426` and the deletion reauth path both need a second native call) or stashing the JS refresh token in the Keychain, which puts a full-account credential at rest on the device.
- **Rejected: the service worker reads the refresh token out of Firebase's IndexedDB and writes to Firestore REST as the user.** It does work on the web. `app/firebase-init.js:104` calls `setPersistence(LOCAL)`, and the vendored compat SDK maps LOCAL to IndexedDB (`firebaseLocalStorageDb`) with a `browserLocal` fallback, so the record is reachable from a worker. I am rejecting it anyway for one decisive reason: **it cannot serve the iPhone**, which is the device that prompted the request. Choosing it means building and maintaining two independent write paths for one button, and the second one puts a long-lived credential next to service-worker code. One path is better than two.
- **Chosen: a Worker-minted, HMAC-signed capability carried in the push payload, redeemed at `POST /api/dose`.** Platform-neutral: Swift and `sw.js` both just echo an opaque string. The device holds nothing, stores nothing, and cannot influence what gets written.

The Worker already holds the datastore scope (`worker.js:585`: `getAccessToken(sa, '...auth/datastore ...auth/firebase.messaging')`), so this grants it no new capability. It also already knows how to verify a Firebase ID token (`verifyFirebaseToken`, `worker.js:951`, used by `/api/account/purge` at `worker.js:809-812`), which stays available but is not usable here because the native side has no token to send.

**Key material: no new secret.** Derive the HMAC key with HKDF-SHA256 from `env.FIREBASE_SERVICE_ACCOUNT.private_key` with a fixed domain-separation info string (`cubby-dose-nonce-v1`). The Worker reads exactly seven env vars today (`ASSETS`, `FIREBASE_SERVICE_ACCOUNT`, `GAMES_DB`, `MAIL_FROM`, `NEWSLETTER_DB`, `RESEND_API_KEY`, plus three rate limiters), and the push-cron-403 lesson was that a *missing* secret killed delivery silently for months. Adding an eighth required secret adds an eighth silent-failure mode. Derivation cannot go missing while the cron itself works.

### 2.2 Nonce format

```
v1.<b64url(JSON payload)>.<b64url(HMAC-SHA256 over the first two segments)>
```

Payload, all short keys to stay well inside the 4KB APNs limit:

```json
{"u":"<uid>","h":"<householdId>","m":"<medId>","b":"<babyId>",
 "d":"<dose>","n":"<unit>","t":<dueAtMs>,"i":<intervalMs>,"s":"everyX|daily","x":<expMs>}
```

`x = t + 6h`. The cron already drops any reminder whose due time has passed (`worker.js:637-641`, `stale`), so the button only ever appears *before* the dose is due; six hours is generous room for a genuinely late tap and short enough that a nonce recovered from a device backup is not indefinitely useful.

Privacy note, stated plainly so nobody has to relitigate it: the medicine name and dose are **already** in the notification body in cleartext (`app/index.html:5247` builds `'Time for Amoxicillin 5ml at 3:00pm'`). Adding opaque uid/hid/medId strings discloses no new class of information.

### 2.3 Reminder index: carry the facts (`app/index.html:5247`)

Today's entry is `{at, due, cat, title, body, tag}`. Add:

```js
due.push({at:fireAt, due:at, cat:'critical', title:…, body:…, tag:'med-'+m.id+'-'+at,
          medId:m.id, babyId:(m.babyId||state.activeBabyId),
          dose:String(m.dose||''), unit:(m.unit||''),
          iv:medIntervalMs(m), sch:m.pattern.type});
```

`babyId` stated explicitly, never inherited, for the reason `addEvent` documents at `app/index.html:1739-1744`: a dose logged from one twin's alert must land in that twin's record. The tag already encodes `medId` and `at` (and `uid()` at `app/index.html:1597` is base36 with no dashes, so it would parse), but string-splitting a display tag to build a medicine record is exactly the implicit coupling that breaks silently. Write the fields.

The digest entry at `app/index.html:5255` gets **none** of this. It names several medicines and has no `medId`, so there is nothing to log and it must never carry a button.

The `slice(0,60)` cap at `app/index.html:5266` and the `nextAt` contract at `:5267` are unchanged. Six extra short strings per entry on a doc the cron reads 96 times a day is worth watching against the ~260-user ceiling; trimming the slice to 24 (still two days of reminders, given the 48h window at `:5241`) more than pays for it and is a reasonable same-PR change.

### 2.4 The send (`worker.js:644` and `worker.js:653-656`)

Plan builder at `:644` carries the new fields through:

```js
plan.push({ at, drop: stale, title: …, body: …, tag: _fsStr(f.tag) || 'cubby',
            medId: _fsStr(f.medId), babyId: _fsStr(f.babyId), dose: _fsStr(f.dose),
            unit: _fsStr(f.unit), due, iv: _fsNum(f.iv) || 0, sch: _fsStr(f.sch) });
```

The send at `:655`, **only when `msg.medId` is non-empty**:

```js
message: {
  token: tk,
  notification: { title: msg.title, body: msg.body },
  data: { tag: msg.tag, medId: msg.medId, medName: …, nonce: <signed> },   // all values must be strings
  apns: { headers: { 'apns-priority': '10', 'apns-collapse-id': msg.tag },
          payload: { aps: { category: 'CUBBY_DOSE', 'interruption-level': 'time-sensitive' } } },
  webpush: { fcmOptions: { link: 'https://little-cubby.com/app/' } }
}
```

FCM v1 merges `apns.payload.aps` with the `notification` block. `interruption-level: time-sensitive` is already proven on this pipeline (`tools/push_send_test.js:91`). `apns-collapse-id` is the APNs equivalent of the `tag` collapse `app/sw.js:95` already relies on. When `msg.medId` is empty (the digest), omit `apns` entirely and the notification is byte-identical to today's.

### 2.5 `POST /api/dose` (new, register alongside `worker.js:1144-1195`)

Request body is exactly `{"n": "<nonce>"}`. Nothing else. **The device cannot influence what gets written**, which is the property that makes the rest of §3 hold.

1. Method gate + rate limit, mirroring `worker.js:1144-1155` and `gameRateLimited` (`worker.js:1174` onward). Reuse `env.SIGNIN_RATE_LIMITER` rather than adding a fourth binding.
2. Verify the HMAC in constant time. Reject on bad signature, `now > x`, or `medId` failing `/^[a-z0-9]{1,64}$/i`. Return 401 with no detail.
3. `token = await getAccessToken(sa, 'https://www.googleapis.com/auth/datastore')`.
4. **Cross-channel already-logged check.** `:runQuery` on `households/{h}/events` with `where time >= (t - i)` `orderBy time DESC` `limit 100`, then filter `type==='medicine' && medId===m && babyId===b && !deleted` in the Worker. Filtering in the Worker rather than adding `medId` to the query is deliberate: `time` is a single field and therefore auto-indexed, whereas `medId == X orderBy time` needs a composite index, and there is **no `firestore.indexes.json` in this repo** (`firebase.json` declares only `rules`), so that would be a manual console step and a new `FAILED_PRECONDITION` failure mode of exactly the kind `worker.js:508-513` already guards against. If a matching dose exists, **do not write**: return `200 {ok:true, already:true, at:<last.time>}`.
5. **Write.** `POST {base}/households/{h}/events?documentId=dose-{medId}-{t}` with fields matching `commitDose` (`app/index.html:8831`) plus the `authorId` stamp the client's own push adds (`app/store-firebase.js:1850`):

   ```
   authorId: u, id: "dose-{medId}-{t}", type: "medicine",
   medId: m, medName: …, dose: d, unit: n, time: <Date.now()>, babyId: b
   ```

   `time` is **now**, not the due time. That is what `commitDose` does (`app/index.html:8831` uses `now()`, defined `Date.now()` at `:1596`) and it is what a doctor report needs. Set the `id` field equal to the doc id: the listener does `data.id = ch.doc.id` (`app/store-firebase.js:1616`) and keys `knownEvents` off it (`:1623`), so equality keeps the client's diff-push (`:1845-1852`) a no-op.
   `ALREADY_EXISTS` from `documentId=` is **success**, not error. Return `200 {ok:true, already:true}`.
6. **Tidy the schedule, last, and never let it undo step 5.** Logging a dose moves the next due time for a dose-anchored medicine: `medNextDue` for `everyX` is `last.time + hours` (`app/index.html:8600-8604`) and `medFireTimes` builds the whole 48h window from it (`:5219-5223`). `commitDose` calls `syncReminderIndex()` immediately for exactly this reason, with a comment saying a reminder naming a time that has already passed is worse than none at all (`app/index.html:8834-8838`). The Worker has no medicine model and must not invent times. It may only **delete** now-known-wrong ones: if `s === 'everyX'`, drop every remaining `push.due` entry whose tag starts with `med-{medId}-`, recompute `nextAt` from what is left, and PATCH. For `s === 'daily'` do nothing, because slot-based schedules do not move when a dose is logged and dropping them would lose a valid reminder. Use a read + `updateTime` precondition to avoid clobbering the cron's own `sentUpTo`/`nextAt` PATCH at `worker.js:672-679`; retry once, then give up silently. The dose write already succeeded and must never be rolled back by a tidy-up failure.
7. Belt and braces: record the nonce id in `pushLedger/{u}` (deny-all at `firestore.rules:79`, already the idempotency store, and `worker.js:400` uses exactly this shape for campaign `sends`).

**Provenance trade-off, stated honestly:** the Worker writes with the service account, so `firestore.rules:222` (`authorId == request.auth.uid`) is bypassed on this one path. The compensating control is that the nonce proves the write was authorised by a notification *we* sent to a token registered to that uid, which is arguably a stronger chain than an ordinary client write where the client simply asserts its own `authorId`.

### 2.6 iOS: category, delegate, handler

All native code is generated by `tools/cap_ios_configure.rb`, because `/ios/` is gitignored and `AppDelegate.swift` is regenerated by `npx cap add ios` (that script says so at line 146).

**(a) A new generated file, not a big regex.** `cap_ios_configure.rb` currently does small `sub!` patches on the Capacitor template (`:148-187`) and aborts loudly on template drift (`:182-187`), and it only adds *resources* to the target (`:196`). Extend it to `File.write` a complete `ios/App/App/CubbyDoseAction.swift` and register it as a source: `ref = group.new_reference(path); target.source_build_phase.add_file_reference(ref)` (the group is already resolved at `:191`). Writing a whole file is far safer than a large `sub!` into a template Capacitor may change.

**(b) Register the category on every launch.** Categories are process state, not persisted, so this belongs in `didFinishLaunchingWithOptions` (`ios/App/App/AppDelegate.swift:11-17`, right after `FirebaseApp.configure()` at `:15`). One idempotent added line, `CubbyDoseAction.shared.install()`, keeps the regex surface in the ruby script tiny.

```swift
UNNotificationAction(identifier: "CUBBY_LOG_DOSE", title: "Log this dose", options: [])
UNNotificationCategory(identifier: "CUBBY_DOSE", actions: [logAction],
                       intentIdentifiers: [], options: [])
```

`options: []` is load-bearing: it means **not** `.foreground`, so iOS runs the handler without bringing the app to the front. Do **not** set `.authenticationRequired`; forcing Face ID before a 3am dose log is hostile, and the action is reversible, not destructive. **One action, not two.** On iOS the buttons are not visible at a glance anyway (the banner must be pulled down or long-pressed), and a second action doubles the surface on the one thing that must not be wrong. Snooze is a deliberate v2, and it needs thought because a native local notification is a second alert channel the cron and `push.due` know nothing about.

**(c) Own the delegate, and forward everything else.** `CapacitorBridge.swift:215` sets `notificationRouter.handleApplicationNotifications` from config, and `NotificationRouter.swift:9-15` assigns `UNUserNotificationCenter.current().delegate = self`. That happens inside `CAPBridgeViewController.loadView()` (`:47-52`), which runs *after* `didFinishLaunchingWithOptions` returns, so Capacitor would clobber any delegate we set. Add `"handleApplicationNotifications": false` under `"ios"` in `capacitor.config.json` (read at `CAPInstanceDescriptor.swift:134-135`), then set our own delegate in `install()`.

We must then forward, or two things break silently:
- `willPresent` unconditionally, or foreground notifications stop appearing.
- `didReceive` for every `actionIdentifier` except `CUBBY_LOG_DOSE`, or the existing deep-link path dies. `@capacitor-firebase/messaging` registers itself as the router's `pushNotificationHandler` (`FirebaseMessaging.swift:21`), maps `actionIdentifier` to `actionId` (`FirebaseMessagingPlugin.swift:203-217`), and emits `notificationActionPerformed`, which `app/native-bridge.js:239-241` consumes to route deep links.

Forward by calling the router's own public methods on `(UIApplication.shared.delegate?.window??.rootViewController as? CAPBridgeViewController)?.bridge?.notificationRouter`. Two hazards, both real:

- `bridge` is nil until `loadView` runs (`CAPBridgeViewController.swift:6-8` returns `capacitorBridge`, created at `:48`). On a background launch it is nil. That is fine for our own action, which never touches the webview. For a default tap, which always foregrounds, hold the response and retry forwarding on the main queue every 100ms for up to ~5s. `notifyListeners(..., retainUntilConsumed: true)` means the event survives until JS is ready.
- **Never touch `rootViewController.view`.** `loadView` assigns `view = webView` at `:46`, so reading `.view` in a background handler would spin up a WKWebView and start fetching `https://little-cubby.com/app/` for a button tap. Read `.bridge` only.

I considered and rejected the cheaper trick of setting our delegate in `didFinishLaunching` *without* the config flag and letting Capacitor overwrite it on foreground launch. It "works" (background keeps our delegate, foreground keeps Capacitor's) but it gives the same button two different implementations depending on app state, and it depends on Capacitor's clobber ordering staying an accident. One owner, explicit forwarding.

**(d) The handler.**

```swift
guard response.actionIdentifier == "CUBBY_LOG_DOSE",
      let nonce = response.notification.request.content.userInfo["nonce"] as? String
else { forwardToCapacitor(response); return }

let bg = UIApplication.shared.beginBackgroundTask { }
// URLSession POST https://little-cubby.com/api/dose  body {"n": nonce}
// completionHandler() and endBackgroundTask(bg) ONLY in the response handler
```

The background-task assertion is the concrete difference from Capacitor's path, which calls `completionHandler()` synchronously the moment it hands off (`NotificationRouter.swift:52-58`) with no assertion at all. Without it the system can suspend the process mid-request. Plain `URLSession`, no SDK, no webview.

**(e) Close the loop, always.** The app never opens, so the only feedback channel is another notification, posted with a `nil` trigger:

- `ok:true` → "Logged. Amoxicillin 5ml at 3:02pm."
- `ok:true, already:true` → "Already logged at 8:02pm. Open Cubby to log another." (No name: the Worker would need an extra household read, and the name is right there when they open the app.)
- failure or timeout → "Couldn't log that just now." **and re-post the original notification with the same `CUBBY_DOSE` category**, so the button is still there to retry. That is five lines and it is strictly better than a native pending-write file plus a JS drain path, which is v2 at best.

A silent tap is the one outcome this whole feature must not produce.

### 2.7 Web parity (optional, same endpoint, ~30 lines)

In `app/sw.js:83-98`, probe rather than ship a browser allow-list: `const maxA = (self.Notification && self.Notification.maxActions) || 0;` and attach `actions: [{action:'dose', title:'Log it'}]` only when `maxA >= 1 && d.medId`. Unknown `NotificationOptions` members are dropped per WebIDL, so passing them on WebKit is harmless, but branch the *body copy* on `maxA` too, or the text would promise a button that does not exist. In `notificationclick` (`app/sw.js:100-111`) branch on `e.action === 'dose'` first: `e.waitUntil(fetch('/api/dose', {method:'POST', body: JSON.stringify({n: d.nonce})}))` then show a receipt with the same tag, and return without opening a window. Empty `e.action` keeps today's focus/openWindow path verbatim. Bump `CACHE` at `app/sw.js:3`.

While you are in there: `app/firebase-messaging-sw.js` is still precached (`app/sw.js:30`) and still has its own `notificationclick`. It is no longer registered anywhere (`app/index.html:5182-5185` explains why), but anything that re-registers it at `/app/` replaces `sw.js` by scope and evicts the push listener and the new action handler together. Delete it or strip its listeners.

---

## 3. The safety argument

### It cannot double-log. Four independent layers.

1. **The document id is deterministic.** `dose-{medId}-{dueAt}` with `?documentId=` on `createDocument`. A double tap, a cron retry (`worker.js:658-663` deliberately allows one repeat), a redelivered APNs message, and a notification tapped twice from the tray all collapse to `ALREADY_EXISTS`. Enforced by Firestore, not by our care.
2. **The cross-channel check catches what the id cannot.** If the parent already logged the dose *in the app*, that event has a random id (`uid()`, `app/index.html:1597`) and the deterministic id would not collide. Step 4 of §2.5 applies the same rule `logDose` applies at `app/index.html:8815`: a dose inside `medIntervalMs` is a dose already given. The Worker refuses and reports it.
3. **One notification per dose.** The `tag` replaces rather than stacks on web (`app/sw.js:95`) and `apns-collapse-id` does the same on iOS, so there is never a second stale banner carrying a second button.
4. **The app cannot re-create or delete it.** The listener merges an incoming doc into `state.events` and `knownEvents` together (`app/store-firebase.js:1616-1623`), and `stripMeta` strips only `authorId` (`:945`), so `pushNow`'s diff (`:1845-1852`) sees no change and its delete sweep (`:1853-1858`) sees the id present in `cur`. Neither fires. The windowed listener (`:1635`, `time >= bootCutoff`) sees it because `time` is now.

**Failures fail safe in one direction only.** A failed write produces "couldn't log", never a false receipt. A successful write that the device never hears about (network dies after the POST) produces "couldn't log" over a dose that *is* recorded, and the parent's retry hits `ALREADY_EXISTS` and gets an honest "already logged". Over-reporting failure, never success.

### It does not violate "never auto-log a dose"

The charter rule is: only a tap commits; the reminder only alerts.

- **The write has exactly one cause: a human tapping a button labelled "Log this dose."** No timer, no silent push, no background fetch, no `content-available` payload, no cron path reaches `/api/dose`. Make that a gate: assert in `test/` that `sendPushReminders` contains no reference to the dose endpoint.
- **The Worker cannot log a dose on its own initiative.** It needs a nonce, and a nonce only exists inside a notification we sent to a token registered to that uid, and it expires.
- **The device cannot log a dose it invented.** The POST body is one opaque string. Every field written comes from the signed payload the Worker itself minted. A compromised device can replay a nonce it already holds, and replay writes the same doc id, which writes nothing.
- **The already-logged question survives the medium change.** `logDose` asks one question made of facts before a second dose (`app/index.html:8814-8825`). A notification cannot show a sheet, so the Worker refuses the second write and tells the parent the fact instead. That is strictly more conservative than the in-app path, which offers "Log another" right there. Adding a force-nonce second tap ("Log another" as a follow-up notification action) is a clean v2 and preserves the rule, because it is still a tap.

---

## 4. Live Activity: build the nap timer first

**The nap timer is the right first Live Activity and the medicine is the wrong one.** Three reasons, in order of weight.

**It needs no server at all.** `state.timers` is already a shared field in the household blob, annotated `shared so an ongoing nap/feed shows on every phone` (`app/store-firebase.js:914`), and a running nap is already `{start: now()}` (`app/index.html:4112`, stopped at `:4125`). The entire `ContentState` is one `Date`. SwiftUI's `Text(timerInterval:countsDown:)` and `ProgressView(timerInterval:)` advance themselves in the Dynamic Island and on the Always-On display with no updates from the app. So: no FCM, no cron, no `worker.js` change, no per-activity push tokens, no `push-type: liveactivity`, no new secret. The whole feature is a `startActivity` on nap start and an `end` on nap stop.

**A nap is what a Live Activity is for.** It is a live, bounded, currently-happening thing with a start, a running duration, and an end the user controls. That is the contract. And it is genuinely useful: the second caregiver problem is the whole wedge, and "the nap started 42 minutes ago" glanceable without unlocking is the single most-asked question in the baby stage.

**The medicine is an anxiety amplifier in that form.** "Next dose in 3h 12m" is not an activity, it is an ambient countdown, and pinning it to the Lock Screen of a parent whose child is on antibiotics fails the Anxiety Test outright. Worse, the one moment the medicine countdown becomes interesting is the moment the dose is due, and that moment is already handled better by a notification with a button on it. If a medicine Live Activity ever earns its place it is as a *bounded dose window* ("dose due, 20 minutes left, [Log]"), started when the reminder fires and ended when it is logged, which is a different and much later feature.

Sequencing note that matters: an interactive Live Activity button (an `AppIntent` in the widget extension) is mechanically real on iOS 17+, but the button would need exactly the same server write path as §2. **Build `/api/dose` once and hang both off it.** That is the strongest argument for doing Ask A first regardless.

Practical constraints to state to the founder before anyone commits: the Dynamic Island itself only exists on iPhone 14 Pro and later; Lock Screen Live Activities work broadly on iOS 16.1+. And the UI ships in the binary, so every copy change is an App Store round trip.

---

## 5. Ship order

### Stage 1 — ships by deploying `main`. No binary, no Apple, no risk.
1. `app/index.html:5247` reminder index carries `medId`/`babyId`/`dose`/`unit`/`iv`/`sch`; digest untouched. (Consider trimming `slice(0,60)` at `:5266` to 24 in the same PR.)
2. `worker.js:644` plan builder carries them through.
3. HKDF key derivation + nonce mint/verify helpers in `worker.js`.
4. `POST /api/dose`, registered next to `worker.js:1144-1195`.
5. `worker.js:655` adds `apns.payload.aps.category = 'CUBBY_DOSE'`, `apns-collapse-id`, and `data.nonce`, **only when `msg.medId` is set**.
6. Gates: extend `test/push-delivery.test.js` (which already mirrors the worker loop in plain node and pins itself to the source); add tag-to-documentId round-trip including a medId containing digits; add an emulator case in the shape of `test/rules-test.js` proving a second create with the same documentId leaves exactly one event; add a nonce tamper/expiry case.
7. Verify against a real phone: `node tools/push_e2e.js`, and a real Android Chrome for the web branch. **Never diagnose push headless** (headless Chrome gets a 200 from FCM and never receives the notification).

Stage 1 is inert on every existing install. That is the point: you can prove the payload and the endpoint against the founder's actual iPhone before opening Xcode.

### Stage 1b — same deploy, optional, buys Android and desktop Chrome.
`app/sw.js:83-111` actions + `dose` branch, `CACHE` bump at `:3`, and delete or defuse `app/firebase-messaging-sw.js`. Note the one-launch SW update lag (`app/sw.js:121-127`): the button appears on the second open after deploy.

### Stage 2 — needs a TestFlight build. This is the founder's button.
1. `tools/cap_ios_configure.rb`: generate `ios/App/App/CubbyDoseAction.swift`, add it to `target.source_build_phase`, add the one-line `install()` hook to the AppDelegate patch block (`:148-187`), and extend the drift assertions at `:182-187` to cover it.
2. `capacitor.config.json`: `"handleApplicationNotifications": false` under `"ios"`.
3. Cut the build with `tools/cap_ios_build.sh` only. It asserts `aps-environment=production` (`:85-88`), which is the thing builds 1-5 and 8 got wrong.
4. Bump `NATIVE_PUSH_MIN` at `app/index.html:5045` to the new CalVer so the feature turns on for the wrapper. There is no boolean to flip by hand, which is correct: nobody can promise a push a binary cannot deliver.
5. **On-device check of all four cases, none of which shows up in a simulator smoke test:** plain tap (deep link still routes), button tap while the app is force-quit, button tap while the app is backgrounded, and a notification arriving while the app is open (foreground presentation still works, meaning `willPresent` forwarding is intact).

### Stage 3 — needs manual Xcode work beyond the build script.
The Live Activity. A Widget Extension target, its own bundle id, an App Store Connect app-id registration, a provisioning profile, `NSSupportsLiveActivities` in Info.plist, and a JS-to-native channel (no such plugin exists in `ios/App/CapApp-SPM/Package.swift`). All of it has to end up scripted in `cap_ios_configure.rb` via `xcodeproj` or it dies on the next fresh checkout. Scope and sequence separately. Do not bundle it with Stage 2.

---

## 6. What I would not build

- **A second action in v1.** Snooze needs a native local notification, which is a second alert channel that neither the cron nor `push.due` knows about, and on iOS both buttons are hidden behind an expand gesture anyway. One button, done properly.
- **A pending-write file on the device.** Lane 1 proposed persisting failed writes to the app container for the next JS boot to drain. It adds native file I/O plus a JS drain path plus a new class of "logged locally, invisible to the second caregiver" state, which defeats the shared circle. Re-posting the notification so the button is still there is five lines and strictly more honest.
- **The service worker reading Firebase's refresh token from IndexedDB.** It works, and I verified the mechanism (LOCAL maps to `firebaseLocalStorageDb`), but it cannot serve the iPhone, so choosing it means two write paths for one button and a long-lived credential adjacent to `sw.js`. Rejected on architecture, not on security.
- **Flipping `skipNativeAuth` to false, or linking FirebaseFirestore into the app target.** `app/store-firebase.js:509` documents why one auth session exists. `Package.swift` is regenerated and marked DO NOT MODIFY. Both are large, and neither is necessary once the nonce exists.
- **A `UNNotificationContentExtension` with custom UI.** Another target, another provisioning profile, App Group plumbing, and it buys a prettier expanded notification, not a working button.
- **A push-updated medicine Live Activity.** Per-activity push tokens and `push-type: liveactivity` are a channel `worker.js` does not speak at all, and the product is an ambient medicine countdown on a frightened parent's Lock Screen. See §4.
- **Recomputing the medicine schedule in the Worker.** It has no medicine model. It may delete now-wrong entries; it must never invent times. Migrating `medFireTimes`/`medNextDue` into `worker.js` would put the domain logic in two places and race the cron's own PATCH at `worker.js:672-679`.
- **A browser allow-list in `sw.js`.** Probe `Notification.maxActions`. It is honest today and self-corrects the day WebKit ships actions, which also makes the Firefox question irrelevant.
- **A new founder secret for the HMAC key.** Derive it. An eighth env var is an eighth thing that can be silently absent, which is precisely how push was dead for months.