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

| #   | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | File                                           | Status    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- |
| 1   | **Two tables have RLS disabled and no policies.** `media_jobs` and `product_asset_versions` are orphans from a legacy migration, superseded by `generation_jobs`/`asset_versions` and referenced by no application code. But RLS off + Supabase's default grants means any authenticated user can read and write them through PostgREST, and their FKs to `brands`/`products` turn them into an existence oracle: insert a guessed `brand_id` and a FK violation versus success reveals whether that brand exists. Empty today, an instant leak the moment anything writes to them. | `supabase/migrations/20260816_phase2.sql:2,19` | **fixed** |
| 2   | **Non-null assertion on the billing webhook secret.** `paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, sig)`. Explicitly forbidden by the Phase 2 rules, and it is the signature verifier: with the variable unset this throws inside the handler instead of refusing the request with a stated reason.                                                                                                                                                                                                                                                      | `src/lib/paddle.ts:32`                         | **fixed** |
| 3   | **Paddle config bypasses the validated env module.** `new Paddle(process.env.PADDLE_API_KEY)` and `priceIdFor()` read `process.env` directly and throw a plain `Error`, so a missing price ID surfaces as a generic 500 rather than `not_configured`. Same defect class as the Supabase factories fixed in `a4df084` — the env module exists to be the only path to configuration.                                                                                                                                                                                                  | `src/lib/paddle.ts:15,24`                      | **fixed** |

---

## P2 — buttons, UX, configuration

| #   | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                              | File                                                                                                                                 | Status    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 4   | **No shared UI primitive library.** `src/components/ui/` does not exist; components are scattered per feature. Missing: Tabs, Modal, Drawer, Tooltip, Table, Avatar, Progress, Select, Textarea. Consequences are already visible: 11 files hand-roll `animate-pulse` skeletons at different heights, so the layout jumps differently on every page, and two files define their own `Stat` card.                                                   | `src/components/*`                                                                                                                   | **fixed** |
| 5   | **Four SECURITY DEFINER functions keep the default PUBLIC EXECUTE.** `derive_product_workspace`, `sync_campaign_aliases`, `handle_new_user`, `set_updated_at`. The dangerous ones (`reserve_credits`, `complete_publishing_job`, the `upsert_*` family) are correctly revoked; these four were missed. The last two are trigger functions, so exposure is low, but a definer function callable by `anon` is exactly what the hardening rule names. | `supabase/migrations/*.sql`                                                                                                          | **fixed** |
| 6   | **Three unused dependencies ship in the bundle graph.** `@monaco-editor/react`, `framer-motion`, `clsx` — nothing imports any of them. The first two are large.                                                                                                                                                                                                                                                                                    | `package.json`                                                                                                                       | **fixed** |
| 7   | **`.env.example` is out of sync.** Missing `AI_PROVIDER_ORDER` and `ANTHROPIC_MODEL`, which the code reads. Documents `VERCEL_API_TOKEN` and `NETLIFY_API_TOKEN`, which nothing reads now that both deployment adapters return 503.                                                                                                                                                                                                                | `.env.example`                                                                                                                       | **fixed** |
| 8   | **`.gitignore` missing `dist` and `*.zip`.** Phase 5 produces a zip in the parent directory, but the pattern belongs there regardless.                                                                                                                                                                                                                                                                                                             | `.gitignore`                                                                                                                         | **fixed** |
| 9   | **`metadataBase` duplicates the localhost fallback** instead of reading `publicEnv.siteUrl`, which already encodes it. A second literal is a second thing to get wrong.                                                                                                                                                                                                                                                                            | `src/app/layout.tsx:44`                                                                                                              | **fixed** |
| 10  | **Three `console.*` calls bypass the structured logger**, and one of them writes a user's email address into platform logs — PII in a sink with different retention and access rules from the app's own.                                                                                                                                                                                                                                           | `src/app/api/admin/override-subscription/route.ts:53`, `src/app/api/billing/manage-subscription/route.ts:37`, `src/app/error.tsx:18` | **fixed** |

---

## P3 — polish and later-phase scope

| #   | Issue                                                                                                       | Scope                               |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 11  | No `sitemap.ts`, `robots.ts` or OG image.                                                                   | Phase 6                             |
| 12  | No legal pages, help centre, contact form, changelog or blog.                                               | Phase 6 / 9                         |
| 13  | `export-zip` streams a valid archive but omits generated section source.                                    | tracked, needs a persistence target |
| 14  | Vercel/Netlify deploy adapters unbuilt — both return 503 with a stated reason, which is honest, not broken. | ROADMAP                             |

---

## Design direction — a conflict, stated rather than resolved silently

The fix-all brief assigns owbrand _"editorial; serif display, cream/ink with one
bold accent, oversized type."_ The repository currently implements the opposite:
a deep-indigo primary on near-white surfaces with a designed dark theme, built
from `OWBRAND_FRONTEND_DESIGN_SPEC` §2/§3 and verified by 68 computed WCAG 2.2
AA contrast pairs plus axe on five pages in both themes.

The cream/coral editorial palette is what was there _before_; replacing it was
the whole of the previous Phase 5.

**Decision: keep the indigo token system.** Reverting would discard a verified,
gated palette to satisfy a one-line direction, and would delete the dark theme
the other spec mandates — the contrast gate in `npm run verify` would have to be
deleted with it. What the editorial direction asks for that does _not_ conflict
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

---

## Phase 3 — the primitive library

`src/components/ui/` now exists: Button, Input, Textarea, Select, Tabs, Modal,
Drawer, Tooltip, Card, Badge, Avatar, Progress, Table, Td, Skeleton,
LoadingPanel, EmptyState, and a local `cn` (which is why `clsx` could be
removed — twelve lines against a dependency).

Applied, not just added: **20 hand-rolled `animate-pulse` skeletons across 10
files** replaced with `<Skeleton>`, `ApprovalInbox`'s private `Stat` card
replaced with the shared `StatCard`, and `dashboard/shared.tsx` reduced to
re-exports plus the two genuinely dashboard-shaped compositions. Size and
radius classes were preserved at each call site — those legitimately vary, and
rewriting them would have been a visual change dressed as a refactor.

Three API decisions that the type checker then enforced:

- **`EmptyState.action` is required.** This immediately failed to compile on
  `brand-kit`, which rendered _"Generate a brand in the AI Generator first"_
  with no link — an instruction naming a destination the reader then had to go
  and find. It now has a button. A required prop found that; a lint rule could
  not have.
- **`Badge.children` is required**, because a badge with no text is state
  carried by colour alone (WCAG 1.4.1).
- **`Avatar.name` is required** and is used for both the initial and the
  accessible name, so an avatar cannot ship as an unlabelled glyph.

While rebuilding `brand-kit` a second bug surfaced: it queried
`.eq('user_id', user.id)`, so a brand shared through a workspace was invisible
there while visible on every other screen — the page reported "no brand kit
yet" for a brand that plainly existed. Now scoped through `accessibleBrandIds`.

26 new component tests cover what justifies each primitive existing — roving
tabindex, arrow/Home/End navigation, disabled-tab skipping, focus trapping in
**both** directions, scroll-lock restoration, label/hint/error association,
and a tooltip that appears on focus, describes rather than renames, and
dismisses on Escape.

`@testing-library/jest-dom` was added and registered globally in
`tests/setup.ts` rather than per file, so a component test cannot pass by
accident through a missing matcher.

Totals: **521 unit tests (32 files)**, zero lint warnings, contrast gate and
build pass.

---

## Phase 4 — repository cleanup

- **Two dead type modules deleted**: `lib/jobs/job-contract.ts` and
  `lib/publishing/platform-types.ts`. Both were orphaned interfaces superseded
  by `job-store.ts` and `social/platforms.ts`; nothing imported either.
- **Twenty planning documents moved out of the repository root** into
  `docs/history/`, with an index stating plainly that they describe intentions
  and several contradict the shipped code — `PHASE_2_SETUP.md` routes every AI
  call through a `lib/gemini.ts` that no longer exists, and
  `PHASE_1_DESIGN_SYSTEM.md` specifies the palette the indigo system replaced.
  Archived rather than deleted: they record _why_ decisions were taken, which a
  diff cannot show. The root now holds `README.md` and `AUDIT.md`.
- **`docs/MIGRATIONS.md`** added: what each of the seven migrations does, the
  two post-apply checks worth running as SQL, and the Supabase grant caveat.
- **`npm run test:db` and `npm run test:ui`** added. `test:db` was the
  workflow the README described without providing a way to run it.
- **`engines` pinned to `>=20.9.0`.** It said `>=18.17.0` — Node 18 is
  end-of-life, and Vercel warns that an open-ended floor silently follows each
  new major.
- **Test counts removed from the README.** It claimed 473; the number was 521
  by the time anyone read it. A stale count is worse than none.
- **CI gained two things**: the contrast gate, and a second job that installs
  PostgreSQL 16 and runs the full migration chain plus the RLS assertions.
  That closes the "database suite is not in CI" gap reported honestly in every
  previous phase report.

`npm ci` from the committed lockfile succeeds. No build output, archives or
secrets are tracked. Git history contains no secrets — the only matches are
test fixtures asserting that fake secrets do **not** leak.

---

## Phase 5 — fresh-clone verification, and what it caught

Cloned the branch head into an empty directory with **no environment variables
set at all**, then ran the whole gauntlet:

| Step | Result |
|---|---|
| `npm ci` from the committed lockfile | pass |
| `tsc --noEmit` | pass |
| `next lint` | pass, zero warnings |
| `check:contrast` | pass |
| `npm test` | **533 passed, 33 files** |
| `next build` with no env vars | pass |
| Browser suite against that build | **163/163, zero failures** |

**The browser run against the fresh clone found a real information
disclosure.** All three cron routes answered any anonymous request with
`503 {"error":"The publishing worker trigger is not configured. Set
CRON_SECRET.","code":"not_configured"}` — confirming the path, naming the
feature, and naming the missing variable. It also contradicted the same files'
own stated policy, which explains a few lines lower that a wrong secret gets
404 rather than 401 so a caller cannot learn a publishing trigger lives there.

Fixed to 404, byte-identical to a wrong secret, with 12 unit tests pinning it.

**Why four phases of green runs missed it:** the leak is invisible in the happy
path. With `CRON_SECRET` set, every assertion passes either way — and the
earlier "165/165" run was green because *that* environment had the secret. A
suite that passes because the environment happened to be configured is not
evidence about the unconfigured case, which is the case every first deployment
is in. Running the suite against a clone with nothing set is what surfaced it.

Release archive: `owbrand-clean.zip`, 736 KB, 534 entries, containing no
`node_modules`, no `.next`, and no `.env` other than `.env.example`.

Written this phase: `FIXES.md` (what changed, what did not and why, design
decisions, manual actions, a five-minute checklist) and `ROADMAP.md`.
