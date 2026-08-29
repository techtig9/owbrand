import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * owbrand's ONLY external AI service. Every Gemini call in the product routes
 * through this file so the API key, model choice, and cost-control patterns
 * (lean prompts, streaming, caching) live in one place. Nothing else in the
 * app is allowed to call an external AI/model provider directly — see the
 * "Gemini API usage boundary" note in the product spec.
 */

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

export type GeminiTask =
  | 'website_generation'
  | 'content_generation'
  | 'reel_script'
  | 'prompt_followup'
  | 'voice_transcription'
  | 'website_edit'
  | 'product_image_analysis'
  | 'creative_brief';

/** Priority-plan users (Pro/Business) get the stronger model; everyone else gets Flash. */
function modelFor(task: GeminiTask, priority: boolean): string {
  if (task === 'website_generation' && priority) {
    return process.env.GEMINI_MODEL_PRO || 'gemini-2.0-pro';
  }
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

interface GenerateOptions {
  task: GeminiTask;
  systemPrompt: string;
  userPrompt: string;
  priority?: boolean;
  jsonSchema?: boolean; // when true, instructs the model to return raw JSON only
  maxOutputTokens?: number;
}

/**
 * Non-streaming JSON/text generation. Prompts are kept lean per-task (see the
 * prompt builders in lib/prompts/*) rather than sending large boilerplate —
 * this is the "prompt optimisation" cost-control pattern from the spec.
 */
export async function generateWithGemini({
  task,
  systemPrompt,
  userPrompt,
  priority = false,
  jsonSchema = false,
  maxOutputTokens = 4096,
}: GenerateOptions): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: modelFor(task, priority),
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens,
      responseMimeType: jsonSchema ? 'application/json' : 'text/plain',
    },
  });

  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

/**
 * Streaming generation — used by the AI Website Generator and Content Studio
 * so output can be piped straight to the live preview as it's produced
 * (better perceived speed, avoids request timeouts on long generations).
 */
export async function* streamWithGemini({
  task,
  systemPrompt,
  userPrompt,
  priority = false,
  maxOutputTokens = 8192,
}: GenerateOptions): AsyncGenerator<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: modelFor(task, priority),
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens },
  });

  const result = await model.generateContentStream(userPrompt);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

/**
 * Voice input transcription (brand/content description spoken instead of typed).
 * Audio is sent as inline base64 — keep clips short client-side (~60s) to bound cost.
 */
export async function transcribeVoice(audioBase64: string, mimeType: string): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  const result = await model.generateContent([
    { text: 'Transcribe this audio exactly. Return only the transcript text, nothing else.' },
    { inlineData: { data: audioBase64, mimeType } },
  ]);
  return result.response.text().trim();
}

/** Trims/chunks a long input (brand description, imported URL content) to a token-safe size. */
export function trimForPrompt(input: string, maxChars = 6000): string {
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars) + '\n…(truncated)';
}


/** Analyze an uploaded product image. The server fetches the private Storage object and
 * sends it to Gemini as inline data; no provider key is ever exposed to the browser. */
export async function analyzeProductImage(imageBase64: string, mimeType: string, context: string): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig: { maxOutputTokens: 1800, responseMimeType: 'application/json' },
    systemInstruction: 'You are OwBrand Product Vision AI. Analyze the supplied product photo without inventing facts. Preserve the actual product identity. Return strict JSON with product_detected, packaging_details, visible_text, dominant_colors, shape, material_or_finish, image_quality, background, risks, and creative_guidance.',
  });
  const result = await model.generateContent([
    { text: `Business/product context: ${context}` },
    { inlineData: { data: imageBase64, mimeType } },
  ]);
  return result.response.text();
}
