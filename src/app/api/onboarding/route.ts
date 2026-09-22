import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadOnboarding } from '@/lib/onboarding/load';

export const dynamic = 'force-dynamic';

/** The checklist, derived fresh from real row counts on every call. */
export const GET = routeHandler('/api/onboarding', async (_request: Request) => {
  const user = await requireUser();
  return NextResponse.json(await loadOnboarding(user.id));
});

/**
 * The only two things a user can change: dismiss the checklist, and answer the
 * survey once.
 *
 * Note what is NOT here: no way to mark a step complete. Steps are counted
 * from real rows, so an endpoint that could tick one would be an endpoint that
 * could make the checklist lie.
 */
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('restore') }),
  z.object({
    action: z.literal('survey'),
    score: z.number().int().min(1).max(5),
    comment: boundedText(0, 2000).optional(),
  }),
]);

export const PATCH = routeHandler('/api/onboarding', async (request: Request) => {
  const user = await requireUser();
  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  if (body.action === 'dismiss' || body.action === 'restore') {
    await db
      .from('onboarding_state')
      .upsert(
        { user_id: user.id, dismissed_at: body.action === 'dismiss' ? new Date().toISOString() : null },
        { onConflict: 'user_id' }
      );
    return NextResponse.json({ ok: true });
  }

  // survey_shown_at is set here rather than when the survey is rendered, so an
  // unanswered survey is asked again on the next visit. Marking it shown on
  // render means a user who navigated away is never asked, and the response
  // rate quietly collapses for a reason nobody can see.
  await db.from('onboarding_state').upsert(
    {
      user_id: user.id,
      survey_shown_at: new Date().toISOString(),
      survey_score: body.score,
      survey_comment: body.comment ?? null,
    },
    { onConflict: 'user_id' }
  );

  return NextResponse.json({ ok: true });
});
