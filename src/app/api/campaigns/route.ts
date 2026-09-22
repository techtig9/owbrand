import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * SECURITY FIX (Phase 1)
 * The previous GET took brandId straight from the query string and ran
 *   supabaseAdmin().from('campaigns').select('*').eq('brand_id', id || '')
 * with no ownership check on a service-role (RLS-bypassing) client. Any
 * authenticated user could read any tenant's campaigns by supplying their
 * brand id. assertBrandAccess now gates every path.
 */

const ListQuery = z.object({ brandId: uuidSchema });

export const GET = routeHandler('/api/campaigns', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId } = parseSearchParams(request, ListQuery);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, brandId, { db });

  const { data, error } = await db
    .from('campaigns')
    .select('id,brand_id,name,objective,status,budget,start_at,end_at,created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return NextResponse.json({ campaigns: data ?? [] });
});

const CreateCampaign = z.object({
  brandId: uuidSchema,
  name: boundedText(1, 160),
  objective: z.enum(['awareness', 'traffic', 'leads', 'sales']).default('awareness'),
});

export const POST = routeHandler('/api/campaigns', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, CreateCampaign);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });

  const { data, error } = await db
    .from('campaigns')
    .insert({
      brand_id: body.brandId,
      name: body.name,
      objective: body.objective,
      status: 'draft',
    })
    .select('id,brand_id,name,objective,status,created_at')
    .single();

  if (error) throw error;
  return NextResponse.json({ campaign: data }, { status: 201 });
});
