/**
 * Shared shapes for the Creative Studio.
 *
 * Kept in one place because four tools consume the same brand/product/asset
 * selection and the same factuality findings, and the previous studio had them
 * all typed as `any`.
 */

export type ToolId = 'copy' | 'reel' | 'photo' | 'video';

export interface BrandOption {
  id: string;
  name: string;
}

export interface ProductOption {
  id: string;
  name: string;
}

export interface ProductAssetOption {
  id: string;
  type: string;
  url: string | null;
  status: string;
  source: string | null;
}

export interface Finding {
  severity: 'block' | 'review';
  category: string;
  excerpt: string;
  explanation: string;
}

export interface Factuality {
  findings: Finding[];
  blocked: boolean;
  summary?: string;
}

export interface CopyVariation {
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
  rationale: string;
  factuality: Factuality;
}

export interface CopyResponse {
  variations: CopyVariation[];
  requiresReview: boolean;
  creditsRemaining: number | null;
  generation: { provider: string; model: string; attempts: number; viaFallback: boolean };
}

export interface ReelScene {
  order: number;
  durationSeconds: number;
  visual: string;
  onScreenText: string;
  voiceover: string;
  sourceAssetIndex: number | null;
  transition: 'cut' | 'fade' | 'slide' | 'zoom';
}

export interface ReelResponse {
  script: {
    concept: string;
    hook: string;
    durationSeconds: number;
    aspectRatio: string;
    scenes: ReelScene[];
    caption: string;
    hashtags: string[];
    cta: string;
    musicDirection: string;
  };
  factuality: Factuality;
  requiresReview: boolean;
  creditsRemaining: number | null;
  /** The route reports this honestly — a script is not a rendered video. */
  renderState: 'not_rendered';
  note?: string;
}

export interface MediaJobResponse {
  jobId: string;
  state: 'queued' | 'running' | 'completed' | 'failed';
  deduplicated?: boolean;
  assets?: Array<{ assetId: string; version: number; url: string }>;
  outputUrl?: string | null;
  provider?: string;
  providerJobId?: string;
  creditsRemaining?: number | null;
  requiresReview?: boolean;
  note?: string;
}

/** What the server has credentials for. Resolved server-side, never guessed. */
export interface StudioCapabilities {
  ai: boolean;
  image: boolean;
  video: boolean;
}
