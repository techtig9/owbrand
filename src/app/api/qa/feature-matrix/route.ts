import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireAdminUser } from '@/lib/auth/guards';
import { FEATURE_MATRIX } from '@/lib/qa/feature-matrix';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * SECURITY FIX (Phase 1)
 * This endpoint publicly enumerated OwBrand's internal build status — which
 * subsystems are complete, which are stubs, and which integrations are not yet
 * wired. That is a map of where to attack. Admin only.
 */
export const GET = routeHandler('/api/qa/feature-matrix', async () => {
  await requireAdminUser();

  const summary = FEATURE_MATRIX.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ total: FEATURE_MATRIX.length, summary, features: FEATURE_MATRIX });
});
