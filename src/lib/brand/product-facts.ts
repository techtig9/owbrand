/**
 * Product Brain — the approved-fact store.
 *
 * This is the data the factuality guard enforces against. The distinction that
 * matters is `verified`: a fact a human confirmed is quotable, a fact the AI
 * proposed from a product photo is not. Without that split, "approved facts"
 * would just be AI output being fed back to the AI as ground truth, which is
 * exactly the failure the master command is guarding against.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { ApprovedFacts } from '@/lib/brand/guard';

type Db = SupabaseClient<any, any, any>;

export const factCategorySchema = z.enum([
  'general',
  'specification',
  'material',
  'dimension',
  'price',
  'ingredient',
  'certification',
  'benefit',
  'usage',
  'care',
  'warranty',
]);

export type FactCategory = z.infer<typeof factCategorySchema>;
export type FactSource = 'user_entered' | 'ai_extracted' | 'imported';

export interface ProductFact {
  id: string;
  productId: string;
  fact: string;
  category: FactCategory;
  numericValue: string | null;
  unit: string | null;
  verified: boolean;
  source: FactSource;
  createdAt: string;
}

export const createFactSchema = z.object({
  fact: z.string().trim().min(3).max(500),
  category: factCategorySchema.default('general'),
  numericValue: z.string().trim().max(50).optional(),
  unit: z.string().trim().max(20).optional(),
});

export type CreateFactInput = z.infer<typeof createFactSchema>;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listProductFacts(
  productId: string,
  options: { verifiedOnly?: boolean; db?: Db } = {}
): Promise<ProductFact[]> {
  const db = options.db ?? supabaseAdmin();

  let query = db
    .from('product_facts')
    .select('id, product_id, fact, category, numeric_value, unit, verified, source, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: true });

  if (options.verifiedOnly) query = query.eq('verified', true);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(toFact);
}

function toFact(row: Record<string, any>): ProductFact {
  return {
    id: row.id,
    productId: row.product_id,
    fact: row.fact,
    category: row.category,
    numericValue: row.numeric_value ?? null,
    unit: row.unit ?? null,
    verified: Boolean(row.verified),
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * Builds the guard's input for a product.
 *
 * ONLY verified facts are included. An unverified fact is a suggestion awaiting
 * human confirmation, and feeding it to a generation would let AI-invented
 * detail become "approved" simply by having been proposed once.
 */
export async function approvedFactsFor(productId: string, db: Db = supabaseAdmin()): Promise<ApprovedFacts> {
  try {
    const facts = await listProductFacts(productId, { verifiedOnly: true, db });

    return {
      facts: facts.map((f) => (f.unit ? `${f.fact} (${f.numericValue ?? ''}${f.unit})`.trim() : f.fact)),
      numbers: facts
        .map((f) => f.numericValue)
        .filter((n): n is string => Boolean(n && n.trim())),
    };
  } catch (error) {
    // Fail closed: an unreadable fact store means NO approved facts, which makes
    // the guard maximally strict rather than accidentally permissive.
    logger.warn('product_facts:read_failed_failing_closed', { productId, error: String(error) });
    return { facts: [], numbers: [] };
  }
}

/**
 * The same, for a whole brand — used when copy references several products.
 */
export async function approvedFactsForBrand(brandId: string, db: Db = supabaseAdmin()): Promise<ApprovedFacts> {
  try {
    const { data: products } = await db.from('products').select('id, name').eq('brand_id', brandId).limit(100);
    const productIds = (products ?? []).map((p: { id: string }) => p.id);
    if (productIds.length === 0) return { facts: [], numbers: [] };

    const { data, error } = await db
      .from('product_facts')
      .select('product_id, fact, numeric_value, unit')
      .in('product_id', productIds)
      .eq('verified', true)
      .limit(300);

    if (error) throw error;

    const nameById = new Map((products ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

    return {
      facts: (data ?? []).map((row: Record<string, any>) => {
        const productName = nameById.get(row.product_id);
        const detail = row.unit ? `${row.fact} (${row.numeric_value ?? ''}${row.unit})`.trim() : row.fact;
        return productName ? `${productName}: ${detail}` : detail;
      }),
      numbers: (data ?? [])
        .map((row: Record<string, any>) => row.numeric_value)
        .filter((n: unknown): n is string => Boolean(n && String(n).trim())),
    };
  } catch (error) {
    logger.warn('product_facts:brand_read_failed_failing_closed', { brandId, error: String(error) });
    return { facts: [], numbers: [] };
  }
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Adds a fact.
 *
 * `source` decides the initial `verified` state: a human typing a fact is
 * verifying it by definition; an AI extraction is not.
 */
export async function addProductFact(
  input: CreateFactInput & { productId: string; userId: string; source?: FactSource },
  db: Db = supabaseAdmin()
): Promise<ProductFact> {
  const source: FactSource = input.source ?? 'user_entered';
  const verified = source === 'user_entered';

  const { data, error } = await db
    .from('product_facts')
    .insert({
      product_id: input.productId,
      fact: input.fact,
      category: input.category,
      numeric_value: input.numericValue ?? null,
      unit: input.unit ?? null,
      source,
      verified,
      verified_by: verified ? input.userId : null,
      verified_at: verified ? new Date().toISOString() : null,
    })
    .select('id, product_id, fact, category, numeric_value, unit, verified, source, created_at')
    .single();

  if (error) throw error;
  return toFact(data);
}

/** Confirms an AI-proposed fact, making it quotable. */
export async function verifyProductFact(
  options: { factId: string; userId: string; verified: boolean; db?: Db }
): Promise<void> {
  const db = options.db ?? supabaseAdmin();

  const { error } = await db
    .from('product_facts')
    .update({
      verified: options.verified,
      verified_by: options.verified ? options.userId : null,
      verified_at: options.verified ? new Date().toISOString() : null,
    })
    .eq('id', options.factId);

  if (error) throw error;
}

export async function deleteProductFact(factId: string, db: Db = supabaseAdmin()): Promise<void> {
  const { error } = await db.from('product_facts').delete().eq('id', factId);
  if (error) throw error;
}

/**
 * Stores facts an AI extracted from a product image as UNVERIFIED suggestions.
 * They appear in the UI for a human to confirm and cannot be quoted until then.
 */
export async function proposeExtractedFacts(
  options: { productId: string; facts: CreateFactInput[]; db?: Db }
): Promise<number> {
  const db = options.db ?? supabaseAdmin();
  if (options.facts.length === 0) return 0;

  const rows = options.facts.slice(0, 30).map((fact) => ({
    product_id: options.productId,
    fact: fact.fact,
    category: fact.category,
    numeric_value: fact.numericValue ?? null,
    unit: fact.unit ?? null,
    source: 'ai_extracted' as const,
    verified: false,
  }));

  const { error, count } = await db.from('product_facts').insert(rows, { count: 'exact' });
  if (error) throw error;
  return count ?? rows.length;
}
