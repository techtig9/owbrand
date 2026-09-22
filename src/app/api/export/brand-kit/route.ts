import { NextResponse } from 'next/server';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { checkUrl } from '@/lib/security/safe-url';
import { publicEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import {
  cssTokens,
  tailwindFragment,
  scssVariables,
  paletteHtml,
  voiceGuide,
  kitReadme,
} from '@/lib/brand/kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The brand-kit archive.
 *
 * Streamed rather than buffered: the logo can be several megabytes, and
 * building the whole zip in memory before responding is how a route that
 * works for every test brand falls over on the first real one.
 *
 * Distinct from `/api/export/export-zip`, which exports a generated WEBSITE.
 * The names are close enough to be worth stating: this one is the brand
 * itself — tokens, palette, voice — and is what a customer means when they ask
 * for "the brand kit to send to our agency".
 */
export const GET = routeHandler('/api/export/brand-kit', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('billing', user.id);

  const brandId = new URL(request.url).searchParams.get('brandId');
  if (!brandId) throw ApiError.invalid('A brandId is required.');

  const db = supabaseAdmin();
  const brand = await assertBrandAccess(user.id, brandId, { db, columns: 'name,logo_url' });

  const brain = await getCurrentBrandBrain(brandId, db);
  if (!brain) {
    throw ApiError.invalid(
      'This brand has no Brand Brain yet, so there is nothing to export. Build one first.'
    );
  }

  const { data: subscription } = await db
    .from('subscriptions')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  // Free-plan attribution only, and from publicEnv so a self-hosted export
  // does not advertise somebody else's deployment.
  const attribution =
    (subscription?.plan ?? 'free') === 'free' ? `\n---\n\nMade with owbrand — ${publicEnv.siteUrl}\n` : '';

  const logoUrl = (brand as { logo_url?: string | null }).logo_url ?? null;
  let logo: { buffer: Buffer; name: string } | null = null;

  if (logoUrl) {
    /*
     * The logo is fetched from a URL on the brand row, which means this is the
     * second place in the product that fetches an address we did not choose.
     * Same guard as the webhook sender, for the same reason — and a failure to
     * fetch it degrades to a kit without a logo rather than a failed export,
     * because the tokens and the voice guide are the valuable parts.
     */
    const check = checkUrl(logoUrl);
    if (!check.ok) {
      logger.warn('brand_kit:logo_refused', { brandId, reason: check.reason });
    } else {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(logoUrl, { signal: controller.signal, redirect: 'manual' });
        clearTimeout(timeout);

        if (response.ok) {
          const bytes = await response.arrayBuffer();
          // 10 MB ceiling: past that it is not a logo, and streaming it into
          // the archive would tie up the function for no benefit.
          if (bytes.byteLength <= 10_000_000) {
            const type = response.headers.get('content-type') ?? '';
            const extension = type.includes('svg')
              ? 'svg'
              : type.includes('png')
                ? 'png'
                : type.includes('webp')
                  ? 'webp'
                  : 'jpg';
            logo = { buffer: Buffer.from(bytes), name: `logo/logo.${extension}` };
          }
        }
      } catch {
        // Deliberately swallowed. See the note above: a kit without a logo is
        // far better than no kit.
        logger.info('brand_kit:logo_unavailable', { brandId });
      }
    }
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = new PassThrough();
  archive.pipe(stream);

  archive.append(kitReadme(brain, attribution, logo !== null), { name: 'README.md' });
  archive.append(voiceGuide(brain), { name: 'VOICE.md' });
  archive.append(cssTokens(brain), { name: 'tokens/tokens.css' });
  archive.append(tailwindFragment(brain), { name: 'tokens/tailwind.config.js' });
  archive.append(scssVariables(brain), { name: 'tokens/_variables.scss' });
  archive.append(paletteHtml(brain), { name: 'palette.html' });
  archive.append(JSON.stringify(brain, null, 2), { name: 'brand-brain.json' });

  if (logo) archive.append(logo.buffer, { name: logo.name });

  void archive.finalize();

  logger.info('brand_kit:exported', { brandId, withLogo: logo !== null });

  const filename = `${brand.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-brand-kit.zip`;

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, private',
    },
  });
});
