export type RecordStatus = "draft" | "active" | "archived";
export type ContentStatus =
  | "draft"
  | "generating"
  | "ready"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export const TERMINAL_JOB_STATES = ["succeeded", "failed", "cancelled"] as const;
