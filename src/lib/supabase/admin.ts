import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client — SERVER-ONLY, never import this from a Client Component
 * or anything bundled to the browser. Bypasses Row Level Security.
 *
 * Used for: credit deduction (canUseFeature), Paddle webhook writes, and the
 * admin panel's cross-user reads. Every call site is expected to have already
 * authorized the request itself (session check + role check).
 */
export function supabaseAdmin() {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseAdmin() must never be called from client-side code.');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
