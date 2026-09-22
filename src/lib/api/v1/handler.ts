import 'server-only';
import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { authenticateApiKey, requireScope, type ApiPrincipal, type Scope } from '@/lib/api/v1/keys';

/**
 * The wrapper every /api/v1 route uses.
 *
 * Authentication, scope and rate limiting are applied HERE rather than in each
 * route, because a public API is exactly the surface where one route that
 * forgot a check is the whole problem. A route that wants to skip a check has
 * to not use this function, which is visible in review.
 *
 * Rate limiting is keyed on the KEY, not the user: an integration with two keys
 * gets two buckets, which is the behaviour someone running a staging and a
 * production integration expects, and it lets one misbehaving key be revoked
 * without taking the other down with it.
 */
export function v1Handler(
  route: string,
  scope: Scope,
  handler: (request: Request, principal: ApiPrincipal) => Promise<NextResponse>
) {
  return routeHandler(route, async (request: Request) => {
    const principal = await authenticateApiKey(request);
    requireScope(principal, scope);
    await enforceRateLimit('standard', `apikey:${principal.keyId}`);

    const response = await handler(request, principal);

    // Named so an integrator can pin against a version rather than discovering
    // a change from a broken parse.
    response.headers.set('X-OwBrand-API-Version', '1');
    return response;
  });
}

/**
 * Cursor pagination, keyed on created_at.
 *
 * Offset pagination is wrong for a feed that receives writes: a row inserted
 * between page 1 and page 2 shifts everything down, and the client sees one
 * item twice and misses another entirely. With a timestamp cursor, new rows
 * appear at the start where the client will see them next time, and a page
 * boundary cannot skip a row.
 */
export interface Page {
  limit: number;
  cursor: string | null;
}

export function readPage(request: Request, maxLimit = 100): Page {
  const params = new URL(request.url).searchParams;
  const raw = Number(params.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, maxLimit) : 25;
  const cursor = params.get('cursor');

  return {
    limit,
    // An unparseable cursor is ignored rather than raising: the likely cause is
    // a truncated URL, and starting from the beginning is a better answer than
    // a 400 an integrator has to debug.
    cursor: cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : null,
  };
}

/** The response shape every list endpoint returns. */
export function paginated<T extends { created_at: string }>(rows: T[], limit: number) {
  const hasMore = rows.length === limit;
  return {
    data: rows,
    // Null, not an empty string, when there is nothing more — so a client
    // looping `while (cursor)` terminates.
    nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].created_at : null,
  };
}
