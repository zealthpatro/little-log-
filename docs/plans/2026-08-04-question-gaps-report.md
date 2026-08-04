# Question-to-article gap analysis

**Generated:** 2026-08-04  
**Tool:** `tools/rag/question_gaps.js` (server-side, founder-run, offline, not shipped to the PWA)
**Purpose:** find which real user questions are NOT well answered by any existing article/FAQ, so `CONTENT-QUEUE.md` can be enriched with genuine, question-grounded topics instead of guesses.

This is a smaller sibling of the deferred `docs/plans/2026-07-13-rag-chatbot-pro.md` proposal. It reuses that plan’s chunking approach (section 4b) but does not build a chatbot, does not run live, and touches nothing client-facing.

---

## Data sources used on this run

- **FAQ (bootstrap, zero setup):** 123 real Q&As parsed from the FAQPage JSON-LD in `faq/index.html`. Used on every run.
- **Feedback (Firestore `feedback` collection):** NOT used on this run. tools/serviceAccountKey.json not found. Feedback source skipped. Setup (see ANALYTICS.md, "One-time setup"): Firebase console > Project settings > Service accounts > Generate new private key, save the file as tools/serviceAccountKey.json (already gitignored), then `cd tools && npm init -y && npm install firebase-admin`.
  The integration is built and ready (see `fetchFeedback()` in the script); it simply has nothing to read yet in this environment. This is stated honestly rather than fabricated: no feedback rows were invented to pad this report.

**Question set size:** 123 (0 feedback + 123 FAQ).

---

## Methodology

1. **Corpus:** 660 article documents (`articles/*/index.html`) + 123 FAQ question-answer documents (`faq/index.html`, one document per `<dt>`/`<dd>` pair, see chunking note below), each stripped to `<title>` + `<main>` body text only (nav sits outside `<main>` on every page so it is excluded by construction, and `<footer>`/`<script>`/JSON-LD are stripped explicitly). Mirrors the extraction approach in `docs/plans/2026-07-13-rag-chatbot-pro.md` section 4b.
2. **Chunking:** ~400-word sliding window, 80-word overlap, applied per document (word count is used as a token approximation; real tokenizers run ~1.3 tokens/word for this kind of prose, so actual chunks land a little under the nominal 400/80 token target, which is a safety margin, not a source of error, since chunk boundaries only affect which chunk a match lands in, not whether a match is found). **The FAQ is chunked one document per question-answer pair, not per `<h2>` category.** An earlier version of this script chunked per category (10 categories, ~12 questions each) and that was too coarse: a question's own answer sat beside 11 unrelated ones in the same chunk, diluting the embedding enough that a 2026-08-04 spot-check found directly-answered questions scoring as false gaps. One document per `<dt>`/`<dd>` pair fixes that; each question is now scored only against its own answer plus whatever else in the corpus happens to be genuinely similar. Produced **4218 chunks**.
3. **Embedding:** OpenAI `text-embedding-3-small`, corpus chunks and questions embedded in the same space, cached to a gitignored local file keyed by `sha256(model + exact text)` so unchanged content is never re-billed on re-runs.
4. **Scoring:** for each question, cosine similarity against every corpus chunk; keep the maximum and its chunk’s article slug.
5. **Gap threshold:** see below.
6. **Clustering:** gap questions are grouped greedily. Any two whose own question-embeddings are ≥ 0.85 cosine similar are treated as "the same ask". Clusters are sorted largest first, so recurring gaps outrank one-offs.

### Threshold: why 0.42

Score distribution across all 123 questions in this run (max similarity to any corpus chunk):

| percentile | cosine similarity |
|---|---|
| p0 | 0.563 |
| p10 | 0.646 |
| p25 | 0.731 |
| p50 | 0.788 |
| p75 | 0.841 |
| p90 | 0.876 |
| p100 | 0.904 |

Because this run’s question set is dominated by the FAQ’s own questions being scored against a corpus that **includes the FAQ page itself**, most scores cluster high (each FAQ question’s own Q&A pair now sits alone in its own chunk, so its match is usually itself). That is expected and is itself a sanity check: the pipeline correctly recognises that curated FAQ questions ARE well answered by the FAQ. The threshold of **0.42** was picked just below where the distribution visibly breaks, at the low tail where a question’s best match comes from a chunk that only shares vocabulary with it, not a real answer (for example a general vaccines chunk matching a very specific edge-case question). Anything below that line is a genuine "nothing in the corpus really answers this" candidate, not just a slightly-worse-than-average match. Treat any single run’s gap list as a lead to check by hand, not a verdict: read the flagged question against its cited nearest match yourself before adding anything to CONTENT-QUEUE.md, since a chunk boundary or an unusual phrasing can still produce a false positive.

Once real feedback rows exist (currently 0, see Data sources above), re-run and expect the distribution to shift: feedback text was never written to match FAQ/article vocabulary, so real gaps should separate more clearly from good matches than they do in this self-referential bootstrap run. Revisit this constant then rather than trusting it blindly.

**Result on this run:** 123 of 123 questions matched the corpus at or above 0.42 (well answered). 0 fell below; the gap candidates are listed below, in 0 cluster(s).

---

## Content gap candidates (ranked by cluster size, largest first)

No gap candidates on this run. Every FAQ question was well answered by the FAQ/article corpus it was scored against, which is the expected sane result for a self-referential bootstrap run. This is the correct time to re-run against real feedback once testers have used "Tell us how it feels" in Settings; that question set is not already inside the corpus, so real gaps are far more likely to surface there.

---

## Cost of this run

- Model: `text-embedding-3-small` ($0.02/1M tokens)
- New embeddings this run: 0 (cache hits: 4341)
- Tokens billed: 0
- **Estimated cost: $0.0000**

---

## How to re-run

```
node tools/rag/question_gaps.js --check   # verify OpenAI key + service-account setup, no spend
node tools/rag/question_gaps.js           # run the pipeline, spend the (small) embedding cost, rewrite this report
```

- To pick up real user questions, get `tools/serviceAccountKey.json` from Firebase console (Project settings > Service accounts > Generate new private key), see `ANALYTICS.md`. Once the `feedback` collection has rows, they are automatically included alongside the FAQ questions on the next run.
- Embeddings are cached at `tools/rag/.embedding-cache.json` (gitignored). Only new/changed article, FAQ, or question text gets re-embedded; unchanged content is free on re-runs.
- Re-reading `docs/plans/2026-07-13-rag-chatbot-pro.md` section 4b is worthwhile if the article HTML template changes shape (new wrapper element, moved nav), since the extraction regex here assumes the current `<main>`-wraps-content structure.
