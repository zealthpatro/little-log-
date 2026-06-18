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
