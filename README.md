# owbrand

AI Brand Builder & Manager — built by Techtig. Describe a brand, get a full
identity and website, then keep generating on-brand photos, posts, logos, and
reels from one dashboard.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase
(Postgres + Auth) · Google Gemini (the only external AI provider) · Paddle
Billing.

## 1. Setup

```bash
npm install
cp .env.example .env.local   # fill in every value — see below
```

### Supabase

1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`. This creates every
   table, RLS policy, the `deduct_credits`/`refund_credits` RPCs, the
   new-user trigger (auto-creates a `users` row + free `subscriptions` row
   on signup), and seeds the 20 template categories.
3. Authentication → Providers → enable **Google**, add your OAuth client
   ID/secret there (not in `.env` — Supabase hosts the OAuth exchange).
4. Authentication → URL Configuration → set the Site URL and add
   `http://localhost:3000/auth/callback` (and your prod URL) as a redirect.
5. Copy the Project URL, anon key, and service_role key into `.env.local`.
6. To promote an account to admin (full Business-tier, no billing, unlimited
   credits): `update users set role = 'admin' where email = 'you@company.com';`

### Gemini

Get a key at aistudio.google.com and set `GEMINI_API_KEY`. Every AI call in
the app routes through `src/lib/gemini.ts` — there is no other AI provider
anywhere in the codebase, matching the product's cost/margin model.

### Paddle

1. Create a Paddle sandbox account, add Starter/Pro/Business monthly + yearly
   prices, and copy each price ID into `.env.local`.
2. Billing → Developer tools → Notifications → point a webhook at
   `/api/billing/paddle-webhook` and copy the signing secret into
   `PADDLE_WEBHOOK_SECRET`.
3. Copy your API key and client-side token into `.env.local`.

### Run it

```bash
npm run dev
```

## 2. What's fully wired

- Auth: email/password, Google OAuth, forgot/reset password, email
  verification (all via Supabase Auth) — `src/app/(auth)/*`
- Route protection for `/dashboard/*` and `/admin/*` — `src/middleware.ts`
- The credit + feature-gating engine: `canUseFeature()` in
  `src/lib/credits.ts` is the single shared check every metered route calls.
  Admins bypass entirely; everyone else is checked against their plan's
  feature flags and credit balance, with an atomic Postgres RPC for the
  deduction so concurrent requests can't double-spend. Failed generations
  call `refundCredits()` so the user isn't charged.
- AI Website Generator (`/dashboard/ai-generator`) → `POST
  /api/ai/generate-website` → Gemini, gated and credited correctly.
- AI Content Studio (`/dashboard/content-studio`) → `POST
  /api/ai/generate-content` for photo/post/logo/copy, plus `POST
  /api/ai/generate-reel` for reel *scripting* (Gemini plans pacing and asset
  order only — it does not generate video).
- Paddle checkout handoff + webhook handling (subscription
  created/updated/cancelled, payment succeeded/failed), syncing
  `subscriptions` and logging `payments`. Users can self-service cancel from
  the billing page (`/api/billing/manage-subscription`), proxied through
  Paddle's subscription API — the DB only updates once the resulting webhook
  lands, never from the client's request directly.
- Admin panel (`/admin`): user list, subscription overrides (upgrade,
  downgrade, extend, cancel), payment history, and a rough analytics
  overview. Admin billing bypass is enforced server-side in
  `canUseFeature()`, not just hidden in the UI.
- Full Postgres schema with RLS so a user can only ever read their own rows;
  every cross-user write goes through the service-role client from a route
  that has already checked `role === 'admin'` or verified a Paddle
  signature.

## 3. What's intentionally stubbed

This is a one-day-MVP scope build — the spec itself flags the full feature
set as aggressive for a single day, so these are left as clearly marked
`TODO`s with the surrounding architecture already in place:

- **Live preview / Monaco editor** — the AI Generator page currently shows
  the raw generated site JSON. Rendering it into an actual live iframe
  preview and wiring up `@monaco-editor/react` for direct edits is the next
  step (`src/app/(dashboard)/dashboard/ai-generator/page.tsx`).
- **Export ZIP contents** — `/api/export/export-zip` produces a real
  streamed ZIP with a README and package.json, but doesn't yet pull in the
  generated section source. That needs a place to persist generated JSX per
  section (a `site_sections` table, or blob storage) — plug the lookup in
  where marked.
- **Vercel/Netlify deploy** — `/api/deployment/deploy-*` create a `pending`
  `deployments` row and are fully gated/credited, but the actual API calls
  to Vercel/Netlify are TODO stubs.
- **Meta Graph API OAuth + publishing** — `/api/social/connect-account`
  enforces plan limits correctly but exchanges a placeholder token instead
  of calling Meta's `/oauth/access_token`. The scheduler's background
  publish worker (polling `queued` rows and posting to Meta) isn't built —
  see the note in `/api/scheduler/schedule-post`.
- **Reel compositing** — Gemini's reel *script* (`/api/ai/generate-reel`) is
  fully wired; the actual Remotion/ffmpeg.wasm render job that turns that
  script into a video file is not.
- **AI Website Assistant edits** — `buildEditPrompt()` exists in
  `lib/prompts/website.ts` but there's no route/UI wired to it yet.

## 4. Build order

Matches the spec's suggested one-day sequencing — stages 1–6 are built out
above; 7–9 are scaffolded with the integration points marked:

1. Auth + dashboard shell — done
2. AI generator + live preview — generation done, preview rendering TODO
3. Credit system + feature gating — done
4. Export to ZIP — route done, section-source lookup TODO
5. Paddle checkout + webhook — done
6. Admin panel — done
7. Content Studio + Scheduler — generation + queueing done, publish worker TODO
8. Deployment integrations — gating done, provider API calls TODO
9. Monaco editor, reels render, polish — TODO

## 5. Project structure

```
src/
  app/
    (auth)/            login, signup, forgot/reset password, OAuth callback
    (dashboard)/        the whole authenticated app shell + pages
    admin/               admin-only panel
    api/                 every route from the spec's API Routes section
  components/
    landing/             marketing site sections
    dashboard/, auth/, admin/
  lib/
    plans.ts             plan definitions + feature flags
    credits.ts           canUseFeature() — the shared gating engine
    gemini.ts             the one AI provider wrapper
    prompts/              lean, task-specific prompt builders
    paddle.ts             checkout + webhook verification
    supabase/              browser / server / admin clients
  types/                   shared domain types
supabase/schema.sql        full DB schema, RLS, RPCs, seed data
```

## OwBrand product architecture

The application is now structured as an AI brand operating system:

**Business description → Brand Brain → Products → Creative Studio → Campaigns → Publishing → Analytics → AI recommendations**

The original brand kit, AI website generator, content generator, scheduler, social connection, templates, Paddle billing and credit infrastructure remain part of the product. New modules are layered on top instead of replacing the working foundation.

See `OWBRAND_PHASES.md` for the implementation roadmap and production requirements.


## OwBrand Phase 3

Publishing + campaign orchestration foundations are included. See `PHASE_3.md`.
