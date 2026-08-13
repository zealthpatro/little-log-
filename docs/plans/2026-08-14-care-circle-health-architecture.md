# The care circle and the health record

**An architecture note on Cubby, written for a team building longitudinal chronic-illness management.**

Read against `main` in `/Users/m1promax/Downloads/little-log-pwa` on 2026-08-14, at `839d69b`
(`app/sw.js` = `little-log-v305`). Every structural claim below carries a `file:line`. Where a reason is
given, it is quoted or paraphrased from a comment, a design doc, or a post-mortem in this repo — the
reasons are the load-bearing part of this document, and they are not invented. Where I could not find a
recorded reason, I say so.

**On verification.** Seven subsystems were mapped and then independently fact-checked against the code by
a second pass. All seven maps came back needing correction, and the corrections clustered in one place:
**claims that something was enforced, when it was merely true today.** Those are corrected inline and
called out where they matter — §1.5 (author immutability has a legacy hole), §2.3 (`appBlobClean()` checks
key names, not content), §2.5 (an owner can plant any member's email), §2.6 (the Worker *is* a privileged
writer; `memberInfo.role` is spoofable), §1.4 (the retention window is client-computed), §5.3 (the
on-device photo promise is held by absence, not by a control), and §9 (**the gates do not block anything**).

That pattern is itself the most useful thing in this document. When you audit your own system, sort every
safety claim into *enforced*, *true today*, and *aspirational* — and expect the second bucket to be the
largest.

---

## 0. How to read this

Cubby is a baby and pregnancy app. That sounds far from chronic illness, and in the domain layer it is.
But strip the domain out and the remaining shape is exactly the one a chronic-illness platform needs:

> **A person whose health is tracked continuously for years, surrounded by a small circle of people who
> are not clinicians, who share responsibility unevenly, who each need a different slice of the truth,
> and who periodically have to hand a clinician a coherent summary of what happened.**

That shape is where the transferable engineering is. The parts worth taking are, in descending order of
value:

1. **The privacy architecture** (§2). Three tiers of data with different owners, an explicit consent list,
   and one category that can never be shared at all — all enforced in security rules, not in the UI. This
   is the piece I would copy first and change least.
2. **The treatment engine** (§4). Recurring medication with two schedule shapes, circle-wide alerting, and
   a reminder-delivery strategy that needs no push infrastructure.
3. **The protocol engine** (§5). A guideline template that varies by country, materialised into a per-patient
   record that survives the template changing underneath it.
4. **The per-user vs shared boundary** (§7). Cheap to get wrong, expensive to discover, and this repo has
   three named bugs from getting it wrong.

The parts to treat with suspicion are in §8, along with the honest gaps — the largest of which is that
**Cubby has no device integration at all**. If "machines" in your brief means CGMs, cuffs, pumps or
scales, there is nothing here to copy: every number in Cubby is typed by a human or read off a photograph.
See §8.3.

---

## 1. The care circle

### 1.1 The unit is a household, not a patient

A circle is a `households/{hid}` document (`firestore.rules:130`). The subject of care — the baby — is a
record *inside* it (`state.babies`, an array), not the thing membership hangs off. One household can hold
more than one subject; twins are a first-class case and the source of several bugs worth knowing about
(§3.2, §4.3).

For chronic illness this is the right default and worth preserving deliberately: **the circle is durable,
the patient record is what it wraps.** A household that can hold two subjects can hold a patient and their
ageing parent, or a patient whose care team persists across a transplant.

**But note the hard limit, because it is the one that will bite you first.** An account points at a circle
through `users/{uid}.householdId` — a **single scalar**. One account belongs to exactly one household.
There is no household switcher and no multi-circle support anywhere in the codebase.

For a baby app that is fine. For chronic illness it is disqualifying on day one: a professional carer with
four clients, an adult child managing both parents, or a patient who is also a carer cannot be expressed.
Fixing it later means changing the identity-to-circle relation from 1:1 to M:N, which touches every rule in
the file (`pm()` at `firestore.rules:217` resolves membership against a single `hid`) and every client
mirror. **Design this as many-to-many before you write your first rule.**

### 1.2 Two roles, and only two

`members` is a map of `uid → role` on the household doc. There are exactly two roles, `'owner'` and
`'caregiver'` (`firestore.rules:132-136`). There is deliberately **no view-only role**.

What the split actually buys, enforced server-side (`firestore.rules:199-213`):

| | owner | caregiver |
|---|---|---|
| edit shared household data | yes | yes |
| change membership or ownership | yes | **no** — `members` and `ownerId` must be byte-identical on a caregiver write |
| edit their own `memberInfo` | yes | yes |
| edit *another member's* `memberInfo` | yes | **no** — `onlyOwnMemberInfo()` at `:159` |
| edit or delete another member's log entries | yes | **no** — `:227-231` |
| set the `pro` entitlement | **no** | **no** — `proUnchanged()` at `:144` |

That last row is the one people get wrong. **No client, owner included, can grant entitlement.** `pro` is
writable only by the billing Worker using Admin credentials, which bypass rules entirely
(`firestore.rules:142-146`). If you take one thing from the role model, take this: the money-shaped field
must be unreachable from every client, including the most privileged one.

### 1.3 Joining, without letting the invitee read the house first

The subtle part of the invite flow is what an invitee is *not* allowed to see. The household document
carries the shared app blob and every member's name — so an invitee cannot be allowed to read it before
joining. Cubby resolves this with a narrow side-door (`firestore.rules:184-186`):

- The invite lives at `invites/{email}` (`:33`), keyed by lowercased email, and carries `householdId` and
  `role`.
- The invitee reads only that narrow doc.
- They then write *themselves* into `members` through the `invitedHere()` branch of the household `update`
  rule (`:206-213`).

Two guards on that write are worth copying verbatim:

```
request.resource.data.members.diff(resource.data.members).affectedKeys().hasOnly([request.auth.uid])
request.resource.data.members[request.auth.uid] ==
    get(/databases/$(database)/documents/invites/$(...)).data.get('role', 'caregiver')
```

The first restricts *which* member key may change. The second pins *what value it may take* — because, as
the comment at `:209-211` says plainly, `hasOnly()` restricts which key changes, never its value. Without
the second line an invitee could join as `owner`. That is a privilege-escalation hole that reads as closed
when it is not, and it is exactly the class of bug a security-rules review skims past.

There is also a token-based invite path at `inviteLinks/{token}` (`:82`), and the reason it was added is
worth knowing: **Apple's Hide My Email broke email-keyed matching by default**, so a flow that resolves an
invite by address silently fails for a large share of iOS users. The token is 22 base62 characters from
`crypto.getRandomValues` (~130 bits, `app/store-firebase.js:1277`), single-use, and expires in 24 hours
(`INVITE_LINK_HOURS = 24`). `claimInviteLink()` (`:1331`) **claims first** — `update({usedBy: uid})` —
*then* joins the household, so a race cannot produce two joins from one link. The doc deliberately carries
no patient data (`firestore.rules:65-67`), because a link token is a bearer credential and whatever the
document holds is readable by whoever has the URL.

When both an email invite and a token are present, the token wins: it is *"the more specific
instruction"* (`app/store-firebase.js:791-798`). And when a join intent matches nothing, the flow shows a
mismatch screen and **writes nothing** (`:818-831`) rather than guessing — which is the correct behaviour
for a system where guessing wrong means putting someone in the wrong family's health record.

### 1.4 Leaving, and the App Store rule that shaped it

`departingSelf()` (`firestore.rules:175-182`) exists because of a regulatory constraint, and the comment
says so: **App Store guideline 5.1.1(v) forbids gating account deletion on another person's cooperation.**
A caregiver must be able to delete themselves even if the owner never responds. But the ordinary
`isMember()` branch freezes the `members` map to prevent privilege escalation, which would also freeze a
member's own departure.

The resolution is a departure branch scoped hard enough that it cannot become an escalation path:

- exactly three keys may move — `members`, `memberInfo`, `formerMemberInfo`
- the writer must be **absent** from `members` afterwards
- each of those maps may differ only at the writer's own uid

So: no promoting, no removing anyone else, no touching `ownerId`, `deleteAfter`, `pro`, or the app blob.

**Deletion is always unilateral.** For a chronic-illness product with adult patients and adult carers,
this is not a nice-to-have; a carer who cannot leave a circle without the patient's permission is a
safeguarding problem, and a patient who cannot eject a carer is a worse one.

What happens to the data: the shared log **stays with the circle** — it is the household's record, not the
departing member's. The person's `members`/`memberInfo` entries go, but a `formerMemberInfo.{uid}`
tombstone is written so their past entries stay attributed forever
(`app/store-firebase.js:2571` on removal, `:2050` on self-deletion, where the name is blanked). The logs
themselves are never touched.

A sole member leaving sets `deleteAfter` and `deletionRequestedBy` (`app/store-firebase.js:2060-2061`),
after which the cron hard-deletes. **The 30-day grace is computed on the client**
(`Date.now() + 30*24*60*60*1000`) and the Worker simply honours whatever the field says — it queries
`deleteAfter <= now` (`worker.js:779`) and enforces no window of its own. So the grace period is not a
server guarantee: a client writing `deleteAfter: Date.now()` gets the household destroyed on the next
15-minute tick. If a retention window is a promise you make to users, compute it server-side.

**The deletion ordering is worth copying verbatim** (`worker.js:769-818`): subcollections first, then
`mhealth`'s nested level, then the parent document **last**, and on any partial failure the whole household
is abandoned untouched so the next tick retries (`:785-787`, `:809-811`). Deleting the parent first would
strand children that are unreachable but still present — and, as §2.6 notes, can flip a child's access
check into an open state.

### 1.5 Attribution, and the hole in its immutability

Every event and photo carries `authorId`, and the rules enforce (`firestore.rules:219-246`):

- **On create**, `request.resource.data.authorId == request.auth.uid`, unconditionally (`:222-223`). You
  cannot write an entry as someone else.
- **On update**, `authorId` is immutable — **but only once it exists**:

```
&& ( !('authorId' in resource.data) || request.resource.data.authorId == resource.data.authorId )
```

That first clause is a deliberate tolerance for the legacy tail — documents written before authorship was
introduced carry no `authorId`, and the household owner can inject an arbitrary one onto them.
`test/rules-test.js:111` asserts this on purpose ("owner backfills authorId on a LEGACY event"). The
exposure is narrow, because the caregiver branch (`:228`) requires `resource.data.authorId ==
request.auth.uid`, which fails when the field is absent — so only an owner can reach it. The identical
shape is on `/photos` (`:243`).

**Do not inherit "attribution cannot be re-forged" as an unqualified invariant.** It holds at create
always, and on update only for rows written after authorship shipped. You will have a legacy tail too.

One more detail that surprised me: **`addEvent` does not set `authorId` at all** (`app/index.html:1737`).
It is attached at sync time by the store. So the field is a property of the synced record, not of the
in-memory event, and any code path that reasons about authorship before sync is reasoning about a field
that is not there yet.

For a clinical record, implement this on day one and without the legacy clause. Retrofitting immutability
onto a field that has been mutable is a data-migration problem, not a rules problem — which is precisely
why Cubby still carries the tolerant version.

---

## 2. The privacy architecture

**This is the section to read twice.** It is the most directly transferable thing in the codebase, and it
is unusually well enforced for a client-only app.

### 2.1 Three tiers, three owners

Cubby splits health data into three tiers with genuinely different ownership:

| tier | where | who can read | who can write |
|---|---|---|---|
| **circle-shared blob** | `households/{hid}.app` | every member | every member |
| **circle-shared collections** | `households/{hid}/events`, `/photos` | every member | author, or owner |
| **per-record, circle-side** | `households/{hid}/notes`, `/memberEmails` | gated per document (§2.4, §2.5) | author only |
| **subject-owned private** | `households/{hid}/mhealth/{owner}/cat/{category}`, `/pregnancy/{owner}` | the owner, plus uids she has explicitly listed | **only the owner** |

The third row is easy to overlook and matters for you: **the codebase already has a precedent for
document-per-record, rules-enforced privacy on the shared side**, not only on the maternal side. When you
migrate something out of a shared blob because it needs per-recipient permissions, `notes` is the worked
example to follow — it is the same move, already made once here.

The third tier is the interesting one. `mhealth/{owner}/cat/{category}` (`firestore.rules:299`) is maternal
health, and the rule is blunt about the model: *the mother OWNS her health data.* It is not in the shared
blob. Each category is shared, by her explicit consent, only with guardian uids she lists in `sharedWith`.

Map this onto chronic illness and it is almost a drop-in: **the patient owns their record; the circle sees
what the patient has consented to, category by category.** The category axis is what makes it work — a
patient may want their spouse to see glucose and adherence but not psychiatric notes, and a per-record
boolean cannot express that.

### 2.2 The category that can never be shared

Mental health (`category == 'mood'`) is owner-only and **can never be shared, by anyone, including the
owner** (`firestore.rules:298`, enforced at `:302` on read and `:310-312` on write):

```
allow create, update: if ... && ( category != 'mood'
     || !('sharedWith' in request.resource.data)
     || request.resource.data.sharedWith.size() == 0 );  // mood is never shareable
```

Note what this is: not "sharing is off by default", but "the share list for this category must be empty,
and the rule rejects the write otherwise". The capability does not exist. A future product manager cannot
turn it on with a feature flag, and a compromised client cannot set it.

I would think hard before copying this exact stance — an adult patient arguably has the right to share
their own psychiatric data — but I would copy the *technique* without hesitation. Some categories in a
chronic-illness record (genetic results, HIV status, substance-use history, safeguarding notes) warrant a
sharing capability that is absent rather than defaulted-off, and the difference is one line in a rule.

### 2.3 Structural prevention: `appBlobClean()`

The most elegant thing in the rules file. Private data must never leak into the circle-shared blob, so
rather than trusting the client to keep them apart, the rule rejects any write whose blob contains the
private keys at all (`firestore.rules:147-155`):

```
function appBlobClean() {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['app'])
    || !request.resource.data.app.keys().hasAny(['pregnancy', 'mhealth', 'maternalHealth']);
}
```

Three details worth stealing:

1. It is checked **only when the blob is actually written** (the first clause), so a household whose stored
   blob still holds a legacy key is never bricked out of unrelated edits. Retrofitting an invariant onto
   live data needs this escape hatch or you strand your existing users.
2. The same invariant is enforced separately on `create` (`:192-195`), because `appBlobClean()` compares
   against `resource.data` and there is none on a fresh document. A create-path hole is the standard way
   this pattern fails.
3. The comment at `:151` says *"keep this key list in sync with `appBlobFromState()` in
   app/store-firebase.js"* — an honest admission that this is a two-place invariant with no automated link.
   If you copy it, generate both from one list.

**And one limit to understand before you rely on it.** The check is on **key names at the top level of
`app`**, nothing more. It blocks `app.pregnancy`, `app.mhealth` and `app.maternalHealth`. It does not stop
the same data being written under any other key, or nested one level deeper. It is a guard against the
accidental case — a refactor that reintroduces the old shape — not against a hostile client. That is still
worth having, and it is the realistic threat here, but do not describe it to a regulator as a control on
what the shared blob can contain.

### 2.4 Notes: per-recipient privacy without client hiding

`households/{hid}/notes/{noteId}` (`firestore.rules:252`) is a small, clean model for messages with an
audience:

- `audience` is either `'circle'` or a single member's uid.
- Read is allowed if audience is `'circle'`, **or** audience is you, **or** you wrote it (`:253-257`).
- `audience` and `createdBy` are **immutable after create** (`:266-269`), so a private note can never be
  flipped to circle-wide, nor re-attributed.

The comment at `:248-250` states the principle directly: each note is its own document *"so privacy is
enforced by rules, not client hiding."* If you put per-recipient content inside a shared blob and filter it
in the UI, you have not built privacy; you have built a UI convention that a network tab defeats.

There is a good worked consequence at `:262-265`. A "pinned" flag is **per member, not per circle**,
because clearing someone else's pin would require widening the update rule to every member — and a private
note addressed to a third person is not even readable by the person doing the clearing. The rule stayed
narrow and the UI changed instead. That is the correct direction of travel and a useful precedent to cite
when someone asks you to loosen a rule for a cosmetic feature.

### 2.5 Email addresses got their own collection

`memberEmails/{uid}` (`firestore.rules:283`) exists because emails used to ride inside the shared
`memberInfo` blob where every member could read every other member's address (`:274-282`). They now live
one-doc-per-member, readable only by that member and by owners, who genuinely need them for pending-invite
matching and cleanup on removal.

Two details: a member writes their own address and **it must match their auth token**
(`request.resource.data.email == request.auth.token.email.lower()`, `:288`); and self-delete deliberately
skips the membership check (`:290-292`) so account deletion can always clear a person's own address even
mid-departure.

State the anti-forgery property precisely, though: the rule is `(self AND email == token.email) OR
pm()[uid] == 'owner'` (`:286-289`), and **the owner branch carries no email constraint at all**. So a
member cannot plant a fake address, but *an owner can plant one for anybody*. The branch exists for the
lazy migration out of `memberInfo`, which runs on the owner's device. If you copy this collection, either
drop the owner-write branch once your migration is done, or accept that owners can rewrite contact details
for the whole circle — which in a care-team product with a password-reset flow attached to email is a real
account-takeover path, not a theoretical one.

The generalisable lesson: **contact details are not profile data.** They are the highest-value field in a
health circle for a social-engineering attacker, and they should not be in whatever blob everyone can read.

### 2.6 What is NOT enforced server-side

Be clear-eyed about this before adopting anything.

- **There are no Cloud Functions.** Server-side compute is a Cloudflare Worker (`worker.js`) plus the
  Firestore security rules. Any invariant not expressible in rules is effectively client-only.
- **But the Worker is a privileged writer, and there are three server-originated write paths.** Do not
  read "client-only app" as "the client is the only writer":
  1. the billing Worker `PATCH`es `households/{hid}?updateMask.fieldPaths=pro` with the admin service
     account (`workers/pro-billing/worker.js:132`);
  2. the 15-minute cron deletes whole households (`worker.js:769-818`);
  3. `/api/dose` writes an event under the Worker's own signature (`worker.js:1271`).

  This matters for one specific conclusion: the reason consent is not server-enforced is **design and
  priority, not the absence of a privileged server.** `worker.js` already holds
  `FIREBASE_SERVICE_ACCOUNT` and already writes into households. If you inherit the belief that
  server-enforced consent is structurally impossible here, you will fix the wrong thing.
- **Consent is client-only.** Recorded in this repo as an open gap. For a product with regulatory weight,
  this is the first thing you would have to change. It is weaker than "client-only" suggests, too:
  `householdGuardians()` returns a single uid by default, so the dual-guardian approval in
  `maybeCompleteConsent` (`app/index.html:5615`) — `gs.every(g => c.approvals.indexOf(g) >= 0)` —
  **completes on one approval** in an unmodified household. A two-party control that is satisfied by one
  party is worse than no control, because it reads as one in a review.
- **`memberInfo.role` is a spoofable display field.** `onlyOwnMemberInfo()` (`firestore.rules:159`) lets
  any member write *any field* of their own `memberInfo`, including `role`, and `openFamily()` renders the
  Owner badge from it (`app/store-firebase.js:2246`). Nothing escalates — every rule and `canEditEvent`
  read the `members` map, never this — but a caregiver can **display as Owner to the entire circle**. In a
  care-team product that is a trust failure, not a cosmetic one. Render authority from the authority
  field; `app/index.html:5727` does it correctly by reading `LL.members[u]`.
- **`sharedWith` is a plain list on the document.** The rules enforce that only the owner writes it, which
  is the right guarantee — but there is no audit trail of when consent was granted or revoked. A
  chronic-illness product almost certainly needs an append-only consent ledger, which this does not have.
- **`pregnancy` photo bytes** were historically circle-visible and were moved under the owner-gated parent
  (`firestore.rules:333-352`). The comment there documents a genuinely tricky case worth reading: after a
  kept loss the parent doc may be gone while keepsake bytes remain, so the owner branch deliberately needs
  no parent `get()` — she can always reach her own, and nobody else can. **Design your rules so that
  deleting a parent record never orphans a child's access check into an open state.**

---

## 3. The longitudinal record

### 3.1 The event model

One append-style array, `state.events`, of loosely-typed records. Common fields: `id`, `type`, `time`
(epoch ms), `babyId`, `authorId`, plus `deleted` for soft deletion and `editedBy`/`editedAt` when amended.
Everything else is per-type — a feed carries `method` and `amount`, a dose carries `medId`/`medName`/
`dose`/`unit`, a temperature carries `temp`/`unit`/`illnessId`.

`addEvent` is nine lines (`app/index.html`, `function addEvent`) and one of them is a safety rule; see
below.

**Soft deletion, not hard.** `lastDose()` filters `!e.deleted` (`app/index.html:8525`) rather than removing
records. Deleted entries land in a recoverable trash. For a clinical record you want this anyway, but note
that it puts the burden on every query to remember the filter — a `deleted` flag that one query forgets is
a resurrected record.

### 3.2 The multi-patient safety rule

This is the single most important paragraph in this document for anyone building multi-patient care.

`addEvent` defaults `babyId` to the currently-viewed patient — correct for a logging sheet, which is
always open on the patient you are looking at. It is **wrong** for an alert, and the comment says exactly
why:

> *"a dose alert can fire for one twin while you are looking at the other: that dose belongs to the child
> it was prescribed for, and stamping it with whoever was on screen puts a real medicine in the wrong
> baby's health record."*

So callers may state the subject explicitly, and the comment notes that **only the dose path does**.

Generalise it: **any write originating from an alert, a notification, a background task, or a deep link
must carry its subject explicitly.** Ambient "current patient" state is safe only for writes originating
from a screen the user is looking at. In a chronic-illness platform with a carer managing two parents, the
failure mode is identical and the consequence is a medication record attached to the wrong person.

### 3.3 Windowing, because longitudinal means large

The timeline was rebuilt after it became unusable on a real history: **498ms → 11ms per render, 27,570 →
3,297 DOM nodes** at 4× CPU throttle. The fixes, now invariants enforced by `tools/perf_check.js`:

- render through `paintShell`, never `app().innerHTML` — the `#scroll` node must survive or iOS loses
  inertial scrolling
- `paintTimeline` windows by `data-day` with progressive reveal
- network-driven repaints coalesce through `renderSoon()`
- no per-second document sweeps

Events load in two stages: a 120-day window first, then a background hydrate of the rest.

You will hit this on day one of a chronic-illness product, because "longitudinal" is the whole premise. The
budget is asserted by `tools/perf_check.js` (`logDomNodes` under 8000, `logMarkupKB` under 400, and a
completeness check that every day and every entry remains reachable — 121/121 days, 2520/2520 entries).
It is a manual gate, not a CI one — see §9.
**Copy the completeness assertion, not just the budget.** A windowing bug that silently drops a day is far
worse than a slow render, and only the completeness check catches it.

### 3.4 The refusal to predict

Cubby's fertility feature deliberately does **not** forecast. The stated reason, recorded in this repo's
market analysis: roughly 6.7% of Flo-style forecasts are correct, and a wrong prediction in a domain
someone is anxious about is worse than no prediction. The two-week-wait card is explicitly never a
countdown; `fertileEstimate.next` was removed rather than softened.

I raise it here because a chronic-illness platform will be under constant pressure to predict — flare
risk, hypo risk, adherence risk — and the discipline worth importing is: **show the trend, name the
uncertainty, and refuse the number when the number would be wrong often enough to hurt.** That is also the
safer regulatory posture, since a prediction is far closer to a medical device claim than a chart is.

---

## 4. The treatment engine

The most reusable subsystem after the privacy model.

### 4.1 The medicine record

```js
{ id, babyId, name, dose, unit,
  pattern: { type: 'everyX' | 'daily', hours: 6, times: ['08:00','20:00'] },
  remind: true, active: true,
  ics: { seq, days, slots, at } }     // set once a calendar course has been exported
```

(`app/index.html:8698` for the default draft; `:8801` for interval resolution.)

Two schedule shapes, and the distinction between them drives everything downstream:

- **`everyX`** — every N hours, **anchored to the last logged dose**. The schedule *moves* every time you
  log. Until a first dose exists the row reads *"Log the first dose to start the schedule"* (`:8669`).
- **`daily`** — fixed clock times from `pattern.times`.

A dose is logged as an ordinary event: `{type:'medicine', medId, medName, dose, unit, time, babyId}`
(`:8839`).

### 4.2 Reminders without a push server: the calendar export

This is the cleverest, cheapest idea in the codebase and it transfers wholesale.

Rather than build push infrastructure, `exportDoseCourse(medId, days)` (`app/index.html:6094`) writes the
course as an `.ics` file into the parent's **own** calendar. No APNs key, no cron, no server, no App Store
review. The phone then does the reminding, even when the app is closed.

The details that make it work rather than merely exist:

| detail | line | why |
|---|---|---|
| `UID:cubby-med-<medId>-<slotIndex>@little-cubby.com` | `:6109` | stable per medicine *and* slot, so re-export **updates** the same entries instead of duplicating them |
| `SEQUENCE:` incremented from `m.ics.seq` | `:6099,:6110` | the calendar treats the re-import as a revision, not a new event |
| `RRULE:FREQ=DAILY;COUNT=<n>` | `:6114` | **always bounded.** The inline comment: *"no open-ended 8am alarm forever"* |
| a past slot starts tomorrow | `:6106-6107` | the first entry is never in the past |
| `DURATION:PT15M` + `VALARM TRIGGER:PT0S` | `:6113,:6117` | alerts at the dose time, not before |
| a real `METHOD:CANCEL` path | `cancelDoseCourse` | *"Take these off my calendar"* actually removes them |
| **`daily` patterns only** | `:6079,:6096` | see below |

That last row is a product decision with a stated reason (`:8741`): *"Doses set to every few hours move
each time you log one, so a calendar entry would go stale without us being able to fix it. Set times can go
in your calendar."* Once exported, an `.ics` is outside your control forever — you cannot correct it, and a
stale medication alarm is actively dangerous. **So the export is deliberately restricted to schedules that
cannot drift.** `exportDoseCourse(medId, days)` takes no title or time parameter, and that missing
parameter *is* the policy.

For chronic illness this is close to a free win for every fixed-time therapy. It does not serve
titration-based or symptom-triggered dosing, which is exactly the boundary the `daily`-only restriction
draws.

### 4.3 Alerting across the whole circle

Two bugs are memorialised in the comments here, and both generalise.

**Alerts must scan every patient, not the visible one.** `alertMeds()` (`app/index.html:8512`) walks every
subject in the household. Previously it filtered by the active patient, so *"with twins the other twin's
overdue antibiotic produced no pill, no toast and no haptic until you happened to switch babies"* — while
the push index had always scanned all of them, so **the screen and the notifications disagreed**
(`:8505-8511`). The comment lands it: *"An alert that depends on which child you last looked at is not an
alert."* The subject is carried alongside the alert, because *"which twin got the 5ml"* is the one question
this must never blur.

**The "already alerted" ledger must be device-local.** `medLedger()` (`:8544`) is keyed by medicine **and
exact due timestamp**, so a single due event raises at most one alert ever. It lives in `localStorage` under
the uid, deliberately **not** in the synced household blob. The reason (`:8529-8542`) is subtle and worth
internalising: the previous guard, `m.lastNotified`, rode inside the shared document and was *"replaced
wholesale by every incoming snapshot"* — so any remote write authored before this device stamped it wiped
the guard and the next tick re-fired immediately. A ledger no other device can write cannot be wiped by one.

There is also a scoping principle stated there: *"'I have been told' and 'I waved this off' are facts about
a person on a phone, not about the household"* — so the other caregiver still gets their own single nudge.

For a chronic-illness platform with several carers and several devices, all three of these are direct
requirements, not lessons.

### 4.4 Push policy, and logging a dose from the notification

Push is **critical-only** by policy: due medicine, at roughly 30 minutes before, plus one daily digest.
Nothing else may notify. Quiet hours are client-side. Delivery is a Cloudflare Worker cron plus FCM. The
policy is stated as a constraint on the product, not a capability of the platform.

Web push delivery is **live** (`REMINDERS_LIVE = true`, `app/index.html:5038`). Native is separately gated
by build version, not by that flag: `remindersLive()` returns `isNativeApp() ? nativePushReady() :
REMINDERS_LIVE` (`:5054`), and `nativePushReady()` compares the wrapper's CalVer against
`NATIVE_PUSH_MIN = '2026.33'` (`:5045`). The recorded reason (`:5033-5044`) is a good one: builds at or
before 9 carry `aps-environment=development`, which production APNs rejects — so a wrapper user who tapped
On *"would be told reminders were on and then never get one"*. **A capability flag gated on the binary
that has to honour it** is a pattern worth copying for any therapy-critical alert shipped through an app
store.

**Just landed (2026-08-13, `d8337da`), and the most interesting piece for you:** logging a dose *from the
notification* without opening the app. Note the status honestly — **the server half is deployed and the
client half does not exist.** `CUBBY_DOSE` appears only in `worker.js:680` and in the design doc; no Swift
target registers the category, so no delivered notification renders a button today. The plan says so
itself: *"The server half is inert on today's installs."* The design (`docs/plans/2026-08-13-dose-from-notification.md`) is
worth reading in full because the constraint that shaped it is one you may share.

The device has **no native Firebase identity** — `capacitor.config.json:27` sets `skipNativeAuth: true`
deliberately, so the JS SDK stays the single source of truth (`app/store-firebase.js:509`). That kills the
obvious designs: "write to Firestore from Swift" and "call the REST API as the user" are both dead.

The design that works keeps every credential off the device:

> **The Worker signs a capability at send time, puts it in the push payload, and the device echoes it back
> to a new `/api/dose` endpoint.**

No Firestore SDK on the device, no Keychain, no App Group, no new secret. And because events are written
with a client-chosen deterministic id (`eventsRef.doc(String(id)).set(...)`,
`app/store-firebase.js:1850`), the write is **idempotent for free** — a double-tap or a retried delivery
cannot double-log a dose.

This is a strong pattern for any adherence-logging-from-notification flow, and idempotency-by-deterministic-id
is the detail most implementations miss. Note the honest limits recorded in the same doc: iOS Safari web
push cannot render action buttons at all (WebKit does not implement `actions` in `NotificationOptions`), so
the service-worker path buys Android and desktop Chrome only, and the iOS button needs a new binary.

---

## 5. Protocols: the vaccine engine

Read past the domain and this is **"a schedule of guideline-driven interventions that varies by
jurisdiction, reconciled against a paper record"** — which is the shape of most chronic-disease monitoring
protocols (retinal screening, HbA1c cadence, DMARD bloods, immunosuppressant levels).

### 5.1 Template and materialised record

`VAX_SCHEDULES` (`app/index.html:9497`) is a map of country code → `{ list }`, where each entry is
`[name, group, dueMonths]`. Twelve jurisdictions are carried — US (CDC), UK (NHS), UAE, Germany (STIKO),
India (IAP), Canada (NACI), Australia (NIP), Ireland (HSE), New Zealand, Singapore, Saudi Arabia, plus a
WHO general fallback (`:9542`). `vaxCountryKey()` falls back to `'who'` for anything unrecognised (`:9581`).

The patient's plan is **materialised** from the template, not referenced:

```js
state.vaccines[babyId] = scheduleFor(baby).map(([name, group, dueMonths]) =>
  ({ id: uid(), name, group, dueMonths, given: false, givenAt: null, note: '' }));
```
(`app/index.html:9595`; records also carry `estimated` and `missed`.)

### 5.2 The part worth copying: reconciliation on template change

When the country changes, the plan is rebuilt from the new template — but administered doses are preserved
by matching on **two independent keys** (`app/index.html:9609-9610`): by `name`, and by
`group + '@' + dueMonths`.

That double key is the whole trick. A guideline revision may rename a vaccine while keeping its slot, or
move a slot while keeping the name; matching on either alone loses real clinical history. **A patient's
record of what actually happened must survive the guideline it was created under changing.** For chronic
disease — where guidelines genuinely do get revised mid-treatment, and patients move countries — this is a
requirement, and it is one of the few places where getting the data model right early is much cheaper than
fixing it later.

### 5.3 The import path, and the on-device constraint

`app/vax-card.js` imports a vaccination record from a photograph of the paper card. Two constraints define
it:

- **Patch-only. It never invents a dose.** It fills in what it can read and leaves the rest alone.
- **The photograph never leaves the device.**

The second is the one to think about. Extraction runs locally, which constrains accuracy, and the product
accepts worse extraction in exchange for the image never being transmitted. For a chronic-illness product
handling discharge summaries, lab printouts or prescription photos, that trade is worth making consciously
rather than by default — and if you take the opposite trade, say so as plainly as this codebase says its
version.

**But be precise about how that promise is held, because it is not a control.** It is enforced by
*absence*: there is no `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` anywhere in the file's 344
lines. Nothing structurally prevents one being added. In fact the socket is already wired: `save()`
(`app/vax-card.js:314`) hands the full-resolution data URI to `window.cubbyKeepCardPhoto`, which is
undefined today — defining that one function turns the card photo into circle-shared Firestore bytes with
no other edit. There is no `connect-src` in the CSP (`_headers:7` sets only `object-src`, `base-uri`,
`frame-ancestors`, `upgrade-insecure-requests`) and `tools/vaxcard_test.js` makes no network assertion, so
nothing would catch it.

If you inherit this promise, inherit it as a **control**: a `connect-src` allowlist, plus a gate that fails
the build if the import path issues any request. A privacy claim held up only by nobody-has-added-it-yet
is one merge away from being false, and it is the kind of claim you will have put in a privacy policy.

Asserted by `tools/vaxcard_test.js` (29 checks, none of them network).

One more caution on this subsystem, since §5 pitches it as liftable: **the clinician-facing output is
paywalled.** `openDoctorReport` gates on `useTaste('pdf', 'Doctor PDF report')` (`app/index.html:9157`)
with `PRO_TASTE.pdf = 1` (`:4689`) — one free report, then a Pro wall, and the Pro feature list sells
"Doctor visit report (PDF) — recent days, growth, vaccines, medicines". A chronic-illness product that
copies the shape without noticing has put a paywall on the only artefact a clinician ever sees.

---

## 6. Episodes and the clinician report

### 6.1 The illness episode

```js
{ id, babyId, name, startedAt, endedAt, notes }
```

`endedAt: null` means active; `activeIllness()` resolves it. Measurements attach to the episode by
`illnessId` — temperatures (`tempEvents(ill.id)`) and symptoms are ordinary events carrying that foreign
key (`app/index.html`, `renderIllness`). Medicine doses are correlated by time window rather than by
`illnessId` (`e.time >= ill.startedAt`).

The episode view computes: day count since onset, the temperature series (unit-normalised between C and F
before charting), fever classification via `isFever(temp, unit)`, the recent symptom list, and doses given
within the episode.

**This is the closest structure in Cubby to a chronic-disease episode, and it is the piece that needs the
most work for your use case.** An acute illness has a start and an end; a chronic condition has neither.
What generalises is the *linkage* pattern — a durable episode record with heterogeneous measurements
attached by foreign key, rendered as one timeline. What does not generalise is the assumption of
resolution: `endedAt: null` meaning "active" is fine, but a chronic condition never gets an `endedAt`, so
anything that treats "no end date" as "acute and ongoing, expect resolution soon" will mislead. You would
want flares as sub-episodes within a permanent condition record.

### 6.2 The visit summary

`openVisitSummary()` generates a one-tap summary of the last week, "ready to read out". The product reason
is recorded and is a good one: the visit summary used to be reachable only from four places that all
required a *sick* baby or a doctor record with a date already entered — so *"a parent with a well baby and
a routine Friday check had no path to it at all, which is the one thing an exhausted first-timer said she
actually wanted from this app"* (`app/index.html:8843-8846`). It is deliberately free; only
`openDoctorReport` inside it spends a Pro credit.

The generalisable design note: **the clinician-handoff artefact must be reachable from the patient's
ordinary state, not only from the exceptional one.** Most chronic-illness appointments happen when the
patient is stable, and a report that only materialises during a crisis is a report that is never ready when
it is needed.

Care-team records (`b.doctors`) and allergies sit alongside, with visits logged as events of type `visit`.

---

## 7. Sync, state, and the boundary that keeps biting

### 7.1 Local-first, with a split representation

Local state is one `localStorage` key, `little-log-v1`. Remotely the household is **not** one blob — it is
a document plus subcollections:

- `households/{hid}.app` — the shared blob: `babies`, `settings`, `milestones`, `meds`, `vaccines`,
  `illnesses`, `photos`, `handoff` (`appBlobFromState()` in `app/store-firebase.js`)
- `households/{hid}/events`, `/photos`, `/notes`, `/memberEmails` — subcollections, per-document rules
- `households/{hid}/mhealth/{owner}/cat/{category}`, `/pregnancy/{owner}` — subject-owned private

The split is not arbitrary: **anything needing per-document permissions had to leave the blob**, because a
blob has exactly one ACL. Notes are the clearest case (§2.4). If you are designing this fresh, let the
permission model choose the granularity, not the convenience of a single write.

### 7.2 The per-user vs shared boundary, and three bugs

`state.settings` is the **shared household** blob. Putting a personal preference in it means one caregiver
silently changes it for everyone. This happened three times, and all three are documented in the comments
of `appBlobFromState()`:

1. **`seen`** — coach marks, tips, the get-started checklist. Whoever opened Cubby first marked every hint
   as already-explained for the co-parent and every later caregiver. Now `localStorage` keyed by uid.
2. **`push`** — reminder on/off and quiet hours. A push token belongs to one device, so the enabled flag
   must too. In the shared blob, caregiver B saw *"On for this device"* they never enabled, and B tapping
   Off wrote `enabled:false` back to A, **stopping A's reminder index from refreshing**. That is a
   medication reminder silently disabled by someone else's tap.
3. **`theme`** — one caregiver choosing Night darkened the app for the whole circle.

The rule that came out of it: **per-user preferences go to `localStorage` keyed by uid (device/UI-scoped)
or to `users/{uid}` (should follow the person across devices); only genuinely shared state goes in the
household blob.**

Bug 2 is the one to take seriously. In a chronic-illness product the same shape is "carer B's phone turned
off carer A's insulin reminders", and it would be invisible until someone missed a dose. When you audit
your own shared state, sort the fields by *what happens if another member's value overwrites mine* and
start at the top.

Note also the migration discipline visible in the same comments: these fields are stripped on the way
**out** only. `applyAppBlob` still *reads* an existing `settings.theme`, and a migration path uses it as
input, so households on older builds are not stranded. Removing a field from a synced schema is a two-sided
change and this codebase gets it right.

### 7.3 Offline, and which promises you may make

Two service workers: `app/sw.js` (scope `/app/`) and a root `sw.js` (scope `/`) for the marketing and
article surfaces. **CacheStorage is per-origin, not per-worker**, so each worker deletes only its own name
prefix on activate — a lesson learned when one worker's cleanup deleted the other's precache.

The part worth importing is a *trust* rule, asserted by `tools/offline_gate.js` (40 checks): **which
offline messages may promise a queue.** An action that will genuinely be retried when connectivity returns
may say so. An action that will not — sign-in being the clear case — must not, because "we'll send it when
you're back" is a lie the user acts on. The gate exists because a shared error-formatting helper was
appending a queue promise to paths that had no queue.

For a chronic-illness product this is a patient-safety issue, not a copy issue. "Your dose was recorded"
when it was not is the worst string in the product. Enumerate every offline-failure message and classify it
as *queued* or *lost*, and put a test on it.

---

## 8. What to copy, what to replace, what to avoid

### 8.1 Copy nearly as-is

- **The three-tier data model and `sharedWith`** (§2.1). The strongest idea here.
- **A never-shareable category** (§2.2) — the technique, whatever you choose to apply it to.
- **`appBlobClean()`-style structural prevention** (§2.3), including the create-path duplicate and the
  only-when-written escape hatch.
- **Author immutability on create and update** (§1.5) — but implement it *without* Cubby's legacy-tolerance
  clause, and stamp `authorId` at write time rather than at sync.
- **Deletion always unilateral, scoped to a hard-bounded rule branch** (§1.4).
- **Deterministic client-chosen ids for idempotent writes** (§4.4).
- **Alerting scans every patient; the alerted-ledger is device-local** (§4.3).
- **Explicit subject on every non-screen-originated write** (§3.2).
- **Template → materialised record with double-key reconciliation** (§5.2).
- **The offline queue-promise classification** (§7.3).

### 8.2 Replace

- **The domain models.** Feeds, nappies, milestones, vaccines-as-such. The *shapes* survive; the contents do
  not.
- **The episode model** (§6.1) — needs flares-within-a-permanent-condition, not start/end.
- **The two-role model** (§1.2). Chronic illness has a role Cubby deliberately lacks: a **clinician**, who
  needs read access to a slice, for a period, with an audit trail, and who is not a household member. And a
  patient who loses capacity needs a delegation path with a legal shape that "owner/caregiver" cannot
  express. Design this before you have users, not after.
- **The one-account-one-circle relation** (§1.1). The single hardest thing to change later, and
  disqualifying for professional carers and for anyone managing two relatives. Make it many-to-many first.
- **The 30-day retention window** (§1.4) — move the computation server-side if you promise it.
- **Consent** (§2.6) — client-only here; you will need it server-enforced and append-only.

### 8.3 Be aware of, and do not copy

- **No device integration whatsoever.** Every value is typed by a human or read from a photo. There is no
  ingestion pipeline, no device pairing, no units/normalisation layer beyond ad-hoc C/F conversion at the
  render site, and no concept of an observation's *provenance* (device vs human vs imported). If "machines
  and metrics" is central to your platform, this is a greenfield subsystem for you, and I would design
  provenance and unit-normalisation into the event model from the first commit rather than bolting them on
  — Cubby's per-type ad-hoc fields would not survive it.
- **No server-side compute beyond a Worker.** No Cloud Functions. Every invariant that cannot be expressed
  in security rules is client-only.
- **The single 12,300-line `index.html`.** It works, and the render invariants around it are well defended,
  but it is not a structure to imitate. Note in particular that **CSS lives in two homes** — the inline
  `<style>` and injected JavaScript strings in `app/cubby-extras.js` — which hid real bugs for months.
- **Two-place invariants.** `appBlobClean()`'s key list and `appBlobFromState()` must be kept in sync by
  hand (§2.3). Generate them.
- **No consent audit trail** (§2.6), and a dual-guardian control that completes on a single approval.
- **Gates that are documentation, not automation** (§9). Copy the gates; add the CI they lack.
- **Privacy promises held by absence rather than by controls** (§5.3). The vaccine-card photo never leaves
  the device because nobody has written the upload — not because anything stops them.
- **Soft-delete purge that depends on who boots.** `purgeRecentlyDeleted` only drops rows where
  `canEditEvent(e)` holds, so a caregiver's boot never purges another member's tombstones and an
  uninstalled client never purges at all. Retention is weaker than "30 days" implies. Do this server-side.

---

## 9. The thing that actually made this codebase reliable

Not the architecture. The gates — with one large caveat you must read before copying the practice.

**They do not block anything.** I described them as blocking in an earlier draft and that was wrong.
`.github/workflows/` contains only `seo.yml` and `teach.yml`; the root `package.json` has no `scripts`
block at all; there is no `pre-commit` hook in this checkout. `perf_check`, `stack_check`, `uitest`,
`smoke`, `offline_gate` and the rest are **run by hand**, and the discipline that keeps them green is human
process written down in `OPERATIONS.md`, not machinery. The rules suites (`test:rules`,
`test:invitelink`) need a local Java emulator and are documented at `OPERATIONS.md:189-190` as *"Both must
be green before publishing rules"* — a sentence, not a pipeline.

That distinction matters enormously for you. A regulated product cannot rest a safety argument on a
checklist somebody ran. **Copy the gates and then do the thing this repo has not done: wire them into CI.**
The artefacts are excellent; the automation is missing.

With that said, the design pattern is the transferable part: **each gate asserts a rule and explains, in a
comment, the bug that caused it to exist.** A sample:

| gate | asserts |
|---|---|
| `dosecal_test.js` (22) | the dose `.ics` is bounded, cancellable, set-times-only |
| `medalarm_test.js` | dose alerts fire for every patient, once per due event |
| `vaxcard_test.js` (29) | import is patch-only, never invents a dose, stays on device |
| `offline_gate.js` (40) | which offline messages may promise a queue |
| `perf_check.js` | render budgets **and** that no day or entry is lost to windowing |
| `stack_check.js` | spacing, measured on the rendered page across ten surfaces |
| `thirdparty_gate.js` | no third-party origin is contacted from any surface |

Two disciplines behind them are worth more than the gates themselves:

1. **Every gate must be able to fail.** Several here deliberately reintroduce the original bug and assert
   that the gate catches it. Two gates in this repo were found to be structurally incapable of failing —
   one matched an exception list while ignoring the value it recorded, so a *fixed* item was silently
   skipped forever; another passed only because its test fixture was empty. A green suite is worthless if
   nobody has proved it can go red.
2. **Every P0 gets a blameless 5-Whys** in `docs/postmortems/`, with a real root cause and a corrective
   action that is usually a new gate. That is why the comments quoted throughout this document exist, and
   why they were worth quoting.

For a chronic-illness platform, `thirdparty_gate.js` deserves special mention: it walks every surface and
fails if any third-party origin is contacted. It is currently **red** — Cloudflare Web Analytics is
injected at the zone level, contradicting a published "no third-party trackers" promise, and it can only be
switched off from the dashboard. The gate stays red rather than being silenced, which is the correct
handling of a known unfixed gap and a good norm to adopt: **a gate you cannot currently pass should stay
red and visible, not be commented out.**

---

## Appendix: primary sources

| what | where |
|---|---|
| permission model | `firestore.rules` (23KB, heavily commented — read it end to end) |
| storage rules | `storage.rules` |
| shared-blob boundary + sync | `app/store-firebase.js`, `appBlobFromState()` |
| medicines, doses, alerts | `app/index.html:8500-8850` |
| calendar export | `app/index.html:6077-6130` |
| vaccines | `app/index.html:9497-9800`, `app/vax-card.js` |
| illness + visit summary | `app/index.html`, `renderIllness`, `openVisitSummary` |
| dose from notification | `docs/plans/2026-08-13-dose-from-notification.md`, `worker.js`, `app/sw.js` |
| design canon | `DESIGN.md` |
| gates and runbooks | `OPERATIONS.md`, `tools/` |
| post-mortems | `docs/postmortems/` |

**A caveat on freshness.** The medicine and notification subsystem was being actively changed while this
was written — `d8337da` ("the server half") landed 2026-08-13 and the iOS half is not built. Re-read §4.4
against `main` before relying on it.
