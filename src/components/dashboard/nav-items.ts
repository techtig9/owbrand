import {
  BarChart3,
  Brain,
  CalendarDays,
  CreditCard,
  FolderOpen,
  Globe2,
  LayoutDashboard,
  Link2,
  Megaphone,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react';

/**
 * The application navigation, per frontend spec section 4.
 *
 * The spec names its order: Overview / Brand / Products / Creative Studio /
 * Website / Campaigns / Calendar / Social / Analytics / AI Manager /
 * Approvals / Assets / Team / Billing / Settings.
 *
 * Kept as data rather than JSX so the same list drives the sidebar, the mobile
 * drawer and the command palette. Three hand-maintained copies is how a nav
 * item ends up reachable from one place and not another — which is exactly
 * what happened to Approvals before Phase 2.
 *
 * `href` must point at a route that EXISTS. An item whose page has not been
 * built is marked `planned`, rendered visibly disabled with a tooltip, and
 * excluded from the command palette — the alternative is a nav link to a 404,
 * which is worse than an honest "not yet".
 */

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: string;
  /** Search terms for the command palette beyond the label itself. */
  keywords?: string[];
  /** True when the destination page does not exist yet. */
  planned?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // --- Workspace ---
  {
    href: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    group: 'Workspace',
    keywords: ['home', 'dashboard', 'start'],
  },
  {
    href: '/dashboard/brand-brain',
    label: 'Brand',
    icon: Brain,
    group: 'Workspace',
    keywords: ['brand brain', 'positioning', 'voice', 'tone', 'audience', 'personas', 'facts'],
  },
  {
    href: '/dashboard/products',
    label: 'Products',
    icon: Package,
    group: 'Workspace',
    keywords: ['catalogue', 'catalog', 'sku', 'variants', 'product brain'],
  },
  {
    href: '/dashboard/ai-studio',
    label: 'Creative Studio',
    icon: Sparkles,
    group: 'Workspace',
    keywords: ['generate', 'copy', 'reel', 'photo', 'video', 'creative'],
  },
  {
    href: '/dashboard/website',
    label: 'Website',
    icon: Globe2,
    group: 'Workspace',
    keywords: ['site', 'pages', 'sections', 'builder', 'publish'],
  },

  // --- Marketing ---
  {
    href: '/dashboard/campaigns',
    label: 'Campaigns',
    icon: Megaphone,
    group: 'Marketing',
    keywords: ['campaign', 'plan', 'launch'],
  },
  {
    href: '/dashboard/scheduler',
    label: 'Calendar',
    icon: CalendarDays,
    group: 'Marketing',
    keywords: ['schedule', 'queue', 'calendar', 'posts', 'publishing'],
  },
  {
    href: '/dashboard/connections',
    label: 'Social',
    icon: Link2,
    group: 'Marketing',
    keywords: ['connections', 'instagram', 'facebook', 'accounts', 'oauth', 'connect'],
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: BarChart3,
    group: 'Marketing',
    keywords: ['insights', 'performance', 'metrics', 'reach', 'engagement', 'roas', 'attribution'],
  },
  {
    href: '/dashboard/analytics',
    label: 'AI Manager',
    icon: Wand2,
    group: 'Marketing',
    // Recommendations live on the analytics screen next to the evidence they
    // cite. A separate page would separate a recommendation from the numbers
    // that justify it, which is the one thing that must not happen.
    keywords: ['recommendations', 'ai manager', 'advice', 'optimise', 'optimize'],
  },

  // --- Governance ---
  {
    href: '/dashboard/approvals',
    label: 'Approvals',
    icon: ShieldCheck,
    group: 'Governance',
    keywords: ['review', 'factuality', 'approve', 'queue', 'blocked'],
  },
  {
    href: '/dashboard/projects',
    label: 'Assets',
    icon: FolderOpen,
    group: 'Governance',
    keywords: ['library', 'files', 'media', 'projects'],
  },
  {
    href: '/dashboard/profile',
    label: 'Team',
    icon: Users,
    group: 'Governance',
    keywords: ['members', 'workspace', 'invite', 'roles', 'profile'],
  },

  // --- Account ---
  {
    href: '/dashboard/billing',
    label: 'Billing',
    icon: CreditCard,
    group: 'Account',
    keywords: ['plan', 'invoice', 'subscription', 'credits', 'upgrade'],
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    group: 'Account',
    keywords: ['preferences', 'account', 'integrations', 'theme'],
  },
];

export const NAV_GROUPS = ['Workspace', 'Marketing', 'Governance', 'Account'] as const;

export function navItemsForGroup(group: string): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

/**
 * Whether a nav item is the active one.
 *
 * Exact match for `/dashboard` itself, prefix match otherwise. A naive
 * `startsWith` would light up Overview on every single page, because every
 * route begins with `/dashboard`.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
