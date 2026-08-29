export type PlanId = "free" | "starter" | "growth" | "agency" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPrice: number;
  credits: number;
  maxBrands: number;
  maxMembers: number;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", monthlyPrice: 0, credits: 100,
    maxBrands: 1, maxMembers: 1,
    features: ["Brand Brain", "Limited AI generation", "Content drafts"],
  },
  starter: {
    id: "starter", name: "Starter", monthlyPrice: 19, credits: 1000,
    maxBrands: 2, maxMembers: 3,
    features: ["AI content", "Product creatives", "Scheduling", "Analytics"],
  },
  growth: {
    id: "growth", name: "Growth", monthlyPrice: 49, credits: 5000,
    maxBrands: 5, maxMembers: 10,
    features: ["Automation", "Advanced analytics", "Optimization", "Team approvals"],
  },
  agency: {
    id: "agency", name: "Agency", monthlyPrice: 149, credits: 20000,
    maxBrands: 25, maxMembers: 50,
    features: ["Client workspaces", "White-label options", "Bulk operations", "Agency analytics"],
  },
  enterprise: {
    id: "enterprise", name: "Enterprise", monthlyPrice: 0, credits: 100000,
    maxBrands: 999, maxMembers: 999,
    features: ["Custom limits", "SSO", "Audit controls", "Priority support", "API"],
  },
};
