import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireUser } from '@/lib/auth/guards';
import { referralSummary } from '@/lib/referral/referral';

export const dynamic = 'force-dynamic';

/**
 * The user's own referral code and counts.
 *
 * Read-only. There is no POST: a user who could create their own referral row
 * could mint credits, so rows are only ever written by the server when a real
 * signup carries a code, and advanced when that account activates.
 */
export const GET = routeHandler('/api/referral', async (_request: Request) => {
  const user = await requireUser();
  return NextResponse.json(await referralSummary(user.id));
});
