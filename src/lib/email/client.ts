/**
 * Resend transport.
 *
 * Guarantees:
 *  - Server-only. The API key is never referenced from a client bundle.
 *  - Never throws at import time; a missing key surfaces as a skipped send with
 *    a logged reason, so authentication continues to work on an install that
 *    has not configured email yet.
 *  - Every attempt is written to `email_logs` (recipient, template, outcome,
 *    provider message id) so delivery is auditable. Bodies are never stored.
 */
import { Resend } from 'resend';
import { serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { EmailContent } from '@/lib/email/templates';

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

export type EmailTemplateName = 'signup_notification' | 'signin_notification';

export type EmailSendStatus = 'sent' | 'failed' | 'skipped';

export interface SendEmailResult {
  status: EmailSendStatus;
  providerMessageId?: string;
  reason?: string;
}

export interface SendEmailOptions {
  to: string;
  template: EmailTemplateName;
  content: EmailContent;
  userId?: string | null;
  /** Extra non-sensitive context for the audit row. */
  metadata?: Record<string, unknown>;
}

/**
 * Sends one transactional email and records the attempt.
 * NEVER throws — callers are on user-facing paths where a mail failure must not
 * become a login failure.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, template, content, userId, metadata } = options;

  if (!serverEnv.emailNotificationsEnabled) {
    return finish({ status: 'skipped', reason: 'notifications_disabled' });
  }

  if (!isValidEmail(to)) {
    return finish({ status: 'skipped', reason: 'invalid_recipient' });
  }

  const resend = getClient();
  if (!resend) {
    logger.warn('email:not_configured', { template });
    return finish({ status: 'skipped', reason: 'resend_not_configured' });
  }

  try {
    const { data, error } = await resend.emails.send({
      from: serverEnv.emailFrom,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(serverEnv.emailReplyTo ? { replyTo: serverEnv.emailReplyTo } : {}),
      headers: {
        // Group by template so a provider-side bounce is attributable.
        'X-Entity-Ref-ID': `${template}:${userId ?? 'anonymous'}`,
      },
    });

    if (error) {
      logger.error('email:send_failed', error, { template, userId });
      return finish({ status: 'failed', reason: truncate(error.message) });
    }

    logger.info('email:sent', { template, userId, providerMessageId: data?.id });
    return finish({ status: 'sent', providerMessageId: data?.id });
  } catch (error) {
    logger.error('email:send_threw', error, { template, userId });
    return finish({ status: 'failed', reason: truncate(String(error)) });
  }

  async function finish(result: SendEmailResult): Promise<SendEmailResult> {
    await recordAttempt({ to, template, userId, metadata, result });
    return result;
  }
}

/**
 * Writes the audit row. Failures here are logged and swallowed: an email that
 * was actually delivered must not be reported as failed because the log insert
 * did not land, and vice versa.
 */
async function recordAttempt(entry: {
  to: string;
  template: EmailTemplateName;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  result: SendEmailResult;
}): Promise<void> {
  try {
    const db = supabaseAdmin();
    await db.from('email_logs').insert({
      user_id: entry.userId ?? null,
      recipient: entry.to,
      template: entry.template,
      status: entry.result.status,
      provider: 'resend',
      provider_message_id: entry.result.providerMessageId ?? null,
      error: entry.result.reason ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    logger.warn('email:log_write_failed', { template: entry.template, error: String(error) });
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
