import { describe, expect, it } from 'vitest';
import {
  isAuthOnlyPath,
  isProtectedPath,
  unconfiguredDeploymentAction,
} from '@/lib/security/deployment-guard';
import { toFriendlyAuthError, callbackErrorMessage } from '@/lib/auth/auth-errors';

/**
 * These tests exist because the failure they describe took down an entire
 * deployment: with no Supabase credentials, middleware's createServerClient()
 * threw on every matched request, so even /api/ready — the endpoint whose only
 * job is to say what is misconfigured — returned 500.
 *
 * The property that matters is not "it does not crash". It is that degrading
 * does not open a gate: an unconfigured deployment must still refuse every
 * authenticated surface.
 */
describe('unconfigured deployment behaviour', () => {
  it('refuses every authenticated surface', () => {
    for (const path of [
      '/dashboard',
      '/dashboard/analytics',
      '/dashboard/settings',
      '/admin',
      '/admin/users',
      '/admin/payments',
    ]) {
      expect(unconfiguredDeploymentAction(path), path).toBe('refuse');
    }
  });

  it('renders the public surfaces an operator needs to diagnose the deployment', () => {
    for (const path of ['/', '/pricing', '/login', '/signup', '/api/ready', '/api/health']) {
      expect(unconfiguredDeploymentAction(path), path).toBe('render');
    }
  });

  /*
   * A positive control. Without this, `unconfiguredDeploymentAction` returning
   * a constant 'refuse' would satisfy the first test and a constant 'render'
   * would satisfy the second — but nothing above proves it DISCRIMINATES.
   */
  it('discriminates rather than answering the same way for everything', () => {
    const answers = new Set([
      unconfiguredDeploymentAction('/'),
      unconfiguredDeploymentAction('/dashboard'),
    ]);
    expect(answers.size).toBe(2);
  });

  /*
   * The prefix must not be matchable by a lookalike path. `/dashboardish` is
   * not a dashboard route, but a naive `includes()` would treat it as one; the
   * inverse mistake — a path that IS gated slipping through as public — is the
   * one that matters, so both directions are asserted.
   */
  it('anchors the protected prefixes at the start of the path', () => {
    expect(isProtectedPath('/dashboard')).toBe(true);
    expect(isProtectedPath('/dashboard/brand/123')).toBe(true);
    expect(isProtectedPath('/admin')).toBe(true);
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/pricing')).toBe(false);
    expect(isProtectedPath('/blog/dashboard-tour')).toBe(false);
  });

  it('treats only the two credential screens as auth-only', () => {
    expect(isAuthOnlyPath('/login')).toBe(true);
    expect(isAuthOnlyPath('/signup')).toBe(true);
    // Password reset is NOT auth-only: a signed-in user may legitimately be
    // completing a reset link, and bouncing them to /dashboard strands them.
    expect(isAuthOnlyPath('/forgot-password')).toBe(false);
    expect(isAuthOnlyPath('/reset-password')).toBe(false);
    expect(isAuthOnlyPath('/login/help')).toBe(false);
  });
});

describe('the not_configured message', () => {
  it('is reachable from the middleware redirect code', () => {
    const message = callbackErrorMessage('not_configured');
    expect(message).toBeTruthy();
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('maps a thrown MissingEnvError to the operator message, not "try again"', () => {
    const thrown = new Error('Missing required environment variable NEXT_PUBLIC_SUPABASE_URL.');
    const friendly = toFriendlyAuthError(thrown);

    expect(friendly.code).toBe('not_configured');
    // The failing assertion of the old behaviour: a visitor was told to retry
    // something that could never succeed.
    expect(friendly.message).not.toBe('Something went wrong. Please try again.');
  });

  it('still returns the generic message for a genuinely unknown failure', () => {
    expect(toFriendlyAuthError(new Error('socket hang up')).code).toBe('unknown');
  });
});
