# Flow 09 — Offline & sync

**Status: ✅ shipped, robust · LWW blob is a known charter tension** · Files: `app/sw.js`, root `sw.js` (retire stub), `app/firebase-init.js`, `app/store-firebase.js` (658–955)

## Flow diagram
```mermaid
flowchart TD
    A[App load] --> B["app/sw.js CACHE little-log-vNN<br/>precache shell · cache-first same-origin<br/>HTML falls back to cached index offline"]
    A --> C["Firestore enablePersistence synchronizeTabs<br/>first snapshots from disk"]
    C --> D["startSync: windowed events query ~4mo<br/>fast first paint"]
    D --> E["hydrateFullHistory in background"]
    D -.query stalls 3.5s.-> F["Boot failsafe: show app anyway"]
    D -.index error.-> G["Fallback: unbounded listener"]
    subgraph Writes
      H["state mutation + persist()"] --> I["pushNow diff vs knownEvents<br/>350ms debounce"]
      I -- success --> J["only changed docs + app blob written"]
      I -- rejected --> K["un-mark doc → retried next push<br/>backoff 8s→5min · throttled toast"]
    end
    subgraph Echo
      L["own write echoes deduped via hhSig<br/>applyingRemote guard stops re-push"]
    end
```

## Break points
| Condition | Behavior | Ref |
|---|---|---|
| Fully offline | Log/edit works (Firestore disk cache); syncs on reconnect | firebase-init.js:27 |
| Stale deploy | Cache-first: returning user may see previous build one launch (needs CACHE bump per deploy) | sw.js:45 |
| Simultaneous edit, same event | Last-write-wins whole doc; `history` is audit not merge | design limit |
| Simultaneous app-blob write | LWW — charter calls LWW "wrong for a baby log" (events per-doc mitigates the main risk) | GUARDRAILS ⚠️ |
| Legacy root SW | Root `sw.js` stub deletes caches, unregisters, reloads clients | root sw.js:1–14 |
| Photo doc >990 kB | Kept device-only, user informed | store-firebase.js:1056 |

## Expected vs actual
| Expected (source) | Actual | Status |
|---|---|---|
| Offline-first, never lose an entry (README §9) | Diff push + retry + backoff + Firestore persistence | ✅ |
| Events per-doc so caregivers never clobber (README §3) | Per-doc writes | ✅ |
| Blob merge/attribution instead of LWW (GUARDRAILS aspiration) | Still LWW | ⚠️ accepted debt |
| Two-stage load + failsafe (CHANGELOG) | Implemented | ✅ |
