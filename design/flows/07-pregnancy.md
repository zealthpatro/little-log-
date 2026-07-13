# Flow 07 — Pregnancy (trying → expecting → birth)

**Status: ✅ shipped & live · loss-flow discrepancy needs verification (L1) · nav restructure open (PV1/PV2)** · Files: `app/index.html` (3669–4903), `app/pregnancy-data.js`, `app/store-firebase.js` (privacy 511–655)

## Entry points
Onboarding stage chooser (Flow 02); `openStartPregnancy` from settings/baby sheet; planning→expecting conversion ("I got a positive test 🎉").

## Flow diagram
```mermaid
flowchart TD
    A[Start] --> B{Stage}
    B -- We're trying --> C[Planning home: NHS preconception checklist<br/>optional fertile window · heavily disclaimed<br/>non-carriers never asked about periods]
    C -- positive test --> D
    B -- Just found out --> D[LMP → EDD]
    B -- Already counting --> E[Due date direct]
    D & E --> F[Care country → antenatal schedule seeded<br/>170 countries, WHO fallback]
    F --> G[Expecting shell: 5 tabs<br/>Week · Log · Moments · Tools · Care]
    G --> H[Week-by-week · size-of · kicks · contractions 5-1-1<br/>birth plan · hospital bag · appts · games hub /g/code]
    G --> I[Care: opt-in trackers<br/>GDM glucose · BP/pre-eclampsia · supplements · nausea]
    G -- Baby has arrived --> J[welcomeBaby: creates real baby<br/>sex prefilled from knownSex · bornBabyId set<br/>pregnancy kept as history]
    G -- End without birth --> K[endPregnancy owner-only]
    K --> L[state.lossHolding → calm bereavement<br/>holding screen renderLossHolding<br/>persists across reload + co-parent]
```

## Privacy model (owner-owned, server-enforced)
- Journey: `households/{hid}/pregnancy/{ownerUid}` + `pregShared[]` — members don't learn a pregnancy exists unless shared. Legacy in-blob journey self-migrates.
- Maternal health: `mhealth/{ownerUid}/cat/{category}`, per-category `sharedWith` allowlist. **Mood/EPDS owner-only forever — rule-enforced, never shareable.**

## Break points
| Condition | Behavior | Ref |
|---|---|---|
| Non-carrier viewer (Papa/Grandpa) | Never asked about periods (`viewerIsCarrier`) | index.html:3911 |
| Loss | `lossHolding` calm screen; suppresses upbeat chooser | index.html:3651–3666 |
| End pregnancy, keep moments | Optional archive to `state.pregnancyArchive` | index.html:4820 |
| Games hub backend absent | "Online sharing is coming soon 🤍" fallback | index.html:4256 |
| Mode switch | `openBabySheet` lists pregnancy row + babies; `viewingPreg` toggles shell | index.html:2666 |

## Expected vs actual
| Expected (source) | Actual | Status |
|---|---|---|
| One lifecycle, start anywhere (PREGNANCY-HANDOFF-V2 §2) | 3 entries + conversion | ✅ |
| 170-country antenatal (HANDOFF) | `PREG_COUNTRY_OPTS` + searchable full list (PREGNANCY.md's uk/us/de/uae list is stale) | ✅ |
| Clinical trackers NICE/ACOG thresholds (V2 §2) | Shipped; source-accuracy re-verify still wanted (HANDOFF) | ⚠️ verify |
| **Loss flow: UX-ROADMAP L1 says "just toasts and drops back — charter violation"** | Code trace found a real `renderLossHolding` holding screen persisting across reload/co-parent | ⚠️ **discrepancy: L1 may already be fixed post-audit — verify & close, or roadmap tested a different path (e.g. planning-stage end)** |
| 5-tab pregnancy nav | Shipped; PV1 wants Moments demoted → 4 tabs; PV2 move games card to Tools | ⚠️ open P1+ |
| Guess never becomes medical `b.sex` (GENDER-GAME-SPEC) | Only `knownSex` prefills birth picker | ✅ |

## Open items
Verify L1 status (highest moral priority per roadmap), PV1/PV2 nav, F1 split "we're trying" setup, N1 loss-safe mode switch, GDM/BP threshold source re-check.
