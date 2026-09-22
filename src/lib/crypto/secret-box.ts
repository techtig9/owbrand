import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Application-layer encryption for provider credentials.
 *
 * The master command requires that provider tokens are never stored as
 * plaintext where application-layer encryption is available. Today
 * `social_accounts.access_token` is a plain text column holding the string
 * `placeholder_token_for_<code>` — so there is nothing to protect yet, but the
 * moment real OAuth lands there would be long-lived Meta Page tokens sitting
 * in a table the service-role key can read wholesale. A leaked database dump
 * or an over-broad admin query would hand an attacker the ability to post as
 * every connected brand.
 *
 * Design:
 *   - AES-256-GCM. Authenticated, so tampering is detected rather than
 *     producing garbage plaintext that later code might act on.
 *   - A random 12-byte IV per encryption. Never reused: GCM catastrophically
 *     loses confidentiality on IV reuse under the same key.
 *   - A version prefix on the envelope, so the key or algorithm can be rotated
 *     without guessing how existing rows were written.
 *   - Additional authenticated data binds the ciphertext to its purpose (e.g.
 *     "social_token:<accountId>"), so a token moved between rows fails to
 *     decrypt instead of silently authorising the wrong account.
 *   - FAILS CLOSED. With no key configured, `encryptSecret` throws rather than
 *     falling back to plaintext. Storing a credential unencrypted because the
 *     operator forgot a variable is exactly the outcome this module exists to
 *     prevent.
 */

/** Envelope format: v1.<iv>.<authTag>.<ciphertext>, all base64url. */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

/**
 * Loads and validates the master key.
 *
 * Accepts base64, base64url or hex so an operator can paste whatever
 * `openssl rand` gave them, but insists on exactly 32 decoded bytes: a short
 * key silently weakens every ciphertext written with it.
 */
function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new SecretCryptoError(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`. ' +
        'Provider tokens are never stored unencrypted, so this is required before connecting an account.'
    );
  }

  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      `TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${decoded.length}). ` +
        'Generate one with `openssl rand -base64 32`.'
    );
  }

  return decoded;
}

/** True when a usable key is configured. For honest capability reporting only. */
export function isEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

function b64u(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Encrypts a secret.
 *
 * `context` is bound into the ciphertext as additional authenticated data.
 * Pass something that identifies where this value belongs — the decrypt call
 * must supply the same string, so a ciphertext copied into a different row
 * cannot be decrypted there.
 */
export function encryptSecret(plaintext: string, context: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new SecretCryptoError('Refusing to encrypt an empty secret.');
  }
  if (!context) {
    throw new SecretCryptoError('An encryption context is required.');
  }

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, b64u(iv), b64u(authTag), b64u(ciphertext)].join('.');
}

/**
 * Decrypts a secret written by `encryptSecret`.
 *
 * Throws on any failure — wrong key, wrong context, truncated envelope,
 * tampered ciphertext. Callers must treat a throw as "this credential is
 * unusable", never as "assume plaintext".
 */
export function decryptSecret(envelope: string, context: string): string {
  if (!envelope || typeof envelope !== 'string') {
    throw new SecretCryptoError('No ciphertext supplied.');
  }

  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new SecretCryptoError('Malformed ciphertext envelope.');
  }

  const [version, ivPart, tagPart, dataPart] = parts;
  if (version !== VERSION) {
    throw new SecretCryptoError(`Unsupported ciphertext version "${version}".`);
  }

  const iv = fromB64u(ivPart);
  const authTag = fromB64u(tagPart);
  const ciphertext = fromB64u(dataPart);

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new SecretCryptoError('Malformed ciphertext envelope.');
  }

  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately opaque: distinguishing "wrong key" from "tampered" would
    // tell an attacker which of the two they achieved.
    throw new SecretCryptoError('Could not decrypt the stored credential. It may have been tampered with, or the encryption key has changed.');
  }
}

/** Recognises an envelope this module produced, without attempting to decrypt. */
export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split('.');
  return parts.length === 4 && parts[0] === VERSION;
}

/**
 * Constant-time comparison for shared secrets (cron tokens, webhook keys).
 *
 * `a === b` on a secret leaks its prefix through timing. Lengths are compared
 * first because `timingSafeEqual` throws on a length mismatch — that leak is
 * unavoidable and harmless, since the length of a shared secret is not the
 * secret.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** The context string for a stored provider credential. */
export function socialTokenContext(accountId: string, kind: 'access' | 'refresh'): string {
  return `social_account:${accountId}:${kind}`;
}
