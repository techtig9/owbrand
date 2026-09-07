import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { PAGE_CONFIGS } from '@/lib/ui/page-config';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * Internal navigation/page manifest. Authenticated: it enumerates the
 * application's surface area, which is reconnaissance material for an
 * anonymous caller and of no use to one.
 */
export const GET = routeHandler('/api/ui/pages', async () => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);
  return NextResponse.json({ pages: PAGE_CONFIGS, count: PAGE_CONFIGS.length });
});
