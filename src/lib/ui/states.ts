export type AsyncState = "idle" | "loading" | "success" | "error" | "empty";

export interface UiStateCopy {
  title: string;
  description: string;
  action?: string;
}

export const UI_STATES: Record<Exclude<AsyncState, "idle">, UiStateCopy> = {
  loading: {
    title: "Loading",
    description: "OwBrand is preparing your workspace.",
  },
  success: {
    title: "Done",
    description: "Your changes were saved successfully.",
  },
  error: {
    title: "Something went wrong",
    description: "Please try again. If the problem continues, contact support.",
    action: "Try again",
  },
  empty: {
    title: "Nothing here yet",
    description: "Create your first item to get started.",
    action: "Create",
  },
};
