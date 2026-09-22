import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, boundedText } from '@/lib/api/validate';
import { requireUser, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * Brands the caller may see: their own, plus any reachable through a shared
 * workspace. The id set comes from accessibleBrandIds() rather than a bare
 * user_id filter so workspace members are handled correctly.
 */
export const GET = routeHandler('/api/brands', async () => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const db = supabaseAdmin();
  const ids = await accessibleBrandIds(user.id, db);

  // No accessible brands means an empty list — never an unfiltered query.
  if (ids.length === 0) return NextResponse.json({ brands: [] });

  const { data, error } = await db
    .from('brands')
    .select('id,name,description,brand_colors,brand_fonts,created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return NextResponse.json({ brands: data ?? [] });
});

const CreateBrand = z.object({
  name: boundedText(1, 160),
  description: boundedText(0, 10000).optional(),
});

export const POST = routeHandler('/api/brands', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, CreateBrand);
  const db = supabaseAdmin();

  // Attach to the user's own workspace so workspace members inherit access.
  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  const { data, error } = await db
    .from('brands')
    .insert({
      user_id: user.id,
      workspace_id: workspace?.id ?? null,
      name: body.name,
      description: body.description ?? '',
    })
    .select('id,name,description,brand_colors,brand_fonts,created_at')
    .single();

  if (error) throw error;
  return NextResponse.json({ brand: data }, { status: 201 });
});
