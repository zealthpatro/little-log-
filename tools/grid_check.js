/* Blocking check for the card grid (app/index.html).
 *
 * An audit found six card paddings and four radii on the home screen alone: 11/13, 12/14, 13/16,
 * 14/15, 15/18, 16/8. Those were never six decisions. 13, 14 and 15 are the same intent measured
 * three times, and the eye reads the result as cards that do not quite belong to each other.
 *
 * A universal 4px grid was the obvious answer and the wrong one: 510 of 805 spacing values in this
 * stylesheet would move, 343 of them by 2px, which is a redesign of every screen in a shipped app.
 * So the fix was component tokens set to whatever each cluster already sat closest to, and this is
 * what stops them being quietly re-hardcoded next time somebody adds a card.
 *
 * Deliberately narrow. It does NOT police the whole stylesheet, because 279 values under 10px are
 * fine typographic spacing that should stay hand-set. It polices the repeated card family only.
 *
 *   node tools/grid_check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');

let fails = 0, passes = 0;
function check(ok, what, detail) {
  if (ok) { passes++; }
  else { fails++; console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : '')); }
}

/* Pull one rule's body by selector.
   PREFER THE RULE THAT STARTS A LINE. A bare indexOf('.day-surface{') finds
   `[data-theme="night"] .pick-item,[data-theme="night"] .day-surface{` first, because that override
   appears earlier in the file. This helper then reads the dark-mode rule and reports on the wrong
   one. That is not hypothetical: the same mistake put a margin into the night override during this
   change, so it applied only in dark mode, and this check read that same rule and could not see it. */
function rule(sel) {
  let i = SRC.indexOf('\n' + sel);
  if (i !== -1) i += 1;
  else i = SRC.indexOf(sel);
  if (i === -1) return null;
  return SRC.slice(i, SRC.indexOf('}', i));
}

console.log('card grid');

// The tokens have to exist before anything can point at them.
['--gutter', '--stack', '--pad-card', '--pad-dense', '--r-card'].forEach(t => {
  check(new RegExp('\\' + t + ':').test(SRC), 'token ' + t + ' is defined');
});

/* The repeated card family shares one padding and one radius. A new card that hard-codes its own
   is how six of them appeared last time. */
const CARDS = ['.coach{', '.nudge{', '.note-card{'];
CARDS.forEach(sel => {
  const b = rule(sel);
  check(!!b, sel + ' exists');
  if (!b) return;
  check(/padding:var\(--pad-card\)/.test(b), sel + ' uses var(--pad-card)',
    (b.match(/padding:[^;]*/) || [''])[0]);
  check(/border-radius:var\(--r-card\)/.test(b), sel + ' uses var(--r-card)',
    (b.match(/border-radius:[^;]*/) || [''])[0]);
});
{
  const b = rule('.alert-pill{');
  check(!!b && /padding:var\(--pad-dense\)/.test(b), '.alert-pill uses var(--pad-dense)');
  check(!!b && /border-radius:var\(--r-card\)/.test(b), '.alert-pill uses var(--r-card)');
}

/* Three more that the first pass did not reach, found by measuring the rendered page rather than
   reading the stylesheet: text inside home widgets started at seven different x positions.
   .tip-static is the same shape as an alert pill and had 11/15 with a 16px radius, which is the
   same intent measured twice. .hero-invite sat 2px further in than every other card on the screen,
   and .preg-card was 1px out on top. Two insets are intentional and enough: dense and card. */
[['.tip-static{', '--pad-dense'], ['.hero-invite{', '--pad-card'], ['.preg-card{', '--pad-card']]
  .forEach(([sel, tok]) => {
    const b = rule(sel);
    check(!!b, sel + ' exists');
    if (!b) return;
    check(new RegExp('padding:var\\(' + tok + '\\)').test(b), sel + ' uses var(' + tok + ')',
      (b.match(/padding:[^;]*/) || [''])[0]);
  });
{
  const b = rule('.tip-static{');
  check(!!b && /border-radius:var\(--r-card\)/.test(b),
    '.tip-static shares its radius with .alert-pill');
}

/* THE ONE THAT WAS ACTUALLY VISIBLE. .sec-title carried margin:6px 4px 12px, so every section
   heading sat 4px inside the cards it labelled. "Quick log" was indented further than the buttons
   underneath it, on every screen. Horizontal margin here must stay zero: the gutter is the page's
   job, not the heading's. */
{
  const b = rule('.sec-title{');
  check(!!b, '.sec-title exists');
  if (b) {
    const m = (b.match(/margin:([^;]+)/) || [])[1] || '';
    const parts = m.trim().split(/\s+/);
    const horiz = parts.length >= 2 ? parts[1] : '0';
    check(horiz === '0' || horiz === '0px',
      '.sec-title has no horizontal margin, so headings align with cards',
      'margin: ' + m + '  -> headings would sit ' + horiz + ' inside every card');
  }
}

/* The TILES, which is what the eye actually reads. The first two passes measured full-width cards
   and moved them by 1-3px, which is invisible. Meanwhile .since-card sat at 12px and .action at
   18px, stacked on the same screen as cards at 16px: three insets in one scroll, and that is the
   one a person notices, because tiles sit in grids where the eye compares them directly.
   .since-card is 14 rather than 16 on purpose. At 110px wide, 16 wraps "Last diaper" onto two
   lines at 360px, measured against the shipped build rather than guessed. 14 matches the dense
   inset .tip-static and .alert-pill already share, so it joins a family instead of inventing one. */
[['.since-card{', '--pad-tile'], ['.action{', '--pad-tap']].forEach(([sel, tok]) => {
  const b = rule(sel);
  check(!!b, sel + ' exists');
  if (!b) return;
  check(new RegExp('padding:var\\(' + tok + '\\)').test(b), sel + ' uses var(' + tok + ')',
    (b.match(/padding:[^;]*/) || [''])[0]);
});
['--pad-tile', '--pad-tap'].forEach(t => {
  check(new RegExp('\\' + t + ':').test(SRC), 'token ' + t + ' is defined');
});
{
  // every card and tile shares one horizontal inset family: 14 dense, 16 roomy. Never a third.
  const insets = [];
  ['--pad-card', '--pad-dense', '--pad-tile', '--pad-tap'].forEach(t => {
    const m = SRC.match(new RegExp('\\' + t + ':\\s*([^;]+);'));
    if (m) insets.push(m[1].trim().split(/\s+/)[1]);
  });
  const uniq = [...new Set(insets)];
  check(uniq.every(v => v === '14px' || v === '16px'),
    'every card and tile inset is 14px or 16px, never a third value', uniq.join(', '));
}

/* ONE RADIUS, AND ONE STATED EXCEPTION. Cards carried 14, 16 and 26 while sitting next to each
   other, which reads as three families rather than one. Everything is 16 now; the quick-log tiles
   keep 26 because they are the app's primary tap targets and the softer corner is doing a job
   there. That exception has its own token so it is a decision somebody made rather than a leftover.
   This block used to assert that FOUR tokens all resolved to 16px (--radius, --radius-sm, --r-card,
   --r-dense) and argued they should stay: renaming 35 selectors to save three aliases looked like
   churn, and single-sourcing the value seemed like enough. That was wrong, and the argument had the
   defect inside it. A token's job is not only to single-source a value, it is to tell the next
   person which choice they are making. Four names for one number told them the choice was
   meaningless, so the next thirty radii got hand-typed instead. --radius-sm in particular promised
   a smaller corner and delivered the same one.

   They are consolidated now. --r-card is the single card radius, the rename was done in one pass,
   and tools/surface_token_check.js asserts on the RENDERED element that no two radius tokens share
   a value, which is the check that would have caught this in the first place. */
{
  const tokens = ['--r-card'];
  tokens.forEach(t => {
    const m = SRC.match(new RegExp('\\' + t + ':\\s*([^;]+);'));
    check(!!m, 'token ' + t + ' is defined');
    if (m) check(m[1].trim() === '16px', t + ' is 16px', m[1].trim());
  });
  const tap = SRC.match(/--r-tap:\s*([^;]+);/);
  check(!!tap, 'token --r-tap is defined');
  if (tap) check(tap[1].trim() === '26px', '--r-tap keeps 26px for the quick-log tiles', tap[1].trim());
  const b = rule('.action{');
  check(!!b && /border-radius:var\(--r-tap\)/.test(b),
    '.action is the only thing using the exception',
    (b && (b.match(/border-radius:[^;]*/) || [''])[0]) || '');
  // and nothing else may quietly borrow it
  const users = (SRC.match(/border-radius:var\(--r-tap\)/g) || []).length;
  check(users === 1, 'exactly one rule uses --r-tap', users + ' rules do');
}

/* .today-strip is deliberately NOT in the inset family, and this note exists so the next person
   measuring the home screen does not "fix" it the way I nearly did.
   Its 8px looks like the worst outlier on the page: cells start at x=28 while the notes card
   directly beneath starts at 37. But the strip is a three-up grid of CENTRED content, so its outer
   padding sets column widths and divider positions rather than a text edge. There is no left edge
   for it to be ragged against. Raising it to 16 aligned a number nobody sees and wrapped "1h 40m"
   onto two lines at 320px, which is visible to everybody. Measured, both ways, before reverting. */
{
  const b = rule('.today-strip{');
  check(!!b, '.today-strip exists');
  if (b) check(/padding:16px 8px/.test(b),
    '.today-strip keeps its own padding (centred content, not a text edge)',
    (b.match(/padding:[^;]*/) || [''])[0]);
}
{
  // the disclaimer is card-shaped and joins the one radius
  const b = rule('.disclaimer{');
  check(!!b && /border-radius:var\(--r-card\)/.test(b), '.disclaimer uses the shared radius');
}

/* Two column-level fixes that are easy to undo by accident.

   .action.wide fills the row when the tile count is odd. Five is the common case, and before this
   the fifth tile sat beside a hole the size of itself, which reads as a missing tile. The rule was
   already in the stylesheet but dead: it was written for a .txt wrapper that actBtn does not
   produce, so its row layout would have put the label and its hint side by side.

   .note-empty was the only centred block inside a left-aligned card, which is what made the notes
   card look like two cards stacked. */
{
  const b = rule('.action.wide{');
  check(!!b, '.action.wide exists');
  if (b) {
    check(/grid-column:1 \/ -1/.test(b), '.action.wide fills the row');
    check(/padding:var\(--pad-tap\)/.test(b), '.action.wide shares the tap inset',
      (b.match(/padding:[^;]*/) || [''])[0]);
    check(!/\.txt/.test(SRC.slice(SRC.indexOf('.action.wide{'), SRC.indexOf('.action.wide{') + 400)),
      '.action.wide does not target a .txt wrapper that actBtn never renders');
  }
  /* Assert the CONDITION, not just the line inside it. The first version of this check only looked
     for the .replace(), so stubbing the guard to if(false) left it passing happily. */
  check(/if\(btns\.length%2===1\)\{[\s\S]{0,160}?class="action wide"/.test(SRC),
    'an odd tile count promotes the last tile to wide');
}
{
  const b = rule('.note-empty{');
  check(!!b, '.note-empty exists');
  if (b) check(!/text-align:center/.test(b),
    '.note-empty is not centred inside a left-aligned card',
    (b.match(/text-align:[^;]*/) || [''])[0]);
}

/* The other tabs. Everything above was found on the home screen; tools/pad_audit.js then walked
   Log, Album, Health and Settings at full height and found six more cards that had all drifted to
   the SAME wrong number. 13/15, 15, 15/16 and 20 are 14/16 measured four more times, which is what
   drift looks like when nobody has named the value. */
[['.tl-item{', 'Log timeline row'], ['.disclaimer{', 'Health disclaimer'],
 ['.add-row{', 'Health add row'], ['.set-item{', 'Settings row'],
 ['.prof-card{', 'Health profile card'], ['.ms-hero{', 'Health milestone hero']].forEach(([sel, what]) => {
  const b = rule(sel);
  check(!!b, sel + ' exists (' + what + ')');
  if (!b) return;
  check(/padding:var\(--pad-card\)/.test(b), sel + ' uses var(--pad-card)',
    (b.match(/padding:[^;]*/) || [''])[0]);
});

/* VERTICAL RHYTHM. The horizontal work said nothing about the space BETWEEN cards, and measuring it
   found six values on home alone: 0, 2, 12, 14, 16, 18. 12, 14, 16 and 18 are not four decisions.
   --stack already existed and almost nothing pointed at it. Home now reads 2, 12, 16, and each one
   means something: 16 between independent blocks, 12 from a heading to the content it labels, 2 for
   a title and its own subtitle. Those last two stay hand-set, like every other sub-10px value. */
{
  const m = SRC.match(/--stack:\s*([^;]+);/);
  check(!!m, 'token --stack is defined');
  if (m) check(m[1].trim() === '16px', '--stack is 16px', m[1].trim());
  const users = (SRC.match(/var\(--stack\)/g) || []).length;
  check(users >= 7, 'the block margins actually point at --stack', users + ' use it');
  [['.tip-static{', 'margin-bottom'], ['.since-row{', 'margin-bottom'],
   ['.ms-hero{', 'margin-bottom'], ['.disclaimer{', 'margin-bottom'],
   ['.day-surface{', 'margin-top'], ['.today-strip{', 'margin-top']].forEach(([sel, prop]) => {
    const b = rule(sel);
    check(!!b && new RegExp(prop + ':var\\(--stack\\)').test(b),
      sel + ' ' + prop + ' uses var(--stack)',
      (b && (b.match(new RegExp(prop + ':[^;]*')) || [''])[0]) || 'rule not found');
  });
  /* The night-theme override sits earlier in the file and matches a naive indexOf('.day-surface{').
     A margin added there would only apply in dark mode, which is how it went in the first time. */
  const nightIdx = SRC.indexOf('[data-theme="night"] .pick-item,[data-theme="night"] .day-surface{');
  if (nightIdx !== -1) {
    check(!/margin/.test(SRC.slice(nightIdx, SRC.indexOf('}', nightIdx))),
      'the night-theme .day-surface override carries no margin (it would be dark-mode only)');
  }
}

const total = passes + fails;
console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + '/' + total + ' checks');
process.exit(fails ? 1 : 0);
