export type FeatureStatus = "implemented" | "integration_required" | "production_required";

export interface FeatureCheck {
  area: string;
  feature: string;
  status: FeatureStatus;
  nextAction: string;
}

export const FEATURE_MATRIX: FeatureCheck[] = [
  { area: "Brand", feature: "Brand Brain", status: "implemented", nextAction: "Connect to persistent brand data" },
  { area: "Products", feature: "Product Brain", status: "implemented", nextAction: "Connect product pipeline to creative jobs" },
  { area: "Creative", feature: "AI product shoots", status: "integration_required", nextAction: "Connect selected image generation provider" },
  { area: "Creative", feature: "Reels/video ads", status: "integration_required", nextAction: "Connect video generation/rendering worker" },
  { area: "Social", feature: "Scheduling", status: "implemented", nextAction: "Verify worker in staging" },
  { area: "Social", feature: "Publishing", status: "integration_required", nextAction: "Complete approved platform adapters" },
  { area: "Analytics", feature: "Metrics", status: "integration_required", nextAction: "Connect official provider analytics APIs" },
  { area: "Analytics", feature: "Optimization", status: "implemented", nextAction: "Calibrate recommendations with real data" },
  { area: "SaaS", feature: "Plans/usage", status: "implemented", nextAction: "Connect verified billing webhooks" },
  { area: "SaaS", feature: "Teams/roles", status: "implemented", nextAction: "Test tenant isolation" },
  { area: "Operations", feature: "Health/readiness", status: "implemented", nextAction: "Connect real dependency checks" },
];
