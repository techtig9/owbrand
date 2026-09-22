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
import { serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { EmailContent } from '@/lib/email/templates';
import { activeProvider } from '@/lib/email/providers';

/**
 * Every transactional mail the product sends.
 *
 * A closed union rather than a string: it makes the email_logs table
 * groupable, and it means adding a mail is a deliberate act that shows up in
 * a diff rather than a new literal appearing in one call site.
 */
export type EmailTemplateName =
  | 'signup_notification'
  | 'signin_notification'
  | 'publish_failed'
  | 'credits_low'
  | 'webhook_disabled'
  | 'account_deleted'
  | 'contact_message';

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

  /*
   * Through the provider registry rather than a hard-coded client.
   *
   * Transactional email is the integration most likely to be changed by
   * something outside anyone's control — a deliverability problem, a pricing
   * change, a data-residency requirement. A codebase with `new Resend(...)` in
   * a dozen places cannot respond to any of those quickly. See
   * `lib/email/providers/` for the interface and why it is deliberately small.
   */
  const provider = activeProvider();

  if (!provider.isConfigured()) {
    // 'skipped', never 'sent'. A no-op provider reporting success is how a
    // deployment runs for a month believing it sends password resets.
    logger.warn('email:not_configured', { template, provider: provider.id });
    return finish({ status: 'skipped', reason: 'no_provider_configured' });
  }

  const result = await provider.send({
    to,
    from: serverEnv.emailFrom,
    subject: content.subject,
    html: content.html,
    text: content.text,
    ...(serverEnv.emailReplyTo ? { replyTo: serverEnv.emailReplyTo } : {}),
  });

  if (!result.ok) {
    logger.error('email:send_failed', new Error(result.reason ?? 'send failed'), {
      template,
      userId,
      provider: provider.id,
    });
    return finish({ status: 'failed', reason: truncate(result.reason ?? 'send failed') });
  }

  logger.info('email:sent', {
    template,
    userId,
    provider: provider.id,
    providerMessageId: result.providerMessageId,
  });
  return finish({ status: 'sent', providerMessageId: result.providerMessageId });

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
