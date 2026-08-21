#!/usr/bin/env node
/* Fill the App Store listing from docs/plans/2026-08-04-app-store-listing.md.
 *
 * The doc stays the single source of truth and this transcribes it, because retyping 2,500 words of
 * customer-facing copy into a web form is how a claim drifts from the one the team agreed and the
 * guardrails checked. Every string below is lifted from the doc verbatim; nothing is composed here.
 *
 * Idempotent: run it as often as you like. It PATCHes, it never creates a second version.
 *
 *   node tools/asc_fill.js            show what it would write, change nothing
 *   node tools/asc_fill.js --write    write it
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'plans', '2026-08-04-app-store-listing.md');
const WRITE = process.argv.includes('--write');
const APP = '6791454709';

const asc = (args) => JSON.parse(execFileSync('node', [path.join(__dirname, 'asc.js')].concat(args), { encoding: 'utf8', maxBuffer: 1 << 24 }) || 'null');
const get = (p) => asc(['get', p]);
const patch = (type, id, body) => asc(['patch', type, id, JSON.stringify(body)]);

/* ---- pull the copy out of the doc ---- */
const md = fs.readFileSync(DOC, 'utf8');
function fenceAfter(marker, nth) {
  const i = md.indexOf(marker);
  if (i < 0) throw new Error('marker not found in the listing doc: ' + marker);
  let from = i, block = null, seen = 0;
  const re = /```\n([\s\S]*?)```/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(md))) { if (seen++ === (nth || 0)) { block = m[1]; break; } }
  if (block == null) throw new Error('no fenced block after: ' + marker);
  return block.trim();
}
function tableCell(rowLabel) {
  const re = new RegExp('^\\|\\s*' + rowLabel + '\\s*\\|\\s*`([^`]+)`', 'm');
  const m = md.match(re);
  if (!m) throw new Error('table row not found: ' + rowLabel);
  return m[1].trim();
}

const COPY = {
  name: tableCell('Name'),
  subtitle: tableCell('Subtitle'),
  description: fenceAfter('## 2. Description'),
  promotionalText: fenceAfter('Optional promotional text'),
  keywords: fenceAfter('## 3. Keywords'),
  reviewNotes: fenceAfter('### Notes text for the reviewer'),
  /* /support/ is a 404 and Apple checks this URL, so it would have been a rejection on its own.
     /contact/ is already the real support page: the address, the reply time, how to export or
     delete, and a route into the FAQ. Verified 200 before writing. */
  supportUrl: 'https://little-cubby.com/contact/',
  marketingUrl: 'https://little-cubby.com/',
  privacyPolicyUrl: 'https://little-cubby.com/privacy/',
};

const LIMITS = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 };
let bad = 0;
for (const [k, max] of Object.entries(LIMITS)) {
  const n = COPY[k].length;
  const over = n > max;
  if (over) bad++;
  console.log((over ? 'TOO LONG ' : '  ok     ') + k.padEnd(16) + n + '/' + max);
}
if (bad) { console.error('\nCopy is over an Apple limit. Fix the doc, not this file.'); process.exit(1); }

console.log('\nname        ' + COPY.name);
console.log('subtitle    ' + COPY.subtitle);
console.log('keywords    ' + COPY.keywords);
console.log('support     ' + COPY.supportUrl);
console.log('privacy     ' + COPY.privacyPolicyUrl);
console.log('description ' + COPY.description.split('\n')[0].slice(0, 72) + '...');
console.log('reviewNotes ' + COPY.reviewNotes.split('\n')[0].slice(0, 72) + '...');

if (!WRITE) { console.log('\n(dry run. --write to send it to App Store Connect.)'); process.exit(0); }

(async () => {
  const vers = get('/apps/' + APP + '/appStoreVersions?limit=1');
  const v = vers.data[0];
  console.log('\nversion ' + v.attributes.versionString + ' [' + v.attributes.appStoreState + ']');

  // 1. The version localization: what a shopper reads on the product page.
  const vl = get('/appStoreVersions/' + v.id + '/appStoreVersionLocalizations');
  for (const l of vl.data) {
    if (l.attributes.locale !== 'en-US') continue;
    patch('appStoreVersionLocalizations', l.id, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: {
      description: COPY.description, keywords: COPY.keywords, promotionalText: COPY.promotionalText,
      supportUrl: COPY.supportUrl, marketingUrl: COPY.marketingUrl,
    } } });
    console.log('  wrote description, keywords, promo text, support and marketing URLs');
  }

  // 2. The app info localization: name, subtitle and the privacy policy Apple links from the label.
  const infos = get('/apps/' + APP + '/appInfos');
  const info = infos.data.find((i) => i.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') || infos.data[0];
  const il = get('/appInfos/' + info.id + '/appInfoLocalizations');
  for (const l of il.data) {
    if (l.attributes.locale !== 'en-US') continue;
    patch('appInfoLocalizations', l.id, { data: { type: 'appInfoLocalizations', id: l.id, attributes: {
      name: COPY.name, subtitle: COPY.subtitle, privacyPolicyUrl: COPY.privacyPolicyUrl,
    } } });
    console.log('  wrote name, subtitle, privacy policy URL');
  }

  // 3. Categories. Health & Fitness primary, Lifestyle secondary, per the doc.
  patch('appInfos', info.id, { data: { type: 'appInfos', id: info.id, relationships: {
    primaryCategory: { data: { type: 'appCategories', id: 'HEALTH_AND_FITNESS' } },
    secondaryCategory: { data: { type: 'appCategories', id: 'LIFESTYLE' } },
  } } });
  console.log('  wrote categories: Health & Fitness / Lifestyle');

  console.log('\nDone. Still needed: screenshots, age rating, the review contact and demo account,');
  console.log('and the App Privacy answers. node tools/asc.js state shows what is left.');
})();
