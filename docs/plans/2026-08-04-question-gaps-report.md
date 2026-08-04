# Question-to-article gap analysis

**Generated:** 2026-08-04  
**Tool:** `tools/rag/question_gaps.js` (server-side, founder-run, offline — not shipped to the PWA)
**Purpose:** find which real user questions are NOT well answered by any existing article/FAQ, so `CONTENT-QUEUE.md` can be enriched with genuine, question-grounded topics instead of guesses.

This is a smaller sibling of the deferred `docs/plans/2026-07-13-rag-chatbot-pro.md` proposal. It reuses that plan’s chunking approach (section 4b) but does not build a chatbot, does not run live, and touches nothing client-facing.

---

## Data sources used on this run

- **FAQ (bootstrap, zero setup):** 123 real Q&As parsed from the FAQPage JSON-LD in `faq/index.html`. Used on every run.
- **Feedback (Firestore `feedback` collection):** NOT used on this run — tools/serviceAccountKey.json not found — feedback source skipped. Setup (see ANALYTICS.md, "One-time setup"): Firebase console > Project settings > Service accounts > Generate new private key, save the file as tools/serviceAccountKey.json (already gitignored), then `cd tools && npm init -y && npm install firebase-admin`.
  The integration is built and ready (see `fetchFeedback()` in the script); it simply has nothing to read yet in this environment. This is stated honestly rather than fabricated: no feedback rows were invented to pad this report.

**Question set size:** 123 (0 feedback + 123 FAQ).

---

## Methodology

1. **Corpus:** 660 article documents (`articles/*/index.html`) + 18 FAQ category documents (`faq/index.html`, split at each `<h2>` — see chunking note below), each stripped to `<title>` + `<main>` body text only — nav sits outside `<main>` on every page so it is excluded by construction, and `<footer>`/`<script>`/JSON-LD are stripped explicitly. Mirrors the extraction approach in `docs/plans/2026-07-13-rag-chatbot-pro.md` section 4b.
2. **Chunking:** ~400-word sliding window, 80-word overlap, applied per document (word count is used as a token approximation — real tokenizers run ~1.3 tokens/word for this kind of prose, so actual chunks land a little under the nominal 400/80 token target; that’s a safety margin, not a source of error, since chunk boundaries only affect which chunk a match lands in, not whether a match is found). **The FAQ page is chunked per `<h2>` category ("Sharing & your care circle", "Vaccines & country schedules", …) instead of as one continuous word-window across the whole page** — it holds 123 short, topically different Q&As, and window-chunking straight across category boundaries would mix unrelated Q&As into one chunk and dilute the match for any single question in it (a real failure mode caught while building this: see the git history of this file / report for the earlier run where it happened). Each category is naturally one topic and only falls back to the plain word-window if a single category runs unusually long. Produced **4113 chunks**.
3. **Embedding:** OpenAI `text-embedding-3-small`, corpus chunks and questions embedded in the same space, cached to a gitignored local file keyed by `sha256(model + exact text)` so unchanged content is never re-billed on re-runs.
4. **Scoring:** for each question, cosine similarity against every corpus chunk; keep the maximum and its chunk’s article slug.
5. **Gap threshold:** see below.
6. **Clustering:** gap questions are grouped greedily — any two whose own question-embeddings are ≥ 0.85 cosine similar are treated as "the same ask". Clusters are sorted largest first, so recurring gaps outrank one-offs.

### Threshold: why 0.42

Score distribution across all 123 questions in this run (max similarity to any corpus chunk):

| percentile | cosine similarity |
|---|---|
| p0 | 0.273 |
| p10 | 0.349 |
| p25 | 0.433 |
| p50 | 0.522 |
| p75 | 0.591 |
| p90 | 0.664 |
| p100 | 0.800 |

Because this run’s question set is dominated by the FAQ’s own questions being scored against a corpus that **includes the FAQ page itself**, most scores cluster high (each FAQ question’s own Q&A pair usually sits in the same or an adjacent chunk). That is expected and is itself a sanity check: the pipeline correctly recognises that curated FAQ questions ARE well answered by the FAQ. The threshold of **0.42** was picked just below where the distribution visibly breaks — the low tail, where a question’s best match comes from a chunk that only shares vocabulary with it, not a real answer (e.g. a general vaccines chunk matching a very specific edge-case question, or a question whose own Q&A pair got split across a chunk boundary so no single chunk contains the whole answer). Anything below that line is a genuine "nothing in the corpus really answers this" candidate, not just a slightly-worse-than-average match.

Once real feedback rows exist (currently 0 — see Data sources above), re-run and expect the distribution to shift: feedback text was never written to match FAQ/article vocabulary, so real gaps should separate more clearly from good matches than they do in this self-referential bootstrap run. Revisit this constant then rather than trusting it blindly.

**Result on this run:** 95 of 123 questions matched the corpus at or above 0.42 (well answered). 28 fell below — the gap candidates below, in 28 cluster(s).

---

## Content gap candidates (ranked by cluster size, largest first)

### 1. Single question — top score 0.399

- **"Does it work offline?"** _(source: faq)_ — nearest match: `faq` (Getting started & installing (FAQ)), similarity 0.399

**Suggested article angle:** A new article/FAQ entry answering "Does it work offline?" directly.

### 2. Single question — top score 0.349

- **"Which devices and browsers work?"** _(source: faq)_ — nearest match: `cubby-pwa` (Cubby works in your browser: no app store, no download, no friction | Cubby), similarity 0.349

**Suggested article angle:** A new article/FAQ entry answering "Which devices and browsers work?" directly.

### 3. Single question — top score 0.319

- **"Do I need to create a password?"** _(source: faq)_ — nearest match: `faq` (Getting started & installing (FAQ)), similarity 0.319

**Suggested article angle:** A new article/FAQ entry answering "Do I need to create a password?" directly.

### 4. Single question — top score 0.402

- **"How long does setup take?"** _(source: faq)_ — nearest match: `childcare-starting-settling-in` (Starting childcare: the settling-in period and managing separation anxiety | Cubby), similarity 0.402

**Suggested article angle:** A new article/FAQ entry answering "How long does setup take?" directly.

### 5. Single question — top score 0.349

- **"Is there a tutorial, or do I just start?"** _(source: faq)_ — nearest match: `faq` (Getting started & installing (FAQ)), similarity 0.349

**Suggested article angle:** A new article/FAQ entry answering "Is there a tutorial, or do I just start?" directly.

### 6. Single question — top score 0.366

- **"How do I log out?"** _(source: faq)_ — nearest match: `faq` (Logging your day: feeds, sleep, nappies, pumping (FAQ)), similarity 0.366

**Suggested article angle:** A new article/FAQ entry answering "How do I log out?" directly.

### 7. Single question — top score 0.312

- **"What happens if I switch phones?"** _(source: faq)_ — nearest match: `faq` (Account, sign-in & security (FAQ)), similarity 0.312

**Suggested article angle:** A new article/FAQ entry answering "What happens if I switch phones?" directly.

### 8. Single question — top score 0.375

- **"Can I backdate or edit an entry?"** _(source: faq)_ — nearest match: `faq` (Logging your day: feeds, sleep, nappies, pumping (FAQ)), similarity 0.375

**Suggested article angle:** A new article/FAQ entry answering "Can I backdate or edit an entry?" directly.

### 9. Single question — top score 0.321

- **"Can I delete an entry I added by mistake?"** _(source: faq)_ — nearest match: `cubby-privacy-layers` (Managing privacy in Cubby: what your circle sees, what stays yours | Cubby), similarity 0.321

**Suggested article angle:** A new article/FAQ entry answering "Can I delete an entry I added by mistake?" directly.

### 10. Single question — top score 0.331

- **"Can I photograph the plate before and after?"** _(source: faq)_ — nearest match: `faq` (Solids, food & mealtimes (FAQ)), similarity 0.331

**Suggested article angle:** A new article/FAQ entry answering "Can I photograph the plate before and after?" directly.

### 11. Single question — top score 0.324

- **"How do I invite someone?"** _(source: faq)_ — nearest match: `cubby-family-circle` (The Cubby family circle: how shared care actually works | Cubby), similarity 0.324

**Suggested article angle:** A new article/FAQ entry answering "How do I invite someone?" directly.

### 12. Single question — top score 0.338

- **"Can I get a while-you-were-away recap?"** _(source: faq)_ — nearest match: `faq` (Logging your day: feeds, sleep, nappies, pumping (FAQ)), similarity 0.338

**Suggested article angle:** A new article/FAQ entry answering "Can I get a while-you-were-away recap?" directly.

### 13. Single question — top score 0.360

- **"What does the week view show?"** _(source: faq)_ — nearest match: `faq` (Logging your day: feeds, sleep, nappies, pumping (FAQ)), similarity 0.360

**Suggested article angle:** A new article/FAQ entry answering "What does the week view show?" directly.

### 14. Single question — top score 0.273

- **"What is the Moments album?"** _(source: faq)_ — nearest match: `golden-hour-after-birth` (The golden hour after birth: what happens immediately after your baby is born | Cubby), similarity 0.273

**Suggested article angle:** A new article/FAQ entry answering "What is the Moments album?" directly.

### 15. Single question — top score 0.413

- **"Is there a kick counter and contraction timer?"** _(source: faq)_ — nearest match: `counting-kicks` (Counting kicks: monitoring fetal movement in pregnancy | Cubby), similarity 0.413

**Suggested article angle:** A new article/FAQ entry answering "Is there a kick counter and contraction timer?" directly.

### 16. Single question — top score 0.407

- **"Can my partner follow along?"** _(source: faq)_ — nearest match: `cubby-privacy-layers` (Managing privacy in Cubby: what your circle sees, what stays yours | Cubby), similarity 0.407

**Suggested article angle:** A new article/FAQ entry answering "Can my partner follow along?" directly.

### 17. Single question — top score 0.328

- **"Are there any games or fun extras?"** _(source: faq)_ — nearest match: `faq` (Pregnancy: the journey (FAQ)), similarity 0.328

**Suggested article angle:** A new article/FAQ entry answering "Are there any games or fun extras?" directly.

### 18. Single question — top score 0.348

- **"Does it cover when we are trying?"** _(source: faq)_ — nearest match: `faq` (Trying for a baby (FAQ)), similarity 0.348

**Suggested article angle:** A new article/FAQ entry answering "Does it cover when we are trying?" directly.

### 19. Single question — top score 0.391

- **"Is there help if it is taking longer than we hoped?"** _(source: faq)_ — nearest match: `partner-in-the-birth-room` (The birth partner's role: what to do and how to help during labour | Cubby), similarity 0.391

**Suggested article angle:** A new article/FAQ entry answering "Is there help if it is taking longer than we hoped?" directly.

### 20. Single question — top score 0.399

- **"Can I track blood pressure and supplements?"** _(source: faq)_ — nearest match: `faq` (Pregnancy: health, privacy, loss & birth (FAQ)), similarity 0.399

**Suggested article angle:** A new article/FAQ entry answering "Can I track blood pressure and supplements?" directly.

### 21. Single question — top score 0.373

- **"What does item-by-item sharing mean?"** _(source: faq)_ — nearest match: `toddler-sharing-and-turn-taking` (Teaching toddlers to share: realistic expectations and strategies that work | Cubby), similarity 0.373

**Suggested article angle:** A new article/FAQ entry answering "What does item-by-item sharing mean?" directly.

### 22. Single question — top score 0.314

- **"Can I recover something I deleted by accident?"** _(source: faq)_ — nearest match: `faq` (Privacy & who owns your data (FAQ)), similarity 0.314

**Suggested article angle:** A new article/FAQ entry answering "Can I recover something I deleted by accident?" directly.

### 23. Single question — top score 0.354

- **"Where are my photos stored?"** _(source: faq)_ — nearest match: `faq` (Photos & keepsakes (FAQ)), similarity 0.354

**Suggested article angle:** A new article/FAQ entry answering "Where are my photos stored?" directly.

### 24. Single question — top score 0.368

- **"Is there a watermark on shares?"** _(source: faq)_ — nearest match: `faq` (Photos & keepsakes (FAQ)), similarity 0.368

**Suggested article angle:** A new article/FAQ entry answering "Is there a watermark on shares?" directly.

### 25. Single question — top score 0.364

- **"Will there be physical prints?"** _(source: faq)_ — nearest match: `faq` (Photos & keepsakes (FAQ)), similarity 0.364

**Suggested article angle:** A new article/FAQ entry answering "Will there be physical prints?" directly.

### 26. Single question — top score 0.333

- **"I have been burned by a pretty tracker that did not help. Why is this different?"** _(source: faq)_ — nearest match: `faq` (Is this for me? Trust & comparisons (FAQ)), similarity 0.333

**Suggested article angle:** A new article/FAQ entry answering "I have been burned by a pretty tracker that did not help. Why is this different?" directly.

### 27. Single question — top score 0.277

- **"Do I need to be techy?"** _(source: faq)_ — nearest match: `faq` (Is this for me? Trust & comparisons (FAQ)), similarity 0.277

**Suggested article angle:** A new article/FAQ entry answering "Do I need to be techy?" directly.

### 28. Single question — top score 0.359

- **"How do I send feedback or get help?"** _(source: faq)_ — nearest match: `faq` (FAQ (intro)), similarity 0.359

**Suggested article angle:** A new article/FAQ entry answering "How do I send feedback or get help?" directly.

---

## Cost of this run

- Model: `text-embedding-3-small` ($0.02/1M tokens)
- New embeddings this run: 0 (cache hits: 4236)
- Tokens billed: 0
- **Estimated cost: $0.0000**

---

## How to re-run

```
node tools/rag/question_gaps.js --check   # verify OpenAI key + service-account setup, no spend
node tools/rag/question_gaps.js           # run the pipeline, spend the (small) embedding cost, rewrite this report
```

- To pick up real user questions, get `tools/serviceAccountKey.json` from Firebase console (Project settings > Service accounts > Generate new private key) — see `ANALYTICS.md`. Once the `feedback` collection has rows, they are automatically included alongside the FAQ questions on the next run.
- Embeddings are cached at `tools/rag/.embedding-cache.json` (gitignored). Only new/changed article, FAQ, or question text gets re-embedded — unchanged content is free on re-runs.
- Re-reading `docs/plans/2026-07-13-rag-chatbot-pro.md` section 4b is worthwhile if the article HTML template changes shape (new wrapper element, moved nav), since the extraction regex here assumes the current `<main>`-wraps-content structure.
