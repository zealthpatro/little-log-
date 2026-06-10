#!/usr/bin/env python3
"""Patch existing articles: add related-articles block + editorial footer link."""

import re
from pathlib import Path

RELATED = {
    "safe-baby-sleep": [
        ("baby-sleep-by-age", "Baby sleep by age and wakeful phases"),
        ("soothing-a-crying-baby", "Soothing a crying baby and coping with colic"),
        ("never-miss-a-baby-vaccine", "How to never miss a baby vaccine"),
    ],
    "soothing-a-crying-baby": [
        ("safe-baby-sleep", "Safe baby sleep: reducing the risk of SIDS"),
        ("baby-sleep-by-age", "Baby sleep by age and wakeful phases"),
        ("bathing-washing-and-nappy-care", "Bathing, washing and nappy care"),
    ],
    "bathing-washing-and-nappy-care": [
        ("soothing-a-crying-baby", "Soothing a crying baby and coping with colic"),
        ("safe-baby-sleep", "Safe baby sleep: reducing the risk of SIDS"),
        ("baby-milestones-smiles-coos-recognising", "First smiles, coos and recognising you"),
    ],
    "baby-milestones-smiles-coos-recognising": [
        ("bathing-washing-and-nappy-care", "Bathing, washing and nappy care"),
        ("soothing-a-crying-baby", "Soothing a crying baby and coping with colic"),
        ("baby-sleep-by-age", "Baby sleep by age and wakeful phases"),
    ],
    "baby-teething-and-tooth-care": [
        ("baby-milestones-smiles-coos-recognising", "First smiles, coos and recognising you"),
        ("foods-to-avoid-for-babies", "Foods to avoid giving babies"),
        ("starting-solids-around-6-months", "When to start solids: weaning around 6 months"),
    ],
    "baby-sleep-by-age": [
        ("safe-baby-sleep", "Safe baby sleep: reducing the risk of SIDS"),
        ("soothing-a-crying-baby", "Soothing a crying baby and coping with colic"),
        ("baby-milestones-smiles-coos-recognising", "First smiles, coos and recognising you"),
    ],
    "starting-solids-around-6-months": [
        ("introducing-allergen-foods-to-babies", "Introducing allergen foods to babies"),
        ("foods-to-avoid-for-babies", "Foods to avoid giving babies"),
        ("baby-teething-and-tooth-care", "Teething and caring for first teeth"),
    ],
    "introducing-allergen-foods-to-babies": [
        ("starting-solids-around-6-months", "When to start solids: weaning around 6 months"),
        ("foods-to-avoid-for-babies", "Foods to avoid giving babies"),
        ("never-miss-a-baby-vaccine", "How to never miss a baby vaccine"),
    ],
    "foods-to-avoid-for-babies": [
        ("starting-solids-around-6-months", "When to start solids: weaning around 6 months"),
        ("introducing-allergen-foods-to-babies", "Introducing allergen foods to babies"),
        ("baby-teething-and-tooth-care", "Teething and caring for first teeth"),
    ],
    "baby-vaccination-schedules-compared": [
        ("never-miss-a-baby-vaccine", "How to never miss a baby vaccine"),
        ("best-baby-tracker-app", "Best baby tracker apps 2026: honest comparison"),
        ("cubby-vs-huckleberry", "Cubby vs Huckleberry 2026: a direct comparison"),
    ],
    "never-miss-a-baby-vaccine": [
        ("baby-vaccination-schedules-compared", "Baby vaccine schedules compared: UK, US, UAE and Germany"),
        ("best-baby-tracker-app", "Best baby tracker apps 2026: honest comparison"),
        ("safe-baby-sleep", "Safe baby sleep: reducing the risk of SIDS"),
    ],
}

BASE = Path("articles")

for slug, links in RELATED.items():
    path = BASE / slug / "index.html"
    if not path.exists():
        print(f"SKIP (not found): {slug}")
        continue

    html = path.read_text()

    if "<h2>Related articles</h2>" in html or "Related articles" in html:
        print(f"SKIP (already has related): {slug}")
        continue

    items = "\n".join(
        f'    <li><a href="/articles/{s}/">{t}</a></li>' for s, t in links
    )
    related_block = f'\n  <h2>Related articles</h2>\n  <ul>\n{items}\n  </ul>\n\n  '

    # Insert before the footer
    html = re.sub(r'(\s*<footer class="src">)', related_block + r'\1', html, count=1)

    # Add editorial link to footer if not already there
    if '/editorial/' not in html.split('<footer class="src">')[1]:
        html = re.sub(
            r'(</footer>)',
            r' See our <a href="/editorial/">editorial process</a>.\1',
            html,
            count=1
        )

    path.write_text(html)
    print(f"OK: {slug}")

print("Done.")
