import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * CSV export.
 *
 * Exports the stored daily rows as measured — no gap filling, no derived
 * rates. A spreadsheet is where someone checks our arithmetic, so handing them
 * our arithmetic defeats the purpose; and a zero-filled missing day would be
 * indistinguishable from a measured zero once it left the product.
 *
 * A `metrics_reported` column travels with every row so the recipient can tell
 * an unmeasured metric from a measured zero outside the UI that explains it.
 */

const Query = z.object({
  brandId: uuidSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataset: z.enum(['daily', 'posts']).default('daily'),
});

const DAILY_COLUMNS = [
  'metric_date',
  'platform',
  'impressions',
  'reach',
  'engagements',
  'clicks',
  'conversions',
  'video_views',
  'spend',
  'revenue',
] as const;

const POST_COLUMNS = [
  'snapshot_date',
  'platform',
  'external_post_id',
  'published_at',
  'impressions',
  'reach',
  'engagements',
  'likes',
  'comments',
  'shares',
  'saves',
  'clicks',
  'video_views',
] as const;

/**
 * Escapes one CSV field.
 *
 * The leading-character guard matters: a value beginning with =, +, - or @ is
 * executed as a formula when the file is opened in Excel or Sheets. Platform
 * ids and captions are external data, so this is a live injection path, not a
 * theoretical one.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(text);
  const guarded = needsFormulaGuard ? `'${text}` : text;

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function toCsv(columns: readonly string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column])).join(','));
  }
  // CRLF: what Excel expects, and harmless everywhere else.
  return `${lines.join('\r\n')}\r\n`;
}

export const GET = routeHandler('/api/analytics/export', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, Query);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, query.brandId, { db });

  const to = query.to ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);

  const isDaily = query.dataset === 'daily';

  const { data, error } = isDaily
    ? await db
        .from('analytics_daily')
        .select(`${DAILY_COLUMNS.join(',')}, raw_metrics`)
        .eq('brand_id', query.brandId)
        .gte('metric_date', from)
        .lte('metric_date', to)
        .order('metric_date', { ascending: true })
        .limit(20000)
    : await db
        .from('post_metrics')
        .select(POST_COLUMNS.join(','))
        .eq('brand_id', query.brandId)
        .gte('snapshot_date', from)
        .lte('snapshot_date', to)
        .order('snapshot_date', { ascending: true })
        .limit(20000);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  const columns = isDaily ? [...DAILY_COLUMNS, 'metrics_reported'] : [...POST_COLUMNS];

  const prepared = isDaily
    ? rows.map((row) => ({
        ...row,
        metrics_reported: Array.isArray((row.raw_metrics as { metricsReported?: unknown } | null)?.metricsReported)
          ? ((row.raw_metrics as { metricsReported: unknown[] }).metricsReported as unknown[]).join(' ')
          : '',
      }))
    : rows;

  const csv = toCsv(columns, prepared);

  logger.info('analytics:exported', {
    userId: user.id,
    brandId: query.brandId,
    dataset: query.dataset,
    rows: rows.length,
  });

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="owbrand-${query.dataset}-${from}-to-${to}.csv"`,
      // A tenant's performance data must never sit in a shared cache.
      'cache-control': 'no-store, private',
    },
  });
});
