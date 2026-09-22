import { describe, it, expect } from 'vitest';
import { signupNotification, signinNotification, escapeHtml } from '@/lib/email/templates';

const siteUrl = 'https://owbrand.test';

/**
 * The master command is explicit: "Do NOT email passwords, tokens, API keys, or
 * sensitive secrets." These tests enforce that structurally rather than by
 * review, so a future template change cannot quietly regress it.
 */
const SECRET_PATTERNS = [
  /password/i,
  /\btoken\b/i,
  /api[_-]?key/i,
  /secret/i,
  /service[_-]?role/i,
  /bearer /i,
  /sk_live/i,
  /eyJ[A-Za-z0-9_-]{10,}/, // JWT-shaped
];

/** "Reset your password" style copy is fine; a credential is not. */
const ALLOWED_PHRASES = [/reset your password/i, /new-password/i, /forgot-password/i];

function assertNoSecrets(content: string, label: string) {
  let scrubbed = content;
  for (const allowed of ALLOWED_PHRASES) scrubbed = scrubbed.replace(new RegExp(allowed, 'gi'), '');

  for (const pattern of SECRET_PATTERNS) {
    expect(pattern.test(scrubbed), `${label} matched forbidden pattern ${pattern}`).toBe(false);
  }
}

describe('signupNotification', () => {
  const content = signupNotification({ name: 'Alice', siteUrl });

  it('has a subject, HTML and a plain-text alternative', () => {
    expect(content.subject).toBeTruthy();
    expect(content.html).toContain('<!doctype html>');
    expect(content.text.length).toBeGreaterThan(50);
  });

  it('greets the recipient by name', () => {
    expect(content.html).toContain('Alice');
    expect(content.text).toContain('Alice');
  });

  it('works without a name', () => {
    const anonymous = signupNotification({ name: null, siteUrl });
    expect(anonymous.html).toContain('Welcome to OwBrand');
    expect(anonymous.html).not.toContain('null');
    expect(anonymous.html).not.toContain('undefined');
  });

  it('contains no credentials', () => {
    assertNoSecrets(content.html, 'signup html');
    assertNoSecrets(content.text, 'signup text');
  });

  it('links only to our own origin', () => {
    const hrefs = [...content.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith(siteUrl) || href.startsWith('mailto:'), `unexpected href ${href}`).toBe(true);
    }
  });

  it('uses inline styles rather than a <style> block, which mail clients strip', () => {
    expect(content.html).not.toMatch(/<style[\s>]/i);
    expect(content.html).toContain('style="');
  });
});

describe('signinNotification', () => {
  const at = new Date('2026-09-07T12:00:00Z');
  const content = signinNotification({
    name: 'Alice',
    method: 'google',
    at,
    device: 'Chrome on macOS',
    siteUrl,
  });

  it('states when and how, so the recipient can judge it', () => {
    expect(content.html).toContain(at.toUTCString());
    expect(content.html).toContain('google');
    expect(content.html).toContain('Chrome on macOS');
  });

  it('offers a recovery route', () => {
    expect(content.html).toContain('/forgot-password');
    expect(content.text).toContain('/forgot-password');
  });

  it('contains no credentials', () => {
    assertNoSecrets(content.html, 'signin html');
    assertNoSecrets(content.text, 'signin text');
  });

  it('omits the device row when unknown rather than printing null', () => {
    const noDevice = signinNotification({ name: null, method: 'email', at, device: null, siteUrl });
    expect(noDevice.html).not.toContain('null');
    expect(noDevice.html).not.toContain('undefined');
    expect(noDevice.html).not.toContain('Device');
  });

  it('never embeds an IP address', () => {
    // sendSigninNotification receives an IP for auditing but must not put it in
    // the body.
    expect(content.html).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('prevents HTML injection through a display name', () => {
    // A hostile full_name must not become markup in the email.
    const hostile = '<img src=x onerror=alert(1)>';
    const content = signupNotification({ name: hostile, siteUrl });
    expect(content.html).not.toContain('<img src=x');
    expect(content.html).toContain('&lt;img');
  });

  it('escapes ampersands before other entities, not after', () => {
    // Naive ordering produces &amp;lt; — check we did not double-encode.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});
