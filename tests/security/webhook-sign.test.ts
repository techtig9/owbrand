import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature, generateWebhookSecret } from '@/lib/webhooks/sign';

const SECRET = 'whsec_test_secret_value';
const BODY = JSON.stringify({ event: 'post.published', id: 'abc' });

describe('signing', () => {
  it('verifies its own signature', () => {
    const header = signPayload(BODY, SECRET);
    expect(verifySignature({ body: BODY, header, secret: SECRET }).valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = signPayload(BODY, SECRET);
    const result = verifySignature({ body: BODY.replace('abc', 'xyz'), header, secret: SECRET });
    expect(result.valid).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const header = signPayload(BODY, SECRET);
    expect(verifySignature({ body: BODY, header, secret: 'whsec_other' }).valid).toBe(false);
  });
});

describe('replay protection', () => {
  it('rejects a signature that is too old', () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    const header = signPayload(BODY, SECRET, old);
    const result = verifySignature({ body: BODY, header, secret: SECRET });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tolerance/);
  });

  it('rejects a signature from the FUTURE', () => {
    // The check that is usually missing. A receiver that only rejects old
    // timestamps accepts one dated 3000, which never expires — turning a
    // five-minute replay window into a permanent one.
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const header = signPayload(BODY, SECRET, future);
    expect(verifySignature({ body: BODY, header, secret: SECRET }).valid).toBe(false);
  });

  it('cannot have its timestamp edited to refresh it', () => {
    // The timestamp is inside the MAC, so changing it invalidates the
    // signature. If it were merely beside the MAC, a captured delivery could
    // be replayed indefinitely by bumping `t`.
    const old = Math.floor(Date.now() / 1000) - 600;
    const header = signPayload(BODY, SECRET, old);
    const refreshed = header.replace(/^t=\d+/, `t=${Math.floor(Date.now() / 1000)}`);
    const result = verifySignature({ body: BODY, header: refreshed, secret: SECRET });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/);
  });

  it('accepts a signature inside the tolerance window', () => {
    // A positive control: without it, a verifier that rejected everything
    // would pass every test above.
    const recent = Math.floor(Date.now() / 1000) - 60;
    const header = signPayload(BODY, SECRET, recent);
    expect(verifySignature({ body: BODY, header, secret: SECRET }).valid).toBe(true);
  });
});

describe('malformed input', () => {
  it.each([
    ['empty', ''],
    ['no timestamp', 'v1=deadbeef'],
    ['no signature', 't=1700000000'],
    ['garbage', 'not-a-signature'],
    ['non-numeric timestamp', 't=yesterday,v1=deadbeef'],
  ])('rejects %s', (_label, header) => {
    expect(verifySignature({ body: BODY, header, secret: SECRET }).valid).toBe(false);
  });

  it('does not throw on a signature of the wrong length', () => {
    // timingSafeEqual throws on mismatched lengths, so this must be handled
    // before the comparison or a malformed header becomes a 500.
    expect(() => verifySignature({ body: BODY, header: 't=1,v1=ab', secret: SECRET })).not.toThrow();
  });
});

describe('secrets', () => {
  it('generates a recognisable, unique secret', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(50);
    expect([...secrets][0]).toMatch(/^whsec_[A-Za-z0-9_-]{30,}$/);
  });
});
