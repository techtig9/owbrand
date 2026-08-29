export interface Touchpoint {
  platform: string;
  postId?: string;
  occurredAt: string;
  clicks?: number;
  conversions?: number;
  revenue?: number;
}

export interface AttributionSummary {
  revenue: number;
  conversions: number;
  attributedTouchpoints: number;
  topPlatform?: string;
}

export function summarizeAttribution(touchpoints: Touchpoint[]): AttributionSummary {
  const revenue = touchpoints.reduce((sum, x) => sum + (x.revenue ?? 0), 0);
  const conversions = touchpoints.reduce((sum, x) => sum + (x.conversions ?? 0), 0);

  const byPlatform = new Map<string, number>();
  for (const x of touchpoints) {
    byPlatform.set(x.platform, (byPlatform.get(x.platform) ?? 0) + (x.revenue ?? 0));
  }

  const topPlatform = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    revenue,
    conversions,
    attributedTouchpoints: touchpoints.length,
    topPlatform,
  };
}
