# Database migrations

Apply in **filename order**. Later files assume earlier ones; several add
columns to tables an earlier file creates, so running them out of order fails
rather than silently diverging.

```bash
supabase link --project-ref <ref>
supabase db push
```

Or paste each file into the SQL editor, top to bottom.

| #   | File                                              | What it does                                                                                                                                                     |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `20260816_phase2.sql`                             | Legacy. Creates the `owbrand-media` storage bucket and its folder policies. Also creates `media_jobs` and `product_asset_versions`, **both superseded** — see #7 |
| 2   | `20260818000009_phase15_domain.sql`               | Domain tables: `campaigns_v2`, workspaces, products                                                                                                              |
| 3   | `20260907000010_phase1_security_hardening.sql`    | RLS across every tenant table, the `is_workspace_member` / `can_access_brand` / `is_app_admin` helpers, atomic credit RPCs, `webhook_events`, `audit_logs`       |
| 4   | `20260907000011_phase2_ai_brand_creative.sql`     | Brand Brain versioning, product facts, factuality findings, `generation_jobs`, `asset_versions`                                                                  |
| 5   | `20260908000012_phase3_publishing_social.sql`     | `oauth_states`, encrypted social credentials, publishing leases, `claim_publishing_jobs` / `complete_publishing_job`                                             |
| 6   | `20260908000013_phase4_analytics_attribution.sql` | `analytics_daily`, `post_metrics`, touchpoints, recommendation evidence, `upsert_*` RPCs                                                                         |
| 7   | `20260922000014_phase2_rls_gaps_and_grants.sql`   | Enables RLS on the two orphan tables from #1 and revokes EXECUTE on four SECURITY DEFINER functions that kept the default PUBLIC grant                           |

`supabase/schema.sql` is the original single-file schema, kept for reference
only. **The migrations are authoritative.** If the two disagree, the migrations
are right.

## Every file is idempotent

`create table if not exists`, `create or replace function`,
`drop policy if exists` before `create policy`, and `add column if not exists`
throughout — so a partial run can be repeated without hand-editing. Verified by
`npm run test:db`, which applies the whole chain to a fresh PostgreSQL 16
cluster and then runs 137 RLS assertions.

## Two things to check after applying

**1. RLS is on for every table holding tenant rows.**

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
```

Anything with `rowsecurity = false` that holds tenant data is a data leak. The
only tables that are deliberately policy-less are `media_jobs`,
`product_asset_versions`, `webhook_events`, `publishing_jobs`,
`marketing_actions` and `worker_heartbeats` — RLS is _enabled_ on all of them,
with no policies, so tenant roles get nothing and the service role bypasses.

**2. No SECURITY DEFINER function is reachable by a tenant role**, except the
three RLS helpers, which the policies themselves call.

```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and p.proname not in ('is_workspace_member', 'can_access_brand', 'is_app_admin');
```

Anything returned is callable directly by any signed-in user.

## A platform caveat worth knowing

**A table-level `revoke` is not durable on Supabase.** A project applies blanket
`grant select, insert, update, delete on all tables in schema public to
authenticated`, and anything that re-runs those grants — a later migration, a
dashboard action, `supabase db reset` — silently restores privileges a migration
revoked. `relrowsecurity` is untouched by grants.

So **RLS is the control; a revoke is only a second layer.** This is not
theoretical: it is exactly what the test suite caught when the first version of
migration #7 was asserted on the privilege bit instead of on behaviour.
