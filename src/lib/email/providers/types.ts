/**
 * The email provider interface.
 *
 * Every transactional mail in the product goes through this, so swapping
 * Resend for SES, Postmark or an SMTP relay is one file rather than a sweep
 * through every call site. That matters more than it looks: transactional
 * email is the integration most likely to be changed by something outside
 * anyone's control — a deliverability problem, a pricing change, a region
 * requirement — and a codebase that has `new Resend(...)` in twelve places
 * cannot respond to any of them quickly.
 *
 * The interface is deliberately small. Anything a specific provider does
 * better (templates, batching, scheduling) is not in here, because the moment
 * one provider's feature leaks into the interface it stops being an interface
 * and becomes that provider with extra steps.
 */

export interface OutboundEmail {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface DeliveryResult {
  ok: boolean;
  /** The provider's id for this message, when it gives one. */
  providerMessageId?: string;
  /** Safe to log. Never contains the recipient or the body. */
  reason?: string;
}

export interface EmailProvider {
  /** Short, stable identifier recorded against each send. */
  readonly id: string;
  /** Whether this provider has what it needs to actually send. */
  isConfigured(): boolean;
  send(email: OutboundEmail): Promise<DeliveryResult>;
}
