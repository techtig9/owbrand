import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import {
  summarize,
  sumTotals,
  compareTotals,
  previousRange,
  breakdownByPlatform,
  toTimeSeries,
  latestPerPost,
  rankPosts,
  type DailyMetricRecord,
  type PostMetricRecord,
} from '@/lib/analytics/metrics';
import { PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * The analytics overview.
 *
 * One request produces everything the dashboard shows: totals, derived rates,
 * a period-over-period comparison, a daily series, per-platform and
 * per-campaign breakdowns, and a post leaderboard.
 *
 * Every section carries its own coverage. That is the whole point: with no
 * ingestion configured, or a platform that does not report clicks, the honest
 * answer is "not measured" — not a confident zero. `hasData` and
 * `coverage.unreported` are what let the UI say so.
 */

const MAX_RANGE_DAYS = 365;

const Query = z.object({
  brandId: uuidSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Convenience for the UI's range picker. Ignored when from/to are given. */
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
  compare: z.coerce.boolean().default(true),
});

export const GET = routeHandler('/api/analytics/overview', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, Query);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, query.brandId, { db });

  // Yesterday is the latest complete day. Including today would show a partial
  // day as a collapse in performance and skew every comparison.
  const defaultTo = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const to = query.to ?? defaultTo;
  const from =
    query.from ??
    new Date(Date.parse(`${to}T00:00:00Z`) - (query.days - 1) * 86_400_000).toISOString().slice(0, 10);

  const range = { from, to };

  const rows = await loadDaily(query.brandId, range, db);
  const summary = summarize(rows, range);
  const series = toTimeSeries(rows, range);

  const comparison = query.compare ? await buildComparison(query.brandId, range, summary.totals, db) : null;

  const posts = await loadPosts(query.brandId, range, db);
  const postPerformance = latestPerPost(posts);
  const leaderboard = rankPosts(postPerformance, { limit: 10 });

  return NextResponse.json({
    range,
    summary,
    comparison,
    series: series.points,
    // Days with no ingested row. A chart that silently closes a gap looks like
    // measured flat performance.
    missingDates: series.missingDates,
    platforms: breakdownByPlatform(rows).map((entry) => ({
      ...entry,
      label: PLATFORMS[entry.platform as SocialPlatform]?.label ?? entry.platform,
    })),
    campaigns: await loadCampaignPerformance(query.brandId, range, db),
    topPosts: leaderboard.ranked,
    // Says how many posts were too small to rank, rather than presenting a
    // leaderboard built from 12-impression posts.
    postsExcludedForLowVolume: leaderboard.excludedForLowVolume,
    postsMeasured: postPerformance.length,
  });
});

async function loadDaily(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
): Promise<DailyMetricRecord[]> {
  const { data, error } = await db
    .from('analytics_daily')
    .select(
      'metric_date, platform, reach, impressions, engagements, clicks, conversions, video_views, spend, revenue, raw_metrics'
    )
    .eq('brand_id', brandId)
    .gte('metric_date', range.from)
    .lte('metric_date', range.to)
    .order('metric_date', { ascending: true })
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as DailyMetricRecord[];
}

async function loadPosts(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
): Promise<PostMetricRecord[]> {
  const { data, error } = await db
    .from('post_metrics')
    .select(
      'external_post_id, social_post_id, platform, snapshot_date, published_at, impressions, reach, engagements, likes, comments, shares, saves, clicks, video_views'
    )
    .eq('brand_id', brandId)
    // Posts are measured by when they were PUBLISHED, not when the snapshot
    // was taken — a post from last week measured today belongs to last week.
    .gte('published_at', `${range.from}T00:00:00Z`)
    .lte('published_at', `${range.to}T23:59:59Z`)
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as PostMetricRecord[];
}

async function buildComparison(
  brandId: string,
  range: { from: string; to: string },
  currentTotals: ReturnType<typeof sumTotals>,
  db: ReturnType<typeof supabaseAdmin>
) {
  const previous = previousRange(range);
  const previousRows = await loadDaily(brandId, previous, db);

  return {
    range: previous,
    deltas: compareTotals(currentTotals, sumTotals(previousRows)),
    // Without this the UI cannot tell "flat month on month" from "we had no
    // data last month", and a +0% badge would be a fabricated comparison.
    previousHasData: previousRows.length > 0,
  };
}

/**
 * Campaign performance.
 *
 * Attributed through the campaign's posts: `analytics_daily` is an
 * account-level rollup and carries no campaign dimension, so a campaign's
 * numbers are the sum of its posts' latest snapshots.
 */
async function loadCampaignPerformance(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
) {
  const { data: campaigns } = await db
    .from('campaigns')
    .select('id, name, status')
    .eq('brand_id', brandId)
    .limit(100);

  const campaignList = (campaigns ?? []) as Array<{ id: string; name: string; status: string }>;
  if (campaignList.length === 0) return [];

  const { data: posts } = await db
    .from('social_posts')
    .select('id, campaign_id')
    .eq('brand_id', brandId)
    .in(
      'campaign_id',
      campaignList.map((campaign) => campaign.id)
    );

  const postsByCampaign = new Map<string, string[]>();
  for (const post of (posts ?? []) as Array<{ id: string; campaign_id: string | null }>) {
    if (!post.campaign_id) continue;
    const list = postsByCampaign.get(post.campaign_id) ?? [];
    list.push(post.id);
    postsByCampaign.set(post.campaign_id, list);
  }

  const allPostIds = Array.from(postsByCampaign.values()).flat();
  if (allPostIds.length === 0) {
    return campaignList.map((campaign) => ({
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      postCount: 0,
      impressions: 0,
      engagements: 0,
      clicks: 0,
      engagementRate: null,
      hasData: false,
    }));
  }

  const { data: metrics } = await db
    .from('post_metrics')
    .select(
      'external_post_id, social_post_id, platform, snapshot_date, published_at, impressions, reach, engagements, likes, comments, shares, saves, clicks, video_views'
    )
    .eq('brand_id', brandId)
    .in('social_post_id', allPostIds)
    .limit(5000);

  const performanceByPost = new Map(
    latestPerPost((metrics ?? []) as PostMetricRecord[]).map((post) => [post.socialPostId, post])
  );

  return campaignList
    .map((campaign) => {
      const postIds = postsByCampaign.get(campaign.id) ?? [];
      const measured = postIds
        .map((postId) => performanceByPost.get(postId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      const impressions = measured.reduce((sum, post) => sum + post.impressions, 0);
      const engagements = measured.reduce((sum, post) => sum + post.engagements, 0);
      const clicks = measured.reduce((sum, post) => sum + post.clicks, 0);

      return {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        postCount: postIds.length,
        impressions,
        engagements,
        clicks,
        engagementRate: impressions > 0 ? engagements / impressions : null,
        // A campaign with posts but no measurements is a real and different
        // state from one with no posts.
        hasData: measured.length > 0,
      };
    })
    .sort((a, b) => b.impressions - a.impressions);
}
