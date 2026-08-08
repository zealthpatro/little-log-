# Cubby — Community growth playbook (the first 300)

> The first 300 don't come from scale tactics. They come from showing up where parents already
> gather and being genuinely useful. This is a **trust grind, not a link-drop campaign** — and that's
> on-brand: a calm, honest, privacy-first product earns its first users the same way it keeps them.
> Capture is wired (UTM → `cubby-acq` → funnel report), so we'll *see* which communities convert.

---

## 0. The one rule that makes this work (and keeps you un-banned)

**Be a member first, a maker second.** Roughly **9 genuinely-helpful contributions for every 1 mention
of Cubby** (Reddit's unwritten ~9:1 rule; most parenting subs are stricter). When you do mention it,
**disclose you built it** ("full disclosure, I made this") — undisclosed self-promo is the fastest way
to a ban and the opposite of the brand. Lead with the *answer*, not the link. If a community bans app
promotion, respect it — help anyway; goodwill compounds.

**Prefer linking a helpful article over the app.** You have 186 of them. "Here's a breakdown I wrote
on X" is value; "download my app" is spam. The article carries the app CTA for you.

---

## 1. Where to show up (and each one's promo reality)

**Reddit** (strict, high-intent, searchable forever — worth the discipline):
- Pregnancy/trying: `r/BabyBumps`, `r/pregnant`, `r/tryingforababy`, `r/CautiousBB`
- Newborn/baby: `r/beyondthebump`, `r/NewParents`, `r/Mommit`, `r/daddit`, `r/predaddit`, `r/Parenting`
- Feeding/sleep: `r/breastfeeding`, `r/FormulaFeeders`, `r/bottlefeeding`, `r/sleeptrain`, `r/ScienceBasedParenting`
- The wedge (caregiver-sharing): `r/Nanny`, `r/childcare` — Cubby's multi-caregiver angle is rare here
- Most parenting subs **restrict or ban app links** → contribute genuinely, mention Cubby only when
  someone directly asks for a tracker, and always disclosed. Check each sub's rules/wiki first.

**Facebook groups** (admin-gated, warm, local):
- Due-date "bump groups" (by birth month), first-time-mum groups, breastfeeding support, twins/multiples,
  working-parent groups, local city parent groups.
- **Message the admins first** — ask if maker introductions are allowed, or post only in their promo thread.

**Forums** (high purchase-intent, evergreen SEO):
- BabyCenter **Birth Clubs** (by due month), What to Expect Community, TheBump.
- UK: **Mumsnet**, **Netmums** (your UK article cluster pairs well here).

**Start narrow:** pick **3 communities** that match your strongest angle, go deep, learn what lands,
then expand. Spreading thin across 15 = noise and no standing.

---

## 2. When Cubby genuinely *is* the answer (the trigger map)

Only surface Cubby when a real question maps to a real strength. The honest pitches:

| Someone asks… | Lead with… |
|---|---|
| "How do my partner/nanny/mum and I track feeds & naps together?" | **The wedge** — one shared live log, who-did-what. *This is your strongest, least-crowded angle.* |
| "Any baby app that doesn't sell my data / has no ads?" | **Privacy** — your log is yours, no third-party trackers, no ads, export/delete anytime. |
| "How do I keep track for the pediatrician/health visitor?" | **Doctor summary** — turns daily logs into a clean visit summary. |
| "Free baby tracker recommendations?" | **Free, no card, works in any browser** (no app store). |
| "Private pregnancy/week-by-week tracker?" | **Expecting stage** — same Cubby, antenatal + private. |

If none fit, **just help and move on.** Standing > a forced mention.

---

## 3. Templates (helpful-first; Cubby as a disclosed P.S.)

**A · The caregiver-sync question (your best fit):**
> The thing that finally worked for us was keeping ONE shared log instead of three phones out of sync —
> my partner and our nanny all see the same feeds/naps live, and each entry shows who logged it, so
> there's no "wait, did she already eat?" Whatever you use, that "everyone sees the same thing live"
> part is what saved our sanity.
> *(Full disclosure — I ended up building a free one for exactly this, [link]. Happy to answer anything,
> and totally fine if you use something else.)*

**B · The privacy question:**
> Worth actually reading each app's privacy policy before you log health stuff about your baby — a lot
> sell data or run ads. You want one where the data stays yours and you can export/delete it.
> *(I built a free, no-ads, no-tracker one because this bugged me — [link] — but the main thing is just
> to check whoever you pick.)*

**C · Pure help, no mention (the 9 of every 10):**
> Answer the question fully and well. Link a relevant Cubby **article** only if it genuinely adds depth.
> No app mention. This is what earns the standing that makes A and B land.

Never copy-paste the same comment across threads — write fresh each time, or it reads as spam (and Reddit
auto-flags it).

---

## 4. Measure it (so we know what's working)

Tag every link so the funnel report attributes it. Scheme:
`?utm_source=<community>&utm_medium=community&utm_campaign=<topic>`

Copy-paste link kit:
```
App, r/BabyBumps:     https://little-cubby.com/app/?utm_source=reddit&utm_medium=community&utm_campaign=babybumps
App, r/beyondthebump: https://little-cubby.com/app/?utm_source=reddit&utm_medium=community&utm_campaign=beyondthebump
App, a FB bump group: https://little-cubby.com/app/?utm_source=facebook&utm_medium=community&utm_campaign=bumpgroup
Article (example):    https://little-cubby.com/articles/best-baby-tracker-app/?utm_source=reddit&utm_medium=community&utm_campaign=babybumps
```
Then `node tools/analytics.js` shows, per source/campaign: **signups, the activation funnel, and whether
they stuck.** A community that sends 20 signups who all churn is worse than one that sends 5 who get
sticky — the funnel tells you which to double down on. People not ready to sign up can still grab the
newsletter (the article pages carry it), so you capture them either way.

---

## 5. Cadence & honest expectations

- **~20–30 min/day:** answer 3–5 questions genuinely; mention Cubby maybe 1–2× per week, only where it fits.
- **First 50–100 over a few weeks**, not days. It compounds: your old helpful comments keep getting found.
- **Quality > volume.** One parent you genuinely helped, who then recommends you, beats 100 link drops.
- **Watch retention, not signups.** Billing's live Oct 2026, so the goal now is a warm, *retained*,
  Pro-waitlisted cohort — that's your PMF proof and your day-one paying customers.

---

## 6. Do / Don't

**Do:** read each community's rules first · disclose you're the maker · give the full answer before any
link · prefer articles over app links · write every comment fresh · thank people · accept "use something
else" gracefully.

**Don't:** drive-by link drops · copy-paste the same comment · sockpuppet ("omg found this great app!")
· DM strangers · post in every thread · argue · ignore "no self-promo" rules · over-mention (more than
~1 in 10).
