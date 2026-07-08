#!/usr/bin/env python3
"""Generate static vaccine-schedule country pages from the in-app VAX_SCHEDULES data.

Mirrors the proven /vaccination-schedule/us/ template (MedicalWebPage + FAQPage +
BreadcrumbList JSON-LD, birthday calculator via /vax.js, sourced footer). Schedule
rows come verbatim from VAX_SCHEDULES in app/index.html (sourced from each national
authority + adversarially verified 2026-06-13). YMYL: no fabrication; vaccine names
follow the authority's own naming; no cost/policy claims beyond cited sources.

Run from repo root:  python3 tools/gen_vax_country.py
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEWED = "24 June 2026"
REVIEWED_ISO = "2026-06-24"

# Every country page (for the cross-link "Other countries" nav). code -> (url, label)
ALL_COUNTRIES = [
    ("us",  "/vaccination-schedule/us/",  "United States (CDC)"),
    ("uk",  "/vaccination-schedule/uk/",  "United Kingdom (NHS)"),
    ("uae", "/vaccination-schedule/uae/", "United Arab Emirates"),
    ("de",  "/de/impfkalender/",          "Deutschland (STIKO)"),
    ("in",  "/vaccination-schedule/in/",  "India (IAP)"),
    ("ca",  "/vaccination-schedule/ca/",  "Canada (NACI)"),
    ("au",  "/vaccination-schedule/au/",  "Australia (NIP)"),
    ("ie",  "/vaccination-schedule/ie/",  "Ireland (HSE)"),
    ("nz",  "/vaccination-schedule/nz/",  "New Zealand"),
    ("sa",  "/vaccination-schedule/sa/",  "Saudi Arabia (MOH)"),
    ("sg",  "/vaccination-schedule/sg/",  "Singapore (NCIS)"),
]

# Schedule data (verbatim from app/index.html VAX_SCHEDULES): [name, age label, months]
SCHED = {
"au": [['Hepatitis B (birth dose)','At birth',0],['6-in-1 / DTPa-hepB-IPV-Hib (1st dose)','2 months (from 6 weeks)',2],['Pneumococcal / PCV (1st dose)','2 months',2],['Rotavirus (1st dose)','2 months',2],['6-in-1 / DTPa-hepB-IPV-Hib (2nd dose)','4 months',4],['Pneumococcal / PCV (2nd dose)','4 months',4],['Rotavirus (2nd dose)','4 months',4],['6-in-1 / DTPa-hepB-IPV-Hib (3rd dose)','6 months',6],['Meningococcal ACWY','12 months',12],['MMR (1st dose)','12 months',12],['Pneumococcal / PCV (3rd dose)','12 months',12],['MMRV (MMR 2nd dose + varicella)','18 months',18],['Hib (booster)','18 months',18],['DTPa (4th dose)','18 months',18],['DTPa-IPV (4-in-1 pre-school booster)','4 years',48]],
"in": [['BCG','At birth',0],['Hepatitis B (birth dose / 1st dose)','At birth',0],['OPV (0 / birth dose)','At birth',0],['DTwP/DTaP (1st dose)','6 weeks',1.38],['Hib (1st dose)','6 weeks',1.38],['IPV (1st dose)','6 weeks',1.38],['Hepatitis B (2nd dose)','6 weeks',1.38],['Rotavirus (1st dose)','6 weeks',1.38],['PCV (1st dose)','6 weeks',1.38],['DTwP/DTaP (2nd dose)','10 weeks',2.3],['Hib (2nd dose)','10 weeks',2.3],['IPV (2nd dose)','10 weeks',2.3],['Rotavirus (2nd dose)','10 weeks',2.3],['PCV (2nd dose)','10 weeks',2.3],['DTwP/DTaP (3rd dose)','14 weeks',3.22],['Hib (3rd dose)','14 weeks',3.22],['IPV (3rd dose)','14 weeks',3.22],['Rotavirus (3rd dose)','14 weeks',3.22],['PCV (3rd dose)','14 weeks',3.22],['Hepatitis B (3rd dose)','6 months',6],['Typhoid Conjugate Vaccine (TCV)','9 months',9],['MMR (1st dose)','9 months',9],['Hepatitis A (1st dose)','12 months',12],['MMR (2nd dose)','15 months',15],['Varicella (1st dose)','15 months',15],['PCV (booster)','15 months',15],['DTwP/DTaP (1st booster)','16-18 months',16],['Hib (booster)','16-18 months',16],['IPV (booster)','16-18 months',16],['Hepatitis A (2nd dose)','18 months',18],['Varicella (2nd dose)','4-6 years',48],['DTwP/DTaP (2nd booster)','4-6 years',48],['IPV (booster)','4-6 years',48],['MMR (3rd dose)','4-6 years',48]],
"ca": [['Hepatitis B (HB) (1st dose)','At birth',0],['DTaP-IPV-Hib (diphtheria-tetanus-pertussis-polio-Hib) (1st dose)','2 months',2],['Rotavirus (Rot) (1st dose)','2 months',2],['Pneumococcal conjugate (Pneu-C-15 or Pneu-C-20) (1st dose)','2 months',2],['DTaP-IPV-Hib (diphtheria-tetanus-pertussis-polio-Hib) (2nd dose)','4 months',4],['Rotavirus (Rot) (2nd dose)','4 months',4],['Pneumococcal conjugate (Pneu-C-15 or Pneu-C-20) (2nd dose)','4 months',4],['DTaP-IPV-Hib (diphtheria-tetanus-pertussis-polio-Hib) (3rd dose)','6 months',6],['Rotavirus (Rot) (3rd dose, only if pentavalent Rot-5 used)','6 months',6],['Pneumococcal conjugate (Pneu-C-15 or Pneu-C-20) booster','12 months (12-15 months)',12],['Meningococcal C conjugate (Men-C-C)','12 months',12],['MMR (measles-mumps-rubella) (1st dose)','12 months (12-15 months)',12],['Varicella (Var, chickenpox) (1st dose)','12 months (12-15 months)',12],['DTaP-IPV-Hib (diphtheria-tetanus-pertussis-polio-Hib) (4th dose)','18 months',18],['MMR (measles-mumps-rubella) (2nd dose)','18 months',18],['Varicella (Var, chickenpox) (2nd dose)','18 months',18],['DTaP-IPV or Tdap-IPV preschool booster','4 years (4-6 years)',48]],
"ie": [['6-in-1 (1st dose)','2 months',2],['PCV - pneumococcal (1st dose)','2 months',2],['MenB - meningococcal B (1st dose)','2 months',2],['Rotavirus oral (1st dose)','2 months',2],['6-in-1 (2nd dose)','4 months',4],['MenB - meningococcal B (2nd dose)','4 months',4],['Rotavirus oral (2nd dose)','4 months',4],['6-in-1 (3rd dose)','6 months',6],['PCV - pneumococcal (2nd dose)','6 months',6],['MMR (1st dose)','12 months',12],['MenB - meningococcal B (3rd/booster dose)','12 months',12],['Chickenpox / varicella (1st dose)','12 months',12],['6-in-1 (4th/booster dose)','13 months',13],['MenC - meningococcal C (1st dose)','13 months',13],['PCV - pneumococcal (3rd/booster dose)','13 months',13],['4-in-1 booster (diphtheria, tetanus, pertussis, polio)','4-5 years (junior infants)',48],['MMRV - MMR + chickenpox combined (2nd dose)','4-5 years (junior infants)',48]],
"nz": [['Rotavirus (1st dose)','6 weeks',1.38],['6-in-1 diphtheria/tetanus/whooping cough/polio/hepatitis B/Hib (1st dose)','6 weeks',1.38],['Pneumococcal (1st dose)','6 weeks',1.38],['Rotavirus (2nd dose)','3 months',3],['6-in-1 diphtheria/tetanus/whooping cough/polio/hepatitis B/Hib (2nd dose)','3 months',3],['Meningococcal B (1st dose)','3 months',3],['6-in-1 diphtheria/tetanus/whooping cough/polio/hepatitis B/Hib (3rd dose)','5 months',5],['Pneumococcal (2nd dose)','5 months',5],['Meningococcal B (2nd dose)','5 months',5],['MMR measles/mumps/rubella (1st dose)','12 months',12],['Pneumococcal (3rd dose)','12 months',12],['Meningococcal B (3rd dose)','12 months',12],['Hib (booster)','15 months',15],['MMR measles/mumps/rubella (2nd dose)','15 months',15],['Chickenpox / varicella (1 dose)','15 months',15],['4-in-1 diphtheria/tetanus/whooping cough/polio (booster)','4 years',48]],
"sa": [['Hepatitis B (1st dose)','At birth',0],['Hepatitis B (2nd dose)','2 months',2],['Rotavirus (1st dose)','2 months',2],['DTaP (1st dose)','2 months',2],['Hib (1st dose)','2 months',2],['PCV (1st dose)','2 months',2],['IPV (1st dose)','2 months',2],['Hepatitis B (3rd dose)','4 months',4],['Rotavirus (2nd dose)','4 months',4],['DTaP (2nd dose)','4 months',4],['Hib (2nd dose)','4 months',4],['PCV (2nd dose)','4 months',4],['IPV (2nd dose)','4 months',4],['BCG (1st dose)','6 months',6],['Hepatitis B (4th dose)','6 months',6],['Rotavirus (3rd dose)','6 months',6],['DTaP (3rd dose)','6 months',6],['Hib (3rd dose)','6 months',6],['PCV (3rd dose)','6 months',6],['IPV (3rd dose)','6 months',6],['OPV (1st dose)','6 months',6],['Measles (1st dose, single measles)','9 months',9],['MCV4 meningococcal (1st dose)','9 months',9],['MMR (1st dose)','12 months',12],['MCV4 meningococcal (2nd dose)','12 months',12],['PCV (4th dose, booster)','12 months',12],['OPV (2nd dose)','12 months',12],['DTaP (4th dose, booster)','18 months',18],['Hib (4th dose, booster)','18 months',18],['MMR (2nd dose)','18 months',18],['OPV (3rd dose)','18 months',18],['Hepatitis A (1st dose)','18 months',18],['Varicella (1st dose)','18 months',18],['Hepatitis A (2nd dose)','24 months',24],['DTaP (5th dose, booster)','4-6 years',48],['MMR (3rd dose, booster)','4-6 years',48],['OPV (4th dose, booster)','4-6 years',48],['Varicella (2nd dose)','4-6 years',48]],
"sg": [['BCG (1st dose)','At birth',0],['Hepatitis B (1st dose)','At birth',0],['6-in-1: DTaP-IPV-Hib-HepB (1st dose)','2 months',2],['5-in-1: DTaP-IPV-Hib (2nd dose)','4 months',4],['PCV13 / Pneumococcal (1st dose)','4 months',4],['6-in-1: DTaP-IPV-Hib-HepB (3rd dose)','6 months',6],['PCV13 / Pneumococcal (2nd dose)','6 months',6],['PCV13 / Pneumococcal (booster)','12 months',12],['MMR (1st dose)','12 months',12],['Varicella / Chickenpox (1st dose)','12 months',12],['MMRV: MMR (2nd dose) + Varicella (2nd dose)','15 months',15],['5-in-1: DTaP-IPV-Hib (booster)','18 months',18]],
}

# Per-country meta. 's' = UK-English "Immunisation", 'z' = "Immunization".
META = {
"in": dict(lang="en-IN", country="India", iz="Immunisation", auth="IAP", authFull="the Indian Academy of Pediatrics (IAP) Advisory Committee on Vaccines and Immunization Practices (ACVIP)", src="http://www.acvip.org/iap-immunization.php", srcLabel="IAP / ACVIP immunisation schedule", lastAge="4 to 6 years",
  note="This is the <strong>IAP/ACVIP recommended</strong> immunisation schedule used by many paediatricians in India. It is broader than the government Universal Immunization Programme (UIP), which provides a core set of vaccines free of charge. Ask your paediatrician which schedule is right for your baby."),
"ca": dict(lang="en-CA", country="Canada", iz="Immunization", auth="NACI", authFull="Canada's National Advisory Committee on Immunization (NACI)", src="https://www.canada.ca/en/public-health/services/publications/healthy-living/canadian-immunization-guide-part-1-key-immunization-information/page-13-recommended-immunization-schedules.html", srcLabel="Government of Canada immunization schedules", lastAge="4 to 6 years",
  note="Vaccines and exact timing vary by province and territory. This is the nationally recommended infant schedule; check your province or territory's own schedule for the doses and brands funded where you live."),
"au": dict(lang="en-AU", country="Australia", iz="Immunisation", auth="NIP", authFull="Australia's National Immunisation Program (NIP)", src="https://www.health.gov.au/childhood-immunisation/immunisation-schedule", srcLabel="Australian Government National Immunisation Program schedule", lastAge="4 years",
  note="This is the universal NIP childhood schedule. Extra vaccines are funded for Aboriginal and Torres Strait Islander children, for some medical conditions, and seasonal influenza from 6 months."),
"ie": dict(lang="en-IE", country="Ireland", iz="Immunisation", auth="HSE", authFull="Ireland's Health Service Executive (HSE)", src="https://www2.hse.ie/babies-children/vaccines-your-child/", srcLabel="HSE childhood immunisation schedule", lastAge="4 to 5 years",
  note=""),
"nz": dict(lang="en-NZ", country="New Zealand", iz="Immunisation", auth="", authFull="New Zealand's National Immunisation Schedule (Health New Zealand, Te Whatu Ora)", src="https://www.healthnz.govt.nz/immunisations/national-immunisation-schedule", srcLabel="New Zealand National Immunisation Schedule", lastAge="4 years",
  note=""),
"sa": dict(lang="en-SA", country="Saudi Arabia", iz="Immunization", auth="MOH", authFull="Saudi Arabia's Ministry of Health (MOH)", src="https://www.moh.gov.sa/en/HealthAwareness/EducationalContent/HealthTips/Documents/Immunization-Schedule.pdf", srcLabel="Saudi MOH national immunization schedule", lastAge="4 to 6 years",
  note=""),
"sg": dict(lang="en-SG", country="Singapore", iz="Immunisation", auth="NCIS", authFull="Singapore's National Childhood Immunisation Schedule (NCIS)", src="https://www.cda.gov.sg/public/vaccinations/", srcLabel="Singapore National Childhood Immunisation Schedule", lastAge="18 months",
  note="Diphtheria and measles vaccination is compulsory by law in Singapore. Follow your doctor and the current NCIS schedule."),
}


def esc(s):
    return html.escape(s, quote=True)


def parse_age(label):
    """Return (attr_name, value, display) from a schedule age label."""
    low = label.lower()
    disp = re.sub(r"\s*\([^)]*\)", "", label).strip()  # drop parenthetical notes for the Age cell
    if "birth" in low:
        return "data-months", "0", "Birth"
    m = re.search(r"(\d+)\s*weeks?", low)
    if m:
        return "data-weeks", m.group(1), disp
    y = re.search(r"(\d+)(?:\s*-\s*\d+)?\s*years?", low)
    if y:
        return "data-months", str(int(y.group(1)) * 12), disp
    mo = re.search(r"(\d+)(?:\s*-\s*\d+)?\s*months?", low)
    if mo:
        return "data-months", mo.group(1), disp
    return "data-months", "0", disp


def build_rows(doses):
    """Group doses by their numeric age key (3rd element), preserving order."""
    groups, order = {}, []
    for name, label, months in doses:
        if months not in groups:
            groups[months] = {"label": label, "names": []}
            order.append(months)
        groups[months]["names"].append(name)
    rows = []
    for k in order:
        g = groups[k]
        attr, val, disp = parse_age(g["label"])
        vacc = ", ".join(g["names"])
        rows.append(f'      <tr {attr}="{val}"><td class="age">{esc(disp)}</td><td>{esc(vacc)}</td><td class="when"></td></tr>')
    return order, groups, "\n".join(rows)


def others_nav(code):
    links = [f'    <a href="{url}">{esc(label)}</a>' for c, url, label in ALL_COUNTRIES if c != code]
    return "\n".join(links)


def faq(code, order, groups):
    first = groups[order[0]]
    first_age = re.sub(r"\s*\([^)]*\)", "", first["label"]).strip()
    first_vacc = ", ".join(first["names"])
    n_visits = len(order)
    m = META[code]
    a1 = f"At {first_age.lower()} the {m['authFull'].split('(')[0].strip()} schedule includes {first_vacc}."
    a2 = f"The schedule for {m['country']} has {n_visits} vaccination visits from birth through {m['lastAge']}. Exact ages can vary slightly, so your doctor confirms each visit."
    a3 = "Yes. In Cubby the schedule and every log sync in real time across everyone caring for your baby, so parents and a nanny or grandparent all stay on the same page."
    q1 = f"What vaccines are given at {first_age.lower()} in {m['country']}?"
    q2 = f"How many vaccination visits are in the {m['country']} baby schedule?"
    q3 = "Can both parents and our caregiver keep track together?"
    return [(q1, a1), (q2, a2), (q3, a3)]


def page(code):
    m = META[code]
    iz = m.get("iz") or m.get("iz") or "Immunisation"
    iz = m["iz"] if "iz" in m else "Immunisation"
    doses = SCHED[code]
    order, groups, rows = build_rows(doses)
    faqs = faq(code, order, groups)
    url = f"https://little-cubby.com/vaccination-schedule/{code}/"
    auth_tag = f" ({m['auth']})" if m["auth"] else ""
    title = f"Baby Vaccine Schedule 2026{auth_tag}: {m['country']} {iz} Chart | Cubby"
    h1 = f"{m['country']} Baby Vaccine Schedule (2026){auth_tag}: {iz} Chart"
    desc = (f"The {m['authFull'].split('(')[0].strip()} recommended baby vaccine schedule for {m['country']}, "
            f"from birth to {m['lastAge']}, age by age. Enter your baby's birthday to see your dates, then track them in Cubby with reminders.")
    lede = f"Every vaccine {m['authFull'].split('(')[0].strip()} recommends for babies, from birth through {m['lastAge']}, age by age."

    faq_ld = ",\n".join(
        '{"@type":"Question","name":%s,"acceptedAnswer":{"@type":"Answer","text":%s}}' % (_json(q), _json(a))
        for q, a in faqs)
    faq_html = "\n".join(f"    <dt>{esc(q)}</dt>\n    <dd>{esc(a)}</dd>" for q, a in faqs)
    note_html = f'  <p class="note">{m["note"]}</p>\n' if m["note"] else ""

    return f"""<!DOCTYPE html>
<html lang="{m['lang']}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow">
<link rel="alternate" hreflang="{m['lang'].lower()}" href="{url}">
<link rel="alternate" hreflang="x-default" href="https://little-cubby.com/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Cubby">
<meta property="og:title" content="{esc(m['country'])} Baby Vaccine Schedule 2026{esc(auth_tag)}">
<meta property="og:description" content="{esc('Every shot ' + m['authFull'].split('(')[0].strip() + ' recommends for babies. Track it in Cubby with reminders.')}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="https://little-cubby.com/og/cubby-home.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://little-cubby.com/og/cubby-home.png">
<link rel="icon" type="image/png" href="/icons/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Nunito+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/vax.css">
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"MedicalWebPage","name":{_json(m['country'] + ' Baby Vaccine Schedule 2026' + auth_tag)},"description":{_json(desc)},"about":{{"@type":"MedicalGuideline","name":{_json(m['authFull'] + ' childhood immunisation schedule')}}},"lastReviewed":"{REVIEWED_ISO}","isAccessibleForFree":true,"citation":{_json(m['src'])},"publisher":{{"@type":"Organization","name":"Cubby","url":"https://little-cubby.com/"}}}}
</script>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{faq_ld}
]}}
</script>
<script type="application/ld+json">
{{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{{"@type": "ListItem", "position": 1, "name": "Home", "item": "https://little-cubby.com/"}}, {{"@type": "ListItem", "position": 2, "name": {_json(m['country'] + ' baby vaccine schedule')}, "item": "{url}"}}]}}
</script>
</head>
<body>
<header class="site-head">
  <a href="https://little-cubby.com/"><img src="/icons/logo-512.png" alt="Cubby"></a>
  <a class="nm" href="https://little-cubby.com/">Cubby</a>
  <span class="sp"></span>
  <a class="go" href="https://little-cubby.com/app/?c={code}">Open app</a>
</header>
<main class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><span class="cur">{esc(m['country'])} baby vaccine schedule</span></nav>
  <h1>{esc(h1)}</h1>
  <p class="lede">{esc(lede)}</p>
  <p class="meta">Last reviewed {REVIEWED} · Summarised from the official <a href="{esc(m['src'])}" rel="nofollow noopener" target="_blank">{esc(m['srcLabel'])}</a>.</p>
{note_html}
  <div class="calc">
    <label for="dob">Enter your baby's birthday to see your dates</label>
    <input type="date" id="dob">
    <div class="hint">Dates are a guide based on the recommended schedule. Your doctor confirms the exact visits.</div>
  </div>

  <h2>At a glance</h2>
  <table>
    <thead><tr><th>Age</th><th>Vaccines</th><th>Your date</th></tr></thead>
    <tbody>
{rows}
    </tbody>
    <caption>Recommended {esc(m['country'])} schedule, vaccine names as used by {esc(m['authFull'].split('(')[0].strip())}. Ask your doctor about seasonal and catch-up doses.</caption>
  </table>

  <div class="cta">
    <h3>Track this in Cubby</h3>
    <p>Add your baby once and Cubby keeps the whole schedule with gentle reminders, so you never miss a dose, shared with everyone who cares for your little one.</p>
    <a class="btn" href="https://little-cubby.com/app/?c={code}">Start free</a>
  </div>

  <h2>Questions</h2>
  <dl class="faq">
{faq_html}
  </dl>

  <h2>Other countries</h2>
  <div class="others">
{others_nav(code)}
  </div>

  <p class="meta" style="text-align:center;margin-top:14px">More reading: <a href="/articles/never-miss-a-baby-vaccine/">Never miss a vaccine</a> · <a href="/articles/vaccine-side-effects-babies/">Vaccine side effects</a> · <a href="/articles/common-vaccine-questions/">Common vaccine questions</a> · <a href="/articles/catching-up-on-missed-vaccines/">Catching up on missed vaccines</a></p>
  <footer class="src">
    <strong>Source:</strong> <a href="{esc(m['src'])}" rel="nofollow noopener" target="_blank">{esc(m['srcLabel'])}</a>.<br>
    Last reviewed {REVIEWED}. This page is informational only and is not medical advice. Always follow your doctor and the current {esc(m['authFull'].split('(')[0].strip())} schedule.
  </footer>
</main>
<script src="/vax.js"></script>
</body>
</html>
"""


def _json(s):
    import json
    return json.dumps(s, ensure_ascii=False)


def main():
    for code in ["in", "ca", "au", "ie", "nz", "sa", "sg"]:
        out = ROOT / "vaccination-schedule" / code / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page(code), encoding="utf-8")
        print(f"  wrote {out.relative_to(ROOT)}  ({len(SCHED[code])} doses)")
    print("Done.")


if __name__ == "__main__":
    main()
