import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/require-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['upgrade', 'downgrade', 'extend', 'cancel']),
  plan: z.enum(['free', 'starter', 'pro', 'business']).optional(), // required for upgrade/downgrade
  extendDays: z.number().int().positive().optional(), // required for extend
});

export async function POST(req: NextRequest) {
  const { user, error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { userId, action, plan, extendDays } = parsed.data;

  const supabase = supabaseAdmin();

  if (action === 'cancel') {
    const { error: dbError } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', plan: 'free', credits_remaining: PLANS.free.monthlyCredits })
      .eq('user_id', userId);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (action === 'upgrade' || action === 'downgrade') {
    if (!plan) return NextResponse.json({ error: 'plan is required.' }, { status: 400 });
    const { error: dbError } = await supabase
      .from('subscriptions')
      .update({
        plan: plan as PlanId,
        status: 'active',
        credits_remaining: PLANS[plan as PlanId].monthlyCredits,
      })
      .eq('user_id', userId);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (action === 'extend') {
    if (!extendDays) return NextResponse.json({ error: 'extendDays is required.' }, { status: 400 });
    const { data: current } = await supabase
      .from('subscriptions')
      .select('renews_at')
      .eq('user_id', userId)
      .maybeSingle();
    const base = current?.renews_at ? new Date(current.renews_at) : new Date();
    base.setDate(base.getDate() + extendDays);
    const { error: dbError } = await supabase
      .from('subscriptions')
      .update({ renews_at: base.toISOString() })
      .eq('user_id', userId);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  /*
   * Audit trail.
   *
   * This was `console.info` interpolating the admin's EMAIL ADDRESS into the
   * platform log stream -- a sink with different retention, access control and
   * export paths from the application's own, and one an operator cannot purge
   * on a deletion request. The actor is now recorded by id.
   *
   * It also called the audit log a future roadmap item while `audit_logs`
   * already existed and was written by six other routes. An admin overriding
   * someone's subscription is precisely what that table is for, so the row is
   * written here rather than left to a log scrape.
   */
  await supabase.from('audit_logs').insert({
    actor_id: user!.id,
    actor_type: 'admin',
    action: `admin.subscription.${action}`,
    entity_type: 'subscription',
    entity_id: userId,
    metadata: { plan: plan ?? null, extendDays: extendDays ?? null },
  });

  logger.info('admin:subscription_override', {
    actorId: user!.id,
    targetUserId: userId,
    action,
    plan: plan ?? null,
    extendDays: extendDays ?? null,
  });

  return NextResponse.json({ ok: true });
}
