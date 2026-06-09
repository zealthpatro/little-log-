# Cubby Pro: paywall candidates (living list)

A running list of what we *could* put behind Cubby Pro, updated as we build. This is a menu to choose from later, not a commitment. Pricing/flow is designed separately (see PRO.md when we get there). Competitor signal: Precious charges ~$4.99/mo for AI photo art and parents pay, so keepsakes/AI are proven willingness-to-pay.

## Guardrails (free forever, never paywall)
These are the trust + word-of-mouth core. Gating them would kill adoption.
- Logging feeds, sleep, nappies, pumping (unlimited)
- Multi-caregiver real-time sync + invites + handoff notes
- Vaccine schedule + due dates + in-app reminders
- Growth charts (WHO/CDC)
- Basic photo save + at least one free share format/template
- Privacy (no ads, no third-party trackers) stays true regardless of tier

## Pro candidates (grouped)

### Moments / keepsakes  ← strongest paid pull (Precious's territory, but private)
- [built] **Share-card templates**: Big milestone, Monthly stats (real data) — keep Classic free, gate advanced
- [built] **Instagram formats**: Story (9:16), Portrait — could keep Square free, gate Story/Portrait
- [built] **Premium fonts & palettes** — keep 1–2 free, gate the rest
- [built] **Auto-enhance** (one-tap, on-device) — could be a free taster or a Pro perk
- [built] **Activity-photo "Make a moment"** — free to capture; gate premium output (formats/templates)
- **"made with Cubby" watermark**: free cards carry it (free advertising); Pro removes it ← clean, gentle lever
- **Free-tier volume cap**: e.g. N premium share cards / month free, unlimited on Pro
- [built] **Background cutout / "sticker-me"** (on-device MediaPipe, lazy-loaded, nothing uploaded) — Pro
- [built] **Then & Now** card (share + download) — could keep free or gate
- [built] **Sticker pack** (tap-to-place emoji stickers, all formats) — keep a few free, gate the full set
- High-res export of birth poster / growth collage / monthly cards — Pro
- Monthly video montage — Pro (heavier; later)

### Health / data
- PDF doctor visit reports + full data export — Pro
- HD photos & cloud backup (beyond the free base64 thumbnails) — Pro (has real storage cost; see EMAIL.md/R2 notes)

### Routines (flagship Pro, see ROUTINES.md)
- Smart adaptive routines, day 0 to 365 — Pro

### Notifications
- Push notifications / reminders when the app is closed — Pro (needs infra; currently in-app only)

### Insights
- Sleep & feed pattern insights, trends, predictions — Pro
- **Nutrition tracker** — turn logged meals + meal photos into a nutrition view over time (what was offered vs eaten). Free: log meals + photos. Pro: the nutrition analysis. [meal photos shipped]

## Levers (how to gate, not just what)
1. **Feature gate** — whole feature is Pro (routines, PDF export, push).
2. **Watermark** — free output is marked; Pro is clean. (Great for moments: free posts market Cubby.)
3. **Volume cap** — free gets N/month; Pro unlimited.
4. **Quality/format gate** — free gets standard; Pro gets HD / extra formats.

## v1 "Base" plan mapping (next venture)
The first paid tier is a single cheap entry plan: **from $5/mo (billed annually ~$59/yr) with a
7-day free trial** (full pricing rationale + tier ladder in PRO.md). To protect margin at $5, the
v1 Base plan gates only **zero-marginal-cost** features (on-device or client-generated):
- **In Base v1:** premium share-card templates, premium fonts & palettes, Instagram Story/Portrait
  formats, "made with Cubby" watermark removal, full sticker pack, Then & Now, Auto-enhance,
  background cutout, plus doctor **PDF report + data export**.
- **NOT in Base (hold for a later higher tier):** HD photos & cloud backup (R2), push
  notifications (Blaze), smart routines, sleep/feed insights, nutrition analysis, video montage —
  i.e. anything with per-user infra cost.

## Notes
- Keep anything requiring paid cloud infra (push, HD storage, generative AI) clearly on the Pro side, since that's where the cost is, and it justifies the price.
- Do NOT add generative AI art that uploads baby photos to a third-party API; it breaks the privacy promise. On-device AI (auto-enhance, cutout) is fine.
