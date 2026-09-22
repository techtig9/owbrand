import type { Metadata } from 'next';
import Link from 'next/link';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { Badge } from '@/components/ui';

export const metadata: Metadata = {
  title: 'API — OwBrand',
  description: 'Read access to your brands, posts and generated content, plus signed webhooks.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/docs/api') },
};

/**
 * The API documentation.
 *
 * Written as a page rather than a Swagger UI embed, for two reasons. The
 * generated viewer needs a large third-party bundle that the CSP would have to
 * be loosened for, and — more to the point — the things an integrator actually
 * gets wrong here are not shapes. They are: the key is shown once, the cursor
 * is a timestamp, an inaccessible brand returns an empty list rather than a
 * 403, and a webhook signature covers `timestamp.body` and not the body alone.
 * A shape viewer renders none of that. The machine-readable spec is linked for
 * tooling.
 *
 * Every example below is real: the endpoints exist, the signature snippet is
 * the same algorithm the sender uses, and nothing is described that has not
 * been built.
 */

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-[color:var(--color-border)] bg-surface-raised p-4 text-xs leading-6">
      <code className="font-mono text-content">{children}</code>
    </pre>
  );
}

export default function ApiDocsPage() {
  const base = `${publicEnv.siteUrl.replace(/\/$/, '')}/api/v1`;

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="border-b border-[color:var(--color-border)] py-20">
          <div className="mx-auto max-w-3xl px-6">
            <span className="section-eyebrow">API</span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">The OwBrand API</h1>
            <p className="mt-5 text-base leading-7 text-content-secondary">
              Read your brands, posts and generated content. Receive signed webhooks when something
              is published.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Badge tone="info">v1</Badge>
              <Badge tone="neutral">read-only</Badge>
              <a
                href="/api/v1/openapi.json"
                className="text-sm text-primary underline underline-offset-2"
              >
                OpenAPI spec
              </a>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-3xl space-y-14 px-6 py-16">
          <section>
            <h2 className="text-xl font-semibold text-content">Authentication</h2>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Create a key in{' '}
              <Link href="/dashboard/settings" className="text-primary underline underline-offset-2">
                Settings
              </Link>
              . It is shown once and stored only as a hash, so it cannot be recovered — if you lose
              it, revoke it and issue another.
            </p>
            <Code>{`curl ${base}/brands \\
  -H "Authorization: Bearer owb_live_…"`}</Code>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              A missing, malformed, revoked or expired key all return the same 401. That is
              deliberate: telling you which one would tell someone guessing keys that a particular
              guess was once real.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-content">Pagination</h2>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Responses carry <code className="font-mono text-xs">data</code> and{' '}
              <code className="font-mono text-xs">nextCursor</code>. The cursor is a timestamp, not
              an offset — with offsets, a row created between two of your requests shifts every
              later page, so you see one item twice and miss another. Loop until the cursor is null.
            </p>
            <Code>{`{
  "data": [ { "id": "…", "name": "Acme", "created_at": "2026-09-20T10:00:00Z" } ],
  "nextCursor": "2026-09-20T10:00:00Z"
}`}</Code>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-content">Endpoints</h2>
            <dl className="mt-4 space-y-5">
              {[
                ['GET /brands', 'The brands this key can access.'],
                [
                  'GET /posts',
                  'Scheduled and published posts. Filter with brandId and status. A brandId you cannot access returns an empty list, not a 403 — a 403 would confirm that brand exists.',
                ],
                ['GET /content', 'Generated content assets.'],
              ].map(([signature, description]) => (
                <div key={signature} className="rounded-xl border border-[color:var(--color-border)] p-4">
                  <dt className="font-mono text-sm font-semibold text-content">{signature}</dt>
                  <dd className="mt-1.5 text-sm leading-6 text-content-secondary">{description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-7 text-content-secondary">
              There are no write endpoints yet, and none are listed as &ldquo;coming soon&rdquo;. A
              write endpoint has to decide what happens when generated copy is blocked by the
              factuality guard with nobody watching, and shipping one before answering that is how
              an API starts silently discarding work.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-content">Rate limits</h2>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              120 requests per minute, counted per key rather than per account — so a staging
              integration and a production one do not share a bucket, and one can be revoked without
              affecting the other. A 429 carries{' '}
              <code className="font-mono text-xs">details.retryAfterSeconds</code>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-content">Webhooks</h2>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Add an endpoint in Settings and pick the events. Delivery is at-least-once: a response
              that times out after you committed is indistinguishable from one that never arrived,
              so we retry. Use the{' '}
              <code className="font-mono text-xs">X-OwBrand-Delivery</code> header to deduplicate.
            </p>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Failures back off (30s, 2m, 8m, 32m, then hourly) up to five attempts. An endpoint
              that fails 20 times in a row is disabled — an address that has been gone for days
              should not be retried on every event forever.
            </p>

            <h3 className="mt-7 text-base font-semibold text-content">Verifying the signature</h3>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Every request carries{' '}
              <code className="font-mono text-xs">X-OwBrand-Signature: t=…,v1=…</code>. The HMAC
              covers <code className="font-mono text-xs">{'`${t}.${rawBody}`'}</code> — the
              timestamp is <strong>inside</strong> the MAC, not beside it. A signature over the body
              alone can be replayed forever, because nothing stops an attacker updating the
              timestamp on a captured delivery.
            </p>
            <Code>{`import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );

  // Both directions. Rejecting only OLD timestamps accepts one dated 3000,
  // which never expires — a permanent replay window.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}`}</Code>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Verify against the <em>raw</em> body. Parsing and re-serialising JSON changes key
              order and whitespace, and the signature will not match.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-content">Errors</h2>
            <p className="mt-3 text-sm leading-7 text-content-secondary">
              Every error carries a <code className="font-mono text-xs">requestId</code>. Quote it
              in a support request — it appears in our logs against that exact call, which turns
              &ldquo;it returned 500 sometimes&rdquo; into one line we can look up.
            </p>
            <Code>{`{
  "error": "That API key is not valid.",
  "code": "unauthenticated",
  "requestId": "req_9f2c1a…"
}`}</Code>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
