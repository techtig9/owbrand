import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { checkRateLimit, clientIp, isDistributed } from '@/lib/security/rate-limit';
import { generateStructured } from '@/lib/ai/generate';
import { isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The unauthenticated landing-page demo: one small brand sketch, no account.
 *
 * This is the only route in the application that spends provider money with no
 * account behind it, so every decision here is about bounding that.
 *
 *  - **Refused outright unless rate limiting is distributed.** Without Upstash,
 *    limits are per process, and on a serverless platform that hands an
 *    attacker one fresh bucket per instance. A per-process limit on a paid,
 *    unauthenticated endpoint is not a weak control, it is the appearance of
 *    one — so the route reports itself unavailable instead.
 *  - **Two limits, not one**: two per minute stops a tight loop, fifteen per
 *    hour stops a patient one. A single per-minute limit is trivially
 *    sidestepped by waiting 61 seconds, forever.
 *  - **A hard output cap and a small schema.** The response is three short
 *    fields. There is no way to ask this endpoint for an expensive generation.
 *  - **Nothing is persisted.** No row, no brand, no user. The output is
 *    returned and forgotten, so the demo cannot be used as free storage.
 *  - **`effort: 'low'`**, because a sketch does not need deliberation and the
 *    cost difference is the entire point.
 *
 * GET reports availability so the landing page can render a real form or an
 * honest static illustration, and never a button that cannot work.
 */

const Body = z.object({
  description: boundedText(20, 400),
});

/** Deliberately tiny. The demo shows the shape of the idea, not the product. */
const DemoSketch = z.object({
  tagline: z.string().min(3).max(90),
  voice: z.array(z.string().min(2).max(28)).min(3).max(3),
  audience: z.string().min(3).max(120),
});

const DEMO_JSON_SCHEMA = {
  name: 'brand_sketch',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tagline', 'voice', 'audience'],
    properties: {
      tagline: { type: 'string', maxLength: 90 },
      voice: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: 28 } },
      audience: { type: 'string', maxLength: 120 },
    },
  },
} as const;

function unavailableReason(): string | null {
  if (!isConfigured.ai()) return 'No AI provider is configured on this deployment.';
  if (!isDistributed()) {
    return 'The demo needs distributed rate limiting (Upstash) before it can be offered publicly.';
  }
  return null;
}

export const GET = routeHandler('/api/public/demo', async () => {
  const reason = unavailableReason();
  return NextResponse.json({ available: reason === null, reason });
});

export const POST = routeHandler('/api/public/demo', async (request: Request) => {
  const reason = unavailableReason();
  if (reason) {
    // 503 rather than 404: unlike the cron endpoints, this path is meant to be
    // discoverable — the landing page links to it, and the caller needs to
    // know the difference between "try later" and "wrong URL".
    throw ApiError.notConfigured(reason);
  }

  const ip = clientIp(request);

  // Both windows are checked, and the minute limit first so a burst is refused
  // without spending an hourly slot on it.
  for (const tier of ['publicDemo', 'publicDemoHourly'] as const) {
    const result = await checkRateLimit(tier, `demo:${ip}`);
    if (!result.allowed) {
      logger.warn('public_demo:rate_limited', { tier, retryAfterSeconds: result.retryAfterSeconds });
      throw ApiError.rateLimited(result.retryAfterSeconds);
    }
  }

  const { description } = await parseJsonBody(request, Body);

  const started = Date.now();
  const result = await generateStructured({
    task: 'brand_brain',
    effort: 'low',
    maxOutputTokens: 300,
    timeoutMs: 20_000,
    schema: DemoSketch,
    jsonSchema: DEMO_JSON_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    system: [
      'You sketch the beginning of a brand identity from a short business description.',
      'Return only: a tagline, exactly three voice adjectives, and the primary audience.',
      '',
      'Never invent a fact about the business that the description does not state.',
      'Do not claim certifications, awards, statistics, years in business, or customer',
      'numbers. If the description is too vague to sketch, say so in the tagline field',
      'rather than inventing detail to fill it.',
    ].join('\n'),
    prompt: `Business description:\n${description}`,
  });

  logger.info('public_demo:generated', {
    provider: result.provider,
    model: result.model,
    durationMs: Date.now() - started,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });

  return NextResponse.json({
    sketch: result.data,
    // Named so the page can say which model produced it rather than implying
    // a house model that does not exist.
    provider: result.provider,
  });
});
