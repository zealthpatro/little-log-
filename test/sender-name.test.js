/* The name a sender typed for herself never reads as a second address or as Cubby's own words.
 *
 * WHY. An email invite's "From" row leads with the address the rules proved (fromEmail), and the name
 * the sender typed sits beside it in brackets. senderName (app/store-firebase.js) already dropped a
 * name with an @ in it, but the round-5 review (VJ-2) got look-alikes past it: a full-width @
 * (U+FF20), a small @ (U+FE6B), "midwife (at) nhs.test", "Cubby.Verified family", and a name that
 * closes its own brackets, "x) Verified by Cubby (y". The proven address still led, so it was never a
 * forged sender, but it was a phishing-shaped line on a sheet that asks whether to join a family.
 *
 * This lifts the real senderName out of app/store-firebase.js and runs it in a vm.
 *
 *   node test/sender-name.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
const m = SRC.match(/\n  function senderName\(s\) \{[\s\S]*?\n  \}\n/);
if (!m) { console.log('  FAIL senderName is not in app/store-firebase.js where this test looks for it'); console.log('SENDER-NAME: FAIL'); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + '\nthis.senderName = senderName;', ctx);
const name = (s) => ctx.senderName(s);

console.log('\nwhat a sender may show as her own name\n');
console.log('dropped: anything that reads as an address');
for (const [label, s] of [
  ['a plain address', 'midwife@nhs.test'],
  ['a full-width @ (U+FF20)', 'midwife＠nhs.test'],
  ['a small @ (U+FE6B)', 'midwife﹫nhs.test'],
  ['an @ hidden behind a zero-width space', 'midwife​@nhs.test'],
  ['"(at)" spelled out', 'midwife (at) nhs.test'],
  ['"[at]" spelled out', 'midwife [at] nhs'],
  ['a domain with no @', 'nhs.test'],
  ['a run-together "Cubby.Verified family"', 'Cubby.Verified family'],
  ['a full-width full stop (U+FF0E) between words', 'Cubby．Verified family'],
  ['a path', 'cubby/verified'],
]) ok(label + ': no name', name(s) === '', name(s));

console.log('\ncut: a name never runs on into a claim of its own');
const br = name('x) Verified by Cubby (y');
ok('it cannot close its own brackets', !/[()]/.test(br), br);
const bidi = name('Mum‮ ylimaf deifireV');
ok('invisible direction marks are gone', !/[‪-‮⁦-⁩]/.test(bidi), bidi);
ok('an ideographic full stop (U+3002) ends it', name('Cubby。 Verified family') === 'Cubby', name('Cubby。 Verified family'));
ok('a sentence is cut at its first break', name('Cubby. Verified family') === 'Cubby', name('Cubby. Verified family'));
ok('and it is never longer than 30 characters', name('A'.repeat(80)).length === 30, name('A'.repeat(80)).length);

console.log('\nkept: the names real people type');
for (const [s, want] of [['Olive', 'Olive'], ['Mary-Jo', 'Mary-Jo'], ['Anne Marie O’Neill', 'Anne Marie O’Neill'], ['Priyanka', 'Priyanka'], ['हिन्दी', 'हिन्दी'], ['漢字', '漢字'], ['  Olive   B  ', 'Olive B']]) {
  ok(JSON.stringify(s) + ' stays ' + JSON.stringify(want), name(s) === want, name(s));
}
ok('an empty name stays empty', name('') === '' && name(null) === '', [name(''), name(null)]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'SENDER-NAME: FAIL' : 'SENDER-NAME: PASS');
process.exit(fail ? 1 : 0);
