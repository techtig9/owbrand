import { NextResponse } from 'next/server';
import { isConfigured, serverEnv } from '@/lib/env';
import { isDistributed } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Readiness probe — can this instance actually serve traffic?
 *
 * Before, this endpoint returned `{ ready: true, database: 'pending-runtime-check',
 * worker: 'pending-runtime-check' }` unconditionally. A load balancer would
 * therefore route traffic to a completely broken instance, and the response
 * claimed a status it had never checked.
 *
 * Now every critical dependency is genuinely probed, the HTTP status reflects
 * the result (503 when a critical dependency is down), and detail is only
 * returned to an admin — an anonymous caller gets ready/not-ready and nothing
 * that would help them map the infrastructure.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CheckStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

interface Check {
  name: string;
  status: CheckStatus;
  critical: boolean;
  detail?: string;
  latencyMs?: number;
}

const TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

/** Round-trips a trivial query so we know the connection and RLS layer respond. */
async function checkDatabase(): Promise<Check> {
  const started = Date.now();

  if (!isConfigured.supabaseAdmin()) {
    return { name: 'database', status: 'not_configured', critical: true, detail: 'Service-role key missing.' };
  }

  try {
    const db = supabaseAdmin();
    const { error } = await withTimeout(
      Promise.resolve(db.from('users').select('id', { count: 'exact', head: true }).limit(1))
    );
    if (error) throw error;
    return { name: 'database', status: 'ok', critical: true, latencyMs: Date.now() - started };
  } catch (error) {
    logger.error('ready:database_check_failed', error);
    return { name: 'database', status: 'down', critical: true, latencyMs: Date.now() - started };
  }
}

/** Confirms the private media bucket exists and is reachable. */
async function checkStorage(): Promise<Check> {
  const started = Date.now();

  if (!isConfigured.supabaseAdmin()) {
    return { name: 'storage', status: 'not_configured', critical: true };
  }

  try {
    const db = supabaseAdmin();
    const { error } = await withTimeout(Promise.resolve(db.storage.from('owbrand-media').list('', { limit: 1 })));
    if (error) throw error;
    return { name: 'storage', status: 'ok', critical: true, latencyMs: Date.now() - started };
  } catch (error) {
    logger.error('ready:storage_check_failed', error);
    return { name: 'storage', status: 'down', critical: true, latencyMs: Date.now() - started };
  }
}

/**
 * Is the publishing queue actually moving?
 *
 * A queue with jobs long past due is the specific failure this whole phase is
 * meant to prevent: the API accepts posts, the rows exist, and nothing sends
 * them. That looks healthy on every other check.
 */
async function checkPublishingQueue(): Promise<Check> {
  if (!isConfigured.supabaseAdmin()) {
    return { name: 'publishing_queue', status: 'not_configured', critical: false };
  }

  try {
    const db = supabaseAdmin();
    const overdueBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { count, error } = await withTimeout(
      Promise.resolve(
        db
          .from('publishing_jobs')
          .select('id', { count: 'exact', head: true })
          .in('status', ['queued', 'scheduled'])
          .lte('scheduled_for', overdueBefore)
      )
    );

    // 42P01 = the table is not there; the migrations check already reports that.
    if (error && (error as { code?: string }).code === '42P01') {
      return { name: 'publishing_queue', status: 'not_configured', critical: false, detail: 'publishing_jobs table missing.' };
    }
    if (error) throw error;

    const overdue = count ?? 0;

    return {
      name: 'publishing_queue',
      status: overdue > 0 ? 'degraded' : 'ok',
      critical: false,
      detail: overdue > 0 ? `${overdue} job(s) are more than 15 minutes past due — is the cron trigger running?` : undefined,
    };
  } catch (error) {
    logger.error('ready:publishing_queue_check_failed', error);
    return { name: 'publishing_queue', status: 'down', critical: false };
  }
}

/** Confirms the audit tables Phase 1 depends on are present. */
async function checkMigrations(): Promise<Check> {
  if (!isConfigured.supabaseAdmin()) {
    return { name: 'migrations', status: 'not_configured', critical: true };
  }

  const required = [
    'webhook_events',
    'email_logs',
    'ai_usage_logs',
    'audit_logs',
    'generation_jobs',
    'publishing_jobs',
    'oauth_states',
  ];

  try {
    const db = supabaseAdmin();
    const missing: string[] = [];

    for (const table of required) {
      const { error } = await withTimeout(
        Promise.resolve(db.from(table).select('id', { count: 'exact', head: true }).limit(1))
      );
      // 42P01 = undefined_table
      if (error && (error as { code?: string }).code === '42P01') missing.push(table);
    }

    if (missing.length > 0) {
      return {
        name: 'migrations',
        status: 'down',
        critical: true,
        detail: `Missing tables: ${missing.join(', ')}. Apply supabase/migrations.`,
      };
    }
    return { name: 'migrations', status: 'ok', critical: true };
  } catch (error) {
    logger.error('ready:migrations_check_failed', error);
    return { name: 'migrations', status: 'down', critical: true };
  }
}

/**
 * Configuration-only checks. These deliberately do NOT call the provider:
 * a readiness probe must be cheap and must not burn third-party quota. They
 * report "is this wired up", which is what the master command asks for — and
 * they never claim a provider is available when its credentials are absent.
 */
function configurationChecks(): Check[] {
  return [
    {
      name: 'email',
      status: isConfigured.email() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.email() ? undefined : 'RESEND_API_KEY not set — notifications will be skipped.',
    },
    {
      name: 'billing',
      status: isConfigured.billing() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.billing() ? undefined : 'PADDLE_API_KEY / PADDLE_WEBHOOK_SECRET not set.',
    },
    {
      name: 'ai_provider',
      status: isConfigured.ai() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.ai() ? undefined : 'No AI provider credentials configured.',
    },
    {
      name: 'rate_limit_store',
      // A per-process fallback is a real weakness in production, so it reports
      // degraded rather than ok.
      status: isDistributed() ? 'ok' : process.env.NODE_ENV === 'production' ? 'degraded' : 'not_configured',
      critical: false,
      detail: isDistributed()
        ? undefined
        : 'Upstash not configured — rate limits are per-instance only and will not hold across a scaled deployment.',
    },
    {
      // The worker now exists (lib/publishing/worker.ts). What this reports is
      // whether anything can TRIGGER it: without CRON_SECRET the cron endpoint
      // refuses every caller, so queued posts would never be sent.
      name: 'publishing_worker',
      status: isConfigured.publishingWorker() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.publishingWorker()
        ? undefined
        : 'CRON_SECRET is unset, so /api/cron/publish refuses every caller and queued posts would never be sent.',
    },
    {
      name: 'social_oauth',
      status: isConfigured.metaOAuth() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.metaOAuth()
        ? undefined
        : 'META_APP_ID, META_APP_SECRET and TOKEN_ENCRYPTION_KEY must all be set before an account can be connected.',
    },
    {
      // Called out separately from social_oauth: without it NOTHING can store
      // a provider credential, and the failure would otherwise look like an
      // OAuth problem.
      name: 'credential_encryption',
      status: isConfigured.tokenEncryption() ? 'ok' : 'not_configured',
      critical: false,
      detail: isConfigured.tokenEncryption()
        ? undefined
        : 'TOKEN_ENCRYPTION_KEY is unset. Provider tokens are never stored unencrypted, so connecting an account will fail.',
    },
  ];
}

export async function GET() {
  const [database, storage, migrations, publishingQueue] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkMigrations(),
    checkPublishingQueue(),
  ]);

  const checks: Check[] = [database, storage, migrations, publishingQueue, ...configurationChecks()];

  const criticalFailure = checks.some((c) => c.critical && c.status !== 'ok');
  const degraded = checks.some((c) => !c.critical && (c.status === 'degraded' || c.status === 'down'));

  const status = criticalFailure ? 'unhealthy' : degraded ? 'degraded' : 'healthy';
  const httpStatus = criticalFailure ? 503 : 200;

  // Detail is admin-only: the check list maps our infrastructure.
  let isAdmin = false;
  try {
    const user = await getCurrentUser();
    isAdmin = user?.role === 'admin';
  } catch {
    isAdmin = false;
  }

  if (!isAdmin) {
    return NextResponse.json(
      { ready: !criticalFailure, status },
      { status: httpStatus, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    {
      ready: !criticalFailure,
      status,
      version: serverEnv.appVersion,
      checkedAt: new Date().toISOString(),
      checks,
    },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } }
  );
}
