#!/usr/bin/env node
/* What the public pages say about quiet hours matches what the app does (CEO follow-up on #11, 28 Nov 2026).
 *
 * Quiet hours became the parent's own setting in Reminders, and a medicine reminder now comes through during
 * them by default (app/index.html, pushCfg: quietAllow.critical defaults to true). The FAQ still promised
 * "nothing is sent between 21:00 and 7:00", which a dose at 03:00 would make untrue.
 *
 *   1. no public page promises that nothing at all is sent in quiet hours
 *   2. when the app lets medicine through by default, the FAQ quiet-hours answer says so, in BOTH the
 *      visible answer and the FAQPage JSON-LD, and the two say the same thing
 *
 *   node tools/quiet_hours_copy_check.js              check this tree
 *   node tools/quiet_hours_copy_check.js --self-test  stage the old line and a missing medicine clause; each must go red
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// "nothing is sent between", "no notifications between", "nothing will be sent during quiet hours"
const ABSOLUTE = /\b(nothing|no (?:notifications?|reminders?|pushes))\s+(?:is|are|will be|gets?)?\s*(?:sent|send|arrives?)\b[^.<"]{0,40}\b(between|during|in quiet hours|overnight)\b/i;
const MEDICINE = /\bmedicine reminders? still come through\b/i;

function pages() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|\.git|app|tools|test|docs|design|ios|android|workers|art-src)$/.test(e.name)) walk(rel); }
      else if (e.name === 'index.html') out.push(rel);
    }
  };
  walk('.');
  return out;
}

function faqAnswers(html) {
  const dd = (html.match(/<dt>Can I set quiet hours\?<\/dt>\s*<dd>([\s\S]*?)<\/dd>/) || [])[1];
  const ld = (html.match(/"name":"Can I set quiet hours\?","acceptedAnswer":\{"@type":"Answer","text":"((?:[^"\\]|\\.)*)"/) || [])[1];
  return { dd: dd && dd.trim(), ld: ld && ld.trim() };
}

function check(files, faqHtml, appHtml) {
  const errs = [];
  for (const [f, html] of files) { const m = html.match(ABSOLUTE); if (m) errs.push(f + ': promises nothing is sent: "' + m[0] + '"'); }
  const allowsMedicine = /c\.quietAllow=\{critical:true\}/.test(appHtml);
  if (!/quietAllow/.test(appHtml)) errs.push('app/index.html: quietAllow not found (the probe is dead)');
  const a = faqAnswers(faqHtml);
  if (!a.dd || !a.ld) errs.push('faq/index.html: the quiet-hours answer was not found in both the page and the JSON-LD');
  else {
    if (a.dd !== a.ld) errs.push('faq/index.html: the visible answer and the JSON-LD differ');
    if (allowsMedicine && !MEDICINE.test(a.dd)) errs.push('faq/index.html: medicine reminders come through by default, and the answer does not say so');
    if (!allowsMedicine && MEDICINE.test(a.dd)) errs.push('faq/index.html: says medicine comes through, but the app holds it back by default');
  }
  return errs;
}

const files = pages().map((f) => [f, read(f)]);
const faq = read('faq/index.html');
const app = read('app/index.html');

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const expectRed = (label, errs) => { if (errs.length) console.log('  red  ' + label); else { bad++; console.log('  MISSED ' + label); } };
  const OLD = 'Yes. By default nothing is sent between 21:00 and 7:00.';
  const a = faqAnswers(faq);
  const staged = faq.split(a.dd).join(OLD);
  expectRed('the old "nothing is sent between 21:00 and 7:00" line', check([['faq/index.html', staged]], staged, app));
  const noMed = faq.split(a.dd).join('Yes, in Reminders. They run from 21:00 to 7:00 unless you change them.');
  expectRed('an answer that drops the medicine clause', check([['faq/index.html', noMed]], noMed, app));
  const oneSide = faq.replace('<dd>' + a.dd + '</dd>', '<dd>' + a.dd + ' Sleep well.</dd>');
  expectRed('the page and the JSON-LD drifting apart', check([], oneSide, app));
  expectRed('the app holding medicine back while the FAQ says it comes through', check([], faq, app.replace('c.quietAllow={critical:true}', 'c.quietAllow={critical:false}')));
  const clean = check(files, faq, app);
  if (clean.length) { bad++; console.log('  this tree is not clean: ' + clean.join('; ')); }
  console.log(bad ? 'QUIET-HOURS-COPY SELF-TEST: FAIL' : 'QUIET-HOURS-COPY SELF-TEST: PASS, 4 breaks each went red');
  process.exit(bad ? 1 : 0);
}

const errs = check(files, faq, app);
errs.forEach((e) => console.log('  FAIL ' + e));
console.log(errs.length ? 'quiet-hours-copy: FAIL' : 'quiet-hours-copy: PASS, ' + files.length + ' pages, FAQ answer matches the app');
process.exit(errs.length ? 1 : 0);
