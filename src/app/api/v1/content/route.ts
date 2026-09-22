import { NextResponse } from 'next/server';
import { v1Handler, readPage, paginated } from '@/lib/api/v1/handler';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/content — generated content assets.
 *
 * Read-only for now, and the docs say so. A write endpoint here would need to
 * charge credits, run the factuality guard and handle the review queue — all
 * of which exist, but wiring them to an unattended caller is a design decision
 * about what happens when generated copy is BLOCKED with nobody watching, and
 * shipping a write endpoint before answering that is how an API starts
 * silently discarding work.
 */
export const GET = v1Handler('/api/v1/content', 'read', async (request, principal) => {
  const { limit, cursor } = readPage(request);
  const db = supabaseAdmin();
  const brandIds = await accessibleBrandIds(principal.userId, db);

  if (brandIds.length === 0) return NextResponse.json(paginated([], limit));

  let query = db
    .from('content_assets')
    .select('id, brand_id, product_id, type, url, caption, status, created_at')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json(paginated(data ?? [], limit));
});
