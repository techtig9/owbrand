import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import { buildChecklist, type Checklist, type StepCounts } from './steps';

type Db = ReturnType<typeof supabaseAdmin>;

export interface OnboardingSnapshot {
  checklist: Checklist;
  dismissed: boolean;
  /** Set the first time the account reaches activation. */
  firstSuccessAt: string | null;
  /** True when the post-activation survey is due: activated, not yet asked. */
  surveyDue: boolean;
}

const EMPTY_COUNTS: StepCounts = {
  brandBrainVersions: 0,
  products: 0,
  productFacts: 0,
  completedGenerations: 0,
  connectedAccounts: 0,
  scheduledOrPublishedPosts: 0,
};

/**
 * Loads the checklist for a user.
 *
 * Every count is scoped through `accessibleBrandIds`, so a brand shared through
 * a workspace counts towards the checklist — the same mistake that made
 * `brand-kit` report "no brand kit yet" for a brand visible on every other
 * screen.
 *
 * THE COLUMN NAMES HERE WERE ALL WRONG ON THE FIRST ATTEMPT, and the shapes
 * are worth stating because three of them are not what you would guess:
 *
 *   - `product_facts` keys on `product_id`, NOT `brand_id`, so it cannot be
 *     counted by brand directly — it needs the product ids first.
 *   - approval on a fact is `verified boolean`, not `status = 'approved'`.
 *   - `generation_jobs` keys on `workspace_id` and its column is `state`, not
 *     `brand_id`/`status`.
 *
 * Reading the migrations before writing the query is the only reason this
 * works; every one of those would have been a silent zero or a 400 from
 * PostgREST, and a checklist that quietly reports nothing done looks exactly
 * like a new account.
 */
export async function loadOnboarding(userId: string, db: Db = supabaseAdmin()): Promise<OnboardingSnapshot> {
  const [brandIds, workspaceId, state] = await Promise.all([
    accessibleBrandIds(userId, db),
    primaryWorkspaceId(userId, db),
    readState(userId, db),
  ]);

  if (brandIds.length === 0) {
    return {
      checklist: buildChecklist(EMPTY_COUNTS),
      dismissed: state.dismissed,
      firstSuccessAt: state.firstSuccessAt,
      surveyDue: false,
    };
  }

  // Product ids first, because facts hang off products rather than brands.
  const { data: productRows } = await db.from('products').select('id').in('brand_id', brandIds);
  const productIds = (productRows ?? []).map((row) => row.id as string);

  const byBrand = (table: string) =>
    db.from(table).select('id', { count: 'exact', head: true }).in('brand_id', brandIds);

  const [brains, accounts, posts, facts, generations] = await Promise.all([
    byBrand('brand_brain_versions'),
    byBrand('social_accounts'),
    db
      .from('social_posts')
      .select('id', { count: 'exact', head: true })
      .in('brand_id', brandIds)
      // Scheduled OR already sent. Counting only 'scheduled' would un-tick the
      // step the moment the worker actually sent the post, which is backwards.
      .in('status', ['scheduled', 'queued', 'publishing', 'published']),

    // Only VERIFIED facts count: an unverified fact cannot be asserted by
    // generation, so ticking the step on it sends the user to a dead end.
    productIds.length > 0
      ? db
          .from('product_facts')
          .select('id', { count: 'exact', head: true })
          .in('product_id', productIds)
          .eq('verified', true)
      : Promise.resolve({ count: 0 }),

    workspaceId
      ? db
          .from('generation_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('state', 'completed')
      : Promise.resolve({ count: 0 }),
  ]);

  const counts: StepCounts = {
    brandBrainVersions: brains.count ?? 0,
    products: productIds.length,
    productFacts: facts.count ?? 0,
    completedGenerations: generations.count ?? 0,
    connectedAccounts: accounts.count ?? 0,
    scheduledOrPublishedPosts: posts.count ?? 0,
  };

  const checklist = buildChecklist(counts);

  return {
    checklist,
    dismissed: state.dismissed,
    firstSuccessAt: state.firstSuccessAt,
    // Asked once, and only after the product has demonstrably worked. A survey
    // before activation measures the experience of people who never got value
    // — worth knowing, but a different question with different wording.
    surveyDue: checklist.activated && state.surveyShownAt === null,
  };
}

async function readState(userId: string, db: Db) {
  const { data } = await db
    .from('onboarding_state')
    .select('dismissed_at, first_success_at, survey_shown_at')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    dismissed: Boolean(data?.dismissed_at),
    firstSuccessAt: (data?.first_success_at as string | null) ?? null,
    surveyShownAt: (data?.survey_shown_at as string | null) ?? null,
  };
}

/**
 * Records the activation moment, once.
 *
 * Two statements rather than one upsert: the upsert creates the row when it is
 * absent, and the conditional update fills the column when the row exists with
 * a null. An unconditional upsert would overwrite `first_success_at` on every
 * call, silently turning "first" into "most recent" — identical in the schema,
 * useless for measuring activation, and invisible until someone tries to chart
 * it months later.
 */
export async function recordFirstSuccess(userId: string, db: Db = supabaseAdmin()): Promise<void> {
  const now = new Date().toISOString();

  await db
    .from('onboarding_state')
    .upsert({ user_id: userId, first_success_at: now }, { onConflict: 'user_id', ignoreDuplicates: true });

  await db
    .from('onboarding_state')
    .update({ first_success_at: now })
    .eq('user_id', userId)
    .is('first_success_at', null);
}
