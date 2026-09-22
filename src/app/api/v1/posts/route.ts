import { NextResponse } from 'next/server';
import { z } from 'zod';
import { v1Handler, readPage, paginated } from '@/lib/api/v1/handler';
import { ApiError } from '@/lib/api/errors';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/posts — scheduled and published posts.
 *
 * `brand_id` is optional and, when given, is INTERSECTED with the accessible
 * set rather than trusted. Filtering by a parameter and separately checking
 * access is how a filter becomes an access-control bypass the first time
 * someone refactors one of the two.
 */
const Query = z.object({
  brandId: z.string().uuid().optional(),
  status: z.enum(['draft', 'scheduled', 'queued', 'published', 'failed']).optional(),
});

export const GET = v1Handler('/api/v1/posts', 'read', async (request, principal) => {
  const params = new URL(request.url).searchParams;
  const parsed = Query.safeParse({
    brandId: params.get('brandId') ?? undefined,
    status: params.get('status') ?? undefined,
  });

  if (!parsed.success) {
    throw ApiError.invalid('Invalid query parameters.', { issues: parsed.error.flatten().fieldErrors });
  }

  const { limit, cursor } = readPage(request);
  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(principal.userId, db);

  const brandIds = parsed.data.brandId
    ? accessible.filter((id) => id === parsed.data.brandId)
    : accessible;

  // An inaccessible brandId yields an empty list, not a 403. A 403 would
  // confirm the brand exists, which is more than the caller is entitled to
  // know about someone else's account.
  if (brandIds.length === 0) return NextResponse.json(paginated([], limit));

  let query = db
    .from('social_posts')
    .select('id, brand_id, platform, status, caption, scheduled_for, published_at, external_url, created_at')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (parsed.data.status) query = query.eq('status', parsed.data.status);
  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json(paginated(data ?? [], limit));
});
