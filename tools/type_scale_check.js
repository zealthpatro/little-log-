#!/usr/bin/env node
/* THE TYPE SCALE HAS TO BE ENFORCED OR IT DECAYS.
 *
 * Counted 2026-08-28, before this gate existed: 593 font-size declarations across the app, 35
 * distinct values, and ZERO font-size tokens. Between 10 and 22px there were 17 distinct sizes
 * covering a 12px range, including six half-pixel steps (10.5 11.5 12.5 13.5 14.5 15.5) carrying 53
 * uses between them. Twelve values were used three times or fewer: 3.5% of declarations consuming
 * 34% of the vocabulary. Nobody chose 13.5px. It was the value that happened to be to hand, and that
 * is the whole of what "AI slop" means in a stylesheet.
 *
 * font-weight, by contrast, was already a real scale: 600/700/800 carried 98.3% of 423 declarations
 * with seven stragglers. The team can hold a scale when there is one to hold. There was not one for
 * size, so this file is the one.
 *
 * Every design rule in this repo without a blocking check has a half-life of about eight weeks; the
 * gate runner says so in its own header. So this does not report, it FAILS.
 *
 *   node tools/type_scale_check.js
 *   node tools/type_scale_check.js --report    (print the spread, exit 0, for when you are working)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const REPORT = process.argv.includes('--report');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };

const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const MAIN = styleBlocks[0] || '';

/* The scale itself. Read from :root rather than duplicated here, so this file can never disagree
   with the stylesheet about what the scale IS. A gate that keeps its own copy of the thing it
   checks is one edit away from asserting a world that no longer exists. */
const declared = [...MAIN.matchAll(/(--fs-[a-z]+):\s*([0-9.]+)px/g)].map((m) => ({ name: m[1], px: parseFloat(m[2]) }));

console.log('\n1. the scale exists and is a scale');
ok('a type scale is declared in :root', declared.length >= 8, declared.length + ' steps');
ok('every step is a whole pixel, because half-pixels are the signature of a value nobody chose',
  declared.every((d) => Number.isInteger(d.px)), declared.filter((d) => !Number.isInteger(d.px)));
ok('steps are unique, so two roles cannot silently be the same size',
  new Set(declared.map((d) => d.px)).size === declared.length,
  declared.map((d) => d.name + ':' + d.px));
const sorted = [...declared].sort((a, b) => a.px - b.px);
ok('steps ascend with no duplicate neighbours', sorted.every((d, i) => i === 0 || d.px > sorted[i - 1].px), sorted.map((d) => d.px));
/* 16px is not a taste call. Mobile Safari zooms the whole page when a font-size under 16px takes
   focus, which on a one-handed logging app throws the layout every time she taps a field. */
ok('the scale carries a 16px step, the floor an input needs so iOS does not zoom on focus',
  declared.some((d) => d.px === 16), sorted.map((d) => d.px));

console.log('\n2. the main stylesheet uses the scale and nothing else');
const litsMain = [...MAIN.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => m[1]);
ok('no font-size literal survives in the app stylesheet', litsMain.length === 0,
  litsMain.length + ' left: ' + [...new Set(litsMain)].join(', '));
const varUses = [...MAIN.matchAll(/font-size:\s*var\((--fs-[a-z]+)\)/g)].map((m) => m[1]);
ok('and it really is using the tokens, so the line above is not passing on an empty file', varUses.length > 100, varUses.length + ' token uses');
const known = new Set(declared.map((d) => d.name));
const unknown = [...new Set(varUses)].filter((v) => !known.has(v));
ok('every token it uses is one the scale actually declares', unknown.length === 0, unknown);

console.log('\n3. the rest of the app is held to a ceiling, not to perfection');
/* Inline style="" and the JS-injected stylesheets carry 2,001 declarations between them and cannot
   be migrated in one pass without a visual regression on every surface at once. So they get a
   RATCHET instead of a rule: the count may fall and may not rise. That is the only kind of budget
   that survives contact with a large file. */
const jsFiles = fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js'));
let outside = [];
const collect = (txt, where) => {
  [...txt.matchAll(/font-size:\s*([0-9.]+)px/g)].forEach((m) => outside.push({ px: m[1], where }));
};
styleBlocks.slice(1).forEach((b, i) => collect(b, 'index.html <style> #' + (i + 2)));
collect(html.replace(MAIN, ''), 'index.html inline+JS');
jsFiles.forEach((f) => collect(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), 'app/' + f));

/* 374 is not a target, it is today's true count, measured 2026-08-28. A ratchet has to START at the
   real number or it fails on the first run and gets deleted. Lower it as inline styles and the
   JS-injected stylesheets migrate onto the tokens; never raise it to make a run go green. */
const CEILING = Number(process.env.TYPE_CEILING || 374);
const distinct = [...new Set(outside.map((o) => o.px))].sort((a, b) => a - b);
ok('the ratchet holds: literals outside the stylesheet have not grown', outside.length <= CEILING,
  outside.length + ' literals, ceiling ' + CEILING + '. Lower the ceiling when you migrate some; never raise it.');
const halves = outside.filter((o) => !Number.isInteger(parseFloat(o.px)));
/* Same ratchet, same reason: 29 half-pixel literals survive outside the stylesheet today. Inside it
     there are now zero, which is the half that could be fixed without a visual regression pass. */
  ok('and no NEW half-pixel size has appeared anywhere', halves.length <= 29,
  halves.length + ' half-pixel literals: ' + [...new Set(halves.map((h) => h.px))].join(', '));

if (REPORT) {
  console.log('\nscale:', sorted.map((d) => d.name.replace('--fs-', '') + ' ' + d.px).join(' · '));
  console.log('outside the stylesheet: ' + outside.length + ' literals, ' + distinct.length + ' distinct');
  const byWhere = {};
  outside.forEach((o) => { byWhere[o.where] = (byWhere[o.where] || 0) + 1; });
  Object.entries(byWhere).sort((a, b) => b[1] - a[1]).forEach(([w, n]) => console.log('  ' + String(n).padStart(4) + '  ' + w));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'TYPE-SCALE: FAIL' : 'TYPE-SCALE: PASS');
process.exit(REPORT ? 0 : (fail ? 1 : 0));
