import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * Credential encryption.
 *
 * Every assertion here is about a way this could fail silently and hand an
 * attacker a working Meta token: falling back to plaintext when the key is
 * missing, accepting a tampered ciphertext, or decrypting a token that was
 * moved to a different account's row.
 *
 * The module reads the key at call time, so the tests set the env var and
 * re-import rather than importing once at the top.
 */

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

async function loadModule() {
  // Fresh module registry so `loadKey()` re-reads process.env.
  const mod = await import('@/lib/crypto/secret-box');
  return mod;
}

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a token', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const token = 'EAAG' + 'x'.repeat(180);
    const context = 'social_account:abc:access';

    const envelope = encryptSecret(token, context);
    expect(decryptSecret(envelope, context)).toBe(token);
  });

  it('does not contain the plaintext', async () => {
    const { encryptSecret } = await loadModule();
    const envelope = encryptSecret('super-secret-page-token', 'ctx');
    expect(envelope).not.toContain('super-secret-page-token');
    expect(envelope).not.toContain('secret-page');
  });

  it('produces a different ciphertext every time (fresh IV)', async () => {
    const { encryptSecret } = await loadModule();
    // GCM loses confidentiality outright if an IV is reused under one key, so
    // two encryptions of the same value must never match.
    const first = encryptSecret('same-token', 'ctx');
    const second = encryptSecret('same-token', 'ctx');
    expect(first).not.toBe(second);
  });

  it('carries a version prefix so the key can be rotated later', async () => {
    const { encryptSecret, isEncryptedEnvelope } = await loadModule();
    const envelope = encryptSecret('token', 'ctx');
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
  });

  it('rejects a tampered ciphertext instead of returning garbage', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const envelope = encryptSecret('token-value', 'ctx');
    const parts = envelope.split('.');

    // Flip a character in the ciphertext body.
    const body = parts[3];
    parts[3] = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);

    expect(() => decryptSecret(parts.join('.'), 'ctx')).toThrow(/could not decrypt/i);
  });

  it('rejects a swapped auth tag', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const a = encryptSecret('token-a', 'ctx').split('.');
    const b = encryptSecret('token-b', 'ctx').split('.');

    a[2] = b[2];
    expect(() => decryptSecret(a.join('.'), 'ctx')).toThrow();
  });

  it('refuses a ciphertext decrypted under the wrong context', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    // This is what stops a token row being copied to another account: the AAD
    // binds the ciphertext to the account it was issued for.
    const envelope = encryptSecret('token', 'social_account:aaa:access');
    expect(() => decryptSecret(envelope, 'social_account:bbb:access')).toThrow();
  });

  it('refuses a ciphertext decrypted under the wrong key', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const envelope = encryptSecret('token', 'ctx');

    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(envelope, 'ctx')).toThrow();
  });

  it('rejects a truncated envelope', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const envelope = encryptSecret('token', 'ctx');
    const truncated = envelope.split('.').slice(0, 3).join('.');
    expect(() => decryptSecret(truncated, 'ctx')).toThrow(/malformed/i);
  });

  it('rejects an unknown version', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const parts = encryptSecret('token', 'ctx').split('.');
    parts[0] = 'v9';
    expect(() => decryptSecret(parts.join('.'), 'ctx')).toThrow(/unsupported/i);
  });
});

describe('failing closed', () => {
  it('throws rather than storing plaintext when no key is configured', async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const { encryptSecret, isEncryptionConfigured } = await loadModule();

    expect(isEncryptionConfigured()).toBe(false);
    // The one behaviour that must never be a fallback.
    expect(() => encryptSecret('token', 'ctx')).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('rejects a key that is not 32 bytes', async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    const { encryptSecret, isEncryptionConfigured } = await loadModule();

    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret('token', 'ctx')).toThrow(/32 bytes/);
  });

  it('accepts a hex key as well as base64', async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const { encryptSecret, decryptSecret, isEncryptionConfigured } = await loadModule();

    expect(isEncryptionConfigured()).toBe(true);
    expect(decryptSecret(encryptSecret('token', 'ctx'), 'ctx')).toBe('token');
  });

  it('accepts base64url, which is what some secret managers emit', async () => {
    const key = randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    process.env.TOKEN_ENCRYPTION_KEY = key;
    const { encryptSecret, decryptSecret } = await loadModule();
    expect(decryptSecret(encryptSecret('token', 'ctx'), 'ctx')).toBe('token');
  });

  it('refuses to encrypt an empty secret', async () => {
    const { encryptSecret } = await loadModule();
    // An empty token means the OAuth exchange produced nothing usable; storing
    // it would create an account row that looks connected and is not.
    expect(() => encryptSecret('', 'ctx')).toThrow(/empty/i);
  });

  it('requires a context', async () => {
    const { encryptSecret } = await loadModule();
    expect(() => encryptSecret('token', '')).toThrow(/context/i);
  });
});

describe('secretsMatch', () => {
  it('matches identical secrets', async () => {
    const { secretsMatch } = await loadModule();
    expect(secretsMatch('shared-cron-secret', 'shared-cron-secret')).toBe(true);
  });

  it('rejects a different secret of the same length', async () => {
    const { secretsMatch } = await loadModule();
    expect(secretsMatch('aaaaaaaaaa', 'aaaaaaaaab')).toBe(false);
  });

  it('rejects a prefix', async () => {
    const { secretsMatch } = await loadModule();
    // The failure mode a naive startsWith or a truncated compare would allow.
    expect(secretsMatch('shared', 'shared-cron-secret')).toBe(false);
  });

  it('rejects empty or absent values instead of matching them', async () => {
    const { secretsMatch } = await loadModule();
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch(undefined, 'x')).toBe(false);
    expect(secretsMatch('x', null)).toBe(false);
    // Both absent must not be "equal" — that would make an unset CRON_SECRET
    // authorise every caller.
    expect(secretsMatch(null, undefined)).toBe(false);
  });
});

describe('socialTokenContext', () => {
  it('separates access from refresh for the same account', async () => {
    const { socialTokenContext } = await loadModule();
    expect(socialTokenContext('abc', 'access')).not.toBe(socialTokenContext('abc', 'refresh'));
  });

  it('separates accounts', async () => {
    const { socialTokenContext } = await loadModule();
    expect(socialTokenContext('abc', 'access')).not.toBe(socialTokenContext('abd', 'access'));
  });
});
