# Cubby health pages: clinical review pack

Cubby is a free app and website for parents in pregnancy and the first years. Its health pages are read
by worried parents, often at night. Each page needs two independent clinicians to sign off its exact words.

A page's wording is held as it stands until two of you sign off a change: the site's build refuses any
other change to it (`tools/clinical_lock_check.js`). After sign-off, any later change to the words needs
two sign-offs again. The words covered are the page title, the search description, the article headline
and summary in its structured data, the article body, and every question and answer in its structured
data. Breadcrumbs, the "Start free" box, the related-articles list and the site footer are not covered.

One exception keeps parents safe: an urgent fix that brings a page in line with an official source may go
live before sign-off. It is listed in `docs/clinical-review/safety-fixes.json` with that source's link,
the date and a sign-off due date at most 14 days later, and two of you then review the fixed page.

## The sources Cubby follows, in this order

1. **NHS** (nhs.uk) first, for UK-facing pages and as the default.
2. **AAP** (healthychildren.org, aap.org) for US guidance and safe sleep.
3. **NICE** guidelines (nice.org.uk), for thresholds and when-to-refer levels (for example NG143 fever in under 5s, CG176/NG232 head injury).
4. **Local health authorities** on pages written for a country: UAE (DHA, DoH Abu Dhabi, MOHAP), Japan (MHLW, Japan Pediatric Society), Australia (healthdirect, Red Nose, ASCIA, RCH Melbourne), and the national body on any other country's page (for example ISS for Italy, BZgA for Germany, MoHFW and IAP for India).

Where sources disagree, the page should say which one it follows for that country. If a page cites
something that is not an official source, mark it.

## What to check on each page

Read the page as a tired parent would, top to bottom, including the questions and answers at the end.
For each page, check:

- **Every action step.** Is it right, in the right order, and safe to follow exactly as written?
- **Every age and dose limit.** Medicine names, minimum ages, doses, intervals, maximums, weight rules.
- **Every threshold.** Temperatures, breathing rates, durations, numbers of nappies, ages in weeks or months.
- **Every phone number and service.** Right number for the country the page is for (999, 111, 911, 998, 119 and so on), and nothing from another country in an urgent box.
- **Every when-to-call level.** Is each sign sent to the right level: emergency number now, urgent same-day help (111, GP, A&E), or routine care? Nothing urgent may be softened; nothing routine may be made frightening.
- **What is missing.** A danger sign a parent needs that the page leaves out.
- **Claims about the app.** The page must not suggest Cubby diagnoses, monitors or alerts anyone.

Write each problem as: the exact sentence, what is wrong, the source (with a link), and the fix you would
accept. Cubby makes the fixes; you then read the changed page again before signing.

## How to sign off

Sign off only the page as it stands, after any fixes. For each page, send Cubby:

- the page slug (from the list below) and the date you reviewed it;
- your full name and credential (for example registered midwife, GP, paediatrician);
- your registration body and number (for example NMC, GMC, AHPRA, DHA, DoH, MOHAP, a national medical council);
- a line saying you have checked every step, limit, threshold, number and when-to-call level on that page and agree it is safe and correct for the country it is written for.

Cubby records it against a hash of the page's exact words (`node tools/clinical_lock_check.js --hash=<slug>`).
Two reviewers with different registrations are needed per page. A sign-off covers those words only: if
the page changes, it is reviewed again.

Your details stay private. Your name, credential, registration and date are kept outside Cubby's code, in
a private record only Cubby holds. The public code keeps only, per page, the approved hash, the number of
sign-offs and the date (`docs/clinical-review/approved.json`), with no names.

Only record a reviewer who has actually sent the signed confirmation above. Never enter names, numbers or
dates on anyone's behalf.

## Pages in scope (63)

These are the pages about emergencies, medicines, fever, breathing, safe sleep, seizures, head injury,
choking, allergy, medicines in pregnancy and mental health in pregnancy and after birth, plus the pages
whose answers are held in step with their search-result copy. Hub pages that only list other articles
(such as the sleep, wellbeing and mental health hubs) are not in scope. `node tools/clinical_lock_check.js` prints
the current list.

| Page | Link | Why it is in scope |
|---|---|---|
| Safe sleep for babies: the evidence-based guidelines | [aap-safe-sleep-guidelines](https://little-cubby.com/articles/aap-safe-sleep-guidelines/) | lockstep, sleep safety |
| Anaphylaxis in babies: recognising a severe allergic reaction and what to do | [anaphylaxis-babies](https://little-cubby.com/articles/anaphylaxis-babies/) | allergy |
| Baby blues: what they are and how they differ from postnatal depression | [baby-blues-explained](https://little-cubby.com/articles/baby-blues-explained/) | perinatal mental health |
| Baby breathing: what is normal, and when to be concerned | [baby-breathing-normal](https://little-cubby.com/articles/baby-breathing-normal/) | lockstep, breathing |
| Baby choking: what to do and how to be ready | [baby-choking-first-aid](https://little-cubby.com/articles/baby-choking-first-aid/) | choking |
| Baby fever: when to worry and when to wait | [baby-fever-when-to-worry](https://little-cubby.com/articles/baby-fever-when-to-worry/) | fever |
| Baby gagging vs choking: what is normal and what is an emergency | [baby-gagging-vs-choking](https://little-cubby.com/articles/baby-gagging-vs-choking/) | emergency, choking |
| Medicines to keep at home for babies: what you need and when to use it | [baby-medication-guide](https://little-cubby.com/articles/baby-medication-guide/) | lockstep, medicine |
| Baby sick at home: a calm guide to the day and when to call for help | [baby-sick-at-home](https://little-cubby.com/articles/baby-sick-at-home/) | emergency |
| Wheezing in babies: causes, what it sounds like and when to act | [baby-wheezing](https://little-cubby.com/articles/baby-wheezing/) | breathing |
| Bronchiolitis: the chest infection in babies that needs watching closely | [bronchiolitis-babies](https://little-cubby.com/articles/bronchiolitis-babies/) | breathing |
| Chickenpox in babies: spots, stages and when to call the doctor | [chickenpox-babies](https://little-cubby.com/articles/chickenpox-babies/) | emergency |
| Family bed sharing: what the evidence says | [chinese-family-co-sleeping](https://little-cubby.com/articles/chinese-family-co-sleeping/) | sleep safety |
| Co-sleeping: risks, benefits and safer alternatives | [co-sleeping-evidence](https://little-cubby.com/articles/co-sleeping-evidence/) | sleep safety |
| Co-sleeping in families: safety, tradition and evidence | [co-sleeping-indian-families](https://little-cubby.com/articles/co-sleeping-indian-families/) | sleep safety |
| Co-sleeping: traditions, safety and what the evidence says | [co-sleeping-italy](https://little-cubby.com/articles/co-sleeping-italy/) | sleep safety |
| Croup: the barking cough that wakes babies at night | [croup-in-babies](https://little-cubby.com/articles/croup-in-babies/) | breathing |
| Logging medicines in Cubby: doses, times and what the doctor needs to know | [cubby-medicine-log](https://little-cubby.com/articles/cubby-medicine-log/) | lockstep, medicine |
| Tracking your baby's temperature in Cubby: the fever log doctors actually want to see | [cubby-temperature-tracker](https://little-cubby.com/articles/cubby-temperature-tracker/) | lockstep, fever |
| When to seek urgent care in the UAE: numbers and danger signs | [emergency-numbers-uae](https://little-cubby.com/articles/emergency-numbers-uae/) | lockstep, emergency |
| Febrile seizures: what they look like, what to do, and why most babies recover fully | [febrile-seizures-babies](https://little-cubby.com/articles/febrile-seizures-babies/) | lockstep, fever, seizure |
| Fever in babies under 3 months: why it is always urgent | [fever-newborn-under-3-months](https://little-cubby.com/articles/fever-newborn-under-3-months/) | fever |
| Folic acid in pregnancy and before: the right dose and when to start | [folic-acid-dosage-preconception](https://little-cubby.com/articles/folic-acid-dosage-preconception/) | medicine |
| Introducing allergenic foods early: what the evidence says | [food-allergies-early-introduction](https://little-cubby.com/articles/food-allergies-early-introduction/) | allergy |
| Food allergy signs in babies: how to recognise a reaction | [food-allergy-signs-babies](https://little-cubby.com/articles/food-allergy-signs-babies/) | allergy |
| Head injury in babies: when to go straight to hospital | [head-injury-babies](https://little-cubby.com/articles/head-injury-babies/) | lockstep, head injury |
| Hives and allergic rash in babies: causes and what to do | [hives-allergic-rash-babies](https://little-cubby.com/articles/hives-allergic-rash-babies/) | allergy |
| Infant CPR: why to learn it and how to find a class | [infant-cpr-where-to-learn](https://little-cubby.com/articles/infant-cpr-where-to-learn/) | choking |
| Infantile spasms: the seizure type every parent should know about | [infantile-spasms](https://little-cubby.com/articles/infantile-spasms/) | seizure |
| Introducing Allergen Foods to Babies | [introducing-allergen-foods-to-babies](https://little-cubby.com/articles/introducing-allergen-foods-to-babies/) | allergy |
| Introducing allergenic foods early: the ASCIA approach | [introducing-allergens-ascia](https://little-cubby.com/articles/introducing-allergens-ascia/) | allergy |
| Introducing allergenic foods: the European approach | [introducing-allergens-espghan](https://little-cubby.com/articles/introducing-allergens-espghan/) | allergy |
| Iron in pregnancy: foods, supplements and preventing deficiency | [iron-pregnancy](https://little-cubby.com/articles/iron-pregnancy/) | pregnancy medicine |
| Is this normal? Common newborn things that worry first-time parents | [is-this-normal-newborn](https://little-cubby.com/articles/is-this-normal-newborn/) | lockstep |
| Lochia: what postpartum bleeding is normal and when to call your midwife | [lochia-postpartum-bleeding](https://little-cubby.com/articles/lochia-postpartum-bleeding/) | emergency |
| Meningitis warning signs in babies: the glass test and when to call 999 | [meningitis-warning-signs](https://little-cubby.com/articles/meningitis-warning-signs/) | emergency |
| Cow's milk protein allergy in babies: signs, symptoms and what helps | [milk-protein-allergy](https://little-cubby.com/articles/milk-protein-allergy/) | allergy |
| Postnatal depression support: resources and when to seek help | [panda-postnatal-depression](https://little-cubby.com/articles/panda-postnatal-depression/) | perinatal mental health |
| Paracetamol and ibuprofen for babies: doses, timing and what is safe | [paracetamol-ibuprofen-babies](https://little-cubby.com/articles/paracetamol-ibuprofen-babies/) | medicine |
| Partner and paternal postnatal depression: what it looks like | [partner-postnatal-depression](https://little-cubby.com/articles/partner-postnatal-depression/) | perinatal mental health |
| Paternal postnatal depression: how it affects fathers and how to get help | [paternal-mental-health-postnatal](https://little-cubby.com/articles/paternal-mental-health-postnatal/) | perinatal mental health |
| Perinatal mental health: the full picture from pregnancy to the first year | [perinatal-mental-health-overview](https://little-cubby.com/articles/perinatal-mental-health-overview/) | perinatal mental health |
| Postnatal anxiety: signs, symptoms and where to get help | [postnatal-anxiety](https://little-cubby.com/articles/postnatal-anxiety/) | perinatal mental health |
| Postnatal depression: recognising it and getting help | [postnatal-depression-beyond-blue](https://little-cubby.com/articles/postnatal-depression-beyond-blue/) | perinatal mental health |
| Postnatal depression: signs, symptoms and where to get help | [postnatal-depression-signs-and-support](https://little-cubby.com/articles/postnatal-depression-signs-and-support/) | perinatal mental health |
| Postnatal psychosis: signs to recognise and why it is a medical emergency | [postnatal-psychosis-signs-and-emergency-response](https://little-cubby.com/articles/postnatal-psychosis-signs-and-emergency-response/) | lockstep, emergency, perinatal mental health |
| Postnatal depression: recognising the signs and finding support | [postpartum-depression-germany](https://little-cubby.com/articles/postpartum-depression-germany/) | perinatal mental health |
| Postnatal depression: recognising the signs and finding support | [postpartum-depression-italy](https://little-cubby.com/articles/postpartum-depression-italy/) | perinatal mental health |
| Postnatal depression: recognising the signs and finding support | [postpartum-depression-japan](https://little-cubby.com/articles/postpartum-depression-japan/) | lockstep, perinatal mental health |
| Postnatal depression: screening, symptoms and getting support | [postpartum-depression-ppd-screening](https://little-cubby.com/articles/postpartum-depression-ppd-screening/) | perinatal mental health |
| Postpartum rage: when anger is part of how postnatal depression feels | [postpartum-rage](https://little-cubby.com/articles/postpartum-rage/) | perinatal mental health |
| Pre-eclampsia: signs to recognise and when to call | [pre-eclampsia](https://little-cubby.com/articles/pre-eclampsia/) | emergency |
| Mental health in pregnancy: anxiety, depression and getting help | [pregnancy-mental-health](https://little-cubby.com/articles/pregnancy-mental-health/) | perinatal mental health |
| Roseola: the fever-then-rash illness in babies and toddlers | [roseola-babies](https://little-cubby.com/articles/roseola-babies/) | fever |
| RSV and bronchiolitis in babies: what parents need to know | [rsv-in-babies](https://little-cubby.com/articles/rsv-in-babies/) | breathing |
| Safe Baby Sleep: Reducing the Risk of SIDS | [safe-baby-sleep](https://little-cubby.com/articles/safe-baby-sleep/) | sleep safety |
| Medicines in pregnancy: what is safe, what to avoid and when to ask | [safe-medicines-in-pregnancy](https://little-cubby.com/articles/safe-medicines-in-pregnancy/) | medicine, pregnancy medicine |
| Safe sleep for babies: the evidence-based guidance | [safe-sleep-italy-iss](https://little-cubby.com/articles/safe-sleep-italy-iss/) | lockstep, sleep safety |
| Scarlet fever in babies and toddlers: what it looks like and what to do | [scarlet-fever-babies](https://little-cubby.com/articles/scarlet-fever-babies/) | fever |
| Safe sleep: the Red Nose guidelines | [sids-red-nose-australia](https://little-cubby.com/articles/sids-red-nose-australia/) | lockstep, sleep safety |
| Therapy options for postnatal mental health: what is available and how to access it | [therapy-and-counselling-postnatal](https://little-cubby.com/articles/therapy-and-counselling-postnatal/) | perinatal mental health |
| When to call 111 or go to A&E: danger signs in babies | [when-to-call-111-or-ae](https://little-cubby.com/articles/when-to-call-111-or-ae/) | emergency |
| When to call an ambulance for your baby: signs that cannot wait | [when-to-call-ambulance-baby](https://little-cubby.com/articles/when-to-call-ambulance-baby/) | lockstep, emergency |
