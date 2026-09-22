import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Use in Client Components. Reads the anon key only — safe to expose.
 *
 * Config comes from the validated env module rather than `process.env.X!`. The
 * `!` compiled to a runtime crash carrying supabase-js's own wording, which
 * lib/auth/auth-errors.ts could not classify — so a visitor on an
 * unconfigured deployment was told "Something went wrong. Please try again."
 * about a problem no amount of retrying could fix.
 */
export function supabaseBrowser() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
