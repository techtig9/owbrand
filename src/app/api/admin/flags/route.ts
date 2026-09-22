import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireAdminUser } from '@/lib/auth/guards';
import { allFlags, setFlag } from '@/lib/flags';

export const dynamic = 'force-dynamic';

const Body = z.object({
  key: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export const GET = routeHandler('/api/admin/flags', async () => {
  await requireAdminUser();
  return NextResponse.json({ flags: await allFlags() });
});

export const PATCH = routeHandler('/api/admin/flags', async (request: Request) => {
  const admin = await requireAdminUser();
  const { key, enabled } = await parseJsonBody(request, Body);

  const ok = await setFlag({ key, enabled, adminId: admin.id });
  if (!ok) throw new Error('Could not update that flag.');

  return NextResponse.json({ key, enabled });
});
