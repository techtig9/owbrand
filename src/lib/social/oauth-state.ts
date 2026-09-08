import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { safeRedirectPath } from '@/lib/security/redirect';
import { logger } from '@/lib/logger';

/**
 * Single-use OAuth state.
 *
 * This is the control that stops an OAuth account-linking attack. Without it,
 * an attacker starts an OAuth flow with THEIR social account, captures the
 * resulting `?code=`, and tricks a victim into loading our callback with it —
 * at which point the victim's brand gets the attacker's account attached, or
 * worse, the attacker's brand gets the victim's. Either way someone can post
 * as a brand they do not own.
 *
 * The state is stored server-side rather than signed-and-stateless for one
 * reason: only a stored row can be *consumed*. A signed cookie or JWT proves
 * the state was issued by us but not that it has not already been used, so a
 * captured callback URL stays replayable until it expires.
 */

type Db = SupabaseClient<any, any, any>;

/** 32 bytes of entropy, hex-encoded. Long enough that guessing is not a path. */
const STATE_BYTES = 32;

export interface CreateStateInput {
  userId: string;
  brandId?: string | null;
  provider: 'meta';
  requestedScopes: string[];
  /** Where to send the user after the callback. Validated, never trusted. */
  returnTo?: string | null;
}

export async function createOAuthState(input: CreateStateInput, db: Db = supabaseAdmin()): Promise<string> {
  const state = randomBytes(STATE_BYTES).toString('hex');

  // The return path is validated at ISSUE time, not at redirect time, so a
  // hostile value never reaches the database. safeRedirectPath rejects
  // absolute URLs, protocol-relative paths and control characters.
  const returnTo = input.returnTo ? safeRedirectPath(input.returnTo, '/dashboard/settings') : null;

  const { error } = await db.from('oauth_states').insert({
    state,
    user_id: input.userId,
    brand_id: input.brandId ?? null,
    provider: input.provider,
    requested_scopes: input.requestedScopes,
    return_to: returnTo,
  });

  if (error) throw error;

  return state;
}

export interface ConsumedState {
  userId: string;
  brandId: string | null;
  provider: string;
  requestedScopes: string[];
  returnTo: string | null;
}

/**
 * Validates and consumes a state value.
 *
 * Returns null for every failure — unknown, expired, or already used — without
 * distinguishing them to the caller. The callback turns that into one generic
 * error, so an attacker probing states learns nothing about which of their
 * guesses existed.
 *
 * Consumption is a conditional UPDATE, not a read followed by a write: two
 * concurrent callbacks with the same state must not both succeed.
 */
export async function consumeOAuthState(
  state: string,
  provider: 'meta',
  db: Db = supabaseAdmin()
): Promise<ConsumedState | null> {
  if (!state || typeof state !== 'string' || state.length < 32) return null;

  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from('oauth_states')
    .update({ consumed_at: nowIso })
    .eq('state', state)
    .eq('provider', provider)
    // These two predicates are the whole guarantee: only a row that is not yet
    // consumed and not yet expired can be claimed, and the database decides.
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('user_id, brand_id, provider, requested_scopes, return_to')
    .maybeSingle();

  if (error) {
    logger.error('oauth_state:consume_failed', error);
    return null;
  }

  if (!data) {
    logger.warn('oauth_state:rejected', {
      // Never log the state itself — it is a bearer value until consumed.
      statePrefix: state.slice(0, 8),
      provider,
    });
    return null;
  }

  const row = data as {
    user_id: string;
    brand_id: string | null;
    provider: string;
    requested_scopes: string[] | null;
    return_to: string | null;
  };

  return {
    userId: row.user_id,
    brandId: row.brand_id,
    provider: row.provider,
    requestedScopes: row.requested_scopes ?? [],
    returnTo: row.return_to,
  };
}

/** Housekeeping. Safe to call from the cron endpoint; never throws. */
export async function purgeExpiredOAuthStates(db: Db = supabaseAdmin()): Promise<number> {
  const { data, error } = await db.rpc('purge_expired_oauth_states');
  if (error) {
    logger.warn('oauth_state:purge_failed', { error: String(error.message) });
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}
