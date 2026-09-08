import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertContentAssetAccess, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveDecision } from '@/lib/approvals/decision';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The approval inbox.
 *
 * This is where the factuality guard's findings become actionable. The guard is
 * a safety net, not a proof — it uses lexical patterns, so it will miss a
 * cleverly-worded violation and can flag an innocent phrase. Human approval is
 * the real control; this endpoint is what makes it cheap to operate.
 *
 * A `block` finding prevents publication until someone resolves it. A `review`
 * finding is advisory and does not.
 */

const ListQuery = z.object({
  brandId: uuidSchema.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
});

export const GET = routeHandler('/api/approvals', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, ListQuery);
  const db = supabaseAdmin();

  // Scope to brands the caller can actually reach. An unfiltered query here
  // would be the dashboard leak from the Phase 1 audit all over again.
  const brandIds = query.brandId
    ? [(await assertBrandAccess(user.id, query.brandId, { db })).id]
    : await accessibleBrandIds(user.id, db);

  if (brandIds.length === 0) {
    return NextResponse.json({ items: [], counts: { pending: 0, blocked: 0, review: 0 } });
  }

  // Assets carrying unresolved findings, newest first.
  const { data: findings, error } = await db
    .from('content_factuality')
    .select('id, content_asset_id, brand_id, severity, category, excerpt, explanation, resolved, created_at')
    .in('brand_id', brandIds)
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const assetIds = Array.from(
    new Set((findings ?? []).map((f: { content_asset_id: string | null }) => f.content_asset_id).filter(Boolean))
  ) as string[];

  const assets = assetIds.length
    ? (
        await db
          .from('content_assets')
          .select('id, brand_id, type, status, caption, metadata, created_at')
          .in('id', assetIds)
      ).data ?? []
    : [];

  const findingsByAsset = new Map<string, Array<Record<string, unknown>>>();
  for (const finding of findings ?? []) {
    const key = (finding as { content_asset_id: string }).content_asset_id;
    const list = findingsByAsset.get(key) ?? [];
    list.push(finding as Record<string, unknown>);
    findingsByAsset.set(key, list);
  }

  const items = (assets as Array<Record<string, any>>).map((asset) => {
    const assetFindings = findingsByAsset.get(asset.id) ?? [];
    return {
      asset: {
        id: asset.id,
        brandId: asset.brand_id,
        type: asset.type,
        status: asset.status,
        caption: asset.caption,
        createdAt: asset.created_at,
      },
      findings: assetFindings,
      blocked: assetFindings.some((f) => (f as { severity: string }).severity === 'block'),
    };
  });

  // Blocked items first — they are the ones holding up publication.
  items.sort((a, b) => Number(b.blocked) - Number(a.blocked));

  return NextResponse.json({
    items,
    counts: {
      pending: items.length,
      blocked: items.filter((i) => i.blocked).length,
      review: items.filter((i) => !i.blocked).length,
    },
  });
});

const DecisionBody = z.object({
  assetId: uuidSchema,
  decision: z.enum(['approve', 'reject', 'request_edits']),
  notes: boundedText(0, 2000).optional(),
  /** Resolve the factuality findings alongside the decision. */
  resolveFindings: z.boolean().default(true),
});

/**
 * Record a decision.
 *
 * Approving an asset that still has BLOCKING findings requires explicitly
 * resolving them — the reviewer is stating they have checked each one. That is
 * deliberate friction: a one-click approve on a medical claim is exactly the
 * failure this whole system exists to prevent.
 */
export const POST = routeHandler('/api/approvals', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, DecisionBody);
  const db = supabaseAdmin();

  const asset = await assertContentAssetAccess(user.id, body.assetId, db);
  const brandId = asset.brand_id as string;

  const { data: openFindings } = await db
    .from('content_factuality')
    .select('id, severity')
    .eq('content_asset_id', body.assetId)
    .eq('resolved', false);

  const blocking = (openFindings ?? []).filter((f: { severity: string }) => f.severity === 'block');
  const outcome = resolveDecision(body.decision, blocking.length, body.resolveFindings);

  if (outcome.requiresFindingResolution) {
    throw ApiError.invalid(
      `This asset has ${blocking.length} blocking factuality finding(s). Review and resolve them before approving.`,
      { blockingCount: blocking.length }
    );
  }

  const status = outcome.assetStatus;

  const { error: updateError } = await db
    .from('content_assets')
    .update({ status })
    .eq('id', body.assetId)
    .eq('brand_id', brandId);

  if (updateError) throw updateError;

  if (body.resolveFindings && (openFindings ?? []).length > 0) {
    const { error: resolveError } = await db
      .from('content_factuality')
      .update({ resolved: true, resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('content_asset_id', body.assetId)
      .eq('resolved', false);

    if (resolveError) {
      logger.warn('approvals:resolve_failed', { assetId: body.assetId, error: String(resolveError.message) });
    }
  }

  // The approvals table is the reviewer-facing audit trail.
  const { error: approvalError } = await db.from('approvals').insert({
    brand_id: brandId,
    asset_id: body.assetId,
    status: outcome.approvalStatus,
    reviewer_id: user.id,
    notes: body.notes ?? null,
  });

  if (approvalError) {
    logger.warn('approvals:record_failed', { assetId: body.assetId, error: String(approvalError.message) });
  }

  // A privileged decision on flagged content deserves a durable record.
  await db.from('audit_logs').insert({
    actor_id: user.id,
    actor_type: 'user',
    action: `approval.${body.decision}`,
    entity_type: 'content_asset',
    entity_id: body.assetId,
    metadata: { brandId, blockingResolved: blocking.length, notes: body.notes ?? null },
  });

  logger.info('approvals:decision', {
    userId: user.id,
    assetId: body.assetId,
    decision: body.decision,
    blockingResolved: blocking.length,
  });

  return NextResponse.json({ ok: true, assetId: body.assetId, status, decision: body.decision });
});
