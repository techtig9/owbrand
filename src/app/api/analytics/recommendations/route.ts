import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { confidenceBand } from '@/lib/analytics/signals';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Stored recommendations: read, apply, dismiss.
 *
 * Every row returns its confidence, sample size and evidence, because that is
 * the difference between a recommendation and an assertion. A row with no
 * evidence is filtered out here as well as refused by the database — belt and
 * braces on the one property that makes this feature honest.
 */

const ListQuery = z.object({
  brandId: uuidSchema.optional(),
  status: z.enum(['open', 'applied', 'dismissed', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = routeHandler('/api/analytics/recommendations', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, ListQuery);
  const db = supabaseAdmin();

  const brandIds = query.brandId
    ? [(await assertBrandAccess(user.id, query.brandId, { db })).id]
    : await accessibleBrandIds(user.id, db);

  if (brandIds.length === 0) {
    return NextResponse.json({ recommendations: [], counts: { open: 0, applied: 0, dismissed: 0 } });
  }

  let builder = db
    .from('ai_recommendations')
    .select(
      'id, brand_id, signal, title, recommendation, priority, action_type, status, confidence, evidence, window_days, sample_size, generated_by, model, created_at, updated_at, applied_at, dismissed_at'
    )
    .in('brand_id', brandIds);

  if (query.status !== 'all') builder = builder.eq('status', query.status);

  const { data, error } = await builder.order('created_at', { ascending: false }).limit(query.limit);
  if (error) throw error;

  const rows = (data ?? []) as Array<Record<string, any>>;

  const recommendations = rows
    // A recommendation with no evidence cannot be audited, so it is not shown.
    // The database refuses to create one; this catches legacy rows written
    // before the evidence column existed.
    .filter((row) => row.evidence && Object.keys(row.evidence).length > 0)
    .map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      signal: row.signal,
      title: row.title,
      recommendation: row.recommendation,
      priority: row.priority,
      actionType: row.action_type,
      status: row.status,
      confidence: row.confidence === null ? null : Number(row.confidence),
      confidenceBand: row.confidence === null ? null : confidenceBand(Number(row.confidence)),
      evidence: row.evidence,
      windowDays: row.window_days,
      sampleSize: row.sample_size,
      // Says whether the prose came from a model or from the deterministic
      // observation, so nothing is presented as AI insight that is not.
      generatedBy: row.generated_by,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

  const legacyWithoutEvidence = rows.length - recommendations.length;

  const { data: allStatuses } = await db
    .from('ai_recommendations')
    .select('status')
    .in('brand_id', brandIds)
    .limit(1000);

  const statuses = ((allStatuses ?? []) as Array<{ status: string }>).map((row) => row.status);

  return NextResponse.json({
    recommendations,
    counts: {
      open: statuses.filter((status) => status === 'open').length,
      applied: statuses.filter((status) => status === 'applied').length,
      dismissed: statuses.filter((status) => status === 'dismissed').length,
    },
    ...(legacyWithoutEvidence > 0 ? { hiddenWithoutEvidence: legacyWithoutEvidence } : {}),
  });
});

const DecisionBody = z.object({
  recommendationId: uuidSchema,
  decision: z.enum(['apply', 'dismiss', 'reopen']),
  note: boundedText(0, 1000).optional(),
});

export const POST = routeHandler('/api/analytics/recommendations', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, DecisionBody);
  const db = supabaseAdmin();

  const { data } = await db
    .from('ai_recommendations')
    .select('id, brand_id, status, signal')
    .eq('id', body.recommendationId)
    .maybeSingle();

  const recommendation = data as { id: string; brand_id: string; status: string; signal: string | null } | null;

  // Missing and inaccessible both 404, so ids cannot be probed.
  if (!recommendation) throw ApiError.notFound('Recommendation not found.');

  await assertBrandAccess(user.id, recommendation.brand_id, { db });

  const now = new Date().toISOString();
  const patch =
    body.decision === 'apply'
      ? { status: 'applied', applied_at: now, dismissed_at: null, dismissed_by: null }
      : body.decision === 'dismiss'
        ? { status: 'dismissed', dismissed_at: now, dismissed_by: user.id, applied_at: null }
        : { status: 'open', dismissed_at: null, dismissed_by: null, applied_at: null };

  const { error } = await db
    .from('ai_recommendations')
    .update({ ...patch, updated_at: now })
    .eq('id', recommendation.id);

  if (error) throw error;

  // Marking a recommendation applied is a claim the user acted on it, which
  // later analysis will read as a cause. Worth an audit record.
  await db.from('audit_logs').insert({
    actor_id: user.id,
    actor_type: 'user',
    action: `recommendation.${body.decision}`,
    entity_type: 'ai_recommendation',
    entity_id: recommendation.id,
    metadata: { brandId: recommendation.brand_id, signal: recommendation.signal, note: body.note ?? null },
  });

  logger.info('recommendations:decision', {
    userId: user.id,
    recommendationId: recommendation.id,
    decision: body.decision,
  });

  return NextResponse.json({ ok: true, recommendationId: recommendation.id, status: patch.status });
});
