export type CampaignGoal =
  | "awareness"
  | "engagement"
  | "traffic"
  | "leads"
  | "sales"
  | "launch"
  | "retention";

export interface CampaignBrief {
  brandId: string;
  name: string;
  goal: CampaignGoal;
  productIds: string[];
  platforms: string[];
  startDate: string;
  endDate: string;
  audience?: string;
  offer?: string;
  notes?: string;
}

export interface CampaignPlan {
  strategy: string;
  contentPillars: string[];
  recommendedAssets: Array<{
    type: "post" | "reel" | "story" | "email" | "ad";
    quantity: number;
    purpose: string;
  }>;
  publishingCadence: Array<{
    platform: string;
    dayOffset: number;
    format: string;
    purpose: string;
  }>;
  kpis: string[];
}
