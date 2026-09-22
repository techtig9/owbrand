import 'server-only';
import { Resend } from 'resend';
import { serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { EmailProvider, OutboundEmail, DeliveryResult } from './types';

/**
 * Resend, behind the provider interface.
 *
 * The client is built lazily and cached, because constructing it reads
 * `RESEND_API_KEY` — and doing that at module scope makes importing this file
 * throw on a deployment with no email configured, which would take down every
 * route that transitively imports it.
 */
let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  if (!isConfigured.email()) {
    client = null;
    return null;
  }
  try {
    client = new Resend(serverEnv.resendApiKey);
  } catch (error) {
    logger.error('email:client_init_failed', error);
    client = null;
  }
  return client;
}

/** Exposed for tests, which need a fresh client per environment. */
export function resetResendClient(): void {
  client = undefined;
}

export const resendProvider: EmailProvider = {
  id: 'resend',

  isConfigured() {
    return isConfigured.email();
  },

  async send(email: OutboundEmail): Promise<DeliveryResult> {
    const resend = getClient();
    if (!resend) return { ok: false, reason: 'not_configured' };

    try {
      const response = await resend.emails.send({
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      });

      if (response.error) {
        // The provider's message, not the recipient or the body.
        return { ok: false, reason: response.error.message };
      }

      return { ok: true, providerMessageId: response.data?.id };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'send_failed' };
    }
  },
};
