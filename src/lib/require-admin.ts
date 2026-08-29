import { getCurrentUser } from '@/lib/supabase/server';

/** Every /api/admin/* route calls this first. Returns the user, or throws a 403-ready response. */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return { user: null, error: 'Admin access required.' as const };
  }
  return { user, error: null };
}
