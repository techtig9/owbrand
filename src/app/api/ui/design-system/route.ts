import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { DESIGN_TOKENS } from '@/lib/ui/design-tokens';
import { UI_COMPONENTS } from '@/lib/ui/components';
import { ACCESSIBILITY_RULES } from '@/lib/ui/accessibility';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/** Design-system manifest. Authenticated — internal implementation detail. */
export const GET = routeHandler('/api/ui/design-system', async () => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);
  return NextResponse.json({
    tokens: DESIGN_TOKENS,
    components: UI_COMPONENTS,
    accessibility: ACCESSIBILITY_RULES,
  });
});
