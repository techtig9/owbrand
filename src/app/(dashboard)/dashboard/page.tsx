import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  CalendarClock,
  CheckCircle2,
  Link2,
  Package,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { confidenceBand } from '@/lib/analytics/signals';
import { summarize, previousRange, sumTotals, compareTotals, type DailyMetricRecord } from '@/lib/analytics/metrics';
import { accountHealth, type SocialAccountRow } from '@/lib/social/account-store';
import { compactNumber, formatRate } from '@/components/analytics/chart-tokens';

export const dynamic = 'force-dynamic';

/**
 * The Overview.
 *
 * Spec section 5 says this screen must answer five questions within ten
 * seconds: what happened, what needs attention, what should I do, what did AI
 * do, what opportunity exists — and explicitly says to avoid a generic
 * colourful card grid. The version this replaces was a five-tile grid of
 * counts (brands, products, assets, scheduled, recommendations), which answers
 * none of them: knowing you own 3 products is not knowing what to do today.
 *
 * SECURITY FIX. The previous recommendations query was:
 *
 *     db.from('ai_recommendations').select(...).eq('status','open')
 *
 * with NO tenant predicate — so the front page of every account listed every
 * other tenant's open recommendations. Phase 4 then added `evidence` and
 * `confidence` to that table, which would have turned it into a leak of other
 * businesses' performance figures. Everything here is scoped through
 * `accessibleBrandIds`.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const brandIds = await accessibleBrandIds(user.id, db);

  if (brandIds.length === 0) {
    return <FirstRun name={user.name} />;
  }

  const [attention, performance, recommendation, activity] = await Promise.all([
    loadAttention(brandIds, db),
    loadPerformance(brandIds, db),
    loadTopRecommendation(brandIds, db),
    loadActivity(brandIds, db),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content">
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            {attention.total === 0
              ? 'Nothing needs your attention right now.'
              : `${attention.total} thing${attention.total === 1 ? '' : 's'} need your attention.`}
          </p>
        </div>
        <Link href="/dashboard/ai-studio" className="btn-primary shrink-0">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Create
        </Link>
      </div>

      {/* 1. What needs attention. First, because it is the only section that
             can be urgent, and burying it under vanity counts is what made
             the old screen useless. */}
      <AttentionPanel attention={attention} />

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {/* 2. What happened. */}
          <PerformancePanel performance={performance} />

          {/* 3. What opportunity exists. */}
          <OpportunityPanel recommendation={recommendation} />
        </div>

        <div className="space-y-5">
          {/* 4. What should I do. */}
          <NextStepsPanel attention={attention} hasPerformance={performance !== null} />

          {/* 5. What did AI do. */}
          <ActivityPanel activity={activity} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function AttentionPanel({ attention }: { attention: Attention }) {
  if (attention.total === 0) {
    return (
      <div className="card flex items-center gap-3 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <p className="text-sm text-content-secondary">
          No blocked content, no failed posts, and every connected account is healthy.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="attention-heading" className="card border-warning/40 bg-warning-subtle p-5">
      <h2 id="attention-heading" className="flex items-center gap-2 text-sm font-semibold text-content">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
        Needs attention
      </h2>

      <ul className="mt-3 space-y-2">
        {attention.blockedApprovals > 0 && (
          <AttentionRow
            href="/dashboard/approvals"
            label={`${attention.blockedApprovals} item${attention.blockedApprovals === 1 ? '' : 's'} blocked by a factuality check`}
            detail="Cannot publish until reviewed"
          />
        )}
        {attention.failedPosts > 0 && (
          <AttentionRow
            href="/dashboard/scheduler"
            label={`${attention.failedPosts} post${attention.failedPosts === 1 ? '' : 's'} failed to publish`}
            detail="See what the platform said"
          />
        )}
        {attention.accountsNeedingReconnect > 0 && (
          <AttentionRow
            href="/dashboard/connections"
            label={`${attention.accountsNeedingReconnect} account${attention.accountsNeedingReconnect === 1 ? '' : 's'} need reconnecting`}
            detail="Publishing will fail until fixed"
          />
        )}
        {attention.overdueJobs > 0 && (
          <AttentionRow
            href="/dashboard/scheduler"
            label={`${attention.overdueJobs} scheduled post${attention.overdueJobs === 1 ? '' : 's'} overdue`}
            detail="The publishing worker may not be running"
          />
        )}
      </ul>
    </section>
  );
}

function AttentionRow({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-md bg-surface px-3 py-2.5 transition-colors duration-micro hover:bg-surface-raised"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-content">{label}</span>
          <span className="block text-xs text-content-tertiary">{detail}</span>
        </span>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-content-tertiary transition-transform duration-micro group-hover:-translate-y-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

function PerformancePanel({ performance }: { performance: Performance | null }) {
  if (!performance) {
    return (
      <section aria-labelledby="performance-heading" className="card p-5">
        <h2 id="performance-heading" className="text-sm font-semibold text-content">
          Performance
        </h2>
        <p className="mt-2 text-sm leading-6 text-content-secondary">
          Nothing has been measured yet. Analytics arrive once an account is connected and the ingestion job has
          run — so this stays empty rather than showing zeros nobody measured.
        </p>
        <Link href="/dashboard/connections" className="btn-ghost mt-4">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          Connect an account
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="performance-heading" className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="performance-heading" className="text-sm font-semibold text-content">
          Last 28 days
        </h2>
        <Link href="/dashboard/analytics" className="text-xs font-semibold text-primary hover:underline">
          Full analytics
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Metric
          label="Impressions"
          value={compactNumber(performance.totals.impressions)}
          delta={performance.deltas.impressions}
          measured={performance.reported.includes('impressions')}
        />
        <Metric
          label="Engagement rate"
          value={formatRate(performance.engagementRate)}
          delta={performance.deltas.engagements}
          measured={performance.reported.includes('engagements')}
        />
        <Metric
          label="Reach"
          value={compactNumber(performance.totals.reach)}
          delta={performance.deltas.reach}
          measured={performance.reported.includes('reach')}
        />
      </dl>

      {performance.daysWithData < performance.daysRequested && (
        <p className="mt-4 text-xs text-content-tertiary">
          {performance.daysWithData} of {performance.daysRequested} days measured.
        </p>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  delta,
  measured,
}: {
  label: string;
  value: string;
  delta: { percent: number | null; direction: string } | undefined;
  measured: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-content-tertiary">{label}</dt>
      <dd className="stat-value mt-0.5 text-xl font-semibold text-content">{measured ? value : '—'}</dd>
      {measured && delta && (
        <dd className="mt-0.5 text-[11px] text-content-tertiary">
          {delta.percent === null
            ? // "New" rather than +100%: no prior data is not a performance win.
              'no prior period'
            : `${delta.percent > 0 ? '+' : ''}${(delta.percent * 100).toFixed(1)}% vs previous`}
        </dd>
      )}
      {!measured && <dd className="mt-0.5 text-[11px] text-content-tertiary">not reported</dd>}
    </div>
  );
}

function OpportunityPanel({ recommendation }: { recommendation: TopRecommendation | null }) {
  if (!recommendation) return null;

  return (
    <section aria-labelledby="opportunity-heading" className="card p-5">
      <h2 id="opportunity-heading" className="flex items-center gap-2 text-sm font-semibold text-content">
        <TrendingUp className="h-4 w-4 text-ai" aria-hidden="true" />
        Biggest opportunity
      </h2>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-content">{recommendation.title}</h3>
          {recommendation.confidence !== null && (
            <span className="badge-ai">
              {confidenceBand(recommendation.confidence)} · {(recommendation.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-content-secondary">
          {recommendation.recommendation}
        </p>
        <Link href="/dashboard/analytics" className="btn-ghost mt-4">
          See the evidence
        </Link>
      </div>
    </section>
  );
}

function NextStepsPanel({ attention, hasPerformance }: { attention: Attention; hasPerformance: boolean }) {
  /*
   * Derived from real state, not a fixed checklist. A hard-coded "connect an
   * account" step that stays visible after connecting is the kind of thing
   * that teaches users to ignore the panel.
   */
  const steps: Array<{ href: string; label: string; icon: typeof Brain }> = [];

  if (!attention.hasBrandBrain) {
    steps.push({ href: '/dashboard/brand-brain', label: 'Build your Brand Brain', icon: Brain });
  }
  if (attention.productCount === 0) {
    steps.push({ href: '/dashboard/products', label: 'Add your first product', icon: Package });
  }
  if (attention.connectedAccounts === 0) {
    steps.push({ href: '/dashboard/connections', label: 'Connect a social account', icon: Link2 });
  }
  if (attention.scheduledPosts === 0 && attention.connectedAccounts > 0) {
    steps.push({ href: '/dashboard/scheduler', label: 'Schedule your first post', icon: CalendarClock });
  }
  if (!hasPerformance && attention.connectedAccounts > 0) {
    steps.push({ href: '/dashboard/analytics', label: 'Check what has been measured', icon: TrendingUp });
  }

  if (steps.length === 0) {
    return (
      <section aria-labelledby="next-heading" className="card p-5">
        <h2 id="next-heading" className="text-sm font-semibold text-content">
          Next steps
        </h2>
        <p className="mt-2 text-sm leading-6 text-content-secondary">
          Your workspace is fully set up. Create something, or review what the AI Manager has found.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="next-heading" className="card p-5">
      <h2 id="next-heading" className="text-sm font-semibold text-content">
        Next steps
      </h2>
      <ul className="mt-3 space-y-1">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.href} className="stagger-item" style={{ '--stagger-index': index } as React.CSSProperties}>
              <Link
                href={step.href}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-content transition-colors duration-micro hover:bg-surface-raised"
              >
                <Icon className="h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
                {step.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ActivityPanel({ activity }: { activity: ActivityEntry[] }) {
  return (
    <section aria-labelledby="activity-heading" className="card p-5">
      <h2 id="activity-heading" className="text-sm font-semibold text-content">
        Recent activity
      </h2>

      {activity.length === 0 ? (
        <p className="mt-2 text-sm text-content-secondary">Nothing generated yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ai" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-content">{entry.label}</span>
                <span className="block text-xs text-content-tertiary">
                  {new Date(entry.createdAt).toLocaleDateString()} · {entry.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FirstRun({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-content">Welcome, {name.split(' ')[0]}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-content-secondary">
        OwBrand runs on a Brand Brain — your positioning, voice, audience and approved facts. Everything it
        generates is built from that, so it is the first thing to create.
      </p>
      <Link href="/dashboard/ai-generator" className="btn-primary mt-6">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Build my Brand Brain
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

interface Attention {
  total: number;
  blockedApprovals: number;
  failedPosts: number;
  accountsNeedingReconnect: number;
  overdueJobs: number;
  hasBrandBrain: boolean;
  productCount: number;
  connectedAccounts: number;
  scheduledPosts: number;
}

type Db = ReturnType<typeof supabaseAdmin>;

async function loadAttention(brandIds: string[], db: Db): Promise<Attention> {
  const [blocked, failed, accounts, overdue, brain, products, scheduled] = await Promise.all([
    db
      .from('content_factuality')
      .select('id', { count: 'exact', head: true })
      .in('brand_id', brandIds)
      .eq('resolved', false)
      .eq('severity', 'block'),
    db.from('social_posts').select('id', { count: 'exact', head: true }).in('brand_id', brandIds).eq('status', 'failed'),
    db
      .from('social_accounts')
      .select(
        'id, user_id, brand_id, platform, account_name, external_account_id, external_page_id, granted_scopes, token_expires_at, status, last_error, last_error_at, last_verified_at, connected_at, access_token_ciphertext, metadata'
      )
      .in('brand_id', brandIds)
      .neq('status', 'revoked'),
    db
      .from('publishing_jobs')
      .select('id', { count: 'exact', head: true })
      .in('brand_id', brandIds)
      .in('status', ['queued', 'scheduled'])
      .lte('scheduled_for', new Date(Date.now() - 30 * 60 * 1000).toISOString()),
    db.from('brand_brain_versions').select('id', { count: 'exact', head: true }).in('brand_id', brandIds),
    db.from('products').select('id', { count: 'exact', head: true }).in('brand_id', brandIds),
    db
      .from('social_posts')
      .select('id', { count: 'exact', head: true })
      .in('brand_id', brandIds)
      .in('status', ['scheduled', 'queued']),
  ]);

  const accountRows = (accounts.data ?? []) as SocialAccountRow[];
  const needingReconnect = accountRows.filter((row) => !accountHealth(row).usable).length;

  const blockedApprovals = blocked.count ?? 0;
  const failedPosts = failed.count ?? 0;
  const overdueJobs = overdue.count ?? 0;

  return {
    total: blockedApprovals + failedPosts + needingReconnect + overdueJobs,
    blockedApprovals,
    failedPosts,
    accountsNeedingReconnect: needingReconnect,
    overdueJobs,
    hasBrandBrain: (brain.count ?? 0) > 0,
    productCount: products.count ?? 0,
    connectedAccounts: accountRows.length,
    scheduledPosts: scheduled.count ?? 0,
  };
}

interface Performance {
  totals: { impressions: number; reach: number; engagements: number };
  engagementRate: number | null;
  deltas: Record<string, { percent: number | null; direction: string }>;
  reported: string[];
  daysWithData: number;
  daysRequested: number;
}

async function loadPerformance(brandIds: string[], db: Db): Promise<Performance | null> {
  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
  const range = { from, to };

  const { data } = await db
    .from('analytics_daily')
    .select(
      'metric_date, platform, reach, impressions, engagements, clicks, conversions, video_views, spend, revenue, raw_metrics'
    )
    .in('brand_id', brandIds)
    .gte('metric_date', from)
    .lte('metric_date', to)
    .limit(5000);

  const rows = (data ?? []) as DailyMetricRecord[];
  if (rows.length === 0) return null;

  const summary = summarize(rows, range);

  const previous = previousRange(range);
  const { data: previousData } = await db
    .from('analytics_daily')
    .select(
      'metric_date, platform, reach, impressions, engagements, clicks, conversions, video_views, spend, revenue, raw_metrics'
    )
    .in('brand_id', brandIds)
    .gte('metric_date', previous.from)
    .lte('metric_date', previous.to)
    .limit(5000);

  const deltas = compareTotals(summary.totals, sumTotals((previousData ?? []) as DailyMetricRecord[]));

  return {
    totals: {
      impressions: summary.totals.impressions,
      reach: summary.totals.reach,
      engagements: summary.totals.engagements,
    },
    engagementRate: summary.rates.engagementRate,
    deltas,
    reported: summary.coverage.reported,
    daysWithData: summary.coverage.daysWithData,
    daysRequested: summary.coverage.daysRequested,
  };
}

interface TopRecommendation {
  title: string;
  recommendation: string;
  confidence: number | null;
}

async function loadTopRecommendation(brandIds: string[], db: Db): Promise<TopRecommendation | null> {
  const { data } = await db
    .from('ai_recommendations')
    .select('title, recommendation, priority, confidence, evidence')
    // The predicate whose absence was the leak.
    .in('brand_id', brandIds)
    .eq('status', 'open')
    .order('confidence', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const row = data as { title: string; recommendation: string; confidence: string | number | null; evidence: unknown } | null;
  if (!row) return null;

  // A recommendation with no evidence cannot be audited, so it is not shown —
  // the same rule the API and the database enforce.
  if (!row.evidence || Object.keys(row.evidence as object).length === 0) return null;

  return {
    title: row.title,
    recommendation: row.recommendation,
    confidence: row.confidence === null ? null : Number(row.confidence),
  };
}

interface ActivityEntry {
  id: string;
  label: string;
  status: string;
  createdAt: string;
}

async function loadActivity(brandIds: string[], db: Db): Promise<ActivityEntry[]> {
  const { data } = await db
    .from('content_assets')
    .select('id, type, status, caption, created_at')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: false })
    .limit(5);

  return ((data ?? []) as Array<Record<string, any>>).map((row) => ({
    id: row.id,
    label: row.caption ? String(row.caption).slice(0, 70) : `${row.type} generated`,
    status: row.status,
    createdAt: row.created_at,
  }));
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
