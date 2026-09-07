import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertProductAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { buildProductPipeline } from '@/lib/product/product-pipeline';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 * Previously unauthenticated and it accepted productId, productName, approved
 * facts and brand rules entirely from the request body. The product is now
 * looked up and authorized, and its real stored facts are used — a caller
 * cannot inject "approved facts", which the master command forbids the AI
 * layer from inventing.
 */
const Body = z.object({
  productId: uuidSchema,
  sourceImages: z.array(z.string().url()).max(20).optional(),
});

export const POST = routeHandler('/api/product/pipeline', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const { product, brand } = await assertProductAccess(user.id, body.productId, { db });

  // Approved facts and brand rules come from the database, never the caller.
  const { data: facts } = await db
    .from('products')
    .select('approved_facts')
    .eq('id', body.productId)
    .maybeSingle();

  const { data: guidelines } = await db
    .from('brand_guidelines')
    .select('do_rules, dont_rules, preferred_words, avoided_words')
    .eq('brand_id', brand.id)
    .maybeSingle();

  return NextResponse.json(
    buildProductPipeline({
      productId: product.id as string,
      productName: product.name as string,
      sourceImages: body.sourceImages ?? [],
      approvedFacts: (facts as { approved_facts?: Record<string, unknown> } | null)?.approved_facts ?? {},
      brandRules: (guidelines as Record<string, unknown> | null) ?? {},
    })
  );
});
