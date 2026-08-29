export type JobType =
  | "creative_generation"
  | "video_generation"
  | "campaign_generation"
  | "analytics_sync"
  | "social_publish";

export interface JobRequest {
  idempotencyKey: string;
  type: JobType;
  workspaceId: string;
  payload: Record<string, unknown>;
}

export interface JobStatus {
  id: string;
  state: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  progress: number;
  error?: string;
}
