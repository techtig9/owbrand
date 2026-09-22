import type { SocialPlatform } from '@/lib/social/platforms';
import type { SocialAccountRow } from '@/lib/social/account-store';

/**
 * The publishing adapter contract.
 *
 * One method, one job: take a post and an authorised account, put it on the
 * platform, and either return the external ids or throw a classified
 * `PublishError`. Everything else — retries, leases, state transitions,
 * credit accounting — belongs to the worker, so an adapter stays small enough
 * to be obviously correct against the platform's documentation.
 */

export interface PublishRequest {
  socialPostId: string;
  brandId: string;
  caption?: string;
  mediaUrls: string[];
  /** Set when the media is video, which changes the Instagram code path. */
  isVideo: boolean;
}

export interface PublishOutcome {
  externalPostId: string;
  externalUrl: string | null;
  /** Anything worth keeping for the attempt log. Never credentials. */
  providerResponse?: Record<string, unknown>;
}

export interface PublishAdapter {
  platform: SocialPlatform;
  /**
   * Throws `PublishError` on every failure. A returned value always means the
   * post is live on the platform — adapters must never report success for
   * work the provider merely accepted for later processing.
   */
  publish(request: PublishRequest, account: SocialAccountRow): Promise<PublishOutcome>;
}
