import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText, userSuppliedUrl } from '@/lib/api/validate';
import { requireUser, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { generateWebhookSecret } from '@/lib/webhooks/sign';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/deliver';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  // `userSuppliedUrl`, so an endpoint pointing at a private address is
  // refused at creation — the delivery worker checks again at send time.
  url: userSuppliedUrl,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  brandId: z.string().uuid().nullable().optional(),
  name: boundedText(0, 60).optional(),
});

const DeleteBody = z.object({ endpointId: uuidSchema });

export const GET = routeHandler('/api/account/webhooks', async () => {
  const user = await requireUser();

  const [endpoints, deliveries] = await Promise.all([
    // `secret` is deliberately absent: it is shown once at creation, like the
    // API key, and a list endpoint that returns it hands every signing secret
    // to anything that can read one response.
    supabaseAdmin()
      .from('webhook_endpoints')
      .select('id, url, events, enabled, disabled_reason, brand_id, consecutive_failures, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin()
      .from('webhook_deliveries')
      .select('id, endpoint_id, event_type, status, attempts, response_status, delivered_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (endpoints.error) throw endpoints.error;

  const ownedIds = new Set((endpoints.data ?? []).map((row) => row.id));

  return NextResponse.json({
    endpoints: endpoints.data ?? [],
    // Filtered to this user's endpoints in code. The delivery query above is
    // not scoped by user — it cannot be, deliveries have no user column — so
    // this filter is the access control, not a convenience.
    deliveries: (deliveries.data ?? []).filter((row) => ownedIds.has(row.endpoint_id)),
  });
});

export const POST = routeHandler('/api/account/webhooks', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('billing', user.id);

  const body = await parseJsonBody(request, CreateBody);

  if (body.brandId) {
    const accessible = await accessibleBrandIds(user.id);
    if (!accessible.includes(body.brandId)) {
      throw ApiError.forbidden('You do not have access to that brand.');
    }
  }

  const { count } = await supabaseAdmin()
    .from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if ((count ?? 0) >= 10) {
    throw ApiError.conflict('You already have 10 endpoints. Remove one before adding another.');
  }

  const secret = generateWebhookSecret();

  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .insert({
      user_id: user.id,
      brand_id: body.brandId ?? null,
      url: body.url,
      secret,
      events: body.events,
    })
    .select('id, url, events')
    .single();

  if (error) throw error;

  logger.info('webhook:endpoint_created', { endpointId: data.id, events: body.events });

  // Returned once. A receiver cannot verify signatures without it, and we
  // cannot show it again without storing it retrievably.
  return NextResponse.json({ ...data, secret });
});

export const DELETE = routeHandler('/api/account/webhooks', async (request: Request) => {
  const user = await requireUser();
  const { endpointId } = await parseJsonBody(request, DeleteBody);

  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .delete()
    .eq('id', endpointId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound('No such endpoint.');

  return NextResponse.json({ deleted: true });
});
