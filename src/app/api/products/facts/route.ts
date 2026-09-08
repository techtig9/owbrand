import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertProductAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  addProductFact,
  createFactSchema,
  deleteProductFact,
  listProductFacts,
  verifyProductFact,
} from '@/lib/brand/product-facts';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * The Product Brain's approved-fact store.
 *
 * This is the data the factuality guard enforces against, so the verification
 * state is the important part of the API: a fact only becomes quotable once a
 * human has confirmed it.
 */

export const GET = routeHandler('/api/products/facts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { productId, verifiedOnly } = parseSearchParams(
    request,
    z.object({
      productId: uuidSchema,
      // Query strings are strings; accept the usual truthy spellings.
      verifiedOnly: z.enum(['true', 'false', '1', '0']).optional(),
    })
  );

  const db = supabaseAdmin();
  await assertProductAccess(user.id, productId, { db });

  const facts = await listProductFacts(productId, {
    verifiedOnly: verifiedOnly === 'true' || verifiedOnly === '1',
    db,
  });

  return NextResponse.json({
    facts,
    verifiedCount: facts.filter((f) => f.verified).length,
    pendingCount: facts.filter((f) => !f.verified).length,
  });
});

const CreateBody = createFactSchema.extend({ productId: uuidSchema });

export const POST = routeHandler('/api/products/facts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, CreateBody);
  const db = supabaseAdmin();

  await assertProductAccess(user.id, body.productId, { db });

  // source defaults to user_entered, which marks the fact verified — a human
  // typing a fact is asserting it.
  const fact = await addProductFact({ ...body, userId: user.id }, db);

  return NextResponse.json({ fact }, { status: 201 });
});

const VerifyBody = z.object({
  productId: uuidSchema,
  factId: uuidSchema,
  verified: z.boolean(),
});

/** Confirm (or un-confirm) an AI-proposed fact, changing whether it is quotable. */
export const PATCH = routeHandler('/api/products/facts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, VerifyBody);
  const db = supabaseAdmin();

  await assertProductAccess(user.id, body.productId, { db });
  await assertFactBelongsToProduct(db, body.factId, body.productId);

  await verifyProductFact({ factId: body.factId, userId: user.id, verified: body.verified, db });

  return NextResponse.json({ ok: true, factId: body.factId, verified: body.verified });
});

const DeleteBody = z.object({ productId: uuidSchema, factId: uuidSchema });

export const DELETE = routeHandler('/api/products/facts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, DeleteBody);
  const db = supabaseAdmin();

  await assertProductAccess(user.id, body.productId, { db });
  await assertFactBelongsToProduct(db, body.factId, body.productId);

  await deleteProductFact(body.factId, db);
  return NextResponse.json({ ok: true });
});

/**
 * Guards against pairing an authorized productId with a fact belonging to
 * someone else's product — the same class of hole the Phase 1 audit found in
 * /api/products.
 */
async function assertFactBelongsToProduct(
  db: ReturnType<typeof supabaseAdmin>,
  factId: string,
  productId: string
): Promise<void> {
  const { data } = await db.from('product_facts').select('id').eq('id', factId).eq('product_id', productId).maybeSingle();
  if (!data) throw ApiError.notFound('Fact not found.');
}
