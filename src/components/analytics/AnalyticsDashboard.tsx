'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Download, Info, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { TrendChart, type TrendPoint } from './TrendChart';
import { StatTile, MagnitudeBars } from './StatTile';
import { compactNumber, formatRate, formatMoney, formatMultiple } from './chart-tokens';

/**
 * The analytics dashboard.
 *
 * What it replaces was a two-line minified file showing four counts — creative
 * assets, scheduled posts, campaigns, open recommendations — none of which is a
 * performance metric. It read the orphaned `scheduled_posts` table and scoped
 * brands by `user_id`, so a workspace member saw nothing.
 *
 * The organising principle here is that MEASURED and NOT MEASURED look
 * different everywhere. A platform that does not report clicks shows "—" and
 * "Not reported by the platform", never "0" and "0.00% CTR". A period with no
 * prior data says so instead of showing +100%.
 */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
] as const;

const TREND_METRICS = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'reach', label: 'Reach' },
  { key: 'engagements', label: 'Engagements' },
  { key: 'clicks', label: 'Clicks' },
] as const;

type TrendMetric = (typeof TREND_METRICS)[number]['key'];

interface Overview {
  range: { from: string; to: string };
  summary: {
    totals: Record<string, number>;
    rates: Record<string, number | null>;
    coverage: {
      daysWithData: number;
      daysRequested: number;
      reported: string[];
      unreported: string[];
      platforms: string[];
      hasData: boolean;
    };
  };
  comparison: {
    range: { from: string; to: string };
    deltas: Record<string, { percent: number | null; direction: 'up' | 'down' | 'flat' | 'new' }>;
    previousHasData: boolean;
  } | null;
  series: Array<Record<string, number | string>>;
  missingDates: string[];
  platforms: Array<{
    platform: string;
    label: string;
    totals: Record<string, number>;
    rates: Record<string, number | null>;
    shareOfImpressions: number | null;
  }>;
  campaigns: Array<{
    campaignId: string;
    name: string;
    status: string;
    postCount: number;
    impressions: number;
    engagements: number;
    engagementRate: number | null;
    hasData: boolean;
  }>;
  topPosts: Array<{
    externalPostId: string;
    platform: string;
    publishedAt: string | null;
    impressions: number;
    engagements: number;
    engagementRate: number | null;
  }>;
  postsExcludedForLowVolume: number;
  postsMeasured: number;
}

interface Recommendation {
  id: string;
  signal: string;
  title: string;
  recommendation: string;
  priority: string;
  status: string;
  confidence: number | null;
  confidenceBand: 'high' | 'moderate' | 'low' | null;
  evidence: Record<string, unknown>;
  sampleSize: number | null;
  generatedBy: string;
  windowDays: number | null;
}

export function AnalyticsDashboard({ brandId }: { brandId: string }) {
  const [days, setDays] = useState<number>(28);
  const [metric, setMetric] = useState<TrendMetric>('impressions');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, recsResponse] = await Promise.all([
        fetch(`/api/analytics/overview?brandId=${encodeURIComponent(brandId)}&days=${days}`),
        fetch(`/api/analytics/recommendations?brandId=${encodeURIComponent(brandId)}&status=open`),
      ]);

      const overviewData = await overviewResponse.json();
      if (!overviewResponse.ok) throw new Error(overviewData.error ?? 'Could not load analytics.');

      const recsData = await recsResponse.json();

      setOverview(overviewData);
      setRecommendations(recsResponse.ok ? (recsData.recommendations ?? []) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [brandId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const response = await fetch('/api/analytics/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId, days }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not analyse this brand.');

      if ((data.recommendations ?? []).length === 0) {
        toast.success(
          data.coverage?.hasData
            ? 'Nothing stood out in this window.'
            : 'No analytics have been ingested yet, so there is nothing to analyse.'
        );
      } else {
        toast.success(`${data.recommendations.length} recommendation(s) updated.`);
      }

      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not analyse this brand.');
    } finally {
      setGenerating(false);
    }
  }

  async function decide(recommendation: Recommendation, decision: 'apply' | 'dismiss') {
    setBusyId(recommendation.id);
    try {
      const response = await fetch('/api/analytics/recommendations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recommendationId: recommendation.id, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not record that.');

      setRecommendations((current) => current.filter((item) => item.id !== recommendation.id));
      toast.success(decision === 'apply' ? 'Marked as applied.' : 'Dismissed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record that.');
    } finally {
      setBusyId(null);
    }
  }

  const trendPoints: TrendPoint[] = useMemo(() => {
    if (!overview) return [];
    return overview.series.map((point) => ({
      date: String(point.date),
      value: Number(point[metric] ?? 0),
    }));
  }, [overview, metric]);

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading analytics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-canvas-alt" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-canvas-alt" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-semibold text-red-700">{error}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost mt-4">
          Try again
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const { summary, comparison, coverage } = { ...overview, coverage: overview.summary.coverage };
  const measured = (field: string) => coverage.reported.includes(field);
  const previousLabel = `previous ${days} days`;

  const deltaFor = (field: string) =>
    comparison
      ? {
          percent: comparison.deltas[field]?.percent ?? null,
          direction: comparison.deltas[field]?.direction ?? 'flat',
          previousLabel,
        }
      : null;

  const sparkFor = (field: string) => overview.series.map((point) => Number(point[field] ?? 0));

  return (
    <div className="space-y-6">
      {/* Filters in one row above the charts. */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((option) => (
          <button
            key={option.days}
            type="button"
            aria-pressed={days === option.days}
            onClick={() => setDays(option.days)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              days === option.days ? 'bg-ink text-canvas' : 'border border-line text-ink-soft hover:bg-canvas-alt'
            }`}
          >
            {option.label}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={`/api/analytics/export?brandId=${encodeURIComponent(brandId)}&from=${overview.range.from}&to=${overview.range.to}&dataset=daily`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-canvas-alt"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="btn-accent !px-4 !py-2 text-xs disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Analyse
          </button>
        </span>
      </div>

      <CoverageBanner coverage={coverage} range={overview.range} />

      {/* KPI row — the right form for headline numbers. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Impressions"
          value={compactNumber(summary.totals.impressions ?? 0)}
          measured={measured('impressions')}
          delta={deltaFor('impressions')}
          sparkline={sparkFor('impressions')}
        />
        <StatTile
          label="Reach"
          value={compactNumber(summary.totals.reach ?? 0)}
          measured={measured('reach')}
          delta={deltaFor('reach')}
          sparkline={sparkFor('reach')}
        />
        <StatTile
          label="Engagement rate"
          value={formatRate(summary.rates.engagementRate)}
          measured={measured('engagements') && measured('impressions')}
          delta={deltaFor('engagements')}
        />
        <StatTile
          label="Clicks"
          value={compactNumber(summary.totals.clicks ?? 0)}
          measured={measured('clicks')}
          delta={deltaFor('clicks')}
          sparkline={sparkFor('clicks')}
        />
      </div>

      {(measured('spend') || measured('revenue')) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Spend" value={formatMoney(summary.totals.spend ?? 0)} delta={deltaFor('spend')} higherIsBetter={false} />
          <StatTile label="Attributed revenue" value={formatMoney(summary.totals.revenue ?? 0)} delta={deltaFor('revenue')} />
          <StatTile label="ROAS" value={formatMultiple(summary.rates.roas)} measured={measured('spend')} />
        </div>
      )}

      {recommendations.length > 0 && (
        <RecommendationList
          recommendations={recommendations}
          busyId={busyId}
          onDecide={(recommendation, decision) => void decide(recommendation, decision)}
        />
      )}

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">Trend</h2>
          <div className="flex flex-wrap gap-1.5">
            {TREND_METRICS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={metric === option.key}
                onClick={() => setMetric(option.key)}
                disabled={!measured(option.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  metric === option.key ? 'bg-ink text-canvas' : 'border border-line text-ink-soft hover:bg-canvas-alt'
                }`}
                title={measured(option.key) ? undefined : 'Not reported by the connected platforms'}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* One series, one y-axis. Two metrics together would need two scales,
            and the crossing point would be an artefact of the scales. */}
        <div className="mt-5">
          <TrendChart
            points={trendPoints}
            missingDates={overview.missingDates}
            label={TREND_METRICS.find((option) => option.key === metric)?.label.toLowerCase() ?? metric}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold text-ink">By platform</h2>
          <p className="mt-1 text-xs text-ink-soft">Impressions. Bar length is the comparison.</p>
          <div className="mt-5">
            <MagnitudeBars
              valueLabel="Impressions"
              rows={overview.platforms.map((entry) => ({
                label: entry.label,
                value: entry.totals.impressions ?? 0,
                secondary:
                  entry.rates.engagementRate !== null
                    ? `${formatRate(entry.rates.engagementRate)} eng.`
                    : undefined,
              }))}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold text-ink">Campaigns</h2>
          {overview.campaigns.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line bg-canvas-alt px-4 py-8 text-center text-sm text-ink-faint">
              No campaigns yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 pr-3 font-medium">Posts</th>
                    <th className="py-2 pr-3 font-medium">Impressions</th>
                    <th className="py-2 font-medium">Eng. rate</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.campaigns.map((campaign) => (
                    <tr key={campaign.campaignId} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 text-ink">{campaign.name}</td>
                      <td className="py-2 pr-3 tabular-nums text-ink-soft">{campaign.postCount}</td>
                      <td className="py-2 pr-3 tabular-nums text-ink-soft">
                        {campaign.hasData ? compactNumber(campaign.impressions) : '—'}
                      </td>
                      <td className="py-2 tabular-nums text-ink-soft">{formatRate(campaign.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">Top posts</h2>
          <p className="text-xs text-ink-faint">
            {overview.postsMeasured} post{overview.postsMeasured === 1 ? '' : 's'} measured
            {overview.postsExcludedForLowVolume > 0 &&
              ` · ${overview.postsExcludedForLowVolume} excluded for too few impressions to rank`}
          </p>
        </div>

        {overview.topPosts.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line bg-canvas-alt px-4 py-8 text-center text-sm text-ink-faint">
            No posts have enough measured impressions to rank yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-2 pr-3 font-medium">Post</th>
                  <th className="py-2 pr-3 font-medium">Platform</th>
                  <th className="py-2 pr-3 font-medium">Published</th>
                  <th className="py-2 pr-3 font-medium">Impressions</th>
                  <th className="py-2 font-medium">Eng. rate</th>
                </tr>
              </thead>
              <tbody>
                {overview.topPosts.map((post) => (
                  <tr key={`${post.platform}:${post.externalPostId}`} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-ink-soft">{post.externalPostId.slice(0, 18)}</td>
                    <td className="py-2 pr-3 capitalize text-ink-soft">{post.platform}</td>
                    <td className="py-2 pr-3 text-ink-soft">
                      {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-ink-soft">{compactNumber(post.impressions)}</td>
                    <td className="py-2 tabular-nums font-semibold text-ink">{formatRate(post.engagementRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * States plainly what was and was not measured.
 *
 * This banner is the difference between an honest analytics product and a
 * confident-looking one. With no ingestion running, every number below is zero
 * and the correct thing to say is why.
 */
function CoverageBanner({
  coverage,
  range,
}: {
  coverage: Overview['summary']['coverage'];
  range: { from: string; to: string };
}) {
  if (!coverage.hasData) {
    return (
      <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          No data ingested
        </p>
        <p className="mt-1 text-sm leading-6 text-ink-soft">
          Nothing has been measured for {range.from} to {range.to}. Analytics arrive once an account is connected
          and the ingestion job has run — every figure below would otherwise be a zero nobody measured.{' '}
          <Link href="/dashboard/connections" className="font-semibold text-ink underline">
            Connect an account
          </Link>
          .
        </p>
      </div>
    );
  }

  const partial = coverage.daysWithData < coverage.daysRequested;
  const hasUnreported = coverage.unreported.length > 0;

  if (!partial && !hasUnreported) return null;

  return (
    <div role="note" className="rounded-2xl border border-line bg-canvas-alt px-5 py-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        What is measured
      </p>
      <p className="mt-1 text-sm leading-6 text-ink-soft">
        {partial && (
          <>
            {coverage.daysWithData} of {coverage.daysRequested} days have ingested data.{' '}
          </>
        )}
        {hasUnreported && (
          <>
            The connected platforms do not report:{' '}
            <span className="font-medium text-ink">{coverage.unreported.join(', ')}</span>. Those show as “—”
            rather than zero.
          </>
        )}
      </p>
    </div>
  );
}

function RecommendationList({
  recommendations,
  busyId,
  onDecide,
}: {
  recommendations: Recommendation[];
  busyId: string | null;
  onDecide: (recommendation: Recommendation, decision: 'apply' | 'dismiss') => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-lg font-semibold text-ink">What to do next</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Every recommendation shows the confidence it was derived at and the numbers behind it.
      </p>

      <ul className="mt-4 space-y-3">
        {recommendations.map((recommendation) => (
          <li key={recommendation.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink">{recommendation.title}</h3>
                  <ConfidenceBadge recommendation={recommendation} />
                  <span className="rounded-full bg-canvas-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                    {recommendation.priority}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-soft">
                  {recommendation.recommendation}
                </p>

                <Evidence recommendation={recommendation} />
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onDecide(recommendation, 'apply')}
                  disabled={busyId === recommendation.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas-alt disabled:opacity-50"
                >
                  {busyId === recommendation.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Applied
                </button>
                <button
                  type="button"
                  onClick={() => onDecide(recommendation, 'dismiss')}
                  disabled={busyId === recommendation.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-faint hover:bg-canvas-alt disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Dismiss
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Confidence, as a band plus the number.
 *
 * The band is what a reader acts on; the number is what they audit. A low-
 * confidence recommendation says so on its face rather than reading like a
 * finding.
 */
function ConfidenceBadge({ recommendation }: { recommendation: Recommendation }) {
  if (recommendation.confidence === null || !recommendation.confidenceBand) return null;

  const styles = {
    high: 'bg-mint-50 text-mint-600',
    moderate: 'bg-canvas-alt text-ink-soft',
    low: 'bg-amber-50 text-amber-800',
  } as const;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[recommendation.confidenceBand]}`}
      title={`Derived from ${recommendation.sampleSize?.toLocaleString() ?? 'an unknown'} sample over ${recommendation.windowDays ?? '?'} days`}
    >
      {recommendation.confidenceBand} · {(recommendation.confidence * 100).toFixed(0)}%
    </span>
  );
}

/** The numbers the recommendation was computed from, so it can be checked. */
function Evidence({ recommendation }: { recommendation: Recommendation }) {
  const entries = Object.entries(recommendation.evidence ?? {});
  if (entries.length === 0) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-soft">
        Evidence ({entries.length} metric{entries.length === 1 ? '' : 's'})
      </summary>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3 rounded-lg bg-canvas-alt px-3 py-1.5">
            <dt className="text-xs text-ink-soft">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
            <dd className="text-xs tabular-nums font-semibold text-ink">
              {value === null ? 'not measured' : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-ink-faint">
        {recommendation.generatedBy === 'ai'
          ? 'Observation computed from your stored analytics; wording written by AI from these numbers only.'
          : 'Computed directly from your stored analytics.'}
      </p>
    </details>
  );
}
