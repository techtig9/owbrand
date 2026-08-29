import type { PlanId } from '@/types';

export interface PlanDefinition {
  id: PlanId;
  label: string;
  priceMonthly: number;
  priceYearly: number;
  launchDiscountPct: number; // first-month-only discount
  monthlyCredits: number;
  features: {
    fullStackWebsite: boolean;
    generateFromUrl: boolean;
    aiWebsiteEditing: boolean;
    contentStudio: boolean;
    autoPostScheduler: boolean;
    reelsGenerator: boolean;
    voiceAssistant: boolean;
    zipExport: boolean;
    deployVercel: boolean;
    deployNetlify: boolean;
    priorityGeneration: boolean;
  };
  limits: {
    connectedSocialAccounts: number; // -1 = unlimited
    templates: number; // -1 = all
    themes: number; // -1 = unlimited
    customDomains: number;
    versionHistory: number; // -1 = unlimited
  };
  support: 'Community' | 'Email' | 'Priority' | '24/7 Priority';
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    label: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    launchDiscountPct: 0,
    monthlyCredits: 500,
    features: {
      fullStackWebsite: false,
      generateFromUrl: false,
      aiWebsiteEditing: false,
      contentStudio: false,
      autoPostScheduler: false,
      reelsGenerator: false,
      voiceAssistant: false,
      zipExport: false,
      deployVercel: false,
      deployNetlify: false,
      priorityGeneration: false,
    },
    limits: { connectedSocialAccounts: 0, templates: 5, themes: 5, customDomains: 0, versionHistory: 0 },
    support: 'Community',
  },
  starter: {
    id: 'starter',
    label: 'Starter',
    priceMonthly: 12,
    priceYearly: 129,
    launchDiscountPct: 10,
    monthlyCredits: 10000,
    features: {
      fullStackWebsite: true,
      generateFromUrl: true,
      aiWebsiteEditing: true,
      contentStudio: true,
      autoPostScheduler: true,
      reelsGenerator: true,
      voiceAssistant: true,
      zipExport: true,
      deployVercel: true,
      deployNetlify: true,
      priorityGeneration: false,
    },
    limits: { connectedSocialAccounts: 1, templates: 100, themes: 30, customDomains: 1, versionHistory: 5 },
    support: 'Email',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    priceMonthly: 24,
    priceYearly: 259,
    launchDiscountPct: 15,
    monthlyCredits: 30000,
    features: {
      fullStackWebsite: true,
      generateFromUrl: true,
      aiWebsiteEditing: true,
      contentStudio: true,
      autoPostScheduler: true,
      reelsGenerator: true,
      voiceAssistant: true,
      zipExport: true,
      deployVercel: true,
      deployNetlify: true,
      priorityGeneration: true,
    },
    limits: { connectedSocialAccounts: 3, templates: 300, themes: 100, customDomains: 5, versionHistory: 25 },
    support: 'Priority',
  },
  business: {
    id: 'business',
    label: 'Business',
    priceMonthly: 49,
    priceYearly: 529,
    launchDiscountPct: 20,
    monthlyCredits: 75000,
    features: {
      fullStackWebsite: true,
      generateFromUrl: true,
      aiWebsiteEditing: true,
      contentStudio: true,
      autoPostScheduler: true,
      reelsGenerator: true,
      voiceAssistant: true,
      zipExport: true,
      deployVercel: true,
      deployNetlify: true,
      priorityGeneration: true,
    },
    limits: { connectedSocialAccounts: -1, templates: -1, themes: -1, customDomains: -1, versionHistory: -1 },
    support: '24/7 Priority',
  },
};

export function launchPrice(plan: PlanDefinition): number {
  return Math.round(plan.priceMonthly * (1 - plan.launchDiscountPct / 100) * 100) / 100;
}
