# Cubby developmental milestones: sources and curation notes

The milestone library lives in `app/milestone-data.js` as `window.MILESTONES` (mirrors
`app/growth-data.js` and `app/pregnancy-data.js`, no build step). It extends Cubby's original
34-entry list additively: every original `key` is preserved exactly, because logged milestones
reference those keys and changing one would lose a parent's record.

## What is in here, and what it is not

Cubby is one calm place. Milestones are framed as gentle guides, never as a scorecard. Two kinds
of entry live side by side, distinguished by the `type` field:

- **Clinical** (`type:'clinical'`): developmental milestones drawn from public-health surveillance
  guidance. Each carries a `source` and a reassurance `band` (`[minMonth, maxMonth]`), the range
  in which most children reach it. A small number carry an optional `doctorNote`, worded gently,
  used only where the source itself flags an act-early conversation.
- **Delight / firsts** (`type:'delight'`): keepsakes. First giggle, first taste of mango, first
  steps, first snow, first day at nursery. These are joyful, non-clinical, and carry **no source,
  no band, and no doctorNote**. They imply nothing about development. They exist to be remembered.

The `mo` field (typical month, integer) is present on every entry and drives the existing
"around now" nudge that sorts upcoming milestones by closeness to the baby's age.

## Counts

| Bucket | Count |
| --- | --- |
| Clinical (sourced, with band) | 88 |
| Delight / firsts (keepsakes, no source) | 137 |
| **Total** | **225** |

Within the delight count, three optional context packs and the seasonal set are included:

| Pack | Field | Count |
| --- | --- | --- |
| Pet | `context:'pet'` | 12 |
| Travel | `context:'travel'` | 10 |
| People | `context:'people'` | 8 |
| Seasonal (universal, no region) | `key` starts `se-` | 9 |
| Cultural / regional | `region:[...]` | 6 |

Context packs are surfaced through `window.MILESTONE_CONTEXTS` so the app can ask, once and gently,
whether a family has a pet, travels together, or wants relatives and playdates in the thread.
Entries with no `context` and no `region` are universal.

## Clinical sources

Clinical entries are paraphrased into Cubby's calm, reassurance-only voice. The underlying
developmental expectations come from:

- **CDC, "Learn the Signs. Act Early." developmental milestones, 2022 revision.** Used for the
  social-emotional, language, cognitive, and fine/gross-motor surveillance checklists at the
  2, 4, 6, 9, 12, 15, 18, 24, 30, 36, 48, and 60-month visits. The 2022 revision (developed with
  the American Academy of Pediatrics) sets each milestone at the age by which most children
  (about 75 percent) would be expected to reach it, and adds 15- and 30-month checkpoints.
  Source: https://www.cdc.gov/ncbddd/actearly/milestones/index.html
  Checklist overview: https://www.cdc.gov/ncbddd/actearly/milestones/index.html and the
  per-age checklists linked from that page.
  Reference for the 2022 revision rationale: Zubler JM, et al. "Evidence-Informed Milestones for
  Developmental Surveillance Tools." Pediatrics, 2022.

- **WHO Multicentre Growth Reference Study, gross-motor milestones.** Used for the six WHO
  windows of achievement: sitting without support, standing with assistance, hands-and-knees
  crawling, walking with assistance, standing alone, and walking alone. WHO publishes these as
  windows (a range of normal), which maps directly to Cubby's reassurance `band`.
  Source: WHO Motor Development Study, "Windows of achievement for six gross motor development
  milestones." https://www.who.int/tools/child-growth-standards/standards/motor-development-milestones

Entries tagged `source:'WHO'` are the gross-motor windows above (head control is included as a
near-equivalent early-motor anchor). Everything else clinical is `source:'CDC 2022'`.

## Curation notes (YMYL discipline)

- Clinical titles are written as gentle observations ("Babbles", "Sits without support",
  "Walks on their own", "Two-word phrases", "Draws a circle"), to be read as "around now, most
  babies", never as a test a baby can fail. The reassurance line is always "every baby in their
  own time".
- `band` is the gentle range, not a deadline. The app should present it as reassurance, not a
  cutoff.
- `doctorNote` appears on only 5 entries (walking, pointing to share interest, two-word phrases,
  vocabulary around 50 words, and speech intelligibility by age three), the places where the CDC
  guidance itself suggests a check-in. Each note is phrased softly and ends with reassurance.
  Most entries deliberately have no doctorNote.
- No fabricated statistics appear in any entry. The one general figure referenced (the CDC 75
  percent threshold) lives only in this notes file, not in user-facing copy.
- Delight / firsts entries are non-clinical keepsakes. They carry no source, no band, and no
  doctorNote, and must never be presented with clinical weight.
- No em-dashes anywhere in the data file or this document.
- `node --check app/milestone-data.js` passes; the array has no duplicate keys and no
  trailing-comma syntax errors.
