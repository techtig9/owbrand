/**
 * How to behave on a deployment that is missing its Supabase credentials.
 *
 * Why this exists: `createServerClient()` throws when the URL or key is empty,
 * and middleware ran it on every matched request — so a deployment without
 * `NEXT_PUBLIC_SUPABASE_URL` returned 500 for the landing page, the login page
 * and `/api/ready` alike. The one endpoint whose job is to tell an operator
 * what is misconfigured was itself unreachable, which is the worst possible
 * failure mode for a first deploy.
 *
 * The fix is to degrade deliberately rather than crash, and the split matters:
 *
 *   - Public surfaces (marketing, auth screens, health endpoints) render. They
 *     do not need a session, and an operator needs them to diagnose the
 *     deployment.
 *   - Authenticated surfaces FAIL CLOSED. With no Supabase there is no session
 *     to verify, so `/dashboard` and `/admin` must not render — not even
 *     shell-only. They redirect to the login screen carrying a closed-set
 *     error code that explains the deployment is unconfigured.
 *
 * Note what this is NOT: it does not weaken authorization, and it does not let
 * an unconfigured deployment serve tenant data. There is no data to serve —
 * the database connection is the thing that is absent.
 */

export type UnconfiguredAction = 'render' | 'refuse';

/** Paths that require a signed-in user. */
export function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
}

/** Signed-in users are bounced away from these back into the app. */
export function isAuthOnlyPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup';
}

/**
 * What to do with `pathname` when Supabase is not configured.
 *
 * `refuse` for anything gated, `render` for everything else. API routes under
 * `/api` are allowed to render because each one resolves its own credentials
 * and returns its own honest error — `/api/ready` in particular is the
 * diagnostic an operator reaches for, and several routes are deliberately
 * public (webhooks, health).
 */
export function unconfiguredDeploymentAction(pathname: string): UnconfiguredAction {
  return isProtectedPath(pathname) ? 'refuse' : 'render';
}
