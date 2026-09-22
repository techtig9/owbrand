import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Superseded by `DELETE /api/social/accounts`.
 *
 * The old route deleted a `social_accounts` row by `(user_id, platform)` and
 * did nothing else: no provider-side revocation, so the app kept its granted
 * permissions at Meta indefinitely, and no audit record of the disconnect.
 *
 * Kept as an explicit 410 rather than removed outright because a deployed
 * client may still call it, and a silent 404 would look like the disconnect
 * had worked.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has moved. Use DELETE /api/social/accounts with { accountId }.',
      code: 'endpoint_removed',
    },
    { status: 410 }
  );
}
