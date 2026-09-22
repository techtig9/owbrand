# ROADMAP

Ranked by business value divided by effort. Items move here when they are real
work that was deliberately not done, never as a place to put things that are
broken — broken goes in [`AUDIT.md`](AUDIT.md) with a priority.

Effort is engineering days for one person who knows this codebase.

---

## Blocked on someone else, not on us

| Item                                  | Blocker                                                                                                                                                                                                | Effort once unblocked                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Instagram and Facebook publishing** | Meta App Review for `instagram_content_publish` and `pages_manage_posts`: 2–6 weeks. **Start this now** — it is the longest lead time in the product and everything in Publishing is inert without it. | 0 — the adapter and worker are built and tested          |
| **A Vercel Pro plan**                 | Minute-level cron and a 300s function ceiling both need it. On Hobby, scheduled publishing runs once a day and long Instagram video publishes abort mid-flight.                                        | 0 — paste the cron block from `docs/DEPLOY_VERCEL.md` §6 |

---

## Platform and infrastructure

| Rank | Item                                               | Value  | Effort | Note                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Upstash Redis in production**                    | High   | 0.25   | Without it rate limits are per-process, which does not hold on serverless — an attacker only needs requests to land on different instances. Configuration only.                                                                 |
| 2    | **axe over the authenticated shell**               | Medium | 1      | The audit covers five unauthenticated pages in both themes. The app shell's accessibility is verified by construction and structural assertions, not by axe, because that needs a seeded Supabase project and a real session.   |
| 3    | **Next 15 upgrade**                                | Medium | 2–3    | Clears the remaining advisories. A major, so it needs its own branch and a full regression pass.                                                                                                                                |
| 4    | **Drop `media_jobs` and `product_asset_versions`** | Low    | 0.25   | Currently locked down (RLS on, no policies, privileges revoked) rather than dropped, because dropping an existing table is irreversible if any deployment wrote to them. Confirm they are empty in production first, then drop. |

---

## Integrations not built

| Rank | Item                                  | Value  | Effort | Note                                                                                                                                                                                          |
| ---- | ------------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **LinkedIn publishing**               | High   | 3      | Highest-value platform after Meta for a B2B brand tool. Needs an approved app.                                                                                                                |
| 2    | **Image generation provider**         | High   | 1      | The adapter is provider-neutral and already wired; this is choosing a provider and setting `IMAGE_PROVIDER_URL` + `IMAGE_PROVIDER_API_KEY`. Creative Studio's photo tool is inert until then. |
| 3    | **TikTok publishing**                 | Medium | 4      | Content API access is restrictive and the video pipeline is its own problem.                                                                                                                  |
| 4    | **One-click deploy (Vercel/Netlify)** | Medium | 3      | Needs a durable job with lease and retry semantics like `lib/publishing/worker.ts`, not a fire-and-forget API call. Both routes currently return 503 with a reason.                           |
| 5    | **Reel rendering**                    | Medium | 5+     | Scripting is wired. Compositing needs a render service (Remotion on a worker, or ffmpeg) — the largest single item here and the one most likely to need infrastructure rather than code.      |
| 6    | **X / Pinterest publishing**          | Low    | 3 each | X's API pricing changed the economics; Pinterest needs an approved app. Both refuse honestly today.                                                                                           |

---

## Deferred product work

| Rank | Item                                    | Value      | Effort | Note                                                                                                                                                                                                    |
| ---- | --------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **`export-zip` section source**         | Medium     | 1.5    | The archive streams correctly but omits generated section source, which has nowhere to be persisted yet. Needs a `site_section_source` table or blob storage, then the lookup where the route marks it. |
| 2    | **Reconcile the legacy Tailwind names** | Low        | 1      | `canvas` / `ink` / `line` are aliased to tokens and marked deprecated. Removing them is mechanical but touches ~30 screens, so it wants its own commit.                                                 |
| 3    | **The other ~20 screens, individually** | Low–Medium | 4      | They inherited the token system and the primitives and are consistent and accessible, but only the dashboard and `brand-kit` were reconsidered against the spec's per-screen layouts.                   |

---

## Phase 8 — product advantage: the ranking, and what was built

Seven candidates, ranked by **differentiation × commercial value ÷ effort**.
The first three are built; the rest are here with the reason they were not.

| Rank | Item                        | Value          | Effort | Verdict                                         |
| ---- | --------------------------- | -------------- | ------ | ----------------------------------------------- |
| 1    | **Brand-consistency check** | High           | 2      | **BUILT**                                       |
| 2    | **Brand-kit export**        | High           | 1.5    | **BUILT**                                       |
| 3    | **Content calendar**        | Medium–High    | 2      | **BUILT**                                       |
| 4    | On-brand post generation    | Low (marginal) | 1      | Not built — already exists                      |
| 5    | Social-size templates       | Medium         | 2      | Not built — depends on an unconfigured provider |
| 6    | Competitor monitoring       | Medium         | 5      | Not built — needs scraping infrastructure       |
| 7    | Brand-voice fine-tuning     | Low            | 8      | Not built — wrong tool for the job              |

### Why these three

**1. Brand-consistency check.** The strongest differentiator in the list, and
the one that makes the product's name mean something. A generator that reads a
brand description is a wrapper around a model; something that takes copy from
anywhere — an agency, a new hire, a previous tool — and says specifically where
it departs from the brand is a different product. It also makes the Brand
Brain load-bearing rather than decorative: every rule a customer adds makes
this check sharper, which is a retention mechanic that costs nothing to run.

Deliberately deterministic and free. Every finding is countable and quotes the
exact text, so it is explainable, reproducible and usable a hundred times a
day. A model returning "82% on brand" is unfalsifiable and therefore
unactionable — nobody can fix an opinion.

**2. Brand-kit export.** The highest perceived value per unit of effort here.
"Send me the brand kit" is a request customers already make of each other, and
answering it today means a meeting. The archive is organised by who opens it:
tokens in three formats for a developer, a self-contained swatch sheet for a
designer, and `VOICE.md` for a writer — the part that is usually lost entirely
because it lives in a slide deck nobody can find. Generated from the Brand
Brain, so the kit cannot disagree with what the product generates.

**3. Content calendar.** Lower differentiation — every competitor has one —
but it closes a real gap, and the nav was already lying about it: the entry
labelled "Calendar" pointed at a list. It earns its place by answering
something the list cannot, which is cadence. A list will happily show twelve
posts without making it obvious that nine are on Tuesday and there is nothing
for eleven days. That is a shape problem, so it needs a shape.

### Why not the others

**On-brand post generation** is already what `/api/ai/generate-content` does —
it reads the full Brand Brain through `buildBrandContext`. Building a second
entry point for it would be a new button over existing behaviour, which is the
definition of a feature that adds surface without adding value.

**Social-size templates** need image generation, and no image provider is
configured (`IMAGE_PROVIDER_URL` / `IMAGE_PROVIDER_API_KEY` are unset — see
`ROADMAP.md` → Integrations). Building the template picker now would ship a
grid of sizes wired to an endpoint that returns 503. Worth doing the day a
provider is chosen; the adapter is already provider-neutral.

**Competitor monitoring** needs scraping or a paid data source, which is
infrastructure and a legal question before it is code.

**Brand-voice fine-tuning** is the wrong tool. A fine-tune costs real money per
brand, takes hours, goes stale the moment the brand changes, and would be
beaten by the prompt context that already exists plus the consistency check
above. It is on the list because customers ask for it by name, not because it
would work better.
