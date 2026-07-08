#!/usr/bin/env python3
"""Generate Cubby category hub pages (toddler, fertility, breastfeeding, postnatal
recovery, mental health) that were referenced by article breadcrumbs but never built.

Re-runnable: it rebuilds each hub from the current article set (title + first line of the
meta description), so hubs stay fresh as articles are added. Matches the existing
sleep/feeding/health hub template. Also generates the hub's own og image.

  python3 tools/gen_category_hub.py            # build all hubs
  python3 tools/gen_category_hub.py toddler    # build one
"""
import os, re, sys, html, glob, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
_spec = importlib.util.spec_from_file_location("gai", "tools/gen_article_img.py")
gai = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(gai)

# Each hub: slug, crumb label, h1, SEO title, meta description, intro, article-match
# pattern (on slug), image pill theme+age, and a few safe FAQ Q&A. Copy follows the house
# voice: warm, second person, sentence case, no em-dashes, no guilt.
HUBS = {
 "toddler": dict(
   crumb="Toddler", h1="Toddler guide", theme="Toddler", age="1 to 3 years",
   title="Toddler Guide: Tantrums, Sleep, Speech and Development | Cubby",
   desc="Real, calm guides to the toddler years: tantrums, sleep, potty training, speech and what is normal, sourced from NHS and AAP and written without the panic.",
   pat=r'toddler|tantrum|potty|two-year|2-year|18-month|24-month|speech-delay|language-development|moving-to-toddler|autism|biting|hitting',
   intro="The toddler years are big feelings in a small body. Here are honest, gentle guides to tantrums, sleep, speech, potty training and the milestones in between, so you know what is normal and when a wobble is just a wobble.",
   faq=[("When do tantrums start and when do they stop?","Tantrums usually begin around 12 to 18 months, peak in the second and third years, and ease as language and self-control grow, often by around age four. They are a normal part of development, not a sign you are doing anything wrong."),
        ("How much sleep does a toddler need?","Most toddlers need about 11 to 14 hours in 24 hours, including one nap that gradually drops between two and four years. Sleep needs vary, so watch your own child's mood and energy rather than the clock alone."),
        ("When should I worry about my toddler's speech?","Talk to your health visitor or GP if your toddler has very few words by two years, is not putting two words together by around two and a half, or seems to lose skills they had. Early support helps, and asking is never an overreaction."),
        ("When is my toddler ready for potty training?","Readiness matters more than age. Signs include staying dry for longer stretches, showing interest in the toilet, and being able to follow simple instructions, often somewhere between two and three years.")]),
 "fertility": dict(
   crumb="Fertility", h1="Fertility and trying to conceive", theme="Fertility", age="Before baby",
   title="Fertility Guide: Ovulation, Cycles and Trying to Conceive | Cubby",
   desc="Clear, kind guides to trying to conceive: ovulation, cycle tracking, the two-week wait, folic acid and when to seek help, sourced from NHS and clinical guidance.",
   pat=r'fertility|ovulation|conceiv|ttc|two-week-wait|implantation|pcos|preconception|trying-to|cycle|luteal|sperm|folic-acid-dosage',
   intro="Trying for a baby can be hopeful and hard in the same week. These guides cover ovulation, cycle tracking, the two-week wait, and the small things that help, plus when it is worth talking to a doctor. No pressure, just clear information.",
   faq=[("When am I most fertile in my cycle?","You are most likely to conceive in the few days before and on the day of ovulation, which is usually around the middle of your cycle. Tracking your cycle, cervical mucus or ovulation tests can help you spot your fertile window."),
        ("How long does it usually take to conceive?","Most couples conceive within a year of trying. Around 8 in 10 will be pregnant within 12 months of regular unprotected sex. If you are under 35 and it has been a year, or over 35 and it has been six months, it is worth seeing your GP."),
        ("Should I take folic acid before pregnancy?","Yes. It is recommended to take folic acid daily while trying to conceive and for the first 12 weeks of pregnancy, as it lowers the risk of neural tube defects. Your GP can advise if you need a higher dose."),
        ("Does tracking ovulation really help?","It can help you time things well, but it is not the whole picture. Regular sex every two to three days across the cycle also covers your fertile window without the pressure of precise timing.")]),
 "breastfeeding": dict(
   crumb="Breastfeeding", h1="Breastfeeding guide", theme="Breastfeeding", age="Feeding",
   title="Breastfeeding Guide: Latch, Supply, Pain and Weaning | Cubby",
   desc="Practical, judgement-free breastfeeding guides: latch and positioning, supply, engorgement, mastitis, tongue tie, pumping and stopping, sourced from NHS and lactation guidance.",
   pat=r'breastfeed|nursing|latch|engorge|mastitis|galactagogue|milk-supply|weaning-off|night-weaning|stopping-breast|expressing|pumping|lactation|tongue-tie|cluster-feeding|nipple',
   intro="However you feed your baby, you are doing a good job. If you are breastfeeding, these guides cover latch, supply, the painful bits, pumping and stopping when you are ready, so you can find what works for you and your baby.",
   faq=[("How do I know my baby is getting enough milk?","Good signs are steady weight gain, plenty of wet and dirty nappies, and a baby who is content after most feeds. Your health visitor can weigh your baby and reassure you if you are unsure."),
        ("Why does breastfeeding hurt, and is that normal?","A little tenderness in the early days is common, but ongoing pain usually points to the latch. Repositioning often helps quickly. Cracked nipples, a blocked duct or thrush also cause pain and are worth getting checked."),
        ("What can I do about engorgement or a blocked duct?","Feed or express often, use gentle warmth before a feed and cold after, and massage the area towards the nipple. See your GP promptly if you develop a hot, painful lump with flu-like symptoms, as this can be mastitis."),
        ("How do I stop breastfeeding gently?","Drop one feed at a time every few days so your supply adjusts and you avoid engorgement. There is no right age to stop, and a gradual wind-down is kinder for both of you.")]),
 "postnatal-recovery": dict(
   crumb="Postnatal recovery", h1="Postnatal recovery", theme="Postnatal", age="After birth",
   title="Postnatal Recovery: Healing, Your Body and the Fourth Trimester | Cubby",
   desc="Honest guides to recovering after birth: bleeding, stitches, caesarean healing, pelvic floor, your changing body and rest, sourced from NHS and RCOG guidance.",
   pat=r'postnatal-recovery|after-birth|perineal|caesarean|c-section|diastasis|postpartum-(recovery|hair|body|bleeding)|confinement|quarantina|zuo-yuezi|returning-to-exercise|pelvic-floor|stitches|vaginal-birth-after|fourth-trimester|lochia',
   intro="Your body did something enormous, and healing takes time. These guides cover the physical recovery after birth, from bleeding and stitches to caesarean healing, your pelvic floor and easing back into movement, gently and at your own pace.",
   faq=[("How long does bleeding after birth last?","Bleeding, called lochia, usually lasts two to six weeks and slowly changes from red to pink to brown. See your midwife or GP if you pass large clots, the bleeding suddenly gets heavier, or it smells unpleasant."),
        ("How long does a caesarean take to heal?","The wound usually feels much better within a few weeks, but full recovery takes around six weeks or more. Take it slowly, avoid heavy lifting, and get any redness, swelling or increasing pain checked."),
        ("When can I start exercising again?","Gentle walking and pelvic floor exercises can start early, but wait for your six-week check before higher-impact exercise, and longer after a caesarean. Build up slowly and stop if anything hurts."),
        ("What is the fourth trimester?","The fourth trimester is the first three months after birth, a time of huge change for you and your baby. Rest, support and low expectations are not indulgent, they are how you recover.")]),
 "mental-health": dict(
   crumb="Mental health", h1="Parent mental health", theme="Mental health", age="For parents",
   title="Parent Mental Health: Anxiety, Depression and Getting Support | Cubby",
   desc="Compassionate guides to parent mental health: baby blues, postnatal depression and anxiety, rage, guilt and where to find help, sourced from NHS and PANDA guidance.",
   pat=r'depression|anxiety|postpartum-rage|mum-guilt|mental-health|ppd|baby-blues|matrescence|loneliness|intrusive-thought|panda|beyond-blue|self-care-for-new',
   intro="Looking after a baby is a lot, and your mind matters as much as your body. These guides cover the baby blues, postnatal depression and anxiety, the difficult feelings no one warns you about, and the many ways to get support. You are not alone, and asking for help is a strength.",
   faq=[("What is the difference between the baby blues and postnatal depression?","The baby blues are common in the first two weeks, with tearfulness and mood swings that pass on their own. If low mood, anxiety or hopelessness lasts beyond two weeks or feels overwhelming, it may be postnatal depression, which is treatable with the right support."),
        ("Is it normal to feel anxious or angry as a new parent?","Yes. Anxiety, intrusive thoughts and even rage are common and do not make you a bad parent. If these feelings are frequent, frightening or getting in the way of daily life, talk to your GP or health visitor."),
        ("When should I reach out for help?","Reach out any time you are struggling, you do not need to wait for a crisis. Speak to your GP, health visitor or a helpline if low mood, anxiety or scary thoughts persist, and seek urgent help if you ever feel unsafe."),
        ("Can dads and partners get postnatal depression too?","Yes. Partners can experience depression and anxiety after a baby arrives. The same support helps, and getting it early is good for the whole family.")]),
}


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


def article_meta(f):
    t = open(f, encoding="utf-8").read()
    pos = dict(re.findall(r'"position":\s*(\d+),\s*"name":\s*"([^"]+)"', t))
    title = pos.get("4") or (re.search(r'<h1[^>]*>(.*?)</h1>', t, re.S) or [None, None])[1]
    if not title:
        m = re.search(r'<title>(.*?)</title>', t, re.S); title = (m.group(1) if m else "Guide").split(" | ")[0]
    d = re.search(r'<meta name="description" content="([^"]+)"', t)
    desc = clean(d.group(1)) if d else ""
    first = re.split(r'(?<=[.!?])\s', desc)[0] if desc else ""
    if len(first) > 130:
        first = first[:127].rstrip() + "..."
    return clean(title), first


def match_articles(pat, self_slug):
    rx = re.compile(pat)
    out = []
    for f in sorted(glob.glob("articles/*/index.html")):
        slug = f.split("/")[1]
        if slug == self_slug or slug in HUBS:
            continue
        if rx.search(slug):
            title, desc = article_meta(f)
            out.append((slug, title, desc))
    # stable, readable order: by title
    return sorted(out, key=lambda x: x[1].lower())


def faq_jsonld(faq):
    items = ",".join('{"@type":"Question","name":%s,"acceptedAnswer":{"@type":"Answer","text":%s}}'
                     % (_j(q), _j(a)) for q, a in faq)
    return '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[%s]}' % items


def _j(s):
    import json
    return json.dumps(s, ensure_ascii=False)


def crumb_jsonld(slug, h1):
    return ('{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":['
            '{"@type":"ListItem","position":1,"name":"Home","item":"https://little-cubby.com/"},'
            '{"@type":"ListItem","position":2,"name":"Articles","item":"https://little-cubby.com/articles/"},'
            '{"@type":"ListItem","position":3,"name":%s,"item":"https://little-cubby.com/articles/%s/"}]}'
            % (_j(h1), slug))


def build(slug):
    h = HUBS[slug]
    arts = match_articles(h["pat"], slug)
    gai.generate(slug, h["h1"], h["age"], h["theme"], ".")  # og + hero
    og = f"https://little-cubby.com/og/articles/{slug}.png"

    li = "\n".join(
        f'    <li><a href="/articles/{s}/">{html.escape(t)}</a>. {html.escape(d)}</li>'
        for s, t, d in arts)
    faq_html = "\n".join(f'  <h3>{html.escape(q)}</h3>\n  <p>{html.escape(a)}</p>' for q, a in h["faq"])

    page = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{h["title"]}</title>
<meta name="description" content="{h["desc"]}">
<link rel="canonical" href="https://little-cubby.com/articles/{slug}/">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website"><meta property="og:site_name" content="Cubby">
<meta property="og:title" content="{h["h1"]}">
<meta property="og:description" content="{h["desc"]}">
<meta property="og:image" content="{og}">
<meta property="og:url" content="https://little-cubby.com/articles/{slug}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{og}">
<link rel="icon" type="image/png" href="/icons/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Nunito+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/vax.css"><link rel="stylesheet" href="/site.css">
<script type="application/ld+json">
{faq_jsonld(h["faq"])}
</script>
<script type="application/ld+json">
{crumb_jsonld(slug, h["h1"])}
</script>
</head>
<body>
<nav class="nav"><div class="nav-in">
  <a class="nav-brand" href="/"><img src="/icons/logo-512.png" alt="Cubby"><b>Cubby</b></a>
  <div class="nav-tabs"><a href="/pregnancy/">Pregnancy</a><a href="/features/">Baby</a><a href="/articles/" class="on">Articles</a><a href="/pricing/">Pricing</a><details class="nav-about"><summary>About</summary><div class="nav-menu"><a href="/why/">Why Cubby</a><a href="/how-it-works/">How it works</a><a href="/faq/">FAQ</a></div></details></div>
  <a class="nav-cta" href="/app/?utm_source=hub&utm_medium=organic&utm_campaign={slug}-hub">Start free</a>
</div></nav>
<main class="wrap article">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><a href="/articles/">Articles</a><span class="sep" aria-hidden="true">›</span><span class="cur">{h["h1"]}</span></nav>
  <h1>{h["h1"]}</h1>
  <p class="art-meta">{len(arts)} guides · {h["crumb"]}</p>

  <p>{h["intro"]}</p>

  <h2>Guides in this section</h2>
  <ul>
{li}
  </ul>

  <h2>Common questions</h2>
{faq_html}

  <div class="cta">
    <h3>One calm place for all of it</h3>
    <p>Cubby keeps the feeds, sleep, milestones and memories in one shared, private place, so the details never live in one tired head.</p>
    <a class="btn" href="/app/?utm_source=hub&utm_medium=organic&utm_campaign={slug}-hub">Start free</a>
  </div>

  <footer class="src">Hub · Summarised from NHS, AAP and WHO guidance. Informational only and not medical advice. See our <a href="/editorial/">editorial process</a>.</footer>
</main>
<script defer src="/news-widget.js"></script>
<script defer src="/install.js"></script>
</body>
</html>
'''
    os.makedirs(f"articles/{slug}", exist_ok=True)
    open(f"articles/{slug}/index.html", "w", encoding="utf-8").write(page)
    print(f"  built /articles/{slug}/ ({len(arts)} guides)")


def main():
    which = [a for a in sys.argv[1:] if a in HUBS] or list(HUBS)
    for slug in which:
        build(slug)
    print("Done.")


if __name__ == "__main__":
    main()
