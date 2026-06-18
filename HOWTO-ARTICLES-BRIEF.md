# Brief: Cubby "Using Cubby" how-to article series

**For the article agent.** Spin up a set of short, visual how-to guides that show people exactly how to do each thing in Cubby, with app screenshots and a "what to expect" beat, cross-linked from the FAQ so a parent who is mid-task can get unstuck and then explore further.

## Where they live
- One per guide at `articles/<slug>/index.html`, matching the EXISTING article template exactly (same `<head>` meta, Open Graph, JSON-LD, header/nav, footer, CSS classes). Do not invent a new layout.
- Give them a distinct category/tag: **"Using Cubby"** (so they read as help, separate from the education/content articles).
- Add **schema.org/HowTo** JSON-LD (steps + images) in addition to the Article schema, for search.

## Cross-linking (this is the point)
- For every guide, add a link from the matching answer in `faq/index.html` (e.g. "See: How to log a feed").
- Add a "How-to guides" block on the FAQ page listing the Tier-1 guides.
- Each guide ends with **Related guides** (2-3) and **Related FAQs** (1-3).

## Structure per guide (keep it skimmable, ~300-500 words)
1. **Title** — plain how-to phrasing: "How to log a feed in Cubby." No country labels anywhere in the title / h1 / og:title (house naming rule).
2. **Intro** (1-2 lines) — who it is for and when you would use it.
3. **Steps** — numbered; each step = one annotated app screenshot + a one-line instruction (call out the exact tap).
4. **What to expect** — what happens after, where it shows up, and who in the circle can see it.
5. **Tips / common questions** (1-3).
6. **Privacy note** where relevant — it stays in your family; nothing leaves to third parties.
7. **Related guides + Related FAQs.**

## Screenshots
- Capture from the live app on a phone width (~390px), light theme, with gentle demo data (no real names). One image per step; annotate the tap target.
- The app sits behind sign-in, so the agent cannot screenshot it directly — **founder provides the screenshots, or captures them while signed in.** Until then, place clearly-labelled placeholders so layout and alt text are ready.

## Tone (non-negotiable)
- Calm, warm, plain language — "one thumb, half asleep." Run the Anxiety Test on every line.
- **No em-dashes.** Use commas, full stops, or a middot.
- Never imply pressure or an assumption (e.g. do not assume a second baby; do not imply something "should" have happened).
- Privacy-forward; reassuring, never clinical.

## Topics, in priority order
**Tier 1 (start here, core journey):**
- Getting started: set up Cubby (We're expecting vs Our baby's here)
- Log a feed (breast, bottle, solids)
- Log sleep / a nap
- Log a nappy
- Invite your circle (partner, grandparent, nanny)
- Add Cubby to your home screen (Android and iOS)

**Tier 2:**
- Switch between babies, and add another little one (twins or a sibling)
- Set up your pregnancy (due date or last period)
- The week-by-week view (tap the size / baby / you cards for more)
- Kick counter
- Medicine reminders (per-dose and the daily digest)
- Vaccine schedule, and changing the country

**Tier 3:**
- Growth charts
- Doctor visits and the doctor summary
- Memories and keepsakes
- Pumping
- Routines
- Glucose / GDM tracking
- Your data and privacy (export, delete, guardians)

## Done = for each guide
Article published at its slug, matches the template, HowTo schema present, screenshots (or labelled placeholders) in, linked from the relevant FAQ answer, and Related guides/FAQs wired. Ship Tier 1 first.
