import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchPageDailyInsights,
  fetchInstagramDailyInsights,
  fetchInstagramPostMetrics,
  fetchFacebookPostMetrics,
  IG_MAX_WINDOW_DAYS,
  RESTATEMENT_WINDOW_DAYS,
  type DailyMetricRow,
  type PostMetricRow,
} from './providers/meta-insights';
import { accessTokenFor, accountHealth, recordAccountError, type SocialAccountRow } from '@/lib/social/account-store';
import { PublishError } from '@/lib/social/errors';
import { isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Analytics ingestion.
 *
 * This is the piece that was missing entirely. `analytics_daily`,
 * `post_metrics` and `attribution_touchpoints` were queried by three endpoints
 * and a dashboard, and nothing on any code path ever wrote to them — so every
 * analytics answer was correctly, permanently empty.
 *
 * Design decisions that matter:
 *
 *   - INCREMENTAL, with a per-account cursor. Meta's rate limit is calls per
 *     hour per app; re-fetching full history on every run would exhaust it and
 *     lock out publishing too, since both share the budget.
 *
 *   - RE-READS THE LAST FEW DAYS. Platforms revise recent numbers for up to
 *     ~72 hours. Ingesting a day once and never looking again bakes in
 *     provisional figures, so the window always overlaps and the upsert lets
 *     the later measurement win.
 *
 *   - NEVER INVENTS A NUMBER. A metric the platform did not report is written
 *     as absent, not zero. `metricsReported` records which fields were real,
 *     so the dashboard can distinguish "zero impressions" from "impressions
 *     not measured".
 *
 *   - Failures are per-account. One brand's revoked token must not stop every
 *     other tenant's analytics.
 */

type Db = SupabaseClient<any, any, any>;

/** How far back a first-time ingestion reaches. */
const INITIAL_BACKFILL_DAYS = 30;
/** Give up on an account after this many consecutive failures, until it changes. */
const MAX_CONSECUTIVE_FAILURES = 6;
const POST_SAMPLE_LIMIT = 25;

export interface AccountIngestionResult {
  accountId: string;
  platform: string;
  brandId: string;
  outcome: 'ingested' | 'up_to_date' | 'skipped' | 'needs_reconnect' | 'error';
  daysWritten: number;
  postsWritten: number;
  detail?: string;
}

export interface IngestionRunResult {
  accounts: number;
  ingested: number;
  skipped: number;
  errors: number;
  daysWritten: number;
  postsWritten: number;
  results: AccountIngestionResult[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Works out the window to request.
 *
 * Returns null when there is genuinely nothing to fetch — the cursor is
 * already at yesterday and no restatement window remains. Metrics for *today*
 * are never requested: a partial day looks like a collapse in performance and
 * would poison every trend comparison.
 */
export function resolveWindow(
  lastIngestedDate: string | null,
  options: { today?: Date; maxWindowDays?: number; backfillDays?: number } = {}
): { since: string; until: string } | null {
  const today = options.today ?? new Date();
  const yesterday = addDays(today, -1);
  const until = isoDate(yesterday);

  const maxWindow = options.maxWindowDays ?? 90;
  const backfill = options.backfillDays ?? INITIAL_BACKFILL_DAYS;

  if (!lastIngestedDate) {
    const since = isoDate(addDays(yesterday, -(Math.min(backfill, maxWindow) - 1)));
    return { since, until };
  }

  // Overlap the restatement window so revised figures are picked up.
  const resumeFrom = addDays(new Date(`${lastIngestedDate}T00:00:00Z`), -RESTATEMENT_WINDOW_DAYS + 1);
  const earliestAllowed = addDays(yesterday, -(maxWindow - 1));
  const since = isoDate(resumeFrom > earliestAllowed ? resumeFrom : earliestAllowed);

  if (since > until) return null;

  return { since, until };
}

/** Runs one ingestion pass over every connected account that is due. */
export async function runAnalyticsIngestion(
  options: { limit?: number; db?: Db; today?: Date } = {}
): Promise<IngestionRunResult> {
  const db = options.db ?? supabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  const result: IngestionRunResult = {
    accounts: 0,
    ingested: 0,
    skipped: 0,
    errors: 0,
    daysWritten: 0,
    postsWritten: 0,
    results: [],
  };

  if (!isConfigured.metaOAuth()) {
    // No credentials means no data source. Reporting an empty successful run
    // would look identical to "there is nothing to ingest".
    return result;
  }

  const { data, error } = await db
    .from('social_accounts')
    .select(
      'id, user_id, brand_id, platform, account_name, external_account_id, external_page_id, granted_scopes, token_expires_at, status, last_error, last_error_at, last_verified_at, connected_at, access_token_ciphertext, metadata'
    )
    .in('platform', ['facebook', 'instagram'])
    .not('brand_id', 'is', null)
    .not('access_token_ciphertext', 'is', null)
    .neq('status', 'revoked')
    .limit(limit);

  if (error) throw error;

  const accounts = (data ?? []) as SocialAccountRow[];
  result.accounts = accounts.length;

  for (const account of accounts) {
    const outcome = await ingestAccount(account, db, options.today);
    result.results.push(outcome);
    result.daysWritten += outcome.daysWritten;
    result.postsWritten += outcome.postsWritten;

    if (outcome.outcome === 'ingested') result.ingested += 1;
    else if (outcome.outcome === 'error' || outcome.outcome === 'needs_reconnect') result.errors += 1;
    else result.skipped += 1;
  }

  logger.info('analytics_ingestion:completed', {
    accounts: result.accounts,
    ingested: result.ingested,
    daysWritten: result.daysWritten,
    postsWritten: result.postsWritten,
    errors: result.errors,
  });

  return result;
}

async function ingestAccount(
  account: SocialAccountRow,
  db: Db,
  today?: Date
): Promise<AccountIngestionResult> {
  const brandId = account.brand_id as string;
  const base = { accountId: account.id, platform: account.platform, brandId, daysWritten: 0, postsWritten: 0 };

  const state = await loadState(brandId, account, db);

  if (state.backoff_until && new Date(state.backoff_until) > new Date()) {
    return { ...base, outcome: 'skipped', detail: 'backing off after repeated failures' };
  }

  if (state.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
    return { ...base, outcome: 'skipped', detail: 'paused after repeated failures; reconnect the account' };
  }

  const health = accountHealth(account);
  if (!health.usable) {
    await writeState(state.id, { last_error: 'Account needs reconnecting.', consecutive_failures: state.consecutive_failures + 1 }, db);
    return { ...base, outcome: 'needs_reconnect', detail: health.status };
  }

  // Instagram refuses windows longer than 30 days.
  const maxWindowDays = account.platform === 'instagram' ? IG_MAX_WINDOW_DAYS : 90;
  const window = resolveWindow(state.last_ingested_date, { today, maxWindowDays });

  if (!window) {
    await writeState(state.id, { last_run_at: new Date().toISOString() }, db);
    return { ...base, outcome: 'up_to_date' };
  }

  try {
    const token = accessTokenFor(account);
    const targetId = account.external_account_id;

    if (!targetId) {
      throw new PublishError('needs_reconnect', 'no_target', 'This connection has no account id recorded.');
    }

    const daily =
      account.platform === 'instagram'
        ? await fetchInstagramDailyInsights(targetId, token, window.since, window.until)
        : await fetchPageDailyInsights(targetId, token, window.since, window.until);

    const daysWritten = await writeDailyMetrics(brandId, account, daily, db);

    const posts =
      account.platform === 'instagram'
        ? await fetchInstagramPostMetrics(targetId, token, { limit: POST_SAMPLE_LIMIT })
        : await fetchFacebookPostMetrics(targetId, token, { limit: POST_SAMPLE_LIMIT });

    const postsWritten = await writePostMetrics(brandId, account, posts, db);

    // Advance the cursor only to what was actually written. Advancing to
    // `window.until` on a partial response would create a permanent gap.
    const lastDate = daily.length > 0 ? daily[daily.length - 1].metricDate : state.last_ingested_date;

    await writeState(
      state.id,
      {
        last_ingested_date: lastDate,
        last_run_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
        consecutive_failures: 0,
        backoff_until: null,
      },
      db
    );

    return { ...base, outcome: 'ingested', daysWritten, postsWritten };
  } catch (error) {
    return handleIngestionFailure(account, state, error, base, db);
  }
}

async function handleIngestionFailure(
  account: SocialAccountRow,
  state: IngestionState,
  error: unknown,
  base: Omit<AccountIngestionResult, 'outcome' | 'detail'>,
  db: Db
): Promise<AccountIngestionResult> {
  const failures = state.consecutive_failures + 1;
  const publishError = error instanceof PublishError ? error : null;

  // A credential problem is the account's, not the ingester's: recorded
  // against the account so the connections screen prompts a reconnect.
  if (publishError?.kind === 'needs_reconnect') {
    await recordAccountError(account.id, publishError, db);
    await writeState(
      state.id,
      {
        last_run_at: new Date().toISOString(),
        last_error: publishError.message.slice(0, 500),
        last_error_at: new Date().toISOString(),
        consecutive_failures: failures,
      },
      db
    );
    return { ...base, outcome: 'needs_reconnect', detail: publishError.code };
  }

  // Exponential backoff on transient failures, so a rate limit is not met
  // with the same call volume a minute later.
  const backoffMinutes = Math.min(15 * 2 ** (failures - 1), 24 * 60);
  const retryAfter = publishError?.retryAfterSeconds
    ? new Date(Date.now() + publishError.retryAfterSeconds * 1000)
    : new Date(Date.now() + backoffMinutes * 60_000);

  await writeState(
    state.id,
    {
      last_run_at: new Date().toISOString(),
      last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      last_error_at: new Date().toISOString(),
      consecutive_failures: failures,
      backoff_until: retryAfter.toISOString(),
    },
    db
  );

  logger.warn('analytics_ingestion:account_failed', {
    accountId: account.id,
    platform: account.platform,
    failures,
    code: publishError?.code ?? 'unknown',
    backoffUntil: retryAfter.toISOString(),
  });

  return { ...base, outcome: 'error', detail: publishError?.code ?? 'ingestion_failed' };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Writes daily rows through the upsert RPC.
 *
 * `metricsReported` goes into raw_metrics so a reader can tell an unmeasured
 * metric from a measured zero. Every dashboard number depends on that
 * distinction being preserved at write time — it cannot be recovered later.
 */
async function writeDailyMetrics(
  brandId: string,
  account: SocialAccountRow,
  rows: DailyMetricRow[],
  db: Db
): Promise<number> {
  let written = 0;

  for (const row of rows) {
    const reported = Object.keys(row.metrics);

    const { error } = await db.rpc('upsert_daily_metrics', {
      p_brand_id: brandId,
      p_platform: account.platform,
      p_external_account_id: account.external_account_id,
      p_metric_date: row.metricDate,
      p_social_account_id: account.id,
      p_reach: row.metrics.reach ?? 0,
      p_impressions: row.metrics.impressions ?? 0,
      p_engagements: row.metrics.engagements ?? 0,
      p_clicks: row.metrics.clicks ?? 0,
      // Conversions and revenue never come from platform insights — they are
      // recorded as attribution touchpoints by the tenant's own systems.
      p_conversions: 0,
      p_video_views: row.metrics.videoViews ?? 0,
      p_spend: 0,
      p_revenue: 0,
      p_raw: { ...row.raw, metricsReported: reported, source: `${account.platform}_insights` },
    });

    if (error) {
      logger.warn('analytics_ingestion:daily_write_failed', {
        brandId,
        metricDate: row.metricDate,
        error: String(error.message),
      });
      continue;
    }

    written += 1;
  }

  return written;
}

async function writePostMetrics(
  brandId: string,
  account: SocialAccountRow,
  rows: PostMetricRow[],
  db: Db
): Promise<number> {
  if (rows.length === 0) return 0;

  // Match platform post ids back to our own posts in one query rather than one
  // per row.
  const externalIds = rows.map((row) => row.externalPostId);
  const { data: known } = await db
    .from('social_posts')
    .select('id, external_post_id')
    .eq('brand_id', brandId)
    .in('external_post_id', externalIds);

  const postIdByExternal = new Map<string, string>();
  for (const post of (known ?? []) as Array<{ id: string; external_post_id: string | null }>) {
    if (post.external_post_id) postIdByExternal.set(post.external_post_id, post.id);
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);
  let written = 0;

  for (const row of rows) {
    const reported = Object.keys(row.metrics);

    const { error } = await db.rpc('upsert_post_metrics', {
      p_brand_id: brandId,
      // Null when the post was published outside OwBrand — still worth
      // measuring, and the platform id keeps it identifiable.
      p_social_post_id: postIdByExternal.get(row.externalPostId) ?? null,
      p_platform: account.platform,
      p_external_post_id: row.externalPostId,
      p_snapshot_date: snapshotDate,
      p_published_at: row.publishedAt,
      p_impressions: row.metrics.impressions ?? 0,
      p_reach: row.metrics.reach ?? 0,
      p_engagements: row.metrics.engagements ?? 0,
      p_likes: row.metrics.likes ?? 0,
      p_comments: row.metrics.comments ?? 0,
      p_shares: row.metrics.shares ?? 0,
      p_saves: row.metrics.saves ?? 0,
      p_clicks: row.metrics.clicks ?? 0,
      p_video_views: row.metrics.videoViews ?? 0,
      p_raw: { ...row.raw, metricsReported: reported },
    });

    if (error) {
      logger.warn('analytics_ingestion:post_write_failed', {
        brandId,
        externalPostId: row.externalPostId,
        error: String(error.message),
      });
      continue;
    }

    written += 1;
  }

  return written;
}

/* ------------------------------------------------------------------ *
 * Cursor state
 * ------------------------------------------------------------------ */

interface IngestionState {
  id: string;
  last_ingested_date: string | null;
  consecutive_failures: number;
  backoff_until: string | null;
}

async function loadState(brandId: string, account: SocialAccountRow, db: Db): Promise<IngestionState> {
  const { data: existing } = await db
    .from('analytics_ingestion_state')
    .select('id, last_ingested_date, consecutive_failures, backoff_until')
    .eq('brand_id', brandId)
    .eq('platform', account.platform)
    .eq('social_account_id', account.id)
    .maybeSingle();

  if (existing) return existing as IngestionState;

  const { data: created, error } = await db
    .from('analytics_ingestion_state')
    .insert({ brand_id: brandId, platform: account.platform, social_account_id: account.id })
    .select('id, last_ingested_date, consecutive_failures, backoff_until')
    .single();

  if (error) throw error;
  return created as IngestionState;
}

async function writeState(id: string, patch: Record<string, unknown>, db: Db): Promise<void> {
  const { error } = await db
    .from('analytics_ingestion_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    logger.warn('analytics_ingestion:state_write_failed', { id, error: String(error.message) });
  }
}
