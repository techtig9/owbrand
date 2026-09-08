/**
 * Request parsing and validation helpers.
 *
 * Every route body and query string goes through a Zod schema here. Failures
 * become a 400 with field-level detail (safe to expose — it describes only what
 * the caller sent), never an unhandled throw.
 */
import { z, type ZodTypeAny, type output as ZodOutput } from 'zod';
import { ApiError } from '@/lib/api/errors';

const MAX_BODY_BYTES = 1_000_000; // 1 MB — JSON bodies are metadata, not uploads.

/**
 * Reads and validates a JSON request body.
 * Rejects non-JSON content types, oversized payloads and malformed JSON before
 * the schema ever runs.
 */
/*
 * NOTE ON THE GENERIC. These take the SCHEMA as the type parameter and derive
 * the result with `z.output<S>`, rather than the more obvious
 * `ZodType<T>` + `Promise<T>`.
 *
 * `ZodType<T>` expands to `ZodType<T, ZodTypeDef, T>`, so T has to satisfy the
 * input AND the output type. TypeScript then picks the input — which for any
 * schema using `.default()` or `.transform()` still has those fields optional.
 * Call sites ended up with `string | undefined` for a field the schema
 * guarantees, and had to re-check values Zod had already filled in.
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S
): Promise<ZodOutput<S>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw ApiError.invalid('Expected a JSON request body.');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    throw ApiError.invalid('Request body is too large.');
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw ApiError.invalid('Could not read the request body.');
  }

  if (raw.length > MAX_BODY_BYTES) {
    throw ApiError.invalid('Request body is too large.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw ApiError.invalid('Request body is not valid JSON.');
  }

  return validate(schema, parsed);
}

/** Validates already-materialised data against a schema. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): ZodOutput<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.invalid('Some of the details you sent were not valid.', {
      fields: result.error.flatten().fieldErrors,
    });
  }
  return result.data;
}

/** Validates search params against a schema built from an object shape. */
export function parseSearchParams<S extends ZodTypeAny>(request: Request, schema: S): ZodOutput<S> {
  const url = new URL(request.url);
  const entries: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    entries[key] = value;
  });
  return validate(schema, entries);
}

/* ------------------------------------------------------------------ *
 * Shared primitives
 * ------------------------------------------------------------------ */

export const uuidSchema = z.string().uuid('Must be a valid id.');

/** Trimmed, length-bounded free text. */
export const boundedText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max));

export const socialPlatformSchema = z.enum([
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'pinterest',
  'x',
]);

/** Platforms OwBrand can actually publish to today. Keep honest and narrow. */
export const supportedPublishPlatformSchema = z.enum(['facebook', 'instagram']);
