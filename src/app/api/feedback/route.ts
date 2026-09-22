import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * In-app feedback.
 *
 * Insert-only by design, and the route mirrors the table: there is no GET.
 * A feedback list readable by the people who file it would expose every other
 * user's reports, which routinely quote their own or their clients' data.
 *
 * `path` is captured because "the page I was on" is most of the diagnostic
 * value, and a reporter should not have to describe where they were. It is
 * bounded and stored as a string rather than trusted as a URL — it is
 * user-supplied text that happens to look like a path.
 */
const Body = z.object({
  kind: z.enum(['bug', 'idea', 'confusing', 'praise', 'other']),
  message: boundedText(3, 4000),
  path: boundedText(0, 300).optional(),
});

export const POST = routeHandler('/api/feedback', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const { error } = await db.from('feedback').insert({
    user_id: user.id,
    kind: body.kind,
    message: body.message,
    path: body.path ?? null,
  });

  if (error) {
    logger.error('feedback:insert_failed', error, { kind: body.kind });
    // The message is the user's own words and they are about to lose them, so
    // say plainly that it did not save rather than implying it did.
    throw new Error('Could not save your feedback.');
  }

  logger.info('feedback:received', { kind: body.kind, path: body.path ?? null });
  return NextResponse.json({ ok: true });
});
