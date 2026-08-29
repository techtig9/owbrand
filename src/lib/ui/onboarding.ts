export const ONBOARDING_STEPS = [
  { id: "workspace", title: "Create workspace", required: true },
  { id: "brand", title: "Build Brand Brain", required: true },
  { id: "product", title: "Add first product", required: true },
  { id: "photos", title: "Upload product photos", required: true },
  { id: "social", title: "Connect social accounts", required: false },
  { id: "campaign", title: "Create first campaign", required: true },
  { id: "publish", title: "Schedule first content", required: false },
] as const;

export function onboardingProgress(completed: string[]) {
  const required = ONBOARDING_STEPS.filter((x) => x.required);
  const done = required.filter((x) => completed.includes(x.id)).length;
  return Math.round((done / required.length) * 100);
}
