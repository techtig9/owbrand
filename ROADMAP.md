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
