# Mobbin sweep → Cubby polish punch list (2026-08-02)

Source: Mobbin iOS library — trending Empty State screens (3,228), Flo onboarding/logging flows,
loader/progress patterns. Filtered through the Experience Charter (calm > clever, Anxiety Test).

## What the best apps do that Cubby doesn't yet

1. **The action lives inside the empty state.** Cleo, ElevenLabs, Genie, Notion, Vestiaire all pair
   the empty-state illustration with the primary CTA *right there* ("Create new", "Start now").
   Cubby's new bear empty states still say "Tap Home to log your first feed" — directions, not a door.
   → Add a small pill button under each bear: history → "Log a feed" (opens the log sheet),
   Moments → "Add a photo", Rituals → "Add a ritual", Stats stays passive (nothing to act on).

2. **Warm first-person greeting at first run.** Flo opens "Hello, I'm Flo". Cubby has a bear with a
   name — the sign-in already waves, but the first-run wizard speaks app-ese ("Choose your stage").
   → One line of Cubby voice at the top of the wizard: "Hi, I'm Cubby. Let's set up your den."
   (Keep it to one line; Flo stretches this to 5 screens of quiz — do NOT copy that.)

3. **Privacy as a proud early screen, not a legal gate.** Flo shows "Your body. Your data" early but
   it's consent checkboxes + "Accept all" — legalese wearing a bow. Cubby's charter version: one calm
   screen in the wizard, plain words ("Private to your family. No ads. We never sell your data."),
   no checkbox theatre. The privacy promise is the differentiator vs Flo — say it where Flo mumbles it.

4. **Witty-but-warm empty copy.** Vestiaire: "Your bag is empty... but not for long!" The pattern:
   acknowledge the emptiness, promise the future. Cubby equivalents already close ("Cubby will keep
   the notes") — keep this register everywhere; never bare "No data".

5. **Loaders explain and free the user.** Best-in-class progress states say what's happening and that
   you can leave (our video-loader mock already does both — ship that pattern for any wait > 2s).

## Deliberately NOT copying
- Flo's multi-screen onboarding quiz (anxiety machine; Cubby's one-door wizard stays).
- Streaks/badges (Strava's "Best Efforts") — charter forbids guilt mechanics.
- Social-proof number walls ("#1 recommended") — truthful-copy rule; Cubby has no such claim yet.

## Order of work
1. Empty-state CTA buttons (small, one per bear screen) — biggest lift-per-line-of-code.
2. Wizard greeting line + privacy screen rewrite in Cubby voice.
3. Audit remaining waits (photo upload, export) for the loader pattern.
