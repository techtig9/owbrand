import 'server-only';
import type { EmailProvider } from './types';
import { resendProvider } from './resend';
import { consoleProvider } from './console';

export type { EmailProvider, OutboundEmail, DeliveryResult } from './types';

/**
 * Provider selection.
 *
 * One place, checked at call time rather than at module load, so an operator
 * setting a key does not need a redeploy to take effect on a long-lived
 * server.
 *
 * Adding a provider means adding it to this list and implementing the
 * interface. The order is the preference order; the console provider is last
 * and always matches, so `activeProvider()` never returns undefined and no
 * caller has to handle that case.
 */
const PROVIDERS: EmailProvider[] = [resendProvider];

export function activeProvider(): EmailProvider {
  return PROVIDERS.find((provider) => provider.isConfigured()) ?? consoleProvider;
}

/** Whether mail can actually be delivered. Read by `/api/ready`. */
export function isEmailDeliverable(): boolean {
  return PROVIDERS.some((provider) => provider.isConfigured());
}
