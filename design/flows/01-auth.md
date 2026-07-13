# Flow 01 — Sign-in & auth gate

**Status: ✅ shipped, solid · 2 open UX gaps (G2, G3)** · Files: `app/store-firebase.js`, `app/landing.js`, `app/firebase-init.js`, `worker.js`

## Entry points
- Any visit to `/app/` while signed out (full-screen `#llAuthOv` overlay paints before the app is ever visible — store-firebase.js:1342).
- Magic-link click-back (`maybeFinishEmailLink`, store-firebase.js:210).
- OAuth redirect return via `/__/auth/handler` (proxied by `worker.js` so auth runs on little-cubby.com).

## Flow diagram
```mermaid
flowchart TD
    A[/app/ load] --> B[Loading overlay + rotating lines]
    B --> C{onAuthStateChanged}
    C -- no user --> D[Signed-out landing<br/>landing.js]
    D --> E{Method}
    E -- Google --> F[signInWithPopup → redirect fallback]
    E -- Apple --> F
    E -- Email --> G[POST /api/send-signin-link<br/>Resend; Firebase fallback]
    G --> H[Check your inbox · 30s resend cooldown]
    H --> I[Link click → signInWithEmailLink]
    F --> J[resolveHousehold]
    I --> J
    C -- user --> J
    J -- users/uid has householdId --> K[startSync]
    J -- invite for email exists --> L[Join household with invited role] --> K
    J -- neither --> M[Create household, owner<br/>migrate legacy localStorage] --> K
    K --> N[App renders / first-run check → Flow 02]
```

## Break points
| Condition | Behavior | Ref |
|---|---|---|
| Popup blocked / webview | Falls back to `signInWithRedirect` | store-firebase.js:308–318 |
| `/api/send-signin-link` down | Falls back to Firebase's own sender | store-firebase.js:170–175 |
| Magic link opened in different browser | Email not in localStorage → `prompt()` for email | store-firebase.js:216 |
| Rate limit | 5 req/60s/IP at edge; 429 + Retry-After; per-email cooldown (normalized +tags/dots) | worker.js:91–153 |
| E2E test | `localhost` + `?e2e=1` bypasses Firebase entirely (prod-safe via hostname guard) | store-firebase.js:1349 |
| `?ref=` / `utm_*` | Captured to localStorage pre-auth, attributed on first household creation only | index.html:8–16, store-firebase.js:431 |

## Expected vs actual
| Expected (source) | Actual | Status |
|---|---|---|
| 3 methods: Google, Apple, email link (README §5, CHANGELOG v0.13.0) | All three wired on the overlay | ✅ |
| Same-domain auth via `/__/*` proxy (README §1) | worker.js:606–609 proxies to firebaseapp.com | ✅ |
| Magic link via own Worker + Resend, verified Gmail delivery (HANDOFF) | Implemented incl. cooldown + rebranded link host | ✅ |
| All 3 methods rendered upfront, equal weight (UX-ROADMAP **G3**, P1) | Apple/email injected after Google via `insertAdjacentHTML`, feel hidden | ⚠️ open |
| Privacy trust line at the sign-in moment (UX-ROADMAP **G2**, P1) | No privacy line on the sign-in card | ❌ open |

## Open items
G2 (privacy line at sign-in), G3 (equal-weight sign-in methods) — both P1, small.
