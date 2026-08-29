import { createPublishIdempotencyKey } from "./idempotency";
import type { PublishPayload, PublishResult, SocialPlatform } from "./platform-types";

export interface PublishingProviderRegistry {
  get(platform: SocialPlatform): {
    publish(payload: PublishPayload): Promise<PublishResult>;
  } | null;
}

/**
 * Phase 6 worker boundary.
 * The database job is claimed first, then the platform adapter is invoked.
 * Concrete OAuth/API adapters are intentionally injected so no provider token
 * is ever handled by the browser.
 */
export async function executePublishingJob(
  job: {
    postId: string;
    brandId: string;
    platform: SocialPlatform;
    mediaUrls: string[];
    caption?: string;
    scheduledFor?: string;
    accessTokenRef: string;
  },
  registry: PublishingProviderRegistry,
) {
  const idempotencyKey = createPublishIdempotencyKey(
    job.postId,
    job.platform,
    job.scheduledFor,
  );

  const provider = registry.get(job.platform);
  if (!provider) {
    return {
      success: false,
      idempotencyKey,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage: `No ${job.platform} publishing provider is configured.`,
    };
  }

  return provider.publish({
    ...job,
    idempotencyKey,
  });
}
