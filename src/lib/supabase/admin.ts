import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

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
  /*
   * Read through the validated env module, not `process.env.X!`.
   *
   * The `!` this replaces silenced TypeScript and produced, at runtime,
   * supabase-js's own "Your project's URL and Key are required to create a
   * Supabase client!" — a third-party message with no request id, no route,
   * and nothing to say about which variable was missing. Every gated route on
   * a deployment without credentials answered a generic 500 built from it.
   */
  return createClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
