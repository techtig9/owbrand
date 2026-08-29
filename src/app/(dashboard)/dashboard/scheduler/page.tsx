import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { EmptyState } from '@/components/dashboard/shared';

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-lavender-200 text-ink',
  published: 'bg-mint-100 text-ink',
  failed: 'bg-blush-100 text-ink',
  cancelled: 'bg-canvas-alt text-ink-faint',
};

export default async function SchedulerPage() {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, platform, scheduled_at, status, content_assets(type, caption)')
    .eq('user_id', user!.id)
    .order('scheduled_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Scheduler</h1>
        <p className="mt-1 text-sm text-ink-soft">Auto-post queued content to your connected accounts.</p>
      </div>

      {!posts?.length ? (
        <EmptyState
          title="Nothing scheduled"
          body="Generate an asset in the Content Studio, then queue it here to auto-publish at a chosen time."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 font-medium">Platform</th>
                <th className="px-5 py-3 font-medium">Scheduled for</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post: any) => (
                <tr key={post.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">{post.content_assets?.caption ?? post.content_assets?.type ?? '—'}</td>
                  <td className="px-5 py-3 capitalize text-ink-soft">{post.platform}</td>
                  <td className="px-5 py-3 text-ink-soft">{new Date(post.scheduled_at).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[post.status]}`}>
                      {post.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
