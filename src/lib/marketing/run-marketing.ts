import { build30DayCalendar } from "@/lib/marketing/calendar";
import { generateMarketingRecommendations } from "@/lib/marketing/strategy";

export interface RunMarketingInput {
  brandId: string;
  platforms: string[];
  primaryProduct?: string;
  metrics?: Record<string, number>;
  campaign?: {
    name: string;
    goal: "awareness" | "engagement" | "traffic" | "leads" | "sales" | "launch" | "retention";
  };
}

/**
 * Server-side orchestration plan for "Run My Marketing".
 * It creates an explainable action plan first. Execution remains behind
 * approval/automation controls and the Phase 3 publishing queue.
 */
export function buildMarketingRun(input: RunMarketingInput) {
  const calendar = build30DayCalendar(input.platforms, input.primaryProduct);
  const recommendations = generateMarketingRecommendations(
    {
      brandId: input.brandId,
      name: input.campaign?.name ?? "AI Marketing",
      goal: input.campaign?.goal ?? "engagement",
      productIds: [],
      platforms: input.platforms,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    },
    input.metrics ?? {},
  );

  return {
    mode: "plan_first",
    requiresApproval: true,
    calendar,
    recommendations,
    actions: [
      "prepare_content_briefs",
      "generate_approved_assets",
      "create_social_drafts",
      "schedule_approved_posts",
      "collect_metrics",
      "generate_recommendations",
    ],
  };
}
