# Voice logging — design & Pro-gating decision (2026-07-09)

## The question
"Is Cubby agent friendly, and how do we make it voice-input compatible? Explore
options, decide whether to build, and whether it goes behind the Pro wall."

## Resolution (decided)
**Build it. Ship v1.** Voice logging is already the #1 advertised Pro feature
(`app/index.html` `openPro()` — "🎙️ Voice logging & notes") but was never built.
This closes a sold-but-missing promise.

Two capabilities were conflated in the ask; we separate them:

- **Voice input (BUILD NOW):** the parent *speaks*, Cubby writes the entry.
  Hands-free for the arms-full 3am moment. In-app. This is where ~95% of the value is.
- **External-agent driveable (PARK, v3):** Siri / ChatGPT / Alexa / an MCP server
  reads-writes Cubby. Needs a public per-user API + auth tokens; no Cloud Functions
  today; a stressed parent does not need Siri hitting the DB. Deliberately out of scope.

## Stack (chosen)
Speech → text (ASR), then text → structured event (parse). The event model already
exists: `commitEvent({type,...})`.

- **ASR: Web Speech API** (`webkitSpeechRecognition` / `SpeechRecognition`).
  Zero infra, no key, no billing, works today. Trade-offs accepted:
  - Privacy: on Chrome/Android the audio is sent to Google. This dents the
    "no third-party" promise, so we **disclose it plainly in the mic sheet** and
    prefer the platform's on-device path (iOS) where available. Escape hatch for a
    true-local claim later = wasm Whisper.
  - Coverage: flaky in some installed iOS PWAs. We **feature-detect and degrade
    gracefully** to the existing note logger when unsupported.
- **Parse: rule grammar (regex), pure + testable.** The baby-log vocabulary is
  small and numeric ("fed 120ml", "wet diaper", "napped 2 hours"), so a
  deterministic grammar is accurate, free, offline, and private. LLM/Whisper parse
  is a later upgrade only if accuracy demands it.

Scope of v1 grammar: **feed** (breast/bottle/water), **diaper** (wet/dirty/both/dry),
**sleep** (start / "slept N hours" / woke), **pump**. Temperature/medicine are
*medical* — excluded from v1 to keep the risk surface small.

## Non-negotiable safety rail (charter / Anxiety Test)
**Never auto-commit a heard entry.** A misheard "20ml" vs "120ml" corrupts a *health*
log. Flow is always: speak → parse → **confirmation preview** ("Bottle · 120ml · now
— Save?") → one tap. "Not right?" reopens the matching manual sheet so the fix happens
in the trusted UI. If nothing parses, the transcript is offered as a free note.

## Pro-wall decision
Positioned as Pro since launch. Decision:

- **Smart parse → structured event = Pro**, with a **generous free taste** (reuses the
  existing `PRO_TASTE` / `useTaste()` pattern). Try-before-buy, consistent with every
  other Pro treat.
- **Free floor = plain dictate-a-note.** Voice is genuinely an *accessibility* feature
  (one-handed, low-vision, motor). Gating pure accessibility behind a paywall is bad
  ethics and bad PR. So anyone can always speak and save a note for free; Pro is the
  *smart* structured logging, not access to the microphone.

## Build shape
- New file `app/voice-log.js` (keeps `index.html` from bloating; same pattern as the
  other app JS). Pure `parseVoice(text, nowMs)` + a mic sheet + confirm preview.
- Wire: `<script>` include, `sw.js` ASSETS + CACHE bump, a "🎙️ Say it" tile in the
  log action grid.
- Verify: node-run parser test matrix (utterances → expected events), then in-app
  smoke.

## Explicitly deferred
- wasm-Whisper on-device ASR (true-local privacy claim).
- LLM parse (messy phrasing, many languages).
- External-agent API / MCP (v3).
- Temperature/medicine voice (medical risk).
