import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { nextGoldenPathStep, GOLDEN_PATH, type GoldenPathStep } from '@/lib/workflow/golden-path';

/** Authenticated (was open). Purely advisory, but it describes internal flow. */
const Body = z.object({
  completed: z.array(z.string().max(80)).max(50).optional(),
});

export const POST = routeHandler('/api/workflow/next-step', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const parsed = await parseJsonBody(request, Body);
  // Only recognised step names are considered; unknown strings are discarded
  // rather than silently skewing the result.
  const completed = (parsed.completed ?? []).filter((step): step is GoldenPathStep =>
    (GOLDEN_PATH as readonly string[]).includes(step)
  );

  const nextStep = nextGoldenPathStep(completed);

  return NextResponse.json({ nextStep, complete: nextStep === null, completed });
});
