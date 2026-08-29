export type PhotoGenerationInput = {
  prompt: string;
  sourceImageUrl?: string;
  aspectRatio?: string;
  count?: number;
  metadata?: Record<string, unknown>;
};

export type PhotoGenerationResult = {
  provider: string;
  assets: Array<{ url: string; metadata?: Record<string, unknown> }>;
};

/**
 * Provider-neutral adapter. OwBrand never hard-codes a media vendor into the UI.
 *
 * The production provider must expose a server-to-server JSON endpoint configured by
 * IMAGE_PROVIDER_URL and return { assets: [{ url, metadata? }] }. This keeps the
 * product ready for whichever image model/provider the owner selects, without
 * pretending a provider is configured when it is not.
 */
export async function generateProductPhotos(input: PhotoGenerationInput): Promise<PhotoGenerationResult> {
  const url = process.env.IMAGE_PROVIDER_URL;
  const apiKey = process.env.IMAGE_PROVIDER_API_KEY;
  if (!url || !apiKey) {
    throw new Error('Image generation provider is not configured. Set IMAGE_PROVIDER_URL and IMAGE_PROVIDER_API_KEY.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Image provider returned ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data.assets)) throw new Error('Image provider returned an invalid response.');
  return { provider: process.env.IMAGE_PROVIDER || 'custom', assets: data.assets };
}
