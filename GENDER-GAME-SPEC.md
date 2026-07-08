# Spec: pre-birth "Boy or girl?" guessing game

A gentle, optional family guessing game in the **expecting** flow. Engagement for the circle (caring is a team sport), kept firmly in Cubby's calm voice.

## Principles (non-negotiable)
- **Calm, not a reveal-party.** "A bit of fun, no pressure."
- **Inclusive / team-green.** Works with NO known answer; the parent never has to find out or reveal.
- **Loss-safe.** It lives on the pregnancy; if the pregnancy ends it is not resurfaced. Nothing implies an expectation.
- **Trust intact.** Old-wives'-tale prompts are clearly badged "just for fun, not science."
- **Guess never becomes the medical record.** A guess is not `b.sex`.

## Data (on `state.pregnancy`, syncs to the household)
- `guesses: [{ id, uid, name, guess: 'M'|'F', note, at }]` — one per circle member, editable.
- `knownSex: 'M'|'F'|''` — owner-set, optional. `''` = surprise / not found out.

## Surfaces
- **Card** on the expecting home ("Boy or girl?", 🔮) showing a one-line summary (tally, or the reveal).
- **Sheet** `openGuessGame()`:
  - Each member adds/edits their guess (Girl/Boy + optional fun "why").
  - Live tally + list of guesses (names from the circle).
  - **Owner-only reveal:** "Found out at your scan? Reveal (only you can)" → sets `knownSex`; shows who guessed right; "keep it a surprise again" to undo.
  - Collapsible old-wives'-tale prompts, badged not-science.

## The bridge to the medical field
- When the baby is born (`openWelcomeBaby`), the sex picker is **prefilled** from `pregnancy.knownSex` (same continuity pattern as vaccine country). The growth-chart `b.sex` flows from the *known* sex, never from a guess.

## Out of scope (later)
- A keepsake card of the guesses/reveal. Push/notify on guesses (never — non-critical).

---

# v2: hosted multiplayer (Kahoot / Slido model) — guests need NO Cubby account

The host (parent, has Cubby) shares a **link**; friends and family **join with just a nickname**, guess, and see the celebration when it's revealed. **No sign-up, no onboarding** — but **hosted on Cubby**, not a third party.

## Architecture (mirrors the newsletter D1 isolation, NOT family Firestore)
- **`cubby-games` D1** behind the Worker + a `GAMES_RATE_LIMITER`. The ONLY data it ever holds: the host's chosen public title, plus `{nickname, guess, note}` rows. **No family data** (no mother name, due date, location, or baby record) ever touches it.
- **Worker routes:**
  - `POST /api/game/create` (from the host's app) -> mints a high-entropy code, stores `{code, title, hostKey, status:'open', createdAt}`.
  - `GET  /api/game/:code` -> public title, status, tally (+ guesses for the host).
  - `POST /api/game/:code/guess` {nickname, guess, note} -> rate-limited guest write.
  - `POST /api/game/:code/reveal` {result, hostKey} -> host sets the outcome (M/F/MF/FF/MM); guests then see the celebration.
- **Guest page:** `little-cubby.com/g/<code>` — a standalone, no-auth, no-app-shell page: public title -> nickname + 🎀/💙 guess -> running tally -> the same reveal celebration (twins one-of-each included).
- **Host app:** the existing "Boy or girl?" sheet gains "Share the game" (copies the link) and merges guest guesses with the in-circle ones; the in-app reveal also pushes to `/reveal`.

## Safety / privacy
- High-entropy code (unguessable); Worker per-IP rate limit; guest cap (~200); nickname+guess only (no PII, no trackers); host can remove an entry; game auto-expires N days after the reveal. Profanity is the host's to remove.
- The host sets a public display title (default "Our baby" or "Baby <Lastname>"); nothing else is exposed.

## Build split (same dormant-until-provisioned pattern as the newsletter)
- **I build:** Worker routes, `schema/games.sql`, the `/g/<code>` guest page, and the host-app integration (create + share + poll/merge + push reveal). Ships dormant.
- **Founder provisions (Cloudflare):** `wrangler d1 create cubby-games` -> `wrangler d1 execute cubby-games --remote --file=./schema/games.sql` -> paste `database_id` into wrangler.toml -> deploy. Until then, the in-circle game (already live) works; the guest link is dormant.

## Open product choices
- Join by **link** (recommended; shares cleanly over WhatsApp, async) vs numeric PIN (Kahoot's in-person style).
- Guests see the **running tally** (a little suspense) vs the full guess list before reveal.
