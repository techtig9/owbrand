/**
 * Maps a Creative Studio tool to the endpoint that performs it.
 *
 * This exists as its own module because it is the fix for a specific defect:
 * the previous studio sent all four tools to `/api/ai/generate-content` with
 * the tool name prepended to the instruction ("Mode: photo. …"), so asking for
 * a product photo returned prose and `/api/creative/photo`,
 * `/api/creative/video` and `/api/ai/generate-reel` were unreachable from the
 * product. Keeping the mapping pure and separate means a test can assert that
 * each tool reaches its own endpoint with the payload that endpoint validates.
 */

export type ToolId = 'copy' | 'reel' | 'photo' | 'video';

export const COPY_KINDS = ['post', 'caption', 'ad', 'email', 'headline', 'product_story'] as const;
export type CopyKind = (typeof COPY_KINDS)[number];

export interface CreativeFormState {
  productId: string;
  instruction: string;
  kind: CopyKind;
  platform: string;
  variations: number;
  durationSeconds: 15 | 30 | 60;
  reelAspect: '9:16' | '1:1' | '16:9';
  photoAspect: '1:1' | '4:5' | '3:2' | '16:9' | '9:16';
  style: string;
  scene: string;
  goal: string;
  count: number;
  sourceAssetId: string;
  sourceAssetIds: string[];
}

export const INITIAL_CREATIVE_FORM: CreativeFormState = {
  productId: '',
  instruction: '',
  kind: 'post',
  platform: '',
  variations: 1,
  durationSeconds: 15,
  reelAspect: '9:16',
  photoAspect: '1:1',
  style: '',
  scene: '',
  goal: '',
  count: 4,
  sourceAssetId: '',
  sourceAssetIds: [],
};

export interface CreativeRequest {
  endpoint: string;
  payload: Record<string, unknown>;
}

export function creativeRequestFor(
  tool: ToolId,
  brandId: string,
  form: CreativeFormState
): CreativeRequest {
  switch (tool) {
    case 'copy':
      return {
        endpoint: '/api/ai/generate-content',
        payload: {
          brandId,
          // Omitted rather than sent empty: the route's schema treats
          // productId as an optional uuid, and '' is not a uuid.
          productId: form.productId || undefined,
          kind: form.kind,
          instruction: form.instruction,
          platform: form.platform || undefined,
          variations: form.variations,
        },
      };

    case 'reel':
      return {
        endpoint: '/api/ai/generate-reel',
        payload: {
          brandId,
          instruction: form.instruction,
          assetIds: form.sourceAssetIds,
          durationSeconds: form.durationSeconds,
          aspectRatio: form.reelAspect,
        },
      };

    case 'photo':
      return {
        endpoint: '/api/creative/photo',
        payload: {
          brandId,
          productId: form.productId,
          sourceAssetId: form.sourceAssetId,
          style: form.style,
          scene: form.scene,
          aspectRatio: form.photoAspect,
          count: form.count,
        },
      };

    case 'video':
      return {
        endpoint: '/api/creative/video',
        payload: {
          brandId,
          productId: form.productId,
          sourceAssetIds: form.sourceAssetIds,
          durationSeconds: form.durationSeconds,
          aspectRatio: form.reelAspect,
          style: form.style,
          goal: form.goal,
        },
      };
  }
}

/**
 * What is still missing before a tool can run.
 *
 * Returns the user-facing sentence, or null when the form is complete. The
 * server validates all of this again — this only exists so the button can
 * explain itself instead of failing a round-trip.
 */
export function missingRequirement(
  tool: ToolId,
  brandId: string,
  form: CreativeFormState
): string | null {
  if (!brandId) return 'Select a brand.';

  switch (tool) {
    case 'copy':
    case 'reel':
      return form.instruction.trim().length === 0 ? 'Describe what you want.' : null;

    case 'photo':
      if (!form.productId) return 'Select a product.';
      if (!form.sourceAssetId) return 'Select the source photo.';
      if (!form.style.trim()) return 'Describe the style.';
      if (!form.scene.trim()) return 'Describe the scene.';
      return null;

    case 'video':
      if (!form.productId) return 'Select a product.';
      if (form.sourceAssetIds.length === 0) return 'Select at least one source asset.';
      if (!form.style.trim()) return 'Describe the style.';
      if (!form.goal.trim()) return 'Describe the goal.';
      return null;
  }
}

/** Which provider credential each tool needs beyond the text model. */
export const TOOL_CAPABILITY: Record<ToolId, 'ai' | 'image' | 'video'> = {
  copy: 'ai',
  reel: 'ai',
  photo: 'image',
  video: 'video',
};

/**
 * Does a response actually look like what this tool asked for?
 *
 * Found by a test that fed a copy response to the reel tool: the studio
 * rendered it straight into `ReelResult`, which read `script.scenes` and took
 * the whole page down with an unhandled TypeError. A route returning an
 * unexpected shape — a changed contract, an error body that slipped out with a
 * 2xx — should surface as a message, not a white screen.
 *
 * This is a shape check, not validation: the server is authoritative about the
 * content, and duplicating its schemas here would only rot.
 */
export function isExpectedShape(tool: ToolId, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Record<string, unknown>;

  switch (tool) {
    case 'copy':
      return Array.isArray(payload.variations);

    case 'reel': {
      const script = payload.script as { scenes?: unknown } | undefined;
      return Boolean(script) && Array.isArray(script?.scenes);
    }

    case 'photo':
    case 'video':
      return typeof payload.jobId === 'string' && typeof payload.state === 'string';
  }
}
