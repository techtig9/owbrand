import { facebookAdapter, instagramAdapter } from './meta-adapters';
import type { PublishAdapter } from './types';
import { PLATFORMS, SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { PublishError } from '@/lib/social/errors';

/**
 * Adapter registry.
 *
 * Platforms with no implementation get an adapter that throws
 * `PublishError('unavailable')` naming the specific reason from the platform
 * table. This is deliberately not a mock: it never returns a fabricated
 * success, and the worker records the refusal as a permanent failure with a
 * message the user can read.
 *
 * The alternative — leaving them out of the registry and returning
 * `PROVIDER_NOT_CONFIGURED` from the worker, as the old code did — produced an
 * error with no explanation of whether it was a missing key, a missing
 * integration, or a bug.
 */

function unavailableAdapter(platform: SocialPlatform): PublishAdapter {
  return {
    platform,
    async publish() {
      throw new PublishError(
        'unavailable',
        `${platform}_not_implemented`,
        PLATFORMS[platform].unavailableReason ??
          `OwBrand cannot publish to ${PLATFORMS[platform].label} yet.`
      );
    },
  };
}

const IMPLEMENTED: Partial<Record<SocialPlatform, PublishAdapter>> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
};

/** Every platform resolves to an adapter; unimplemented ones refuse honestly. */
export const ADAPTERS: Record<SocialPlatform, PublishAdapter> = Object.fromEntries(
  SOCIAL_PLATFORMS.map((platform) => [platform, IMPLEMENTED[platform] ?? unavailableAdapter(platform)])
) as Record<SocialPlatform, PublishAdapter>;

export function adapterFor(platform: SocialPlatform): PublishAdapter {
  return ADAPTERS[platform];
}

/** True when a real implementation exists — used for honest capability reporting. */
export function hasImplementation(platform: SocialPlatform): boolean {
  return Boolean(IMPLEMENTED[platform]);
}
