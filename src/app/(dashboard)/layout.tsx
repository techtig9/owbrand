import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { TopNav } from '@/components/dashboard/TopNav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let creditsRemaining = 500;
  let monthlyCredits = 500;

  if (user.role === 'admin') {
    creditsRemaining = -1;
    monthlyCredits = -1;
  } else {
    const supabase = supabaseAdmin();
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan, credits_remaining')
      .eq('user_id', user.id)
      .maybeSingle();
    const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';
    creditsRemaining = subscription?.credits_remaining ?? PLANS.free.monthlyCredits;
    monthlyCredits = PLANS[plan].monthlyCredits;
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopNav userName={user.name} creditsRemaining={creditsRemaining} monthlyCredits={monthlyCredits} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
