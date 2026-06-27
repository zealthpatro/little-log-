# Cubby Ops — internal admin & compliance console: design

2026-06-28 · status: **proposed, for review (no build yet)**. You are the data controller; this is the internal tool to (a) know exactly who's using Cubby and how, and (b) meet UAE PDPL obligations (access, erasure, audit). Not legal advice — confirm specifics with a qualified UAE advisor/DPO.

## 1. Principles
- **Full internal visibility, least privilege.** Owner (you) sees everything incl. PII; the role model is built in from day one so future teammates get scoped access (e.g. support = limited, analyst = aggregate-only, no PII).
- **Local-first & owner-only.** Runs on your machine with the service-account key. **Never** a public page; the key never touches a browser. (Remote access later only behind separate strong auth + IP allowlist.)
- **Audit everything.** Every admin view/action of PII is logged (who saw/did what, when). Required-spirit for PDPL and keeps us honest about the "mother-owned" promise.
- **Compliance-enabling.** First-class DSAR export + right-to-erasure, a record of processing, and a data-residency answer.

## 2. Architecture
- **Stack:** local Node tool using `firebase-admin` + `tools/serviceAccountKey.json` (gitignored secret; you place it, I never handle it). Admin SDK bypasses Firestore rules → complete read.
- **Two surfaces, same core:**
  - **CLI** (`tools/ops.js`, extends the existing `tools/analytics.js`) — fast snapshots + scriptable exports.
  - **Local dashboard** (`tools/ops.js --serve` → `http://localhost:PORT`) — an interactive, auto-refreshing HTML view (search, drill-down, action buttons). Bound to localhost only.
- **No new prod surface, no Cloud Functions** (Spark plan) — all admin logic runs locally against Firestore via the Admin SDK.

## 3. What it reads (existing collections)
`users` · `households` (members, memberInfo, formerMemberInfo, app blob, pro) · `collectionGroup('events')` · `photos` · `pregnancy` (owner-owned) · `mhealth` (owner-owned, maternal-private) · `invites` · `feedback` · `waitlist` · `notes`. Acquisition (`utm`/`ref`) lives on `users`/`waitlist`.

## 4. Views
**A. Overview (live aggregate)**
- Total users · signups today / 7d / 30d · DAU / WAU (distinct event authors) · last-active distribution.
- Activation funnel (reuse `funnel.js` leaky bucket): signed in → added baby → logged → came back (day 2+) → sticky (7+ days).
- Event-type mix, avg events/active household, Pro/waitlist counts, acquisition breakdown.

**B. Users / households table (the "specifics")**
- Searchable, sortable: name · email · signed-up · last active · household · role · stage (trying/expecting/baby + age) · #events · acquisition · Pro.
- Filters: active in last N days, stage, acquisition source, has-caregiver.

**C. Drill-down (per user / household)**
- Full record for support + legal: members + roles, babies/pregnancy, recent activity, photos count, invites, feedback. Maternal-private (`mhealth`/`pregnancy`) shown to **owner role only** and **audit-logged on view**.

## 5. Compliance actions (UAE PDPL)
- **DSAR export:** one command/button → a single user's complete data as JSON (and a readable PDF) to hand over on request.
- **Right to erasure:** delete/anonymise a user's data. **Careful semantics** (see open Q): sole-owner household → delete household + auth user + subcollections + their photos; shared household → anonymise the member (strip name/email from memberInfo/formerMemberInfo) and handle their authored events per policy, without nuking co-parents' data.
- **Record of processing:** a maintained `docs/compliance/record-of-processing.md` (what data, why, where, retention).
- **Audit log:** append-only (separate `opsAudit` collection with locked rules, or a local signed file) — actor, action, target user/household, timestamp, reason.

## 6. Roles (built in now, used later)
- `owner` — everything incl. maternal-private + actions. (You, today.)
- `support` (future) — user lookup + non-sensitive fields + DSAR export; **no** maternal-private, no erasure.
- `analyst` (future) — aggregate/funnel only, **no PII**.
Enforced in the tool (and, if ever remote, server-side). For now the key = owner; the scaffolding just keeps it clean to add people.

## 7. Security
- Local-only by default; `serviceAccountKey.json` gitignored, never bundled, never in a browser.
- Audit log is itself sensitive (it records who viewed whose PII) → locked-down storage.
- If remote access is ever wanted: a separate authenticated service (not little-cubby.com), IP allowlist, short sessions, full audit — explicitly out of scope for v1.

## 8. UAE PDPL notes (confirm with counsel — not legal advice)
Framework: **Federal Decree-Law No. 45 of 2021 (PDPL)**. This tool gives you the operational capabilities that support compliance — **DSAR fulfilment, erasure, audit trail, role-based access, security**. Two items to verify with a qualified advisor/DPO, which tooling alone can't settle:
1. **Lawful basis + record of processing** (and privacy-notice alignment).
2. **Data residency / cross-border transfer** — your Firestore is in whatever region the project was created in (often US/EU); I'll report the exact region. PDPL has cross-border rules; confirm whether residency or transfer safeguards are required.
(Also worth checking: breach-notification process, and whether a registered DPO is required at your scale.)

## 9. Phasing
- **P1 — visibility:** Overview + Users table + drill-down (CLI + local dashboard), reusing `analytics.js`/`funnel.js`. Answers "how many users + specifics" immediately.
- **P2 — compliance:** DSAR export, erasure (with the shared-household policy), audit log, record-of-processing doc.
- **P3 — roles:** wire the role model for teammates.
- **P4 (optional, later):** secured remote access.

## 10. Open questions (let's beat these)
1. **Shape:** CLI + local HTML dashboard (recommended) — or do you also want eventual secured remote access?
2. **Erasure in shared households:** delete vs anonymise the leaving member; what happens to events they authored (keep tombstoned vs reassign vs remove)?
3. **Audit log location:** Firestore `opsAudit` (queryable, but in the same DB) vs local append-only file (off-DB, simpler).
4. **"Active" definition:** any event written that day? app open? (We only reliably have event writes, not opens — opens would need a tiny first-party ping.)
5. **Data residency:** do you already know the Firestore region / have a UAE requirement, or should I just report the region and you take it to counsel?
6. **Scope of v1:** ship P1 visibility first, or P1+P2 (visibility + DSAR/erasure) together?
