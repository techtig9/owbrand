/**
 * What OwBrand can and cannot do on each social platform, stated once.
 *
 * The master command asks for TikTok, YouTube, LinkedIn, Pinterest and X to be
 * addable "safely where API access is available" — and it forbids marking an
 * unfinished integration as complete. Those two together mean the honest
 * design is a capability table: every platform is declared, and the ones with
 * no implementation say so in the type system rather than failing at runtime
 * with a confusing provider error.
 *
 * `publish: 'unavailable'` is not a placeholder. It is a real, testable state
 * that the API and the UI both read, so a user is told "we cannot publish to
 * TikTok yet" before they schedule a post, not after it silently fails.
 */

export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'pinterest',
  'x',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Platforms with a working publish path today. */
export const PUBLISHABLE_PLATFORMS = ['facebook', 'instagram'] as const;
export type PublishablePlatform = (typeof PUBLISHABLE_PLATFORMS)[number];

export type PublishSupport = 'available' | 'unavailable';

export interface MediaConstraints {
  /** Minimum and maximum media items in one post. */
  minItems: number;
  maxItems: number;
  imageMimeTypes: string[];
  videoMimeTypes: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  maxCaptionLength: number;
  /** Whether a post can carry no media at all (text-only). */
  allowsTextOnly: boolean;
}

export interface PlatformDefinition {
  platform: SocialPlatform;
  label: string;
  publish: PublishSupport;
  /** Which OAuth provider owns this platform's credentials. */
  oauthProvider: 'meta' | null;
  /**
   * Scopes requested at connect time. Meta requires each of these to be
   * granted by App Review before a production app can use them, which is why
   * the list is explicit rather than "whatever the SDK defaults to".
   */
  scopes: string[];
  media: MediaConstraints;
  /** Shown to the user when publish is unavailable. Never vague. */
  unavailableReason?: string;
}

const MB = 1024 * 1024;

/**
 * Meta's documented limits at Graph v21. These are deliberately conservative
 * where the docs give a range: rejecting a post we could have published is a
 * minor annoyance, while accepting one the API will reject wastes a scheduled
 * slot and looks like our bug.
 */
const INSTAGRAM_MEDIA: MediaConstraints = {
  minItems: 1,
  maxItems: 10,
  imageMimeTypes: ['image/jpeg', 'image/png'],
  videoMimeTypes: ['video/mp4', 'video/quicktime'],
  maxImageBytes: 8 * MB,
  maxVideoBytes: 100 * MB,
  maxVideoSeconds: 90,
  maxCaptionLength: 2200,
  // Instagram has no text-only post type.
  allowsTextOnly: false,
};

const FACEBOOK_MEDIA: MediaConstraints = {
  minItems: 0,
  maxItems: 10,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  videoMimeTypes: ['video/mp4', 'video/quicktime'],
  maxImageBytes: 10 * MB,
  maxVideoBytes: 1024 * MB,
  maxVideoSeconds: 1200,
  maxCaptionLength: 63206,
  allowsTextOnly: true,
};

/** A conservative default for platforms we cannot publish to yet. */
const PLACEHOLDER_MEDIA: MediaConstraints = {
  minItems: 1,
  maxItems: 1,
  imageMimeTypes: ['image/jpeg', 'image/png'],
  videoMimeTypes: ['video/mp4'],
  maxImageBytes: 8 * MB,
  maxVideoBytes: 100 * MB,
  maxVideoSeconds: 60,
  maxCaptionLength: 2200,
  allowsTextOnly: false,
};

export const PLATFORMS: Record<SocialPlatform, PlatformDefinition> = {
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    publish: 'available',
    oauthProvider: 'meta',
    // instagram_content_publish is the one that requires App Review and takes
    // weeks; without it the token connects but publishing returns a permission
    // error, which the adapter reports as needs_reconnect rather than a retry.
    scopes: [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ],
    media: INSTAGRAM_MEDIA,
  },

  facebook: {
    platform: 'facebook',
    label: 'Facebook Page',
    publish: 'available',
    oauthProvider: 'meta',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    media: FACEBOOK_MEDIA,
  },

  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    publish: 'unavailable',
    oauthProvider: null,
    scopes: ['video.publish', 'video.upload', 'user.info.basic'],
    media: PLACEHOLDER_MEDIA,
    unavailableReason:
      'TikTok Content Posting API access requires an approved developer application. No credentials are configured, so OwBrand cannot publish to TikTok.',
  },

  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    publish: 'unavailable',
    oauthProvider: null,
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    media: PLACEHOLDER_MEDIA,
    unavailableReason:
      'YouTube uploads need a Google Cloud project with the Data API enabled and an audited OAuth consent screen. Not configured.',
  },

  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    publish: 'unavailable',
    oauthProvider: null,
    scopes: ['w_member_social', 'r_organization_social', 'w_organization_social'],
    media: PLACEHOLDER_MEDIA,
    unavailableReason:
      'LinkedIn posting requires the Community Management API, which is granted per-application on review. Not configured.',
  },

  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest',
    publish: 'unavailable',
    oauthProvider: null,
    scopes: ['pins:write', 'boards:read'],
    media: PLACEHOLDER_MEDIA,
    unavailableReason: 'Pinterest API access requires an approved app. Not configured.',
  },

  x: {
    platform: 'x',
    label: 'X',
    publish: 'unavailable',
    oauthProvider: null,
    scopes: ['tweet.write', 'users.read', 'offline.access'],
    media: PLACEHOLDER_MEDIA,
    unavailableReason:
      'Posting to X requires a paid API tier. No credentials are configured.',
  },
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function canPublishTo(platform: SocialPlatform): boolean {
  return PLATFORMS[platform].publish === 'available';
}

/** Platforms whose credentials come from one OAuth provider. */
export function platformsForProvider(provider: 'meta'): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((p) => PLATFORMS[p].oauthProvider === provider);
}

/** The union of scopes needed to connect every platform a provider covers. */
export function scopesForProvider(provider: 'meta'): string[] {
  const scopes = new Set<string>();
  for (const platform of platformsForProvider(provider)) {
    for (const scope of PLATFORMS[platform].scopes) scopes.add(scope);
  }
  return Array.from(scopes).sort();
}
