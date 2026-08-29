import { NextRequest, NextResponse } from 'next/server';
import { verifyPaddleWebhook } from '@/lib/paddle';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

/**
 * Handles: subscription.created, subscription.updated, subscription.cancelled,
 * transaction.completed (payment succeeded), transaction.payment_failed.
 * Always verifies the Paddle signature before trusting the payload — this is
 * the only path allowed to write Subscriptions/Payments besides the admin panel.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('paddle-signature') ?? '';

  const event = await verifyPaddleWebhook(rawBody, signature);
  if (!event) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  const supabase = supabaseAdmin();

  switch (event.eventType) {
    case 'subscription.created':
    case 'subscription.updated': {
      const sub = event.data as any;
      const userId = sub.customData?.userId as string | undefined;
      if (!userId) break;

      const plan = (sub.customData?.plan as PlanId) ?? 'starter';
      const status = sub.status === 'active' || sub.status === 'trialing' ? sub.status : 'past_due';

      await supabase
        .from('subscriptions')
        .update({
          plan,
          status,
          paddle_subscription_id: sub.id,
          paddle_customer_id: sub.customerId,
          credits_remaining: PLANS[plan].monthlyCredits,
          renews_at: sub.nextBilledAt ?? null,
        })
        .eq('user_id', userId);
      break;
    }

    case 'subscription.cancelled': {
      const sub = event.data as any;
      const userId = sub.customData?.userId as string | undefined;
      if (!userId) break;

      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled', plan: 'free', credits_remaining: PLANS.free.monthlyCredits })
        .eq('user_id', userId);
      break;
    }

    case 'transaction.completed': {
      const txn = event.data as any;
      const userId = txn.customData?.userId as string | undefined;
      if (!userId) break;

      await supabase.from('payments').insert({
        user_id: userId,
        paddle_transaction_id: txn.id,
        amount: Number(txn.details?.totals?.total ?? 0) / 100,
        status: 'completed',
      });

      // Renewal: top the plan's credits back up for the new billing cycle.
      const { data: subscription } = await supabase.from('subscriptions').select('plan').eq('user_id', userId).maybeSingle();
      if (subscription) {
        await supabase
          .from('subscriptions')
          .update({ credits_remaining: PLANS[subscription.plan as PlanId].monthlyCredits })
          .eq('user_id', userId);
      }
      break;
    }

    case 'transaction.payment_failed': {
      const txn = event.data as any;
      const userId = txn.customData?.userId as string | undefined;
      if (!userId) break;

      await supabase.from('payments').insert({
        user_id: userId,
        paddle_transaction_id: txn.id,
        amount: Number(txn.details?.totals?.total ?? 0) / 100,
        status: 'failed',
      });
      await supabase.from('subscriptions').update({ status: 'past_due' }).eq('user_id', userId);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
