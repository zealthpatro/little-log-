#!/usr/bin/env python3
"""
Reorder articles/index.html:
 - Inject 20 new Growth/Wellbeing/Comparisons cards
 - Interleave all cards round-robin by category so each category
   appears at least once in the first visible fold
 - Remove static <div class="sect-head"> elements (filter chips are
   sufficient for category navigation)
 - Update total count and og:description
"""

import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
HUB  = ROOT / "articles" / "index.html"

# ── New cards to inject (20 articles) ─────────────────────────────
NEW_CARDS = [
    # GROWTH (7)
    ('growth', 'all',     '/articles/baby-length-height-first-year/',
     'Growth · 0-12 months', 'Baby length and height in the first year: what is normal',
     'How baby length and height are measured, what the charts show, and what growth to expect from birth to 12 months.'),
    ('growth', 'newborn', '/articles/newborn-weight-loss-and-regain/',
     'Growth · Newborn', 'Newborn weight loss and regain in the first two weeks',
     'Why newborns lose weight in the first days, how much loss is normal, and when they should be back to birth weight.'),
    ('growth', 'newborn', '/articles/premature-baby-growth/',
     'Growth · Newborn', 'Premature baby growth: corrected age and what is different',
     'How growth works for babies born early: corrected age, adjusted milestones, and what to expect in the first year.'),
    ('growth', 'newborn', '/articles/flat-head-syndrome-babies/',
     'Growth · Newborn', 'Flat head syndrome in babies: prevention and when to seek help',
     'What positional plagiocephaly is, how to prevent it with tummy time and repositioning, and when to talk to your health visitor.'),
    ('growth', 'all',     '/articles/centile-drops-baby-growth/',
     'Growth · 0-12 months', 'What a centile drop means for your baby\'s growth',
     'When a drop on the growth chart is normal and when it needs attention: NHS-sourced guidance for parents.'),
    ('growth', 'newborn', '/articles/breastfed-baby-weight-gain/',
     'Growth · Newborn', 'Weight gain in breastfed babies: what is normal',
     'How breastfed babies gain weight differently, how often they should be weighed, and what the NHS says.'),
    ('growth', '0-3',     '/articles/when-babies-double-birth-weight/',
     'Growth · 0-6 months', 'When do babies double their birth weight?',
     'When most babies reach double their birth weight, what the range looks like, and what the NHS says about monitoring growth.'),

    # WELLBEING (8)
    ('wellbeing', 'newborn', '/articles/baby-blues-explained/',
     'Wellbeing · Newborn', 'Baby blues: what they are and how they differ from postnatal depression',
     'What the baby blues are, when they happen, how long they last, and how to tell them apart from postnatal depression.'),
    ('wellbeing', 'newborn', '/articles/postnatal-anxiety/',
     'Wellbeing · Newborn', 'Postnatal anxiety: signs, symptoms and where to get help',
     'What postnatal anxiety looks like, how it differs from normal new-parent worry, and where to get support.'),
    ('wellbeing', 'newborn', '/articles/sleep-deprivation-new-parents/',
     'Wellbeing · Newborn', 'Sleep deprivation as a new parent: effects and how to cope',
     'What severe sleep deprivation does to new parents, practical strategies to manage it, and when to ask for help.'),
    ('wellbeing', 'newborn', '/articles/partner-postnatal-depression/',
     'Wellbeing · Newborn', 'Partner and paternal postnatal depression: what it looks like',
     'How postnatal depression affects partners and fathers, what the signs are, and where to get support.'),
    ('wellbeing', 'all',     '/articles/returning-to-work-after-baby/',
     'Wellbeing · All ages', 'Returning to work after having a baby: what to expect',
     'The emotional and practical side of going back to work after maternity or paternity leave, and how to make the transition easier.'),
    ('wellbeing', 'newborn', '/articles/building-support-network-baby/',
     'Wellbeing · Newborn', 'Building your support network as a new parent',
     'How to find and ask for help as a new parent: family, friends, health visitors, local groups and NHS services.'),
    ('wellbeing', 'newborn', '/articles/self-care-for-new-parents/',
     'Wellbeing · Newborn', 'Self-care for new parents: why it matters and simple steps',
     'Why looking after yourself matters when you have a new baby, and practical NHS-grounded steps that fit into a sleep-deprived life.'),
    ('wellbeing', 'newborn', '/articles/relationship-changes-after-baby/',
     'Wellbeing · Newborn', 'How a new baby changes your relationship and how to adapt',
     'What changes between partners after a new baby arrives and practical ways to keep the relationship healthy in the first year.'),

    # COMPARISONS (5)
    ('compare', 'all',     '/articles/baby-tracking-app-vs-paper/',
     'Comparison · All ages', 'Baby tracking app vs pen and paper: why digital tracking helps',
     'How tracking feeds, sleep and nappies in an app compares to a notebook or paper chart, and where digital tracking makes the real difference.'),
    ('compare', 'newborn', '/articles/types-of-infant-formula-uk/',
     'Comparison · Newborn', 'Types of infant formula in the UK: what parents need to know',
     'First infant formula, follow-on milk, growing-up milk and specialist formulas: what they are and what the NHS recommends.'),
    ('compare', 'newborn', '/articles/baby-carrier-types-compared/',
     'Comparison · Newborn', 'Baby carrier types compared: wrap, ring sling and structured carrier',
     'Stretchy wraps, woven wraps, ring slings and buckle carriers compared: what each suits, TICKS safety, and how to choose.'),
    ('compare', 'newborn', '/articles/nhs-red-book-explained/',
     'Comparison · Newborn', 'The NHS red book explained: what it is and how to use it',
     'What the Personal Child Health Record (red book) is, what health visitors record in it, and how to use it alongside digital tracking.'),
    ('compare', 'newborn', '/articles/free-resources-uk-new-parents/',
     'Comparison · Newborn', 'Free resources for UK new parents: NHS, apps and local support',
     'A practical guide to the free NHS, government and community services available to new parents in the UK.'),
]

# ── Order in which categories cycle (determines first-fold order) ──
CAT_ORDER = ['vaccines', 'sleep', 'feeding', 'development',
             'health', 'care', 'growth', 'wellbeing', 'compare']


def card_html(cat, age, href, k, title, desc):
    return (
        f'    <a class="art-card" data-cat="{cat}" data-age="{age}" href="{href}">'
        f'<div class="k">{k}</div>'
        f'<div class="t">{title}</div>'
        f'<div class="d">{desc}</div></a>'
    )


def main():
    src = HUB.read_text(encoding='utf-8')

    # ── Extract existing art-card lines ───────────────────────────
    card_pat = re.compile(
        r'    <a class="art-card" data-cat="(\w+)" data-age="([^"]+)" href="([^"]+)">'
        r'<div class="k">([^<]+)</div>'
        r'<div class="t">([^<]+)</div>'
        r'<div class="d">([^<]+)</div></a>'
    )

    existing = []
    for m in card_pat.finditer(src):
        existing.append(m.groups())  # (cat, age, href, k, title, desc)

    # ── Merge with new cards (skip dupes by href) ─────────────────
    existing_hrefs = {c[2] for c in existing}
    all_cards = list(existing)
    for nc in NEW_CARDS:
        if nc[2] not in existing_hrefs:
            all_cards.append(nc)

    # ── Group by category ─────────────────────────────────────────
    buckets = {cat: [] for cat in CAT_ORDER}
    for card in all_cards:
        cat = card[0]
        if cat in buckets:
            buckets[cat].append(card)

    # ── Round-robin interleave ────────────────────────────────────
    interleaved = []
    max_len = max(len(v) for v in buckets.values())
    for i in range(max_len):
        for cat in CAT_ORDER:
            if i < len(buckets[cat]):
                interleaved.append(buckets[cat][i])

    total = len(interleaved)
    print(f"Total cards after merge: {total}")
    for cat in CAT_ORDER:
        print(f"  {cat}: {len(buckets[cat])}")

    # ── Build new grid HTML ───────────────────────────────────────
    grid_lines = ['  <div id="findr-grid">']
    for c in interleaved:
        grid_lines.append(card_html(*c))
    grid_lines.append('  </div>')
    new_grid = '\n'.join(grid_lines)

    # ── Replace old grid (from <div id="findr-grid"> to </div>) ──
    # The grid starts at <div id="findr-grid"> and ends at the first
    # </div> that closes it. We use the known sentinel lines.
    grid_re = re.compile(
        r'  <div id="findr-grid">.*?  </div>',
        re.DOTALL
    )
    if not grid_re.search(src):
        print("ERROR: could not find findr-grid block", file=sys.stderr)
        sys.exit(1)

    new_src = grid_re.sub(new_grid, src, count=1)

    # ── Update counts ─────────────────────────────────────────────
    # og:description
    new_src = re.sub(
        r'Search \d+\+ calm',
        f'Search {total}+ calm',
        new_src
    )
    new_src = re.sub(
        r'Search \d+\+ clear',
        f'Search {total}+ clear',
        new_src
    )
    # <p class="lede">
    new_src = re.sub(
        r'Search \d+\+ calm',
        f'Search {total}+ calm',
        new_src
    )
    # meta description
    new_src = re.sub(
        r'\d+\+ clear, well-sourced guides',
        f'{total}+ clear, well-sourced guides',
        new_src
    )
    new_src = re.sub(
        r'\d+\+ calm, well-sourced guides',
        f'{total}+ calm, well-sourced guides',
        new_src
    )
    # structured data
    new_src = re.sub(
        r'library of \d+\+ guides',
        f'library of {total}+ guides',
        new_src
    )

    HUB.write_text(new_src, encoding='utf-8')
    print(f"Wrote {HUB} ({total} cards).")


if __name__ == '__main__':
    main()
