#!/usr/bin/env node
/* Health caution guard: every health article tells a parent, under its title, to check with their own
 * doctor, and names the official sources it is limited to (docs/HEALTH-COPY-RULES.md).
 *
 *   node tools/health_caution_check.js               judge this checkout
 *   node tools/health_caution_check.js --self-test   first stage every way it can go red in a temp tree
 *   node tools/health_caution_check.js --apply       write the caution / general line into every article
 *   node tools/health_caution_check.js --write-doc   regenerate docs/health-caution-scope.md
 *   --root=<dir>                                     any of the above against another tree
 *
 * WHY (27 Nov 2026). The founder: only say what the sources say, with their limits, and always say that
 * medical advice comes from a local doctor, never from what you read online. 90 of 660 articles carried a
 * bottom disclaimer in eight different wordings; the rest carried none, and 269 health pages named no
 * official source a parent could open. What it checks, per articles/<slug>/index.html:
 *
 *   MEDICAL (every article NOT listed in nonMedical of tools/health_caution_scope.json, so a new article
 *   is MEDICAL until someone decides otherwise):
 *     a. exactly one <div class="art-caution" role="note"> whose text is CAUTION, word for word;
 *     b. placed right under the title: between </h1> and it there is nothing but the p.art-meta line,
 *        so it comes before the first body paragraph, heading, image or urgent box;
 *     c. every bottom p.art-disclaimer (or the older p.art-disc) says CAUTION too;
 *     d. a sources list (footer.src, footer.art-footer, or the section under a heading that says
 *        sources, references or further reading) links at least one OFFICIAL host. A body link alone
 *        does not count. Pages in sourcesGap are the known debt of 27 Nov 2026: they are let through,
 *        the list may only shrink (a listed page that now has a source goes red until it is removed).
 *        F2: sourcesGapPin in the scope file pins its count and a hash of the sorted list, and GAP_CEILING
 *        here caps it, so adding a slug is red and removing one means re-pinning.
 *   NON-MEDICAL: a p.art-disclaimer with GENERAL, word for word, and no other disclaimer wording.
 *   PRODUCT (listed in product): a pure Cubby product page with no health guidance carries neither line,
 *   no caution block and no bottom disclaimer.
 *   Scope: every listed slug exists, nothing is both non-medical and in the gap, and
 *   docs/health-caution-scope.md is exactly what --write-doc would write.
 *   Honest limits: it proves the words and a link exist, not that the page says only what the linked
 *   page says. That is a reading job (docs/HEALTH-COPY-RULES.md); this gate keeps the floor.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DEFAULT = path.join(__dirname, '..');
const SCOPE_REL = 'tools/health_caution_scope.json';
const DOC_REL = 'docs/health-caution-scope.md';

/* Emergency line first, and no "your baby", so the same words fit loss, fertility and pregnancy pages
   (root decision, 27 Nov 2026). */
const CAUTION = 'In an emergency, call your local emergency number straight away. ' +
  'For anything else, please check with your own doctor before acting on health information, including what you read here. ' +
  'Information online can never replace a doctor who knows you.';
const GENERAL = 'This is general information. Rules change, so check with the official body for your country.';
const CAUTION_HTML = `<div class="art-caution" role="note">${CAUTION}</div>`;

/* Official hosts: the national health services and health authorities, the WHO, and the clinical
   colleges whose guidelines those services adopt (the AAP was named by the founder; RCOG, ACOG, RCPCH
   and RANZCOG are its equals). A hostname matches when it is the entry or ends in "." + the entry.
   Research indexes (PubMed) and charities are good reading but are not an official source. */
const OFFICIAL = [
  'nhs.uk', 'nhs.scot', 'nhsinform.scot', 'nhs.wales', 'nice.org.uk', 'gov.uk',
  'aap.org', 'healthychildren.org', 'who.int', 'cdc.gov', 'nih.gov', 'fda.gov', 'hhs.gov',
  'gov.ae', 'u.ae', 'mhlw.go.jp', 'cfa.go.jp',
  'health.gov.au', 'healthdirect.gov.au', 'pregnancybirthbaby.org.au', 'tga.gov.au', 'foodstandards.gov.au', 'aihw.gov.au',
  'rki.de', 'bzga.de', 'kindergesundheit-info.de', 'familienplanung.de', 'g-ba.de', 'bundesgesundheitsministerium.de',
  'salute.gov.it', 'iss.it', 'mohfw.gov.in', 'nhm.gov.in', 'nhc.gov.cn', 'hse.ie', 'canada.ca',
  'efsa.europa.eu', 'ecdc.europa.eu',
  'rcog.org.uk', 'acog.org', 'rcpch.ac.uk', 'ranzcog.edu.au',
];
const NOT_OFFICIAL = ['ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov'];
const isOfficial = (host) => {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (NOT_OFFICIAL.some((d) => h === d || h.endsWith('.' + d))) return false;
  return OFFICIAL.some((d) => h === d || h.endsWith('.' + d));
};

const ENT = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', middot: '·', rsquo: '’', lsquo: '‘', mdash: '—', ndash: '–' };
const text = (html) => html.replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&([a-z]+);/g, (m, n) => ENT[n] || m)
  .replace(/\s+/g, ' ').trim();
const mainOf = (html) => { const i = html.indexOf('<main'); const j = html.lastIndexOf('</main>'); return i < 0 || j < 0 ? '' : html.slice(i, j); };

function articles(root) {
  const dir = path.join(root, 'articles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'index.html'))).sort();
}
function readScope(root) {
  const s = JSON.parse(fs.readFileSync(path.join(root, SCOPE_REL), 'utf8'));
  return { nonMedical: Object.keys(s.nonMedical || {}), product: Object.keys(s.product || {}), productNotes: s.product || {}, sourcesGap: s.sourcesGap || [], notes: s.nonMedical || {}, borderline: s.borderlineMedical || {}, gapPin: s.sourcesGapPin || null };
}

/* F2: sourcesGap is frozen. The scope file pins its count and a hash of the sorted list, and the gate holds
   a ceiling of its own, so the debt can only shrink. Adding a slug is red whatever the pin says; removing
   one (required once the page lists an official source) means re-pinning to the printed count and hash. */
/* 271 on 27 Nov 2026, then 277 the same day: F3 found six NON-MEDICAL pages giving health guidance, moved
   them to MEDICAL, and none lists an official source yet. That one raise is the only one; lower it as pages
   leave the list, never raise it again. */
const GAP_CEILING = 277;
const gapHash = (list) => crypto.createHash('sha256').update([...list].sort().join('\n')).digest('hex');
const gapPinOf = (list) => ({ count: list.length, sha256: gapHash(list) });
function judgeGapPin(scope) {
  const list = scope.sourcesGap; const pin = scope.gapPin; const want = gapPinOf(list);
  const fix = `"sourcesGapPin": ${JSON.stringify(want)}`;
  if (new Set(list).size !== list.length) return [`${SCOPE_REL}: sourcesGap lists a slug twice`];
  if (list.length > GAP_CEILING) return [`${SCOPE_REL}: sourcesGap has ${list.length} slugs, more than the frozen ${GAP_CEILING}; never add to it, give the page an official source`];
  if (!pin || typeof pin.count !== 'number' || typeof pin.sha256 !== 'string') return [`${SCOPE_REL}: sourcesGapPin is missing (${fix})`];
  if (pin.count > GAP_CEILING) return [`${SCOPE_REL}: sourcesGapPin.count ${pin.count} is above the frozen ${GAP_CEILING}`];
  if (list.length > pin.count) return [`${SCOPE_REL}: sourcesGap grew from ${pin.count} to ${list.length}; never add to it, give the page an official source`];
  if (list.length === pin.count && want.sha256 !== pin.sha256) return [`${SCOPE_REL}: sourcesGap changed but did not shrink (a slug was swapped or added); never add to it`];
  if (list.length < pin.count) return [`${SCOPE_REL}: sourcesGap shrank to ${list.length}; re-pin it: ${fix}`];
  return [];
}

/* The stretch a source list lives in: the two footers, and the section under a sources heading. */
function sourceRegions(main) {
  const out = [];
  for (const m of main.matchAll(/<footer class="(?:src|art-footer)"[^>]*>([\s\S]*?)<\/footer>/g)) out.push(m[1]);
  const heads = [...main.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)];
  heads.forEach((h, i) => {
    if (!/sources?\b|references|further reading/i.test(text(h[2]))) return;
    const start = h.index + h[0].length;
    const next = heads.slice(i + 1).find((x) => x[1] <= h[1]);
    out.push(main.slice(start, next ? next.index : main.length));
  });
  return out;
}
const officialLinks = (html) => [...html.matchAll(/href="https?:\/\/([^\/"?#:]+)/g)].map((m) => m[1]).filter(isOfficial);

function judgePage(slug, html, kind, inGap) {
  const medical = kind === 'medical';
  const fails = [];
  const main = mainOf(html);
  const at = `articles/${slug}`;
  if (!main) return [`${at}: no <main>`];
  const discl = [...main.matchAll(/<p class="art-disc(?:laimer)?"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
  if (medical) {
    const blocks = [...main.matchAll(/<div class="art-caution"([^>]*)>([\s\S]*?)<\/div>/g)];
    const loose = (main.match(/class="art-caution"/g) || []).length;
    if (loose !== 1 || blocks.length !== 1) fails.push(`${at}: MEDICAL page needs exactly one caution block, has ${loose}`);
    const b = blocks[0];
    if (b) {
      if (!/\brole="note"/.test(b[1])) fails.push(`${at}: caution block has no role="note"`);
      if (text(b[2]) !== CAUTION) fails.push(`${at}: caution words differ: "${text(b[2]).slice(0, 90)}"`);
      const h1 = main.indexOf('</h1>');
      if (h1 < 0 || h1 > b.index) fails.push(`${at}: caution block is not under the title`);
      else {
        const gap = main.slice(h1 + 5, b.index).replace(/<p class="(?:art-meta|article-meta)"[^>]*>[\s\S]*?<\/p>/, '');
        if (gap.trim()) fails.push(`${at}: caution block is not right under the title (before it: ${gap.trim().slice(0, 50)})`);
      }
    }
    for (const d of discl) if (d !== CAUTION) fails.push(`${at}: bottom disclaimer does not say the caution words: "${d.slice(0, 70)}"`);
    const has = sourceRegions(main).some((r) => officialLinks(r).length);
    if (!has && !inGap) fails.push(`${at}: MEDICAL page lists no official source (a link to ${OFFICIAL.slice(0, 6).join(', ')}, ... in its sources)`);
    if (has && inGap) fails.push(`${at}: now lists an official source, remove it from sourcesGap in ${SCOPE_REL}`);
  } else if (kind === 'product') {
    if (/class="art-caution"/.test(main)) fails.push(`${at}: PRODUCT page carries the caution block; it carries neither line`);
    for (const d of discl) fails.push(`${at}: PRODUCT page carries a bottom disclaimer; it carries neither line: "${d.slice(0, 70)}"`);
  } else {
    if (!discl.includes(GENERAL)) fails.push(`${at}: NON-MEDICAL page needs the general line "${GENERAL}"`);
    for (const d of discl) if (d !== GENERAL) fails.push(`${at}: NON-MEDICAL disclaimer is not the general line: "${d.slice(0, 70)}"`);
  }
  return fails;
}

function renderDoc(root, scope) {
  const all = articles(root);
  const non = new Set([...scope.nonMedical, ...scope.product]);
  const med = all.filter((s) => !non.has(s));
  const L = [];
  L.push('# Health caution scope', '');
  L.push('Generated by `node tools/health_caution_check.js --write-doc` from `tools/health_caution_scope.json`. Do not edit by hand;');
  L.push('the gate fails when this file and the scope differ. Rules: docs/HEALTH-COPY-RULES.md.', '');
  L.push('MEDICAL means any symptom, illness, medicine, dose, first aid, emergency, pregnancy health, birth, feeding health,');
  L.push('sleep safety, development or behaviour concern, or mental health. Every article is MEDICAL unless it is listed as');
  L.push('NON-MEDICAL below (leave, pay, paperwork, childcare logistics, customs, products) or PRODUCT (a pure Cubby');
  L.push('product page with no health guidance, which carries neither line).', '');
  L.push(`- Articles: ${all.length}`);
  L.push(`- MEDICAL: ${med.length} (caution block under the title, official sources)`);
  L.push(`- NON-MEDICAL: ${scope.nonMedical.length} (general line)`);
  L.push(`- PRODUCT: ${scope.product.length} (neither line)`);
  L.push(`- MEDICAL pages still without an official source in their sources list: ${scope.sourcesGap.length}`, '');
  L.push('## NON-MEDICAL', '');
  for (const s of [...scope.nonMedical].sort()) L.push(`- ${s}${scope.notes[s] ? ': ' + scope.notes[s] : ''}`);
  L.push('', '## PRODUCT', '');
  for (const s of [...scope.product].sort()) L.push(`- ${s}${scope.productNotes[s] ? ': ' + scope.productNotes[s] : ''}`);
  L.push('', '## MEDICAL, classified with less confidence', '');
  for (const s of Object.keys(scope.borderline).sort()) L.push(`- ${s}: ${scope.borderline[s]}`);
  L.push('', '## MEDICAL without an official source yet (fix these, then remove them from sourcesGap)', '');
  for (const s of [...scope.sourcesGap].sort()) L.push(`- ${s}`);
  L.push('', '## MEDICAL', '');
  for (const s of med) L.push(`- ${s}`);
  return L.join('\n') + '\n';
}

function judge(root) {
  const fails = [];
  const scope = readScope(root);
  const all = articles(root);
  const have = new Set(all);
  const non = new Set(scope.nonMedical);
  const prod = new Set(scope.product);
  const gap = new Set(scope.sourcesGap);
  for (const s of scope.product) if (non.has(s)) fails.push(`${SCOPE_REL}: "${s}" is both NON-MEDICAL and PRODUCT`);
  for (const s of [...scope.sourcesGap, ...Object.keys(scope.borderline)]) if (prod.has(s)) fails.push(`${SCOPE_REL}: "${s}" is PRODUCT and listed as MEDICAL debt or borderline`);
  for (const s of [...scope.nonMedical, ...scope.product, ...scope.sourcesGap, ...Object.keys(scope.borderline)]) if (!have.has(s)) fails.push(`${SCOPE_REL}: lists "${s}", which is not an article`);
  for (const s of scope.sourcesGap) if (non.has(s)) fails.push(`${SCOPE_REL}: "${s}" is NON-MEDICAL and in sourcesGap`);
  for (const s of Object.keys(scope.borderline)) if (non.has(s)) fails.push(`${SCOPE_REL}: "${s}" is NON-MEDICAL and borderline MEDICAL`);
  fails.push(...judgeGapPin(scope));
  const kindOf = (s) => (prod.has(s) ? 'product' : non.has(s) ? 'non' : 'medical');
  for (const s of all) fails.push(...judgePage(s, fs.readFileSync(path.join(root, 'articles', s, 'index.html'), 'utf8'), kindOf(s), gap.has(s)));
  const docPath = path.join(root, DOC_REL);
  if (!fs.existsSync(docPath) || fs.readFileSync(docPath, 'utf8') !== renderDoc(root, scope)) fails.push(`${DOC_REL}: out of date, run --write-doc`);
  return { n: all.length, med: all.filter((s) => kindOf(s) === 'medical').length, non: scope.nonMedical.length, product: scope.product.length, gap: scope.sourcesGap.length, fails };
}

/* --apply: one command puts every page in line with its scope. Idempotent. */
const CRISIS_UK = 'In a crisis, contact Samaritans on 116 123 (UK) or your local emergency services.';
function applyPage(html, kind) {
  const medical = kind === 'medical';
  const i = html.indexOf('<main'); const j = html.lastIndexOf('</main>');
  if (i < 0 || j < 0) return html;
  let m = html.slice(i, j);
  m = m.replace(/\n?[ \t]*<div class="art-caution"[^>]*>[\s\S]*?<\/div>/g, '');
  if (medical) {
    m = m.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)((?:\s*<p class="(?:art-meta|article-meta)"[^>]*>[\s\S]*?<\/p>)?)/, (all, h, meta) => `${h}${meta}\n  ${CAUTION_HTML}`);
    m = m.replace(/<p class="art-disc(?:laimer)?"([^>]*)>([\s\S]*?)<\/p>(\s*<p class="art-crisis">[\s\S]*?<\/p>)?/g, (all, attrs, inner, crisis) => {
      /* The mental-health wording carried the only crisis line on ten pages: keep it, outside the caution. */
      const keep = crisis || (/Samaritans/.test(inner) ? `\n  <p class="art-crisis">${CRISIS_UK}</p>` : '');
      return `<p class="art-disclaimer"${attrs}>${CAUTION}</p>${keep}`;
    });
  } else if (kind === 'product') {
    m = m.replace(/\n?[ \t]*<p class="art-disc(?:laimer)?"[^>]*>[\s\S]*?<\/p>/g, '');
  } else {
    if (/<p class="art-disc(?:laimer)?"/.test(m)) m = m.replace(/<p class="art-disc(?:laimer)?"([^>]*)>[\s\S]*?<\/p>/g, (all, attrs) => `<p class="art-disclaimer"${attrs}>${GENERAL}</p>`);
    else {
      const line = `<p class="art-disclaimer">${GENERAL}</p>\n  `;
      const f = m.search(/<footer\b/);
      m = f >= 0 ? m.slice(0, f) + line + m.slice(f) : m.replace(/\s*$/, '\n  ' + line.trimEnd() + '\n');
    }
  }
  return html.slice(0, i) + m + html.slice(j);
}
function apply(root) {
  const scope = readScope(root);
  const non = new Set(scope.nonMedical);
  const prod = new Set(scope.product);
  let changed = 0;
  for (const s of articles(root)) {
    const f = path.join(root, 'articles', s, 'index.html');
    const before = fs.readFileSync(f, 'utf8');
    const after = applyPage(before, prod.has(s) ? 'product' : non.has(s) ? 'non' : 'medical');
    if (after !== before) { fs.writeFileSync(f, after); changed++; }
  }
  return changed;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-caution-'));
  let bad = 0;
  const expect = (label, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + label); if (!cond) bad++; };
  const NHS = '<footer class="src">Sources: <a href="https://www.nhs.uk/conditions/fever-in-children/">NHS: fever in children</a>.</footer>';
  const page = (body, foot = NHS) => `<!doctype html><html><head><title>T</title></head><body><main class="wrap article">
  <nav class="crumbs"><a href="/">Home</a></nav>
  <h1>A title</h1>
  <p class="art-meta">0 to 1 year · Health</p>
${body}
  <h2>More</h2><p>Body text.</p>
  ${foot}
</main></body></html>`;
  const BODY = '  <p>First body paragraph.</p>';
  const good = page(`  ${CAUTION_HTML}\n${BODY}`);
  const goodNon = page(BODY, `<p class="art-disclaimer">${GENERAL}</p><footer class="src">x</footer>`);
  const scope = { nonMedical: { leave: 'leave and pay' }, sourcesGap: [], sourcesGapPin: gapPinOf([]), borderlineMedical: {} };
  const stage = (files, sc = scope) => {
    const t = path.join(tmp, 't');
    fs.rmSync(t, { recursive: true, force: true });
    const all = { 'articles/leave/index.html': goodNon, ...files };
    for (const [rel, html] of Object.entries(all)) {
      if (html == null) continue;
      fs.mkdirSync(path.dirname(path.join(t, rel)), { recursive: true });
      fs.writeFileSync(path.join(t, rel), html);
    }
    fs.mkdirSync(path.join(t, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(t, SCOPE_REL), JSON.stringify(sc));
    fs.mkdirSync(path.join(t, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(t, DOC_REL), renderDoc(t, readScope(t)));
    return t;
  };
  const red = (r, s) => r.fails.some((f) => f.includes(s));
  try {
    let r = judge(stage({ 'articles/fever/index.html': good }));
    expect('a MEDICAL page with the caution under its title and an NHS source passes, and so does a NON-MEDICAL page', r.fails.length === 0 && r.med === 1);
    r = judge(stage({ 'articles/fever/index.html': page(BODY) }));
    expect('a MEDICAL page with no caution goes red', red(r, 'exactly one caution block, has 0'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}\n  ${CAUTION_HTML}`) }));
    expect('two caution blocks go red', red(r, 'has 2'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML.replace('straight away', 'soon')}\n${BODY}`) }));
    expect('the caution with one phrase changed goes red', red(r, 'caution words differ'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML.replace(' role="note"', '')}\n${BODY}`) }));
    expect('a caution block without role="note" goes red', red(r, 'no role="note"'));
    r = judge(stage({ 'articles/fever/index.html': page(`${BODY}\n  ${CAUTION_HTML}`) }));
    expect('a caution after the first body paragraph goes red', red(r, 'not right under the title'));
    r = judge(stage({ 'articles/fever/index.html': page(`  <div class="notice">Call 999 now if your baby is floppy.</div>\n  ${CAUTION_HTML}\n${BODY}`) }));
    expect('a caution under an urgent box (not under the title) goes red', red(r, 'not right under the title'));
    r = judge(stage({ 'articles/fever/index.html': good.replace('<h1>A title</h1>\n  <p class="art-meta">0 to 1 year · Health</p>\n', '').replace('</main>', '<h1>A title</h1></main>') }));
    expect('a caution above the title goes red', red(r, 'not under the title'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, `${NHS}<p class="art-disclaimer">This article is for general information only.</p>`) }));
    expect('an old bottom disclaimer on a MEDICAL page goes red', red(r, 'bottom disclaimer does not say'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, `<p class="art-disclaimer">${CAUTION}</p>${NHS}`) }));
    expect('a bottom disclaimer with the caution words passes', r.fails.length === 0);
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">Sources: NHS, AAP.</footer>') }));
    expect('sources named without a link go red', red(r, 'lists no official source'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">Sources: <a href="https://www.lullabytrust.org.uk/">The Lullaby Trust</a>, <a href="https://pubmed.ncbi.nlm.nih.gov/1/">a trial</a>.</footer>') }));
    expect('a charity and a PubMed link are not an official source', red(r, 'lists no official source'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n  <p>See <a href="https://www.nhs.uk/x">the NHS</a>.</p>`, '<footer class="src">Cubby.</footer>') }));
    expect('an official link in the body but not in the sources list goes red', red(r, 'lists no official source'));
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}\n  <h2 id="sources">Trusted sources</h2><ul><li><a href="https://www.mhlw.go.jp/a">MHLW</a></li></ul>`, '') }));
    expect('an official link under a "Trusted sources" heading passes', r.fails.length === 0);
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">Sources: <a href="https://nhs.uk.example.com/">x</a>.</footer>') }));
    expect('a lookalike host (nhs.uk.example.com) is not official', red(r, 'lists no official source'));
    const gapScope = { ...scope, sourcesGap: ['fever'], sourcesGapPin: gapPinOf(['fever']) };
    r = judge(stage({ 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">Sources: NHS.</footer>') }, gapScope));
    expect('a known-gap page without a source is let through', r.fails.length === 0);
    r = judge(stage({ 'articles/fever/index.html': good }, gapScope));
    expect('a known-gap page that now has a source goes red until it leaves the list', red(r, 'remove it from sourcesGap'));
    const two = { 'articles/fever/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">Sources: NHS.</footer>'), 'articles/rash/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">None.</footer>') };
    r = judge(stage(two, { ...gapScope, sourcesGap: ['fever', 'rash'] }));
    expect('adding a slug to sourcesGap without touching the pin goes red', red(r, 'grew from 1 to 2'));
    r = judge(stage(two, { ...gapScope, sourcesGap: ['fever', 'rash'], sourcesGapPin: gapPinOf(['fever', 'rash']) }));
    expect('adding a slug and re-pinning still goes red against the frozen ceiling', judgeGapPin({ sourcesGap: Array.from({ length: GAP_CEILING + 1 }, (_, i) => 's' + i), gapPin: gapPinOf(Array.from({ length: GAP_CEILING + 1 }, (_, i) => 's' + i)) }).some((f) => f.includes('more than the frozen')));
    r = judge(stage(two, { ...gapScope, sourcesGap: ['rash'] }));
    expect('swapping one gap slug for another goes red', red(r, 'did not shrink'));
    r = judge(stage({ 'articles/fever/index.html': good }, { ...gapScope, sourcesGap: [] }));
    expect('removing a slug without re-pinning goes red and prints the new pin', red(r, 'shrank to 0; re-pin it'));
    r = judge(stage({ 'articles/fever/index.html': good }, { ...scope, sourcesGapPin: undefined }));
    expect('a scope with no pin goes red', red(r, 'sourcesGapPin is missing'));
    r = judge(stage({ 'articles/leave/index.html': page(BODY, '<footer class="src">x</footer>') }));
    expect('a NON-MEDICAL page without the general line goes red', red(r, 'needs the general line'));
    r = judge(stage({ 'articles/leave/index.html': page(BODY, `<p class="art-disclaimer">${GENERAL}</p><p class="art-disc">Old words.</p>`) }));
    expect('a NON-MEDICAL page with a second, older disclaimer goes red', red(r, 'not the general line'));
    const prodScope = { ...scope, product: { 'cubby-vs-x': 'Cubby comparison' } };
    const prodPage = page(BODY, '<footer class="src">Cubby editorial team.</footer>');
    r = judge(stage({ 'articles/cubby-vs-x/index.html': prodPage }, prodScope));
    expect('a PRODUCT page with neither line passes', r.fails.length === 0 && r.product === 1 && r.med === 0);
    r = judge(stage({ 'articles/cubby-vs-x/index.html': page(BODY, `<p class="art-disclaimer">${GENERAL}</p><footer class="src">x</footer>`) }, prodScope));
    expect('a PRODUCT page with the general line goes red', red(r, 'PRODUCT page carries a bottom disclaimer'));
    r = judge(stage({ 'articles/cubby-vs-x/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, '<footer class="src">x</footer>') }, prodScope));
    expect('a PRODUCT page with the caution goes red', red(r, 'PRODUCT page carries the caution'));
    r = judge(stage({ 'articles/cubby-vs-x/index.html': prodPage }));
    expect('the same page unlisted is MEDICAL and goes red', red(r, 'articles/cubby-vs-x: MEDICAL page needs exactly one'));
    r = judge(stage({ 'articles/cubby-vs-x/index.html': prodPage }, { ...prodScope, nonMedical: { leave: 'x', 'cubby-vs-x': 'y' } }));
    expect('a slug both NON-MEDICAL and PRODUCT goes red', red(r, 'both NON-MEDICAL and PRODUCT'));
    r = judge(stage({ 'articles/new-topic/index.html': page(BODY) }));
    expect('a new article nobody classified is MEDICAL and goes red without the caution', red(r, 'articles/new-topic: MEDICAL page needs exactly one'));
    r = judge(stage({}, { ...scope, nonMedical: { leave: 'x', gone: 'y' } }));
    expect('a scope entry with no article goes red', red(r, 'lists "gone"'));
    let t = stage({ 'articles/fever/index.html': good });
    fs.appendFileSync(path.join(t, DOC_REL), '- hand edit\n');
    r = judge(t);
    expect('a scope doc that differs from the scope goes red', red(r, 'out of date'));
    /* --apply and the judge agree: raw pages in, a green tree out, and a second run changes nothing. */
    const mh = page(BODY, `<p class="art-disclaimer">This article is for general information only. In a crisis, contact Samaritans on 116 123 (UK) or your local emergency services.</p>${NHS}`);
    t = stage({ 'articles/fever/index.html': page(`  <img src="h.png" alt="">\n${BODY}`), 'articles/mh/index.html': mh, 'articles/leave/index.html': page(BODY, '<footer class="src">x</footer>'),
      'articles/cubby-vs-x/index.html': page(`  ${CAUTION_HTML}\n${BODY}`, `<p class="art-disclaimer">${GENERAL}</p><footer class="src">x</footer>`) }, prodScope);
    const n1 = apply(t); const n2 = apply(t);
    r = judge(t);
    const mhOut = fs.readFileSync(path.join(t, 'articles/mh/index.html'), 'utf8');
    expect('--apply turns raw pages green (a PRODUCT page loses both lines) and is idempotent', n1 === 4 && n2 === 0 && r.fails.length === 0);
    expect('--apply keeps the only crisis line when it replaces a mental-health disclaimer', mhOut.includes(`<p class="art-crisis">${CRISIS_UK}</p>`) && mhOut.split('Samaritans').length === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return bad;
}

if (require.main === module) {
  const rootArg = (process.argv.find((a) => a.startsWith('--root=')) || '').slice(7);
  const root = rootArg ? path.resolve(rootArg) : ROOT_DEFAULT;
  let failed = 0;
  if (process.argv.includes('--self-test')) {
    console.log('health-caution self-test');
    failed += selfTest();
    if (failed) console.log(`self-test: ${failed} expectation(s) did not hold`);
  }
  if (process.argv.includes('--apply')) console.log(`apply: ${apply(root)} article(s) changed`);
  if (process.argv.includes('--write-doc')) { fs.writeFileSync(path.join(root, DOC_REL), renderDoc(root, readScope(root))); console.log('wrote ' + DOC_REL); }
  const { n, med, non, product, gap, fails } = judge(root);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`health-caution: ${n} articles, ${med} MEDICAL, ${non} NON-MEDICAL, ${product} PRODUCT, ${gap} known source gaps, ${fails.length} failure(s)`);
  process.exit(failed || fails.length ? 1 : 0);
}
module.exports = { CAUTION, GENERAL, isOfficial, judge, applyPage };
