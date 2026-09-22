# OwBrand

An AI brand operating system. Describe a business once; OwBrand builds a
**Brand Brain** from it, then every downstream generation — website copy,
posts, creative, campaigns — is produced from that single source of truth
rather than from a fresh prompt each time.

```
Business description → Brand Brain → Products → Creative Studio
                                          ↓
              Analytics ← Publishing ← Campaigns → Approvals
                    ↓
          Recommendations (each one citing its evidence)
```

**Stack** — Next.js 14 (App Router) · TypeScript (strict) · Tailwind ·
Supabase (Postgres + Auth + RLS) · Claude and Gemini behind one provider
abstraction · Paddle Billing · Meta Graph API for publishing.

---

## Setup

```bash
npm install
cp .env.example .env.local     # every entry in it is read by the code
npm run dev
```

`.env.example` is the authoritative list — `grep -rn "process.env" src` is how
it is kept honest. Only four variables are required to boot:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.

Everything else is an optional integration that **reports itself unconfigured
rather than pretending to work**. `GET /api/ready` lists exactly what is
missing; read it before assuming a feature is broken.

### Database

Apply `supabase/migrations/` in filename order — **[docs/MIGRATIONS.md](docs/MIGRATIONS.md)**
lists what each one does, the two things to check afterwards, and one platform
caveat that is easy to get wrong: a table-level `revoke` is **not** durable on
Supabase, because a project's blanket grants can restore it. RLS is the control.

`supabase/schema.sql` is the original single-file schema, kept for reference
only — **the migrations are authoritative.** Where they disagree, the
migrations are right.

Then promote yourself:

```sql
update users set role = 'admin' where email = 'you@company.com';
```

### Deployment

See **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)** — environment variables,
the two scheduled workers, Meta's OAuth redirect, plan-specific function
limits, and a verification checklist.

---

## Commands

| Command                  | What it does                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm run verify`         | type-check → lint → contrast → unit tests → build. Run this before pushing                                        |
| `npm test`               | The unit and component suites                                                                                     |
| `npm run test:ui`        | The component suite only                                                                                          |
| `npm run test:db`        | Applies every migration to a throwaway PostgreSQL 16 cluster, then runs the RLS assertions. Needs `postgresql-16` |
| `npm run check:contrast` | Computes every WCAG 2.2 AA colour pair across both themes and **fails the build** on any that miss                |
| `npm run type-check`     | `tsc --noEmit`                                                                                                    |
| `npm run format`         | Prettier over `src`                                                                                               |

`test:db` is deliberately outside `verify`: it needs PostgreSQL server binaries,
which not every contributor's machine has. That it is absent from CI for the
same reason is a known gap, not a forgotten one.

Counts are left out of this table on purpose. A README that claims a test
number is wrong within a week, and a stale number is worse than none.

---

## What is real

Everything below is implemented, tested, and works with credentials supplied.

- **Auth** — email/password, Google OAuth, reset, verification; deep links
  survive the login bounce; every `/dashboard` and `/admin` route gated in
  middleware and re-checked server-side.
- **Tenancy** — RLS on every tenant table. Route handlers resolve access
  through `lib/auth/guards.ts` and return **404, never 403**, so the API is not
  an existence oracle.
- **Credits** — one `canUseFeature()` gate, an atomic Postgres RPC for the
  deduction so concurrent requests cannot double-spend, and a refund on any
  failed generation.
- **AI** — one provider abstraction with timeout, retry, backoff, fallback,
  schema-validated structured output with a repair ladder, and per-call token
  and cost recording.
- **Brand Brain / Product Brain** — versioned, restorable, and injected into
  every generation. A **factuality guard** blocks copy that asserts a claim no
  approved product fact supports; blocked assets require an explicit
  acknowledgement in the approval inbox before they can be approved.
- **Publishing** — real Meta OAuth (long-lived token exchange, scope
  inspection), provider tokens encrypted at rest with AES-256-GCM and AAD
  bound to the row, and a worker that claims jobs with
  `for update skip locked` — so **the same post cannot be published twice**,
  even with several workers running.
- **Analytics** — daily and per-post ingestion with a restatement window,
  first/last/linear attribution with cross-model disagreement reported, and
  recommendations that **cannot be written without evidence** (the database
  raises if the evidence is empty).
- **Design system** — semantic tokens, a designed dark theme (not an
  inversion), WCAG 2.2 AA verified in-browser with axe on every unauthenticated
  page in both themes, and a CVD-validated chart palette.

Two properties are enforced structurally rather than by convention, because
convention decays:

- An **unmeasured metric is `null`, never `0`.** A rate with a zero
  denominator returns `null`; coverage is recorded per metric so a chart can
  say "not reported" instead of drawing a plausible zero.
- **Testimonials and analytics are never fabricated.** Placeholder slots are
  typed `z.literal(true)`, so a generated quote cannot be presented as a real
  one.

---

## What is not real yet

Listed here rather than discovered later. Each returns a stated reason instead
of a fake success.

| Area                                                   | State                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TikTok, YouTube, LinkedIn, Pinterest, X publishing** | `publish: 'unavailable'` in the platform registry, each with a specific reason. Connecting is refused, not silently queued                                                                |
| **Meta publishing scopes**                             | Needs `instagram_content_publish` + `pages_manage_posts`, which require Meta App Review (2–6 weeks). Until granted, accounts connect but report `needs_reconnect`                         |
| **One-click deploy to Vercel/Netlify**                 | Adapter not built. `POST /api/deployment/deploy-*` returns 503 with a reason. It used to insert a `pending` row and return 200, which the UI could not distinguish from a real deployment |
| **Reel rendering**                                     | Reel _scripting_ is wired; the compositing step (Remotion/ffmpeg) is not built                                                                                                            |
| **Export ZIP section source**                          | The ZIP streams correctly but does not yet include generated section source — needs a place to persist it                                                                                 |
| **Image / video generation**                           | Provider-neutral adapters exist; no provider is wired by default. Both URL and key must be set or the adapter reports itself unconfigured                                                 |
| **Figma as a token source**                            | The design tokens were built from the written spec and verified numerically. The connected Figma workspace is a View seat on a starter tier, so there is no org library to read from      |

---

## Layout

```
src/
  app/
    (auth)/                 login, signup, reset, OAuth callback
    (dashboard)/            the authenticated app
    admin/                  admin-only panel
    api/                    route handlers
  components/
    theme/                  token bridge, three-state theme toggle
    dashboard/              shell, command palette, nav model
    analytics/              charts bound to design tokens
  lib/
    ai/                     provider abstraction, structured output, cost
    brand/, product/        Brand Brain, Product Brain, factuality guard
    social/, publishing/    OAuth, adapters, worker, retry policy
    analytics/              metrics, attribution, signals, ingestion
    auth/guards.ts          every access check
    crypto/secret-box.ts    AES-256-GCM credential encryption
    security/               CSP, rate limiting, redirects, deployment guard
  styles/tokens.css         the design system
supabase/migrations/        authoritative schema, RLS, RPCs
scripts/check-contrast.mjs  the WCAG gate
docs/DEPLOY_VERCEL.md       deployment runbook
docs/MIGRATIONS.md          migration order and post-apply checks
docs/history/               superseded planning notes — intentions, not docs
```

---

## Contributing

`npm run verify` must pass. Two rules are not negotiable:

1. **Nothing is reported as working until it is.** A stub returns its reason
   with a non-200 status; it never returns a plausible success.
2. **No fabricated data.** Not analytics, not testimonials, not a zero standing
   in for a missing measurement.
