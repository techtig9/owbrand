# Phase 1 — Testing Guide

Three independent suites. Each proves something the others cannot.

| Suite | Command | What only it can prove |
|---|---|---|
| Unit / integration | `npm run test` | Authorization guards, validation, idempotency and error-envelope logic |
| Database / RLS | `supabase/test/run-db-tests.sh` | The migration chain applies to a fresh database, and Postgres itself refuses cross-tenant access |
| Browser | `node tests/browser/smoke.js` | Pages hydrate, the CSP does not block our own scripts, forms are labelled, no viewport overflows |

Run everything at once with `npm run verify` (type-check → lint → test → build). The database and browser suites are separate because they need a Postgres binary and a running server respectively.

---

## 1. Unit / integration — `npm run test`

Vitest, Node environment, no network. Supabase is faked at the module boundary with a small in-memory store so the guards' real query chains execute unmodified.

```
tests/api/errors.test.ts              error envelope, no internals ever serialised
tests/api/validate.test.ts            body/query validation, size and content-type limits
tests/auth/guards.test.ts             tenant isolation at the application layer
tests/billing/webhook-idempotency.test.ts  webhook replay protection
tests/email/templates.test.ts         no credential ever reaches an email body
tests/jobs/job-store.test.ts          jobs are persisted and deduplicated
tests/security/rate-limit.test.ts     limits, windows, per-identifier isolation
tests/security/redirect.test.ts       open-redirect payloads
```

Two conventions worth knowing:

- **The email suite scans template output against a forbidden-pattern list** (`password`, `token`, `api_key`, JWT-shaped strings, …) rather than eyeballing the templates. A future template change cannot quietly regress the "never email secrets" rule.
- **The guard suite asserts that an inaccessible record and a missing record are indistinguishable** — both 404, with the same message. Returning 403 for a record that exists but belongs to someone else confirms its existence to anyone enumerating ids.

## 2. Database / RLS — `supabase/test/run-db-tests.sh`

Boots a throwaway PostgreSQL cluster, applies `supabase/test/supabase-shim.sql` (a minimal stand-in for a hosted Supabase project: the `auth` and `storage` schemas, the `anon`/`authenticated`/`service_role` roles, and `auth.uid()`), then `schema.sql` and every migration in filename order — exactly as a real deployment would.

It then impersonates users the way PostgREST does:

```sql
set role authenticated;
set request.jwt.claim.sub = '<user uuid>';
```

Requires PostgreSQL **server** binaries, not just `psql`:

```bash
apt-get install -y postgresql-16      # Debian/Ubuntu
PGBIN=/usr/lib/postgresql/16/bin supabase/test/run-db-tests.sh
```

38 assertions across four groups:

- **Schema shape** — the four table collisions the audit found are reconciled, and the new audit tables exist.
- **Tenant isolation** — Alice cannot SELECT, INSERT, UPDATE or DELETE Bob's rows; a workspace member *can* reach a shared brand; anonymous callers see nothing; worker-only tables are invisible even to an authenticated user.
- **Credit integrity** — deduction is atomic and cannot overdraw, a failed deduction leaves the balance untouched, refunds are capped at the plan ceiling, and a negative balance is rejected by a table constraint.
- **Billing** — a duplicate webhook event is rejected by the unique constraint.

### Two harness bugs found while building this

Both are worth recording, because each made the suite pass for the wrong reason:

1. **Invalid UUID literals.** Fixture ids like `…0000p1` contain a non-hex character. Postgres rejected the insert, the run aborted before any assertion executed, and the shell wrapper reported success. The wrapper now checks three independent signals: psql's exit status, the presence of any `FAIL` line, and the presence of a `SUMMARY` line (which catches a run that died part-way).

2. **`SET LOCAL` outside a transaction.** psql runs in autocommit, so `set local role authenticated` silently did nothing — the whole suite ran as the bootstrap superuser, which has `BYPASSRLS`. Every isolation assertion passed without RLS ever being consulted. Now session-level `SET`, with a comment explaining why.

## 3. Browser — `tests/browser/smoke.js`

Needs a running production build:

```bash
npm run build
npm run start &        # or PORT=3100 npx next start -p 3100
node tests/browser/smoke.js
```

`playwright-core` is a devDependency, so `npm ci` is enough — no `playwright install` step, and no browser download. The Chromium binary is located via `CHROME_PATH`, defaulting to the one this environment provides. `BASE_URL` overrides the target. Supabase does **not** need to be reachable — anything requiring a live session belongs to the other two suites.

52 assertions: rendering, real hydration (React root attached, plus a control whose class actually changes on click), accessible labelling of every input, client-side password validation, the Google button issuing a genuine PKCE `authorize` request, middleware redirects preserving the deep link in `?next`, the custom 404, no CSP violations, no unexpected console errors, and no horizontal overflow at 320/375/390/430/768/1024/1280/1440/1920px.

### Why the OAuth assertion looks indirect

Clicking *Continue with Google* navigates away: `supabase-js` builds the provider URL client-side and redirects. With a demo project that host does not resolve, so the browser lands on an error page and the DOM detaches — asserting on navigation or on button state is unreliable. The test instead asserts that an outbound request to `/auth/v1/authorize` was issued carrying a `code_challenge` and our own callback URL. That is the actual signal that OAuth was initiated, and it is what distinguishes the fix from the original bug (a button that did nothing at all).

---

## What Phase 1 testing does **not** cover

Stated plainly, because an adapter that compiles is not an integration that works:

- **No live Supabase project was used.** RLS is proven against stock PostgreSQL 16 with a shim. Hosted Supabase adds PostgREST, GoTrue and its own grants; the policies should behave identically, but that needs one run against a real project.
- **No real Google OAuth round trip.** The request we emit is verified; the consent screen, code exchange and session establishment are not.
- **No real Resend delivery.** Template content, escaping, logging and failure-isolation are tested. Whether mail lands in an inbox needs an API key and a verified domain.
- **No real Paddle webhook.** Idempotency, state transitions and the renewal/initial-purchase distinction are tested against fakes. Signature verification is unchanged from the original code and is exercised only by that code path, not by a Paddle-signed payload.
- **No load or soak testing.** Deferred to Phase 5.
