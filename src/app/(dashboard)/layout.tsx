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
    // `app-shell` opts the application out of the display face: spec section 3
    // asks for expressive marketing type and COMPACT application type, and one
    // editorial face for both is what made the dashboard read as a lifestyle
    // brand rather than a product.
    <div className="app-shell flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav userName={user.name} creditsRemaining={creditsRemaining} monthlyCredits={monthlyCredits} />
        {/*
          The skip link's target, and the page's main landmark. `min-w-0` on
          this column is what stops a wide table or chart forcing the whole
          shell to overflow horizontally — the flex default of `min-width:auto`
          refuses to shrink below content width.
        */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
