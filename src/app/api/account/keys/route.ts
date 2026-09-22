import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { issueApiKey, revokeApiKey, SCOPES } from '@/lib/api/v1/keys';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: boundedText(1, 60),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length).default(['read']),
});

const DeleteBody = z.object({ keyId: uuidSchema });

/** The key list. `key_hash` is never selected — the UI has no use for it. */
export const GET = routeHandler('/api/account/keys', async () => {
  const user = await requireUser();

  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return NextResponse.json({ keys: data ?? [] });
});

export const POST = routeHandler('/api/account/keys', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('billing', user.id);

  const { name, scopes } = await parseJsonBody(request, CreateBody);

  /*
   * A ceiling on live keys. Without one, a loop in an integration creates
   * thousands of rows, and a key list nobody can read is a key list nobody
   * audits — which is how a compromised key stays live.
   */
  const { count } = await supabaseAdmin()
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null);

  if ((count ?? 0) >= 10) {
    throw ApiError.conflict('You already have 10 active keys. Revoke one before creating another.');
  }

  const issued = await issueApiKey({ userId: user.id, name, scopes });

  logger.info('api_key:issued', { keyId: issued.id, scopes });

  return NextResponse.json({
    id: issued.id,
    prefix: issued.prefix,
    /*
     * The only time this value exists outside the caller's memory. It is not
     * logged, not stored, and cannot be shown again — the database holds a
     * hash. The UI says so before the dialog can be closed.
     */
    key: issued.key,
  });
});

export const DELETE = routeHandler('/api/account/keys', async (request: Request) => {
  const user = await requireUser();
  const { keyId } = await parseJsonBody(request, DeleteBody);

  const revoked = await revokeApiKey(user.id, keyId);
  // Same answer whether the key belonged to someone else or was already
  // revoked: a 404 that distinguishes them confirms which ids exist.
  if (!revoked) throw ApiError.notFound('No such active key.');

  logger.info('api_key:revoked', { keyId });
  return NextResponse.json({ revoked: true });
});
