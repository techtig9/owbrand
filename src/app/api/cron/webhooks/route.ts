import { NextResponse } from 'next/server';
import { deliverBatch } from '@/lib/webhooks/deliver';
import { secretsMatch } from '@/lib/crypto/secret-box';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** Deliveries have a 10s timeout each and run sequentially; a batch of 20 needs room. */
export const maxDuration = 300;

/**
 * The webhook delivery worker trigger.
 *
 * Authorization is identical to the other cron routes, including the 404 when
 * CRON_SECRET is unset — see the long note in /api/cron/publish for why that
 * is a 404 and not a 503. Copying the reasoning rather than the conclusion:
 * this endpoint drives outbound HTTP requests to customer-controlled
 * addresses, so an unauthenticated caller could use it to amplify traffic.
 */
async function handle(request: Request): Promise<NextResponse> {
  const expected = serverEnv.cronSecret;

  if (!expected) {
    logger.warn('cron:webhooks_refused', { reason: 'CRON_SECRET not configured' });
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get('x-cron-secret');

  if (!secretsMatch(provided, expected)) {
    logger.warn('cron:webhooks_unauthorized', { hasHeader: provided !== null });
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const started = Date.now();
  const result = await deliverBatch(20);

  logger.info('cron:webhooks_complete', { ...result, durationMs: Date.now() - started });

  return NextResponse.json({ ...result, durationMs: Date.now() - started });
}

export const GET = handle;
export const POST = handle;
