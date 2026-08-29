export type AutomationLevel = "manual" | "assisted" | "autonomous";

export interface ApprovalPolicy {
  level: AutomationLevel;
  autoPublish: boolean;
  autoCreateAds: boolean;
  autoSpendMoney: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  level: "assisted",
  autoPublish: false,
  autoCreateAds: true,
  autoSpendMoney: false,
};

export function canExecuteAction(
  policy: ApprovalPolicy,
  action: "generate" | "schedule" | "publish" | "spend",
) {
  if (action === "generate") return true;
  if (action === "schedule") return policy.level !== "manual";
  if (action === "publish") return policy.autoPublish;
  if (action === "spend") return policy.autoSpendMoney;
  return false;
}
