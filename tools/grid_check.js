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

const total = passes + fails;
console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + '/' + total + ' checks');
process.exit(fails ? 1 : 0);
