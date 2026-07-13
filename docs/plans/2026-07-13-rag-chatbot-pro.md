# Cubby Pro Chat: RAG Chatbot Infrastructure Proposal

**Date:** 2026-07-13  
**Scope:** Pro-tier conversational AI for pregnancy and baby care queries  
**Status:** Proposal (not yet built)

---

## 1. What it is

A streaming chat widget available only to Cubby Pro subscribers. It answers questions about the Cubby app and about pregnancy, baby care, and the first two years of parenting. It does not give medical advice, does not attribute to sources, and knows nothing about Cubby's internal business.

---

## 2. Guardrails (non-negotiable, defined before architecture)

| Rule | Implementation |
|------|---------------|
| No medical diagnosis | System prompt hard rule + response filter |
| No treatment/dosing advice | System prompt hard rule + topic classifier |
| No source attribution | System prompt instructs: never say "according to NHS/AAP/etc." |
| No Cubby internal info | Retrieved context contains only public article content; no access to pricing logic, internal docs, or proprietary data |
| No off-topic content | Topic classifier routes off-topic to a short refusal |
| Pro-only | Firebase auth check before any chat request reaches the worker |
| Warm tone only | System prompt persona: calm, knowledgeable friend |

**Medical escalation pattern:** For any question touching dosing, diagnosis, treatment, emergency signs, or prescriptions, the response ends with: "This is worth checking with your midwife, health visitor, or GP."

---

## 3. Architecture overview

```
[App (Pro user)]
      |
      | POST /api/chat  (Firebase ID token in Authorization header)
      |
[Cloudflare Worker: cubby-chat]
      |
      |-- 1. Verify Firebase ID token (isPro check)
      |-- 2. Embed user query (Workers AI: @cf/baai/bge-small-en-v1.5)
      |-- 3. Query Cloudflare Vectorize (top 5 chunks)
      |-- 4. Build prompt (system + context + conversation history + query)
      |-- 5. Stream Claude response (claude-haiku-4-5 via Anthropic API)
      |-- 6. Apply post-process filter (medical escalation injection)
      |-- 7. Stream SSE back to client
      |
[Client]  renders streaming tokens
```

---

## 4. Knowledge base

### 4a. Content sources (what goes into the vector DB)

| Source | Format | Volume |
|--------|--------|--------|
| All Cubby articles (`articles/*/index.html`) | HTML stripped to plain text | ~570 articles, ~3000 chunks |
| App feature documentation (how-to content) | Plain text docs we write | ~30 documents |
| General pregnancy/baby reference (curated) | Plain text, written by us, no external attribution | ~50 documents |

**What does NOT go in:**
- Pricing, billing, or commercial terms
- Internal post-mortems or design docs
- Firestore rules or code
- Any user data

### 4b. Chunking strategy

- Chunk size: 400 tokens
- Overlap: 80 tokens
- Metadata stored per chunk: `slug`, `title`, `data-cat`, `data-age`, `chunk_index`
- Filtering at query time: optionally narrow by `data-age` using user's baby age from their Cubby profile

### 4c. Ingestion pipeline

```
tools/rag/ingest.js
  reads articles/*.html
  strips HTML (title + h1 + body text only, no nav/footer/JSON-LD)
  splits into chunks
  embeds each chunk (Workers AI or OpenAI)
  upserts to Cloudflare Vectorize with metadata
  tracks last-modified hash for incremental updates
  run: node tools/rag/ingest.js [--full | --since <date>]
```

Run on every deploy that adds articles. Target: under 2 minutes for incremental, under 20 minutes for full rebuild.

---

## 5. System prompt

```
You are Cubby's parenting companion. You help parents navigate pregnancy, baby care,
infant feeding, sleep, development, and the first two years of a child's life.

You also help users understand how to use the Cubby app.

Rules you follow without exception:
- Never give a medical diagnosis, suggest a specific treatment, or recommend a dose.
  If a question requires that level of medical specificity, say: "This is worth
  discussing with your midwife, health visitor, or GP."
- Never attribute information to a named organisation, study, guideline, or person.
  Speak from knowledge, not from source names.
- Never discuss Cubby's internal systems, pricing, business operations,
  technical infrastructure, or anything that is not visible to app users.
- If a question is completely outside pregnancy, baby care, or using the Cubby app
  (e.g. cooking, finance, sport), say warmly: "I am here to help with pregnancy,
  baby care, and Cubby. I am not the right place for [topic]."
- Tone: warm, calm, non-judgemental, second person. No jargon. No em-dashes.
  Write as if you are a knowledgeable friend, not a clinician.
- Keep responses concise. One or two short paragraphs for most questions.
  Use a short bullet list only when multiple distinct items would genuinely help.

Context from the Cubby article library is provided below. Use it to ground your answer.
If the context is not relevant to the question, answer from general knowledge within
the rules above.
```

---

## 6. Query pipeline (per request)

1. **Auth gate:** verify `Authorization: Bearer <Firebase ID token>`. Check `isPro()`. Reject with 403 if not Pro.
2. **Rate limit:** 20 messages per user per day (KV counter keyed by UID). Return 429 with friendly message.
3. **Topic pre-filter:** lightweight regex check for clear out-of-scope content (financial advice, legal advice, cooking unrelated to baby food). Short-circuit before embedding if triggered.
4. **Embed query:** `@cf/baai/bge-small-en-v1.5` via Workers AI (free tier on Cloudflare).
5. **Retrieve chunks:** Cloudflare Vectorize, `topK=5`, optional metadata filter by age.
6. **Build prompt:** system prompt + retrieved chunks (formatted as `[Context]\n...\n[/Context]`) + last 4 conversation turns + user message.
7. **Generate:** `claude-haiku-4-5` via Anthropic API, streaming, max 500 output tokens.
8. **Medical escalation filter:** scan response for phrases triggering a soft injection at the end ("This is worth discussing with your midwife, health visitor, or GP."). Triggers on: dosing, diagnosis, treatment, prescription, emergency, specific medication names.
9. **Stream SSE** back to client.

---

## 7. Conversation memory

- Short-term only: last 4 turns stored client-side in `sessionStorage`.
- No server-side conversation persistence (privacy, no Cloud Functions constraint).
- Session resets on page refresh.
- Each turn sent as full conversation array to the worker.

---

## 8. Personalisation

The user's Cubby profile (from their synced blob) contains:
- `stage`: ttc / expecting / baby / child
- `babyAgeWeeks` or `dueDate`
- `babyName` (optional)

On chat widget initialisation, the app passes these as a short context prefix injected into the system prompt:

```
User context: stage=expecting, due in 8 weeks, first pregnancy.
```

This allows the retrieval filter to bias toward age-appropriate chunks (e.g. third-trimester content for a user 8 weeks from due date) and allows the response to feel personalised ("At 32 weeks...") without any PII leaving the device beyond what the auth token already carries.

---

## 9. Frontend widget

File: `app/chat.js` (deferred, Pro-only lazy load)

```
- Floating button bottom-right on all /app/ pages
- Only rendered if isPro() === true (client check, server enforces)
- Slide-up panel, full-height on mobile
- Input: text area, send on Enter or button
- Messages: user bubble right, Cubby bubble left with bear avatar
- Streaming: token-by-token rendering via SSE
- Session history: last 5 exchanges visible, scroll
- Clear session button
- "This is not medical advice" persistent footer notice
```

---

## 10. Cost model

| Item | Unit cost | At 100 Pro users, 10 turns/day |
|------|-----------|-------------------------------|
| Embedding (Workers AI) | Free tier covers ~10k/day | Free |
| Vectorize queries | $0.04/1M | Negligible (<$1/month) |
| Claude Haiku 4.5 | ~$1/MTok input, $5/MTok output | ~500 tok input, 250 tok output per turn = $25/day output + $12.50 input = ~$37/day |
| Vectorize storage | $0.05/1M vectors, ~3000 vectors | $0.00015/month |

**Revenue offset:** 100 Pro users at $9/month = $900/month revenue. Chat cost ~$1,100/month at this volume. This inverts above ~150 users where it becomes net positive. Haiku 4.5 is the right model (not Sonnet) to keep cost viable.

**Rate limiting is critical:** 20 turns/user/day cap keeps worst-case to $74/day at 100 users.

---

## 11. Build phases

### Phase 1: Foundation (2-3 days)
- [ ] `tools/rag/ingest.js`: chunker + embedder + Vectorize upsert
- [ ] `workers/cubby-chat/index.js`: auth gate + embed + retrieve + Claude stream
- [ ] System prompt finalised
- [ ] Manual testing with 10 representative queries

### Phase 2: Widget (1-2 days)
- [ ] `app/chat.js`: floating button + chat panel + SSE rendering
- [ ] Pro gate in client
- [ ] Rate limit KV setup

### Phase 3: Personalisation (1 day)
- [ ] Pass stage/age context on widget init
- [ ] Age-filtered retrieval

### Phase 4: Monitoring (ongoing)
- [ ] Log query count per user to Firestore (not the query text, just the count)
- [ ] Alert when daily total crosses 80% of cost budget
- [ ] Manual review of first 50 conversations (opt-in consent required)

---

## 12. Privacy

- User queries are NOT stored server-side.
- The worker receives the query, processes it, streams the response, and forgets. No Firestore write of conversation content.
- Rate limit counter in KV contains only UID + date + count.
- If usage logging is added later (for quality improvement), it requires explicit user consent (opt-in checkbox in chat widget settings).
- Conversation context is sent from client each turn; server is stateless.
- The knowledge base contains only Cubby's own public article content. No external PII.

---

## 13. Open questions before build

1. **Cloudflare Workers AI quota**: confirm BGE-small is available on current plan, or switch to OpenAI text-embedding-3-small (costs ~$0.02/1M tokens, negligible).
2. **Pro auth token**: confirm `isPro()` can be called synchronously from the Worker with just a Firebase ID token, or if it needs a Firestore read (adds ~50ms latency).
3. **Content consent**: do we need to display a consent notice before the first chat session? UAE PDPL context: minimal PII involved (no query storage), auth token only. Legal call.
4. **Moderation layer**: consider passing responses through Anthropic's built-in moderation or a Cloudflare AI safety model before streaming to user.
5. **Haiku vs Sonnet**: Haiku is the right default for cost. Upgrade path: if Pro grows to 500+ users and revenue covers it, Sonnet for higher-quality answers.
