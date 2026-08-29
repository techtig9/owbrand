import { trimForPrompt } from '@/lib/gemini';
import type { ContentAssetType } from '@/types';

interface BrandContext {
  name: string;
  description: string;
  colors: string[];
  fonts: string[];
}

const ASSET_SYSTEM_PROMPTS: Record<Exclude<ContentAssetType, 'reel'>, string> = {
  logo: `You are owbrand's logo generation engine. Given a brand's name, description, and palette,
produce a strict JSON spec for 3 logo concepts (wordmark, icon+wordmark, monogram): { "concepts":
[{ "style": string, "svgPrompt": string, "rationale": string }] }. No commentary.`,
  photo: `You are owbrand's on-brand image generation engine. Given the brand context, produce a
strict JSON image generation spec: { "prompt": string, "aspectRatio": string, "style": string }.
Keep the prompt under 60 words. No commentary.`,
  post: `You are owbrand's social post generator. Given the brand context and platform, produce
strict JSON: { "imagePrompt": string, "caption": string, "hashtags": string[] }. Caption under 220
characters. No commentary.`,
  content: `You are owbrand's on-brand copywriter. Given the brand context and a content type
(caption | blog snippet | headline | FAQ), produce strict JSON: { "text": string }. Match the
brand's described tone. No commentary.`,
  video: `You are owbrand's short-video planner. Gemini does NOT generate video — you only plan the
shot list and script for a compositing layer (Remotion/ffmpeg.wasm) to assemble from already-
generated assets. Given the brand context, produce strict JSON: { "durationSeconds": number
(15-60), "hook": string, "shots": [{ "prompt": string, "seconds": number, "caption": string }] }.
No commentary.`,
  ad: `You are owbrand's ad creative generator. Given the brand context, platform and objective,
produce strict JSON: { "imagePrompt": string, "headline": string, "primaryText": string, "cta":
string }. Headline under 40 characters, primaryText under 125 characters. No commentary.`,
};

export function buildContentAssetPrompt(
  type: Exclude<ContentAssetType, 'reel'>,
  brand: BrandContext,
  instruction: string,
  platform?: string
) {
  const context = [
    `Brand: ${brand.name}`,
    `Description: ${trimForPrompt(brand.description, 500)}`,
    brand.colors.length && `Palette: ${brand.colors.join(', ')}`,
    brand.fonts.length && `Fonts: ${brand.fonts.join(', ')}`,
    platform && `Platform: ${platform}`,
    `Request: ${instruction}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { systemPrompt: ASSET_SYSTEM_PROMPTS[type], userPrompt: context };
}

const REEL_SYSTEM_PROMPT = `You are owbrand's reel script planner. Gemini does NOT generate video —
you only script pacing and pick asset order for a compositing layer (Remotion/ffmpeg.wasm) to
assemble. Given the brand context and a list of already-generated asset URLs/captions, return
strict JSON: { "durationSeconds": number (15-30), "scenes": [{ "assetUrl": string, "seconds":
number, "transition": "cut"|"fade"|"slide", "caption": string }] }. No commentary.`;

export function buildReelScriptPrompt(
  brand: BrandContext,
  assets: { url: string; caption: string | null }[],
  instruction: string
) {
  const context = [
    `Brand: ${brand.name}`,
    `Description: ${trimForPrompt(brand.description, 400)}`,
    `Request: ${instruction}`,
    `Available assets:\n${assets.map((a, i) => `${i + 1}. ${a.url} — ${a.caption ?? 'no caption'}`).join('\n')}`,
  ].join('\n');

  return { systemPrompt: REEL_SYSTEM_PROMPT, userPrompt: context };
}
