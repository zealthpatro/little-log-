#!/usr/bin/env node
/* Health copy guard: three things a worried parent must never read on a served page.
 *
 *   node tools/health_copy_check.js               judge this checkout
 *   node tools/health_copy_check.js --self-test   first stage every way it can go red in a temp tree
 *   node tools/health_copy_check.js --root=<dir>  judge another tree (served-file rules from ITS .assetsignore)
 *
 * WHY (26 Nov 2026). A review branch pasted reviewer notes ("CONFIRMED. Replace with: ...", "I grepped",
 * "the proposer") into eight paragraphs of the fever-under-3-months page, and a postnatal depression page
 * written for mothers in Japan opened with an urgent box of Australian, US and UK numbers. The only gate
 * near either matched hrefs, and these were plain text. Three checks:
 *
 *   a. leaked review notes: no served HTML page carries a reviewer marker in its visible text or its
 *      JSON-LD. Markers are case-sensitive whole tokens (MARKERS below), so "confirmed" in a sentence a
 *      parent reads ("your midwife confirmed") is not one; "CONFIRMED" in capitals is.
 *   b. wrong-country crisis numbers: a page whose slug or title names a country must not label a line
 *      for ANOTHER country inside an urgent or crisis block. A block is an element whose class says
 *      urgent or crisis, or a <p> or <li> whose own text is about a crisis (CRISIS below). A label is a
 *      country in brackets, as these pages write them: "Samaritans (UK)", "PANDA (Australia)".
 *      Honest limits: a number written with no bracketed country ("call 116 123") is not seen, a nested
 *      <div> inside an urgent box ends the box early, and a page with no country in its slug or title is
 *      not judged. It catches the shape that shipped, not every shape there could be.
 *   c. FAQ lockstep on the pages listed in LOCKSTEP: every FAQPage JSON-LD question has a visible <h3>
 *      twin and the same answer in the <p> after it, after entities and whitespace are normalised, and
 *      every <h3> in the visible FAQ section is in the JSON-LD. Search engines show the JSON-LD copy;
 *      the health fixes of 26 Nov 2026 found it saying "a 10-second pause is normal" after the page did not.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DEFAULT = path.join(__dirname, '..');

const MARKERS = [
  ['CONFIRMED', /(^|[^A-Za-z])CONFIRMED(?![A-Za-z])/],
  ['[CONFIRMED', /\[CONFIRMED/],
  ['Replace with:', /Replace with:/],
  ['I verified', /\bI verified\b/],
  ['I grepped', /\bI grepped\b/],
  ['I fetched', /\bI fetched\b/],
  ['the proposer', /\b[Tt]he proposer\b/],
  ['DISCLAIMER CHECK', /DISCLAIMER CHECK/],
  ['Fix all three copies', /Fix all three copies/],
  ['ADDED BY ME', /ADDED BY ME/],
];

/* Slug token or title word -> the labels that count as "this country". */
const COUNTRIES = {
  japan: ['Japan'], uae: ['UAE', 'United Arab Emirates', 'Dubai', 'Abu Dhabi'], germany: ['Germany'], italy: ['Italy'],
  us: ['US', 'USA', 'United States'], usa: ['US', 'USA', 'United States'],
  uk: ['UK', 'United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  australia: ['Australia'], australian: ['Australia'], india: ['India'], indian: ['India'], china: ['China'],
  canada: ['Canada'], ireland: ['Ireland'], france: ['France'], spain: ['Spain'],
};
const ALL_LABELS = [...new Set(Object.values(COUNTRIES).flat())].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LABEL = new RegExp('\\((' + ALL_LABELS.map(esc).join('|') + ')\\b[^)]*\\)', 'g');
const CRISIS = /crisis|urgent|reach out now|harm(ing)? yourself|suicid|helpline|hotline|emergenc|in danger/i;

/* Pages whose FAQ was rewritten for health accuracy on 26 Nov 2026. Add a page here when you fix its FAQ. */
const LOCKSTEP = [
  'aap-safe-sleep-guidelines', 'cubby-medicine-log', 'postpartum-depression-japan', 'baby-breathing-normal',
  'when-to-call-ambulance-baby', 'postnatal-psychosis-signs-and-emergency-response', 'head-injury-babies',
  'febrile-seizures-babies',
].map((s) => 'articles/' + s + '/index.html');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·', rsaquo: '›' };
function unent(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
}
const text = (h) => unent(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/* Served = every .html file the deploy would upload: .assetsignore names a path, a top-level name or a *.ext. */
function servedHtml(root) {
  let rules = [];
  try { rules = fs.readFileSync(path.join(root, '.assetsignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch (e) { rules = []; }
  const ignored = (rel) => rules.some((r) => {
    if (r.startsWith('*.')) return rel.endsWith(r.slice(1));
    return rel === r || rel.startsWith(r + '/') || rel.split('/').includes(r) && !r.includes('/');
  });
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name), rel = path.relative(root, abs).split(path.sep).join('/');
      if (ignored(rel) || ent.name === 'node_modules' || ent.name === '.git') continue;
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith('.html')) out.push(rel);
    }
  })(root);
  return out.sort();
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
function strings(v, acc) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, acc));
  return acc;
}
function visibleText(html) {
  return text(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' '));
}

function checkMarkers(rel, html, fails) {
  const zones = [['visible text', visibleText(html)]];
  for (const raw of jsonLd(html)) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { fails.push(`${rel}: JSON-LD does not parse (${e.message})`); continue; }
    zones.push(['JSON-LD', strings(parsed, []).join(' \n ')]);
  }
  for (const [zone, t] of zones) {
    for (const [name, re] of MARKERS) {
      const m = re.exec(t);
      if (m) fails.push(`${rel}: reviewer marker "${name}" in ${zone}: "${t.slice(Math.max(0, m.index - 40), m.index + 60).trim()}"`);
    }
  }
}

function homeCountry(rel, html) {
  const home = new Set();
  const slug = rel.split('/').slice(-2, -1)[0] || '';
  for (const tok of slug.toLowerCase().split('-')) if (COUNTRIES[tok]) COUNTRIES[tok].forEach((l) => home.add(l));
  const t = /<title>([\s\S]*?)<\/title>/.exec(html);
  const title = t ? unent(t[1]).split('|')[0] : '';
  for (const l of ALL_LABELS) {
    if (new RegExp('\\b' + esc(l) + '\\b').test(title)) for (const v of Object.values(COUNTRIES)) if (v.includes(l)) v.forEach((x) => home.add(x));
  }
  return home;
}

function checkCountry(rel, html, fails) {
  const home = homeCountry(rel, html);
  if (!home.size) return;
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const blocks = [];
  let m;
  const box = /<(div|aside|section)\b[^>]*class="[^"]*(?:urgent|crisis)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = box.exec(body))) blocks.push(['urgent box', text(m[2]), true]);
  const para = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = para.exec(body))) blocks.push(['crisis line', text(m[2]), false]);
  const seen = new Set();
  for (const [kind, t, isBox] of blocks) {
    if (!isBox && !CRISIS.test(t)) continue;
    LABEL.lastIndex = 0;
    let l;
    while ((l = LABEL.exec(t))) {
      if (home.has(l[1])) continue;
      const key = l[0] + '|' + t.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      fails.push(`${rel}: page is for ${[...home][0]}, but a ${kind} lists a line labelled ${l[0]}: "${t.slice(0, 120)}"`);
    }
  }
}

function checkLockstep(rel, html, fails) {
  let faq = null;
  for (const raw of jsonLd(html)) {
    try { const d = JSON.parse(raw); if (d && d['@type'] === 'FAQPage') faq = d; } catch (e) { fails.push(`${rel}: JSON-LD does not parse`); }
  }
  if (!faq) { fails.push(`${rel}: no FAQPage JSON-LD to hold in lockstep`); return; }
  const body = html.split('</head>')[1] || '';
  const vis = new Map();
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(body))) vis.set(text(m[1]), text(m[2]));
  /* The visible FAQ section: from the "Frequently asked questions" heading to the next <h2> or block. */
  const sec = /<h2[^>]*>\s*Frequently asked questions\s*<\/h2>([\s\S]*?)(?=<h2|<div|<section|<footer|<\/main)/i.exec(body);
  const secQs = sec ? [...sec[1].matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((x) => text(x[1])) : [];
  const ldQs = new Set();
  for (const q of faq.mainEntity || []) {
    const name = text(String(q.name || '')), ans = text(String((q.acceptedAnswer || {}).text || ''));
    ldQs.add(name);
    if (!vis.has(name)) fails.push(`${rel}: FAQ JSON-LD question has no visible twin: "${name}"`);
    else if (vis.get(name) !== ans) fails.push(`${rel}: FAQ answer differs between the page and its JSON-LD: "${name}"`);
  }
  for (const q of secQs) if (!ldQs.has(q)) fails.push(`${rel}: visible FAQ question missing from the JSON-LD: "${q}"`);
}

function judge(root, lockstep) {
  const fails = [];
  const files = servedHtml(root);
  for (const rel of files) {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    checkMarkers(rel, html, fails);
    checkCountry(rel, html, fails);
  }
  for (const rel of lockstep) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { fails.push(`${rel}: listed in LOCKSTEP but missing`); continue; }
    checkLockstep(rel, fs.readFileSync(abs, 'utf8'), fails);
  }
  return { files: files.length, fails };
}

/* ---------------------------------------------------------------- self-test */
function page(title, body, ld) {
  return `<!DOCTYPE html><html lang="en"><head><title>${title} | Cubby</title>` +
    (ld ? `<script type="application/ld+json">${ld}</script>` : '') + `</head><body><main>${body}</main></body></html>`;
}
const faqLd = (pairs) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: pairs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const OLD_JAPAN_BOX = `<div class="callout callout-urgent"><strong>If you are having thoughts of harming yourself or your baby, please reach out now.</strong><ul>
  <li><strong>PANDA (Australia):</strong> 1300 726 306 (Mon to Sat, 9am to 7:30pm AEST)</li>
  <li><strong>Lifeline (Australia):</strong> 13 11 14 (24/7)</li>
  <li><strong>Crisis Text Line (USA):</strong> Text HOME to 741741</li>
  <li><strong>Samaritans (UK):</strong> 116 123 (24/7, free)</li>
  <li><strong>Emergency services:</strong> Call your local emergency number</li></ul></div>`;
const NEW_JAPAN_BOX = `<div class="callout callout-urgent"><strong>If you are having thoughts of harming yourself or your baby, please reach out now.</strong><ul>
  <li><strong>Emergency in Japan:</strong> call 119 for an ambulance</li>
  <li><strong>TELL Lifeline, in English:</strong> 0800-300-8355, free</li>
  <li><strong>Yorisoi Hotline:</strong> 0120-279-338, free and open 24 hours. Press 2 for English and other languages.</li>
  <li><strong>Outside Japan:</strong> call your local emergency number</li></ul></div>`;

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-copy-'));
  let bad = 0;
  const expect = (label, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + label); if (!cond) bad++; };
  const stage = (files) => {
    fs.rmSync(path.join(tmp, 't'), { recursive: true, force: true });
    for (const [rel, html] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, 't', rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, 't', rel), html);
    }
    return path.join(tmp, 't');
  };
  try {
    const clean = page('A calm page', '<p>Your midwife confirmed it. Call 999 if your baby stops breathing.</p>');
    let r = judge(stage({ 'articles/clean/index.html': clean, '.assetsignore': 'articles-drafts\n' }), []);
    expect('a clean page passes (lower-case "confirmed" is copy, not a marker)', r.fails.length === 0);

    const samples = {
      'CONFIRMED': 'CONFIRMED, and this is the most serious defect on the page.',
      '[CONFIRMED': '[CONFIRMED, and ADDED BY ME.',
      'Replace with:': 'Replace with: "Use an armpit thermometer".',
      'I verified': 'Evidence I verified myself.',
      'I grepped': 'I grepped the whole file.',
      'I fetched': 'I fetched the WHO fact sheet.',
      'the proposer': 'Against the proposer, one precision.',
      'DISCLAIMER CHECK': 'DISCLAIMER CHECK, not an error.',
      'Fix all three copies': '(Fix all three copies: this sentence and the FAQ.)',
      'ADDED BY ME': 'ADDED BY ME, the proposer missed it.',
    };
    for (const name of MARKERS.map((x) => x[0])) {
      r = judge(stage({ 'articles/leak/index.html': page('Leak', `<p>${samples[name]}</p>`) }), []);
      expect(`visible marker "${name}" goes red`, r.fails.some((f) => f.includes(`marker "${name}" in visible text`)));
      r = judge(stage({ 'articles/leak/index.html': page('Leak', '<p>Plain copy.</p>', faqLd([['Q?', samples[name]]])) }), []);
      expect(`JSON-LD marker "${name}" goes red`, r.fails.some((f) => f.includes(`marker "${name}" in JSON-LD`)));
    }
    r = judge(stage({ 'articles/leak/index.html': page('Leak', '<p>Fine.</p><!-- CONFIRMED in a comment --><script>var CONFIRMED=1</script>') }), []);
    expect('a marker in an HTML comment or a plain script is not served copy', r.fails.length === 0);
    r = judge(stage({ 'articles-drafts/leak/index.html': page('Leak', '<p>CONFIRMED.</p>'), '.assetsignore': 'articles-drafts\n' }), []);
    expect('an .assetsignore\'d draft is not judged', r.fails.length === 0);
    r = judge(stage({ 'articles/leak/index.html': page('Leak', '<p>x</p>', '{"broken": ') }), []);
    expect('JSON-LD that does not parse goes red', r.fails.some((f) => f.includes('does not parse')));

    r = judge(stage({ 'articles/postpartum-depression-japan/index.html': page('Postnatal depression', OLD_JAPAN_BOX) }), []);
    for (const lab of ['(Australia)', '(USA)', '(UK)']) expect(`Japan page urgent box labelled ${lab} goes red`, r.fails.some((f) => f.includes('labelled ' + lab)));
    r = judge(stage({ 'articles/postpartum-depression-japan/index.html': page('Postnatal depression', NEW_JAPAN_BOX) }), []);
    expect('Japan page with Japanese lines passes', r.fails.length === 0);
    r = judge(stage({ 'articles/postpartum-depression-germany/index.html': page('PND', '<p>In a crisis, contact Samaritans on 116 123 (UK).</p>') }), []);
    expect('a crisis sentence on a Germany page naming a (UK) line goes red', r.fails.some((f) => f.includes('labelled (UK)')));
    r = judge(stage({ 'articles/child-benefit-uk/index.html': page('Child benefit', '<p>In a crisis, contact Samaritans on 116 123 (UK).</p>') }), []);
    expect('the same sentence on a UK page passes', r.fails.length === 0);
    r = judge(stage({ 'articles/postpartum-depression-germany/index.html': page('PND', '<p>PANDA (Australia) runs peer groups.</p>') }), []);
    expect('a foreign label outside any crisis block is not judged', r.fails.length === 0);
    r = judge(stage({ 'articles/mum-guilt/index.html': page('Mum guilt', '<p>In a crisis, contact Samaritans on 116 123 (UK).</p>') }), []);
    expect('a page with no country in slug or title is not judged', r.fails.length === 0);

    const Q = [['Is it normal?', 'Yes. Call 999 if A&E is closer.'], ['When?', 'Now.']];
    const faqBody = (pairs) => '<h2>Frequently asked questions</h2>' + pairs.map(([q, a]) => `<h3>${q}</h3>\n  <p>${a}</p>`).join('\n') + '<div class="cta"><h3>Start</h3><p>x</p></div>';
    const vis = [['Is it normal?', 'Yes. Call 999 if A&amp;E   is closer.'], ['When?', 'Now.']];
    r = judge(stage({ 'articles/f/index.html': page('F', faqBody(vis), faqLd(Q)) }), ['articles/f/index.html']);
    expect('FAQ in lockstep passes (entities and whitespace normalised)', r.fails.length === 0);
    r = judge(stage({ 'articles/f/index.html': page('F', faqBody(vis), faqLd([[Q[0][0], 'Yes. A pause of up to 10 seconds is normal.'], Q[1]])) }), ['articles/f/index.html']);
    expect('a JSON-LD answer that differs from the page goes red', r.fails.some((f) => f.includes('answer differs')));
    r = judge(stage({ 'articles/f/index.html': page('F', faqBody(vis), faqLd([...Q, ['Hidden?', 'Only in schema.']])) }), ['articles/f/index.html']);
    expect('a JSON-LD question with no visible twin goes red', r.fails.some((f) => f.includes('no visible twin')));
    r = judge(stage({ 'articles/f/index.html': page('F', faqBody([...vis, ['Visible only?', 'Yes.']]), faqLd(Q)) }), ['articles/f/index.html']);
    expect('a visible FAQ question missing from the JSON-LD goes red', r.fails.some((f) => f.includes('missing from the JSON-LD')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return bad;
}

let failed = 0;
if (process.argv.includes('--self-test')) {
  console.log('health-copy self-test');
  failed += selfTest();
  if (failed) console.log(`self-test: ${failed} expectation(s) did not hold`);
}
const rootArg = (process.argv.find((a) => a.startsWith('--root=')) || '').slice(7);
const root = rootArg ? path.resolve(rootArg) : ROOT_DEFAULT;
const { files, fails } = judge(root, rootArg ? LOCKSTEP.filter((r) => fs.existsSync(path.join(root, r))) : LOCKSTEP);
for (const f of fails) console.log('FAIL ' + f);
console.log(`health-copy: ${files} served pages, ${LOCKSTEP.length} FAQ pages held in lockstep, ${fails.length} failure(s)`);
process.exit(failed || fails.length ? 1 : 0);
