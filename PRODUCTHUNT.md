# Cubby — Product Hunt launch kit

> **Status (June 2026):** This launch kit is ready to run; Cubby is live on little-cubby.com as one app across four stages (Trying, Expecting, Baby, Child) with ~180 articles and Privacy Max 1.0, so keep the framing honest as free, private, early access. Full current state + go-live plan: HANDOFF.md.

Everything to launch Cubby on Product Hunt as a copy-paste-and-click. You run the submission (it's
your PH account); all copy + the 5 gallery images are ready in `og/producthunt/`.

Honest framing throughout: **free, private, early access.** No invented user counts, no upvote
begging (against PH rules), no fake reviews.

---

## 0. Pre-launch (do a day before)
- [ ] PH account warmed up: real avatar, bio, a few genuine upvotes/comments in the days prior
      (brand-new accounts get filtered). Use a personal account as the **maker**.
- [ ] Decide the day: **Tuesday–Thursday**, post at **00:01 Pacific** (PH days run midnight-to-midnight PT).
      Avoid big-tech launch days if you can.
- [ ] Have 8–12 friends/family who'll genuinely visit on launch morning and **comment** (not just
      upvote — comments matter far more and upvote-only rings get filtered). Do NOT send them a
      "please upvote" link; ask them to check it out and leave honest thoughts/questions.
- [ ] Line up a few parenting/health folks to notify (Twitter/X, WhatsApp, LinkedIn).
- [ ] Test `https://little-cubby.com/?utm_source=producthunt` works + sign-in works on a fresh phone.

## 1. The listing fields
- **Name:** Cubby
- **Tagline** (60 char max): `A warm, private baby tracker the whole family shares`
- **Topics:** Parenting · Health & Fitness · Android · iOS · Web App
- **Website:** `https://little-cubby.com/?utm_source=producthunt`
- **Thumbnail (240×240):** `icons/logo-512.png` (the bear). PH downscales it.
- **Gallery (1270×760, in this order):** from `og/producthunt/`
  1. `ph-hero.png` — the value prop + live home (most important; it's the preview thumbnail)
  2. `ph-care-circle.png` — shared with the whole family
  3. `ph-vaccines.png` — country vaccine schedules
  4. `ph-logging.png` — one-thumb logging
  5. `ph-keepsakes.png` — keepsakes
  (Optionally add a real screen-recording GIF later; static images are fine to launch.)

## 2. Description (the "about" field)
> Cubby is a calm, private baby tracker that everyone caring for your little one shares in real time:
> parents, grandparents, the nanny. Log feeds, sleep, nappies and pumping in one thumb, even
> half-asleep at 3am, and each entry shows who did what.
>
> It follows your country's official vaccine schedule (12 countries plus a WHO default) with gentle
> reminders worked out from your baby's birthday, keeps growth on WHO/CDC percentile charts, and turns
> the everyday into keepsakes.
>
> Free, no ads, and private to your family (no trackers, we never sell your data). It runs in any
> browser and adds to your home screen, so there's nothing to install from an app store. It's early
> access and I'd love your feedback.

## 3. Maker's first comment (post immediately as the maker)
> Hi Product Hunt 👋
>
> I built Cubby after watching my family juggle our baby's feeds, naps and jabs across three phones and
> a WhatsApp group. The details always lived in one parent's head, and whoever was away was guessing.
>
> Cubby keeps everyone on the same live log, with each entry showing who did what, so the working
> parent, the grandparent and the nanny are never out of sync. A few things I cared about:
> • **Free and private** — no ads, no trackers, your data is yours, and it never gets sold.
> • **Your country's real vaccine schedule** — 12 countries plus a WHO default, each from the official
>   source, with the due dates calculated from your baby's birthday.
> • **No app store** — it's a web app you add to your home screen in two taps.
>
> It's early access and genuinely shaped by the families using it. I'd love to hear: what would make a
> baby tracker something your whole household actually keeps using? Happy to answer anything.

## 4. Talking points (for replying to comments — keep replies fast + warm)
- **vs Huckleberry/Glow:** truly free with no ads; the *whole care circle* shares one live log
  (most apps are single-user or paywall sharing); country vaccine schedules built in.
- **Privacy:** no third-party trackers, data encrypted in transit + at rest, export or delete anytime.
- **Tech (HN-style askers):** real-time multi-user on Firebase + Cloudflare free tiers; PWA; on-device
  photo tools so images never leave the phone.
- **Business model:** free core forever; an optional Pro (premium keepsakes, doctor PDF) is coming —
  honest that it's not the focus yet.
- Always reply to questions and criticism graciously; thank people; note what you'll add.

## 5. FAQ prep (likely questions → ready answers)
- **Is it really free?** Yes. Logging, sharing, vaccine schedules, growth charts and basic keepsakes
  are free and always will be. An optional Pro tier is planned, but the core stays free.
- **iOS app?** It's a web app — open little-cubby.com/app in Safari, tap Share → Add to Home Screen.
  Opens full-screen like a native app, works offline.
- **How is my data handled?** Private to the family you invite, encrypted, no ads, no trackers, never
  sold. Export or delete everything yourself anytime.
- **Which countries' vaccines?** UK, US, UAE, Germany, India, Canada, Australia, Ireland, New Zealand,
  Singapore, Saudi Arabia, plus a WHO general schedule. Every item is editable.
- **Does it work for twins / multiple kids?** Yes.

## 6. Launch-day timeline (Pacific)
- **00:01** — Post goes live (or scheduled). Post the maker comment immediately.
- **First 2–3h** — The window that decides ranking. Reply to *every* comment within minutes. Notify your
  people that it's live (no upvote-ask; "we launched, would love your honest take: <link>").
- **Morning–midday** — Share on your channels (X, LinkedIn, relevant communities you already belong to,
  per the rules in `SEO-BACKLINKS.md`). Keep replying.
- **Evening** — Thank everyone in the thread; answer late questions.
- **Next day** — Follow up with anyone who gave feedback; log feature requests.

## 7. After the launch
- Add the PH badge to the site footer ("Featured on Product Hunt") — real, earned link back.
- The PH listing itself is an evergreen dofollow-ish backlink + referral traffic.
- Funnel learnings into the in-app feedback + the roadmap; reply to the thread for days, not hours.

## 8. Guardrails
- No asking for upvotes anywhere (PH bans it). Ask for *visits and honest feedback*.
- No fake accounts, no review swaps, no incentivised upvotes.
- Disclose you're the maker (the first comment does).
- Keep every claim honest: early access, free, private. No user-count or testimonial invention.

---
Assets: gallery in `og/producthunt/` (regenerate via `python3 tools/gen_ph_gallery.py`).
Broader channels + post-PH plan: `SEO-BACKLINKS.md`.
