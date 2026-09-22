import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature } from '@/lib/credits';

export const dynamic = 'force-dynamic';

const Body = z.object({ brandId: uuidSchema });

/**
 * Deploy a generated site to Netlify.
 *
 * Same story as deploy-vercel, and the same two defects: a phantom `pending`
 * row returned as a 200 success, and `brandId` written with no access check.
 * See that file's header for the reasoning and for what finishing this
 * requires — here the call is
 * `POST /api/v1/sites/{site_id}/deploys` with `NETLIFY_API_TOKEN`.
 */
export const POST = routeHandler('/api/deployment/deploy-netlify', async (request: Request) => {
  const user = await requireUser();
  const { brandId } = await parseJsonBody(request, Body);

  await assertBrandAccess(user.id, brandId, { db: supabaseAdmin() });

  const gate = await canUseFeature(user, 'deploy');
  if (!gate.allowed) throw ApiError.paymentRequired(gate.reason ?? 'Your plan does not include deployment.');

  throw ApiError.notConfigured(
    'One-click deployment to Netlify is not available yet. Export your site and deploy it from your own Netlify account in the meantime.'
  );
});

export const GET = routeHandler('/api/deployment/deploy-netlify', async () => {
  await requireUser();
  return NextResponse.json({
    provider: 'netlify',
    available: false,
    reason: 'The Netlify deployment adapter is not implemented.',
  });
});
