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

// Pull one rule's body by selector.
function rule(sel) {
  const i = SRC.indexOf(sel);
  if (i === -1) return null;
  return SRC.slice(i, SRC.indexOf('}', i));
}

console.log('card grid');

// The tokens have to exist before anything can point at them.
['--gutter', '--stack', '--pad-card', '--pad-dense', '--r-card', '--r-dense'].forEach(t => {
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
  check(!!b && /border-radius:var\(--r-dense\)/.test(b), '.alert-pill uses var(--r-dense)');
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
  check(!!b && /border-radius:var\(--r-dense\)/.test(b),
    '.tip-static shares the dense radius with .alert-pill');
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
   Four tokens still resolve to 16px (--radius, --radius-sm, --r-card, --r-dense). They are not
   consolidated on purpose: renaming 35 selectors to save three aliases is churn with a real chance
   of missing one, and this check makes the value single-sourced regardless. */
{
  const tokens = ['--radius', '--radius-sm', '--r-card', '--r-dense'];
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
  check(!!b && /border-radius:var\(--radius\)/.test(b), '.disclaimer uses the shared radius');
}

const total = passes + fails;
console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + '/' + total + ' checks');
process.exit(fails ? 1 : 0);
