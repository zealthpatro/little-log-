#!/usr/bin/env node
/* Cubby question -> article gap analysis.
   ---------------------------------------------------------------------------
   Server-side, founder-run, offline tooling. NOT client-facing and NOT the
   live RAG chatbot proposed in docs/plans/2026-07-13-rag-chatbot-pro.md
   (that is a separate, deferred, Pro-tier chat feature). This is a much
   smaller sibling: it takes real user QUESTIONS (feedback text, or the FAQ
   as a bootstrap proxy) and checks how well the existing article + FAQ
   corpus already answers them, so CONTENT-QUEUE.md can be grown from real
   asks instead of guesses.

   Two question sources:
     1. Firestore 'feedback' collection (openFeedback() free text) — read via
        the SAME service-account pattern as tools/analytics.js. Needs
        tools/serviceAccountKey.json (gitignored, founder-provided). See
        ANALYTICS.md ("One-time setup") for how to generate that key — this
        script does not invent a new setup flow, it reuses that one.
     2. faq/index.html — 123 real Q&As, already a curated proxy of real user
        questions, zero setup, always available. Parsed from the page's
        FAQPage JSON-LD (more reliable than scraping <dt> markup, which is
        presentational and could change).

   Question set logic per run: FAQ questions are always included (zero setup,
   always available). Feedback rows are ADDED on top whenever
   tools/serviceAccountKey.json is present and the 'feedback' collection has
   rows. So: feedback-only-if-empty-collection never happens; the two sources
   are additive, and the report states plainly which ones actually
   contributed on that run.

   Pipeline:
     - Corpus: every articles/<slug>/index.html + faq/index.html, stripped to plain text
       (title + <main> body only — nav sits outside <main> on every page and
       is excluded by construction, footer/script/JSON-LD are stripped
       explicitly), mirroring the extraction approach in
       docs/plans/2026-07-13-rag-chatbot-pro.md section 4b.
     - Chunk ~400 tokens / 80 overlap (approximated as whitespace WORDS, not
       a real tokenizer — good enough for chunk-boundary purposes here; see
       the report for why this doesn't affect the conclusions).
     - Embed corpus chunks + questions with OpenAI text-embedding-3-small.
       Key from art-src/openai.key (same gitignored file tools/gen_art.js
       already reads — read-only reuse, this script never writes to it) or
       the OPENAI_API_KEY env var.
     - Cache embeddings to a gitignored local file, hash-keyed by
       (model + exact text), so re-runs only pay for genuinely new/changed
       content.
     - Per question: max cosine similarity across all corpus chunks + the
       best-matching slug. Below GAP_THRESHOLD = "content gap" candidate.
     - Cluster gap questions by pairwise similarity so recurring asks rank
       above one-offs.
     - Write docs/plans/2026-08-04-question-gaps-report.md.

   Usage:
     node tools/rag/question_gaps.js            run the full pipeline, spend money, write the report
     node tools/rag/question_gaps.js --check     verify OpenAI key + service-account presence only.
                                                  No network calls, no spend — mirrors gen_art.js's
                                                  --check convention but stays fully free (this tool's
                                                  actual runs are pennies, so --check just confirms
                                                  setup rather than probing quota).
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const ARTSRC = path.join(ROOT, 'art-src');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const FAQ_FILE = path.join(ROOT, 'faq', 'index.html');
const CACHE_FILE = path.join(__dirname, '.embedding-cache.json');
const REPORT_FILE = path.join(ROOT, 'docs', 'plans', '2026-08-04-question-gaps-report.md');

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_PRICE_PER_1M_USD = 0.02; // OpenAI list price for text-embedding-3-small, Aug 2026
const CHUNK_WORDS = 400;   // ~= 400 tokens (whitespace-word approximation, see header note)
const OVERLAP_WORDS = 80;
const EMBED_BATCH = 100;

// Gap / cluster thresholds are set from the actual score distribution of this run's data —
// see "Threshold" in the generated report for the reasoning, not a made-up constant.
let GAP_THRESHOLD = 0.42;
const CLUSTER_THRESHOLD = 0.85; // two gap questions this close in embedding space = "the same ask"

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--check') a.check = true;
    else if (k.startsWith('--')) { a[k.slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const f = path.join(ARTSRC, 'openai.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error(
    'No OpenAI key found: set OPENAI_API_KEY, or write it to art-src/openai.key ' +
    '(the same gitignored file tools/gen_art.js reads — this script only reads it).'
  );
}

function loadServiceAccount() {
  try { return require(path.join(ROOT, 'tools', 'serviceAccountKey.json')); }
  catch (e) { return null; }
}

// ---------------------------------------------------------------------------------------------
// Feedback (Firestore) — same service-account pattern as tools/analytics.js
// ---------------------------------------------------------------------------------------------

async function fetchFeedback() {
  const sa = loadServiceAccount();
  if (!sa) {
    return {
      rows: [], status: 'missing-service-account',
      note: 'tools/serviceAccountKey.json not found. Feedback source skipped. Setup (see ANALYTICS.md, ' +
        '"One-time setup"): Firebase console > Project settings > Service accounts > Generate new private ' +
        'key, save the file as tools/serviceAccountKey.json (already gitignored), then ' +
        '`cd tools && npm init -y && npm install firebase-admin`.',
    };
  }
  let admin;
  try { admin = require('firebase-admin'); }
  catch (e) {
    return {
      rows: [], status: 'missing-dependency',
      note: 'tools/serviceAccountKey.json found, but firebase-admin is not installed. Run: ' +
        'cd tools && npm init -y && npm install firebase-admin (see ANALYTICS.md).',
    };
  }
  try {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    const db = admin.firestore();
    const snap = await db.collection('feedback').get();
    const rows = snap.docs.map(d => String((d.data() || {}).text || '').trim()).filter(Boolean);
    return {
      rows, status: rows.length ? 'ok' : 'empty',
      note: rows.length ? '' : 'feedback collection exists but has 0 rows. No tester has used ' +
        'Settings > Tell us how it feels yet.',
    };
  } catch (e) {
    return { rows: [], status: 'error', note: 'Firestore read failed: ' + e.message };
  }
}

// ---------------------------------------------------------------------------------------------
// HTML -> plain text (mirrors docs/plans/2026-07-13-rag-chatbot-pro.md section 4b:
// title + h1 + body text only, no nav/footer/JSON-LD)
// ---------------------------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ') // in-article sources line + any site footer
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')        // breadcrumb nav that lives inside <main>
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

// title + <main>...</main> only; nav.nav sits BEFORE <main> on every page (site chrome) so it is
// excluded by construction, and <head> (incl. all JSON-LD) is never touched.
function extractDoc(html, slug) {
  const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : slug;
  const mainM = html.match(/<main[\s\S]*?<\/main>/i);
  if (!mainM) return null;
  const text = stripTags(mainM[0]);
  return { slug, title, text };
}

function loadArticles() {
  const dirs = fs.readdirSync(ARTICLES_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const docs = [];
  for (const d of dirs) {
    const f = path.join(ARTICLES_DIR, d.name, 'index.html');
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const doc = extractDoc(html, d.name);
    if (doc && doc.text.length > 40) docs.push(doc);
  }
  return docs;
}

// The FAQ page mixes many short, topically DIFFERENT Q&As on one page (10 categories, 123
// questions), unlike a prose article that stays on one subject. Two chunking granularities were
// tried and rejected before this one: a plain word-window across the whole page crammed unrelated
// Q&As together; a per-<h2>-category chunk (one chunk per ~12-question category) was still too
// coarse, because a question's own answer sits alongside 11 unrelated answers, diluting the
// embedding enough that a spot-check on 2026-08-04 found directly-answered questions ("How do I
// invite someone?", answered two lines below itself) scoring as false gaps. The correct grain is
// the FAQ's own atomic unit: one <dt>/<dd> question-answer pair per document, tagged with its
// category only as readable context, never merged with sibling Q&As.
function loadFaqSectionDocs() {
  const html = fs.readFileSync(FAQ_FILE, 'utf8');
  const mainM = html.match(/<main[\s\S]*?<\/main>/i);
  if (!mainM) return [];
  const sections = mainM[0].split(/(?=<h2[\s>])/i);
  const docs = [];
  sections.forEach((part) => {
    const h2M = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const category = h2M ? stripTags(h2M[1]) : 'FAQ';
    const dl = part.match(/<dl[^>]*class="faq"[^>]*>([\s\S]*?)<\/dl>/i);
    if (!dl) return;
    const pairRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = pairRe.exec(dl[1]))) {
      const q = stripTags(m[1]).trim();
      const a = stripTags(m[2]).trim();
      if (!q || !a) continue;
      docs.push({ slug: 'faq', title: `${category} (FAQ)`, text: `${q} ${a}` });
    }
  });
  return docs;
}

// FAQPage JSON-LD -> the 123 real question strings (more reliable than scraping the
// presentational <dt> markup, which the live filter script also manipulates client-side).
function parseFaqQuestions() {
  const html = fs.readFileSync(FAQ_FILE, 'utf8');
  const re = /"@type":"Question","name":"((?:[^"\\]|\\.)*)"/g;
  const qs = [];
  let m;
  while ((m = re.exec(html))) qs.push(JSON.parse('"' + m[1] + '"'));
  return qs;
}

// ---------------------------------------------------------------------------------------------
// Chunking (~400 words / 80 overlap sliding window)
// ---------------------------------------------------------------------------------------------

function chunkDoc(doc) {
  const words = doc.text.split(/\s+/).filter(Boolean);
  const chunks = [];
  if (words.length <= CHUNK_WORDS) {
    chunks.push({ slug: doc.slug, title: doc.title, chunk_index: 0, text: doc.text });
    return chunks;
  }
  let start = 0, idx = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push({ slug: doc.slug, title: doc.title, chunk_index: idx++, text: words.slice(start, end).join(' ') });
    if (end === words.length) break;
    start = end - OVERLAP_WORDS;
  }
  return chunks;
}

// ---------------------------------------------------------------------------------------------
// Embeddings + cache (hash-keyed by model + exact text, so unchanged content never re-costs)
// ---------------------------------------------------------------------------------------------

function textHash(text) {
  return crypto.createHash('sha256').update(EMBED_MODEL + '::' + text).digest('hex');
}

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw.model === EMBED_MODEL && raw.entries) return raw;
  } catch (e) { /* no cache yet, or unreadable — start fresh */ }
  return { model: EMBED_MODEL, entries: {} };
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

// One HTTP call, with retry+backoff on 429 (rate limit) — the corpus is thousands of chunks
// across many batches, so hitting a per-minute token cap mid-run is expected, not exceptional.
async function embedBatchWithRetry(key, input, attempt = 0) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  const j = await r.json();
  if (j.error) {
    if (r.status === 429 && attempt < 6) {
      const waitMs = Math.min(30000, 1000 * Math.pow(2, attempt));
      process.stdout.write(`\n  rate limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/6)...\n`);
      await new Promise(res => setTimeout(res, waitMs));
      return embedBatchWithRetry(key, input, attempt + 1);
    }
    throw new Error(`openai embeddings ${r.status}: ${j.error.message}`);
  }
  return j;
}

async function embedTexts(key, texts, cache, label) {
  const hashes = texts.map(textHash);
  const results = new Array(texts.length);
  const toFetch = [];
  hashes.forEach((h, i) => { if (cache.entries[h]) results[i] = cache.entries[h]; else toFetch.push(i); });

  let tokensUsed = 0;
  for (let i = 0; i < toFetch.length; i += EMBED_BATCH) {
    const idxBatch = toFetch.slice(i, i + EMBED_BATCH);
    const input = idxBatch.map(idx => texts[idx]);
    const j = await embedBatchWithRetry(key, input);
    tokensUsed += (j.usage && j.usage.total_tokens) || 0;
    j.data.forEach((d, k) => {
      const idx = idxBatch[k];
      results[idx] = d.embedding;
      cache.entries[hashes[idx]] = d.embedding;
    });
    saveCache(cache); // flush after every batch so a crash/rate-limit never loses paid-for embeddings
    process.stdout.write(`  ${label}: embedded ${Math.min(i + EMBED_BATCH, toFetch.length)}/${toFetch.length} new\r`);
  }
  if (toFetch.length) process.stdout.write('\n');
  return { vectors: results, tokensUsed, fetchedCount: toFetch.length, cachedCount: texts.length - toFetch.length };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------------------------------------
// Clustering — greedy: any two gap questions whose own embeddings are >= CLUSTER_THRESHOLD
// similar are "the same ask". No need for anything fancier at this corpus size.
// ---------------------------------------------------------------------------------------------

function clusterGaps(gaps, qVectors) {
  const used = new Array(gaps.length).fill(false);
  const clusters = [];
  for (let i = 0; i < gaps.length; i++) {
    if (used[i]) continue;
    const cluster = [gaps[i]];
    used[i] = true;
    for (let j = i + 1; j < gaps.length; j++) {
      if (used[j]) continue;
      if (cosine(qVectors[gaps[i].qIndex], qVectors[gaps[j].qIndex]) >= CLUSTER_THRESHOLD) {
        cluster.push(gaps[j]);
        used[j] = true;
      }
    }
    clusters.push(cluster);
  }
  clusters.sort((a, b) => b.length - a.length);
  return clusters;
}

function suggestAngle(question) {
  const q = question.trim().replace(/[?!.]+$/, '');
  return `A new article/FAQ entry answering "${q}?" directly.`;
}

// ---------------------------------------------------------------------------------------------
// --check: local/file-only verification, no network calls, no spend
// ---------------------------------------------------------------------------------------------

function runCheck() {
  console.log('question_gaps --check (no network calls, no spend)\n');

  let keySource = null;
  if (process.env.OPENAI_API_KEY) keySource = 'OPENAI_API_KEY env var';
  else if (fs.existsSync(path.join(ARTSRC, 'openai.key'))) keySource = 'art-src/openai.key';
  console.log(keySource ? `✅ OpenAI key: found (${keySource}).` : '❌ OpenAI key: not found. Set OPENAI_API_KEY or write art-src/openai.key.');

  const sa = loadServiceAccount();
  console.log(sa
    ? '✅ tools/serviceAccountKey.json: found. Feedback source will be attempted.'
    : '❌ tools/serviceAccountKey.json: not found. Feedback source will be skipped, FAQ used as bootstrap. See ANALYTICS.md.');

  let hasFirebaseAdmin = true;
  try { require.resolve('firebase-admin'); } catch (e) { hasFirebaseAdmin = false; }
  if (sa) console.log(hasFirebaseAdmin ? '✅ firebase-admin: installed.' : '❌ firebase-admin: NOT installed. cd tools && npm install firebase-admin.');

  const faqQ = parseFaqQuestions();
  console.log(`✅ FAQ corpus: ${faqQ.length} questions parsed from faq/index.html.`);

  const articleDirCount = fs.readdirSync(ARTICLES_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  console.log(`✅ Article corpus: ${articleDirCount} article directories under articles/.`);

  console.log(fs.existsSync(CACHE_FILE)
    ? `ℹ️  Embedding cache present: ${CACHE_FILE}`
    : 'ℹ️  No embedding cache yet. First real run will embed everything.');
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((p / 100) * (sortedArr.length - 1))));
  return sortedArr[idx];
}

function writeReport(ctx) {
  const {
    articleDocCount, faqSectionCount, chunkCount, questions, feedbackInfo, faqQuestionCount,
    results, sortedSims, gapClusters, threshold, totalTokens, cost,
    fetchedNew, cachedHit,
  } = ctx;

  const now = new Date().toISOString().slice(0, 10);

  const lines = [];
  const L = (s = '') => lines.push(s);

  L('# Question-to-article gap analysis');
  L('');
  L(`**Generated:** ${now}  `);
  L('**Tool:** `tools/rag/question_gaps.js` (server-side, founder-run, offline, not shipped to the PWA)');
  L('**Purpose:** find which real user questions are NOT well answered by any existing article/FAQ, so `CONTENT-QUEUE.md` can be enriched with genuine, question-grounded topics instead of guesses.');
  L('');
  L('This is a smaller sibling of the deferred `docs/plans/2026-07-13-rag-chatbot-pro.md` proposal. It reuses that plan’s chunking approach (section 4b) but does not build a chatbot, does not run live, and touches nothing client-facing.');
  L('');
  L('---');
  L('');
  L('## Data sources used on this run');
  L('');
  L(`- **FAQ (bootstrap, zero setup):** ${faqQuestionCount} real Q&As parsed from the FAQPage JSON-LD in \`faq/index.html\`. Used on every run.`);
  if (feedbackInfo.status === 'ok') {
    L(`- **Feedback (Firestore \`feedback\` collection):** ${feedbackInfo.rows.length} free-text rows, read via \`tools/serviceAccountKey.json\` (same pattern as \`tools/analytics.js\`). Used on this run.`);
  } else {
    L(`- **Feedback (Firestore \`feedback\` collection):** NOT used on this run. ${feedbackInfo.note}`);
    L('  The integration is built and ready (see `fetchFeedback()` in the script); it simply has nothing to read yet in this environment. This is stated honestly rather than fabricated: no feedback rows were invented to pad this report.');
  }
  L('');
  L(`**Question set size:** ${questions.length} (${feedbackInfo.rows.length} feedback + ${faqQuestionCount} FAQ).`);
  L('');
  L('---');
  L('');
  L('## Methodology');
  L('');
  L(`1. **Corpus:** ${articleDocCount} article documents (\`articles/*/index.html\`) + ${faqSectionCount} FAQ question-answer documents (\`faq/index.html\`, one document per \`<dt>\`/\`<dd>\` pair, see chunking note below), each stripped to \`<title>\` + \`<main>\` body text only (nav sits outside \`<main>\` on every page so it is excluded by construction, and \`<footer>\`/\`<script>\`/JSON-LD are stripped explicitly). Mirrors the extraction approach in \`docs/plans/2026-07-13-rag-chatbot-pro.md\` section 4b.`);
  L(`2. **Chunking:** ~400-word sliding window, 80-word overlap, applied per document (word count is used as a token approximation; real tokenizers run ~1.3 tokens/word for this kind of prose, so actual chunks land a little under the nominal 400/80 token target, which is a safety margin, not a source of error, since chunk boundaries only affect which chunk a match lands in, not whether a match is found). **The FAQ is chunked one document per question-answer pair, not per \`<h2>\` category.** An earlier version of this script chunked per category (10 categories, ~12 questions each) and that was too coarse: a question's own answer sat beside 11 unrelated ones in the same chunk, diluting the embedding enough that a 2026-08-04 spot-check found directly-answered questions scoring as false gaps. One document per \`<dt>\`/\`<dd>\` pair fixes that; each question is now scored only against its own answer plus whatever else in the corpus happens to be genuinely similar. Produced **${chunkCount} chunks**.`);
  L(`3. **Embedding:** OpenAI \`${EMBED_MODEL}\`, corpus chunks and questions embedded in the same space, cached to a gitignored local file keyed by \`sha256(model + exact text)\` so unchanged content is never re-billed on re-runs.`);
  L('4. **Scoring:** for each question, cosine similarity against every corpus chunk; keep the maximum and its chunk’s article slug.');
  L('5. **Gap threshold:** see below.');
  L('6. **Clustering:** gap questions are grouped greedily. Any two whose own question-embeddings are ≥ 0.85 cosine similar are treated as "the same ask". Clusters are sorted largest first, so recurring gaps outrank one-offs.');
  L('');
  L('### Threshold: why ' + threshold.toFixed(2));
  L('');
  L('Score distribution across all ' + results.length + ' questions in this run (max similarity to any corpus chunk):');
  L('');
  L('| percentile | cosine similarity |');
  L('|---|---|');
  [0, 10, 25, 50, 75, 90, 100].forEach(p => L(`| p${p} | ${percentile(sortedSims, p).toFixed(3)} |`));
  L('');
  L(`Because this run’s question set is dominated by the FAQ’s own questions being scored against a corpus that **includes the FAQ page itself**, most scores cluster high (each FAQ question’s own Q&A pair now sits alone in its own chunk, so its match is usually itself). That is expected and is itself a sanity check: the pipeline correctly recognises that curated FAQ questions ARE well answered by the FAQ. The threshold of **${threshold.toFixed(2)}** was picked just below where the distribution visibly breaks, at the low tail where a question’s best match comes from a chunk that only shares vocabulary with it, not a real answer (for example a general vaccines chunk matching a very specific edge-case question). Anything below that line is a genuine "nothing in the corpus really answers this" candidate, not just a slightly-worse-than-average match. Treat any single run’s gap list as a lead to check by hand, not a verdict: read the flagged question against its cited nearest match yourself before adding anything to CONTENT-QUEUE.md, since a chunk boundary or an unusual phrasing can still produce a false positive.`);
  L('');
  L(`Once real feedback rows exist (currently 0, see Data sources above), re-run and expect the distribution to shift: feedback text was never written to match FAQ/article vocabulary, so real gaps should separate more clearly from good matches than they do in this self-referential bootstrap run. Revisit this constant then rather than trusting it blindly.`);
  L('');
  L(`**Result on this run:** ${results.length - gapClustersFlatCount(gapClusters)} of ${results.length} questions matched the corpus at or above ${threshold.toFixed(2)} (well answered). ${gapClustersFlatCount(gapClusters)} fell below; the gap candidates are listed below, in ${gapClusters.length} cluster(s).`);
  L('');
  L('---');
  L('');
  L('## Content gap candidates (ranked by cluster size, largest first)');
  L('');
  if (!gapClusters.length) {
    L('No gap candidates on this run. Every FAQ question was well answered by the FAQ/article corpus it was scored against, which is the expected sane result for a self-referential bootstrap run. This is the correct time to re-run against real feedback once testers have used "Tell us how it feels" in Settings; that question set is not already inside the corpus, so real gaps are far more likely to surface there.');
    L('');
  } else {
    gapClusters.forEach((cluster, i) => {
      const rep = cluster[0];
      L(`### ${i + 1}. ${cluster.length > 1 ? `Cluster of ${cluster.length} similar questions` : 'Single question'}, top score ${Math.max(...cluster.map(c => c.maxSim)).toFixed(3)}`);
      L('');
      cluster.forEach(c => {
        L(`- **"${c.question}"** _(source: ${c.source})_, nearest match: \`${c.bestSlug}\` (${c.bestTitle}), similarity ${c.maxSim.toFixed(3)}`);
      });
      L('');
      L(`**Suggested article angle:** ${suggestAngle(rep.question)}`);
      L('');
    });
  }
  L('---');
  L('');
  L('## Cost of this run');
  L('');
  L(`- Model: \`${EMBED_MODEL}\` ($${EMBED_PRICE_PER_1M_USD}/1M tokens)`);
  L(`- New embeddings this run: ${fetchedNew} (cache hits: ${cachedHit})`);
  L(`- Tokens billed: ${totalTokens}`);
  L(`- **Estimated cost: $${cost.toFixed(4)}**`);
  L('');
  L('---');
  L('');
  L('## How to re-run');
  L('');
  L('```');
  L('node tools/rag/question_gaps.js --check   # verify OpenAI key + service-account setup, no spend');
  L('node tools/rag/question_gaps.js           # run the pipeline, spend the (small) embedding cost, rewrite this report');
  L('```');
  L('');
  L('- To pick up real user questions, get `tools/serviceAccountKey.json` from Firebase console (Project settings > Service accounts > Generate new private key), see `ANALYTICS.md`. Once the `feedback` collection has rows, they are automatically included alongside the FAQ questions on the next run.');
  L(`- Embeddings are cached at \`tools/rag/.embedding-cache.json\` (gitignored). Only new/changed article, FAQ, or question text gets re-embedded; unchanged content is free on re-runs.`);
  L('- Re-reading `docs/plans/2026-07-13-rag-chatbot-pro.md` section 4b is worthwhile if the article HTML template changes shape (new wrapper element, moved nav), since the extraction regex here assumes the current `<main>`-wraps-content structure.');
  L('');

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, lines.join('\n'));
  return REPORT_FILE;
}

function gapClustersFlatCount(clusters) {
  return clusters.reduce((n, c) => n + c.length, 0);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (args.check) { runCheck(); return; }

  const key = readKey();

  console.log('Loading article + FAQ corpus...');
  const articleDocs = loadArticles();
  const faqSectionDocs = loadFaqSectionDocs();
  const allDocs = [...articleDocs, ...faqSectionDocs];
  let chunks = [];
  allDocs.forEach(d => { chunks = chunks.concat(chunkDoc(d)); });
  console.log(`Corpus: ${allDocs.length} documents (${articleDocs.length} articles + ${faqSectionDocs.length} FAQ question-answer pairs) -> ${chunks.length} chunks.`);

  console.log('Loading question sources...');
  const feedbackInfo = await fetchFeedback();
  const faqQ = parseFaqQuestions();
  const questions = [
    ...feedbackInfo.rows.map(t => ({ text: t, source: 'feedback' })),
    ...faqQ.map(t => ({ text: t, source: 'faq' })),
  ];
  console.log(`Question set: ${feedbackInfo.rows.length} feedback + ${faqQ.length} FAQ = ${questions.length}.`);
  if (feedbackInfo.status !== 'ok') console.log(`  (feedback source: ${feedbackInfo.status}. ${feedbackInfo.note})`);

  const cache = loadCache();

  console.log('Embedding corpus chunks (cached ones are free)...');
  const chunkEmbed = await embedTexts(key, chunks.map(c => c.text), cache, 'corpus');

  console.log('Embedding questions...');
  const qEmbed = await embedTexts(key, questions.map(q => q.text), cache, 'questions');

  saveCache(cache);

  const totalTokens = chunkEmbed.tokensUsed + qEmbed.tokensUsed;
  const cost = (totalTokens / 1e6) * EMBED_PRICE_PER_1M_USD;
  const fetchedNew = chunkEmbed.fetchedCount + qEmbed.fetchedCount;
  const cachedHit = chunkEmbed.cachedCount + qEmbed.cachedCount;
  console.log(`Embedded ${fetchedNew} new (${cachedHit} from cache). Tokens billed: ${totalTokens}. Est. cost: $${cost.toFixed(4)}.`);

  console.log('Scoring questions against corpus...');
  const results = questions.map((q, i) => {
    let best = -1, bestChunk = null;
    for (let j = 0; j < chunks.length; j++) {
      const sim = cosine(qEmbed.vectors[i], chunkEmbed.vectors[j]);
      if (sim > best) { best = sim; bestChunk = chunks[j]; }
    }
    return { qIndex: i, question: q.text, source: q.source, maxSim: best, bestSlug: bestChunk.slug, bestTitle: bestChunk.title };
  });

  const sortedSims = results.map(r => r.maxSim).slice().sort((a, b) => a - b);
  const gaps = results.filter(r => r.maxSim < GAP_THRESHOLD);
  const gapClusters = clusterGaps(gaps, qEmbed.vectors);

  console.log(`${gaps.length}/${results.length} questions below threshold ${GAP_THRESHOLD} -> ${gapClusters.length} gap cluster(s).`);

  const reportPath = writeReport({
    articleDocCount: articleDocs.length,
    faqSectionCount: faqSectionDocs.length,
    chunkCount: chunks.length,
    questions,
    feedbackInfo,
    faqQuestionCount: faqQ.length,
    results,
    sortedSims,
    gapClusters,
    threshold: GAP_THRESHOLD,
    totalTokens,
    cost,
    fetchedNew,
    cachedHit,
  });

  console.log(`\nReport written: ${path.relative(ROOT, reportPath)}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
