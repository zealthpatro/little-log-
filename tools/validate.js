// Static validation for the marketing site, run in CI (and locally: node tools/validate.js).
// Catches the regressions we've actually hit: broken JSON-LD, a malformed sitemap, and the
// FAQ schema drifting out of lockstep with the visible Q&As.
const fs = require('fs');
let fails = 0;
const fail = m => { console.log('  ✕', m); fails++; };
const ok = m => console.log('  ✓', m);

// 1) Every JSON-LD block on the key pages must parse.
const PAGES = ['index.html', 'why/index.html', 'pregnancy/index.html', 'features/index.html',
  'faq/index.html', 'how-it-works/index.html', 'pricing/index.html'];
console.log('JSON-LD parses:');
for (const p of PAGES) {
  if (!fs.existsSync(p)) continue;
  const h = fs.readFileSync(p, 'utf8');
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let bad = 0;
  for (const b of blocks) { try { JSON.parse(b[1]); } catch (e) { bad++; } }
  bad ? fail(`${p}: ${bad} bad JSON-LD block(s)`) : ok(`${p} (${blocks.length})`);
}

// 2) sitemap.xml: present, well-formed-ish, balanced <url>/<loc>.
console.log('sitemap.xml:');
if (fs.existsSync('sitemap.xml')) {
  const s = fs.readFileSync('sitemap.xml', 'utf8');
  const u1 = (s.match(/<url>/g) || []).length, u2 = (s.match(/<\/url>/g) || []).length;
  const l1 = (s.match(/<loc>/g) || []).length, l2 = (s.match(/<\/loc>/g) || []).length;
  if (!s.includes('<urlset')) fail('no <urlset>');
  else if (u1 !== u2) fail(`unbalanced <url> (${u1}/${u2})`);
  else if (l1 !== l2 || l1 !== u1) fail(`<loc> count off (${l1} loc vs ${u1} url)`);
  else ok(`${u1} urls, balanced`);
} else fail('sitemap.xml missing');

// 3) FAQ schema lockstep: FAQPage Question count must equal the visible <dt> count.
console.log('FAQ schema lockstep:');
if (fs.existsSync('faq/index.html')) {
  const h = fs.readFileSync('faq/index.html', 'utf8');
  const dt = (h.match(/<dt[\s>]/g) || []).length;
  const q = (h.match(/"@type"\s*:\s*"Question"/g) || []).length;
  (dt && q && dt === q) ? ok(`${q} schema = ${dt} visible`)
    : fail(`FAQ schema/visible mismatch: ${q} Question vs ${dt} <dt>`);
} else console.log('  · faq/index.html not found (skip)');

console.log(fails ? `\nVALIDATE: FAIL (${fails}) ❌` : '\nVALIDATE: PASS ✅');
process.exit(fails ? 1 : 0);
