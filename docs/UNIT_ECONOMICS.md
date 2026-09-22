# Unit economics

Whether a customer on each plan costs less in AI than they pay, and what to do
when the answer is no.

Live figures: **`/admin/economics`**. This document explains what those numbers
mean, where they come from, and what they cannot tell you.

---

## 1. Where the numbers come from

Every AI call writes a row to `ai_usage_logs` with `estimated_cost_usd`,
computed from the providers' published per-token prices in
`src/lib/ai/usage.ts`. The economics page sums those rows per plan over a
30-day window and divides by active subscribers on that plan.

This is deliberately the **logged** cost and not an assumed cost per
generation. An assumed number tells you what you hoped; the logged number tells
you what happened, and the two diverge the moment a prompt grows or a model
changes price.

**It is an estimate.** Close enough to price a plan, not close enough to
reconcile a provider invoice. If the two disagree materially, the prices in
`usage.ts` have drifted and need updating — and that discrepancy is itself
worth knowing.

---

## 2. What the page reports, and what it refuses to report

| Figure | Meaning |
| --- | --- |
| **AI cost / user** | Total logged AI spend by that plan's active users, divided by their count |
| **Margin** | `(price − cost per user) / price` |
| **Free-tier burn** | Total AI cost of free users, and per user |
| **Break-even conversion** | What fraction of free users must convert to the cheapest paid plan for the free tier to pay for itself |

Three things it will **not** do:

1. **A plan with no active users shows "no data", never a 100% margin.** Zero
   cost across zero users is an absence of data, not a healthy margin. A
   dashboard rendering it green is the number a founder prices a launch around,
   and it would be an artefact of dividing by nothing.
2. **The free plan is never flagged as loss-making.** It has no price to lose
   against, and flagging it would bury the paid plan that genuinely is.
3. **Usage from deleted accounts is counted in the total but attributed to no
   plan.** The money was really spent, so it belongs in the total; putting it
   against a plan would overstate that plan's cost per user.

---

## 3. What to do when a plan goes negative

The page shows a red banner naming the plan. There are four levers, roughly in
order of how much they cost you:

### a. Reduce the credit allowance for that plan

Cheapest fix, and usually correct when a plan went negative because a small
number of users are generating far above the median. Check the distribution
before assuming the average is the problem — a plan is often profitable for 90%
of its users and ruinous for three.

### b. Reduce cost per generation

- **`effort` levels.** Most generations do not need deliberation. The public
  demo already runs at `effort: 'low'` and produces an acceptable sketch.
- **Output token caps.** An unbounded `maxOutputTokens` is an unbounded bill.
- **Shorter context.** `buildBrandContext` sends the whole Brand Brain; a task
  that only needs the voice section does not need the audience personas.
- **Caching.** Repeated system prompts across calls are the obvious candidate,
  and providers price cached input well below fresh input.

### c. Raise the price

Slowest to take effect and the only one that fixes a structurally underpriced
plan. If cost per user is within 40% of the price, the plan is underpriced —
there is no plausible efficiency gain that closes that gap.

### d. Change model

A cheaper model for tasks where quality is not the differentiator (tag
extraction, summarisation, classification) rather than for the flagship
generation. Measure before and after; a cheaper model that needs two attempts
costs more than the expensive one that works first time.

---

## 4. The free tier

The break-even conversion rate is the figure to watch. It answers: *what
fraction of free users must become paying customers for the free tier to pay
for itself?*

- **Under 2%** — comfortable. Free is a growth channel.
- **2–5%** — normal for self-serve SaaS, and worth monitoring.
- **Above 10%** — the free tier is a leak. Typical SaaS free-to-paid conversion
  runs 2–5%, so a requirement above 10% means the free plan is subsidising
  people who will never pay.

Levers, in order of preference: reduce free credits, reduce free-tier `effort`,
require a connected account before generation (which filters tyre-kickers
without reducing value for real users), or time-limit the free tier.

---

## 5. Spend controls

Independent of margin, and they exist because a margin calculation cannot stop
a runaway loop:

| Control | Default | Effect |
| --- | --- | --- |
| `AI_KILL_SWITCH` | `false` | Refuses every generation immediately. No database read. |
| `AI_DAILY_BUDGET_USD` | `25` | Rolling 24-hour ceiling across the deployment |
| `AI_USER_DAILY_BUDGET_USD` | `5` | The same, per user |

Both budgets default ON with real numbers, because a cap that waits for
someone to configure it protects only the deployments whose operator had
already thought about the problem.

The budget **fails open** if `ai_usage_logs` is unreadable — refusing every
generation during a metrics outage turns it into a full product outage. The
kill switch is the control for the opposite preference, and unlike the budget
it cannot fail to read.

---

## 6. What this does not cover

- **Infrastructure cost.** Vercel, Supabase and Upstash are not in these
  figures. They are largely fixed and do not scale per generation, but they are
  real and they are not here.
- **Payment processing.** Paddle's fee comes off the price before margin. At
  roughly 5% + fixed, a plan showing a 30% margin here is nearer 25%.
- **Support cost.** The largest hidden per-customer cost in most SaaS, and not
  measurable from the database.
- **Storage and egress** for generated media.

A plan showing a thin positive margin here is probably negative in reality.
Treat anything under 50% as needing attention rather than as fine.
