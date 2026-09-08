import { NextResponse } from 'next/server';
import { runAnalyticsIngestion } from '@/lib/analytics/ingestion';
import { refreshRecommendationsForAllBrands } from '@/lib/analytics/refresh';
import { secretsMatch } from '@/lib/crypto/secret-box';
import { serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** One Graph call per account per metric group, plus one per post. */
export const maxDuration = 300;

/**
 * Analytics ingestion trigger.
 *
 * Meant to run a few times a day, not every minute: platform insights update
 * on a daily cadence and Meta's rate limit is shared with publishing, so
 * polling harder would cost publishes without producing fresher numbers.
 *
 * Same authorization as the other cron routes — constant-time shared secret,
 * refuses everything when CRON_SECRET is unset, 404 rather than 401 so the
 * endpoint is not advertised.
 */
async function handle(request: Request): Promise<NextResponse> {
  const expected = serverEnv.cronSecret;

  if (!expected) {
    return NextResponse.json(
      { error: 'The analytics ingestion job is not configured. Set CRON_SECRET.', code: 'not_configured' },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get('x-cron-secret');

  if (!secretsMatch(provided, expected)) {
    logger.warn('cron:analytics_unauthorized', { hasAuthHeader: Boolean(authHeader) });
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!isConfigured.metaOAuth()) {
    // Honest: there is no data source, so there is nothing to ingest. Not an
    // error, and not a successful ingestion either.
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'No analytics source is configured on this server (Meta credentials absent).',
      accounts: 0,
    });
  }

  const startedAt = Date.now();

  try {
    const result = await runAnalyticsIngestion();

    // Recommendations are regenerated from what was just ingested. Doing it
    // here rather than on page load means the dashboard never blocks on an AI
    // call, and a brand's signals are refreshed even if nobody visits.
    const refreshed = await refreshRecommendationsForAllBrands();

    return NextResponse.json({
      ok: true,
      accounts: result.accounts,
      ingested: result.ingested,
      skipped: result.skipped,
      errors: result.errors,
      daysWritten: result.daysWritten,
      postsWritten: result.postsWritten,
      recommendations: refreshed,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error('cron:analytics_failed', error);
    return NextResponse.json({ ok: false, error: 'The analytics ingestion run failed.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
