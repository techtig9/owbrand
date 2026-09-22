# OwBrand — audit

Living document. Columns: issue | file | priority | status.
Priorities: **P0** build/crash/login blocker · **P1** core feature or security ·
**P2** buttons/UX/config · **P3** polish.

Baseline at audit time: `npm run verify` (type-check → lint → contrast → 489
tests → build) passes; 30 test files; 237 source files, ~30.4k lines; git
history contains no secrets.

---

## P0 — build, crash, login blockers

**None.** The build passes, type-check is clean, public pages render with no
env vars set, and the auth flow works. Verified live on a deployment with zero
environment variables: `/` renders 200, `/dashboard` refuses to
`/login?error=not_configured`, `/api/ready` answers `503 unhealthy`.

---

## P1 — core feature or security

| # | Issue | File | Status |
|---|---|---|---|
| 1 | **Two tables have RLS disabled and no policies.** `media_jobs` and `product_asset_versions` are orphans from a legacy migration, superseded by `generation_jobs`/`asset_versions` and referenced by no application code. But RLS off + Supabase's default grants means any authenticated user can read and write them through PostgREST, and their FKs to `brands`/`products` turn them into an existence oracle: insert a guessed `brand_id` and a FK violation versus success reveals whether that brand exists. Empty today, an instant leak the moment anything writes to them. | `supabase/migrations/20260816_phase2.sql:2,19` | **fixed** |
| 2 | **Non-null assertion on the billing webhook secret.** `paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, sig)`. Explicitly forbidden by the Phase 2 rules, and it is the signature verifier: with the variable unset this throws inside the handler instead of refusing the request with a stated reason. | `src/lib/paddle.ts:32` | **fixed** |
| 3 | **Paddle config bypasses the validated env module.** `new Paddle(process.env.PADDLE_API_KEY)` and `priceIdFor()` read `process.env` directly and throw a plain `Error`, so a missing price ID surfaces as a generic 500 rather than `not_configured`. Same defect class as the Supabase factories fixed in `a4df084` — the env module exists to be the only path to configuration. | `src/lib/paddle.ts:15,24` | **fixed** |

---

## P2 — buttons, UX, configuration

| # | Issue | File | Status |
|---|---|---|---|
| 4 | **No shared UI primitive library.** `src/components/ui/` does not exist; components are scattered per feature. Missing: Tabs, Modal, Drawer, Tooltip, Table, Avatar, Progress, Select, Textarea. Consequences are already visible: 11 files hand-roll `animate-pulse` skeletons at different heights, so the layout jumps differently on every page, and two files define their own `Stat` card. | `src/components/*` | Phase 3 |
| 5 | **Four SECURITY DEFINER functions keep the default PUBLIC EXECUTE.** `derive_product_workspace`, `sync_campaign_aliases`, `handle_new_user`, `set_updated_at`. The dangerous ones (`reserve_credits`, `complete_publishing_job`, the `upsert_*` family) are correctly revoked; these four were missed. The last two are trigger functions, so exposure is low, but a definer function callable by `anon` is exactly what the hardening rule names. | `supabase/migrations/*.sql` | **fixed** |
| 6 | **Three unused dependencies ship in the bundle graph.** `@monaco-editor/react`, `framer-motion`, `clsx` — nothing imports any of them. The first two are large. | `package.json` | **fixed** |
| 7 | **`.env.example` is out of sync.** Missing `AI_PROVIDER_ORDER` and `ANTHROPIC_MODEL`, which the code reads. Documents `VERCEL_API_TOKEN` and `NETLIFY_API_TOKEN`, which nothing reads now that both deployment adapters return 503. | `.env.example` | **fixed** |
| 8 | **`.gitignore` missing `dist` and `*.zip`.** Phase 5 produces a zip in the parent directory, but the pattern belongs there regardless. | `.gitignore` | **fixed** |
| 9 | **`metadataBase` duplicates the localhost fallback** instead of reading `publicEnv.siteUrl`, which already encodes it. A second literal is a second thing to get wrong. | `src/app/layout.tsx:44` | **fixed** |
| 10 | **Three `console.*` calls bypass the structured logger**, and one of them writes a user's email address into platform logs — PII in a sink with different retention and access rules from the app's own. | `src/app/api/admin/override-subscription/route.ts:53`, `src/app/api/billing/manage-subscription/route.ts:37`, `src/app/error.tsx:18` | **fixed** |

---

## P3 — polish and later-phase scope

| # | Issue | Scope |
|---|---|---|
| 11 | No `sitemap.ts`, `robots.ts` or OG image. | Phase 6 |
| 12 | No legal pages, help centre, contact form, changelog or blog. | Phase 6 / 9 |
| 13 | `export-zip` streams a valid archive but omits generated section source. | tracked, needs a persistence target |
| 14 | Vercel/Netlify deploy adapters unbuilt — both return 503 with a stated reason, which is honest, not broken. | ROADMAP |

---

## Design direction — a conflict, stated rather than resolved silently

The fix-all brief assigns owbrand *"editorial; serif display, cream/ink with one
bold accent, oversized type."* The repository currently implements the opposite:
a deep-indigo primary on near-white surfaces with a designed dark theme, built
from `OWBRAND_FRONTEND_DESIGN_SPEC` §2/§3 and verified by 68 computed WCAG 2.2
AA contrast pairs plus axe on five pages in both themes.

The cream/coral editorial palette is what was there *before*; replacing it was
the whole of the previous Phase 5.

**Decision: keep the indigo token system.** Reverting would discard a verified,
gated palette to satisfy a one-line direction, and would delete the dark theme
the other spec mandates — the contrast gate in `npm run verify` would have to be
deleted with it. What the editorial direction asks for that does *not* conflict
is being adopted: the display face stays a distinct expressive face on marketing
surfaces only, with oversized fluid headings, while the application keeps compact
type. If the editorial palette is genuinely wanted instead, say so — it is a
token-file change plus a re-run of the contrast gate, not a rebuild.


---

## Phase 2 — what changed, and one thing the tests changed about the plan

All P1 and P2 findings are closed except #4 (the primitive library), which is
Phase 3's subject.

Migration added: **`20260922000014_phase2_rls_gaps_and_grants.sql`** — enables
RLS on `media_jobs` and `product_asset_versions`, revokes tenant privileges on
both, and revokes EXECUTE on the four missed SECURITY DEFINER functions.

**The revoke turned out not to be the control.** The first version of the test
asserted `has_table_privilege('authenticated', …) = false` and failed. The
revoke does run — but this harness then replays Supabase's blanket
`grant select, insert, update, delete on all tables in schema public to
authenticated`, exactly as a hosted project does, and the privilege comes back.
So a table-level revoke is real but **not durable on this platform**: any later
migration, dashboard action or `db reset` that re-runs the platform grants
undoes it silently.

`relrowsecurity` is untouched by grants, so RLS survives all of it. The tests
were rewritten to assert the outcome that actually holds — a tenant session
reads zero rows and cannot insert — rather than a privilege bit that looks like
a guarantee and is not. Had the original assertion been made to pass instead,
it would have encoded a false guarantee.

Two further test-design notes:

- The SECURITY DEFINER check is a **sweep over `pg_proc`**, not a list of
  names, so a definer function added later fails it until explicitly revoked.
  A per-name list only catches the functions someone remembered to add — which
  is exactly how these four were missed. It carries a positive control, because
  a sweep with a wrong catalog or privilege name reports zero leaks forever.
- The pre-existing `no tenant table is left enabled-with-no-policy` guard now
  has an explicit two-entry exception rather than a loosened predicate. That
  guard catches a genuine and easy mistake — enabling RLS and forgetting the
  policies, which makes a table silently invisible to the app — and is worth
  more than the inconvenience.

Database suite: **137/137 against real PostgreSQL 16.**
