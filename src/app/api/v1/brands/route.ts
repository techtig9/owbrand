import { NextResponse } from 'next/server';
import { v1Handler, readPage, paginated } from '@/lib/api/v1/handler';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/brands — the brands this key can see.
 *
 * Scoped through `accessibleBrandIds`, the same function the dashboard uses.
 * An API that re-implements its own access rule is an API that eventually
 * disagrees with the product about who can see what, and the API is the copy
 * nobody is looking at.
 */
export const GET = v1Handler('/api/v1/brands', 'read', async (request, principal) => {
  const { limit, cursor } = readPage(request);
  const db = supabaseAdmin();
  const brandIds = await accessibleBrandIds(principal.userId, db);

  if (brandIds.length === 0) {
    return NextResponse.json(paginated([], limit));
  }

  let query = db
    .from('brands')
    .select('id, name, description, logo_url, brand_colors, created_at')
    .in('id', brandIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json(paginated(data ?? [], limit));
});
