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

# ── New cards to inject ───────────────────────────────────────────
NEW_CARDS = [
    # PREGNANCY (20)
    ('pregnancy', 'pre-conception', '/articles/pre-conception-health/',
     'Pregnancy · Pre-conception', 'Pre-conception health: folic acid, vitamins and preparing your body',
     'What to do before trying to conceive: folic acid, vitamin D, lifestyle changes and when to see your GP. NHS-sourced.'),
    ('pregnancy', 'pre-conception', '/articles/how-long-to-get-pregnant/',
     'Pregnancy · Pre-conception', 'How long does it take to get pregnant?',
     'How long most couples take to conceive, what affects the timeline, when to see a GP and what helps. NHS-sourced.'),
    ('pregnancy', 'pre-conception', '/articles/understanding-your-fertility/',
     'Pregnancy · Pre-conception', 'Understanding your cycle and fertile window',
     'How the menstrual cycle works, when ovulation happens, what the fertile window is and how to recognise ovulation signs.'),
    ('pregnancy', '1st-trimester', '/articles/your-booking-appointment/',
     'Pregnancy · 1st trimester', 'Your booking appointment: what happens at your first antenatal visit',
     'What to expect at your NHS booking appointment: blood tests, questions you will be asked, and what you receive.'),
    ('pregnancy', '1st-trimester', '/articles/pregnancy-nausea-morning-sickness/',
     'Pregnancy · 1st trimester', 'Pregnancy nausea and morning sickness: what actually helps',
     'Why nausea happens in pregnancy, when it typically eases, what helps and when to seek medical support.'),
    ('pregnancy', '1st-trimester', '/articles/the-12-week-scan/',
     'Pregnancy · 1st trimester', 'The 12-week dating scan: what it checks and what to expect',
     'What the NHS 12-week scan involves, what it measures, and what combined screening for Down\'s syndrome means.'),
    ('pregnancy', '1st-trimester', '/articles/pregnancy-fatigue/',
     'Pregnancy · 1st trimester', 'Pregnancy fatigue: why it happens and how to manage it',
     'Why extreme tiredness is so common in early pregnancy, when it typically eases and practical ways to cope.'),
    ('pregnancy', '1st-trimester', '/articles/miscarriage-early-pregnancy-loss/',
     'Pregnancy · 1st trimester', 'Miscarriage: understanding early pregnancy loss',
     'What miscarriage is, why it happens, what the NHS offers and how to find support after pregnancy loss.'),
    ('pregnancy', '1st-trimester', '/articles/first-trimester-symptoms/',
     'Pregnancy · 1st trimester', 'First trimester symptoms: what is normal and what to watch for',
     'A guide to common first trimester symptoms, when to take a test, and which symptoms need prompt attention.'),
    ('pregnancy', '2nd-trimester', '/articles/the-20-week-scan/',
     'Pregnancy · 2nd trimester', 'The 20-week anomaly scan: what it checks and what to expect',
     'What the NHS 20-week scan looks for, how to prepare, what happens if something unexpected is found.'),
    ('pregnancy', '2nd-trimester', '/articles/pregnancy-nutrition/',
     'Pregnancy · 2nd trimester', 'Pregnancy nutrition: what to eat and what to avoid',
     'A complete guide to eating well in pregnancy: what to eat more of, what to limit and what to avoid entirely.'),
    ('pregnancy', '2nd-trimester', '/articles/exercise-in-pregnancy/',
     'Pregnancy · 2nd trimester', 'Exercise in pregnancy: what is safe and what to avoid',
     'The NHS guidance on safe exercise in pregnancy, including which activities to continue, which to avoid and why.'),
    ('pregnancy', '2nd-trimester', '/articles/gestational-diabetes/',
     'Pregnancy · 2nd trimester', 'Gestational diabetes: screening, diagnosis and management',
     'What gestational diabetes is, who is offered screening, how it is managed and what it means for your birth.'),
    ('pregnancy', '2nd-trimester', '/articles/pregnancy-mental-health/',
     'Pregnancy · 2nd trimester', 'Mental health in pregnancy: anxiety, depression and getting help',
     'Why mental health conditions are common in pregnancy, what the signs are and how to access NHS support.'),
    ('pregnancy', '3rd-trimester', '/articles/counting-kicks/',
     'Pregnancy · 3rd trimester', 'Counting kicks: monitoring fetal movement in pregnancy',
     'Why monitoring your baby\'s movements matters, what is normal and when to contact your maternity unit immediately.'),
    ('pregnancy', '3rd-trimester', '/articles/pre-eclampsia/',
     'Pregnancy · 3rd trimester', 'Pre-eclampsia: signs to recognise and when to call',
     'What pre-eclampsia is, the symptoms to watch for and when to contact your maternity unit. NHS-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/your-birth-plan/',
     'Pregnancy · 3rd trimester', 'Writing a birth plan: what to include and how to approach it',
     'What a birth plan is, what to include and how to discuss it with your midwife. NHS-sourced guidance.'),
    ('pregnancy', '3rd-trimester', '/articles/hospital-bag-checklist/',
     'Pregnancy · 3rd trimester', 'Hospital bag checklist: what to pack for birth',
     'A complete NHS-informed checklist of what to pack for labour, birth and the days that follow.'),
    ('pregnancy', '3rd-trimester', '/articles/pain-relief-in-labour/',
     'Pregnancy · 3rd trimester', 'Pain relief in labour: the options explained',
     'A guide to every pain relief option available in NHS labour wards, from TENS to epidural, with honest pros and cons.'),
    ('pregnancy', '3rd-trimester', '/articles/group-b-strep/',
     'Pregnancy · 3rd trimester', 'Group B strep in pregnancy: testing, risks and decisions',
     'What group B strep is, how it is managed in UK pregnancies and what the options are for testing and treatment.'),

    # PREGNANCY batch 2 (19)
    ('pregnancy', '2nd-trimester', '/articles/anaemia-in-pregnancy/',
     'Pregnancy · 2nd trimester', 'Anaemia in pregnancy: symptoms, causes and treatment',
     'Why anaemia is so common in pregnancy, how it is diagnosed, and how iron deficiency is treated. NHS and NICE-sourced.'),
    ('pregnancy', '2nd-trimester', '/articles/pelvic-girdle-pain/',
     'Pregnancy · 2nd trimester', 'Pelvic girdle pain (PGP) in pregnancy: symptoms and management',
     'What pelvic girdle pain (PGP or SPD) is, why it happens in pregnancy, and how physiotherapy and lifestyle changes help.'),
    ('pregnancy', '2nd-trimester', '/articles/pregnancy-heartburn-reflux/',
     'Pregnancy · 2nd trimester', 'Heartburn and reflux in pregnancy: what helps',
     'Why heartburn is so common in pregnancy, what makes it worse, and what the NHS recommends for relief.'),
    ('pregnancy', '3rd-trimester', '/articles/overdue-pregnancy/',
     'Pregnancy · 3rd trimester', 'Overdue pregnancy: what to expect and your options',
     'What it means to go past your due date, when induction is offered, and what your options are. NHS-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/breech-presentation/',
     'Pregnancy · 3rd trimester', 'Breech presentation: what it means and your options near term',
     'Why some babies are breech at term, what the NHS offers including ECV and planned caesarean, and how to decide.'),
    ('pregnancy', '1st-trimester', '/articles/pregnancy-after-loss/',
     'Pregnancy · 1st trimester', 'Pregnancy after miscarriage or loss: what to expect',
     'The emotional and practical realities of pregnancy after miscarriage or pregnancy loss, and where to find support.'),
    ('pregnancy', '1st-trimester', '/articles/twin-pregnancy/',
     'Pregnancy · 1st trimester', 'Twin pregnancy: what to expect from diagnosis to birth',
     'What makes twin pregnancy different, the antenatal care you will receive, and how birth decisions are made.'),
    ('pregnancy', '1st-trimester', '/articles/nhs-antenatal-schedule/',
     'Pregnancy · 1st trimester', 'NHS antenatal appointments: your schedule from booking to birth',
     'A week-by-week guide to the NHS antenatal appointment schedule for first-time and subsequent pregnancies.'),
    ('pregnancy', '3rd-trimester', '/articles/maternity-leave-pay-uk/',
     'Pregnancy · 3rd trimester', 'Maternity leave and pay: what you are entitled to in the UK',
     'How UK maternity leave and Statutory Maternity Pay work, when to notify your employer, and what to do if self-employed.'),
    ('pregnancy', '3rd-trimester', '/articles/paternity-leave-pay-uk/',
     'Pregnancy · 3rd trimester', 'Paternity leave and pay: what partners are entitled to in the UK',
     'How UK paternity leave and Statutory Paternity Pay work, qualifying rules and Shared Parental Leave options.'),
    ('pregnancy', '3rd-trimester', '/articles/godh-bharai/',
     'Pregnancy · 3rd trimester', 'Godh bharai: the Indian pregnancy ceremony',
     'What the godh bharai ceremony is, when it takes place, what happens, and how it is celebrated across Indian families today.'),
    ('pregnancy', '1st-trimester', '/articles/pregnancy-traditions-india/',
     'Pregnancy · 1st trimester', 'Pregnancy traditions and beliefs in Indian culture',
     'An overview of Indian pregnancy traditions, dietary beliefs, activity customs and what medical evidence says about them.'),
    ('pregnancy', '1st-trimester', '/articles/chinese-pregnancy-traditions/',
     'Pregnancy · 1st trimester', 'Chinese pregnancy traditions: customs, beliefs and what the evidence says',
     'Common Chinese pregnancy customs, dietary beliefs and taboos, with an evidence-based look at which advice holds up.'),
    ('pregnancy', '2nd-trimester', '/articles/iwata-obi/',
     'Pregnancy · 2nd trimester', 'Iwata obi: the Japanese pregnancy belly band tradition',
     'What the iwata obi belly band is, when and why it is worn, and the Inu no Hi ceremony in Japanese pregnancy custom.'),
    ('pregnancy', '1st-trimester', '/articles/boshi-techo/',
     'Pregnancy · 1st trimester', "Boshi techo: Japan's mother and child health handbook",
     "What the boshi techo is, what it records, and how Japan's portable maternal and child health record system works."),
    ('pregnancy', '1st-trimester', '/articles/antenatal-care-australia/',
     'Pregnancy · 1st trimester', 'Antenatal care in Australia: your options and what is covered',
     'How antenatal care works in Australia, the difference between public and private care, and what Medicare covers.'),
    ('pregnancy', '3rd-trimester', '/articles/birth-choices-australia/',
     'Pregnancy · 3rd trimester', 'Birth choices in Australia: public, private and birth centres',
     'The different birth settings available in Australia, what each involves, and how to choose.'),
    ('pregnancy', '1st-trimester', '/articles/genetic-testing-pregnancy/',
     'Pregnancy · 1st trimester', 'Genetic testing in pregnancy: NIPT, CVS and amniocentesis explained',
     'What the different types of genetic tests in pregnancy are, who is offered them, and how to think about the decision.'),
    ('pregnancy', '3rd-trimester', '/articles/vaginal-birth-after-caesarean/',
     'Pregnancy · 3rd trimester', 'Vaginal birth after caesarean (VBAC): what the evidence says',
     'Who is a candidate for VBAC, what the success rate and risks are, and how to discuss the decision with your team.'),

    # PREGNANCY batch 3 (20)
    ('pregnancy', '1st-trimester', '/articles/prenatal-care-usa/',
     'Pregnancy · 1st trimester', 'Prenatal care in the USA: your schedule, costs and what to expect',
     'How prenatal care works in the United States, the standard appointment schedule, what is covered by insurance, and what differs from UK maternity care. ACOG-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/us-prenatal-visit-schedule/',
     'Pregnancy · 1st trimester', 'US prenatal visit schedule: what happens at each appointment',
     'A visit-by-visit guide to what happens at each prenatal appointment in the United States, from the first visit through the final weeks. ACOG and AAP-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/us-maternity-leave/',
     'Pregnancy · 3rd trimester', 'Maternity and parental leave in the USA: federal and state rights',
     'What US federal and state maternity leave laws provide, who qualifies, and how state programs compare. DOL FMLA-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/mutterpass/',
     'Pregnancy · 1st trimester', "Mutterpass: Germany's maternity record booklet explained",
     "What the Mutterpass is, what it records, and how the German antenatal care system works. G-BA and BZgA-sourced."),
    ('pregnancy', '1st-trimester', '/articles/hebamme-germany/',
     'Pregnancy · 1st trimester', 'Hebamme: midwifery care in Germany and how to find one',
     'What a Hebamme (midwife) does in Germany, what is covered by insurance, and how to find and book one early. Deutscher Hebammenverband-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/elterngeld/',
     'Pregnancy · 3rd trimester', "Elterngeld: Germany's parental allowance explained",
     "How Elterngeld (parental allowance) works in Germany, how much you receive, who qualifies, and how to apply. BMFSFJ-sourced."),
    ('pregnancy', '1st-trimester', '/articles/gravidanza-italy/',
     'Pregnancy · 1st trimester', 'Pregnancy care in Italy: the antenatal system explained',
     'How antenatal care works in Italy through the SSN, what is covered, and how the appointment schedule compares to the UK. Italian Ministry of Health-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/congedo-maternita/',
     'Pregnancy · 3rd trimester', 'Congedo di maternita: maternity leave and pay in Italy',
     'How Italian maternity leave and pay (congedo di maternita) works, how much is paid, and what rights fathers and partners have. INPS-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/quarantina-italy/',
     'Pregnancy · 3rd trimester', 'La quarantina: the Italian postnatal rest tradition',
     'What the Italian tradition of la quarantina is, how it is observed, and what evidence says about postnatal rest.'),
    ('pregnancy', '3rd-trimester', '/articles/caesarean-section-recovery/',
     'Pregnancy · 3rd trimester', 'Caesarean section recovery: what to expect in the days and weeks after birth',
     'A guide to physical recovery after a caesarean section, including wound care, pain management, and gradual return to activity. NHS and RCOG-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/skin-to-skin-after-birth/',
     'Pregnancy · 3rd trimester', 'Skin-to-skin contact after birth: benefits and how it works',
     'What skin-to-skin contact is, the evidence for its benefits, and how it works after both vaginal and caesarean birth. NHS, WHO and UNICEF-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/postnatal-first-week/',
     'Pregnancy · 3rd trimester', 'The first week after birth: what to expect for mother and baby',
     'What happens to your body and your baby in the first seven days after birth, and what the NHS midwifery team will check. NHS and NICE-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/perineal-tears-recovery/',
     'Pregnancy · 3rd trimester', 'Perineal tears and episiotomy: recovery after birth',
     'What the different degrees of perineal tear are, how recovery works, and what to expect with an episiotomy. NHS and RCOG-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/vitamin-d-pregnancy/',
     'Pregnancy · 1st trimester', 'Vitamin D in pregnancy: why it matters and how much you need',
     'Why vitamin D is important during pregnancy, who is at risk of deficiency, and what the NHS recommends. NHS and SACN-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/iron-pregnancy/',
     'Pregnancy · 1st trimester', 'Iron in pregnancy: foods, supplements and preventing deficiency',
     'Why iron requirements increase in pregnancy, which foods are richest in iron, and when the NHS recommends supplements. NHS and NICE-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/alcohol-caffeine-pregnancy/',
     'Pregnancy · 1st trimester', 'Alcohol and caffeine in pregnancy: what the NHS advises',
     'The NHS guidance on alcohol and caffeine in pregnancy, what the evidence shows, and why the limits are set where they are.'),
    ('pregnancy', '3rd-trimester', '/articles/birth-positions/',
     'Pregnancy · 3rd trimester', 'Birth positions: options for labour and how they can help',
     'The different positions for labour and birth, what evidence says about upright positions, and how to use them. NHS and NICE-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/induction-of-labour/',
     'Pregnancy · 3rd trimester', 'Induction of labour: methods, reasons and what to expect',
     'Why induction of labour is offered, the methods used in the NHS, and what the process involves. NHS and NICE-sourced.'),
    ('pregnancy', '3rd-trimester', '/articles/preparing-for-a-newborn/',
     'Pregnancy · 3rd trimester', 'Preparing for a newborn: what you actually need and what can wait',
     'A practical guide to what you genuinely need for a newborn and what is unnecessary or can wait until after the birth. NHS-sourced.'),
    ('pregnancy', '1st-trimester', '/articles/pregnancy-after-35/',
     'Pregnancy · 1st trimester', 'Pregnancy after 35: what changes, what to expect, and what the evidence says',
     'An evidence-based look at pregnancy after 35, including what risks are genuinely higher and what additional care is offered. NHS and RCOG-sourced.'),

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

    # COMPARISONS — global (2)
    ('compare', 'all',     '/articles/cubby-vs-glow-baby/',
     'Comparison · All ages', 'Cubby vs Glow Baby (2026): which baby tracker is better?',
     'A direct comparison of Cubby and Glow Baby: features, privacy, vaccine schedules and price.'),
    ('compare', 'all',     '/articles/cubby-vs-tinybeans/',
     'Comparison · All ages', 'Cubby vs Tinybeans (2026): health tracker vs memory book',
     'How Cubby and Tinybeans compare: health tracking vs photo sharing, privacy, price and who each app suits.'),

    # INDIA (5)
    ('care',      'newborn', '/articles/indian-baby-massage-maalish/',
     'Care · Newborn', 'Maalish: traditional newborn oil massage',
     'Traditional Indian oil massage for newborns: which oils are safe, the technique, benefits the evidence supports, and safety guidelines.'),
    ('feeding',   '6-12',   '/articles/indian-first-foods-weaning/',
     'Feeding · 6-12 months', 'Khichdi, ragi and traditional weaning foods',
     'When and how to introduce traditional Indian weaning foods like khichdi, ragi porridge and dal: what is nutritious, what is safe, and what the WHO recommends.'),
    ('wellbeing', 'newborn', '/articles/indian-postnatal-traditions/',
     'Wellbeing · Newborn', 'Postnatal traditions: what to keep, what to adapt',
     'The 40-day rest period, traditional postpartum diet and family support in Indian culture: what the evidence supports and how diaspora families adapt.'),
    ('health',    'newborn', '/articles/jaundice-recognition-darker-skin/',
     'Health · Newborn', 'Newborn jaundice in darker skin: what to check',
     'Jaundice is harder to see on darker skin. How to check the whites of the eyes, palms and soles, when to ask for a bilirubin measurement, and what NHS guidance says.'),
    ('health',    'all',    '/articles/baby-care-hot-weather/',
     'Health · All ages', 'Keeping your baby safe in hot weather: signs of overheating and what to do',
     'How heat affects babies, signs of overheating, keeping babies cool in hot climates, safe sleep in summer, and when to get medical help.'),

    # AUSTRALIA (5)
    ('health',    'newborn', '/articles/sids-red-nose-australia/',
     'Health · Newborn', 'Safe sleep: the Red Nose guidelines',
     'Red Nose Australia safe sleeping guidelines: back to sleep, face uncovered, smoke free, safe environment, room sharing and breastfeeding.'),
    ('feeding',   '6-12',   '/articles/starting-solids-australia/',
     'Feeding · 6-12 months', 'Starting solids: NHMRC guidance',
     'When and how to introduce solid foods per the Australian NHMRC infant feeding guidelines: first foods, allergens, textures and what to avoid.'),
    ('care',      'all',    '/articles/sun-safety-australia/',
     'Care · All ages', 'Sun safety for babies: UV, shade and clothing',
     'Australia has some of the world\'s highest UV levels. SunSmart guidelines for protecting babies under 12 months: shade, clothing and when sunscreen is appropriate.'),
    ('health',    'all',    '/articles/heatwave-babies-australia/',
     'Health · All ages', 'Heatwave safety for babies',
     'What to do when temperatures exceed 35-40 degrees: keeping babies cool, signs of heat stress, when to call 000, and guidance from Australian state health authorities.'),
    ('feeding',   'newborn', '/articles/breastfeeding-support-australia/',
     'Feeding · Newborn', 'Breastfeeding support: where to get help',
     'Free breastfeeding help in Australia: the Australian Breastfeeding Association helpline 1800 686 268, lactation consultants, Child and Family Health Nurses and online resources.'),

    # CHINESE PARENTING (3)
    ('wellbeing', 'newborn', '/articles/zuo-yuezi-postnatal-confinement/',
     'Wellbeing · Newborn', 'Zuo yuezi: the postnatal confinement tradition',
     'What the Chinese 30-day postpartum rest tradition involves, what modern evidence supports, and how diaspora families adapt it for today.'),
    ('feeding',   '6-12',   '/articles/congee-baby-first-food/',
     'Feeding · 6-12 months', 'Congee as a baby first food',
     'How traditional Chinese rice congee works as a first weaning food, what to add for iron and protein, and how to make it by age.'),
    ('care',      'newborn', '/articles/chinese-baby-care-traditions/',
     'Care · Newborn', 'Chinese baby care traditions',
     'Traditional Chinese newborn practices including swaddling, herbal baths and outdoor exposure: what modern evidence supports and what to adapt.'),

    # FEEDING FAQ (10)
    ('feeding',   '6-12',   '/articles/baby-gagging-vs-choking/',
     'Feeding · 6-12 months', 'Baby gagging vs choking: what is normal and what is an emergency',
     'What the gag reflex is, why gagging on solid food is normal and protective, and how to tell the difference between gagging and choking. NHS and St John Ambulance-sourced.'),
    ('feeding',   '6-12',   '/articles/first-foods-for-babies/',
     'Feeding · 6-12 months', 'First foods for babies: what to give at the start of weaning',
     'What the NHS recommends as the best first foods for babies, how much to give, and how to prepare them safely. Start4Life and NHS-sourced.'),
    ('feeding',   '6-12',   '/articles/how-much-solids-by-age/',
     'Feeding · 6-12 months', 'How much solid food by age: a guide from 6 to 12 months',
     'How much solid food babies need at 6, 7, 8, 9 and 12 months, and how meal portions grow alongside milk feeds. NHS and BDA-sourced.'),
    ('feeding',   '6-12',   "/articles/cows-milk-for-babies/",
     'Feeding · 6-12 months', "Cow's milk for babies: when it is safe and how to use it",
     "When babies can drink cow's milk, how to use it in cooking from 6 months, and why it should not replace breast or formula milk before 12 months. NHS-sourced."),
    ('feeding',   '6-12',   '/articles/eggs-for-babies/',
     'Feeding · 6-12 months', 'Eggs for babies: when they are safe and how to serve them',
     'When babies can eat eggs, which eggs are safe at different stages, how to cook and serve them, and what to watch for. NHS-sourced.'),
    ('feeding',   '6-12',   '/articles/salt-sugar-baby-food/',
     'Feeding · 6-12 months', 'Salt and sugar in baby food: NHS limits and what to watch for',
     'Why babies need very little salt and sugar, what NHS limits apply, how to read food labels, and how to cook for babies without adding either.'),
    ('feeding',   '6-12',   '/articles/dairy-for-babies/',
     'Feeding · 6-12 months', 'Dairy for babies: cheese, yogurt and fromage frais explained',
     "When babies can have dairy foods, which dairy products are safe at which stage, and what to look for on labels. NHS-sourced."),
    ('feeding',   '6-12',   '/articles/food-textures-for-babies/',
     'Feeding · 6-12 months', 'Baby food textures: the progression from purees to finger foods',
     'How baby food textures should progress from smooth purees to lumpy, mashed and then soft pieces and finger foods. NHS and BDA-sourced.'),
    ('feeding',   '6-12',   '/articles/reducing-milk-on-solids/',
     'Feeding · 6-12 months', 'Milk feeds when starting solids: how much formula or breast milk to give',
     'How milk feeds change when a baby starts solid food, how much formula or breast milk to give at 6, 9 and 12 months, and when to drop feeds. NHS-sourced.'),
    ('health',    '6-12',   '/articles/food-allergy-signs-babies/',
     'Health · 6-12 months', 'Food allergy signs in babies: how to recognise a reaction',
     'How to spot the signs of a food allergy in babies after introducing new foods, what reactions look like, and when to call 999. NHS and NICE-sourced.'),
]

# ── Order in which categories cycle (determines first-fold order) ──
CAT_ORDER = ['pregnancy', 'vaccines', 'sleep', 'feeding', 'development',
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
