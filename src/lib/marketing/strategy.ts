import type { CampaignBrief } from "@/lib/campaigns/types";

export interface MarketingRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  action: string;
  suggestedAsset: "post" | "reel" | "story" | "email" | "ad" | "none";
}

export function generateMarketingRecommendations(
  brief: CampaignBrief,
  metrics: Record<string, number> = {},
): MarketingRecommendation[] {
  const engagement = metrics.engagementRate ?? 0;
  const ctr = metrics.ctr ?? 0;
  const conversions = metrics.conversions ?? 0;

  const recommendations: MarketingRecommendation[] = [];

  if (engagement < 2) {
    recommendations.push({
      priority: "high",
      title: "Increase short-form video",
      reason: "Current engagement is below the baseline target.",
      action: "Create product demonstration and problem/solution reels.",
      suggestedAsset: "reel",
    });
  } else {
    recommendations.push({
      priority: "medium",
      title: "Scale the winning content format",
      reason: "Engagement is healthy.",
      action: "Create variations of your strongest recent format and hook.",
      suggestedAsset: "reel",
    });
  }

  if (ctr < 1) {
    recommendations.push({
      priority: "high",
      title: "Improve calls to action",
      reason: "Click-through performance is weak.",
      action: "Test clearer benefit-led headlines and stronger CTAs.",
      suggestedAsset: "ad",
    });
  }

  if (conversions === 0) {
    recommendations.push({
      priority: "medium",
      title: "Add conversion-focused content",
      reason: "No conversions were supplied for the selected period.",
      action: "Create proof, FAQ and objection-handling content before increasing spend.",
      suggestedAsset: "post",
    });
  }

  return recommendations;
}
