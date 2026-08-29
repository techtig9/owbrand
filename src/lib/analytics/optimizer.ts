export interface PerformanceSnapshot {
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  videoViews?: number;
}

export interface OptimizationAction {
  priority: "high" | "medium" | "low";
  action:
    | "increase_reels"
    | "improve_hooks"
    | "test_cta"
    | "shift_budget"
    | "refresh_creative"
    | "double_down"
    | "collect_more_data";
  reason: string;
  expectedImpact: string;
}

export function optimize(snapshot: PerformanceSnapshot): OptimizationAction[] {
  const actions: OptimizationAction[] = [];
  const ctr = snapshot.impressions ? snapshot.clicks / snapshot.impressions : 0;
  const engagementRate = snapshot.impressions
    ? snapshot.engagements / snapshot.impressions
    : 0;
  const roas = snapshot.spend > 0 ? snapshot.revenue / snapshot.spend : 0;

  if (!snapshot.impressions || snapshot.impressions < 100) {
    return [{
      priority: "medium",
      action: "collect_more_data",
      reason: "There is not enough delivery data for a confident optimization decision.",
      expectedImpact: "Improved confidence in future recommendations.",
    }];
  }

  if (engagementRate < 0.02) {
    actions.push({
      priority: "high",
      action: "improve_hooks",
      reason: "Engagement rate is below the configured baseline.",
      expectedImpact: "Higher attention and engagement.",
    });
  } else {
    actions.push({
      priority: "medium",
      action: "double_down",
      reason: "Engagement is healthy.",
      expectedImpact: "More reach from proven creative patterns.",
    });
  }

  if (ctr < 0.01) {
    actions.push({
      priority: "high",
      action: "test_cta",
      reason: "Click-through rate is weak.",
      expectedImpact: "Improved traffic efficiency.",
    });
  }

  if (roas > 2) {
    actions.push({
      priority: "medium",
      action: "shift_budget",
      reason: "Observed return on spend is strong.",
      expectedImpact: "More spend toward efficient campaigns, subject to user approval.",
    });
  } else if (snapshot.spend > 0 && roas < 1) {
    actions.push({
      priority: "high",
      action: "refresh_creative",
      reason: "Revenue is currently below advertising spend.",
      expectedImpact: "Reduce wasted spend by testing new creative.",
    });
  }

  return actions;
}
