import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Use in Server Components, Route Handlers, and Server Actions.
 * Reads/writes the auth cookie via Next's cookies() so sessions stay in sync
 * with Supabase Auth (email/password, Google OAuth, magic links).
 */
export function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component with no request context — safe to
          // ignore, middleware handles session refresh in that case.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // See note above.
        }
      },
    },
  });
}

/** Fetches the current authenticated user + their app-level role, or null. */
export async function getCurrentUser() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('users').select('role, name').eq('id', user.id).maybeSingle();

  return {
    id: user.id,
    email: user.email!,
    name: profile?.name ?? user.user_metadata?.full_name ?? user.email!.split('@')[0],
    role: (profile?.role as 'user' | 'admin') ?? 'user',
  };
}
