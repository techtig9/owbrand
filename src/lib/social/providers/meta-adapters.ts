import 'server-only';
import {
  publishFacebookPost,
  publishInstagramPost,
  fetchPermalink,
} from './meta-client';
import type { PublishAdapter, PublishOutcome, PublishRequest } from './types';
import { accessTokenFor, type SocialAccountRow } from '@/lib/social/account-store';
import { validateMediaForPlatform } from '@/lib/publishing/media-validation';
import { PublishError } from '@/lib/social/errors';

/**
 * Facebook Page and Instagram publishing adapters.
 *
 * Both resolve the credential from the stored account, never from the request.
 * That is the fix for the old `PublishPayload.accessTokenRef`, which the
 * unauthenticated publish route accepted straight from the caller — letting
 * anyone name which credential to publish with.
 */

/**
 * Pre-flight validation inside the adapter, not only at the API boundary.
 *
 * The API validated the media when the post was created, but a scheduled post
 * publishes later — the caption may have been edited, the media replaced. A
 * platform rejection here would cost an attempt and a retry cycle, so it is
 * cheaper to fail fast and permanently with a message the user can act on.
 */
function assertPublishable(platform: 'facebook' | 'instagram', request: PublishRequest): void {
  const result = validateMediaForPlatform(
    platform,
    request.mediaUrls.map(() => ({
      // The URL alone carries no MIME type or size, so only the structural
      // rules (item counts, caption length, text-only support) can be checked
      // here. Per-file limits were checked at creation time.
      mimeType: request.isVideo ? 'video/mp4' : 'image/jpeg',
    })),
    { caption: request.caption }
  );

  if (!result.valid) {
    const reasons = [
      ...result.postIssues.map((issue) => issue.message),
      ...result.items.flatMap((item) => item.issues.map((issue) => issue.message)),
    ];
    throw new PublishError(
      'permanent',
      'media_rejected_locally',
      reasons[0] ?? 'This post does not meet the platform requirements.',
      { providerResponse: { reasons } }
    );
  }
}

function requirePageTarget(account: SocialAccountRow): { targetId: string; pageAccessToken: string } {
  const targetId = account.external_account_id;
  if (!targetId) {
    throw new PublishError(
      'needs_reconnect',
      'no_publish_target',
      'This connection has no publishing target recorded. Reconnect the account.'
    );
  }

  return { targetId, pageAccessToken: accessTokenFor(account) };
}

export const facebookAdapter: PublishAdapter = {
  platform: 'facebook',

  async publish(request: PublishRequest, account: SocialAccountRow): Promise<PublishOutcome> {
    assertPublishable('facebook', request);
    const target = requirePageTarget(account);

    const result = await publishFacebookPost(target, {
      caption: request.caption,
      mediaUrls: request.mediaUrls,
    });

    if (!result?.id) {
      // The Graph API answered 200 with no id. Treat as retryable rather than
      // claiming a publish we cannot point at.
      throw new PublishError('retryable', 'facebook_no_post_id', 'Facebook accepted the request but returned no post id.');
    }

    const externalUrl = await fetchPermalink(result.id, target.pageAccessToken, 'facebook');

    return { externalPostId: result.id, externalUrl, providerResponse: { id: result.id } };
  },
};

export const instagramAdapter: PublishAdapter = {
  platform: 'instagram',

  async publish(request: PublishRequest, account: SocialAccountRow): Promise<PublishOutcome> {
    assertPublishable('instagram', request);

    const targetId = account.external_account_id;
    if (!targetId) {
      throw new PublishError(
        'needs_reconnect',
        'no_publish_target',
        'This Instagram connection has no business account id recorded. Reconnect the account.'
      );
    }

    // Instagram publishes through the linked Page's token, which is what the
    // OAuth callback stored — but a connection made before that column
    // existed may not have the page id, and posting would fail confusingly.
    if (!account.external_page_id) {
      throw new PublishError(
        'needs_reconnect',
        'no_linked_page',
        'This Instagram account is not linked to a Facebook Page in OwBrand. Reconnect it.'
      );
    }

    const pageAccessToken = accessTokenFor(account);

    const result = await publishInstagramPost(
      { targetId, pageAccessToken },
      { caption: request.caption, mediaUrls: request.mediaUrls, isVideo: request.isVideo }
    );

    if (!result?.id) {
      throw new PublishError('retryable', 'instagram_no_media_id', 'Instagram accepted the request but returned no media id.');
    }

    const externalUrl = await fetchPermalink(result.id, pageAccessToken, 'instagram');

    return { externalPostId: result.id, externalUrl, providerResponse: { id: result.id } };
  },
};
