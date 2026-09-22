import 'server-only';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

type Db = ReturnType<typeof supabaseAdmin>;

/** Credits paid to the referrer once a referred account activates. */
export const REFERRAL_REWARD_CREDITS = 500;

/** Lifetime cap per referrer, enforced again inside `reward_referral`. */
export const REFERRAL_LIFETIME_CAP = 20;

/**
 * Referral codes.
 *
 * The alphabet omits I, L and O, and uses digits 2–9 rather than 0–9, so no
 * two symbols look alike in the fonts a code is actually read in. For a code
 * that grants credits, a transcription slip does not fail — it silently
 * attributes a signup to a different real person, with nothing afterwards to
 * show it happened.
 *
 * Eight characters from these 31 symbols is 39.6 bits. That is not a secret
 * and does not need to be: guessing someone's code earns the guesser nothing,
 * because the reward goes to the code's OWNER. It only has to be unlikely to
 * collide, and the unique index is the actual guarantee.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Rejection sampling rather than `byte % 31`.
 *
 * 256 is not a multiple of 31 — it leaves 8 — so the naive modulo makes the
 * first 8 symbols about 12% more likely than the other 23. That is harmless
 * for collision resistance at this length, which is the only property the code
 * needs, so the honest options were to use the modulo and say so, or to spend
 * three lines and have nothing to caveat. This costs a handful of discarded
 * bytes and removes the caveat.
 */
function generateCode(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 248
  let code = '';

  while (code.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte >= limit) continue; // discard the biased tail
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === 8) break;
    }
  }

  return code;
}

/**
 * Returns the user's referral code, creating one on first request.
 *
 * Retries on a unique-index collision rather than assuming randomness is
 * enough. At 38 bits a collision is very unlikely and not impossible, and the
 * failure mode without a retry is a 500 on the referral page for one unlucky
 * user, forever, with no obvious cause.
 */
export async function ensureReferralCode(userId: string, db: Db = supabaseAdmin()): Promise<string> {
  const { data: existing } = await db.from('users').select('referral_code').eq('id', userId).maybeSingle();

  if (existing?.referral_code) return existing.referral_code as string;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const { error } = await db.from('users').update({ referral_code: code }).eq('id', userId);

    if (!error) return code;

    // 23505 is unique_violation. Anything else is a real failure and should
    // not be retried as though it were a collision.
    if (error.code !== '23505') {
      logger.error('referral:code_assign_failed', error, { attempt });
      throw new Error('Could not create a referral code.');
    }
  }

  throw new Error('Could not create a unique referral code.');
}

/**
 * Records that `referredUserId` signed up with `code`.
 *
 * Status is `pending`: no credits are paid here. A reward paid at signup is
 * free money for anyone with a disposable email address, and paying it before
 * the referred account has done anything makes the abuse both profitable and
 * instant.
 *
 * Every rejection path is silent to the caller and returns false. A signup
 * flow must not fail because a referral code was wrong, expired or
 * self-referred — the user is trying to create an account, and the referral is
 * incidental to them.
 */
export async function recordReferral(
  code: string,
  referredUserId: string,
  db: Db = supabaseAdmin()
): Promise<boolean> {
  const normalised = code.trim().toUpperCase();
  if (normalised.length !== 8) return false;

  const { data: referrer } = await db
    .from('users')
    .select('id')
    .eq('referral_code', normalised)
    .maybeSingle();

  if (!referrer) {
    logger.info('referral:unknown_code');
    return false;
  }

  if (referrer.id === referredUserId) {
    logger.info('referral:self_referral_rejected');
    return false;
  }

  const { error } = await db.from('referrals').insert({
    referrer_id: referrer.id,
    referred_id: referredUserId,
    code: normalised,
    status: 'pending',
  });

  if (error) {
    // 23505 here means this account was already referred — the
    // `unique (referred_id)` constraint doing its job. Not an error worth
    // surfacing or retrying.
    if (error.code === '23505') {
      logger.info('referral:already_referred');
      return false;
    }
    logger.error('referral:insert_failed', error);
    return false;
  }

  logger.info('referral:recorded', { referrerId: referrer.id });
  return true;
}

/**
 * Marks a referral qualified and pays it, if the referred account has genuinely
 * activated.
 *
 * Called when an account reaches activation — a brand, a verified fact, and a
 * successful generation. That bar is deliberately work an abuser would have to
 * actually do, per fake account, which is what makes farming unprofitable
 * rather than merely against the rules.
 *
 * The payment itself is `reward_referral`, a SECURITY DEFINER function that
 * re-checks the status while holding `for update`. That lock is the
 * exactly-once guarantee: without it two concurrent calls both see 'qualified'
 * and both grant credits.
 */
export async function qualifyAndReward(
  referredUserId: string,
  db: Db = supabaseAdmin()
): Promise<{ rewarded: boolean; reason?: string }> {
  const { data: referral } = await db
    .from('referrals')
    .select('id, status')
    .eq('referred_id', referredUserId)
    .maybeSingle();

  if (!referral) return { rewarded: false, reason: 'no referral' };
  if (referral.status !== 'pending') return { rewarded: false, reason: `already ${referral.status}` };

  const { error: qualifyError } = await db
    .from('referrals')
    .update({ status: 'qualified', qualified_at: new Date().toISOString() })
    // Conditional on still being pending, so two concurrent activations cannot
    // both move it forward.
    .eq('id', referral.id)
    .eq('status', 'pending');

  if (qualifyError) {
    logger.error('referral:qualify_failed', qualifyError, { referralId: referral.id });
    return { rewarded: false, reason: 'qualify failed' };
  }

  const { data, error } = await db.rpc('reward_referral', {
    p_referral_id: referral.id,
    p_credits: REFERRAL_REWARD_CREDITS,
    p_max_rewarded_per_referrer: REFERRAL_LIFETIME_CAP,
  });

  if (error) {
    logger.error('referral:reward_rpc_failed', error, { referralId: referral.id });
    return { rewarded: false, reason: 'reward failed' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const rewarded = Boolean(row?.rewarded);

  logger.info('referral:reward_attempted', {
    referralId: referral.id,
    rewarded,
    reason: row?.reason ?? null,
  });

  return { rewarded, reason: row?.reason ?? undefined };
}

export interface ReferralSummary {
  code: string;
  pending: number;
  qualified: number;
  rewarded: number;
  creditsEarned: number;
  rewardPerReferral: number;
  lifetimeCap: number;
}

export async function referralSummary(userId: string, db: Db = supabaseAdmin()): Promise<ReferralSummary> {
  const code = await ensureReferralCode(userId, db);

  const { data } = await db.from('referrals').select('status, reward_credits').eq('referrer_id', userId);

  const rows = data ?? [];

  return {
    code,
    pending: rows.filter((r) => r.status === 'pending').length,
    qualified: rows.filter((r) => r.status === 'qualified').length,
    rewarded: rows.filter((r) => r.status === 'rewarded').length,
    creditsEarned: rows.reduce((total, r) => total + (r.reward_credits ?? 0), 0),
    rewardPerReferral: REFERRAL_REWARD_CREDITS,
    lifetimeCap: REFERRAL_LIFETIME_CAP,
  };
}
