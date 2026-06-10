#!/usr/bin/env python3
"""
Batch SEO upgrade for all Cubby articles.

For each article:
  1. Generates og/articles/<slug>.png  (1200x630) and articles/<slug>/hero.png (1200x480)
  2. Patches <head>: per-article OG image, keywords meta, keywords in BlogPosting JSON-LD
  3. Injects hero <img> tag after <p class="art-meta">
  4. Adds UTM params to the /app/ CTA link
  5. Adds FAQPage JSON-LD (extracted from the article's FAQ section)

Run from the repo root:
  python3 tools/seo_upgrade.py
"""

import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Per-article metadata: slug -> (title, age, theme, keywords[])
# ---------------------------------------------------------------------------
ARTICLES = {
    "safe-baby-sleep": (
        "Safe baby sleep: reducing the risk of SIDS",
        "Newborn",
        "Sleep & safety",
        ["safe baby sleep", "SIDS prevention", "how to reduce SIDS risk", "back to sleep baby",
         "safe sleep guidelines", "cot safety baby", "room sharing baby", "baby sleep position",
         "sudden infant death syndrome", "safer sleep baby NHS"],
    ),
    "soothing-a-crying-baby": (
        "Soothing a crying baby and coping with colic",
        "Newborn",
        "Newborn care",
        ["soothing a crying baby", "how to stop baby crying", "baby colic remedies",
         "what is colic in babies", "why does my baby cry so much", "baby crying at night",
         "colic baby symptoms", "how to calm a newborn", "baby comfort techniques",
         "period of purple crying"],
    ),
    "bathing-washing-and-nappy-care": (
        "Bathing, washing and nappy care",
        "Newborn",
        "Hygiene",
        ["how to bathe a newborn", "baby bathing tips", "topping and tailing baby",
         "nappy rash prevention", "umbilical cord care newborn", "how often to bath baby",
         "newborn hygiene", "baby skincare", "nappy changing technique", "newborn care basics"],
    ),
    "baby-milestones-smiles-coos-recognising": (
        "First smiles, coos and recognising you",
        "0-3 months",
        "Development",
        ["baby milestones 0-3 months", "when do babies smile", "baby first smile age",
         "when do babies start cooing", "baby social development", "baby recognises parents",
         "newborn development milestones", "when do babies start talking", "baby eye contact",
         "cognitive development baby"],
    ),
    "starting-solids-around-6-months": (
        "When to start solids: weaning around 6 months",
        "3-6 months",
        "Feeding",
        ["when to start solids baby", "weaning baby 6 months", "signs baby ready for solids",
         "first foods for babies", "baby led weaning age", "starting solids NHS",
         "how to start weaning", "baby first foods 6 months", "introducing solid foods",
         "baby weaning guide"],
    ),
    "introducing-allergen-foods-to-babies": (
        "Introducing allergen foods to babies",
        "3-6 months",
        "Feeding",
        ["introducing allergens to babies", "when to introduce peanuts to baby",
         "baby food allergy introduction", "how to introduce egg to baby",
         "introducing dairy to baby", "baby food allergy prevention", "allergen foods weaning",
         "peanut allergy baby prevention", "introducing allergenic foods NHS",
         "early allergen introduction"],
    ),
    "foods-to-avoid-for-babies": (
        "Foods to avoid giving babies",
        "6-12 months",
        "Feeding",
        ["foods to avoid for babies", "what not to feed baby under 1", "honey baby danger",
         "salt for babies", "whole nuts baby choking", "baby food safety", "unsafe foods baby",
         "choking hazards baby foods", "sugar for babies", "raw egg baby"],
    ),
    "baby-vaccination-schedules-compared": (
        "Baby vaccine schedules compared: UK, US, UAE and Germany",
        "All ages",
        "Vaccines",
        ["baby vaccine schedule comparison", "UK vs US vaccine schedule", "baby immunisation schedule",
         "vaccination schedule by country", "baby vaccines UK US UAE Germany",
         "childhood immunisation comparison", "when do babies get vaccinated",
         "baby jabs schedule", "MMR vaccine age", "infant vaccination guide"],
    ),
    "never-miss-a-baby-vaccine": (
        "How to never miss a baby vaccine",
        "All ages",
        "Vaccines",
        ["how to track baby vaccines", "baby vaccination reminder", "missed baby vaccine",
         "baby vaccine tracker app", "keep track of baby jabs", "baby immunisation record",
         "vaccine due dates baby", "baby health record", "vaccination schedule reminder",
         "catch up baby vaccines"],
    ),
    "baby-sleep-by-age": (
        "Baby sleep by age and wakeful phases",
        "0-12 months",
        "Sleep",
        ["baby sleep by age", "how much sleep does a baby need", "baby sleep schedule",
         "newborn sleep", "baby night waking", "baby sleep regression", "infant sleep tips",
         "safe sleep baby", "when do babies sleep through the night",
         "baby wakeful phases"],
    ),
    "baby-teething-and-tooth-care": (
        "Teething and caring for first teeth",
        "3-6 months",
        "Care & dental",
        ["baby teething signs", "when do babies start teething", "teething symptoms",
         "how to soothe a teething baby", "teething remedies", "baby first teeth",
         "baby tooth care", "brushing baby teeth", "milk teeth baby", "baby teething age"],
    ),
}

# ---------------------------------------------------------------------------
# Image generator (inline so this script is self-contained)
# ---------------------------------------------------------------------------
def _generate_images(slug, title, age, theme, repo_root):
    """Generate OG + hero images. Skips silently if PIL unavailable."""
    try:
        from gen_article_img import generate
        generate(slug, title, age, theme, repo_root)
        return True
    except ImportError:
        pass
    try:
        sys.path.insert(0, str(repo_root / "tools"))
        from gen_article_img import generate
        generate(slug, title, age, theme, repo_root)
        return True
    except Exception as e:
        print(f"  [warn] image generation skipped: {e}")
        return False


# ---------------------------------------------------------------------------
# FAQ extraction
# ---------------------------------------------------------------------------
def _extract_faq(html):
    """Return list of (question, answer) from the FAQ section."""
    faq_section = re.search(
        r'<h2[^>]*>[^<]*[Ff]requently asked[^<]*</h2>(.*?)(?:<h2|<div class="cta|<footer)',
        html, re.S
    )
    if not faq_section:
        return []
    chunk = faq_section.group(1)
    pairs = []
    for m in re.finditer(r'<h3[^>]*>(.*?)</h3>\s*<p>(.*?)</p>', chunk, re.S):
        q = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        a = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        a = re.sub(r'\s+', ' ', a)
        if q and a:
            pairs.append((q, a))
    return pairs


# ---------------------------------------------------------------------------
# HTML patching
# ---------------------------------------------------------------------------
def _patch(html, slug, title, age, theme, keywords):
    og_img = f"https://little-cubby.com/og/articles/{slug}.png"

    # 1. OG image
    html = re.sub(
        r'<meta property="og:image" content="[^"]*">',
        f'<meta property="og:image" content="{og_img}">',
        html
    )
    # Twitter image
    html = re.sub(
        r'<meta name="twitter:image" content="[^"]*">',
        f'<meta name="twitter:image" content="{og_img}">',
        html
    )

    # 2. Keywords meta — insert after twitter:image line if not present
    kw_str = ", ".join(keywords)
    kw_tag = f'<meta name="keywords" content="{kw_str}">'
    if '<meta name="keywords"' not in html:
        html = html.replace(
            '<link rel="icon"',
            kw_tag + '\n<link rel="icon"'
        )
    else:
        html = re.sub(r'<meta name="keywords" content="[^"]*">', kw_tag, html)

    # 3. Update BlogPosting JSON-LD: image field + add keywords array
    def _upgrade_blogposting(m):
        try:
            obj = json.loads(m.group(1))
        except Exception:
            return m.group(0)
        if obj.get("@type") != "BlogPosting":
            return m.group(0)
        obj["image"] = {"@type": "ImageObject", "url": og_img, "width": 1200, "height": 630}
        obj["keywords"] = keywords
        return f'<script type="application/ld+json">\n{json.dumps(obj, ensure_ascii=False)}\n</script>'

    html = re.sub(
        r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
        _upgrade_blogposting,
        html,
        flags=re.S
    )

    # 4. FAQPage JSON-LD — add if not present
    if '"FAQPage"' not in html:
        pairs = _extract_faq(html)
        if pairs:
            faq_entities = [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                for q, a in pairs
            ]
            faq_ld = json.dumps(
                {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": faq_entities},
                ensure_ascii=False
            )
            # Insert before </head>
            html = html.replace(
                '</head>',
                f'<script type="application/ld+json">\n{faq_ld}\n</script>\n</head>'
            )

    # 5. Hero image — inject after <p class="art-meta">...</p>
    hero_tag = (
        f'\n  <img src="/articles/{slug}/hero.png" alt="{title}" '
        f'width="1200" height="480" '
        f'style="width:100%;height:auto;border-radius:12px;margin:1rem 0 1.5rem;" '
        f'loading="eager">'
    )
    if f'/articles/{slug}/hero.png' not in html:
        html = re.sub(
            r'(<p class="art-meta">.*?</p>)',
            r'\1' + hero_tag,
            html,
            flags=re.S
        )

    # 6. UTM on CTA /app/ link
    utm = f'utm_source=article&utm_medium=organic&utm_campaign={slug}'
    if utm not in html:
        html = re.sub(
            r'href="/app/"',
            f'href="/app/?{utm}"',
            html
        )

    return html


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    repo = Path(__file__).parent.parent
    os.chdir(repo)

    ok = 0
    for slug, (title, age, theme, keywords) in ARTICLES.items():
        path = repo / "articles" / slug / "index.html"
        if not path.exists():
            print(f"SKIP (not found): {slug}")
            continue

        print(f"\n{slug}")

        # Generate images
        _generate_images(slug, title, age, theme, repo)

        # Patch HTML
        html = path.read_text(encoding="utf-8")
        patched = _patch(html, slug, title, age, theme, keywords)
        if patched != html:
            path.write_text(patched, encoding="utf-8")
            print(f"  patched HTML")
        else:
            print(f"  HTML already up to date")

        ok += 1

    print(f"\nDone. {ok}/{len(ARTICLES)} articles processed.")


if __name__ == "__main__":
    main()
