import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { ONBOARDING_STEPS, onboardingProgress } from '@/lib/ui/onboarding';

const Body = z.object({ completed: z.array(z.string().max(100)).max(50).optional() });

/** Onboarding progress for the signed-in user. */
export const POST = routeHandler('/api/ui/onboarding', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const parsed = await parseJsonBody(request, Body);
  const completed = parsed.completed ?? [];
  return NextResponse.json({
    steps: ONBOARDING_STEPS,
    progress: onboardingProgress(completed),
    completed,
  });
});
