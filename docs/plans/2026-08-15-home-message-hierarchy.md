# Home page: message hierarchy

2026-08-15. Written after the founder's read that the previous version landed better.
He is right, and the reason is specific enough to fix rather than revert.

## What happened

Two commits changed the voice of the home page.

- `a1e5e73` replaced eight headings. Every one had been a problem or an approach; every
  one became a concrete moment.
- `c4f2f16` added a four-item benefit block directly under the hero.

The audit behind `a1e5e73` was correct: not one heading stated an outcome. The fix was
not. Making *every* heading an outcome deleted the only three lines on the page that
named what the parent felt.

  "You're the keeper of a thousand tiny details."
  "Caring for a baby was never meant to be carried alone."
  "Come in. Let your hands go free."

Those are the lines that loosen someone's chest. The page now has none. It is entirely
functional, every heading is second person, every heading is a compound sentence of
nine to twelve words, and eight of them in a row read as one flat voice.

The headings also got longer, not punchier:

  "Cubby is where you set them down."                            6 words, quotable
  "You know whether the 2am dose was already given."             9 words, forgettable
  "Your family's life is nobody's business but yours."           a promise
  "You add the nanny, and she sees the day, and nothing else."   an example of a promise

And `c4f2f16` speaks the wrong language in the wrong slot. "Signed, not guessed" and
"Private by rules, not settings" are good differentiator copy. They are the *second*
thing a parent reads on the page, before any emotional buy-in, with no heading above
them and no container around them. On a phone the grid collapses to one column and it
is four bare bold lines stacked into a wall.

The error in one sentence: **the previous page was all feeling and no proof, and I
replaced it with all proof and no feeling.** Same mistake, opposite sign.

## What the screen actually shows

Measured at 390x844 against the live tree, not read from source.

- The nav eats 190px, 22% of the first screen, before a word of the page.
- The eyebrow wraps to two lines (38.9px tall).
- Below the CTA sit two fineprint blocks, five lines of small grey text.
- **The phone mock starts at y=644.** With the sticky nav that is the very bottom edge.
  The product is not visible in the first screen at all.
- **The phone mock's rows are centre-aligned.** `@media(max-width:860px)` on
  `.hx-hero-split` sets `text-align:center` and it cascades into the mock, so
  "started 1:40 PM · by Mama Bear" centres and wraps. The identical `.hx-erow`
  component in the care-circle section below computes `start`. The single most
  important proof asset on the page renders looking broken, and only in the hero.
- No horizontal overflow at 320 or 390. That fix held.

## The hierarchy

Seven questions, in the order a tired human actually asks them. Every section answers
exactly one. A section that answers none gets demoted or cut.

| # | Question | Time | Carried by |
|---|---|---|---|
| 1 | Am I the person this is for? | 1s | eyebrow + H1 |
| 2 | What is it, concretely? | 3s | lede + phone mock |
| 3 | What changes for me? | 8s | three benefits, felt then proved |
| 4 | Why this and not the one my friend uses? | 20s | the differentiator |
| 5 | Can I believe you? | 30s | sources cited, privacy enforced, real quotes |
| 6 | What does it cost me? | | free, no ads, no app store, ten seconds |
| 7 | How do I start? | | CTA |

The page as it stands answers 2, 4 (in engineer voice, too early), 3 (buried and
verbose), 5, 6, 7. **It never answers 1.**

## The rule that replaces "every heading is an outcome"

**The heading's register matches the section's job.**

A section whose job is belonging gets a felt line. A section whose job is utility gets
a concrete moment. Where both fit, the felt line is the heading and the moment is the
kicker beneath it, one size down. Nothing is lost, and the page gets rhythm back
instead of eight identical sentences.

This is also exactly what the founder said he liked: the leading line, then how it
benefits me underneath.

### Section by section

| Section | Job | Heading | Kicker beneath |
|---|---|---|---|
| Hero | recognition | *(keep)* At 3am, you already know when the last feed was. | lede |
| What changes | proof | *(new)* eyebrow only: WHAT CHANGES | three items |
| Doctor visit | utility | The six-week check, already written down. | body |
| Medicine | utility | You know if the 2am dose was already given. | body |
| Care circle | belonging | **restore** Caring for a baby was never meant to be carried alone. | You get home at six and the day is already written down. |
| Journey | continuity | *(keep)* Nothing restarts on the day they arrive. | body |
| Privacy vows | promise | **restore** Your family's life is nobody's business but yours. | You add the nanny, and she sees the day, and nothing else. |
| Mother's health | stance | **restore** A mother owns her own health. | You choose who sees your blood pressure. Nobody sees your mood. |
| Capability grid | coverage | *(keep)* The day the rash appears, you're not downloading another app. | body |
| Close | permission | **restore** Come in. Let your hands go free. | Free to start, private to your family. |

Four restores, four keeps. The moments survive as kickers.

## The benefit block, rewritten

Three, not four. A scanner reads three. Each is a felt line in the serif, then the
proof in one grey clause. The engineer register stays, but it arrives second.

    You are not the only one who knows.
      Partner, grandparent, nanny: the same day on the same screen, every entry
      with a name on it.

    Nothing here keeps score.
      No streaks, no targets, nothing turns red. A thin week is allowed to be a
      thin week.

    Some things stay yours alone.
      Your mood notes cannot be shared with anyone. Not a setting you might leave
      on: the database refuses the write.

"Works with no signal" is cut from this block and stays in the capability grid, where
it already is. Four items is a wall on a phone.

Each line still traces to code: `authorId` immutable at `firestore.rules:241`, mood
unshareable at `:329`, no-streaks per the charter.

## Hero repairs

1. **Move the sign-in fineprint below the phone.** Three lines of small grey text
   reclaimed, roughly 170px, which pulls the phone from y=644 to about y=474. A third
   of the product lands in the first screen. Highest leverage change on the page and
   it costs no copy.
2. **Stop the hero centring the phone mock.** Scope `text-align:center` to the copy
   column instead of the whole split, or set the mock back to `start`. It is a bug,
   not a taste call: the same component computes `start` sixty lines further down.
3. **Put the wedge back in the lede.** It was trimmed while fixing the 320px spill,
   and the spill fix turned out to be structural (`min-width:0`), so the words are
   affordable again:

       Last feed, last sleep, last nappy, counting up on their own. Nobody to wake
       and ask, and whoever else has her today sees the same screen.

   Fold one currently says nothing about the second caregiver, which the Delta-4 audit
   says is the entire wedge.

The eyebrow stays as it is. Shortening it to one line costs "for the whole family",
and the fineprint move buys back five times the space.

## Validating it

Being straight about this: **there is no instrument today.** The CSP that keeps the
no-trackers promise true also blocks the Cloudflare beacon, so the dashboard reads
zero. That was a deliberate trade and it is still the right one, but it means nobody
can A/B this page today.

Two honest options, cheapest first.

**1. Five-second test, with the ten screened parents.** Show fold one for five
seconds, take it away, ask two questions:

  - What does it do?
  - Who is it for?

Score it as the share who say something close to *"it shares the baby's day with
whoever is helping"*. Anything else is a miss. Run it on both versions, same parents,
order alternated. This is the only validation that means anything at this stage and it
needs no code.

**2. Real attribution, no new tracker.** `cubby-acq` already captures utm first touch
in localStorage and writes it to the user doc on first sign-in
(`app/store-firebase.js:897`). Signup-by-source is therefore already measurable.
What does not exist is anything in `worker.js` that serves two variants, so this is a
build, not a switch. Worth naming, not worth building before there is traffic to split.

## What this does not fix

The page can be perfect and leg one still does not move. Eleven households, sixteen
lifetime events, and two different people logging in one household zero times ever.
Copy is not the constraint at eleven households; distribution is. This work is worth
doing because the page is what those ten screened parents will look at, not because it
will produce them.
