import type { CampaignBrief, CampaignPlan } from "./types";

/**
 * Deterministic fallback campaign planner.
 * Replace/enrich with the Brand Brain AI orchestrator in production.
 */
export function buildCampaignPlan(brief: CampaignBrief): CampaignPlan {
  const isLaunch = brief.goal === "launch";
  return {
    strategy: isLaunch
      ? "Build anticipation, introduce the product, demonstrate value, then convert interested audiences."
      : "Use a repeatable education → product value → proof → CTA content sequence.",
    contentPillars: [
      "Education",
      "Product value",
      "Social proof",
      "Behind the scenes",
      "Community",
      "Conversion",
    ],
    recommendedAssets: [
      { type: "post", quantity: 4, purpose: "Core brand/product communication" },
      { type: "reel", quantity: 3, purpose: "Reach and product demonstration" },
      { type: "story", quantity: 7, purpose: "Daily engagement and reminders" },
      { type: "email", quantity: 2, purpose: "Owned-audience conversion" },
      { type: "ad", quantity: 3, purpose: "Creative testing" },
    ],
    publishingCadence: brief.platforms.map((platform, i) => ({
      platform,
      dayOffset: i % 3,
      format: i % 2 === 0 ? "reel" : "post",
      purpose: i % 2 === 0 ? "reach" : "conversion",
    })),
    kpis: isLaunch
      ? ["Reach", "Video views", "Product page visits", "Conversions", "ROAS"]
      : ["Reach", "Engagement rate", "CTR", "Conversions", "Revenue"],
  };
}
