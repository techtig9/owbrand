import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

/**
 * API key issuing and verification.
 *
 * ## Why SHA-256 and not bcrypt
 *
 * The usual rule — never store a credential with a fast hash — exists because
 * passwords are low-entropy and a stolen hash can be attacked offline with a
 * dictionary. That reasoning does not transfer here. These keys are 256 bits
 * from `randomBytes`, so there is no dictionary and no feasible offline attack:
 * the hash is not the weak link. What a slow KDF would add is latency on every
 * single API request, and a per-request bcrypt is how an API ends up with a
 * 100ms floor for no security gain.
 *
 * What hashing buys is the property that matters: a database disclosure yields
 * no usable credential.
 *
 * ## Why the key is shown exactly once
 *
 * Because the alternative is storing it recoverably, and then the database
 * disclosure above hands over every customer's key. "Copy it now" is mildly
 * annoying; the alternative is a breach that is total rather than partial.
 */

/**
 * `owb_live_` makes a leaked key greppable — in a repository scan, a log
 * sweep, or a support ticket where someone pasted one. A key that looks like
 * an arbitrary base64 blob is one nobody notices in a diff.
 */
const PREFIX = 'owb_live_';

/** The scopes a key can hold. Narrow on purpose; each one is enforced. */
export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];

export interface IssuedKey {
  /** The full key. Returned once, never stored, never logged. */
  key: string;
  id: string;
  prefix: string;
}

export interface ApiPrincipal {
  keyId: string;
  userId: string;
  scopes: Scope[];
}

function hash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Creates a key and stores only its hash.
 *
 * 32 bytes, base64url: 256 bits of entropy with no padding and nothing that
 * needs escaping in a header, a URL or a shell.
 */
export async function issueApiKey(input: {
  userId: string;
  name: string;
  scopes: Scope[];
  expiresAt?: string | null;
}): Promise<IssuedKey> {
  const secret = randomBytes(32).toString('base64url');
  const key = `${PREFIX}${secret}`;

  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .insert({
      user_id: input.userId,
      name: input.name,
      key_hash: hash(key),
      // Four characters: enough to tell two keys apart in a list, far too few
      // to narrow a brute force in any meaningful way.
      key_prefix: `${PREFIX}${secret.slice(0, 4)}`,
      scopes: input.scopes,
      expires_at: input.expiresAt ?? null,
    })
    .select('id, key_prefix')
    .single();

  if (error) throw error;

  return { key, id: data.id, prefix: data.key_prefix };
}

/**
 * Resolves a bearer token to a principal, or raises 401.
 *
 * Every rejection returns the SAME error. Distinguishing "no such key" from
 * "revoked" from "expired" tells an attacker which of their guesses was once a
 * real key, and tells a scraper which keys are worth retrying later.
 */
export async function authenticateApiKey(request: Request): Promise<ApiPrincipal> {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(\S+)$/i);

  if (!match || !match[1].startsWith(PREFIX)) {
    throw ApiError.unauthenticated('Provide an API key as `Authorization: Bearer owb_live_…`.');
  }

  const presented = match[1];
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('api_keys')
    .select('id, user_id, key_hash, scopes, expires_at, revoked_at')
    .eq('key_hash', hash(presented))
    .maybeSingle();

  if (error) throw error;

  const rejected = () => ApiError.unauthenticated('That API key is not valid.');

  if (!data) throw rejected();

  /*
   * The row was found BY its hash, so this comparison can only succeed — it is
   * not what stops a forged key. It is here so that the lookup and the decision
   * do not rest on the same equality, and so a future change to the lookup
   * (a prefix index, a cache) cannot quietly remove the check entirely.
   */
  const expected = Buffer.from(data.key_hash, 'utf8');
  const actual = Buffer.from(hash(presented), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw rejected();

  if (data.revoked_at) throw rejected();
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) throw rejected();

  /*
   * Fire-and-forget. `last_used_at` is for a human deciding whether a key is
   * still needed, and blocking every API request on a write to maintain it
   * would trade real latency for a field nobody reads in real time.
   */
  void db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: updateError }) => {
      if (updateError) logger.warn('api_key:last_used_failed', { keyId: data.id });
    });

  return {
    keyId: data.id,
    userId: data.user_id,
    scopes: (data.scopes ?? []) as Scope[],
  };
}

/** Raises 403 unless the principal holds the scope. */
export function requireScope(principal: ApiPrincipal, scope: Scope): void {
  if (!principal.scopes.includes(scope)) {
    // Naming the scope is safe and useful: the caller already knows which key
    // they used, and "you need write" is the difference between a fixable
    // integration and a support ticket.
    throw ApiError.forbidden(`This key does not have the "${scope}" scope.`);
  }
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    // Scoped to the owner, so a guessed id from another account does nothing.
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}
