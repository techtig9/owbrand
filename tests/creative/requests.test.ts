import { describe, it, expect } from 'vitest';
import {
  INITIAL_CREATIVE_FORM,
  TOOL_CAPABILITY,
  creativeRequestFor,
  missingRequirement,
  type CreativeFormState,
  type ToolId,
} from '@/lib/creative/requests';

/**
 * Creative Studio request mapping.
 *
 * These tests exist because of a specific defect: the studio had four tools
 * that all POSTed to `/api/ai/generate-content` with the tool name prepended
 * to the instruction, so "Product photo" returned prose and the real image and
 * video endpoints were unreachable from the UI. A regression here is invisible
 * in the browser until someone spends credits, so it gets asserted.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function form(overrides: Partial<CreativeFormState> = {}): CreativeFormState {
  return { ...INITIAL_CREATIVE_FORM, ...overrides };
}

describe('creativeRequestFor', () => {
  it('sends each tool to its own endpoint', () => {
    const endpoints = (['copy', 'reel', 'photo', 'video'] as ToolId[]).map(
      (tool) => creativeRequestFor(tool, BRAND, form()).endpoint
    );

    expect(endpoints).toEqual([
      '/api/ai/generate-content',
      '/api/ai/generate-reel',
      '/api/creative/photo',
      '/api/creative/video',
    ]);

    // The defect being guarded against: no two tools sharing an endpoint.
    expect(new Set(endpoints).size).toBe(4);
  });

  it('never smuggles the tool name into the instruction', () => {
    const request = creativeRequestFor('photo', BRAND, form({ instruction: 'a serum on marble' }));
    expect(JSON.stringify(request.payload)).not.toMatch(/Mode:/i);
  });

  it('omits an empty productId rather than sending an invalid uuid', () => {
    const { payload } = creativeRequestFor('copy', BRAND, form({ instruction: 'hi' }));
    expect(payload.productId).toBeUndefined();
    expect('productId' in payload).toBe(true);
    expect(payload.platform).toBeUndefined();
  });

  it('passes the product through when one is chosen', () => {
    const { payload } = creativeRequestFor('copy', BRAND, form({ productId: PRODUCT, instruction: 'hi' }));
    expect(payload.productId).toBe(PRODUCT);
  });

  it('builds a photo payload matching the route schema', () => {
    const { payload } = creativeRequestFor(
      'photo',
      BRAND,
      form({
        productId: PRODUCT,
        sourceAssetId: ASSET,
        style: 'editorial',
        scene: 'on travertine',
        photoAspect: '4:5',
        count: 3,
      })
    );

    expect(payload).toEqual({
      brandId: BRAND,
      productId: PRODUCT,
      sourceAssetId: ASSET,
      style: 'editorial',
      scene: 'on travertine',
      aspectRatio: '4:5',
      count: 3,
    });
  });

  it('builds a video payload with the multi-asset field the route requires', () => {
    const { payload } = creativeRequestFor(
      'video',
      BRAND,
      form({
        productId: PRODUCT,
        sourceAssetIds: [ASSET],
        style: 'fast cuts',
        goal: 'drive trial',
        durationSeconds: 30,
        reelAspect: '1:1',
      })
    );

    expect(payload).toMatchObject({
      sourceAssetIds: [ASSET],
      durationSeconds: 30,
      aspectRatio: '1:1',
      goal: 'drive trial',
    });
    // The photo route's single-asset field must not appear here.
    expect(payload.sourceAssetId).toBeUndefined();
  });
});

describe('missingRequirement', () => {
  it('requires a brand before anything else', () => {
    expect(missingRequirement('copy', '', form({ instruction: 'hi' }))).toBe('Select a brand.');
  });

  it('clears once a text tool has a brief', () => {
    expect(missingRequirement('copy', BRAND, form())).toBe('Describe what you want.');
    expect(missingRequirement('copy', BRAND, form({ instruction: 'hi' }))).toBeNull();
  });

  it('treats a whitespace-only brief as empty', () => {
    expect(missingRequirement('reel', BRAND, form({ instruction: '   \n  ' }))).toBe('Describe what you want.');
  });

  it('walks the photo requirements in order', () => {
    const base = { productId: PRODUCT, sourceAssetId: ASSET, style: 'a', scene: 'b' };
    expect(missingRequirement('photo', BRAND, form())).toBe('Select a product.');
    expect(missingRequirement('photo', BRAND, form({ productId: PRODUCT }))).toBe('Select the source photo.');
    expect(missingRequirement('photo', BRAND, form({ ...base, style: '' }))).toBe('Describe the style.');
    expect(missingRequirement('photo', BRAND, form({ ...base, scene: '' }))).toBe('Describe the scene.');
    expect(missingRequirement('photo', BRAND, form(base))).toBeNull();
  });

  it('requires at least one source asset for video', () => {
    const complete = { productId: PRODUCT, sourceAssetIds: [ASSET], style: 'a', goal: 'b' };
    expect(missingRequirement('video', BRAND, form({ ...complete, sourceAssetIds: [] }))).toBe(
      'Select at least one source asset.'
    );
    expect(missingRequirement('video', BRAND, form(complete))).toBeNull();
  });
});

describe('TOOL_CAPABILITY', () => {
  it('maps the media tools to their own provider credentials', () => {
    // Gating photo on the text-model key would let a user spend credits on a
    // call that cannot succeed.
    expect(TOOL_CAPABILITY).toEqual({ copy: 'ai', reel: 'ai', photo: 'image', video: 'video' });
  });
});
