/* Cubby pregnancy data (informational, not medical advice).
   Week-by-week development, antenatal appointment schedules by country, and danger signs.
   Sources are cited per section; see PREGNANCY.md. Week content is general guidance with
   common "size of" comparisons; antenatal schedules summarise official guidance and are editable. */
window.PREG = (function () {
  function tri(w) { return w <= 13 ? 1 : (w <= 27 ? 2 : 3); }

  // week: [size, baby development, what mum may feel]   (weeks 4-41)
  var W = {
    4: ['poppy seed', 'The embryo implants and the placenta begins to form.', 'A missed period; maybe tender breasts or tiredness.'],
    5: ['sesame seed', 'The neural tube (brain and spine) starts to form.', 'Early nausea, fatigue, frequent loo trips.'],
    6: ['lentil', 'The tiny heart begins to beat.', 'Morning sickness and strong smells may start.'],
    7: ['blueberry', 'Arm and leg buds appear; the brain grows fast.', 'Nausea, food aversions, mood swings.'],
    8: ['raspberry', 'Fingers and toes start to form.', 'Bloating, tender breasts, tiredness.'],
    9: ['cherry', 'Essential organs are developing; tiny movements begin.', 'Nausea may peak; emotions run high.'],
    10: ['kumquat', 'Vital organs are formed and starting to work.', 'Possible booking bloods and first checks.'],
    11: ['fig', 'Tooth buds and nail beds form; baby can stretch.', 'Nausea may ease for some; more energy soon.'],
    12: ['lime', 'Reflexes develop; the dating scan is around now.', 'Bump may start to show; nausea easing.'],
    13: ['pea pod', 'Vocal cords and fingerprints form. End of first trimester.', 'Often a calmer, brighter stretch begins.'],
    14: ['lemon', 'Baby can squint, frown and grasp.', 'More energy; appetite returning.'],
    15: ['apple', 'Baby senses light; bones are hardening.', 'Possibly a "glow"; round-ligament twinges.'],
    16: ['avocado', 'Tiny muscles let baby make expressions.', 'Some feel first flutters; antenatal check.'],
    17: ['pomegranate', 'Fat stores begin; the skeleton firms up.', 'Bigger appetite, maybe backache.'],
    18: ['bell pepper', 'Ears are in position; baby hears sounds.', 'Flutters become clearer.'],
    19: ['mango', 'Vernix (protective coating) covers the skin.', 'Round-ligament aches, leg cramps.'],
    20: ['banana', 'Halfway. The anomaly scan is around now.', 'Movements clearer; bump is showing.'],
    21: ['carrot', 'Baby swallows and practises digestion.', 'Stronger kicks, possible heartburn.'],
    22: ['papaya', 'Senses sharpen; baby looks more newborn.', 'Skin changes, maybe stretch marks.'],
    23: ['grapefruit', 'Lungs prepare to breathe air.', 'Swelling in feet/ankles may begin.'],
    24: ['corn cob', 'Baby reaches viability milestones; taste buds form.', 'Glucose test window opens (24-28w).'],
    25: ['cauliflower', 'Baby responds to your voice.', 'Antenatal check; possible backache.'],
    26: ['lettuce', 'Eyes begin to open.', 'Braxton Hicks (practice tightenings) may start.'],
    27: ['cabbage', 'Brain activity increases. End of second trimester.', 'Shortness of breath, trouble sleeping.'],
    28: ['aubergine', 'Baby blinks and has sleep cycles.', 'Bloods/anti-D if needed; count movements.'],
    29: ['butternut squash', 'Muscles and lungs keep maturing.', 'Heartburn, leg cramps, tiredness.'],
    30: ['large carrot', 'Baby can regulate its own temperature better.', 'Backache and waddling are common.'],
    31: ['coconut', 'Baby puts on weight quickly now.', 'Antenatal check; more frequent loo trips.'],
    32: ['squash', 'Baby often moves head-down.', 'Braxton Hicks more noticeable.'],
    33: ['pineapple', 'Bones harden (skull stays soft for birth).', 'Less room means stronger, lower kicks.'],
    34: ['cantaloupe', 'Central nervous system matures.', 'Swelling, fatigue; pack hospital bag soon.'],
    35: ['honeydew melon', 'Kidneys are fully developed.', 'Pelvic pressure; frequent urination.'],
    36: ['romaine lettuce', 'Baby is gaining about 30g a day.', 'Position checked; baby may "drop".'],
    37: ['chard', 'Considered early term; lungs nearly ready.', 'Nesting urge; watch for labour signs.'],
    38: ['leek', 'Firm grasp; organs ready for the outside.', 'Cervix may begin to change.'],
    39: ['small watermelon', 'Full term. Baby keeps adding fat.', 'Any-day-now feeling; rest when you can.'],
    40: ['pumpkin', 'Your due date. Babies arrive on their own schedule.', 'Discuss options if baby is comfy in there.'],
    41: ['pumpkin', 'Most babies come within a week of the due date.', 'Membrane sweep or induction may be offered.']
  };
  var weeks = {};
  Object.keys(W).forEach(function (k) { var w = +k; weeks[w] = { week: w, trimester: tri(w), size: W[k][0], baby: W[k][1], mum: W[k][2] }; });

  // Friendly emoji for each "size of a..." comparison (presentational; falls back to a sprout).
  var SIZE_EMOJI = {
    'poppy seed': '⚫', 'sesame seed': '⚪', 'lentil': '🫘', 'blueberry': '🫐',
    'raspberry': '🍓', 'cherry': '🍒', 'kumquat': '🟠', 'fig': '🟣',
    'lime': '🟢', 'pea pod': '🫛', 'lemon': '🍋', 'apple': '🍎',
    'avocado': '🥑', 'pomegranate': '🔴', 'bell pepper': '🫑', 'mango': '🥭',
    'banana': '🍌', 'carrot': '🥕', 'papaya': '🥭', 'grapefruit': '🍊',
    'corn cob': '🌽', 'cauliflower': '🥦', 'lettuce': '🥬', 'cabbage': '🥬',
    'aubergine': '🍆', 'butternut squash': '🎃', 'large carrot': '🥕', 'coconut': '🥥',
    'squash': '🎃', 'pineapple': '🍍', 'cantaloupe': '🍈', 'honeydew melon': '🍈',
    'romaine lettuce': '🥬', 'chard': '🥬', 'leek': '🥬', 'small watermelon': '🍉',
    'pumpkin': '🎃'
  };
  function sizeEmoji(s) { return SIZE_EMOJI[(s || '').toLowerCase()] || '🌱'; }

  // Antenatal appointment schedules. item: {week, title, note}
  var antenatal = {
    uk: {
      label: 'United Kingdom (NHS)',
      source: 'https://www.nhs.uk/pregnancy/your-pregnancy-care/your-antenatal-appointments/',
      items: [
        { week: 10, title: 'Booking appointment', note: 'History, blood pressure, urine, booking bloods and blood group. (8-12 weeks)' },
        { week: 12, title: 'Dating scan + screening', note: 'Ultrasound to date the pregnancy; combined screening offered. (11-14 weeks)' },
        { week: 16, title: 'Antenatal check', note: 'Blood pressure, urine; review screening results.' },
        { week: 20, title: '20-week (anomaly) scan', note: 'Detailed scan of baby’s development. (18-21 weeks)' },
        { week: 20, title: 'Whooping cough vaccine', note: 'Offered to protect baby (from 16 weeks).' },
        { week: 25, title: 'Antenatal check', note: 'First pregnancy: BP, urine, bump, movements, mood.' },
        { week: 28, title: 'Bloods + anti-D', note: 'Iron and blood group; anti-D if Rh-negative; glucose test if at risk (24-28w).' },
        { week: 31, title: 'Antenatal check', note: 'First pregnancy: BP, urine, bump.' },
        { week: 34, title: 'Antenatal check', note: 'BP, urine, bump; second anti-D if needed.' },
        { week: 36, title: 'Position check', note: 'Check baby’s position; feeding and birth discussion.' },
        { week: 38, title: 'Antenatal check', note: 'BP, urine, bump; discuss going past 40 weeks.' },
        { week: 40, title: 'Antenatal check', note: 'First pregnancy: BP, urine, bump.' },
        { week: 41, title: 'Check + membrane sweep', note: 'Membrane sweep offered; discuss induction.' }
      ]
    },
    us: {
      label: 'United States (ACOG)',
      source: 'https://www.acog.org/womens-health/faqs/prenatal-care',
      note: 'Typical visit cadence: every 4 weeks until 28 weeks, every 2 weeks until 36 weeks, then weekly until birth.',
      items: [
        { week: 9, title: 'First prenatal visit', note: 'History, exam and first-trimester labs. (8-10 weeks)' },
        { week: 12, title: 'Dating / NT scan', note: 'Dating ultrasound; cell-free DNA / NT screening offered. (11-13 weeks)' },
        { week: 20, title: 'Anatomy scan', note: 'Detailed ultrasound of baby’s anatomy. (18-22 weeks)' },
        { week: 26, title: 'Glucose screening', note: 'Gestational diabetes test. (24-28 weeks)' },
        { week: 28, title: 'Visits every 2 weeks', note: 'Anti-D (RhoGAM) if Rh-negative; movement counting.' },
        { week: 30, title: 'Tdap vaccine', note: 'Whooping cough vaccine. (27-36 weeks)' },
        { week: 36, title: 'Group B strep (GBS)', note: 'Swab for GBS; visits become weekly. (36-37 weeks)' },
        { week: 39, title: 'Weekly checks', note: 'Position, BP, urine; discuss labour and birth plan.' }
      ]
    },
    de: {
      label: 'Deutschland (Mutterschaftsrichtlinien)',
      source: 'https://www.g-ba.de/themen/methodenbewertung/ambulant/mutterschaftsrichtlinien/',
      note: 'Vorsorge alle 4 Wochen bis ca. 32. SSW, danach alle 2 Wochen. Drei Ultraschall-Screenings. Mit Frauenarzt/Hebamme bestaetigen.',
      items: [
        { week: 9, title: 'Erstuntersuchung', note: 'Mutterpass, Blutwerte, Blutdruck, Urin. (bis ~10. SSW)' },
        { week: 11, title: '1. Ultraschall', note: 'Datierung und Entwicklung. (9.-12. SSW)' },
        { week: 20, title: '2. Ultraschall', note: 'Organscreening. (19.-22. SSW)' },
        { week: 26, title: 'Zuckertest (oGTT)', note: 'Schwangerschaftsdiabetes-Test. (24.-28. SSW)' },
        { week: 30, title: '3. Ultraschall', note: 'Wachstumskontrolle. (29.-32. SSW)' },
        { week: 32, title: 'Vorsorge alle 2 Wochen', note: 'Blutdruck, Urin, Gewicht, Lage.' },
        { week: 36, title: 'Spaete Vorsorge', note: 'Lage des Babys, Geburtsplanung.' }
      ]
    },
    uae: {
      label: 'United Arab Emirates (DHA / DoH)',
      source: 'https://dha.gov.ae/uploads/052024/Standards%20for%20Obstetric%20and%20Neonatal%20Services2024515150.pdf',
      note: 'Based on DHA Dubai and DoH Abu Dhabi standards (a first, uncomplicated pregnancy is about 10 visits). Exact scans and care vary by emirate and clinic, and most care is private. Confirm your plan with your provider.',
      items: [
        { week: 8, title: 'Booking visit + dating scan', note: 'Registration, history, baseline bloods and blood group; early dating scan to confirm viability and dates. (6-10 weeks)' },
        { week: 12, title: 'NT scan + screening', note: 'Nuchal translucency scan and first-trimester screening. (11-13 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review results.' },
        { week: 20, title: 'Anomaly scan', note: 'Detailed scan of baby’s development. (18-20 weeks)' },
        { week: 26, title: 'Glucose test (OGTT)', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 28, title: 'Visit + anti-D', note: 'Bloods; anti-D if Rh-negative; whooping cough (Tdap) vaccine offered, per clinic.' },
        { week: 32, title: 'Growth check', note: 'Blood pressure, urine, growth and position.' },
        { week: 36, title: 'GBS swab + position', note: 'Group B strep swab (35-37 weeks); check baby’s position; birth planning.' },
        { week: 38, title: 'Late checks', note: 'Blood pressure, position; visits more frequent near term.' },
        { week: 40, title: 'Due-date check', note: 'Discuss going past your due date.' }
      ]
    },
    ca: {
      label: 'Canada (SOGC-aligned)',
      source: 'https://www.pregnancyinfo.ca/',
      note: 'Care varies by province and provider (family doctor, OB or midwife). Typically every 4-6 weeks to ~30 weeks, every 2-3 weeks to 36 weeks, then weekly. Confirm your plan locally.',
      items: [
        { week: 8, title: 'First prenatal visit', note: 'History, blood pressure, urine, prenatal bloods and blood group. (8-12 weeks)' },
        { week: 12, title: 'Dating + NT scan', note: 'First-trimester screening and a dating ultrasound. (11-14 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review screening results.' },
        { week: 20, title: 'Anatomy ultrasound', note: 'Detailed scan of baby’s anatomy. (18-22 weeks)' },
        { week: 26, title: 'Glucose challenge test', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 28, title: 'Visit + anti-D + Tdap', note: 'Rh immune globulin if Rh-negative; whooping cough (Tdap) vaccine from ~27 weeks.' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, blood pressure and position.' },
        { week: 36, title: 'Group B strep (GBS) swab', note: 'GBS screening; visits become more frequent. (35-37 weeks)' },
        { week: 38, title: 'Antenatal visit', note: 'Position, blood pressure and birth planning.' },
        { week: 40, title: 'Due-date check', note: 'Discuss options if baby arrives later than expected.' }
      ]
    },
    au: {
      label: 'Australia (Pregnancy Care Guidelines)',
      source: 'https://www.health.gov.au/resources/pregnancy-care-guidelines/part-b-core-practices-in-pregnancy-care/antenatal-visits',
      note: 'About 10 visits for a first pregnancy, ~7 if you have been pregnant before. First visit by 10 weeks; every 4-6 weeks, more often from ~28 weeks.',
      items: [
        { week: 8, title: 'First (booking) visit', note: 'History, blood pressure, urine, booking bloods and blood group. (by 10 weeks)' },
        { week: 12, title: 'Dating scan + screening', note: 'Ultrasound to date the pregnancy; first-trimester combined screening offered. (11-13 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review screening results.' },
        { week: 20, title: 'Morphology (anomaly) scan', note: 'Detailed scan of baby’s development. (18-22 weeks)' },
        { week: 26, title: 'Glucose test (OGTT)', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 28, title: 'Visit + anti-D + whooping cough', note: 'Bloods; anti-D if Rh-negative; whooping cough (pertussis) vaccine, recommended 20-32 weeks.' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, blood pressure and urine.' },
        { week: 34, title: 'Antenatal visit', note: 'Second anti-D if Rh-negative; position.' },
        { week: 36, title: 'Antenatal visit', note: 'Check baby’s position; birth planning.' },
        { week: 38, title: 'Antenatal visit', note: 'Blood pressure, urine and growth.' },
        { week: 40, title: 'Antenatal visit', note: 'Discuss going past 40 weeks.' }
      ]
    },
    nz: {
      label: 'New Zealand (LMC / Ministry of Health)',
      source: 'https://www.health.govt.nz/your-health/pregnancy-and-kids',
      note: 'Midwife-led (Lead Maternity Carer). Booking by ~10 weeks, then about every 4 weeks to 28 weeks, every 2-3 weeks to 36 weeks, then weekly to birth.',
      items: [
        { week: 10, title: 'Register with your LMC (midwife)', note: 'History, blood pressure, urine, booking bloods and blood group; supplements. (by 10 weeks)' },
        { week: 12, title: 'Dating + screening scan', note: 'Ultrasound to date the pregnancy; first-trimester screening offered. (11-14 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review results.' },
        { week: 20, title: 'Anatomy scan', note: 'Detailed scan of baby’s development. (18-21 weeks)' },
        { week: 26, title: 'Glucose screening', note: 'Gestational diabetes test. (24-28 weeks)' },
        { week: 28, title: 'Visit + anti-D + whooping cough', note: 'Anti-D if Rh-negative; whooping cough (pertussis) vaccine, free from ~16 weeks.' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, blood pressure and position.' },
        { week: 36, title: 'Antenatal visit', note: 'Position; birth plan; group B strep discussion.' },
        { week: 38, title: 'Weekly checks begin', note: 'Blood pressure, urine and position.' },
        { week: 40, title: 'Due-date check', note: 'Discuss options if baby arrives later than expected.' }
      ]
    },
    ie: {
      label: 'Ireland (HSE Maternity & Infant Care)',
      source: 'https://www2.hse.ie/pregnancy-birth/pregnancy-care/care-appointments/',
      note: 'Combined Care: your GP and the maternity hospital share your care, free under the Maternity and Infant Care Scheme. GP first visit before 12 weeks plus about 5 more, alternating with hospital visits.',
      items: [
        { week: 10, title: 'GP first visit', note: 'History, blood pressure, urine and bloods; register for the Maternity and Infant Care Scheme. (before 12 weeks)' },
        { week: 12, title: 'Hospital booking + dating scan', note: 'History, bloods and blood group; dating scan offered. (8-12 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review screening results.' },
        { week: 20, title: 'Anomaly scan (hospital)', note: 'Detailed fetal anatomy scan. (20-22 weeks)' },
        { week: 24, title: 'Antenatal visit', note: 'Blood pressure, urine and growth.' },
        { week: 28, title: 'Visit + anti-D', note: 'Anti-D if Rh-negative; whooping cough vaccine offered (16-36 weeks); glucose test if indicated.' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, blood pressure and position.' },
        { week: 36, title: 'Antenatal visit', note: 'Position; birth planning.' },
        { week: 38, title: 'Antenatal visit', note: 'Blood pressure, urine and growth.' },
        { week: 40, title: 'Late check', note: 'Discuss going past your due date.' }
      ]
    },
    in: {
      label: 'India (MoHFW)',
      source: 'https://pmsma.mohfw.gov.in/',
      note: 'MoHFW recommends at least 4 antenatal visits (more if advised); free specialist ANC on the 9th of each month under PMSMA in the 2nd and 3rd trimester. Confirm your plan with your provider.',
      items: [
        { week: 8, title: '1st ANC + registration', note: 'Register early (within 12 weeks); history, blood pressure, urine, bloods and blood group; iron and folic acid; first Td (tetanus) dose.' },
        { week: 12, title: 'Dating / NT scan', note: 'Ultrasound to date the pregnancy; first-trimester screening offered. (11-14 weeks)' },
        { week: 16, title: 'Td (tetanus) 2nd dose', note: 'Second Td at least 4 weeks after the first; continue iron, folic acid and calcium.' },
        { week: 20, title: '2nd ANC + anomaly scan', note: 'Detailed scan; blood pressure, urine, weight. (18-22 weeks)' },
        { week: 26, title: 'Glucose test (DIPSI)', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 30, title: '3rd ANC (PMSMA specialist)', note: 'Blood pressure, urine, growth and fetal heart. (28-34 weeks)' },
        { week: 36, title: '4th ANC', note: 'Position, growth, birth and transport plan. (36 weeks to term)' }
      ]
    },
    fr: {
      label: 'France (Assurance Maladie)',
      source: 'https://www.ameli.fr/assure/sante/devenir-parent/grossesse',
      note: '7 mandatory prenatal consultations (one before the end of month 3, then monthly from the 4th to 9th month), 3 ultrasounds and an early prenatal interview (EPP). Covered 100%.',
      items: [
        { week: 10, title: '1st consultation + declaration', note: 'Before the end of the 3rd month; history, bloods, pregnancy declaration; early prenatal interview (EPP) offered.' },
        { week: 12, title: '1st ultrasound (dating + nuchal)', note: 'Dating and nuchal translucency. (11-13 weeks)' },
        { week: 16, title: '2nd consultation', note: 'Blood pressure, urine, growth.' },
        { week: 22, title: '2nd ultrasound (morphology)', note: 'Detailed anatomy scan. (around 22 weeks)' },
        { week: 25, title: '3rd consultation + glucose test', note: 'Blood pressure, urine; OGTT 24-28 weeks if indicated.' },
        { week: 29, title: '4th consultation', note: 'Anti-D if Rh-negative; whooping cough (coqueluche) vaccine recommended (20-36 weeks).' },
        { week: 32, title: '3rd ultrasound (growth) + 5th consultation', note: 'Growth and position. (around 32 weeks)' },
        { week: 36, title: '6th consultation + anaesthesia consult', note: 'Position; birth planning; anaesthesia consultation.' },
        { week: 39, title: '7th consultation', note: 'Final checks; discuss labour.' }
      ]
    },
    it: {
      label: 'Italy (Agenda della Gravidanza / SSN)',
      source: 'https://www.iss.it/en/-/gravidanzafisiologicalg',
      note: 'Free exams under the SSN per the Agenda della Gravidanza. Obstetric visit by week 10; visit, blood and urine roughly monthly. Two ultrasounds covered (1st and 2nd trimester).',
      items: [
        { week: 9, title: 'First obstetric visit', note: 'History, blood pressure, urine, booking bloods and blood group. (by week 10)' },
        { week: 12, title: 'First-trimester scan + screening', note: 'Dating; combined/NT screening offered. (11-13 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; review results.' },
        { week: 20, title: 'Morphology scan', note: 'Detailed anatomy scan. (19-21 weeks)' },
        { week: 26, title: 'Glucose test (OGTT)', note: 'Gestational diabetes screening if indicated. (24-28 weeks)' },
        { week: 28, title: 'Antenatal visit', note: 'Blood pressure, urine; anti-D if Rh-negative; whooping cough vaccine (27-36 weeks).' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, position (third-trimester scan only if indicated).' },
        { week: 36, title: 'Antenatal visit + GBS swab', note: 'Vaginal and rectal swab (36-37 weeks); birth planning.' },
        { week: 40, title: 'Late check', note: 'Discuss going past your due date.' }
      ]
    },
    es: {
      label: 'Spain (SEGO / Seguridad Social)',
      source: 'https://www.sego.es/',
      note: 'Public care shared between the midwife (matrona) and obstetrician; visits about every 4-6 weeks; three ultrasounds (12, 20, 32-34 weeks). Varies by autonomous community.',
      items: [
        { week: 9, title: 'First visit with matrona', note: 'History, blood pressure, urine, booking bloods and blood group. (before 12 weeks)' },
        { week: 12, title: 'First-trimester scan + screening', note: 'Dating; Down syndrome risk screening. (11-14 weeks)' },
        { week: 16, title: 'Antenatal visit (matrona)', note: 'Blood pressure, urine; review results.' },
        { week: 20, title: 'Morphology scan', note: 'Detailed anatomy scan. (18-22 weeks)' },
        { week: 26, title: 'Glucose test (O’Sullivan)', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 28, title: 'Antenatal visit', note: 'Anti-D if Rh-negative; whooping cough vaccine (27-36 weeks).' },
        { week: 33, title: 'Third-trimester scan', note: 'Growth and wellbeing. (32-34 weeks)' },
        { week: 36, title: 'Antenatal visit + GBS swab', note: 'Group B strep (35-37 weeks); position; birth plan.' },
        { week: 40, title: 'Late check', note: 'Discuss going past your due date.' }
      ]
    },
    nl: {
      label: 'Netherlands (Verloskundige / KNOV)',
      source: 'https://www.knov.nl/',
      note: 'Midwife-led (verloskundige). Register by ~8-10 weeks; visits about every 4 weeks, then every 2 weeks, then weekly near term. Two scans for a low-risk pregnancy (dating 10-12, anomaly 20).',
      items: [
        { week: 8, title: 'First appointment with midwife', note: 'History, blood pressure, booking bloods and blood group. (7-9 weeks)' },
        { week: 11, title: 'Dating scan', note: 'Confirms due date; NIPT or combined screening offered. (10-12 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine; how you are feeling.' },
        { week: 20, title: '20-week anomaly scan (SEO)', note: 'Detailed anatomy scan.' },
        { week: 22, title: 'Whooping cough vaccine (22-wekenprik)', note: 'Maternal pertussis vaccine offered from about 22 weeks.' },
        { week: 27, title: 'Antenatal visit', note: 'Growth, blood pressure; glucose test if indicated.' },
        { week: 30, title: 'Antenatal visit + anti-D', note: 'Anti-D if Rh-negative (around 30 weeks); growth, position.' },
        { week: 34, title: 'Antenatal visit', note: 'Position; birth plan (home or hospital).' },
        { week: 36, title: 'Antenatal visit', note: 'More frequent checks begin.' },
        { week: 40, title: 'Due-date check', note: 'Discuss going overdue.' }
      ]
    },
    jp: {
      label: 'Japan (Maternal & Child Health Handbook)',
      source: 'https://www.mhlw.go.jp/english/',
      note: 'After your pregnancy is confirmed you receive the Maternal and Child Health Handbook (boshi techo) and about 14 subsidised checkups: roughly every 4 weeks to week 23, every 2 weeks to week 35, then weekly to birth.',
      items: [
        { week: 8, title: 'First checkup + register boshi techo', note: 'History, blood pressure, urine, bloods and blood group. (8-11 weeks)' },
        { week: 12, title: 'Dating / early scan + screening', note: 'Date the pregnancy; screening offered. (11-13 weeks)' },
        { week: 16, title: 'Antenatal checkup', note: 'Blood pressure, urine, weight (every 4 weeks).' },
        { week: 20, title: 'Anatomy scan', note: 'Detailed scan of baby’s development.' },
        { week: 26, title: 'Glucose screening', note: 'Gestational diabetes test. (24-28 weeks)' },
        { week: 28, title: 'Checkups every 2 weeks begin', note: 'Blood pressure, urine, growth.' },
        { week: 32, title: 'Antenatal checkup', note: 'Growth, position.' },
        { week: 36, title: 'GBS swab + weekly checkups begin', note: 'Position; birth planning. (33-37 weeks)' },
        { week: 40, title: 'Due-date checkup', note: 'Discuss going overdue.' }
      ]
    },
    kr: {
      label: 'South Korea (NHIS)',
      source: 'https://www.nhis.or.kr/english/index.do',
      note: 'Universal cover via NHIS, with a Happiness Card toward prenatal costs. Standard schedule: about every 4 weeks to 28 weeks, every 2 weeks to 36 weeks, then weekly to birth.',
      items: [
        { week: 8, title: 'First prenatal visit + register', note: 'History, blood pressure, urine, bloods and blood group. (8-10 weeks)' },
        { week: 12, title: 'Dating + first-trimester screening', note: 'Date the pregnancy; chromosomal screening offered. (11-13 weeks)' },
        { week: 16, title: 'Antenatal visit', note: 'Blood pressure, urine.' },
        { week: 20, title: 'Anatomy scan', note: 'Detailed scan of baby’s development. (18-22 weeks)' },
        { week: 26, title: 'Glucose tolerance test', note: 'Gestational diabetes screening. (24-28 weeks)' },
        { week: 28, title: 'Visits every 2 weeks begin', note: 'Blood pressure, urine; anti-D if Rh-negative.' },
        { week: 32, title: 'Antenatal visit', note: 'Growth, position.' },
        { week: 36, title: 'Group B strep test + weekly visits begin', note: 'Position; birth planning. (35-37 weeks)' },
        { week: 40, title: 'Due-date check', note: 'Discuss going overdue.' }
      ]
    },
    generic: {
      label: 'General (WHO-aligned)',
      source: 'https://www.who.int/publications/i/item/9789241549912',
      note: 'A sensible default of antenatal contacts. Always follow your own provider’s plan; edit to match.',
      items: [
        { week: 12, title: 'Booking + dating scan', note: 'First visit, baseline checks and a dating ultrasound.' },
        { week: 20, title: 'Anomaly scan', note: 'Detailed mid-pregnancy ultrasound.' },
        { week: 26, title: 'Glucose screening', note: 'Gestational diabetes test (24-28 weeks).' },
        { week: 30, title: 'Antenatal check', note: 'Blood pressure, urine, growth and movements.' },
        { week: 34, title: 'Antenatal check', note: 'Growth, position and birth planning.' },
        { week: 36, title: 'Group B strep / position', note: 'GBS where offered; check baby’s position.' },
        { week: 38, title: 'Late checks', note: 'More frequent checks as you approach birth.' },
        { week: 40, title: 'Due date check', note: 'Discuss options if baby arrives later than expected.' }
      ]
    },
    custom: {
      label: 'Your own plan',
      source: '',
      note: 'Build your own visit list, the way your provider has set it out. Add each appointment as you go.',
      items: []
    }
  };

  // Urgent warning signs (CDC HEAR HER). Informational; "seek care" not "diagnose".
  var dangerSigns = {
    source: 'https://www.cdc.gov/hearher/maternal-warning-signs/',
    note: 'Call your midwife, doctor or emergency number straight away if you notice any of these. Trust your instincts.',
    items: [
      'A headache that won’t go away or gets worse',
      'Dizziness or fainting',
      'Changes in vision (flashing lights, blurring, blind spots)',
      'Fever of 38°C / 100.4°F or higher',
      'Extreme swelling of your hands or face',
      'Trouble breathing or chest pain / a racing heart',
      'Severe belly pain that doesn’t go away',
      'Your baby’s movements stopping or slowing down',
      'Vaginal bleeding or fluid leaking',
      'Severe swelling, redness or pain in one leg',
      'Severe nausea and vomiting (can’t keep fluids down)',
      'Thoughts of harming yourself or your baby'
    ]
  };

  // Common pregnancy conditions. Informational only; every threshold cites an official
  // source and is shown as a "common guideline" the user confirms with their own provider.
  var conditions = {
    gdm: {
      label: 'Gestational diabetes',
      source: 'https://www.nice.org.uk/guidance/ng3',
      sourceUS: 'https://www.acog.org/womens-health/faqs/gestational-diabetes',
      note: 'If you test your blood glucose at home, your team will give you your own target range. These are common guideline targets, always confirm yours with your midwife or diabetes team.',
      // capillary (finger-prick) glucose targets
      targets: {
        mmol: { fasting: 5.3, post1: 7.8, post2: 6.4 },  // NICE NG3 (mmol/L)
        mgdl: { fasting: 95,  post1: 140, post2: 120 }    // ACOG (mg/dL)
      }
    },
    bp: {
      label: 'Blood pressure',
      source: 'https://www.nice.org.uk/guidance/ng133',
      note: 'Raised blood pressure can be a sign of pre-eclampsia. These are common thresholds, not a diagnosis. Always follow your own provider’s advice.',
      raised: { sys: 140, dia: 90 },
      severe: { sys: 160, dia: 110 },
      symptoms: [
        'A bad headache that will not go away',
        'Vision changes: flashing lights, blurring or spots',
        'Sudden swelling of your face, hands or feet',
        'Pain just below your ribs',
        'Feeling generally very unwell'
      ]
    },
    supplements: {
      source: 'https://www.nhs.uk/pregnancy/keeping-well/vitamins-supplements-and-nutrition/',
      note: 'Common pregnancy supplements and medicines. Only take what your provider recommends for you, and follow their dose.',
      suggestions: ['Folic acid', 'Vitamin D', 'Iron', 'Low-dose aspirin', 'Pregnancy multivitamin', 'Insulin', 'Metformin', 'Levothyroxine']
    },
    nausea: {
      label: 'Nausea and vomiting',
      source: 'https://www.nhs.uk/pregnancy/related-conditions/complications/severe-vomiting/',
      note: 'Some nausea and vomiting is common in pregnancy. If you cannot keep food or fluids down, are losing weight, or feel very unwell, contact your midwife or doctor. Severe sickness can be treated.'
    }
  };

  return { weeks: weeks, antenatal: antenatal, dangerSigns: dangerSigns, conditions: conditions, tri: tri, sizeEmoji: sizeEmoji };
})();
