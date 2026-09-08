import { describe, it, expect } from 'vitest';
import {
  PLATFORMS,
  SOCIAL_PLATFORMS,
  PUBLISHABLE_PLATFORMS,
  canPublishTo,
  isSocialPlatform,
  platformsForProvider,
  scopesForProvider,
} from '@/lib/social/platforms';
import { adapterFor, hasImplementation } from '@/lib/social/providers/registry';
import { PublishError } from '@/lib/social/errors';

/**
 * The platform capability table.
 *
 * The master command forbids marking an unfinished integration as complete.
 * That makes the honesty of this table a testable property: a platform with no
 * adapter must declare itself unavailable, explain why, and refuse rather than
 * return anything that could be mistaken for success.
 */

describe('the capability table is internally consistent', () => {
  it('declares every platform', () => {
    expect(SOCIAL_PLATFORMS.length).toBe(7);
    for (const platform of SOCIAL_PLATFORMS) {
      expect(PLATFORMS[platform].platform).toBe(platform);
      expect(PLATFORMS[platform].label.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the implemented platforms as available', () => {
    // The one invariant that keeps the UI, the API and the worker agreeing.
    for (const platform of SOCIAL_PLATFORMS) {
      expect(canPublishTo(platform)).toBe(hasImplementation(platform));
    }
  });

  it('lists the publishable set as facebook and instagram', () => {
    expect([...PUBLISHABLE_PLATFORMS]).toEqual(['facebook', 'instagram']);
    for (const platform of PUBLISHABLE_PLATFORMS) {
      expect(canPublishTo(platform)).toBe(true);
    }
  });

  it('gives every unavailable platform a specific reason', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      if (canPublishTo(platform)) continue;
      const reason = PLATFORMS[platform].unavailableReason ?? '';
      // "Not supported" tells the user nothing they can act on.
      expect(reason.length).toBeGreaterThan(30);
      expect(reason).toMatch(/not configured|requires|approved|paid/i);
    }
  });

  it('never claims an OAuth provider for a platform it cannot publish to', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      if (PLATFORMS[platform].oauthProvider !== null) {
        expect(canPublishTo(platform)).toBe(true);
      }
    }
  });

  it('requires the Instagram publish scope, which is the one App Review gates', () => {
    expect(PLATFORMS.instagram.scopes).toContain('instagram_content_publish');
    expect(PLATFORMS.facebook.scopes).toContain('pages_manage_posts');
  });

  it('gives Instagram no text-only post type', () => {
    expect(PLATFORMS.instagram.media.allowsTextOnly).toBe(false);
    expect(PLATFORMS.facebook.media.allowsTextOnly).toBe(true);
  });

  it('sets a positive limit on every media constraint', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      const media = PLATFORMS[platform].media;
      expect(media.maxItems).toBeGreaterThan(0);
      expect(media.maxImageBytes).toBeGreaterThan(0);
      expect(media.maxVideoBytes).toBeGreaterThan(0);
      expect(media.maxCaptionLength).toBeGreaterThan(0);
      expect(media.imageMimeTypes.length).toBeGreaterThan(0);
    }
  });
});

describe('provider grouping', () => {
  it('groups both Meta platforms under one OAuth flow', () => {
    expect(platformsForProvider('meta').sort()).toEqual(['facebook', 'instagram']);
  });

  it('asks for the union of both platforms scopes in one authorisation', () => {
    const scopes = scopesForProvider('meta');
    expect(scopes).toContain('instagram_content_publish');
    expect(scopes).toContain('pages_manage_posts');
    // De-duplicated: pages_show_list is on both platforms.
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

describe('isSocialPlatform', () => {
  it('accepts the known platforms', () => {
    for (const platform of SOCIAL_PLATFORMS) expect(isSocialPlatform(platform)).toBe(true);
  });

  it('rejects anything else, including near misses', () => {
    for (const value of ['Instagram', 'twitter', 'meta', '', null, undefined, 42, {}]) {
      expect(isSocialPlatform(value)).toBe(false);
    }
  });
});

describe('the adapter registry refuses honestly', () => {
  it('resolves an adapter for every platform', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(adapterFor(platform).platform).toBe(platform);
    }
  });

  it('throws unavailable — never a fabricated success — for an unimplemented platform', async () => {
    for (const platform of SOCIAL_PLATFORMS) {
      if (hasImplementation(platform)) continue;

      const adapter = adapterFor(platform);
      await expect(
        adapter.publish(
          { socialPostId: 'p', brandId: 'b', mediaUrls: ['https://cdn.test/a.jpg'], isVideo: false },
          {} as never
        )
      ).rejects.toThrow(PublishError);
    }
  });

  it('carries the platform table reason into the thrown error', async () => {
    try {
      await adapterFor('tiktok').publish(
        { socialPostId: 'p', brandId: 'b', mediaUrls: [], isVideo: false },
        {} as never
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PublishError);
      const publishError = error as PublishError;
      expect(publishError.kind).toBe('unavailable');
      // Not retryable: no amount of waiting builds the integration.
      expect(publishError.retryable).toBe(false);
      expect(publishError.message).toBe(PLATFORMS.tiktok.unavailableReason);
    }
  });
});
