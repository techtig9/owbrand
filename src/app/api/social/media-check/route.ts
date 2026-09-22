import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { validateMediaForPlatform } from '@/lib/publishing/media-validation';
import { SOCIAL_PLATFORMS, PLATFORMS, canPublishTo } from '@/lib/social/platforms';

/**
 * Pre-flight media validation.
 *
 * Now platform-aware. The previous version validated against a single global
 * limit table and — because of an `as never` cast that hid a field-name
 * mismatch between this route's schema and the validator — reported
 * "Unsupported MIME type" for every file it was ever given.
 */
const Body = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  caption: boundedText(0, 70000).optional(),
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
  const definition = PLATFORMS[body.platform];

  const result = validateMediaForPlatform(body.platform, body.media, { caption: body.caption });

  return NextResponse.json({
    ...result,
    // Say up front when the media is fine but we still cannot publish there.
    publishSupported: canPublishTo(body.platform),
    unavailableReason: definition.unavailableReason ?? null,
    limits: definition.media,
  });
});
