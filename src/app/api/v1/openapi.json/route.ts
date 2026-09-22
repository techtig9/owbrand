import { NextResponse } from 'next/server';
import { openApiDocument } from '@/lib/api/v1/openapi';

export const dynamic = 'force-dynamic';

/**
 * The machine-readable spec.
 *
 * Public and unauthenticated: a spec behind a key cannot be used by the tools
 * that make a spec worth publishing — client generators, Postman, an evaluator
 * deciding whether to integrate at all. It describes the shape of the API, not
 * anybody's data.
 */
export async function GET() {
  return NextResponse.json(openApiDocument(), {
    headers: {
      // Short: the spec changes with a deploy, and a stale cached spec is how
      // an integrator debugs against documentation that no longer applies.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
