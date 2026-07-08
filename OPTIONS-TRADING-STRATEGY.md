# Options Trading Strategy — $2,000 Account, High-Probability Growth Plan

> **Goal as stated:** grow a $2,000 account to $50,000 in 1 year, compounding, with a
> long-term mindset where *higher probability of wins trumps higher risk*.
>
> **What this document is:** a complete, rules-based options trading system built around
> that priority (high win-probability, defined risk, compounding), plus an honest
> mathematical assessment of the 1-year target and a milestone path that actually gets
> to $50,000.
>
> **What this document is not:** financial advice. It is an educational trading plan.
> Options involve substantial risk of loss. Only trade with money you can afford to lose.

---

## 1. The math first — what $2,000 → $50,000 in 12 months requires

$50,000 / $2,000 = **25x**, i.e. a **+2,400% return in one year**.

| Compounding interval | Required return per interval |
|---|---|
| Per trading day (252 days) | **+1.29% every single day** |
| Per calendar day (365 days) | +0.89% every single day |
| Per week (52 weeks) | +6.4% every single week |
| Per month (12 months) | +30.8% every single month |

For scale:

- The S&P 500's long-run average is ~10% **per year** (~0.04% per trading day). The goal
  requires ~32x the market's daily return, sustained for a year, with no losing streaks.
- The best-performing fund in history (Renaissance Medallion) averaged ~39% **per year** net.
- A retail trader who compounds 3–5% per month is performing at an elite level.

**The contradiction in the goal:** "high probability of wins" and "+30.8% per month" are
mathematically incompatible. High-probability options trades (70–85% win rate) pay small
credits relative to the capital they tie up — that is exactly *why* they win often. The only
way to 25x an account in a year is to repeatedly bet most of the account on leveraged
directional positions. Section 3 quantifies why that path almost certainly ends in ruin.

**The resolution this plan takes:** honor the stated priority — high probability, defined
risk, compounding, long-term — and pursue the *maximum sustainable* growth rate that
priority allows (~2–5% per month), with a milestone path to $50,000 that combines
compounding with contributions (Section 8). That path reaches $50,000 in roughly 3–5
years, not 1. Any plan that promises 25x in a year from options is a plan to lose the $2,000.

---

## 2. Strategy selection — why defined-risk premium selling

Given the priorities (win rate > payoff size, survivability > speed), the system is built on
**selling out-of-the-money defined-risk credit spreads** on highly liquid underlyings:

1. **Put credit spreads** (primary) — bullish-to-neutral. Sell an OTM put, buy a further
   OTM put. Profits if the underlying goes up, stays flat, or falls modestly.
2. **Call credit spreads** (secondary) — only in confirmed downtrends. Mirror of the above.
3. **Iron condors** (both at once) — only in range-bound, elevated-IV conditions.

Why this structure for a $2,000 account specifically:

- **High probability by construction.** Selling a ~25-delta short strike wins roughly
  70–75% of the time before management; managing winners early pushes realized win
  rate higher.
- **Defined, capped risk.** A $1-wide spread can never lose more than $100 minus the
  credit received. No margin calls, no assignment blow-ups, no unlimited-loss scenarios.
- **Small enough to size correctly.** $1-wide spreads risk ~$65–80 each — the only option
  structure that lets a $2,000 account risk ≤5% per position.
- **Positive theta.** Time decay works for the position every day; no need to be right
  about direction, only "not very wrong."
- **PDT-compatible.** Positions are held days-to-weeks. Accounts under $25,000 are
  limited to 3 day-trades per 5 business days (FINRA pattern day trader rule); this system
  never bumps into that.

**Explicitly excluded** (each violates the high-probability mandate):

- ❌ Buying OTM calls/puts as lottery tickets (win rate typically <35%)
- ❌ 0DTE anything (gamma risk turns "high probability" into coin flips at the close)
- ❌ Naked/undefined-risk short options (one gap ends the account)
- ❌ Earnings plays (binary events, IV crush roulette)
- ❌ Meme/illiquid tickers (spreads eat the edge)
- ❌ Averaging down / "rolling for hope" without a defined plan

---

## 3. Position sizing — the Kelly math that keeps the account alive

Assume the core trade: 25-delta put credit spread, $1 wide, collecting ~$0.30 credit
(risking $0.70), with a ~75% probability of profit.

- Payoff ratio *b* = 0.30 / 0.70 ≈ 0.43
- Full Kelly fraction: *f\** = p − q/b = 0.75 − 0.25/0.43 ≈ **17% of account at risk**
- Full Kelly produces intolerable drawdowns and assumes trades are independent
  (they are not — short puts on SPY, QQQ and AAPL all lose together in a selloff).

**Rule: size at quarter-Kelly. Risk ≤ 4–5% of the account per position.**

| Account size | Max risk per trade (5%) | Practical position |
|---|---|---|
| $2,000 | $100 | 1 × $1-wide spread |
| $4,000 | $200 | 2 × $1-wide or 1 × $2.50-wide |
| $10,000 | $500 | scaled accordingly |

Expected growth at this sizing (before slippage/commissions):

- Per-trade expectancy: 0.75 × (+$30) − 0.25 × (−$70) = **+$5 per $70 risked (~7% of risk)**
- Risking ~4% of account per trade → ~0.3% account growth per trade
- ~8–10 trades/month → **~2–3% per month expectancy**, i.e. ~27–43% annualized

That is the honest ceiling of a high-probability system at survivable sizing. Note that the
raw expectancy above assumes fills at mid and no edge decay; real results will be lower,
which is why the plan's base case is 2%/month, not 3%.

**Why bigger sizing self-destructs:** to hit +30.8%/month, essentially the whole account
must be at risk continuously. At a 75% win rate, the chance of a 4-loss streak somewhere
in 100 trades is roughly one in three. Four consecutive losses at "whole account" sizing is
a ~87% drawdown — and in practice the losses arrive *together* in one market drop, not
politely spaced out. This is why the 1-year 25x target and the high-probability mandate
cannot coexist.

---

## 4. The playbook — entry, management, exit (mechanical rules)

### Universe
SPY, QQQ, IWM (primary); XSP for cash settlement + Section 1256 60/40 tax treatment
when liquidity allows; optionally 1–2 mega-cap liquid names (AAPL, MSFT). Nothing else.
Bid-ask spread on the option must be ≤ $0.05 wide on $1-wide strikes.

### Entry rules
| Parameter | Rule |
|---|---|
| Days to expiration | 30–45 DTE |
| Short strike | 20–30 delta (~70–80% OTM probability) |
| Width | $1 (account < $5k), up to $2.50 later |
| Minimum credit | ≥ 30% of width ($0.30 on $1-wide) |
| IV filter | Prefer IV Rank > 30; skip or halve size below |
| Trend filter | Put spreads only above the 50-day MA; call spreads only below it; condors only in range + IVR > 40 |
| Cadence | 1–2 new positions per week, staggered expirations |
| Avoid | Entries within 7 days of the underlying's earnings or FOMC when short-dated |

### Management rules (decided before entry, never improvised)
| Situation | Action |
|---|---|
| Profit reaches 50% of credit received | Close. Always. Book the win. |
| 21 DTE reached, any P/L | Close or roll. Never hold through gamma week. |
| Loss reaches 2× credit received | Close. Take the defined loss. |
| Short strike breached with > 21 DTE | Close or roll down/out *for a credit only* — never for a debit |
| Nothing triggered | Do nothing. No fiddling. |

### Portfolio rules
- Max **2–3 concurrent positions** under $5k (max 15% of account at risk total)
- Max 2 positions in correlated underlyings (all equity indexes count as one bucket)
- Keep ≥ 40% of the account in cash at all times
- **Circuit breaker:** month down 10% → stop, go flat, paper trade 2 weeks, review journal

---

## 5. Costs, broker, and regulatory realities for a $2,000 account

- **Approval level:** spreads require options Level 2–3 depending on broker. Apply for
  "defined-risk spreads" specifically.
- **Commissions:** at ~$0.65/contract, a spread costs ~$2.60 round trip (4 legs). On a $30
  credit that is a ~9% haircut — use a zero-commission or low-fee options broker; this
  single choice is worth ~1% of account per month at this size.
- **PDT rule:** under $25,000, max 3 day trades per rolling 5 days. This system's
  hold-for-days structure avoids it, but never open and close the same position same-day
  more than the limit allows.
- **Assignment:** American-style ETF options can be assigned early (usually near
  ex-dividend or deep ITM). Defined-risk spreads cap the damage; closing at 21 DTE
  makes it rare. XSP is European-style/cash-settled — no assignment risk at all.
- **Taxes:** gains are short-term (ordinary income) except Section 1256 contracts
  (XSP/SPX), which get 60/40 long/short-term treatment. Keep records; expect to set
  aside taxes on realized gains.

---

## 6. Routine and record-keeping

**Weekly (60–90 min total):**
- Sunday: review open positions, IV Rank scan, plan the week's 1–2 entries
- Tue–Thu: place planned entries (avoid Monday gaps and Friday decay traps)
- Daily 5-min check: any management rule triggered? If yes act, if no close the app

**Every trade journaled:** date, underlying, structure, strikes, DTE, credit, IVR, thesis,
exit date, exit price, P/L, rule followed (Y/N). The "rule followed" column is the most
important one — the account grows when it is 100% "Y".

**Monthly review:** win rate, average win vs average loss, return on capital at risk,
rule violations, correlation of losses. Adjust nothing until 3 months of data exist.

---

## 7. First 90 days — sequence

1. **Weeks 1–4 (paper):** run the full playbook on paper. Minimum 8 paper trades with
   journal entries. Do not skip this — tuition here is free; live tuition costs 5% per lesson.
2. **Weeks 5–8 (live, half size):** 1 position at a time, $1-wide, risk ≤ $70. Goal is
   flawless rule execution, not P/L.
3. **Weeks 9–12 (live, full size):** 2 concurrent positions, ≤ $100 risk each. First
   monthly review at week 12.
4. Scale position count/width only at the milestones in Section 8 — never because of a
   winning streak.

---

## 8. The honest path to $50,000 — milestones, not miracles

What compounding actually produces from $2,000 at survivable, high-probability rates:

| Monthly return | Account after 12 months | Verdict |
|---|---|---|
| 2% (realistic base case) | $2,536 | achievable |
| 3% (good execution) | $2,851 | achievable |
| 5% (exceptional year) | $3,592 | elite |
| 8% | $5,036 | rarely sustained |
| **30.8% (the 1-year goal)** | **$50,000** | **not achievable at high probability — see §1, §3** |

**The lever that actually dominates at this account size is contributions.** Adding
$400/month is +$4,800/year — 240% of the starting account, more than any sustainable
trading edge can generate. Combining both:

| Plan | Monthly return | Monthly deposit | Time to $50,000 |
|---|---|---|---|
| Trading only | 3% | $0 | ~9 years |
| Modest both | 2% | $400 | ~4.8 years |
| Base case | 3% | $400 | **~4 years** |
| Exceptional | 5% | $400 | ~3 years |

**Milestone ladder** (scale rules unlock by account size, not by calendar):

| Milestone | Unlocks |
|---|---|
| $2,000 → $5,000 | 1–2 positions, $1-wide only |
| $5,000 → $10,000 | 3 positions, $2.50-wide allowed, add iron condors |
| $10,000 → $25,000 | 4–5 positions, diversify into 2nd asset bucket |
| $25,000+ | PDT restriction lifts; more tactical flexibility |
| $50,000 | goal — and by then the *skills* are the real asset |

---

## 9. Failure modes and their pre-committed answers

| Failure mode | Pre-committed answer |
|---|---|
| Losing month, urge to size up to "get it back" | Circuit breaker (§4): flat + paper for 2 weeks |
| Winning streak, urge to size up | Sizing changes only at §8 milestones |
| Market crash with open put spreads | Losses are capped by construction; take the 2× credit stops; do not add "cheap" new risk until IV stabilizes for 5 sessions |
| Boredom / overtrading | Cadence cap: max 2 entries/week, no exceptions |
| Strategy "stops working" for a month | 3-month minimum evaluation window before any playbook change |
| Temptation of a 25x YOLO trade | Re-read §1 and §3. The math has not changed since. |

---

## 10. Summary

- The 1-year $2,000 → $50,000 target requires +30.8%/month. No high-probability
  strategy delivers that; pursuing it means near-certain ruin, which contradicts the
  goal's own core priority.
- The system that *does* honor the priority: 30–45 DTE defined-risk credit spreads on
  liquid index ETFs, 20–30 delta shorts, credit ≥ ⅓ width, take profit at 50%, exit by
  21 DTE, stop at 2× credit, risk ≤ 5%/trade, ≤ 3 positions, 40% cash, mechanical rules.
- Realistic expectancy at quarter-Kelly sizing: **~2–3% per month** (~27–43%/year) —
  elite performance if sustained.
- $50,000 is reached in **~3–5 years** by combining that edge with monthly
  contributions, which dominate returns at small account sizes.
- The account's survival is the strategy. Everything above exists to keep the
  compounding machine running.

*Educational document only — not financial, investment, or tax advice.*
