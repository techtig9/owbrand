import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { priceIdFor } from '@/lib/paddle';

const bodySchema = z.object({
  plan: z.enum(['starter', 'pro', 'business']),
  cadence: z.enum(['monthly', 'yearly']),
});

/**
 * Returns the price ID + customer info the client-side Paddle.js overlay needs
 * to open checkout (@paddle/paddle-js `Paddle.Checkout.open`). Paddle itself
 * hosts the payment form — we never touch card details server-side.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { plan, cadence } = parsed.data;
  const priceId = priceIdFor(plan, cadence);

  return NextResponse.json({
    priceId,
    customer: { email: user.email },
    customData: { userId: user.id, plan },
  });
}
