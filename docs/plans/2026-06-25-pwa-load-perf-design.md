# Cubby PWA — load performance: design

2026-06-25 · status: **proposed, for a go/no-go call** (not started). Long-standing issue (reported by a tester); not caused by recent work.

## 1. Measured baseline (`/app/`, Fast-3G sim, cold)
first-paint **2.8 s** · DOMContentLoaded **~7.8 s** · **1.7 MB** over 24 requests.

Render-blocking critical path, in `<head>`, in load order:
| KB | Resource | Blocking? | Needed for first paint? |
|---|---|---|---|
| 333 | firebase-firestore-compat | yes | no (data comes after auth) |
| 136 | firebase-auth-compat | yes | no |
| 37 | firebase-messaging-compat | yes | **no** (push only) |
| 31 | firebase-app-compat | yes | no |
| 592 | index.html (inline app JS) | yes (it *is* the doc) | parsed before boot |
| 66+66 | Fraunces 600 + 700 | preloaded | one weight likely enough |
| 30+30 | Nunito 400 + 800 | via fonts.css | — |
| 61 | journey-catalogue.js | ✅ already deferred | no |

**Two load profiles — they have different bottlenecks:**

**A. Re-launch of the INSTALLED PWA (the reported case — tester used it earlier, re-opened it, slow).** Warm SW + browser cache. The bottleneck here is **the SW is `network-first` for HTML *and* our own JS** (`app/sw.js` fetch handler): every launch re-fetches `index.html` (592 KB) + `store-firebase.js` (76 KB) + the data scripts from the **network first**, falling back to cache only if the fetch *fails* — with **no timeout**. On a phone with a slow/cold radio, the launch blocks on ~700 KB of re-download despite a valid cached copy. (Firebase SDKs are cross-origin → browser-cached → not the re-launch cost.) Secondary: boot waits for `gotApp && gotEvents` from Firestore `onSnapshot` before it renders (`maybeBoot`); Firestore offline persistence is enabled so this should fire from cache fast — worth confirming.
> Network-first was a deliberate choice (comment: a stale cached script once rendered the Pro sheet unstyled). But the `CACHE` version bumps on every deploy and `install` re-caches HTML+JS together, so a **cache-first** shell stays internally consistent — the network-first is over-cautious and is the re-launch cost.

**B. Cold first install/load.** No cache. Here the **~537 KB of render-blocking Firebase compat SDKs** + the **592 KB single-file parse** dominate (the original analysis). Prod brotli shrinks the HTML (~592→~110 KB) and gstatic Firebase is often warm across sites.

## 2. Goal & success metric
- **Perceived:** something on screen (Cubby shell/loader) in **< 1 s** on prod mobile — no blank wait.
- **Real:** cut the blocking critical path; faster time-to-interactive.
- Measure before/after with `tools/` perf probe + a real prod check; **zero regression** in sign-in, boot, sync, offline, `?e2e`.

## 3. Options (levers)
- **A. Defer the Firebase chain.** `defer` the 4 SDKs + `firebase-init` + `store-firebase`, kept in order; audit inline scripts for top-level `firebase`/`auth`/`db`. Shell paints immediately. *Cost: small. Risk: medium (auth/boot order) → verify.*
- **B. Lazy-load the non-critical Firebase + ML.** `messaging-compat` (37 KB) only when push is enabled; the mediapipe selfie-segmenter (googleapis) only when its feature is used. *Cost: small. Risk: low.*
- **C. Cache-first app shell (SW).** Serve `index.html` from cache instantly (stale-while-revalidate), update in background, refresh on SW version bump. Makes **repeat** loads near-instant. *Cost: small-medium. Risk: medium (serving a stale build briefly) — mitigated by the existing CACHE versioning.*
- **D. Split inline app JS → external `app.js`.** Move the ~0.5 MB inline script out of `index.html` into a cache-first, brotli'd file parsed-once-then-cached; HTML becomes a small shell. *Cost: medium (mechanical but large). Risk: medium.*
- **E. Modular Firebase SDK.** Replace compat (~537 KB) with tree-shaken modular v10 (~120 KB) — rewrite `firebase-init` + `store-firebase` calls (auth flows, firestore persistence/onSnapshot, messaging). *Cost: high. Risk: high (behaviour parity). Biggest transfer cut.*
- **F. Font trim.** Drop any unused weight (Fraunces 700? Nunito 800?), confirm `font-display:swap`, subset. *Cost: tiny. Risk: low.*

## 4. Recommended phasing (re-ordered for the reported re-launch case)
**Phase 1 — fixes the reported slow re-launch. Do first.** **C: cache-first / stale-while-revalidate app shell** — serve cached `index.html` + own JS instantly, revalidate in the background, rely on the existing `CACHE`-version bump (SW-bump hook) for freshness. Keep HTML+JS on the **same** cache generation so they never mismatch (the old staleness bug). Outcome: an installed PWA opens **near-instantly from cache** regardless of network; Firestore persistence then shows last-known data immediately and syncs in the background. Plus: confirm `maybeBoot` renders from persisted data without waiting on a network round-trip.

**Phase 2 — cold first-load (the install download).** A (defer Firebase) + B (lazy messaging/ML) + F (font trim) + `preconnect`. Outcome: first-ever load paints fast, no blank screen.

**Phase 3 — deep throughput (only if still needed):** D (split JS) and/or E (modular SDK). Most effort/risk; scope after 1–2 are measured.

## 5. Risk & verification (every phase)
- Failure mode for A/D/E is severe (blank screen / broken auth on deploy), so **nothing merges to `main` without:** cold-load paints; Google/Apple/email sign-in works; data syncs; offline persistence works; `?e2e=1` + `?e2e=onboard` pass; `tools/smoke.js` PASS; before/after perf numbers captured.
- Ship behind the normal loop (verify → SW bump → commit → merge `main` → confirm on `/app/`).

## 6. Open question
- Is the slow report from **prod** (`little-cubby.com/app/`) or a local/dev build? If prod, Phase 1 (defer) + Phase 2 (cache-first) likely fix the felt slowness; if it's still slow after, Phase 3 (modular SDK) is justified.

## 7. The call to make
The reported problem is **slow re-launch of the installed PWA** → **Phase 1 (cache-first shell) is the fix.** It's small, high-impact, and the staleness risk is handled by the existing per-deploy `CACHE` bump.
- **Main risk to verify:** a returning user sees the *previous* build for one launch, then it updates next launch (standard SWR). Mitigate with the existing version bump and (optional) a small "refreshed — reopen for the latest" toast when a new SW takes over. Must verify: cached launch works offline, a deploy still propagates within one relaunch, HTML+JS never mismatch, sign-in/boot/sync/`?e2e` all pass.
- **Recommendation:** do **Phase 1 (cache-first shell) now**; it directly fixes the tester's complaint. Phase 2/3 (cold-load wins) only if first-install load is also a concern.
