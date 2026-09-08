import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit, clientIp } from '@/lib/security/rate-limit';
import { sendAuthEventNotification } from '@/lib/email/notifications';
import { logger } from '@/lib/logger';

/**
 * Records a completed authentication and sends the matching notification.
 *
 * Called by the login and signup pages once Supabase has established a session.
 * Deliberately takes NO request body: the recipient is derived from the server
 * session, so this endpoint cannot be used to send mail to an arbitrary
 * address. It is also rate limited and always returns 200-shaped success —
 * an email problem must never surface as a failed login.
 */
export const POST = routeHandler('/api/auth/session-event', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('auth', user.id);

  const result = await sendAuthEventNotification({
    userId: user.id,
    email: user.email,
    name: user.name,
    method: 'email',
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  }).catch((error) => {
    logger.error('session_event:notification_failed', error, { userId: user.id });
    return null;
  });

  return NextResponse.json({
    ok: true,
    notification: result ? { kind: result.kind, status: result.status } : null,
  });
});
