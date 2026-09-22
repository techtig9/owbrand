import 'server-only';
import { logger } from '@/lib/logger';
import type { EmailProvider, OutboundEmail, DeliveryResult } from './types';

/**
 * The fallback when no provider is configured.
 *
 * It reports `ok: false` with an explicit reason rather than pretending to
 * succeed. A no-op provider that returns success is how a deployment runs for
 * a month believing it is sending password resets — the metric says 100%
 * delivered and not one mail was ever sent.
 *
 * What it does do is log the subject and the template, which makes local
 * development workable: you can see that the mail would have gone, and to
 * which template, without a key.
 *
 * The recipient is logged as a domain only. The privacy page states log lines
 * are written without customer content, and an email address is customer
 * content.
 */
export const consoleProvider: EmailProvider = {
  id: 'console',

  isConfigured() {
    // Honest: this provider cannot deliver anything. `/api/ready` reads this
    // and reports email as unconfigured rather than as working.
    return false;
  },

  async send(email: OutboundEmail): Promise<DeliveryResult> {
    logger.info('email:not_sent', {
      subject: email.subject,
      recipientDomain: email.to.split('@')[1] ?? 'unknown',
      reason: 'no email provider configured',
    });
    return { ok: false, reason: 'no_provider_configured' };
  },
};
