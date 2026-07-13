# Post-mortem — <short title>

- **Date:** YYYY-MM-DD
- **Severity:** P0 / P1 / P2
- **Duration:** <when it started → when resolved>
- **Status:** OPEN / RESOLVED (commit ____)
- **Author:** ____

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
<Plain description of the symptom and how it surfaced.>

## Impact
<Who/what was affected; whether users could be identified; what was NOT affected.>

## Root cause
<The underlying cause, not just the trigger. Note confirmed vs. hypothesised.>

## 5 Whys
1. **Why did X happen?** …
2. **Why did that happen?** …
3. **Why did that happen?** …
4. **Why did that happen?** …
5. **Why did that happen?** … → **Root cause.**

## Contributing factors (blameless)
- …

## What fixed it
<The change that resolved it + commit.>

## Corrective actions
| # | Action | Type (Fix/Prevent/Process/Doc) | Status |
|---|--------|--------------------------------|--------|
| 1 | … | … | TODO |

## Lessons
- …
