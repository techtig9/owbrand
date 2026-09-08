import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Cancels a queued or scheduled post.
 *
 * Cancels BOTH rows. The previous version updated `scheduled_posts` only,
 * which — beyond that table being orphaned — would have left the publishing
 * job claimable, so a "cancelled" post could still go out.
 *
 * A post that is already publishing cannot be recalled: the provider request
 * may be in flight. Saying so is better than reporting a cancellation that
 * does not hold. A post already published certainly cannot; deleting it from
 * the platform is a different action with different consequences.
 */

const Body = z.object({ socialPostId: uuidSchema });

const CANCELLABLE = ['draft', 'awaiting_approval', 'scheduled', 'queued'];

export const POST = routeHandler('/api/scheduler/cancel-scheduled-post', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const { data } = await db
    .from('social_posts')
    .select('id, brand_id, status, platform')
    .eq('id', body.socialPostId)
    .maybeSingle();

  const post = data as { id: string; brand_id: string; status: string; platform: string } | null;

  // Missing and inaccessible both 404, so ids cannot be enumerated.
  if (!post) throw ApiError.notFound('Post not found.');

  await assertBrandAccess(user.id, post.brand_id, { db });

  if (post.status === 'published') {
    throw ApiError.invalid('This post has already been published. Remove it on the platform instead.');
  }

  if (post.status === 'publishing') {
    throw ApiError.conflict('This post is being published right now and can no longer be cancelled.');
  }

  if (!CANCELLABLE.includes(post.status)) {
    // Already cancelled or failed: nothing to do, and reporting success would
    // imply a state change that did not happen.
    return NextResponse.json({ ok: true, alreadyTerminal: true, status: post.status });
  }

  // Stop the worker first. If this succeeds and the post update fails, the
  // post looks scheduled but cannot publish — the safe direction to fail.
  const { error: jobError } = await db
    .from('publishing_jobs')
    .update({ status: 'cancelled', locked_until: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq('social_post_id', post.id)
    .in('status', ['queued', 'scheduled', 'claimed']);

  if (jobError) throw jobError;

  const { error: postError } = await db
    .from('social_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', post.id)
    .in('status', CANCELLABLE);

  if (postError) throw postError;

  logger.info('scheduler:cancelled', { userId: user.id, socialPostId: post.id, platform: post.platform });

  return NextResponse.json({ ok: true, socialPostId: post.id, status: 'cancelled' });
});
