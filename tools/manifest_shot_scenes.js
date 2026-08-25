/* The three manifest screenshots, described once.
 *
 * The generator (tools/gen_manifest_shots.js) writes the PNGs from these scenes; the gate
 * (tools/manifest_shots_check.js) re-renders the SAME scenes and proves the shipped PNG is still the
 * screen the manifest label promises. Sharing the definition is the whole point: a generator and a
 * gate that each described the screen in their own words would drift apart, and the gate would then
 * be certifying a screen nobody ships.
 *
 * The family is invented. Bo, Maya and Sam do not exist.
 */
const DAY = 86400000;

// 09:41, the way Apple shoots their own, and it makes every run comparable to the last one.
const CLOCK = (() => { const d = new Date(); d.setHours(9, 41, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// 390 x 844 at dsf 3 is 1170 x 2532. Both sides sit inside Chrome's 320..3840 install-sheet window,
// the long side is 2.16x the short one (the limit is 2.3x), and all three shots share the ratio,
// which Chrome also requires of every screenshot with the same form_factor.
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/* Runs before any of the app's own script, so the app's first paint already sees the pinned clock.
   Passed by reference to evaluateOnNewDocument rather than written twice. */
function pinClock(shift) {
  const R = Date;
  function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
  D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
  window.Date = D;
}

const SEEN = { home: 1, log: 1, growth: 1, album: 1, health: 1, welcome: 1, heat: 1, care: 1 };
const SETTINGS = { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', country: 'us', seen: SEEN };

const ev = (id, type, hoursAgo, extra) => Object.assign(
  { id, type, babyId: 'b1', time: now - hoursAgo * 3600000 }, extra || {});

/* Yesterday, in full.
 *
 * The first cut of this seed only reached about twelve hours back, so the timeline drew "Yesterday
 * · 1 feed · 3h 12m sleep · 0 nappies" under a baby captioned two months old. No copy claims
 * anything there; the numbers do, and to a parent who knows newborn norms that line is a picture of
 * a baby who needs a hospital. It was a truncated half day drawn as a whole one, in the one place
 * where the data IS the marketing and a first-time parent has nothing to compare it against.
 *
 * So yesterday is an ordinary whole day: eight feeds, seven nappies, fifteen hours of sleep across
 * eight stretches, split between the two of them. Every entry sits between 12 and 34 hours back,
 * which keeps them all inside one calendar day so no third, half-empty day appears underneath.
 * tools/manifest_shots_check.js block 9 holds the shape: any full day in the frame has to look like
 * a day a real baby had. */
const Y_FEEDS = [
  [33.2, 'uidPapa', { method: 'bottle', amount: 100, unit: 'ml' }],
  [29.6, 'uidPapa', { method: 'breast', side: 'right', dur: 15 * 60000 }],
  [26.6, 'local', { method: 'breast', side: 'left', dur: 18 * 60000 }],
  [23.7, 'local', { method: 'breast', side: 'right', dur: 16 * 60000 }],
  [20.7, 'local', { method: 'bottle', amount: 120, unit: 'ml' }],
  [17.7, 'local', { method: 'breast', side: 'left', dur: 17 * 60000 }],
  [14.7, 'uidPapa', { method: 'bottle', amount: 110, unit: 'ml' }],
];
const Y_DIAPERS = [
  [33.0, 'uidPapa', 'wet'], [29.4, 'uidPapa', 'dirty'], [26.4, 'local', 'wet'], [23.5, 'local', 'wet'],
  [20.5, 'local', 'dirty'], [17.5, 'local', 'wet'], [14.5, 'uidPapa', 'wet'],
];
const Y_SLEEPS = [   // start hoursAgo, end hoursAgo
  [32.5, 30.0, 'uidPapa'], [28.9, 27.1, 'uidPapa'], [25.9, 24.4, 'local'], [22.9, 21.2, 'local'],
  [19.9, 18.4, 'local'], [16.9, 15.4, 'local'], [13.7, 12.4, 'uidPapa'],
];
const YESTERDAY = [].concat(
  Y_FEEDS.map((f, i) => ev('yf' + i, 'feed', f[0], Object.assign({ authorId: f[1] }, f[2]))),
  Y_DIAPERS.map((d, i) => ev('yd' + i, 'diaper', d[0], { kind: d[2], authorId: d[1] })),
  Y_SLEEPS.map((s, i) => ev('ys' + i, 'sleep', s[0], { end: now - s[1] * 3600000, authorId: s[2] })),
);

/* A night and a day that two people actually shared: Sam took the 02:47 change and the 03:11 bottle,
   Maya took the morning. Every row carries the name of whoever logged it, which is the one thing a
   solo tracker can never show. */
const TWO_NAMES = {
  babies: [{ id: 'b1', name: 'Bo', birth: now - 70 * DAY, sex: 'M', routines: [], allergies: [] }],
  activeBabyId: 'b1',
  events: [
    ev('f1', 'feed', 1.4, { method: 'breast', side: 'left', dur: 16 * 60000, authorId: 'local' }),
    ev('d1', 'diaper', 2.1, { kind: 'wet', authorId: 'local' }),
    ev('s1', 'sleep', 4.5, { end: now - 2.6 * 3600000, authorId: 'local' }),
    ev('f2', 'feed', 6.5, { method: 'bottle', amount: 110, unit: 'ml', authorId: 'uidPapa' }),
    ev('d2', 'diaper', 6.9, { kind: 'dirty', authorId: 'uidPapa' }),
    ev('s2', 'sleep', 10, { end: now - 6.8 * 3600000, authorId: 'uidPapa' }),
    ev('f3', 'feed', 12, { method: 'breast', side: 'right', dur: 14 * 60000, authorId: 'local' }),
  ].concat(YESTERDAY),
  settings: SETTINGS,
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [],
  pregnancy: null, notes: [],
};

/* No baby yet, so the app is in the pregnancy shell and the wellbeing sheet is reachable. The notes
   already in the list are what makes the promise legible: they are on screen, and the sentence above
   them says they never leave her. */
const PRIVATE_MOOD = {
  babies: [], activeBabyId: null, events: [],
  settings: SETTINGS,
  pregnancy: {
    id: 'p1', stage: 'expecting', edd: now + 96 * DAY, country: 'us',
    moments: [], appts: [], symptoms: [], weights: [], kicks: [], contractions: [],
    moodLog: [
      { id: 'm1', at: now - 2 * DAY, mood: 'Tired', note: 'Did not sleep much. Still glad.' },
      { id: 'm2', at: now - 5 * DAY, mood: 'Anxious', note: 'Waiting on the scan date.' },
      { id: 'm3', at: now - 9 * DAY, mood: 'Calm', note: '' },
    ],
  },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [],
};

/* A pregnancy that ended, with the memories she kept still in the archive. This is what renders
   INSTEAD of "Where are you on the journey?", and it is the screen no rival ships. */
const LOSS_HOLDING = {
  babies: [], activeBabyId: null, events: [],
  settings: SETTINGS,
  pregnancy: null,
  lossHolding: { local: { at: now - 6 * DAY } },
  pregnancyArchive: [{
    id: 'a1', endedAt: now - 6 * DAY, weeks: 11, loss: true, ownerUid: 'local',
    moments: [{ id: 'mo1', at: now - 20 * DAY, week: 9, note: 'The first picture of you.' }],
    journey: {},
  }],
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], notes: [],
};

/* Every scene names the strings that MUST be inside the captured frame after `go` runs, and the ones
   that must not. The store harness that came before this one navigated with a function that returns
   early without a Firebase user and silently photographed the home screen twice; an assertion is the
   only reason anyone would ever find that out.
   `must` is checked with onScreenText below, never document.body.textContent: that string contains
   this app's own inline source, so it matches practically anything and would fake every pass here.
   It is checked against what is INSIDE the frame, not what is in the document, because the first
   capture of shot 1 had both names in the DOM and neither one in the picture. */
const SHOTS = [
  {
    file: '01-two-names',
    why: 'two names on one timeline',
    label: 'Two people, one timeline. Every entry says who logged it.',
    // "(you)" is in the must list on purpose. It is the half of authorTag that only renders for a
    // signed-in reader, so it is the one phrase that goes missing the moment this harness drifts
    // back into photographing a signed-out screen.
    must: ['logged by Mama Bear (you)', 'logged by Papa Bear'],
    mustNot: ['Got it'],
    go: async (page, sleep) => {
      await page.evaluate(() => { go('log'); });
      await sleep(700);
      // The timeline sits under the recap button and the at-a-glance strips, so on a phone it starts
      // below the fold and the first capture was a photograph of the heatmap with the names off
      // screen. Cubby scrolls inside #scroll, not on the document, so window.scrollTo does nothing
      // here at all. The scroll box clamps well before this asks for, which is what puts the last
      // row against the bottom of the frame and both names in the same picture.
      await page.evaluate(() => {
        const sc = document.getElementById('scroll');
        const grp = document.querySelector('.day-group');
        if (sc && grp) sc.scrollTop += grp.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
      });
      await sleep(500);
    },
  },
  {
    file: '02-private-note',
    why: 'a note that is private for real',
    label: 'Your private note stays private. Never shared with your circle, ever.',
    must: ['never shared with anyone in your circle, ever', 'How are you, in yourself'],
    /* An empty list here used to make the banned check pass by having nothing to check. On the one
       screenshot whose whole claim is "nobody else sees this", the other member of the circle and
       any visibility language are exactly what must not be in the picture.
       Not a bare 'Shared with': the sentence this shot exists to photograph is "never shared with
       anyone in your circle, ever", so that ban fires on its own must-have. */
    mustNot: ['Papa Bear', 'Visible to', 'Shared with your circle'],
    go: async (page, sleep) => {
      await page.evaluate(() => { openMoodNote(); });
      await sleep(800);
    },
  },
  {
    file: '03-quiet-after-loss',
    why: 'the screen after a loss',
    /* This label sits in the install sheet, where most of the people reading it are pregnant right
       now and did not ask a question. The first cut read "Not every journey ends happily", which
       names a reader's worst fear at her, unprompted, in a shop window she cannot look away from,
       and it made a claim about her OUTCOME where Cubby's promise is about its own BEHAVIOUR.
       "After a loss" is a neutral time marker: it says what the screen is, not what her odds are.
       Both halves of the promise are literally in the frame and both are true in code. */
    label: 'After a loss, Cubby goes quiet with you. Your memories stay, the prompts stop.',
    must: ['Take all the time you need', 'If you need support',
      'Your kept memories', "There's nothing you need to do right now"],
    // The chooser this screen replaces. If it ever comes back, the shot is of a bereaved parent
    // being asked where she is on the journey, and that must fail loudly rather than ship.
    mustNot: ['Where are you on the journey', "Let's get started", 'Add your baby'],
    go: async (page, sleep) => {
      await page.evaluate(() => { render(); });
      await sleep(700);
    },
  },
];

SHOTS[0].seed = TWO_NAMES;
SHOTS[1].seed = PRIVATE_MOOD;
SHOTS[2].seed = LOSS_HOLDING;

/* Loads the app, plants the scene's own state, then runs the scene. Each scene reloads from scratch:
   one is a baby household, one is a pregnancy and one is neither, and carrying state between them
   would put a stale baby on the screen that is supposed to have none. */
async function stage(page, base, shot, sleep) {
  await page.goto(base + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate((s) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    /* Coach marks and tip strips are keyed per-user in localStorage under cubby-seen-<uid>, NOT in
       state.settings.seen (that map is only ever migrated across for an owner, once, and only when
       the household role has already arrived). Seeding settings.seen alone left a yellow "These
       strips show your week at a glance" tip bar sitting across the middle of the first shot. */
    localStorage.setItem('cubby-seen-local', JSON.stringify({
      home: 1, log: 1, album: 1, health: 1, welcome: 1,
      tip_heat: 1, tip_growth: 1, tip_bday: 1, tip_install: 1, tip_ticker: 1,
      tip_getstarted: 1, tip_leftnote: 1, tip_logguide: 1,
    }));
    // Personal theme is per-uid in localStorage and a leftover dark pick would ship a dark shot.
    Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
  }, shot.seed);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1600);
  await page.evaluate(() => {
    window.LL = window.LL || {};
    window.LL.role = 'owner';
    window.LL.members = { local: 'owner', uidPapa: 'caregiver' };
    window.LL.memberInfo = {
      local: { name: 'Maya', relationship: 'Mama Bear', role: 'owner' },
      uidPapa: { name: 'Sam', relationship: 'Papa Bear', role: 'caregiver' },
    };
    /* Sign the harness in, because every production reader of these screens is signed in.
     *
     * ?e2e=1 boots past the sign-in gate (store-firebase.js), so LL.auth.currentUser stays null while
     * memberInfo is populated by hand above. authorTag() adds " (you)" only when an entry's authorId
     * equals the signed-in uid, so a null user photographs a timeline where nobody is you: seven bare
     * "logged by" rows in a state no parent can ever reach. The previous stub here assigned
     * LL.auth.currentUser directly. currentUser is a GETTER-ONLY accessor on the Firebase Auth
     * prototype, so in sloppy mode that assignment is discarded without throwing, and the comment
     * claiming both halves agreed was false in both halves. An own data property shadows the getter.
     * Then it is verified, out loud: a stub that fails silently is the bug this is fixing. */
    var who = { uid: 'local', email: 'maya@example.com' };
    if (window.LL.auth) { try { Object.defineProperty(window.LL.auth, 'currentUser', { value: who, writable: true, configurable: true }); } catch (e) {} }
    else window.LL.auth = { currentUser: who };
    var got = window.LL.auth && window.LL.auth.currentUser && window.LL.auth.currentUser.uid;
    if (got !== 'local') throw new Error('signed-in stub did not take: LL.auth.currentUser.uid is ' + JSON.stringify(got)
      + '. Every shot from here would be of a screen no signed-in parent sees.');
    // A medicine nudge on a five-second timer lands a black toast across the bottom of whatever is
    // being photographed.
    try { window.toast = function () {}; } catch (e) {}
    // The teaching cards are for a first-run parent, not for the shop window.
    try { if (window.CubbyGuide && CubbyGuide.dismissCard) CubbyGuide.dismissCard(); } catch (e) {}
    try { if (window.CubbyTeach && CubbyTeach.dismissAll) CubbyTeach.dismissAll(); } catch (e) {}
    try { render(); } catch (e) {}
  });
  await sleep(700);
  await shot.go(page, sleep);
}

/* The text a person actually sees in the frame that is about to be photographed.
 *
 * Walks TEXT NODES and measures each one with a Range, which is the only way to ask where a run of
 * text actually landed. The first version of this walked leaf ELEMENTS instead and reported the
 * timeline names missing when they were on screen in front of it, because `logged by Papa Bear` is a
 * bare text node sitting beside the avatar span inside .tl-by, so .tl-by is not a leaf.
 *
 * Never document.body.textContent: that string contains this app's twelve thousand lines of inline
 * source, so it matches practically any assertion and fakes every pass. Here a <script> is excluded
 * three times over, by tag, by display:none, and by having no box at all. */
async function onScreenText(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight, out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const rng = document.createRange();
      rng.selectNodeContents(n);
      const rects = [...rng.getClientRects()].filter((r) => r.width && r.height
        && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw);
      if (rects.length) out.push(t);
    }
    return out.join('\n');
  });
}

module.exports = { DAY, CLOCK, OFFSET, VIEWPORT, pinClock, SHOTS, stage, onScreenText };
