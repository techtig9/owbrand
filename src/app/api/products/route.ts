import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertProductAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * SECURITY FIX (Phase 1)
 * The previous GET filtered only on the client-supplied brandId, on a
 * service-role client, with no ownership check — so any authenticated user
 * could list any tenant's products. It also returned product_assets for an
 * arbitrary productId with no check at all.
 */

const ListQuery = z.object({
  brandId: uuidSchema,
  productId: uuidSchema.optional(),
});

export const GET = routeHandler('/api/products', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId, productId } = parseSearchParams(request, ListQuery);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, brandId, { db });

  const { data: products, error } = await db
    .from('products')
    .select('id,brand_id,name,slug,description,category,price,currency,status,created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  if (!productId) {
    return NextResponse.json({ products: products ?? [] });
  }

  // Assets are only returned for a product the caller demonstrably owns, and
  // the product must belong to the brand they just proved access to.
  await assertProductAccess(user.id, productId, { db, brandId });

  const { data: assets, error: assetsError } = await db
    .from('product_assets')
    .select('id,product_id,type,source,status,url,prompt,metadata,created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false });

  if (assetsError) throw assetsError;

  return NextResponse.json({ products: products ?? [], assets: assets ?? [] });
});

const CreateProduct = z.object({
  brandId: uuidSchema,
  name: boundedText(1, 160),
  description: boundedText(0, 10000).optional(),
  category: boundedText(0, 100).optional(),
  price: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
});

export const POST = routeHandler('/api/products', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, CreateProduct);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });

  const slug = body.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);

  const { data, error } = await db
    .from('products')
    .insert({
      brand_id: body.brandId,
      name: body.name,
      description: body.description ?? '',
      category: body.category ?? '',
      price: body.price ?? null,
      slug,
    })
    .select('id,brand_id,name,slug,description,category,price,currency,status,created_at')
    .single();

  if (error) throw error;
  return NextResponse.json({ product: data }, { status: 201 });
});
