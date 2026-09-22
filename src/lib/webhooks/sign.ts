import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Webhook signatures.
 *
 * The scheme is deliberately the one Stripe and GitHub use, because an
 * integrator has almost certainly implemented it before and a novel scheme
 * means novel mistakes in every receiver.
 *
 *   X-OwBrand-Signature: t=<unix seconds>,v1=<hex hmac>
 *
 * The signed string is `${timestamp}.${body}` — **the timestamp is inside the
 * MAC, not beside it.** A signature over the body alone can be replayed
 * forever: an attacker who captures one valid delivery can resend it any
 * number of times and every copy verifies. Binding the timestamp into the MAC
 * means a replay can be rejected by age without the attacker being able to
 * update the timestamp.
 */

const VERSION = 'v1';

/** Signatures older than this are stale. Five minutes covers clock skew and a slow receiver. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function generateWebhookSecret(): string {
  // `whsec_` so it is recognisable in a receiver's configuration and greppable
  // if it ever ends up somewhere it should not be.
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function signPayload(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},${VERSION}=${mac}`;
}

/**
 * Verifies a signature. Exported so the docs can point at a reference
 * implementation that is the same code we sign with, rather than pseudocode
 * in a documentation page that drifts.
 */
export function verifySignature(input: {
  body: string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): { valid: boolean; reason?: string } {
  const parts = Object.fromEntries(
    input.header.split(',').map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    })
  );

  const timestamp = Number(parts.t);
  const presented = parts[VERSION];

  if (!Number.isFinite(timestamp) || !presented) return { valid: false, reason: 'malformed signature header' };

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  /*
   * Age is checked in BOTH directions. A receiver that only rejects old
   * timestamps accepts one from the year 3000, which never expires — turning
   * the replay window from five minutes into forever.
   */
  if (Math.abs(now - timestamp) > tolerance) return { valid: false, reason: 'timestamp outside tolerance' };

  const expected = Buffer.from(
    createHmac('sha256', input.secret).update(`${timestamp}.${input.body}`).digest('hex'),
    'utf8'
  );
  const actual = Buffer.from(presented, 'utf8');

  // Length is compared first because timingSafeEqual throws on a mismatch —
  // and the length of a hex digest is not a secret.
  if (expected.length !== actual.length) return { valid: false, reason: 'signature mismatch' };
  if (!timingSafeEqual(expected, actual)) return { valid: false, reason: 'signature mismatch' };

  return { valid: true };
}
