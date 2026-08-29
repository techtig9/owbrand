import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { updatePaddleSubscription } from '@/lib/paddle';

const bodySchema = z.object({ action: z.enum(['cancel', 'pause', 'resume']) });

/**
 * User-initiated self-service billing action, proxied through Paddle's
 * subscription-management API (never trust a client-side plan change —
 * the actual plan/status/credits sync happens when the resulting webhook
 * event lands on /api/billing/paddle-webhook).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!subscription?.paddle_subscription_id) {
    return NextResponse.json({ error: 'No active paid subscription to manage.' }, { status: 400 });
  }

  try {
    await updatePaddleSubscription(subscription.paddle_subscription_id, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('manage-subscription failed', err);
    return NextResponse.json({ error: 'Could not update your subscription. Please try again.' }, { status: 502 });
  }
}
