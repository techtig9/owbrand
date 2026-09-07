import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { validateMedia } from '@/lib/publishing/media-validation';

/** Authenticated (was open). Pre-flight media validation before publishing. */
const Body = z.object({
  kind: z.enum(['image', 'video']).default('image'),
  media: z
    .array(
      z.object({
        width: z.number().int().positive().max(20000).optional(),
        height: z.number().int().positive().max(20000).optional(),
        sizeBytes: z.number().int().nonnegative().max(5_000_000_000).optional(),
        durationSeconds: z.number().nonnegative().max(86400).optional(),
        mimeType: z.string().max(120).optional(),
      })
    )
    .max(20),
});

export const POST = routeHandler('/api/social/media-check', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const kind = body.kind ?? 'image';

  return NextResponse.json({ kind, results: validateMedia(body.media as never, kind) });
});
