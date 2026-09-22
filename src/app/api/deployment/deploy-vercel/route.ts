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
 * Deploy a generated site to Vercel.
 *
 * THE ADAPTER IS NOT BUILT. This route now says so.
 *
 * What it did before: checked the plan gate, inserted a `deployments` row with
 * `status: 'pending'`, and returned `{ deployment }` with HTTP 200. The client
 * had no way to tell that apart from a real deployment — so the UI showed a
 * deployment in progress that would never advance, and the table filled with
 * `pending` rows that no worker would ever claim. Two rules from the operating
 * instructions apply directly: never mark an unfinished integration complete,
 * and keep external integrations behind adapters.
 *
 * It also accepted `brandId` and wrote it into `project_id` WITHOUT checking
 * that the caller may access that brand — a cross-tenant write. The plan gate
 * above it checked what the caller was entitled to do, never what they were
 * entitled to do it TO. That check is now first.
 *
 * To finish this: add `src/lib/deploy/providers/vercel.ts` exposing
 * `createDeployment(files, config)` and `getDeploymentStatus(id)` against
 * `POST /v13/deployments`, read `VERCEL_API_TOKEN` through `serverEnv`, drive
 * it from a durable job the way `lib/publishing/worker.ts` drives publishing
 * (lease, retry with backoff, terminal states), and only then insert the row —
 * created with the provider's own id so the status poll is idempotent.
 */
export const POST = routeHandler('/api/deployment/deploy-vercel', async (request: Request) => {
  const user = await requireUser();
  const { brandId } = await parseJsonBody(request, Body);

  // Ownership before entitlement: a caller must have access to this brand
  // whatever their plan says.
  await assertBrandAccess(user.id, brandId, { db: supabaseAdmin() });

  const gate = await canUseFeature(user, 'deploy');
  if (!gate.allowed) throw ApiError.paymentRequired(gate.reason ?? 'Your plan does not include deployment.');

  throw ApiError.notConfigured(
    'One-click deployment to Vercel is not available yet. Export your site and deploy it from your own Vercel account in the meantime.'
  );
});

/** Kept so the client can ask whether the feature exists before offering it. */
export const GET = routeHandler('/api/deployment/deploy-vercel', async () => {
  await requireUser();
  return NextResponse.json({
    provider: 'vercel',
    available: false,
    reason: 'The Vercel deployment adapter is not implemented.',
  });
});
