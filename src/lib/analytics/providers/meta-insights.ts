import 'server-only';
import { graphRequest } from '@/lib/social/providers/meta-client';
import { PublishError } from '@/lib/social/errors';
import { logger } from '@/lib/logger';

/**
 * Meta Insights adapter.
 *
 * Reads what the platform actually measured. Nothing here computes, estimates
 * or interpolates a metric: if Meta does not return a number, the field is
 * absent and stays absent all the way to the dashboard, where it renders as
 * "not reported" rather than zero. The master command's rule is "do not
 * fabricate analytics", and a zero presented as a measurement is a fabricated
 * measurement.
 *
 * Two shapes, because Meta has two entirely different insights APIs:
 *
 *   Facebook Page:  /{page-id}/insights?metric=…&period=day&since=&until=
 *                   returns one series per metric, each with dated values.
 *   Instagram:      /{ig-id}/insights?metric=…&period=day
 *                   returns a similar envelope but a different metric
 *                   vocabulary, and refuses ranges longer than 30 days.
 */

/** Metrics we read per day for a Facebook Page. */
const PAGE_DAILY_METRICS = [
  'page_impressions',
  'page_impressions_unique',
  'page_post_engagements',
  'page_video_views',
] as const;

/**
 * Instagram account metrics.
 *
 * `reach` and `impressions` are the only two with a stable day period on the
 * account endpoint; profile_views and website_clicks are requested separately
 * because they are rejected outright for some account types, and a single
 * rejected metric fails the whole call.
 */
const IG_DAILY_METRICS = ['reach', 'impressions'] as const;
const IG_DAILY_OPTIONAL_METRICS = ['profile_views', 'website_clicks'] as const;

/** Per-post metrics. Different vocabulary again, and per media type. */
const IG_MEDIA_METRICS = ['impressions', 'reach', 'likes', 'comments', 'saved', 'shares'] as const;
const IG_VIDEO_EXTRA_METRICS = ['video_views'] as const;

/** Instagram caps an insights window at 30 days. */
export const IG_MAX_WINDOW_DAYS = 30;
/** Platforms revise recent numbers, so the last few days are always re-read. */
export const RESTATEMENT_WINDOW_DAYS = 3;

export interface DailyMetricRow {
  metricDate: string;
  /** Only the metrics the platform actually reported. */
  metrics: Partial<{
    impressions: number;
    reach: number;
    engagements: number;
    clicks: number;
    videoViews: number;
  }>;
  raw: Record<string, unknown>;
}

export interface PostMetricRow {
  externalPostId: string;
  publishedAt: string | null;
  metrics: Partial<{
    impressions: number;
    reach: number;
    engagements: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    videoViews: number;
  }>;
  raw: Record<string, unknown>;
}

interface InsightsEnvelope {
  data?: Array<{
    name?: string;
    period?: string;
    values?: Array<{ value?: unknown; end_time?: string }>;
  }>;
}

/** ISO date (YYYY-MM-DD) from a Meta `end_time` timestamp. */
function dateFromEndTime(endTime: string | undefined): string | null {
  if (!endTime) return null;
  const parsed = Date.parse(endTime);
  if (Number.isNaN(parsed)) return null;
  // Meta's `end_time` for a day bucket is the START of the following day in
  // the account's timezone, so the metric belongs to the previous date.
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

function asCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  return undefined;
}

/**
 * Collapses Meta's per-metric series into one row per date.
 *
 * A metric absent from the response leaves its key unset — see the module
 * comment on why that matters.
 */
function foldSeries(
  envelope: InsightsEnvelope,
  mapping: Record<string, keyof DailyMetricRow['metrics']>
): DailyMetricRow[] {
  const byDate = new Map<string, DailyMetricRow>();

  for (const series of envelope.data ?? []) {
    const target = series.name ? mapping[series.name] : undefined;

    for (const point of series.values ?? []) {
      const date = dateFromEndTime(point.end_time);
      if (!date) continue;

      const row = byDate.get(date) ?? { metricDate: date, metrics: {}, raw: {} };
      const count = asCount(point.value);

      if (target !== undefined && count !== undefined) {
        // Two series can map to the same field (page_impressions and
        // page_impressions_unique both feed impressions/reach); take the
        // larger, never the sum, which would double-count.
        const existing = row.metrics[target];
        row.metrics[target] = existing === undefined ? count : Math.max(existing, count);
      }

      if (series.name) row.raw[series.name] = point.value;

      byDate.set(date, row);
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.metricDate.localeCompare(b.metricDate));
}

/**
 * Fetches daily Page insights.
 *
 * Optional metrics are requested in a second call: Meta rejects the entire
 * request if any single metric is unavailable for the account, so bundling a
 * maybe-supported metric with the core ones would lose everything.
 */
export async function fetchPageDailyInsights(
  pageId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<DailyMetricRow[]> {
  const envelope = await graphRequest<InsightsEnvelope>(`${pageId}/insights`, {
    params: {
      metric: PAGE_DAILY_METRICS.join(','),
      period: 'day',
      since,
      until,
    },
    accessToken,
  });

  return foldSeries(envelope, {
    page_impressions: 'impressions',
    page_impressions_unique: 'reach',
    page_post_engagements: 'engagements',
    page_video_views: 'videoViews',
  });
}

export async function fetchInstagramDailyInsights(
  igAccountId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<DailyMetricRow[]> {
  const core = await graphRequest<InsightsEnvelope>(`${igAccountId}/insights`, {
    params: { metric: IG_DAILY_METRICS.join(','), period: 'day', since, until },
    accessToken,
  });

  const rows = foldSeries(core, { impressions: 'impressions', reach: 'reach' });

  // Optional metrics: a rejection here must not lose the core numbers.
  try {
    const optional = await graphRequest<InsightsEnvelope>(`${igAccountId}/insights`, {
      params: { metric: IG_DAILY_OPTIONAL_METRICS.join(','), period: 'day', since, until },
      accessToken,
    });

    const optionalRows = foldSeries(optional, { website_clicks: 'clicks' });
    const byDate = new Map(rows.map((row) => [row.metricDate, row]));

    for (const optionalRow of optionalRows) {
      const existing = byDate.get(optionalRow.metricDate);
      if (existing) {
        Object.assign(existing.metrics, optionalRow.metrics);
        Object.assign(existing.raw, optionalRow.raw);
      } else {
        rows.push(optionalRow);
      }
    }
  } catch (error) {
    logger.info('meta_insights:optional_metrics_unavailable', {
      igAccountId,
      reason: error instanceof PublishError ? error.code : 'unknown',
    });
  }

  return rows.sort((a, b) => a.metricDate.localeCompare(b.metricDate));
}

interface MediaListEnvelope {
  data?: Array<{
    id: string;
    media_type?: string;
    timestamp?: string;
    like_count?: number;
    comments_count?: number;
  }>;
}

/**
 * Fetches per-post Instagram metrics for recently published media.
 *
 * Bounded by `limit` rather than paging the entire history: a brand with
 * thousands of posts would otherwise exhaust Meta's hourly call budget on one
 * ingestion run, and the recommendation engine only looks at a recent window
 * anyway.
 */
export async function fetchInstagramPostMetrics(
  igAccountId: string,
  accessToken: string,
  options: { limit?: number; since?: string } = {}
): Promise<PostMetricRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);

  const media = await graphRequest<MediaListEnvelope>(`${igAccountId}/media`, {
    params: {
      fields: 'id,media_type,timestamp,like_count,comments_count',
      limit,
      ...(options.since ? { since: options.since } : {}),
    },
    accessToken,
  });

  const rows: PostMetricRow[] = [];

  for (const item of media.data ?? []) {
    const isVideo = item.media_type === 'VIDEO' || item.media_type === 'REELS';
    const metricNames = isVideo
      ? [...IG_MEDIA_METRICS, ...IG_VIDEO_EXTRA_METRICS]
      : [...IG_MEDIA_METRICS];

    let insights: InsightsEnvelope = {};
    try {
      insights = await graphRequest<InsightsEnvelope>(`${item.id}/insights`, {
        params: { metric: metricNames.join(',') },
        accessToken,
      });
    } catch (error) {
      // Insights are unavailable for media older than the account's retention
      // window and for some types. Record what the media list gave us and move
      // on rather than failing the whole run.
      logger.info('meta_insights:post_insights_unavailable', {
        mediaId: item.id,
        reason: error instanceof PublishError ? error.code : 'unknown',
      });
    }

    const metrics: PostMetricRow['metrics'] = {};
    const raw: Record<string, unknown> = { media_type: item.media_type ?? null };

    // Like and comment counts come from the media object itself and are
    // available even when insights are not.
    if (typeof item.like_count === 'number') metrics.likes = asCount(item.like_count);
    if (typeof item.comments_count === 'number') metrics.comments = asCount(item.comments_count);

    const fieldByMetric: Record<string, keyof PostMetricRow['metrics']> = {
      impressions: 'impressions',
      reach: 'reach',
      likes: 'likes',
      comments: 'comments',
      saved: 'saves',
      shares: 'shares',
      video_views: 'videoViews',
    };

    for (const series of insights.data ?? []) {
      if (!series.name) continue;
      const value = asCount(series.values?.[0]?.value);
      raw[series.name] = series.values?.[0]?.value ?? null;

      const field = fieldByMetric[series.name];
      if (field && value !== undefined) metrics[field] = value;
    }

    // Engagement is DERIVED from reported components, so it is only present
    // when at least one component was reported — never invented as zero.
    const components = [metrics.likes, metrics.comments, metrics.shares, metrics.saves].filter(
      (value): value is number => value !== undefined
    );
    if (components.length > 0) {
      metrics.engagements = components.reduce((sum, value) => sum + value, 0);
    }

    rows.push({
      externalPostId: item.id,
      publishedAt: item.timestamp ?? null,
      metrics,
      raw,
    });
  }

  return rows;
}

/**
 * Fetches per-post Facebook metrics.
 *
 * The Page posts edge carries its own insights sub-fields, so one call covers
 * the list and the metrics — much cheaper against the rate limit than the
 * per-media round trips Instagram forces.
 */
export async function fetchFacebookPostMetrics(
  pageId: string,
  accessToken: string,
  options: { limit?: number } = {}
): Promise<PostMetricRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);

  const response = await graphRequest<{
    data?: Array<{
      id: string;
      created_time?: string;
      insights?: InsightsEnvelope;
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }>;
  }>(`${pageId}/posts`, {
    params: {
      limit,
      fields:
        'id,created_time,likes.summary(true).limit(0),comments.summary(true).limit(0),shares,' +
        'insights.metric(post_impressions,post_impressions_unique,post_clicks,post_video_views)',
    },
    accessToken,
  });

  return (response.data ?? []).map((post) => {
    const metrics: PostMetricRow['metrics'] = {};
    const raw: Record<string, unknown> = {};

    const fieldByMetric: Record<string, keyof PostMetricRow['metrics']> = {
      post_impressions: 'impressions',
      post_impressions_unique: 'reach',
      post_clicks: 'clicks',
      post_video_views: 'videoViews',
    };

    for (const series of post.insights?.data ?? []) {
      if (!series.name) continue;
      const value = asCount(series.values?.[0]?.value);
      raw[series.name] = series.values?.[0]?.value ?? null;

      const field = fieldByMetric[series.name];
      if (field && value !== undefined) metrics[field] = value;
    }

    const likes = asCount(post.likes?.summary?.total_count);
    const comments = asCount(post.comments?.summary?.total_count);
    const shares = asCount(post.shares?.count);

    if (likes !== undefined) metrics.likes = likes;
    if (comments !== undefined) metrics.comments = comments;
    if (shares !== undefined) metrics.shares = shares;

    const components = [likes, comments, shares].filter((value): value is number => value !== undefined);
    if (components.length > 0) {
      metrics.engagements = components.reduce((sum, value) => sum + value, 0);
    }

    return {
      externalPostId: post.id,
      publishedAt: post.created_time ?? null,
      metrics,
      raw,
    };
  });
}
