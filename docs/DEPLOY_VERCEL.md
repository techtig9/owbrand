# Deploying OwBrand to Vercel

Written to be followed top to bottom. Each step says what breaks if you skip
it, because the failure modes here are mostly silent.

---

## 0. What a deployment with no configuration does

Nothing crashes, and nothing pretends to work.

| Surface                              | With no env vars                               |
| ------------------------------------ | ---------------------------------------------- |
| Marketing pages, `/login`, `/signup` | Render normally                                |
| `/dashboard`, `/admin`               | Redirect to `/login?error=not_configured`      |
| `/api/ready`                         | Reports every unconfigured integration by name |
| Publishing, AI, billing, email       | Refuse with a stated reason                    |

That is deliberate — a first deploy should be diagnosable, not a wall of 500s.
`src/lib/security/deployment-guard.ts` carries the reasoning. It is **not** a
demo mode: an unconfigured deployment serves no tenant data, because there is
no database attached to serve it from.

---

## 1. Create the project

Import the repository at [vercel.com/new](https://vercel.com/new). Framework
detection finds Next.js; `vercel.json` pins it anyway along with `npm ci`, so
the lockfile is honoured rather than resolved afresh.

Set **Node.js Version** to 20.x or later (`package.json` requires >= 18.17).

---

## 2. Set the environment variables

`.env.example` is the complete list and every entry in it is read by the code
(`grep -rn "process.env" src` is the source of truth). Set them for
**Production, Preview and Development** unless noted.

### Required — the app is not usable without these

| Variable                        | Where it comes from                                                            |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Settings → API                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Settings → API. **Bypasses RLS** — never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL`          | Your canonical origin, no trailing slash                                       |

> **`NEXT_PUBLIC_*` values are inlined at build time.** Changing one and
> redeploying without rebuilding has no effect. This bites hardest with
> `NEXT_PUBLIC_SUPABASE_URL`, which is baked into the Content-Security-Policy —
> a stale value means the browser blocks every Supabase request with a CSP
> violation, and the app looks broken for reasons the error console explains
> only obliquely.

### Required before anything can publish

| Variable                         | Notes                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_ENCRYPTION_KEY`           | `openssl rand -base64 32`. Must decode to exactly 32 bytes. Provider tokens are AES-256-GCM encrypted with it; **rotating it makes every stored credential unreadable** and all accounts report `needs_reconnect` |
| `CRON_SECRET`                    | `openssl rand -hex 32`. While unset, `/api/cron/publish` refuses every caller and scheduling is disabled — by design, so a deployment cannot ship a publicly callable publish trigger                             |
| `META_APP_ID`, `META_APP_SECRET` | Meta app credentials                                                                                                                                                                                              |

### Optional integrations

Each reports itself unconfigured rather than failing mysteriously:
`RESEND_API_KEY` (email), `PADDLE_*` (billing), `UPSTASH_REDIS_REST_*` (rate
limiting), `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (AI), `IMAGE_PROVIDER_*` /
`VIDEO_PROVIDER_*` (media).

**Set Upstash in production.** Without it, rate limits are enforced
per-process, which does not hold on a serverless platform — an attacker only
needs their requests to land on different instances. `/api/ready` reports this
as `degraded`.

---

## 3. Apply the database

In order — later migrations assume earlier ones:

```bash
supabase link --project-ref <ref>
supabase db push
```

Or paste each file in `supabase/migrations/` into the SQL editor in filename
order. Then confirm RLS is on for every tenant table:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
```

Anything with `rowsecurity = false` that holds tenant rows is a data leak. Stop
and fix it before pointing a domain at the deployment.

---

## 4. Supabase auth URLs

Authentication → URL Configuration:

- **Site URL**: your `NEXT_PUBLIC_SITE_URL`
- **Redirect URLs**: `<site>/auth/callback`, plus `http://localhost:3000/auth/callback`

Vercel preview deployments get a new hostname per branch, so either add a
wildcard redirect (`https://*-yourteam.vercel.app/auth/callback`) or accept
that OAuth only completes on production. Google sign-in fails with
`redirect_uri_mismatch` otherwise.

---

## 5. Meta OAuth redirect

In the Meta app, add exactly:

```
<NEXT_PUBLIC_SITE_URL>/api/social/oauth/callback
```

It must match character for character.

Publishing needs `instagram_content_publish` and `pages_manage_posts`, which
require **Meta App Review — 2 to 6 weeks**. Until they are granted an account
connects but reports `needs_reconnect`, and the app refuses to publish rather
than attempting a call it knows will fail.

---

## 6. Schedule the workers

Two jobs. Both accept `Authorization: Bearer <CRON_SECRET>` or
`x-cron-secret: <CRON_SECRET>`, and both accept GET and POST so any scheduler
can drive them.

| Endpoint                  | Cadence      | Purpose                        |
| ------------------------- | ------------ | ------------------------------ |
| `/api/cron/publish`       | every minute | Sends due posts                |
| `/api/cron/social-health` | daily        | Refreshes tokens before expiry |
| `/api/cron/analytics`     | hourly       | Ingests platform insights      |

### Option A — Vercel Cron (requires Pro)

Add to `vercel.json`:

```json
"crons": [
  { "path": "/api/cron/publish", "schedule": "* * * * *" },
  { "path": "/api/cron/analytics", "schedule": "0 * * * *" },
  { "path": "/api/cron/social-health", "schedule": "0 4 * * *" }
]
```

Vercel injects `Authorization: Bearer $CRON_SECRET` automatically when that
variable is set, so no further wiring is needed.

**This block is not committed, and that is on purpose.** On the Hobby plan
cron granularity is capped at once per day and only two jobs are allowed, so
committing a minute-level schedule would make a Hobby production deploy fail
for everyone who forks the repo. Paste it in once you are on Pro.

### Option B — Supabase `pg_cron` (any plan)

Minute granularity on any tier, and it runs next to the data:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'owbrand-publish', '* * * * *',
  $$select net.http_post(
      url := 'https://<your-domain>/api/cron/publish',
      headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
    );$$
);
```

Store the secret in Supabase Vault rather than inline in the job definition —
`cron.job` is readable by anyone with database access.

---

## 7. Function duration

`/api/cron/publish`, `/api/cron/social-health` and `/api/cron/analytics`
declare `maxDuration = 300`.

This is not padding. Publishing an Instagram video means creating a media
container and polling until Meta finishes processing it; the platform default
of 10s aborts mid-publish and leaves the job leased until its lease expires.

**The Hobby plan caps function duration at 60s.** On Hobby these three routes
must be lowered to `60`, and the publish batch size kept small enough to
finish inside it (`?batch=3`). Production should be on Pro.

---

## 8. Verify the deployment

```bash
curl -s https://<your-domain>/api/ready | jq
```

Read it rather than skimming it — it names each unconfigured integration
instead of returning a single green tick. Then check by hand:

- [ ] `/` renders, and the theme toggle persists across a reload
- [ ] `/dashboard` while signed out redirects to `/login?next=/dashboard`
- [ ] Sign-up creates a `users` row and a free `subscriptions` row
- [ ] `curl -X POST https://<domain>/api/cron/publish` with **no** secret → `404`
- [ ] The same call **with** the secret → `200` and a run summary
- [ ] Response headers carry `Content-Security-Policy` and `Strict-Transport-Security`
- [ ] Two accounts in different brands cannot see each other's content

The last one is worth doing manually at least once per deployment. RLS is
tested in CI, but CI tests the policies as written — not the policies as
actually applied to the database you just pointed at.

---

## 9. Promote an admin

```sql
update users set role = 'admin' where email = 'you@company.com';
```

There is no UI for this on purpose: a self-service route to admin is a
privilege-escalation path.
