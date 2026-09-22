import { NextResponse } from 'next/server';
import { runPublishingWorker } from '@/lib/publishing/worker';
import { purgeExpiredOAuthStates } from '@/lib/social/oauth-state';
import { secretsMatch } from '@/lib/crypto/secret-box';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/**
 * Publishing takes real time — an Instagram carousel waits on container
 * processing — so the platform default of 10s would abort mid-publish and
 * leave the job leased until it expired.
 */
export const maxDuration = 300;

/**
 * The publishing worker trigger.
 *
 * This is the endpoint that makes scheduled publishing actually happen. It is
 * also the single most dangerous route in the application: a caller who
 * reaches it causes posts to appear on real social accounts. So:
 *
 *   - Authorization is a shared secret compared in constant time. `===` on a
 *     secret leaks its prefix through timing.
 *   - With CRON_SECRET unset, EVERY request is refused. The tempting
 *     alternative — "no secret configured, so allow it" — would leave a
 *     publicly callable publish trigger on any deployment where the operator
 *     had not got round to setting it.
 *   - It accepts GET as well as POST because platform schedulers differ
 *     (Vercel Cron issues GET, Supabase pg_cron and GitHub Actions typically
 *     POST), and both paths run identical authorization.
 *   - It never reflects the provided secret, and never says whether a wrong
 *     secret was close.
 *
 * The response is a summary of what happened, which an operator needs, and
 * nothing about tenants.
 */

async function handle(request: Request): Promise<NextResponse> {
  const expected = serverEnv.cronSecret;

  /*
   * CRON_SECRET unset -> 404, the same answer a wrong secret gets.
   *
   * This used to return 503 with `{"error":"The publishing worker trigger is
   * not configured. Set CRON_SECRET.", "code":"not_configured"}` to ANY
   * anonymous caller. The browser suite caught it, and the assertion it broke
   * states the reason outright: "a 401 would confirm the endpoint exists and
   * takes a secret". A 503 naming the feature AND the missing variable is
   * strictly worse than a 401 -- it confirms the path, identifies it as a
   * publishing trigger, and tells a stranger the deployment is misconfigured
   * and exactly which knob is missing.
   *
   * The elsewhere-correct instinct -- be honest about misconfiguration rather
   * than opaque -- is wrong for this one route, and the distinction is WHO is
   * asking. A Paddle webhook is called by Paddle, and the operator reads their
   * own logs. This endpoint is reachable by anyone on the internet holding
   * nothing at all.
   *
   * The operator still gets the diagnosis, from two places that require
   * standing: the warn line below, and /api/ready, which already reports
   * "CRON_SECRET is unset, so /api/cron/publish refuses every caller".
   *
   * With no secret configured there is, functionally, no such endpoint. 404 is
   * not a lie.
   */
  if (!expected) {
    logger.warn('cron:publish_refused', { reason: 'CRON_SECRET not configured' });
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Both header styles: `Authorization: Bearer <secret>` is what Vercel Cron
  // sends, `x-cron-secret` is easier from pg_cron's http extension.
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get('x-cron-secret');

  if (!secretsMatch(provided, expected)) {
    logger.warn('cron:publish_unauthorized', {
      // Enough to correlate an attack, nothing that helps mount one.
      hasAuthHeader: Boolean(authHeader),
      hasCustomHeader: Boolean(request.headers.get('x-cron-secret')),
    });
    // 404, not 401: an unauthenticated caller should not learn that a
    // publishing trigger exists at this path.
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const url = new URL(request.url);
  const requestedBatch = Number(url.searchParams.get('batch'));
  const batchSize = Number.isFinite(requestedBatch) && requestedBatch > 0 ? requestedBatch : undefined;

  const startedAt = Date.now();

  try {
    const result = await runPublishingWorker({ batchSize });

    // Housekeeping while we are here. Never allowed to fail the run.
    const purgedStates = await purgeExpiredOAuthStates();

    logger.info('cron:publish_completed', {
      workerId: result.workerId,
      claimed: result.claimed,
      published: result.published,
      retrying: result.retrying,
      failed: result.failed,
      skipped: result.skipped,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      workerId: result.workerId,
      claimed: result.claimed,
      published: result.published,
      retrying: result.retrying,
      failed: result.failed,
      skipped: result.skipped,
      purgedOAuthStates: purgedStates,
      durationMs: Date.now() - startedAt,
      // Per-job outcomes without captions, media or account identifiers.
      outcomes: result.outcomes,
    });
  } catch (error) {
    logger.error('cron:publish_failed', error, { durationMs: Date.now() - startedAt });
    // A 500 is what tells the scheduler to alert. Do not dress a failed run
    // up as a successful empty one.
    return NextResponse.json({ ok: false, error: 'The publishing run failed.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
