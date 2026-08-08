# Cubby, Guardrails and Governance

> How the guide stays complete and the rules stay un-ignorable. Sits alongside
> CUBBY-EXPERIENCE-CHARTER.md (the feeling) and the build spec (the what).

**The governing truth:** a guardrail that is not enforced at the moment of the decision is a wish, and
wishes get skipped under deadline. The OVERDUE wall is proof: everyone agreed "stay calm," but nothing
blocked the screen that broke it. So every guardrail is tied to an owner, an enforcement type, and a
thing it blocks. No exceptions, including for speed. The charter wins ties: cut scope, never calm or
safety.

## Completeness map (dimensions a full build guide must cover)

Have: emotional design (Experience Charter); features + acceptance + data models (build spec); privacy
(Privacy Max); YMYL clinical sourcing + review; IA / content model.

Still to strengthen (the work this doc names):
- **Accessibility (a11y):** WCAG 2.1 AA. Contrast >= 4.5:1 (actionable gold darkened to pass), touch
  targets >= 44px, full screen-reader labels, dynamic type, prefers-reduced-motion, never colour-only
  meaning (vaccine badges need text too). A contrast miss was already found once.
- **Localization / i18n + RTL:** externalise every string; support RTL (Arabic) and long-word locales
  (German); localise units (mmol/L vs mg/dL, kg/lb), dates, numbers, currency; clinical strings
  reviewed in-language, not machine-translated unchecked.
- **Voice and content style:** warm, plain, no-guilt, ~grade-7 reading level, no jargon, NO em-dashes;
  a reassurance phrasing bank; a danger-sign bank ("contact your midwife", never "you have"); how to
  write an empty state, an error, a paywall.
- **Empty / loading / error / offline states:** every screen defines all four. A blank or broken
  screen is an anxiety state. Newborn empty states reassure; loading is branded and fast; errors are
  gentle and recoverable; offline is explicit and trusted.
- **Offline and sync integrity:** offline-first, never lose an entry; conflict resolution for two
  caregivers (last-write-wins is wrong for a baby log, merge, attribute, show both); visible sync state.
- **Performance budgets:** LCP < 2.5s on mobile 4G, a log action < 100ms, app shell < 1s, image and
  JS budgets. Speed is an emotional feature; a slow app at 3am is an anxious app.
- **System security:** secure auth/session, security headers (HSTS/CSP/no-frame), secrets management,
  dependency scanning, rate limiting, a written breach-response plan.
- **Safety and crisis:** country-specific crisis routing for any mental-health flag (gate G2); child
  safety; the controlling-partner abuse scenario (handled by Privacy Max server-side); graceful
  degradation when AI/OCR confidence is low.
- **Notification restraint:** gentle, batched, frequency-capped, loss-aware (suppressNudges mutes
  everything), never guilt ("you missed..."), always easy to mute. A notification must reduce load.
- **Ethical metrics:** do NOT optimise for time-in-app or compulsive checking. Optimise for calm and
  outcomes (activation, tasks done with less effort, "felt reassured", never-missed doses). No dark
  patterns. If a metric rewards anxiety, it is the wrong metric.
- **Design tokens:** one token source (CSS vars), no hard-coded hex; auto-fixes contrast, stops drift.
- **Testing / QA:** unit + integration on logic (schedules, conditions, sync), automated a11y +
  contrast, a device/browser matrix, plus node --check and preview.
- **Legal / compliance:** GDPR/CCPA rights (formalise the request flow + DPA), child-data handling,
  MDR read for condition features (gate G3), terms + privacy policy matching real practice, consent.
- **Data lifecycle:** retention, automated backups + tested restore, full export, permanent delete,
  and the sensitive transitions (account deletion, pregnancy loss = pause/archive/delete, removed
  caregiver = tombstone, churn). Nothing orphaned, nothing leaked.
- **Maintenance / freshness:** clinical content re-verified yearly (calendared), dependency updates,
  schedule/threshold monitoring. Keep live official markets narrow so a small team can keep them current.
- **Support / human escalation:** a clear in-app feedback/contact path (Settings > send feedback), a
  response commitment, and a distress-sensitive route to real support, not a ticket queue.

## Enforcement (so guardrails are never ignored)

A guardrail is real only when it is blocking, owned, and checked at the moment of decision.

- **Automated (CI):** merge fails if the check fails. Contrast/a11y lint, performance budget
  (Lighthouse CI), no-tracker-on-health check, source-deeplink link-checker, JSON-LD validation,
  bundle size, node --check.
- **Human review:** cannot ship without a named sign-off. Design review (Anxiety Test + IA gate),
  medical reviewer (clinical), regulatory read (regulated-market health), security review.
- **Checklist gate:** the PR template blocks self-merge until ticked (the Definition of Done below).

### Definition of Done (the non-skippable checklist, run before claiming any surface done)

- **Charter:** passes the Anxiety Test across the relevant states; calm by default, red only earned + actioned.
- **Simplicity:** one screen / one thing; one-thumb; no new jargon.
- **States:** empty, loading, error and offline all defined and gentle.
- **Accessibility:** AA contrast **in both themes**, >= 44px targets, labels, reduced-motion, no
  colour-only meaning.
- **Themes:** every screen checked in Light AND Night. `node tools/uitest.js` walks both and fails
  the build on any settled, readable text below AA, so this is a blocking check, not a promise.
  Owner: whoever ships the surface. Two rules the check cannot see, so read them yourself:
  an accent is a FILL, never ink on a light surface (use the `--*-ink` rung); ink on an accent fill
  comes from `--on-accent` (or `--on-<accent>` where that accent needs the opposite polarity).
  This line exists because Cubby shipped a whole night mode, and then a whole light mode, with
  hundreds of sub-AA strings: nothing was checking, and the one UI walk we had only ever ran one
  theme. Never hit a ratio by shrinking, bolding, or hiding text.
- **Privacy:** if sensitive data, server-side visibility enforced; no third-party tracker; minimal data.
- **YMYL:** if clinical, deeplinked source + named-reviewer line; reviewer sign-off attached.
- **i18n:** strings externalised; units/dates/RTL handled.
- **Voice:** copy matches the style guide (warm, no-guilt, no em-dash).
- **Performance:** within budget (LCP < 2.5s; action < 100ms). `node tools/perf_check.js` is the
  blocking check — it seeds four months of real logging and measures the render path at 4x CPU
  throttle, so it fails on the regressions a screenshot cannot show. Owner: whoever ships the
  surface. Three rules it enforces, and one it cannot: never hand a whole screen to `innerHTML`
  (paint through `paintShell`, which no-ops on identical markup and keeps the `#scroll` node —
  destroying that node destroys iOS scroll momentum mid-flick); never render an unbounded list in
  full (the Log timeline paints a fortnight of days at a time and reveals more on approach, hiding
  nothing behind a tap); never sweep the whole document on a timer. The one it cannot see: a repaint
  driven by the network goes through `renderSoon()` (one per frame), never straight to `render()`.
  This line exists because the app shipped for months rebuilding its entire shell on every render
  and building every event ever logged into the Log tab — 498ms of frozen phone per repaint, four
  months in, and worse every week a parent kept using it. Nothing was measuring.
- **Notification chokepoint:** anything that can reach a parent when the app is closed (push, a
  calendar file, a local notification) is reached through ONE function that takes a medicine id
  and nothing else. No title parameter, no time parameter, no interruption-level parameter. Push
  is medicine-critical only, and a chokepoint that cannot express anything else is what keeps it
  that way: adding a second kind becomes a visible refactor somebody has to justify, rather than
  a quiet decision. `node tools/dosecal_test.js` is the blocking check.
- **Privacy is enforced by rules, never by client hiding.** If a member's private data would sit
  inside a document the circle can read, the design is wrong: Firestore rules can inspect
  top-level key names but never array contents, so no rule can catch a private record hiding
  inside a shared array. A count or a badge is itself a disclosure. This line exists because the
  medicine work found that storing an owner-private category outside `MAT_CATS` would have been
  folded into `state.pregnancy` and republished into a document carrying `sharedWith`.
- **Data integrity:** offline-safe; no data loss; sync conflicts handled.
- **Tests:** logic tested; verified in preview; SW cache bumped if assets changed.
- **Notifications:** if added, gentle, capped, loss-aware, mutable.

### Pre-launch checklist (any new surface, before it goes live)

- Board gates clear: G1 privacy server-side, G2 crisis routing, G3 regulatory read, G4 no silent migration.
- Reviewer sign-offs: medical (clinical), security (data/auth), legal (new data practice).
- Indexing and metadata: in sitemap, JSON-LD valid, internal links, indexable.
- Analytics: the right (ethical) events fire; activation measurable.
- Rollback: feature flag + a way to revert; SW cache versioned.
- Anxiety walk-through: a real person runs the 3am loop, the worrying reading, the proud day through
  the live flow.

## How it stays alive

- One owner per guardrail (accountability, not committee).
- Automate everything automatable (humans forget, CI does not).
- Make it visible at the moment of decision (checklist in the PR, gates in CI).
- Quarterly guardrail review: anything routinely marked N/A is either wrong (fix it) or being ignored
  (re-enforce it).
- The charter wins ties: when a guardrail and a deadline conflict, the guardrail holds.
