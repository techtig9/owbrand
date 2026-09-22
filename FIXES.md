# FIXES

What changed across phases 1–5, what did not, and what only you can do.

Verified state at the end of phase 5, from a **fresh clone with no environment
variables**: `npm ci`, `type-check`, `lint` (zero warnings), `check:contrast`,
533 unit tests across 33 files, and `build` all pass. Against that build in a
real browser: **163/163 assertions, zero failures**. Against real PostgreSQL 16:
**137/137**.

---

## 1. Fixed

### Security

| What                                                                                | Why it mattered                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two tables had RLS disabled** — `media_jobs`, `product_asset_versions`            | Orphans from a legacy migration, referenced by no code. But RLS off plus Supabase's default grants made both fully readable and writable through PostgREST by anyone with the public anon key and a session, and `media_jobs`' foreign keys to `brands`/`products` made it an existence oracle: insert a guessed `brand_id` and the FK either violates or does not. |
| **Cron endpoints described themselves to anonymous callers**                        | All three answered any request with `503 "The publishing worker trigger is not configured. Set CRON_SECRET."` — confirming the path, naming the feature, and naming the missing variable. Now `404`, byte-identical to a wrong secret.                                                                                                                              |
| **A missing Paddle webhook secret was indistinguishable from a forged signature**   | The secret was read inside `try { … } catch { return null }`, so an unset variable produced "invalid signature" on every genuine Paddle event. It failed closed, but an operator watching upgrades silently never apply had no way to tell a forgotten variable from an attack.                                                                                     |
| **Cross-tenant write on both deployment routes**                                    | `deploy-vercel` and `deploy-netlify` accepted `brandId` and wrote it into `project_id` with no access check. The plan gate above them checked what the caller was entitled to _do_, never what they were entitled to do it _to_.                                                                                                                                    |
| **An admin override logged the admin's email address** into the platform log stream | A sink with different retention and access rules, which an operator cannot purge on a deletion request. It now writes a real `audit_logs` row and logs the actor by id.                                                                                                                                                                                             |
| **Four SECURITY DEFINER functions kept the default PUBLIC EXECUTE**                 | `derive_product_workspace`, `sync_campaign_aliases`, `handle_new_user`, `set_updated_at`.                                                                                                                                                                                                                                                                           |
| **A brand shared through a workspace was invisible on `brand-kit`**                 | It queried `.eq('user_id', …)`, so the page reported "no brand kit yet" for a brand visible on every other screen.                                                                                                                                                                                                                                                  |

### Correctness

- **Missing Supabase credentials took the whole deployment down.** `createServerClient` throws on an empty URL and ran in middleware on every request, so even `/api/ready` — the endpoint whose job is to report misconfiguration — returned 500. Public pages now render; `/dashboard` and `/admin` fail closed to `/login?error=not_configured`.
- **A missing environment variable produced an opaque 500** on every gated route. Now `503 not_configured`, without naming the variable to an anonymous caller.
- **All four Supabase client factories bypassed the validated env module** with `process.env.X!`, so the runtime error was supabase-js's own prose, which nothing downstream could classify. A non-null assertion on configuration is not a type fix — it converts a startup error into a runtime crash whose text you do not control.
- **`campaigns` fetched its list twice on every first load** and swallowed failures with a floating promise, leaving an empty page with no explanation.
- **`deploy-vercel`/`deploy-netlify` returned HTTP 200 with a `pending` row** the UI could not distinguish from a real deployment. Now 503 with a reason, and nothing is inserted.

### Quality

- **`src/components/ui/` created**: Button, Input, Textarea, Select, Tabs, Modal, Drawer, Tooltip, Card, Badge, Avatar, Progress, Table, Td, Skeleton, LoadingPanel, EmptyState — with 26 tests covering keyboard navigation, focus trapping in both directions, and label association.
- **20 hand-rolled skeletons across 10 files** replaced; the duplicate stat card removed.
- **Zero lint warnings**, from three. Both remaining ones had substance.
- **Three unused dependencies removed**: `@monaco-editor/react`, `framer-motion`, `clsx`.
- **Two dead type modules deleted**; 20 stale planning documents archived to `docs/history/` with an index saying plainly that they contradict the code.
- **CI gained the contrast gate and a PostgreSQL 16 job** running the full migration chain plus RLS assertions — closing a gap reported honestly in every earlier phase report.
- **`engines` pinned to `>=20.9.0`** (Node 18 is end-of-life).

---

## 2. Not fixed, and why

| Area                                                    | Why not                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meta publishing scopes**                              | `instagram_content_publish` and `pages_manage_posts` require Meta App Review, 2–6 weeks. Nothing in the code can shorten that. Accounts connect and report `needs_reconnect`; publishing is refused rather than attempted. |
| **TikTok, YouTube, LinkedIn, Pinterest, X**             | Each needs its own approved app and its own adapter. The platform registry marks them `publish: 'unavailable'` with a specific reason, so connecting is refused rather than silently queued. Ranked in `ROADMAP.md`.       |
| **One-click deploy to Vercel/Netlify**                  | Needs a durable job with lease/retry semantics like the publishing worker, not a fire-and-forget call. Returns 503 with a reason.                                                                                          |
| **Reel rendering**                                      | Scripting is wired; compositing needs a render service (Remotion or ffmpeg on a worker). Out of scope for a repository-level change.                                                                                       |
| **`export-zip` section source**                         | The archive streams correctly but omits generated section source, which has nowhere to be persisted yet.                                                                                                                   |
| **Image/video generation**                              | Provider-neutral adapters exist; no provider is wired by default. Both URL and key must be set or the adapter reports itself unconfigured.                                                                                 |
| **Figma as a token source**                             | The connected workspace is a View seat on a starter-tier team, so there is no organisation library to read. Tokens were built from the written spec and verified numerically instead.                                      |
| **axe coverage of authenticated screens**               | The audit runs against five unauthenticated pages in both themes. Auditing the app shell needs a seeded Supabase project and a real session.                                                                               |
| **`media_jobs` / `product_asset_versions` not dropped** | Dropping an existing table is destructive and irreversible if some deployment did write to them. Locked down and labelled superseded instead.                                                                              |
| **Remaining `next` advisories**                         | Need a Next 15 major upgrade. This branch is on 14.2.35, already bumped from 14.2.13 for the Server Actions DoS.                                                                                                           |

---

## 3. Design decisions

**The indigo token system was kept, against the brief.** The fix-all brief
assigns owbrand a cream-and-ink editorial palette. The repository implements a
deep-indigo primary with a designed dark theme, from
`OWBRAND_FRONTEND_DESIGN_SPEC` §2/§3, verified by 68 computed WCAG pairs and axe
in both themes. Reverting would discard a gated palette and delete the dark
theme the other spec mandates — the contrast gate would have to go with it. The
editorial _typography_ that does not conflict is adopted: a distinct expressive
display face on marketing surfaces with oversized fluid headings, compact type
in the app. **If you want the editorial palette instead, say so** — it is a
token-file change plus a contrast re-run, not a rebuild.

**404 for cron, 503 for everything else.** Honest misconfiguration reporting is
right nearly everywhere; the cron routes are the exception because the caller is
anonymous and unauthenticated. The distinction is who is asking, not what went
wrong.

**RLS is the control; a `revoke` is a second layer.** Supabase applies blanket
`grant … on all tables … to authenticated`, so anything re-running those grants
silently restores a revoked privilege. `relrowsecurity` is untouched by grants.
The test suite found this by failing — and the assertion was rewritten to test
behaviour rather than made to pass, because passing it would have encoded a
guarantee the platform does not provide.

**Required props over optional ones** where a missing value is a defect.
`EmptyState.action` is required, which failed to compile on `brand-kit` and
exposed a dead-end empty state. `Badge.children` and `Avatar.name` likewise: a
badge with no text is state carried by colour alone, and an avatar with no name
is an unlabelled glyph.

**Test counts removed from the README.** It claimed 473 and the real number was
521 before anyone could read it. A stale number is worse than none, because the
reader cannot tell which parts of the document aged.

**Sweeps over lists** for security checks. The SECURITY DEFINER test enumerates
`pg_proc` rather than naming functions, so one added later fails until
explicitly revoked — a per-name list only catches what someone remembered to
add, which is how the four this release fixes were missed.

---

## 4. MANUAL ACTIONS FOR YOU

Nothing below can be done from the repository.

### 4.1 Environment variables

Required to boot — set for Production, Preview and Development:

```
NEXT_PUBLIC_SUPABASE_URL          Supabase → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY     Supabase → Settings → API
SUPABASE_SERVICE_ROLE_KEY         Supabase → Settings → API. BYPASSES RLS
NEXT_PUBLIC_SITE_URL              your canonical origin, no trailing slash
```

> `NEXT_PUBLIC_*` values are **inlined at build time**. Changing one without
> rebuilding has no effect. This bites hardest with `NEXT_PUBLIC_SUPABASE_URL`,
> which is baked into the Content-Security-Policy — a stale value means the
> browser blocks every Supabase request as a CSP violation.

Required before anything can publish:

```
TOKEN_ENCRYPTION_KEY    openssl rand -base64 32   (must decode to 32 bytes)
CRON_SECRET             openssl rand -hex 32
META_APP_ID             Meta app dashboard
META_APP_SECRET         Meta app dashboard
```

Rotating `TOKEN_ENCRYPTION_KEY` makes every stored social credential
unreadable; accounts report `needs_reconnect` until re-authorised.

Optional; each reports itself unconfigured rather than failing oddly:
`RESEND_API_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_*` (six),
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL`, `AI_PROVIDER_ORDER`, `GEMINI_API_KEY`, `IMAGE_PROVIDER_*`,
`VIDEO_PROVIDER_*`, `APP_VERSION`.

**Set Upstash in production.** Without it, rate limits are enforced per
process, which does not hold on a serverless platform — an attacker only needs
their requests to land on different instances. `/api/ready` reports this as
`degraded`.

`VERCEL_API_TOKEN` and `NETLIFY_API_TOKEN` are listed in `.env.example` and
**read by nothing**. Setting them has no effect today.

### 4.2 Migration order

Apply in filename order; see [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) for what
each does.

```
1  20260816_phase2.sql
2  20260818000009_phase15_domain.sql
3  20260907000010_phase1_security_hardening.sql
4  20260907000011_phase2_ai_brand_creative.sql
5  20260908000012_phase3_publishing_social.sql
6  20260908000013_phase4_analytics_attribution.sql
7  20260922000014_phase2_rls_gaps_and_grants.sql   ← new this release
```

Then run the two verification queries in `docs/MIGRATIONS.md` §"Two things to
check". Do not skip them: they are the difference between believing RLS is on
and knowing it.

### 4.3 Auth redirect URLs

Supabase → Authentication → URL Configuration:

- **Site URL**: your `NEXT_PUBLIC_SITE_URL`
- **Redirect URLs**: `<site>/auth/callback` and `http://localhost:3000/auth/callback`

Preview deployments get a new hostname per branch, so either add a wildcard
(`https://*-yourteam.vercel.app/auth/callback`) or accept that OAuth only
completes on production. Otherwise Google sign-in fails with
`redirect_uri_mismatch`.

Meta app → Valid OAuth Redirect URIs, character for character:

```
<NEXT_PUBLIC_SITE_URL>/api/social/oauth/callback
```

### 4.4 Vercel settings

- **Root directory**: repository root. **Framework**: Next.js (pinned in `vercel.json`).
- **Node version**: 20.x or later (`engines` requires `>=20.9.0`).
- **Function duration**: the three cron routes declare `maxDuration = 300`. **The Hobby plan caps this at 60s**; lower them and keep the publish batch small (`?batch=3`), or use Pro. Publishing an Instagram video means polling a container until Meta finishes processing, and the 10s default aborts mid-publish.
- **Cron**: not committed, deliberately. Minute granularity needs Pro, and committing a `* * * * *` schedule breaks a Hobby production deploy. The block to paste, and a `pg_cron` alternative that works on any tier, are in [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) §6.
- **Deployment protection**: currently off for this project, so preview URLs are publicly reachable. Turn it back on if that is not what you want.

### 4.5 Keys to rotate

**None from this repository.** Git history was scanned across all 17 commits;
the only matches are test fixtures asserting that fake secrets do _not_ leak
(`tests/api/errors.test.ts` uses the literal `sk_live_abc` to prove the error
serialiser strips it).

Rotate anyway if any key was ever pasted into a chat, an issue or a CI log.

### 4.6 Promote an admin

```sql
update users set role = 'admin' where email = 'you@company.com';
```

There is no UI for this on purpose: a self-service route to admin is a
privilege-escalation path.

---

## 5. Phase 7 — backend, security and reliability

### 5.1 New migrations (apply in order)

| File                                         | What it does                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `20260922000016_phase7_account_deletion.sql` | Deletion function; `payments.user_id` cascade → `set null`; `approvals.reviewer_id` gains `on delete set null`; 14 FK indexes |
| `20260922000017_phase7_dead_letter.sql`      | `dead_letter` status for `publishing_jobs`, `requeue_dead_letter_job()`                                                       |
| `20260922000018_phase7_public_api.sql`       | `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `claim_webhook_deliveries()`                                           |

Two foreign keys change their ON DELETE behaviour. Nothing is dropped and no
row is deleted. `20260922000017` reclassifies existing `failed` jobs to
`dead_letter` **only** where they are at the attempt ceiling with no error
code recorded — rows with an error code are left alone rather than guessed at.

### 5.2 New environment variables (all optional, all with working defaults)

| Variable                   | Default | What it does                                                                                                                                                 |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_KILL_SWITCH`           | `false` | Set to `true` to refuse every generation immediately. Needs no database and no deploy — it is the control that still works when the database is the problem. |
| `AI_DAILY_BUDGET_USD`      | `25`    | Rolling 24-hour ceiling on estimated AI spend across the deployment. `0` disables the cap.                                                                   |
| `AI_USER_DAILY_BUDGET_USD` | `5`     | The same, per user, so one account cannot consume the global ceiling.                                                                                        |

**These default ON with real numbers.** A cap that waits for someone to
configure it protects only the deployments whose operator had already thought
about the problem — and a runaway loop happens at 3am on the one that nobody
configured. Raise them deliberately.

The budget **fails open** if `ai_usage_logs` cannot be read. Refusing every
generation during a metrics outage would turn it into a full product outage.
The kill switch is the control for the opposite preference.

### 5.3 MANUAL ACTIONS FOR ME

1. **Schedule the webhook worker.** `/api/cron/webhooks` needs a trigger the
   same way `/api/cron/publish` does — every 1–5 minutes, with `CRON_SECRET`
   in an `Authorization: Bearer` header. Nothing was added to `vercel.json`,
   because a cron entry changes deploy behaviour and frequent crons need a
   paid plan. Until it is scheduled, webhook deliveries queue and never send.
2. **Decide the AI budgets.** The defaults above are conservative guesses.
   `AI_DAILY_BUDGET_USD=25` will stop a busy day on a real customer base.
3. **Set up a monitoring vendor.** `lib/monitoring.ts` is the seam, with the
   vendor call left as a comment rather than a half-wired SDK that silently
   does nothing. `isMonitoringConfigured()` returns `false` and `/api/ready`
   reports it honestly.
4. **Real provider token revocation on account deletion.** Deletion marks
   social accounts revoked and removes the encrypted tokens, but does not call
   each platform's revoke endpoint — that is per-platform work that does not
   exist yet. Listed here rather than implied away in a comment.
5. **DNS pinning for outbound fetches.** `assertSafeFetchTarget` resolves a
   hostname and checks every returned address, which narrows the DNS-rebinding
   window but does not close it. Closing it means pinning the socket to the
   resolved address, which belongs in a fetch layer that does not exist yet.
   The only code that fetches a customer-supplied URL today is the webhook
   sender, and it re-validates at send time.

### 5.4 What Phase 7 deliberately did NOT build

- **Workspace roles and invitations.** The tables support multi-user
  workspaces and `accessibleBrandIds` already resolves through them, but there
  is no invitation flow and no role editor. It is in `ROADMAP.md` rather than
  half-built, because it is a pricing decision first: seats change the plan
  structure, and building the mechanics before deciding whether seats are
  billed produces the wrong mechanics.
- **Write endpoints on the public API.** They need an answer to what happens
  when generated copy is blocked by the factuality guard with nobody watching.
  Shipping one before answering that is how an API starts silently discarding
  work.

---

## 6. Five-minute test checklist

After deploying, in order. Each line is one thing that has actually broken here.

1. **`curl -s https://<domain>/api/ready | jq`** — read it, do not skim. It names each unconfigured integration instead of returning a single tick.
2. **`/` renders**, and the theme toggle survives a reload.
3. **Switch to dark.** Every surface changes, nothing stays white. A single literal `bg-white` surviving the theme is the failure mode here, and it happened on 54 nodes.
4. **`/dashboard` while signed out** → redirects to `/login?next=/dashboard`, and logging in lands you on `/dashboard`, not the home page.
5. **Sign up** → a `users` row and a free `subscriptions` row both appear.
6. **`curl -X POST https://<domain>/api/cron/publish`** with no secret → **404**. Not 401, not 503, and no mention of `CRON_SECRET` in the body.
7. **The same call with the secret** → 200 and a run summary.
8. **Response headers** carry `Content-Security-Policy` and `Strict-Transport-Security`, and the CSP's `connect-src` contains _your_ Supabase URL — not a placeholder from a stale build.
9. **Two accounts in different brands cannot see each other's content.** Worth doing by hand once per deployment: CI tests the policies as written, not the policies as applied to the database you just pointed at.
10. **Resize to 375px wide.** The sidebar becomes a drawer and the app is still usable. It previously just vanished.
11. **Create an API key in Settings, then `curl -H "Authorization: Bearer owb_live_…" https://<domain>/api/v1/brands`** → your brands. The same call with one character changed → 401 with the _same_ message as a revoked key.
12. **`curl https://<domain>/api/v1/openapi.json | jq .info.version`** → `1.0.0`, and the `servers[0].url` is your domain, not a placeholder.
13. **Add a webhook endpoint pointing at `https://webhook.site/<id>`, publish a post.** The delivery appears in Settings within a minute of the cron firing, and the `X-OwBrand-Signature` verifies against the raw body. If it never arrives, the webhook cron is not scheduled — see 5.3.

---

## 7. Final verification — five routes that 500'd when unconfigured

The fresh-clone run at the end of Phase 9 found a class of bug that had
survived every phase: **five routes returned a raw 500 when an environment
variable was missing**, instead of a 503.

| Route                              | What happened                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/social/oauth/callback`       | `supabaseAdmin()` threw before any config check. The route's own doc comment promises every failure redirects with a generic `social_error` code; this one did not. |
| `/api/billing/paddle-webhook`      | Threw on both the signature secret and the database. Paddle retries a 503 and gives up on a 500, so the event was lost.                                             |
| `/api/billing/subscription-status` | Not wrapped in `routeHandler`, so the `MissingEnvError` → 503 mapping never applied.                                                                                |
| `/api/admin/list-users`            | As above.                                                                                                                                                           |
| `/api/media/upload`                | As above.                                                                                                                                                           |

**Why it mattered.** A 500 tells an operator the application is broken when
the truth is that it is unconfigured, which sends them debugging the wrong
thing. And a retrying caller — Paddle, a cron scheduler, a client with
backoff — treats a recoverable state as permanent.

**Why nothing caught it for nine phases.** Every environment these ran in had
Supabase configured, so the failing path was never taken. Exactly the reason
the cron endpoints leaked in Phase 2. The only check that exercises it is a
fresh clone with nothing set.

Three regression assertions now live in `tests/browser/smoke.js`, which probes
over real HTTP. Two more live in `tests/api/unconfigured-routes.test.ts`; the
two routes that read a session cookie are deliberately **not** asserted there,
because calling their handler outside a request scope throws Next's own
`cookies()` error long before any configuration is read — a green test that
proves nothing is how the original bug survived.

### The browser suite now skips rather than lies

The suite also **aborted at assertion 88** on an unconfigured server:
`page.goto` rejects on a non-2xx, so the OAuth-callback check killed the run
and 85 later assertions never executed while the run still looked like a
failure of one thing. That check now uses `fetch` with `redirect: 'manual'`,
which can see the redirect directly.

Nine assertions genuinely require a configured Supabase — the Google button
cannot initiate a flow without a project, and the middleware deliberately
redirects with `error=not_configured` instead of `?next=` when auth is
unconfigured. They are now **skipped with a stated reason** rather than failed,
and the summary prints the skip count plus a warning that a skipped run proves
less than it looks. Failing them reports bugs that do not exist; passing them
silently would claim coverage the suite never had.

**Result: 164/164 passed, 0 failed, 9 skipped.**
