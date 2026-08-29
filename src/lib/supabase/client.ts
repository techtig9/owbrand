import { createBrowserClient } from '@supabase/ssr';

/** Use in Client Components. Reads the anon key only — safe to expose. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
