import type { PublishPayload } from "./platform-types";

/**
 * Queue boundary for production workers.
 * The route/service layer should enqueue work instead of holding an HTTP request
 * while a social platform publishes.
 */
export interface PublishingQueue {
  enqueue(payload: PublishPayload): Promise<{ jobId: string }>;
}

export class DatabasePublishingQueue implements PublishingQueue {
  async enqueue(payload: PublishPayload) {
    // The concrete implementation should insert into ai_jobs / publishing_jobs
    // and be consumed by a server worker/cron. Kept provider-neutral.
    return { jobId: `publish_${payload.idempotencyKey.slice(0, 16)}` };
  }
}
