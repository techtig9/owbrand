import { describe, it, expect } from 'vitest';
import { safeRedirectPath, safeRedirectUrl, DEFAULT_REDIRECT } from '@/lib/security/redirect';

/**
 * Regression suite for the post-authentication OPEN REDIRECT.
 *
 * The OAuth callback used to do:
 *   NextResponse.redirect(new URL(searchParams.get('next'), req.url))
 *
 * `new URL('//evil.com', 'https://app.owbrand.ai/auth/callback')` resolves to
 * `https://evil.com/`, so an attacker could send a freshly-authenticated user
 * to a domain they control. Each payload below is a real bypass technique.
 */
describe('safeRedirectPath', () => {
  it('allows ordinary same-origin paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('/dashboard/brand-brain')).toBe('/dashboard/brand-brain');
    expect(safeRedirectPath('/dashboard?tab=voice')).toBe('/dashboard?tab=voice');
    expect(safeRedirectPath('/dashboard#section')).toBe('/dashboard#section');
    expect(safeRedirectPath('/a/b/c?x=1&y=2#z')).toBe('/a/b/c?x=1&y=2#z');
  });

  it('falls back when no destination is supplied', () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('   ')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects protocol-relative URLs (the original bypass)', () => {
    expect(safeRedirectPath('//evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('//evil.com/path')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('///evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('////evil.com')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects backslash variants that browsers normalise to //', () => {
    expect(safeRedirectPath('/\\evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('\\\\evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('/\\/evil.com')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects absolute URLs of any scheme', () => {
    expect(safeRedirectPath('https://evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('http://evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('javascript:alert(1)')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('data:text/html,<script>alert(1)</script>')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('vbscript:msgbox(1)')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects a scheme smuggled after a leading slash', () => {
    expect(safeRedirectPath('/javascript:alert(1)')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('/https://evil.com')).toBe(DEFAULT_REDIRECT);
  });

  it('strips control characters used to slip past naive parsers', () => {
    // A tab inside the scheme is ignored by browsers but defeats a plain
    // startsWith('javascript:') check.
    expect(safeRedirectPath('/\tjavascript:alert(1)')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('\n//evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('/\x00/evil.com')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('\r/\t/evil.com')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects relative paths that are not rooted', () => {
    expect(safeRedirectPath('dashboard')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('../admin')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('./x')).toBe(DEFAULT_REDIRECT);
  });

  it('honours a caller-supplied fallback', () => {
    expect(safeRedirectPath('//evil.com', '/login')).toBe('/login');
    expect(safeRedirectPath(null, '/signup')).toBe('/signup');
  });
});

describe('safeRedirectUrl', () => {
  const origin = 'https://app.owbrand.ai';

  it('builds an absolute URL on the expected origin', () => {
    expect(safeRedirectUrl('/dashboard', origin).toString()).toBe('https://app.owbrand.ai/dashboard');
  });

  it('never leaves the origin, whatever the input', () => {
    const payloads = [
      '//evil.com',
      'https://evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      '/javascript:alert(1)',
      '///evil.com/path',
    ];

    for (const payload of payloads) {
      const url = safeRedirectUrl(payload, origin);
      expect(url.origin, `payload ${JSON.stringify(payload)} escaped the origin`).toBe(origin);
    }
  });

  it('accepts a URL object as the origin', () => {
    const url = safeRedirectUrl('/dashboard', new URL('https://app.owbrand.ai/auth/callback'));
    expect(url.toString()).toBe('https://app.owbrand.ai/dashboard');
  });
});
