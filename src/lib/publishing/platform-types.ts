export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "pinterest"
  | "x";

export type PublishStatus =
  | "draft"
  | "awaiting_approval"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface PublishPayload {
  postId: string;
  brandId: string;
  platform: SocialPlatform;
  caption?: string;
  mediaUrls: string[];
  scheduledFor?: string;
  accessTokenRef: string;
  idempotencyKey: string;
}

export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Provider adapter contract.
 * Production adapters must implement the official API requirements of each platform.
 */
export interface SocialPublisher {
  platform: SocialPlatform;
  publish(payload: PublishPayload): Promise<PublishResult>;
}
