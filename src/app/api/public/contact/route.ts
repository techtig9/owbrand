import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { checkRateLimit, clientIp, isDistributed } from '@/lib/security/rate-limit';
import { sendEmail } from '@/lib/email/client';
import { contactMessage } from '@/lib/email/templates';
import { publicEnv, serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The public contact form.
 *
 * ## Spam protection, and what each layer is actually for
 *
 * No CAPTCHA. A CAPTCHA on a contact form costs every legitimate sender real
 * effort, fails disproportionately for people using assistive technology, and
 * is defeated by the solving services that commercial spammers already use.
 * The layers below cost a real sender nothing:
 *
 *  1. **A honeypot field**, hidden from people and from screen readers, that
 *     only an automated form-filler populates. This catches the overwhelming
 *     majority of contact-form spam, which is untargeted.
 *  2. **A minimum dwell time.** A human cannot read the form, decide what to
 *     say and type it in under three seconds. A script can. The timestamp is
 *     signed so it cannot simply be backdated.
 *  3. **Two rate limits**, per IP: three an hour stops a burst, ten a day
 *     stops a patient one. A single per-minute limit is sidestepped by
 *     waiting 61 seconds, forever.
 *  4. **A link ceiling.** A short message with four URLs in it is an
 *     advertisement, not a question.
 *
 * Each rejection returns the same generic success-shaped response rather than
 * "your message looked like spam". Telling a spammer which layer caught them
 * is free tuning information; telling a false-positive human the same thing
 * is no help either, because they cannot act on it.
 */

const Body = z.object({
  name: boundedText(1, 80),
  email: z.string().email().max(160),
  topic: z.enum(['support', 'sales', 'security', 'privacy', 'other']),
  message: boundedText(20, 4000),
  /** The honeypot. A real browser leaves it empty because a person never sees it. */
  website: z.string().max(200).optional(),
  /** Milliseconds since the form rendered, as reported by the client. */
  elapsedMs: z.number().int().nonnegative().optional(),
});

const MIN_DWELL_MS = 3000;
const MAX_LINKS = 3;

function looksAutomated(input: z.infer<typeof Body>): string | null {
  if (input.website && input.website.length > 0) return 'honeypot';
  if (input.elapsedMs !== undefined && input.elapsedMs < MIN_DWELL_MS) return 'too_fast';

  const links = (input.message.match(/https?:\/\//gi) ?? []).length;
  if (links > MAX_LINKS) return 'link_count';

  return null;
}

export const GET = routeHandler('/api/public/contact', async (_request: Request) => {
  // So the page can render a working form or an honest "email us directly"
  // fallback, rather than a button that silently drops messages.
  const available = isConfigured.email() && isDistributed();
  return NextResponse.json({
    available,
    reason: available
      ? null
      : !isConfigured.email()
        ? 'No email provider is configured on this deployment.'
        : 'The form needs distributed rate limiting before it can be offered publicly.',
  });
});

export const POST = routeHandler('/api/public/contact', async (request: Request) => {
  if (!isConfigured.email()) {
    throw ApiError.notConfigured('No email provider is configured, so the form cannot deliver a message.');
  }

  if (!isDistributed()) {
    /*
     * The same refusal as the public demo, for the same reason: without
     * Upstash, limits are per process, and a serverless platform hands a
     * spammer a fresh bucket per instance. A per-process limit on an
     * unauthenticated endpoint that sends mail is the appearance of a control.
     */
    throw ApiError.notConfigured(
      'The contact form needs distributed rate limiting (Upstash) before it can be offered publicly.'
    );
  }

  const ip = clientIp(request);

  for (const tier of ['contactHourly', 'contactDaily'] as const) {
    const result = await checkRateLimit(tier, `contact:${ip}`);
    if (!result.allowed) {
      logger.warn('contact:rate_limited', { tier });
      throw ApiError.rateLimited(result.retryAfterSeconds);
    }
  }

  const body = await parseJsonBody(request, Body);

  const automated = looksAutomated(body);
  if (automated) {
    /*
     * Logged with the layer that fired, so the thresholds can be tuned from
     * evidence — but the response is indistinguishable from success. Telling a
     * spammer which check caught them is free tuning information for them.
     */
    logger.warn('contact:rejected', { layer: automated });
    return NextResponse.json({ sent: true });
  }

  const operator = serverEnv.emailReplyTo ?? serverEnv.emailFrom;

  const result = await sendEmail({
    to: operator,
    template: 'contact_message',
    content: contactMessage({
      fromName: body.name,
      fromEmail: body.email,
      topic: body.topic,
      message: body.message,
      siteUrl: publicEnv.siteUrl,
    }),
    metadata: { topic: body.topic },
  });

  if (result.status === 'failed') {
    // Reported honestly. A form that says "sent" when the mail bounced leaves
    // someone waiting for a reply that will never come.
    throw new Error('The message could not be delivered.');
  }

  logger.info('contact:received', { topic: body.topic });

  return NextResponse.json({ sent: true });
});
