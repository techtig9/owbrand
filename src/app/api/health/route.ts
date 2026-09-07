import { NextResponse } from 'next/server';

/**
 * Liveness probe — is the process up and serving?
 *
 * Deliberately public and deliberately uninformative: a load balancer needs
 * this, and an attacker should learn nothing from it. Build version and
 * dependency status moved to /api/ready, which requires admin for detail.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { ok: true, service: 'owbrand' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
