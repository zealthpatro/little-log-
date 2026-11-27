#!/usr/bin/env node
/* Clinical lock: a health page's words may not change unless two clinicians signed off on the new words.
 *
 *   node tools/clinical_lock_check.js               judge this checkout (prints the pages in scope)
 *   node tools/clinical_lock_check.js --strict      also fail a safety fix whose sign-off is past due
 *   node tools/clinical_lock_check.js --self-test   first stage every way it can go red in a temp tree
 *   node tools/clinical_lock_check.js --hash=<slug> print a page's hash, to record in a sign-off
 *   node tools/clinical_lock_check.js --root=<dir>  judge another tree
 *
 * WHY (27 Nov 2026). The founder asked for the health pages to be "reviewed and locked by multiple
 * clinicians". The words parents read on these pages change only with two clinicians' sign-off at the
 * new words; pages not yet signed at their current words are held at their 26-27 Nov health-hotfix copy.
 *
 * Scope: every page tools/health_copy_check.js holds in FAQ lockstep, plus every article whose slug or
 * <title> names one of TOPICS, less the hubs (link lists of article cards with a "Hub ·" source line,
 * such as articles/sleep, articles/you and articles/mental-health). The hash is sha256 over the <title>, the meta description, the
 * BlogPosting headline and description, the page's <main> text (breadcrumbs, the "Start free" box, the
 * related-articles list and the "Cubby editorial team." byline taken out: none of them is clinical) and
 * every FAQPage JSON-LD question and answer, entities and whitespace normalised.
 *
 * Reviewer details are private. docs/clinical-review/approved.json (public) holds per page only the
 * approved hash, the sign-off count and the date. The names, credentials and registrations live outside
 * the repo in $CUBBY_SIGNOFFS (default ~/cubby-reports/clinical-signoffs/signoffs.json). Where that file
 * exists, each approved hash needs 2+ valid reviewers with distinct registrations in it; where it does not
 * (CI), approved.json's counts are all that is checked, and the gate says so.
 *
 * A page passes when (1) approved.json holds it at today's hash with 2+ sign-offs, (2) it has no approval
 * and tools/clinical-lock-baseline.json holds it at today's hash, or (3) docs/clinical-review/safety-fixes.json
 * holds today's hash with an official https source, a date and a signoff_due within 14 days of it (past
 * due: a warning, a failure under --strict). Everything else fails. When git has origin/main, a baseline
 * hash may not differ from main's baseline (editing the baseline is not a way round the lock), and a page
 * may leave the baseline only for a valid approval.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT_DEFAULT = path.join(__dirname, '..');
const APPROVED = 'docs/clinical-review/approved.json';
const SAFETY = 'docs/clinical-review/safety-fixes.json';
const BASELINE = 'tools/clinical-lock-baseline.json';
const PRIVATE_DEFAULT = path.join(os.homedir(), 'cubby-reports/clinical-signoffs/signoffs.json');
const MIN_REVIEWERS = 2;
const SAFETY_DAYS = 14;
/* Official sources a safety fix may cite (PACK.md's list). Any government host (.gov, .gov.xx, .go.jp) counts too. */
const OFFICIAL = ['nhs.uk', 'nhs.scot', 'nhsinform.scot', 'nice.org.uk', 'gov.uk', 'rcpch.ac.uk', 'resus.org.uk',
  'aap.org', 'healthychildren.org', 'who.int', 'unicef.org', 'healthdirect.gov.au', 'rednose.org.au',
  'allergy.org.au', 'rch.org.au', 'iss.it', 'bzga.de', 'jpeds.or.jp', 'iapindia.org', 'hse.ie', 'canada.ca', 'cps.ca'];
const officialUrl = (u) => {
  let url;
  try { url = new URL(String(u)); } catch (e) { return false; }
  const h = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (OFFICIAL.some((d) => h === d || h.endsWith('.' + d)) || /(^|\.)(gov|go)(\.[a-z]{2})?$/.test(h));
};

const TOPICS = {
  emergency: /\b(emergenc\w*|ambulance|999|911|112|a ?& ?e|when to call|urgent care)\b/i,
  medicine: /\b(medicines?|medications?|paracetamol|acetaminophen|ibuprofen|doses?|dosing|calpol|tylenol|antibiotics?|drugs?)\b/i,
  fever: /\b(fevers?|febrile)\b/i,
  breathing: /\b(breathing|breath\w*|respiratory|croup|bronchiolitis|rsv|wheez\w*|apnoea|apnea)\b/i,
  'sleep safety': /\b(sids|sudi|safe sleep\w*|red nose|sudden infant|co ?sleep\w*|bed ?shar\w*|safe to sleep)\b/i,
  seizure: /\b(seizures?|convulsions?)\b/i,
  'head injury': /\b(head injur\w*|concussion|bump(ed)? (on|to) the head)\b/i,
  choking: /\b(chok\w*|cpr|first aid)\b/i,
  allergy: /\b(allerg\w*|anaphyla\w*|epipen|adrenaline auto)\b/i,
  'pregnancy medicine': /\bpregnan\w*\b.*\b(medicines?|medications?|drugs?|paracetamol|ibuprofen|supplements?)\b|\b(medicines?|medications?|drugs?)\b.*\bpregnan\w*/i,
  'perinatal mental health': /\b(postpartum depression|postnatal depression|perinatal|psychosis|baby blues|ppd|pnd|postpartum anxiety|postnatal anxiety|mental health)\b/i,
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·', rsaquo: '›' };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
});
const text = (h) => unent(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return dflt; throw new Error(f + ': ' + e.message); } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/* The lockstep list, read from health_copy_check.js itself so a page added there is locked here too. */
function lockstepSlugs(root) {
  let src = '';
  try { src = fs.readFileSync(path.join(root, 'tools/health_copy_check.js'), 'utf8'); } catch (e) { return []; }
  const m = /const LOCKSTEP = \[([\s\S]*?)\]/.exec(src);
  return m ? [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]) : [];
}
const titleOf = (html) => unent(((/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1] || '').split('|')[0]).trim();
/* A hub is a list of article cards: a source line that says "Hub ·" and 5+ list items that link to articles.
   The marker alone does not make a page a hub (a self-test case stages that). */
const HUB_MIN_CARDS = 5;
const isHub = (html) => /<footer class="src">\s*Hub\s*·/.test(html) &&
  (html.match(/<li>\s*<a href="\/articles\/[a-z0-9-]+\/">/g) || []).length >= HUB_MIN_CARDS;

function scope(root) {
  const lock = new Set(lockstepSlugs(root));
  const out = [], hubs = [];
  const dir = path.join(root, 'articles');
  for (const slug of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, slug, 'index.html');
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const title = titleOf(html);
    const why = Object.keys(TOPICS).filter((k) => TOPICS[k].test(slug.replace(/-/g, ' ')) || TOPICS[k].test(title));
    if (lock.has(slug)) why.unshift('lockstep');
    if (!why.length) continue;
    if (isHub(html)) { hubs.push(slug); continue; }
    out.push({ slug, title, why, html });
  }
  for (const s of lock) if (!out.some((p) => p.slug === s) && !hubs.includes(s)) out.push({ slug: s, title: '', why: ['lockstep'], html: null });
  out.hubs = hubs;
  return out;
}

function jsonLd(html) {
  const out = [];
  const walk = (d) => {
    if (Array.isArray(d)) return d.forEach(walk);
    if (!d || typeof d !== 'object') return;
    out.push(d);
    if (Array.isArray(d['@graph'])) walk(d['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { walk(JSON.parse(m[1])); } catch (e) { /* unparsable JSON-LD is health_copy_check's to judge */ }
  }
  return out;
}
const isType = (d, t) => [].concat(d['@type'] || []).includes(t);

function clinicalCopy(html) {
  const main = (/<main\b[\s\S]*?<\/main>/i.exec(html) || [html])[0]
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<div class="cta">[\s\S]*?<\/div>/gi, ' ')
    // The standard health caution and its matching bottom line are site-wide boilerplate set by
    // tools/health_caution_check.js, not this page's clinical copy; changing that wording must not unlock pages.
    .replace(/<div class="art-caution"[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<p class="art-disc(?:laimer)?"[^>]*>[\s\S]*?<\/p>/gi, ' ')
    .replace(/<h2[^>]*>\s*Related articles\s*<\/h2>\s*<ul>[\s\S]*?<\/ul>/gi, ' ');
  const title = text((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const meta = text(unent((/<meta\s+name="description"\s+content="([^"]*)"/i.exec(html) || [])[1] || ''));
  const faq = [], post = [];
  for (const d of jsonLd(html)) {
    if (isType(d, 'FAQPage')) for (const q of d.mainEntity || []) faq.push(text(String(q.name || '')) + ' => ' + text(String((q.acceptedAnswer || {}).text || '')));
    if (isType(d, 'BlogPosting')) post.push(text(String(d.headline || '')) + ' => ' + text(String(d.description || '')));
  }
  return '--TITLE--\n' + title + '\n--META--\n' + meta + '\n--POST--\n' + post.join('\n') +
    '\n--MAIN--\n' + text(main).replace(/Cubby editorial team\.\s*/g, '') + '\n--FAQ--\n' + faq.join('\n');
}
const hashOf = (html) => crypto.createHash('sha256').update(clinicalCopy(html), 'utf8').digest('hex');

function reviewerProblems(rs, today) {
  const probs = [], seen = new Set();
  for (const r of Array.isArray(rs) ? rs : []) {
    const reg = r && r.registration || {};
    const miss = ['name', 'credential', 'date'].filter((k) => !r || !String(r[k] || '').trim());
    if (!String(reg.body || '').trim()) miss.push('registration.body');
    if (!String(reg.number || '').trim()) miss.push('registration.number');
    /* Private-file problems never print a name: the gate's output can end up in CI logs. */
    if (miss.length) { probs.push(`a reviewer lacks ${miss.join(', ')}`); continue; }
    if (!DAY.test(r.date) || r.date > today) { probs.push(`a reviewer's date "${r.date}" is not a past YYYY-MM-DD`); continue; }
    const key = (reg.body + '|' + reg.number).toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) { probs.push('two reviewers share one registration'); continue; }
    seen.add(key);
  }
  return { valid: seen.size, probs };
}

/* Main's baseline, when git can show it. null = nothing to compare against (no git, no origin/main, or
   main does not have the lock yet), which is said out loud rather than passed quietly. */
function mainBaseline(root) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  try {
    return JSON.parse(execFileSync('git', ['show', 'origin/main:' + BASELINE], { cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  } catch (e) { return null; }
}

const APPROVED_KEYS = ['slug', 'sha256', 'signoffs', 'date'];
function approvedProblems(e, today) {
  const extra = Object.keys(e || {}).filter((k) => !APPROVED_KEYS.includes(k));
  if (extra.length) return [`has ${extra.join(', ')}: approved.json holds only ${APPROVED_KEYS.join(', ')} (reviewer details stay in the private file)`];
  const p = [];
  if (!/^[0-9a-f]{64}$/.test(String(e.sha256))) p.push('sha256 is not a 64-character hex hash');
  if (!Number.isInteger(e.signoffs) || e.signoffs < MIN_REVIEWERS) p.push(`has ${e.signoffs} sign-off(s); ${MIN_REVIEWERS} are needed`);
  if (!DAY.test(String(e.date)) || e.date > today) p.push(`date "${e.date}" is not a past YYYY-MM-DD`);
  return p;
}

function judge(root, opts = {}) {
  const fails = [], notes = [], warns = [];
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const pages = scope(root);
  const approved = readJson(path.join(root, APPROVED), null);
  const safety = readJson(path.join(root, SAFETY), null);
  const baseline = readJson(path.join(root, BASELINE), null);
  const privPath = opts.privatePath || process.env.CUBBY_SIGNOFFS || PRIVATE_DEFAULT;
  const priv = readJson(privPath, null);
  if (!approved || !Array.isArray(approved.pages)) fails.push(`${APPROVED}: missing or has no "pages" array`);
  if (!safety || !Array.isArray(safety.pages)) fails.push(`${SAFETY}: missing or has no "pages" array`);
  if (!baseline || typeof baseline.pages !== 'object') fails.push(`${BASELINE}: missing or has no "pages" object`);
  if (priv && !Array.isArray(priv.pages)) fails.push('private sign-off file: has no "pages" array');
  if (fails.length) return { fails, notes, warns, pages };
  if (!priv) notes.push(`no private sign-off file (${opts.privatePath ? 'staged absent' : '$CUBBY_SIGNOFFS or ~/cubby-reports/clinical-signoffs/signoffs.json'}): approved.json's counts checked only, not the reviewers behind them`);

  const bySlug = (arr, file) => {
    const m = new Map();
    for (const e of arr) { if (m.has(e.slug)) fails.push(`${file}: ${e.slug} has two entries (one per page)`); m.set(e.slug, e); }
    return m;
  };
  const appr = bySlug(approved.pages, APPROVED), fixes = bySlug(safety.pages, SAFETY);
  const privBy = new Map();
  for (const e of priv ? priv.pages : []) privBy.set(e.slug + '@' + e.sha256, e);

  /* An approval is valid when its entry is well formed and, where the private file exists, it backs the count. */
  const approvalOk = (slug) => {
    const a = appr.get(slug);
    if (!a || approvedProblems(a, today).length) return false;
    if (!priv) return true;
    const { valid } = reviewerProblems((privBy.get(slug + '@' + a.sha256) || {}).reviewers, today);
    return valid >= MIN_REVIEWERS && valid >= a.signoffs;
  };

  const inScope = new Set(pages.map((p) => p.slug));
  let signedOk = 0, fixedOk = 0;
  for (const p of pages) {
    if (!p.html) { fails.push(`articles/${p.slug}/index.html: in health_copy_check's lockstep list but not on disk`); continue; }
    const h = hashOf(p.html), a = appr.get(p.slug), fx = fixes.get(p.slug), base = baseline.pages[p.slug];
    if (a) {
      approvedProblems(a, today).forEach((x) => fails.push(`${APPROVED} ${p.slug}: ${x}`));
      if (priv && a.sha256 && !approvedProblems(a, today).length) {
        const pe = privBy.get(p.slug + '@' + a.sha256);
        if (!pe) fails.push(`${APPROVED} ${p.slug}: the private sign-off file has no record at ${String(a.sha256).slice(0, 12)}`);
        else {
          const { valid, probs } = reviewerProblems(pe.reviewers, today);
          probs.forEach((x) => fails.push(`private sign-off file ${p.slug}: ${x}`));
          if (valid < MIN_REVIEWERS || valid < a.signoffs) fails.push(`${APPROVED} ${p.slug}: says ${a.signoffs} sign-offs, the private file backs ${valid} distinct registration(s); ${MIN_REVIEWERS}+ are needed`);
        }
      }
    }
    if (fx) {
      const probs = [];
      if (!officialUrl(fx.source)) probs.push(`source "${fx.source}" is not an https URL on an official health host`);
      if (!DAY.test(String(fx.date)) || fx.date > today) probs.push(`date "${fx.date}" is not a past YYYY-MM-DD`);
      if (!DAY.test(String(fx.signoff_due))) probs.push(`signoff_due "${fx.signoff_due}" is not a YYYY-MM-DD`);
      else if (DAY.test(String(fx.date)) && (days(fx.date, fx.signoff_due) < 0 || days(fx.date, fx.signoff_due) > SAFETY_DAYS)) probs.push(`signoff_due ${fx.signoff_due} is not within ${SAFETY_DAYS} days of ${fx.date}`);
      probs.forEach((x) => fails.push(`${SAFETY} ${p.slug}: ${x}`));
      if (fx.sha256 !== h) fails.push(`${SAFETY} ${p.slug}: its hash ${String(fx.sha256).slice(0, 12)} is not the page's words (now ${h.slice(0, 12)}); the page changed after the fix, or the fix is signed off and its entry can go`);
      else if (!probs.length) {
        fixedOk++;
        if (today > fx.signoff_due) (opts.strict ? fails : warns).push(`articles/${p.slug}: safety fix of ${fx.date} was due for sign-off by ${fx.signoff_due}`);
        continue;
      }
    }
    if (a) {
      if (a.sha256 !== h) fails.push(`articles/${p.slug}: copy changed since its sign-off (signed ${String(a.sha256).slice(0, 12)}, now ${h.slice(0, 12)}); it needs ${MIN_REVIEWERS} sign-offs at the new hash, or a safety-fix entry`);
      else if (approvalOk(p.slug)) signedOk++;
    } else if (!base) {
      fails.push(`articles/${p.slug}: in scope (${p.why.join(', ')}) with no sign-off and no baseline; record it at ${h}`);
    } else if (base !== h) {
      fails.push(`articles/${p.slug}: not signed off at these words, so its copy may not change (baseline ${base.slice(0, 12)}, now ${h.slice(0, 12)}); a safety fix goes in ${SAFETY}`);
    }
  }
  for (const s of Object.keys(baseline.pages)) if (!inScope.has(s)) fails.push(`${BASELINE}: ${s} is not a page in scope (removed, renamed or a hub?)`);
  for (const s of appr.keys()) if (!inScope.has(s)) fails.push(`${APPROVED}: ${s} is not a page in scope`);
  for (const s of fixes.keys()) if (!inScope.has(s)) fails.push(`${SAFETY}: ${s} is not a page in scope`);
  const main = opts.mainBaseline !== undefined ? opts.mainBaseline : mainBaseline(root);
  if (!main || typeof main.pages !== 'object') notes.push('no baseline on origin/main to compare against (first introduction, or no git)');
  else for (const [s, h] of Object.entries(main.pages)) {
    const now = baseline.pages[s];
    if (now === undefined) { if (inScope.has(s) && !approvalOk(s)) fails.push(`${BASELINE}: ${s} left the baseline without a valid sign-off`); }
    else if (now !== h) fails.push(`${BASELINE}: ${s} differs from main's baseline; editing the baseline does not unlock a page, a sign-off does`);
  }
  if (pages.hubs.length) notes.push(`hubs out of scope: ${pages.hubs.join(', ')}`);
  notes.push(`${signedOk} page(s) signed off by ${MIN_REVIEWERS}+ reviewers, ${fixedOk} on a safety fix, ${pages.length - signedOk - fixedOk} at baseline`);
  return { fails, notes, warns, pages };
}

/* ---- self-test: a temp tree with one health page and its files, each case staged. ---- */
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clinical-lock-'));
  const page = (body, faqA, o = {}) => `<html><head><title>${o.title || 'Fever in babies'} | Cubby</title>
<meta name="description" content="${o.meta || 'When a fever needs a doctor.'}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"${o.headline || 'Fever in babies'}","description":"${o.desc || 'When a fever needs a doctor.'}"}</script>
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"When is a fever urgent?","acceptedAnswer":{"@type":"Answer","text":"${faqA}"}}]}</script></head>
<body><nav class="nav">Home</nav><main><nav class="crumbs">Home › Health</nav><h1>Fever</h1><p>${body}</p>
<div class="cta"><h3>Track it</h3><p>Start free</p></div><h2>Related articles</h2><ul><li>Other</li></ul>
<footer class="src">Cubby editorial team. Sources: NHS.</footer></main><footer>site footer</footer></body></html>`;
  const A0 = 'Call 999 if your baby is under 3 months with a temperature of 38C or higher.', F0 = 'Under 3 months, 38C or higher.';
  const A = page(A0, F0);
  const B = page('Call 999 if your baby is under 3 months old with a temperature of 38C or higher.', F0);
  const C = page('Call 999 if your baby is under 3 months old with a temperature of 38C or more.', F0);
  const hub = (intro, src = 'Hub · Summarised from NHS guidance.', cards = [1, 2, 3, 4, 5].map((i) => `<li><a href="/articles/guide-${i}/">Guide ${i}</a>. A guide.</li>`).join('')) => `<html><head><title>Baby sleep guide: safe sleep and night waking | Cubby</title></head>
<body><main><h1>Baby sleep</h1><p>${intro}</p><h2>Guides</h2><ul>${cards}</ul>
<footer class="src">${src}</footer></main></body></html>`;
  const named = { B, C };
  const write = (rel, s) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), typeof s === 'string' ? s : JSON.stringify(s)); };
  const rev = (n, reg) => ({ name: 'Reviewer ' + n, credential: 'Registered midwife', registration: { body: 'NMC', number: reg || 'R' + n }, date: '2026-11-20' });
  const TODAY = '2026-11-27';
  const fix = (o = {}) => ({ sha256: 'NOW', source: 'https://www.nhs.uk/conditions/fever-in-children/', date: '2026-11-25', signoff_due: '2026-12-09', ...o });
  const P = 'articles/baby-fever-test/index.html';
  const PRIV = path.join(tmp, 'private/signoffs.json');
  let bad = 0;
  /* [name, true (green) or the regex its red must match, staging]. html: page text or a key of named;
     appr: approved entry fields (sha256 'NOW' = the staged page's hash); priv: reviewers in the private file. */
  const cases = [
    ['an unchanged page with no sign-off', true, {}],
    ['a changed page with no sign-off', /may not change/, { html: B }],
    ['a changed FAQ JSON-LD answer only', /may not change/, { html: page(A0, 'Under 3 months, 39C or higher.') }],
    ['a changed <title> only', /may not change/, { html: page(A0, F0, { title: 'Fever in babies and toddlers' }) }],
    ['a changed meta description only', /may not change/, { html: page(A0, F0, { meta: 'A fever rarely needs a doctor.' }) }],
    ['a changed BlogPosting headline only', /may not change/, { html: page(A0, F0, { headline: 'Fevers are fine' }) }],
    ['a changed BlogPosting description only', /may not change/, { html: page(A0, F0, { desc: 'A fever rarely needs a doctor.' }) }],
    ['adding the standard caution and bottom disclaimer stays green', true, { html: A.replace('<h1>Fever</h1>', '<h1>Fever</h1><div class="art-caution" role="note">In an emergency, call now.</div>').replace('</main>', '<p class="art-disclaimer">In an emergency, call now.</p></main>') }],
    ['a change outside the clinical copy (byline, related list, cta, site footer)', true, { html: A.replace('Other', 'Another').replace('Start free', 'Try it').replace('site footer', 'new footer').replace('Cubby editorial team. ', '') }],
    ['approved at 2 sign-offs, no private file (CI)', true, { html: 'B', appr: { signoffs: 2 }, wantNote: /counts checked only/ }],
    ['approved at 1 sign-off', /1 sign-off\(s\); 2 are needed/, { html: 'B', appr: { signoffs: 1 } }],
    ['approved.json carrying a reviewer name', /holds only slug/, { html: 'B', appr: { signoffs: 2, reviewers: ['Dr A'] } }],
    ['approved at 2, private file backs 2 distinct registrations', true, { html: 'B', appr: { signoffs: 2 }, priv: [rev(1), rev(2)] }],
    ['approved at 2, private file backs 1 reviewer', /private file backs 1/, { html: 'B', appr: { signoffs: 2 }, priv: [rev(1)] }],
    ['approved at 2, private reviewers share one registration', /share one registration/, { html: 'B', appr: { signoffs: 2 }, priv: [rev(1, 'X9'), rev(2, 'X9')] }],
    ['approved at 2, private reviewer with no registration number', /lacks registration\.number/, { html: 'B', appr: { signoffs: 2 }, priv: [rev(1), { ...rev(2), registration: { body: 'NMC' } }] }],
    ['approved at 2, private file has no record of it', /private sign-off file has no record/, { html: 'B', appr: { signoffs: 2 }, priv: [], privOther: true }],
    ['a signed page changed after its sign-off', /changed since its sign-off/, { html: 'C', appr: { signoffs: 2, sha256: 'B' } }],
    ['a safety fix, due in the future', true, { html: 'B', fix: fix() }],
    ['a safety fix past its signoff_due (local)', true, { html: 'B', fix: fix(), today: '2026-12-10', wantWarn: /was due for sign-off/ }],
    ['a safety fix past its signoff_due (--strict)', /was due for sign-off/, { html: 'B', fix: fix(), today: '2026-12-10', strict: true }],
    ['a safety fix with signoff_due 15 days out', /not within 14 days/, { html: 'B', fix: fix({ signoff_due: '2026-12-10' }) }],
    ['a safety fix citing a non-official source', /not an https URL on an official/, { html: 'B', fix: fix({ source: 'https://www.example-parenting-blog.com/fever' }) }],
    ['a safety fix citing http', /not an https URL on an official/, { html: 'B', fix: fix({ source: 'http://www.nhs.uk/conditions/fever-in-children/' }) }],
    ['a safety fix with no date', /date "undefined"/, { html: 'B', fix: fix({ date: undefined }) }],
    ['a page changed again after its safety fix', /is not the page's words/, { html: 'C', fix: fix({ sha256: 'B' }) }],
    ['a hub edit (out of scope)', true, { hubHtml: hub('Safe sleep matters. These guides cover it all, newly edited.') }],
    ['the same page without the hub marks is in scope', /baby-sleep-hub-test: in scope/, { hubHtml: hub('Safe sleep matters.', 'Sources: NHS.') }],
    ['a page with the Hub line but only 4 article cards is in scope', /baby-sleep-hub-test: in scope/, { hubHtml: hub('Safe sleep matters.', undefined, [1, 2, 3, 4].map((i) => `<li><a href="/articles/guide-${i}/">Guide ${i}</a>.</li>`).join('')) }],
    ['an in-scope page neither file knows', /croup-test: in scope/, { extra: true }],
    ['a baseline edited to the new hash (main still holds the old one)', /differs from main's baseline/, { html: 'B', rebase: true, main: true }],
    ['a page leaving the baseline with no sign-off', /left the baseline without/, { dropBase: true, main: true }],
  ];
  try {
    for (const [name, want, c] of cases) {
      const wantGreen = want === true;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp);
      write('tools/health_copy_check.js', "const LOCKSTEP = [\n  'baby-fever-test',\n].map(String);\n");
      const html = named[c.html] || c.html || A, h = hashOf(html);
      write(P, html);
      if (c.extra) write('articles/croup-test/index.html', page('Croup can make breathing noisy.', 'Noisy breathing.', { title: 'Croup' }));
      if (c.hubHtml) write('articles/baby-sleep-hub-test/index.html', c.hubHtml);
      const resolve = (v) => (v === 'NOW' ? h : named[v] ? hashOf(named[v]) : v);
      const ap = c.appr ? { slug: 'baby-fever-test', sha256: resolve(c.appr.sha256 || 'NOW'), signoffs: c.appr.signoffs, date: '2026-11-20', ...(c.appr.reviewers ? { reviewers: c.appr.reviewers } : {}) } : null;
      write(BASELINE, { pages: c.dropBase || ap || c.fix ? (c.fix ? { 'baby-fever-test': hashOf(A) } : {}) : { 'baby-fever-test': c.rebase ? h : hashOf(A) } });
      write(APPROVED, { pages: ap ? [ap] : [] });
      write(SAFETY, { pages: c.fix ? [{ slug: 'baby-fever-test', ...c.fix, sha256: resolve(c.fix.sha256) }] : [] });
      if (c.priv) write(path.relative(tmp, PRIV), { pages: c.privOther ? [{ slug: 'other', sha256: h, reviewers: [rev(1), rev(2)] }] : [{ slug: 'baby-fever-test', sha256: ap.sha256, reviewers: c.priv }] });
      const r = judge(tmp, { privatePath: PRIV, today: c.today || TODAY, strict: !!c.strict, mainBaseline: c.main ? { pages: { 'baby-fever-test': hashOf(A) } } : null });
      const green = r.fails.length === 0;
      /* Red must be red for ITS reason, not because the staging broke something else; a green that promises a
         note or a warning must print it. */
      let ok = wantGreen ? green : !green && r.fails.some((f) => want.test(f));
      if (ok && c.wantNote) ok = r.notes.some((n) => c.wantNote.test(n));
      if (ok && c.wantWarn) ok = r.warns.some((n) => c.wantWarn.test(n));
      if (ok && wantGreen && !c.wantWarn && r.warns.length) ok = false;
      if (!ok) bad++;
      console.log(`  ${ok ? 'ok ' : 'BAD'} ${wantGreen ? 'green' : 'red  '}: ${name}${!ok || !green ? ' -> ' + (r.fails.find((f) => !wantGreen && want.test(f)) || r.fails[0] || r.warns[0] || 'no failure') : ''}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  if (bad) { console.error(`clinical-lock self-test: ${bad} case(s) wrong`); process.exit(1); }
  console.log(`clinical-lock self-test: all ${cases.length} cases as expected`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = path.resolve((args.find((a) => a.startsWith('--root=')) || '').slice(7) || ROOT_DEFAULT);
  const hashArg = args.find((a) => a.startsWith('--hash='));
  if (hashArg) {
    const slug = hashArg.slice(7);
    console.log(hashOf(fs.readFileSync(path.join(root, 'articles', slug, 'index.html'), 'utf8')));
    process.exit(0);
  }
  if (args.includes('--self-test')) selfTest();
  const { fails, notes, warns, pages } = judge(root, { strict: args.includes('--strict') });
  if (args.includes('--write-baseline-for-new')) {
    /* Records ONLY pages that are in scope and in no file yet (a new page). Never rewrites a hash. */
    const bf = path.join(root, BASELINE), b = readJson(bf, { pages: {} });
    const known = new Set([...readJson(path.join(root, APPROVED), { pages: [] }).pages, ...readJson(path.join(root, SAFETY), { pages: [] }).pages].map((e) => e.slug));
    let n = 0;
    for (const p of pages) if (p.html && !b.pages[p.slug] && !known.has(p.slug)) { b.pages[p.slug] = hashOf(p.html); n++; }
    b.pages = Object.fromEntries(Object.entries(b.pages).sort());
    fs.writeFileSync(bf, JSON.stringify(b, null, 2) + '\n');
    console.log(`recorded ${n} new page(s) in ${BASELINE}`);
    process.exit(0);
  }
  console.log(`clinical-lock: ${pages.length} health pages in scope:`);
  console.log('  ' + pages.map((p) => p.slug).join(', '));
  notes.forEach((n) => console.log('  note: ' + n));
  warns.forEach((w) => console.log('  WARN ' + w));
  if (fails.length) { fails.forEach((f) => console.error('  FAIL ' + f)); console.error(`clinical-lock: ${fails.length} failure(s)`); process.exit(1); }
  console.log('clinical-lock: ok');
}

module.exports = { hashOf, clinicalCopy, scope, judge };
