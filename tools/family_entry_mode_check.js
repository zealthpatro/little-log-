#!/usr/bin/env node
/* THE INVITE DOOR.
 *
 * What was wrong for a real parent: every "Invite someone" button in Cubby (the get-started row,
 * the end of onboarding, the visit-prep card, the guardians sheet) opened the same modal Settings
 * opens, in Settings' order. She tapped a button that said Invite someone and landed on a family
 * portrait, her family's name, the list of people already there, and then her OWN name and
 * relationship fields. The one-tap share, the thing she pressed the button for, was the third form
 * block down, past two forms that are about her rather than about the person she wants to add. The
 * single hardest action in the product was also the furthest one from its own button.
 *
 * Second, smaller, and worse when it happens: "Make a link" wrote its failure message into
 * llInvMsg, which lives inside the email-invite block. Fold that block away and a link that could
 * not be made says nothing at all, so the button just goes quiet in her hand.
 *
 * openFamily('invite') is the same modal, same code, different order: link first, the slower ways
 * folded one tap below. Settings passes nothing and is untouched.
 *
 * Two reviewers then took the first version apart in a browser and found five more things, all of
 * which this gate now measures: the "name your family first" nudge had been pushed BELOW the link
 * it only helps before (section 7), the new failure line was the same grey as the two helper
 * paragraphs it sits between (section 5), the guardians sheet still named a screen that no longer
 * appears (section 9), the guide's own "Invite someone" button still opened the Settings order and
 * structurally could not pass a mode (section 10), and the night ghost buttons the fold now hides
 * behind a tap were 1.09:1 (section 12).
 *
 *   PORT=9482 node tools/serve.js &
 *   node tools/family_entry_mode_check.js http://localhost:9482
 *   node tools/family_entry_mode_check.js http://localhost:9482 --self-test
 *
 * The URL is REQUIRED, with no default: this repo has had three agents grade another checkout
 * because a default port happened to be occupied by somebody else's server, and one of them
 * reported a clean pass on main. --self-test puts each fix's pre-fix behaviour back inside the
 * live page and requires the probe covering it to go red. A gate nobody has watched fail is a
 * guess.
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.indexOf('--self-test') >= 0;
const BASE = ARGS.filter((a) => a.indexOf('--') !== 0)[0];
if (!BASE) {
  console.error('usage: node tools/family_entry_mode_check.js http://localhost:<your port> [--self-test]');
  console.error('       no default: pass the URL of the server YOU started, and shasum it against your tree.');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x).slice(0, 400) : '')); } };

// Mid-afternoon, so nothing in the shell is a night-mode or a midnight edge case.
const CLOCK = (() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const SETTINGS = { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } };
const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: Object.assign({}, SETTINGS),
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});
// A family that HAS been named, so the naming prompt is correctly absent and the link is first.
const namedSeed = () => seed({ settings: Object.assign({}, SETTINGS, { householdName: 'The Rileys' }) });

// Who is holding the phone, and what their circle already contains. Fed to load() below.
const SIGN_IN = (role, info, extra) => ({ role: role, info: info, extra: extra || {} });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s, who) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    /* openFamily's first line is `auth.currentUser`, so under ?e2e=1 (no Firebase session, by
       design) it returns before drawing anything at all. The closure holds the SAME object as
       window.LL.auth, so defining currentUser on it is what gives this gate a signed-in parent.
       Nothing else is stubbed: every modal below is the real one, built by the real function. */
    await page.evaluate((w) => {
      Object.defineProperty(window.LL.auth, 'currentUser', {
        value: { uid: 'local', email: 'meera@example.com', displayName: 'Meera' }, configurable: true,
      });
      window.LL.role = w.role;
      window.LL.memberInfo = w.info;
      window.LL.members = Object.keys(w.info).reduce((a, u) => { a[u] = { role: w.info[u].role || 'caregiver' }; return a; }, {});
      window.LL.hhPending = w.extra.pending || {};
      window.LL.hhPendingLinks = w.extra.links || {};
    }, who);
    await sleep(120);
  };

  /* Everything below reads the modal's real children in document order. "The link leads" is a
     claim about POSITION, so position is what gets measured: an index, not the presence of a
     string somewhere on the page. */
  const readModal = () => page.evaluate(() => {
    const ov = document.getElementById('llModalOv');
    /* A shut modal returns the SAME shape as an open one, all zeros. Reverted trees are exactly
       where a modal fails to open, and a gate that then dies on `undefined.slice` reports one
       stack trace instead of the twenty red lines it was written to produce. */
    const EMPTY = {
      open: false, title: '', kids: [], body: '', firstLine: '', linkCopy: '', caregiverLine: false,
      linkBlock: -1, emailBlock: -1, profBlock: -1, portrait: -1, nameFirst: -1, whoIsHere: -1, nameSell: -1,
      folds: [], reach: { has: false, scrollTop: -1, insideModal: false, insideViewport: false, fieldsBefore: -1 },
      has: { copy: false, inv: false, rel: false, bear: false, out: false, err: false, nameTop: false },
      visible: { copy: false, inv: false, rel: false, out: false },
      wired: { out: false, rel: false, bear: false, inv: false, copy: false, nameTop: false },
    };
    if (!ov) return EMPTY;
    const m = ov.querySelector('.ll-modal');
    if (!m) return EMPTY;
    const kids = [].slice.call(m.children);
    const txt = (el) => (el ? (el.textContent || '') : '');
    const linkBlock = kids.findIndex((e) => e.querySelector && e.querySelector('#llCopyLink'));
    const emailBlock = kids.findIndex((e) => (e.querySelector && e.querySelector('#llInvBtn')) || (e.id === 'llFoldEmail'));
    const profBlock = kids.findIndex((e) => (e.querySelector && e.querySelector('#llMyRelBtn')) || (e.id === 'llFoldProfile'));
    const portrait = kids.findIndex((e) => e.classList && e.classList.contains('ll-fp'));
    const nameFirst = kids.findIndex((e) => e.classList && e.classList.contains('ll-namefirst'));
    const whoIsHere = kids.findIndex((e) => /^Who is already here/.test((e.textContent || '').trim()));
    const nameSell = kids.findIndex((e) => /Naming it means an invite can say/.test(e.textContent || ''));
    /* checkVisibility, not offsetParent. Chrome hides a closed <details>' contents with
       content-visibility rather than display:none (so find-in-page still reaches them), and an
       element skipped that way keeps a non-null offsetParent AND its last laid-out box. Measured:
       #llInvBtn inside a shut fold reports offsetParent set and a 320x46 rect, so the obvious
       check would have called a folded-away form visible and passed on a screen nobody can see. */
    const vis = (sel) => {
      const el = m.querySelector(sel);
      if (!el) return false;
      if (el.checkVisibility) return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
      return el.offsetParent !== null;
    };
    /* "On screen without scrolling past a form" is a claim about SCROLL POSITION, and
       checkVisibility knows nothing about scroll position: the modal is max-height:85vh;
       overflow:auto, so the old Settings-order link block was "visible" by that test while sitting
       three forms below the fold. Measured properly: the modal is not scrolled, the button's box
       is inside the modal's own box and inside the viewport, and nothing you have to fill in
       comes before it. The link row's own read-only field is not a form to get past. */
    const reach = (() => {
      const btn = m.querySelector('#llCopyLink');
      if (!btn) return { has: false };
      const mb = m.getBoundingClientRect(), bb = btn.getBoundingClientRect();
      const fields = [].slice.call(m.querySelectorAll('input,select,textarea'))
        .filter((f) => !f.closest('.ll-linkrow'))
        .filter((f) => !!(btn.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING));
      return {
        has: true, scrollTop: m.scrollTop,
        insideModal: bb.top >= mb.top - 1 && bb.bottom <= mb.bottom + 1,
        insideViewport: bb.bottom <= window.innerHeight && bb.top >= 0,
        top: Math.round(bb.top), bottom: Math.round(bb.bottom),
        fieldsBefore: fields.length,
      };
    })();
    return {
      open: true,
      title: txt(m.querySelector('.ll-modal-head h2')).trim(),
      kids: kids.map((e) => e.tagName + '.' + (e.className || '') + '#' + (e.id || '')),
      linkBlock: linkBlock, emailBlock: emailBlock, profBlock: profBlock, portrait: portrait,
      nameFirst: nameFirst, whoIsHere: whoIsHere, nameSell: nameSell, reach: reach,
      folds: [].slice.call(m.querySelectorAll('details.ll-fold')).map((d) => ({ id: d.id, open: d.open })),
      // Existence in the DOM, which is what the wiring after modal() needs, kept separate from
      // whether the parent can actually see it right now.
      has: {
        copy: !!m.querySelector('#llCopyLink'), inv: !!m.querySelector('#llInvBtn'),
        rel: !!m.querySelector('#llMyRelBtn'), bear: !!m.querySelector('#llMyBearBtn'),
        out: !!m.querySelector('#llSignOut'), err: !!m.querySelector('#llLinkErr'),
        nameTop: !!m.querySelector('#llHhNameTop'),
      },
      visible: { copy: vis('#llCopyLink'), inv: vis('#llInvBtn'), rel: vis('#llMyRelBtn'), out: vis('#llSignOut') },
      wired: {
        out: !!(m.querySelector('#llSignOut') || {}).onclick,
        rel: !!(m.querySelector('#llMyRelBtn') || {}).onclick,
        bear: !!(m.querySelector('#llMyBearBtn') || {}).onclick,
        inv: !!(m.querySelector('#llInvBtn') || {}).onclick,
        copy: !!(m.querySelector('#llCopyLink') || {}).onclick,
        nameTop: !!(m.querySelector('#llHhNameTop') || {}).onclick,
      },
      // .ll-invite text only: the block that carries the "where is the other form" sentence.
      linkCopy: [].slice.call(m.querySelectorAll('.ll-invite'))
        .filter((e) => e.querySelector('#llCopyLink')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' '),
      body: m.textContent.replace(/\s+/g, ' ').trim(),
      firstLine: (kids[1] ? kids[1].textContent : '').replace(/\s+/g, ' ').trim().slice(0, 160),
      caregiverLine: /Only the person who set up this circle can add people/.test(m.textContent),
    };
  });

  /* Real contrast, computed from what the browser actually painted, walking up for the first
     ancestor that paints a background. A colour named in a stylesheet is not evidence: the night
     ghost bug below is two rules of equal specificity where the later one wins, and only the
     computed value shows it. */
  const CONTRAST_FN = `(function(){
    window.__lum = function (c) {
      var p = (c.match(/[\\d.]+/g) || []).map(Number);
      var v = p.slice(0, 3).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    window.__bgOf = function (el) {
      for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
        var b = getComputedStyle(n).backgroundColor;
        if (b && b !== 'transparent' && !/rgba\\(0, 0, 0, 0\\)/.test(b)) return b;
      }
      return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
    };
    window.__ratio = function (el) {
      var fg = getComputedStyle(el).color, bg = window.__bgOf(el);
      var a = window.__lum(fg), b = window.__lum(bg);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    };
  })()`;

  const OWNER_SOLO = SIGN_IN('owner', { local: { name: 'Meera', role: 'owner', relationship: 'Mama Bear' } });
  const OWNER_TWO = SIGN_IN('owner', {
    local: { name: 'Meera', role: 'owner', relationship: 'Mama Bear' },
    uidPapa: { name: 'Arjun', role: 'caregiver', relationship: 'Papa Bear' },
  }, { links: { tk1: { at: now - 3600000, expiresAt: now + 3600000, sentTo: 'arjun@example.com' } } });
  const CAREGIVER = SIGN_IN('caregiver', {
    uidOwner: { name: 'Meera', role: 'owner', relationship: 'Mama Bear' },
    local: { name: 'Arjun', role: 'caregiver', relationship: 'Papa Bear' },
  });

  console.log('\n1. the Settings door is exactly where it was');
  try {
    await load(seed(), OWNER_TWO);
    await page.evaluate(() => window.openFamily());
    const r = await readModal();
    ok('it opens', r.open === true, r);
    ok('and is still called Family & sharing', r.title === 'Family & sharing', r.title);
    ok('the portrait still leads', r.portrait >= 0 && r.portrait < r.profBlock, r);
    ok('her profile still comes before the two invite forms', r.profBlock < r.emailBlock, r);
    ok('the email invite still comes before the link', r.emailBlock < r.linkBlock, r);
    ok('nothing is folded away', r.folds.length === 0, r.folds);
    ok('and Sign out is on screen where it has always been', r.visible.out === true, r.visible);
    ok('the link block points UP at the email form', /Add their exact email above instead/.test(r.linkCopy), r.linkCopy);
    ok('and the profile block still carries its own heading', /Your profile/.test(r.body), r.body.slice(0, 200));
    // The naming sell keeps its old place here: in this door it is already the second thing read.
    ok('the naming line is still high up in the Settings order', r.nameSell >= 0 && r.nameSell < r.profBlock, r);
    ok('and there is no second Name it button', r.has.nameTop === false, r.has);
  } catch (e) { ok('section 1 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n2. the invite door leads with the link');
  try {
    await load(namedSeed(), OWNER_TWO);
    await page.evaluate(() => window.openFamily('invite'));
    const r = await readModal();
    ok('it opens', r.open === true, r);
    ok('and says what she pressed: Invite someone', r.title === 'Invite someone', r.title);
    ok('the link block is the very first thing under the heading', r.linkBlock === 1, r);
    ok('there is no naming prompt, because this family has a name', r.nameFirst === -1 && r.has.nameTop === false, r);
    ok('the email invite is now BELOW the link', r.emailBlock > r.linkBlock, r);
    ok('and so is her own profile', r.profBlock > r.linkBlock, r);
    ok('the portrait no longer leads', r.portrait > r.linkBlock, r);
    ok('the two slower ways are folded', r.folds.length === 2, r.folds);
    ok('and both start shut', r.folds.filter((f) => f.open === false).length === 2, r.folds);
    ok('the email form is off screen but still built', r.has.inv === true && r.visible.inv === false, r);
    ok('her profile is off screen but still built', r.has.rel === true && r.visible.rel === false, r);
    ok('the link block asks her to OPEN the email form, not to type into a shut one',
      /Open .Invite by their email address. below/.test(r.linkCopy), r.linkCopy);
    ok('and never says the email form is above', !/email above/.test(r.linkCopy), r.linkCopy);
    ok('nor tells her to add an email to something that is not on screen', !/Add their exact email/.test(r.linkCopy), r.linkCopy);
    // The fold's summary is the heading, so the block inside it must not print the same two words
    // again immediately underneath.
    const heads = await page.evaluate(() => { const d = document.querySelector('#llFoldProfile'); return d ? (d.textContent.match(/Your profile/g) || []).length : -1; });
    ok('"Your profile" is said once, not twice', heads === 1, heads);
  } catch (e) { ok('section 2 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n3. Make a link is genuinely on screen, not merely un-hidden');
  try {
    // The weakest assertion in the first version of this gate said "on screen without scrolling
    // past a form" and measured checkVisibility, which passed on the un-reordered modal too.
    const r = await readModal();
    ok('the modal opens un-scrolled', r.reach.has === true && r.reach.scrollTop === 0, r.reach);
    ok('the button is inside the modal box without scrolling it', r.reach.insideModal === true, r.reach);
    ok('and inside the 844px viewport', r.reach.insideViewport === true, r.reach);
    ok('with nothing to fill in before it', r.reach.fieldsBefore === 0, r.reach);
    // The same measurement on the Settings door, where it must be the other way round: this is the
    // bug the whole change exists to fix, so the probe has to be able to see it.
    await page.evaluate(() => window.openFamily());
    const s = await readModal();
    ok('and on the Settings door that same measurement says the opposite', s.reach.fieldsBefore >= 3 && s.reach.insideViewport === false, s.reach);
  } catch (e) { ok('section 3 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n4. folding a block away does not unwire it');
  try {
    // Fresh render rather than re-judging the one section 3 has been poking at.
    await load(namedSeed(), OWNER_TWO);
    await page.evaluate(() => window.openFamily('invite'));
    const r = await readModal();
    const names = ['out', 'rel', 'bear', 'inv', 'copy'];
    ok('every control openFamily wires after modal() still has a handler',
      names.filter((k) => r.wired[k]).length === 5, r.wired);
    /* Defensive about the fold's own existence rather than assuming it. With the reorder reverted
       there is no #llFoldProfile at all, and a bare .click() on null ends the run here, hiding
       every assertion below it. A gate that stops at the first missing element reports one
       failure for a screen that has several. */
    const before = await page.evaluate(() => {
      const seen = (el) => !!(el && el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }));
      const b = seen(document.getElementById('llMyRelBtn'));
      const sum = document.querySelector('#llFoldProfile summary');
      if (sum) sum.click();
      return b;
    });
    // The browser reveals the fold's contents on the next style pass, not inside the click handler,
    // so measuring in the same task would read the shut state back and call the fold broken.
    await sleep(150);
    const opened = await page.evaluate(() => {
      const seen = (el) => !!(el && el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }));
      const d = document.getElementById('llFoldProfile');
      return { open: !!(d && d.open),
        relVisible: seen(document.getElementById('llMyRelBtn')), outVisible: seen(document.getElementById('llSignOut')) };
    });
    ok('her profile really is out of sight before the tap', before === false, before);
    ok('one tap on the summary opens the fold', opened.open === true, opened);
    ok('and her profile is there', opened.relVisible === true, opened);
    // Inside the fold specifically, not merely on screen: on a modal she reached by pressing
    // "Invite someone", a full-width Sign out at thumb height is a mis-tap waiting to happen.
    const outHome = await page.evaluate(() => !!document.querySelector('#llFoldProfile #llSignOut'));
    ok('with Sign out kept inside the profile fold, off the invite screen', outHome === true && opened.outVisible === true, { outHome, opened });
  } catch (e) { ok('section 4 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n5. a link that cannot be made says so where she is looking, and LOOKS like a failure');
  try {
    await load(namedSeed(), OWNER_TWO);
    await page.evaluate(CONTRAST_FN);
    const r = await page.evaluate(async () => {
      // The endpoint is unreachable in a gate anyway; returning null is exactly what openFamily's
      // own failure branch is written for.
      window.LL.createInviteLink = async () => null;
      window.openFamily('invite');
      const copy = document.getElementById('llCopyLink');
      if (copy) copy.click();
      await new Promise((res) => setTimeout(res, 400));
      const seen = (el) => !!(el && el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }));
      const e = document.getElementById('llLinkErr');
      const inv = document.getElementById('llInvMsg');
      const helper = [].slice.call(document.querySelectorAll('#llModalOv .ll-auth-msg'))
        .filter((x) => x.id !== 'llLinkErr' && (x.textContent || '').trim())[0];
      return {
        errText: (e ? e.textContent : '').trim(), errVisible: seen(e),
        invText: (inv ? inv.textContent : '').trim(), invVisible: seen(inv),
        btn: (copy ? copy.textContent : '').trim(),
        errColor: e ? getComputedStyle(e).color : '', errWeight: e ? getComputedStyle(e).fontWeight : '',
        helperColor: helper ? getComputedStyle(helper).color : '',
        errRatio: e ? window.__ratio(e) : 0,
      };
    });
    ok('the message lands in the link block', r.errText.length > 0, r);
    ok('and the parent can actually see it', r.errVisible === true, r);
    ok('it does not go into the folded-away email block', r.invText === '' && r.invVisible === false, r);
    ok('the button returns to Make a link rather than staying on Making', r.btn === 'Make a link', r);
    ok('and it never claims the email form is above', !/above/.test(r.errText), r.errText);
    // Legibility, not just presence: it sat between two identical grey helper paragraphs at 2.9:1.
    ok('it is not the same grey as the helper text around it', r.errColor !== r.helperColor, r);
    ok('it reads at 4.5:1 or better', r.errRatio >= 4.5, r);
    ok('and it is set heavier than a helper line', Number(r.errWeight) >= 600, r);
  } catch (e) { ok('section 5 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n6. a caregiver has nothing to lead with, so she gets the normal order');
  try {
    await load(seed(), CAREGIVER);
    await page.evaluate(() => window.openFamily('invite'));
    const r = await readModal();
    ok('the modal opens for her too', r.open === true, r);
    ok('and keeps the Settings heading', r.title === 'Family & sharing', r.title);
    ok('nothing is folded, so her own profile is not hidden behind a tap', r.folds.length === 0, r.folds);
    ok('her profile is on screen', r.visible.rel === true, r.visible);
    ok('Sign out is on screen', r.visible.out === true, r.visible);
    ok('there is no link block to lead with', r.has.copy === false, r.has);
    ok('and the modal says plainly why', r.caregiverLine === true, r.body.slice(0, 200));
    /* She pressed a button that said Invite someone. The answer used to be the LAST thing on the
       screen, in faint grey under her own profile form. Same blocks, same order, that one sentence
       first. */
    ok('the reason is the first thing she reads, not the last', /Only the person who set up this circle/.test(r.firstLine), r.firstLine);
    ok('it names a person to ask rather than a role', /Ask Meera to send an invite/.test(r.body), r.body.slice(0, 200));
    ok('and it does not say "owner" at her', !/Only an owner can invite/.test(r.body), r.body.slice(0, 300));
    // Opened from Settings it stays where it always was, at the bottom: she did not ask to invite.
    await page.evaluate(() => window.openFamily());
    const s = await readModal();
    ok('opened from Settings that sentence is not hoisted', !/Only the person who set up this circle/.test(s.firstLine), s.firstLine);
    ok('but it is still on the screen', s.caregiverLine === true, s.body.slice(0, 200));
  } catch (e) { ok('section 6 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n7. the very first invite: no family name, nobody else, nothing pending');
  try {
    await load(seed(), OWNER_SOLO);
    await page.evaluate(() => window.openFamily('invite'));
    const r = await readModal();
    ok('the invite door still opens', r.open === true && r.title === 'Invite someone', r.title);
    ok('both folds are still there', r.folds.length === 2, r.folds);
    /* THE REORDER'S OWN BLIND SPOT. The one piece of advice that only helps BEFORE the link is
       sent had been pushed five blocks below the button that sends it: she made a link that said
       "someone's Cubby" and was told why afterwards. It leads now. */
    ok('the naming prompt is the first thing under the heading', r.nameFirst === 1, r);
    ok('and the link follows it immediately', r.linkBlock === 2, r);
    ok('so the advice comes BEFORE the button it is about', r.nameFirst < r.linkBlock, r);
    ok('it is one line, with its own Name it button', r.has.nameTop === true && r.wired.nameTop === true, r);
    ok('the button is still reachable without scrolling', r.reach.insideViewport === true && r.reach.fieldsBefore === 0, r.reach);
    ok('and the same point is not made twice on one screen', r.nameSell === -1, r);
    const mems = await page.evaluate(() => [].slice.call(document.querySelectorAll('#llModalOv .ll-mem')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok('the circle is exactly one person', mems.length === 1, mems);
    ok('and it is her', /Meera \(you\)/.test(mems[0] || ''), mems);
    ok('no invited-not-joined heading, because nobody has been invited', !/Invited, not joined yet/.test(r.body), r.body.slice(0, 300));
    ok('and the full name row is still down there under Who is already here', r.whoIsHere >= 0 && r.whoIsHere < r.portrait, r);
  } catch (e) { ok('section 7 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n8. naming the family from the invite door brings her back to it');
  try {
    // A detour, not an exit: the Name it button closes this modal, so it has to say which door to
    // come back through or the invite she came to send ends here.
    await load(seed(), OWNER_SOLO);
    await page.evaluate(() => { window.openFamily('invite'); document.getElementById('llHhNameTop').click(); });
    await sleep(200);
    const sheet = await page.evaluate(() => ({
      sheet: /What shall we call your family/.test(document.body.innerText || ''),
      modalGone: !document.getElementById('llModalOv'),
    }));
    ok('it opens the naming sheet', sheet.sheet === true, sheet);
    ok('and the modal steps out of the way', sheet.modalGone === true, sheet);
    const back = await page.evaluate(() => {
      const inp = document.getElementById('hhName'); if (inp) inp.value = 'The Rileys';
      const btns = [].slice.call(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'Save');
      if (btns.length) btns[btns.length - 1].click();
      return true;
    });
    await sleep(250);
    const r = await readModal();
    ok('saving the name puts her back on the invite door, not out of the flow', back && r.open === true && r.title === 'Invite someone', r.title);
    ok('the prompt is gone now that the family has a name', r.nameFirst === -1, r);
    ok('and the link has moved up into first place', r.linkBlock === 1, r);
    ok('the name she typed is on the screen', /The Rileys/.test(r.body), r.body.slice(0, 200));
    // Cancel must return her too: backing out of a detour is not backing out of the invite.
    await page.evaluate(() => { document.getElementById('llHhName').click(); });
    await sleep(200);
    await page.evaluate(() => {
      const btns = [].slice.call(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'Cancel');
      if (btns.length) btns[btns.length - 1].click();
    });
    await sleep(250);
    const c = await readModal();
    ok('cancelling the rename comes back to the invite door as well', c.open === true && c.title === 'Invite someone', c.title);
  } catch (e) { ok('section 8 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n9. the door she came in by does not stick to the next one');
  try {
    await load(namedSeed(), OWNER_TWO);
    await page.evaluate(() => window.openFamily('invite'));
    const a = await readModal();
    await page.evaluate(() => window.openFamily());
    const b = await readModal();
    await page.evaluate(() => window.openFamily('invite'));
    const c = await readModal();
    ok('invite door: link first', a.linkBlock === 1, a);
    ok('then Settings: portrait first, link last', b.portrait === 1 && b.linkBlock > b.profBlock, b);
    ok('then invite again: link first again', c.linkBlock === 1, c);
    ok('and only one modal is ever on screen', await page.evaluate(() => document.querySelectorAll('#llModalOv').length) === 1);
  } catch (e) { ok('section 9 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n10. the real buttons, clicked');
  try {
    // The get-started card's invite row, on Home, tapped the way a parent taps it.
    await load(namedSeed(), OWNER_SOLO);
    const r = await page.evaluate(() => {
      go('home');
      const rows = [].slice.call(document.querySelectorAll('.gs-card *'))
        .filter((e) => e.getAttribute && e.getAttribute('onclick') && /openFamily/.test(e.getAttribute('onclick')));
      if (!rows.length) return { found: 0 };
      rows[0].click();
      const ov = document.getElementById('llModalOv');
      return { found: rows.length, label: rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
        title: ov ? ov.querySelector('.ll-modal-head h2').textContent.trim() : '' };
    });
    ok('the get-started card has exactly one invite row', r.found === 1, r);
    ok('it is the co-parent row', /Invite a co-parent/.test(r.label || ''), r);
    ok('and tapping it lands on the invite door', r.title === 'Invite someone', r);

    // The end of onboarding, both of its sheets: the baby path and the pregnancy path.
    const ob = await page.evaluate(() => {
      const out = [];
      const shut = () => { const o = document.getElementById('llModalOv'); if (o) o.remove(); if (window.closeSheet) closeSheet(); };
      shut(); openOnboardInvite();
      let b = [].slice.call(document.querySelectorAll('button')).filter((x) => /openFamily/.test(x.getAttribute('onclick') || ''));
      out.push({ n: b.length, label: b[0] ? b[0].textContent.trim() : '' });
      if (b[0]) b[0].click();
      out.push({ title: (document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '' });
      shut();
      state.pregnancy = { stage: 'expecting', due: Date.now() + 120 * 86400000, ownerUid: 'local' };
      state.babies = [];
      openOnboardInvite();
      b = [].slice.call(document.querySelectorAll('button')).filter((x) => /openFamily/.test(x.getAttribute('onclick') || ''));
      out.push({ n: b.length, label: b[0] ? b[0].textContent.trim() : '' });
      if (b[0]) b[0].click();
      out.push({ title: (document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '' });
      shut();
      return out;
    });
    ok('the baby onboarding sheet offers one invite button', ob[0].n === 1 && ob[0].label === 'Invite someone', ob[0]);
    ok('and it opens the invite door', (ob[1].title || '').trim() === 'Invite someone', ob[1]);
    ok('the pregnancy onboarding sheet offers one too', ob[2].n === 1 && ob[2].label === 'Invite someone', ob[2]);
    ok('and it opens the invite door as well', (ob[3].title || '').trim() === 'Invite someone', ob[3]);

    // The guardians sheet, where the button used to say "Open Family & sharing".
    await load(namedSeed(), OWNER_SOLO);
    const g = await page.evaluate(() => {
      const o = document.getElementById('llModalOv'); if (o) o.remove();
      openGuardians();
      const sub = [].slice.call(document.querySelectorAll('.csub')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' ');
      const b = [].slice.call(document.querySelectorAll('button')).filter((x) => /openFamily/.test(x.getAttribute('onclick') || ''));
      const label = b[0] ? b[0].textContent.trim() : '';
      if (b[0]) b[0].click();
      return { sub: sub, label: label, title: ((document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '').trim() };
    });
    ok('the guardians button no longer names a screen the parent never sees', !/Family & sharing/.test(g.sub) && !/Family & sharing/.test(g.label), g);
    ok('it says what the next screen says: Invite someone', g.label === 'Invite someone', g);
    ok('and it does not presume she has a partner', !/partner/i.test(g.label) && !/Invite your partner/.test(g.sub), g);
    ok('the line above it still tells her what to come back for', /come back to make them a guardian/.test(g.sub), g);
    ok('and it opens the invite door', g.title === 'Invite someone', g);

    // The visit-prep card, which a mother reaches from the home next-appointment card.
    const vp = await page.evaluate(() => {
      const o = document.getElementById('llModalOv'); if (o) o.remove(); if (window.closeSheet) closeSheet();
      window.pregJourneyIsOwner = function () { return true; };
      state.pregnancy = { stage: 'expecting', due: Date.now() + 120 * 86400000, ownerUid: 'local',
        appts: [{ id: 'a1', title: '20-week scan', week: 20 }], visitQs: [] };
      openVisitPrep('a1');
      const rows = [].slice.call(document.querySelectorAll('.hero-invite'))
        .filter((e) => /openFamily/.test(e.getAttribute('onclick') || ''));
      const label = rows[0] ? rows[0].textContent.replace(/\s+/g, ' ').trim() : '';
      if (rows[0]) rows[0].click();
      return { n: rows.length, label: label, title: ((document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '').trim() };
    });
    ok('the visit-prep card still offers the invite', vp.n === 1 && /Who's coming with you/.test(vp.label), vp);
    ok('and it opens the invite door', vp.title === 'Invite someone', vp);

    // The Settings row must still land on Settings' order. It lives in openSettings()'s sheet,
    // not on a tab, so the sheet is the thing to open.
    await load(namedSeed(), OWNER_SOLO);
    const s2 = await page.evaluate(() => {
      const ov0 = document.getElementById('llModalOv'); if (ov0) ov0.remove();
      openSettings();
      const rows = [].slice.call(document.querySelectorAll('.set-item'))
        .filter((e) => /openFamily/.test(e.getAttribute('onclick') || ''));
      if (!rows.length) return { found: 0 };
      rows[0].click();
      const ov = document.getElementById('llModalOv');
      return { found: rows.length, label: rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
        title: ov ? ov.querySelector('.ll-modal-head h2').textContent.trim() : '' };
    });
    ok('Settings still has exactly one family row', s2.found === 1, s2);
    ok('and it still opens Family & sharing', s2.title === 'Family & sharing', s2);

    /* And the whole-file invariant, so a SEVENTH invite CTA added next month cannot quietly land
       on the Settings order. Every openFamily( call site in the shipped file either passes
       'invite' or is one of the two Settings entries (the profile card and the Settings row),
       which are identified by their own labels rather than by line number. */
    const sites = await page.evaluate(async (base) => {
      const src = await (await fetch(base + '/app/index.html')).text();
      const out = [], lines = src.split('\n');
      lines.forEach(function (line, i) {
        // The label of a Settings row can be a line or two below its own onclick, so the window is
        // the call site plus the little block it sits in.
        const near = lines.slice(i, i + 4).join(' ');
        (line.match(/openFamily\(([^)]*)\)/g) || []).forEach(function (m) {
          const row = { line: i + 1, arg: m, settings: /Family &amp; sharing|Your profile &amp; family/.test(near),
            label: line.replace(/\s+/g, ' ').trim().slice(0, 90) };
          if (/^openFamily\(\)$/.test(m)) out.push(row);
          else if (!/'invite'/.test(m)) out.push(row);
        });
      });
      return out;
    }, BASE);
    ok('exactly two call sites open the Settings order', sites.length === 2, sites);
    ok('and both of them are Settings entries', sites.length === 2 && sites.every((s) => s.settings), sites);
  } catch (e) { ok('section 10 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n11. the guide\'s own Invite someone button');
  try {
    /* app/log-guide.js ends the "Sharing with your circle" story with a real primary button
       labelled Invite someone. It was still calling openFamily(), and callFn threw the argument
       away, so it could not have been fixed by editing the string alone. */
    await load(namedSeed(), OWNER_SOLO);
    const g = await page.evaluate(() => {
      const o = document.getElementById('llModalOv'); if (o) o.remove();
      CubbyGuide.story('sharing', 0);
      const btns = [].slice.call(document.querySelectorAll('.lg-try'));
      // Walk to the last step, where the CTA lives.
      for (let i = 0; i < 8; i++) {
        const b = [].slice.call(document.querySelectorAll('.lg-try'))[0];
        if (!b) break;
        if (b.textContent.trim() !== 'Next') break;
        b.click();
      }
      const cta = [].slice.call(document.querySelectorAll('.lg-try'))[0];
      const label = cta ? cta.textContent.trim() : '';
      if (cta) cta.click();
      return { started: btns.length > 0, label: label,
        title: ((document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '').trim() };
    });
    ok('the sharing story opens', g.started === true, g);
    ok('its last step is a real Invite someone button', g.label === 'Invite someone', g);
    ok('and it opens the invite door, like every other button with that label', g.title === 'Invite someone', g);
    // The same arg-dropping bug sent the album story to go(undefined). One fix, both stories.
    const alb = await page.evaluate(() => {
      const o = document.getElementById('llModalOv'); if (o) o.remove();
      CubbyGuide.story('album', 0);
      for (let i = 0; i < 8; i++) {
        const b = [].slice.call(document.querySelectorAll('.lg-try'))[0];
        if (!b || b.textContent.trim() !== 'Next') break;
        b.click();
      }
      const cta = [].slice.call(document.querySelectorAll('.lg-try'))[0];
      if (cta) cta.click();
      // `view` is a top-level `let`, so it is not on window: the nav says where the app went.
      const on = document.querySelector('.nav-btn.active');
      return { tab: on ? on.textContent.replace(/\s+/g, '').trim() : '' };
    });
    ok('and the album story lands on the album rather than on view=undefined', alb.tab === 'Album', alb);
  } catch (e) { ok('section 11 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n12. night, where the fold puts three ghost buttons behind a tap');
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await load(seed(), OWNER_SOLO);
    await page.evaluate(CONTRAST_FN);
    const n = await page.evaluate(() => {
      window.openFamily('invite');
      const d = document.getElementById('llFoldProfile'); if (d) d.open = true;
      const pick = (id) => { const el = document.getElementById(id); return el ? { color: getComputedStyle(el).color, r: window.__ratio(el) } : null; };
      const hv = document.querySelector('#llModalOv .ll-hhname-v');
      const nf = document.querySelector('#llModalOv .ll-namefirst');
      return { out: pick('llSignOut'), rel: pick('llMyRelBtn'), bear: pick('llMyBearBtn'),
        hhname: hv ? { color: getComputedStyle(hv).color, r: window.__ratio(hv) } : null,
        namefirst: nf ? window.__ratio(nf) : null,
        theme: document.documentElement.getAttribute('data-theme') };
    });
    ok('the app really is in night mode', n.theme === 'night', n.theme);
    ok('Sign out is readable', n.out && n.out.r >= 4.5, n.out);
    ok('Save my profile is readable', n.rel && n.rel.r >= 4.5, n.rel);
    ok('Change my bear avatar is readable', n.bear && n.bear.r >= 4.5, n.bear);
    ok('the family name on the mint panel is readable', n.hhname && n.hhname.r >= 4.5, n.hhname);
    ok('and the new naming prompt is readable too', n.namefirst !== null && n.namefirst >= 4.5, n.namefirst);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  } catch (e) { ok('section 12 ran to the end', false, String((e && e.message) || e)); }

  console.log('\n13. house voice');
  try {
    await load(seed(), OWNER_TWO);
    const r = await page.evaluate(() => {
      window.openFamily('invite');
      const m = document.querySelector('#llModalOv .ll-modal');
      const t = (s) => s.replace(/›/g, '').trim();
      return { body: m.textContent,
        folds: [].slice.call(m.querySelectorAll('.ll-fold>summary')).map((s) => t(s.textContent)),
        foldCase: [].slice.call(m.querySelectorAll('.ll-fold>summary')).map((s) => getComputedStyle(s).textTransform),
        heads: [].slice.call(m.querySelectorAll('.ll-modal-head h2')).map((s) => s.textContent.trim()) };
    });
    // Every dash a keyboard or a paste can produce, not only U+2014.
    ok('no em-dash or en-dash anywhere in the invite door', r.body.indexOf('—') < 0 && r.body.indexOf('–') < 0, r.body.slice(0, 200));
    ok('and no typed double hyphen either', !/\s--\s/.test(r.body), r.body.slice(0, 200));
    ok('nothing shouts', !/!/.test(r.body.replace(/[^\S\n]+/g, ' ')), r.body.slice(0, 200));
    ok('no jargon leaks out of the permissions table', !/\bowner\b/i.test(r.body) || !/Only an owner/.test(r.body), r.body.slice(0, 300));
    /* Sentence case measured on the painted text, and on every word after the first: the old check
       compared the string to its own capitalised self, which Title Case passes, and read
       textContent, which a text-transform would defeat. */
    const sentenceCase = (s) => {
      const w = s.split(/\s+/).filter(Boolean);
      if (!w.length || w[0] !== w[0].charAt(0).toUpperCase() + w[0].slice(1)) return false;
      return w.slice(1).every((x) => /^[^A-Za-z]*[a-z]/.test(x) || /^[A-Z]{2,}$/.test(x) === false && x === x.toLowerCase());
    };
    ok('both fold labels are sentence case, word by word', r.folds.length === 2 && r.folds.every(sentenceCase), r.folds);
    ok('and no stylesheet is shouting them for us', r.foldCase.every((c) => c === 'none'), r.foldCase);
    ok('the heading is sentence case too', r.heads.length === 1 && sentenceCase(r.heads[0]), r.heads);
  } catch (e) { ok('section 13 ran to the end', false, String((e && e.message) || e)); }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));

  /* ---- --self-test: put each fix's pre-fix behaviour back in the live page ----
     Everything reverted here is reachable from outside the module: an element, an inline style, or
     window.openFamily itself. Each one has to make the probe that covers it flip. */
  let selfBad = 0;
  if (SELF_TEST) {
    console.log('\n--self-test: revert each fix inside the page and require the probe to fail');
    const chk = (n, c, x) => { if (c) { console.log('  ok   ' + n); } else { selfBad++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x).slice(0, 300) : '')); } };

    // 1. The naming prompt, removed: the order probe in section 7 must stop seeing it first.
    await load(seed(), OWNER_SOLO);
    const good7 = await readModal.call(null) && await page.evaluate(() => { window.openFamily('invite'); return true; });
    const withPrompt = await readModal();
    const withoutPrompt = await page.evaluate(() => {
      const el = document.querySelector('#llModalOv .ll-namefirst'); if (el) el.remove();
      const kids = [].slice.call(document.querySelector('#llModalOv .ll-modal').children);
      return { nameFirst: kids.findIndex((e) => e.classList && e.classList.contains('ll-namefirst')),
        linkBlock: kids.findIndex((e) => e.querySelector && e.querySelector('#llCopyLink')) };
    });
    chk('with the prompt in place it leads and the link follows', good7 && withPrompt.nameFirst === 1 && withPrompt.linkBlock === 2, withPrompt);
    chk('with it reverted section 7 can fail', withoutPrompt.nameFirst === -1, withoutPrompt);

    // 2. The failure line's colour, reverted to the helper grey it used to inherit.
    await load(namedSeed(), OWNER_TWO);
    await page.evaluate(CONTRAST_FN);
    const err = await page.evaluate(async () => {
      window.LL.createInviteLink = async () => null;
      window.openFamily('invite');
      document.getElementById('llCopyLink').click();
      await new Promise((r) => setTimeout(r, 300));
      const e = document.getElementById('llLinkErr');
      const before = { r: window.__ratio(e), w: getComputedStyle(e).fontWeight };
      e.style.color = '#9a8d80'; e.style.fontWeight = '400';
      return { before: before, after: { r: window.__ratio(e), w: getComputedStyle(e).fontWeight } };
    });
    chk('the failure line reads at 4.5:1 with the fix', err.before.r >= 4.5 && Number(err.before.w) >= 600, err.before);
    // 3.27:1 measured: the helper grey fails AA for body text, which is the whole point.
    chk('and reverted to the old grey it fails AA, so section 5 can fail', err.after.r < 4.5 && Number(err.after.w) < 600, err.after);

    // 3. openFamily made to ignore its argument, which is what log-guide's callFn used to do.
    const dropped = await page.evaluate(() => {
      const real = window.openFamily;
      window.openFamily = function () { return real(); };
      const o = document.getElementById('llModalOv'); if (o) o.remove();
      CubbyGuide.story('sharing', 0);
      for (let i = 0; i < 8; i++) {
        const b = [].slice.call(document.querySelectorAll('.lg-try'))[0];
        if (!b || b.textContent.trim() !== 'Next') break;
        b.click();
      }
      const cta = [].slice.call(document.querySelectorAll('.lg-try'))[0];
      if (cta) cta.click();
      const t = ((document.querySelector('#llModalOv .ll-modal-head h2') || {}).textContent || '').trim();
      window.openFamily = real;
      return t;
    });
    chk('with the argument thrown away the guide lands on Family & sharing, so section 11 can fail', dropped === 'Family & sharing', dropped);

    // 4. Night ghost colour, put back to the value the later rule used to win with.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await load(seed(), OWNER_SOLO);
    await page.evaluate(CONTRAST_FN);
    const ghost = await page.evaluate(() => {
      window.openFamily('invite');
      const d = document.getElementById('llFoldProfile'); if (d) d.open = true;
      const el = document.getElementById('llSignOut');
      const before = window.__ratio(el);
      el.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      return { before: before, after: window.__ratio(el) };
    });
    chk('Sign out is readable at night with the fix', ghost.before >= 4.5, ghost);
    chk('and reverted it falls under 1.5:1, so section 12 can fail', ghost.after < 1.5, ghost);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    console.log(selfBad ? '\nSELF-TEST: FAIL (' + selfBad + ')' : '\nSELF-TEST: every reverted fix went red as required');
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log((fail || selfBad) ? 'FAMILY-ENTRY-MODE: FAIL' : 'FAMILY-ENTRY-MODE: PASS');
  process.exit((fail || selfBad) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
