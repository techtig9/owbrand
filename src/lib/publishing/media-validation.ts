import { PLATFORMS, type MediaConstraints, type SocialPlatform } from '@/lib/social/platforms';

/**
 * Pre-flight media validation, per platform.
 *
 * Two defects in the version this replaces:
 *
 *   1. It validated against one global limit table, not the platform's. A
 *      100 MB video passed for "video" and was then rejected by Instagram,
 *      wasting a scheduled slot.
 *   2. `/api/social/media-check` called it as `validateMedia(body.media as never, kind)`
 *      while the route's own schema produced `{ sizeBytes, mimeType, ... }` and
 *      this function read `{ bytes, mime }`. Both were therefore `undefined`
 *      on every item, so the endpoint reported "Unsupported MIME type" for
 *      every file ever checked. The `as never` cast is what let that compile.
 *
 * Field names here match the route's schema exactly, and there is no cast.
 */

export interface MediaDescriptor {
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface MediaIssue {
  code:
    | 'missing_mime_type'
    | 'unsupported_mime_type'
    | 'missing_size'
    | 'too_large'
    | 'empty_file'
    | 'too_long'
    | 'missing_duration';
  message: string;
}

export interface MediaItemResult {
  index: number;
  valid: boolean;
  kind: 'image' | 'video' | 'unknown';
  issues: MediaIssue[];
}

export interface MediaValidationResult {
  platform: SocialPlatform;
  valid: boolean;
  items: MediaItemResult[];
  /** Problems with the post as a whole rather than one file. */
  postIssues: MediaIssue[] | { code: string; message: string }[];
}

function kindFor(mimeType: string | undefined): 'image' | 'video' | 'unknown' {
  if (!mimeType) return 'unknown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'unknown';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function validateItem(item: MediaDescriptor, index: number, limits: MediaConstraints): MediaItemResult {
  const issues: MediaIssue[] = [];
  const kind = kindFor(item.mimeType);

  if (!item.mimeType) {
    issues.push({
      code: 'missing_mime_type',
      message: 'No content type was supplied, so this file cannot be checked before publishing.',
    });
    return { index, valid: false, kind, issues };
  }

  const allowed = kind === 'video' ? limits.videoMimeTypes : limits.imageMimeTypes;

  if (kind === 'unknown' || !allowed.includes(item.mimeType)) {
    issues.push({
      code: 'unsupported_mime_type',
      message: `${item.mimeType} is not accepted. Allowed: ${[...limits.imageMimeTypes, ...limits.videoMimeTypes].join(', ')}.`,
    });
  }

  const maxBytes = kind === 'video' ? limits.maxVideoBytes : limits.maxImageBytes;

  if (item.sizeBytes === undefined) {
    // Not fatal on its own — the provider will enforce it — but the user
    // should know the check was incomplete rather than assume it passed.
    issues.push({
      code: 'missing_size',
      message: 'File size was not supplied, so the size limit could not be checked.',
    });
  } else if (item.sizeBytes === 0) {
    issues.push({ code: 'empty_file', message: 'The file is empty.' });
  } else if (item.sizeBytes > maxBytes) {
    issues.push({
      code: 'too_large',
      message: `${formatBytes(item.sizeBytes)} exceeds the ${formatBytes(maxBytes)} limit for ${kind}s on this platform.`,
    });
  }

  if (kind === 'video') {
    if (item.durationSeconds === undefined) {
      issues.push({
        code: 'missing_duration',
        message: 'Video duration was not supplied, so the length limit could not be checked.',
      });
    } else if (item.durationSeconds > limits.maxVideoSeconds) {
      issues.push({
        code: 'too_long',
        message: `${Math.round(item.durationSeconds)}s exceeds the ${limits.maxVideoSeconds}s limit on this platform.`,
      });
    }
  }

  // An unchecked limit is not a failure; a violated one is.
  const blocking = issues.filter(
    (issue) => issue.code !== 'missing_size' && issue.code !== 'missing_duration'
  );

  return { index, valid: blocking.length === 0, kind, issues };
}

export function validateMediaForPlatform(
  platform: SocialPlatform,
  media: MediaDescriptor[],
  options: { caption?: string } = {}
): MediaValidationResult {
  const limits = PLATFORMS[platform].media;
  const items = media.map((item, index) => validateItem(item, index, limits));
  const postIssues: { code: string; message: string }[] = [];

  if (media.length === 0 && !limits.allowsTextOnly) {
    postIssues.push({
      code: 'media_required',
      message: `${PLATFORMS[platform].label} has no text-only post type — attach at least one image or video.`,
    });
  }

  if (media.length < limits.minItems) {
    postIssues.push({
      code: 'too_few_items',
      message: `At least ${limits.minItems} media item(s) are required.`,
    });
  }

  if (media.length > limits.maxItems) {
    postIssues.push({
      code: 'too_many_items',
      message: `${PLATFORMS[platform].label} accepts at most ${limits.maxItems} items in one post (got ${media.length}).`,
    });
  }

  if (options.caption && options.caption.length > limits.maxCaptionLength) {
    postIssues.push({
      code: 'caption_too_long',
      message: `The caption is ${options.caption.length} characters; ${PLATFORMS[platform].label} allows ${limits.maxCaptionLength}.`,
    });
  }

  // Instagram will not accept images and videos in the same carousel via the
  // content-publishing API, and finding that out at publish time costs the
  // whole scheduled slot.
  if (platform === 'instagram' && media.length > 1) {
    const kinds = new Set(items.map((item) => item.kind));
    if (kinds.has('image') && kinds.has('video')) {
      postIssues.push({
        code: 'mixed_carousel',
        message: 'Instagram carousels cannot mix images and videos. Publish them as separate posts.',
      });
    }
  }

  return {
    platform,
    valid: postIssues.length === 0 && items.every((item) => item.valid),
    items,
    postIssues,
  };
}
