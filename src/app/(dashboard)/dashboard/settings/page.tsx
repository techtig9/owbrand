import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, connected_at')
    .eq('user_id', user!.id);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">Manage your account and connections.</p>
      </div>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Profile</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">Name</span>
            <input defaultValue={user!.name} className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">Email</span>
            <input defaultValue={user!.email} disabled className="w-full rounded-xl border border-line bg-canvas-alt px-4 py-2.5 text-sm text-ink-faint" />
          </label>
          <button type="button" className="btn-primary">
            Save changes
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Password</h2>
        <p className="mt-1 text-xs text-ink-soft">Use the &ldquo;forgot password&rdquo; flow to set a new one via email.</p>
        <a href="/forgot-password" className="btn-ghost mt-4 inline-flex">
          Send reset link
        </a>
      </section>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Connected social accounts</h2>
        <div className="mt-4 space-y-2">
          {['facebook', 'instagram'].map((platform) => {
            const connected = accounts?.find((a) => a.platform === platform);
            return (
              <div key={platform} className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
                <span className="text-sm capitalize text-ink">{platform}</span>
                {connected ? (
                  <span className="text-xs font-medium text-mint-600">Connected</span>
                ) : (
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs">
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-blush-300 bg-blush-50 p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Delete account</h2>
        <p className="mt-1 text-xs text-ink-soft">This permanently removes your brands, assets, and subscription.</p>
        <button type="button" className="mt-4 rounded-full border border-blush-500 px-5 py-2 text-xs font-semibold text-blush-700">
          Delete my account
        </button>
      </section>
    </div>
  );
}
