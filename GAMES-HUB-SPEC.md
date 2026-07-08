# Cubby Games Hub — Phase 1 design

Generalize the single hosted "Boy or girl?" game into a small **games hub**: one calm,
account-free, shareable space where an expecting family can host a few light guessing games
for friends. Phase 1 ships the **hub shell + a Due-date & birth-stats pool**, and hardens game
ownership onto the host's real Cubby identity. Builds on [GENDER-GAME-SPEC.md](GENDER-GAME-SPEC.md).

Charter check: calm (no countdowns, no pressure — Anxiety Test), loss-safe (never auto-resurfaced;
owner-only reveal; never implies an expectation), inclusive (team-green friendly), privacy-max
(isolated `cubby-games` D1, no third-party trackers), and it nudges circle/activation (caring is a
team sport — guests need no account).

## What ships in Phase 1

1. **Hub shell** — one hub per pregnancy, one shareable link `/g/<hubCode>`. Guests join with just a
   nickname (no account), see the hub's open games, and play each.
2. **Due-date & birth-stats pool** — guests guess the arrival date (+ optional weight / length /
   time of day). Owner reveals the actual birth → "closest guess wins" + a gentle celebration.
3. **Auth hardening** — game ownership is proven by the host's **Firebase identity**, not a shared
   secret key.

"Boy or girl?" keeps working unchanged (see Backward compatibility) and gets folded into the hub UI.

## Data model — additive, no migration of live data

The live `games` / `guesses` tables (v115) are **left untouched** so existing shared links keep
working. Phase 1 adds three new tables in the same isolated `cubby-games` D1:

```
hubs       (code PK, owner_uid, title, created_at)
hub_games  (id PK, hub_code, type, prompt, status, result, created_at)   -- type: 'sex' | 'duedate'
hub_guesses(id PK, game_id, hub_code, nickname, guess, note, created_at) -- guess is type-shaped JSON/text
```

- `hubs.owner_uid` is the host's Firebase uid (an opaque id, **not** PII — never their email).
- `hub_games.result`: sex → `'F'|'M'|'MF'|'FF'|'MM'`; duedate → JSON `{date, weightG?, lengthCm?, timeOfDay?}`.
- `hub_guesses.guess`: sex → `'F'|'M'`; duedate → JSON `{date, weightG?, lengthCm?, timeOfDay?}`.
- Self-healing schema (`CREATE TABLE IF NOT EXISTS`), same pattern as today.

Privacy: the games D1 holds ONLY the host-entered hub title (public by design), the opaque owner uid,
and `{nickname, guess, note}` per guest. **Never** any family Firestore data, never the baby's real
name unless the host types it into the title.

## Auth hardening (the foundation, not just a fix)

Today the host gets a random `hostKey` from the Worker and stores it in their pregnancy doc; reveal
requires that key. **Severity is low** — guests never receive the key (GET never returns it), so a
reveal can only be forged by someone who can already read the host's pregnancy doc (a trusted circle
member) or has the host's device, and a forged reveal exposes **no** health/medical data (the game's
answer is host-entered, separate from the medical `b.sex`). It is a party-game annoyance, not a leak.

Phase 1 replaces it with identity-based ownership, which is also what the hub needs anyway:

- The Worker verifies a **Firebase ID token** (RS256 against Google's public x509 certs; check
  `iss = https://securetoken.google.com/little-log-a9caa`, `aud = little-log-a9caa`, `exp`) on
  **hub create** and **reveal/close**. WebCrypto only — no Admin SDK, no Cloud Functions needed.
- `hub create` stamps `owner_uid` from the verified token. `reveal/close` requires
  `token.uid == hubs.owner_uid`. No secret is ever synced to Firestore.
- Guest endpoints (join / guess) stay **open + rate-limited** — guests still need no account.
- Certs cached in-isolate by `max-age` to avoid refetching on every call.

## Endpoints (new `/api/hub/*`; old `/api/game/*` untouched)

```
POST /api/hub/create               (auth)  -> { hubCode, title, games:[{id,type}] }   create hub + default games
GET  /api/hub/:code                         -> { title, games:[{id,type,prompt,status,result,count,guesses}] }
POST /api/hub/:code/guess                   -> hub state            body { gameId, nickname, guess, note }
POST /api/hub/:code/game/:id/reveal (auth)  -> hub state            owner only; sets result + status
POST /api/hub/:code/close          (auth)   -> { ok:true }          owner only; deletes the hub + all guesses
```

GET never returns `owner_uid`. All rate-limited per-IP via the existing limiter (create/reveal/close in
an auth bucket, guess/get in a guest bucket), plus the per-hub 300-guess cap. On 5xx/401 the Worker
returns only a generic error code (no raw exception detail). The host app calls `close` when a
pregnancy ends without a birth (loss) or its data is deleted, so the shared link stops showing games.

## Guest page `/g/<code>`

`g/index.html` becomes hub-aware: fetches the hub, renders its open games as cards, asks for a
nickname once (kept in localStorage), and lets a guest play each. Reveal shows a per-game celebration.
The current single-game path keeps working for old `/g/<gameCode>` links.

## Host app (in `app/index.html`, expecting flow)

The "Boy or girl?" card becomes a **"Family games"** entry that creates/opens the hub, lists its
games, shares one link, and lets the owner reveal each. Reuses the shared sex picker + custom
date/time picker (no one-off variants). The due-date pool reveal reuses the celebration burst.

## Loss-safety (unchanged guarantee)

The hub lives on the pregnancy. After a loss it is never resurfaced, no game ever auto-opens, and
nothing implies an expectation. Reveal is always owner-initiated.

## Phasing

- **Phase 1 (this):** hub shell + due-date pool + auth hardening. "Boy or girl?" still live.
- **Phase 2:** Name game — guests suggest names and upvote; owner shortlists. (Never auto-applied to a baby.)
- **Phase 3:** bundled "baby shower" view + a "who knows the parents best?" trivia round.

## Risks

- Worker Firebase JWT verification without the Admin SDK — standard WebCrypto RS256 verify; the main
  care is cert caching + correct `aud`/`iss`/`exp` checks.
- Additive D1 schema avoids any migration of live games. ✅
- Guest-page rework must not break existing `/g/<gameCode>` links → keep the old path.
