import { describe, it, expect } from 'vitest';
import { validateMediaForPlatform } from '@/lib/publishing/media-validation';

/**
 * Platform media validation.
 *
 * The version this replaces had a defect worth a regression test of its own:
 * `/api/social/media-check` called it with `{ sizeBytes, mimeType }` while the
 * function read `{ bytes, mime }`, hidden by an `as never` cast — so every
 * file ever checked came back "Unsupported MIME type". The field names are now
 * asserted directly.
 */

const JPEG = { mimeType: 'image/jpeg', sizeBytes: 2 * 1024 * 1024 };
const MP4 = { mimeType: 'video/mp4', sizeBytes: 20 * 1024 * 1024, durationSeconds: 30 };

describe('the field-name regression', () => {
  it('accepts a perfectly ordinary JPEG', () => {
    const result = validateMediaForPlatform('instagram', [JPEG]);
    expect(result.valid).toBe(true);
    expect(result.items[0].issues).toEqual([]);
  });

  it('reads sizeBytes, not bytes', () => {
    const oversized = validateMediaForPlatform('instagram', [{ mimeType: 'image/jpeg', sizeBytes: 50 * 1024 * 1024 }]);
    expect(oversized.valid).toBe(false);
    expect(oversized.items[0].issues.map((i) => i.code)).toContain('too_large');
  });

  it('reads mimeType, not mime', () => {
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'image/tiff', sizeBytes: 100 }]);
    expect(result.items[0].issues.map((i) => i.code)).toContain('unsupported_mime_type');
  });
});

describe('per-platform limits', () => {
  it('applies Instagram limits, not one global table', () => {
    const nineMb = { mimeType: 'image/jpeg', sizeBytes: 9 * 1024 * 1024 };
    // 9 MB is over Instagram's image limit and under Facebook's.
    expect(validateMediaForPlatform('instagram', [nineMb]).valid).toBe(false);
    expect(validateMediaForPlatform('facebook', [nineMb]).valid).toBe(true);
  });

  it('rejects a webp on Instagram and accepts it on Facebook', () => {
    const webp = { mimeType: 'image/webp', sizeBytes: 500_000 };
    expect(validateMediaForPlatform('instagram', [webp]).valid).toBe(false);
    expect(validateMediaForPlatform('facebook', [webp]).valid).toBe(true);
  });

  it('rejects a video longer than Instagram allows', () => {
    const long = { mimeType: 'video/mp4', sizeBytes: 10_000_000, durationSeconds: 300 };
    const result = validateMediaForPlatform('instagram', [long]);
    expect(result.items[0].issues.map((i) => i.code)).toContain('too_long');
    expect(validateMediaForPlatform('facebook', [long]).valid).toBe(true);
  });
});

describe('post-level rules', () => {
  it('requires media on Instagram, which has no text-only post', () => {
    const result = validateMediaForPlatform('instagram', [], { caption: 'just words' });
    expect(result.valid).toBe(false);
    expect(result.postIssues.map((i) => i.code)).toContain('media_required');
  });

  it('allows a text-only Facebook post', () => {
    expect(validateMediaForPlatform('facebook', [], { caption: 'just words' }).valid).toBe(true);
  });

  it('rejects more items than the platform accepts', () => {
    const many = Array.from({ length: 11 }, () => JPEG);
    expect(validateMediaForPlatform('instagram', many).postIssues.map((i) => i.code)).toContain('too_many_items');
  });

  it('rejects an over-long caption per platform', () => {
    const caption = 'x'.repeat(3000);
    // 3000 characters is over Instagram's 2200 and far under Facebook's.
    expect(validateMediaForPlatform('instagram', [JPEG], { caption }).postIssues.map((i) => i.code)).toContain(
      'caption_too_long'
    );
    expect(validateMediaForPlatform('facebook', [JPEG], { caption }).valid).toBe(true);
  });

  it('rejects a mixed-media Instagram carousel', () => {
    // The API rejects this, and finding out at publish time costs the slot.
    const result = validateMediaForPlatform('instagram', [JPEG, MP4]);
    expect(result.postIssues.map((i) => i.code)).toContain('mixed_carousel');
  });

  it('allows a single video, which is not a carousel', () => {
    expect(validateMediaForPlatform('instagram', [MP4]).valid).toBe(true);
  });

  it('allows an all-image Instagram carousel', () => {
    expect(validateMediaForPlatform('instagram', [JPEG, JPEG, JPEG]).valid).toBe(true);
  });
});

describe('incomplete descriptors', () => {
  it('reports an unchecked size without failing the item', () => {
    // The caller may only have a URL. Saying the check was incomplete is
    // honest; failing the post would block a valid publish.
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'image/jpeg' }]);
    expect(result.items[0].valid).toBe(true);
    expect(result.items[0].issues.map((i) => i.code)).toContain('missing_size');
  });

  it('reports an unchecked video duration without failing the item', () => {
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'video/mp4', sizeBytes: 1000 }]);
    expect(result.items[0].valid).toBe(true);
    expect(result.items[0].issues.map((i) => i.code)).toContain('missing_duration');
  });

  it('fails an item with no content type, which cannot be checked at all', () => {
    const result = validateMediaForPlatform('instagram', [{ sizeBytes: 1000 }]);
    expect(result.items[0].valid).toBe(false);
    expect(result.items[0].issues.map((i) => i.code)).toContain('missing_mime_type');
  });

  it('rejects an empty file', () => {
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'image/jpeg', sizeBytes: 0 }]);
    expect(result.items[0].issues.map((i) => i.code)).toContain('empty_file');
  });
});

describe('messages', () => {
  it('names the actual limit rather than saying "too large"', () => {
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'image/jpeg', sizeBytes: 50 * 1024 * 1024 }]);
    const message = result.items[0].issues.find((i) => i.code === 'too_large')?.message ?? '';
    expect(message).toMatch(/MB/);
    expect(message).toMatch(/8 MB/);
  });

  it('lists what is allowed when a type is rejected', () => {
    const result = validateMediaForPlatform('instagram', [{ mimeType: 'image/gif', sizeBytes: 1000 }]);
    const message = result.items[0].issues.find((i) => i.code === 'unsupported_mime_type')?.message ?? '';
    expect(message).toContain('image/jpeg');
  });
});
