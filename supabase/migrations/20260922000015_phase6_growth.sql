-- ============================================================================
-- Phase 6: activation, feedback and referrals.
--
-- Idempotent. Adds three tables and one column; alters nothing destructively.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Onboarding progress
-- ----------------------------------------------------------------------------
-- Deliberately NOT a set of boolean flags.
--
-- Flags drift: a user deletes their only brand and "created a brand" stays
-- ticked forever, so the checklist starts lying about the account it is
-- describing. Every step in the UI is derived by COUNTING the real rows
-- instead, and this table stores only the two things that cannot be derived:
-- whether the user dismissed the checklist, and when they first reached a
-- successful generation (which is the activation metric worth measuring, and
-- is unrecoverable once the generation row ages out).

create table if not exists public.onboarding_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  dismissed_at timestamptz,
  -- The activation moment. Set once, never updated: "first" is the point.
  first_success_at timestamptz,
  -- Whether the post-activation survey has been shown, so it is asked once.
  survey_shown_at timestamptz,
  survey_score smallint check (survey_score between 1 and 5),
  survey_comment text check (char_length(survey_comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_state enable row level security;

drop policy if exists "onboarding_state self" on public.onboarding_state;
create policy "onboarding_state self" on public.onboarding_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists onboarding_state_updated_at on public.onboarding_state;
create trigger onboarding_state_updated_at before update on public.onboarding_state
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- In-app feedback
-- ----------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'confusing', 'praise', 'other')),
  message text not null check (char_length(message) between 3 and 4000),
  -- Where they were when they wrote it. Far more useful than the message alone.
  path text check (char_length(path) <= 300),
  -- Set by staff, not by the reporter.
  status text not null default 'new' check (status in ('new', 'triaged', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback(created_at desc);
create index if not exists feedback_status_idx on public.feedback(status, created_at desc);

alter table public.feedback enable row level security;

-- INSERT only, and users cannot read the table back.
--
-- Not an oversight: a shared feedback table readable by its authenticated
-- inserters would let any user read every other user's reports, which are
-- frequently "this broke when I did X with my client's data". Staff read it
-- through the admin panel on the service role.
drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own" on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Referrals
-- ----------------------------------------------------------------------------
-- A referral code per user, and one row per successful referral.
--
-- The abuse surface here is the whole design problem: a credit reward paid on
-- signup is free money for anyone with a disposable email address. So the
-- reward is NOT paid on signup.

alter table public.users add column if not exists referral_code text;

-- Partial unique index rather than a unique constraint: existing rows have
-- NULL, and a plain unique constraint over a nullable column is fine in
-- Postgres but this states the intent — codes are unique among those that
-- exist.
create unique index if not exists users_referral_code_key
  on public.users(referral_code) where referral_code is not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_id uuid not null references public.users(id) on delete cascade,
  code text not null,

  -- pending  → signed up, reward NOT yet paid
  -- qualified→ the referred account actually did something; reward payable
  -- rewarded → credits granted, recorded in credit_ledger
  -- rejected → failed an abuse check; reason recorded
  status text not null default 'pending'
    check (status in ('pending', 'qualified', 'rewarded', 'rejected')),
  rejected_reason text,

  reward_credits integer not null default 0 check (reward_credits >= 0),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),

  -- An account can be referred exactly once, ever. Without this, a referred
  -- user could be "referred" repeatedly by different referrers.
  unique (referred_id)
);

-- Self-referral is impossible at the schema level, not merely discouraged in
-- code that someone may later bypass.
alter table public.referrals drop constraint if exists referrals_no_self_referral;
alter table public.referrals add constraint referrals_no_self_referral
  check (referrer_id <> referred_id);

create index if not exists referrals_referrer_idx on public.referrals(referrer_id, status);

alter table public.referrals enable row level security;

-- A referrer may read their own referrals, and nothing else. Note there is no
-- INSERT or UPDATE policy: rows are created and advanced by the service role
-- only. A user who could insert their own referral row could mint rewards.
drop policy if exists "referrals readable by referrer" on public.referrals;
create policy "referrals readable by referrer" on public.referrals
  for select to authenticated
  using (referrer_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Reward payment, as one atomic function
-- ----------------------------------------------------------------------------
-- Pays a qualified referral exactly once and writes the ledger entry in the
-- same transaction.
--
-- The `for update` plus the status re-check inside it is what makes it exactly
-- once: two concurrent calls both see 'qualified' without the lock, and both
-- grant credits. This is the same failure the credit system was fixed for, and
-- referral rewards are the classic place it reappears.
create or replace function public.reward_referral(
  p_referral_id uuid,
  p_credits integer,
  p_max_rewarded_per_referrer integer default 20
)
returns table (rewarded boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.referrals;
  v_already integer;
  v_balance_after integer;
begin
  if p_credits <= 0 then
    return query select false, 'reward must be positive'::text;
    return;
  end if;

  select * into v_referral from public.referrals
   where id = p_referral_id
     for update;

  if not found then
    return query select false, 'referral not found'::text;
    return;
  end if;

  -- Re-checked while holding the lock. This is the exactly-once guarantee.
  if v_referral.status <> 'qualified' then
    return query select false, format('referral is %s, not qualified', v_referral.status)::text;
    return;
  end if;

  -- A lifetime cap per referrer. Without it, one person with a script and a
  -- supply of addresses drains the credit budget one qualified referral at a
  -- time, and every individual referral looks legitimate.
  select count(*) into v_already from public.referrals
   where referrer_id = v_referral.referrer_id and status = 'rewarded';

  if v_already >= p_max_rewarded_per_referrer then
    update public.referrals
       set status = 'rejected',
           rejected_reason = format('referrer reached the lifetime cap of %s rewards', p_max_rewarded_per_referrer)
     where id = p_referral_id;
    return query select false, 'referrer cap reached'::text;
    return;
  end if;

  -- credits_remaining lives on SUBSCRIPTIONS, not users. The first draft of
  -- this function updated users.credits_remaining and inserted a credit_ledger
  -- row with `delta`/`metadata` columns -- none of which exist. Reading the
  -- actual table definitions before writing the function is the only reason
  -- this is correct; it would have failed at runtime, inside a reward path
  -- that is exercised rarely and therefore noticed late.
  update public.subscriptions
     set credits_remaining = credits_remaining + p_credits
   where user_id = v_referral.referrer_id
  returning credits_remaining into v_balance_after;

  if v_balance_after is null then
    -- No subscription row: nothing to credit. Fail loudly rather than
    -- reporting a reward that went nowhere.
    return query select false, 'referrer has no subscription row'::text;
    return;
  end if;

  insert into public.credit_ledger (user_id, entry_type, amount, balance_after, action, reason)
  values (
    v_referral.referrer_id,
    'grant',
    p_credits,
    v_balance_after,
    'referral_reward',
    format('referral %s', p_referral_id)
  );

  update public.referrals
     set status = 'rewarded', reward_credits = p_credits, rewarded_at = now()
   where id = p_referral_id;

  return query select true, null::text;
end;
$$;

-- Service role only. A tenant-callable function that grants credits is a
-- self-service credit printer.
revoke all on function public.reward_referral(uuid, integer, integer) from public, anon, authenticated;
