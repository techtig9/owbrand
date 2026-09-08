import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { requiredString, safeObject } from '@/lib/domain/validation';

/** Authenticated (was open). */
const Body = z.object({
  entity: boundedText(1, 80),
  payload: z.record(z.unknown()).optional(),
});

export const POST = routeHandler('/api/domain/validate', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);

  try {
    const entity = requiredString(body.entity, 'entity');
    return NextResponse.json({ valid: true, entity, payload: safeObject(body.payload) });
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: error instanceof Error ? error.message : 'Invalid request', code: 'invalid_request' },
      { status: 400 }
    );
  }
});
