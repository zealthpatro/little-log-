# Cubby content plan (articles)

Goal: a comprehensive, **verifiable** article library tagged by age bracket and theme, that pulls high-intent search traffic and helps users, without any legal/medical risk.

## Non-negotiable rules (this is how we avoid legal trouble)
1. **Never fabricate.** Every health claim must trace to an official source (NHS, CDC, AAP/HealthyChildren, WHO, NICE, national authorities).
2. **Deep-link the sources** in a "Trusted sources" list, plus inline where useful.
3. **Disclaimer on every page**: "Informational only, not medical advice, follow your doctor/midwife/health visitor."
4. **No diagnosis or treatment instructions** beyond what the cited source says; prefer "seek care if…" over "do X to treat Y".
5. **Datestamp** ("Reviewed <date>") and re-check yearly or when guidance changes.
6. Summarise and link, do not copy source text. Keep our own wording.
7. No em-dashes in copy.

## Age brackets (tags)
Newborn (0-1m) · 0-3 months · 3-6 months · 6-9 months · 9-12 months · 12 months+
(Hub currently groups as: Newborn & 0-3, 3-6, 6-12, plus Vaccines/health all-ages.)

## Themes (target 20+)
food/weaning · foods to avoid · allergens · sleep (safe sleep) · sleep by age / wakeful phases · teething · crying/colic · hygiene/bathing · nappy care/rash · development & milestones · play & learning · tummy time · cooing/babbling/language · social smile & recognising · separation anxiety · vaccines · fever · colds/flu/RSV · common rashes · growth & percentiles · vitamins (e.g. vitamin D) · dental care · safety/first aid basics · screen time.

## Status
### Published (sourced)
- Safe baby sleep / SIDS (NHS) — Newborn
- Soothing a crying baby & colic (NHS) — Newborn
- Bathing, washing & nappy care (NHS) — Newborn
- First smiles, coos & recognising you (CDC + NHS) — 0-3
- Starting solids ~6 months (NHS) — 3-6
- Introducing allergen foods (NHS) — 3-6
- Foods to avoid (NHS) — 6-12
- Vaccine schedules: UK/US/UAE/Germany + "compared" + "never miss" (GOV.UK/NHS, CDC, MOHAP/EHS, RKI/STIKO)

### Next batches (each fully sourced before publishing)
- **Sleep**: baby sleep by age & wakeful phases (NHS), naps & routines.
- **Teething**: signs, soothing, first teeth & dental care (NHS, NHS dental).
- **Illness**: fever / high temperature in children (NHS), colds & coughs (NHS), RSV & bronchiolitis (NHS), when to call 111/911.
- **Growth**: understanding centiles & growth charts (WHO/CDC; ties to our in-app charts).
- **Development**: milestones at 6/9/12 months (CDC act-early), tummy time (AAP), play & learning, separation anxiety.
- **Nutrition**: vitamin D & vitamins (NHS), drinks & cups, fussy eating, meal ideas by age.
- **Care**: nappy rash (NHS), common newborn rashes/skin, safety basics.

## Authoritative source hubs (use these)
- NHS baby: https://www.nhs.uk/baby/  (newborn care, weaning, development, health)
- NHS weaning sub-pages: first foods, foods to avoid, allergies, food safety (see /baby/weaning-and-feeding/)
- CDC Learn the Signs / milestones: https://www.cdc.gov/act-early/milestones/index.html (2/4/6/9-months, 1-year pages)
- AAP HealthyChildren: https://www.healthychildren.org/
- WHO child growth & health: https://www.who.int/

## How to add an article
Copy an existing `/articles/<slug>/index.html`, update head meta + `BlogPosting` JSON-LD + the `art-meta` (age · theme · Reviewed date), write 2-4 sourced sections, add the deep-linked "Trusted sources" list and disclaimer, add a card to the right age section in `/articles/index.html`, and add a `<url>` to `sitemap.xml`.
