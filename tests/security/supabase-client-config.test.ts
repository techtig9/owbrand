import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toErrorResponse } from '@/lib/api/errors';

/**
 * Every Supabase client factory must read its configuration through the
 * validated env module.
 *
 * This is a regression test for a defect found by probing a live deployment,
 * not by reading code. All four factories used `process.env.X!`. The `!`
 * satisfied TypeScript and, at runtime with the variable absent, produced
 * supabase-js's own error:
 *
 *   "Your project's URL and Key are required to create a Supabase client!"
 *
 * Nothing downstream could classify that string. lib/api/errors.ts turned it
 * into a generic 500 and lib/auth/auth-errors.ts into "Something went wrong.
 * Please try again." — so on a deployment missing its credentials, every gated
 * route told the caller to retry a problem only an operator could fix, and the
 * env module built to prevent exactly this was bypassed at every call site.
 *
 * The assertions below are about WHICH error is thrown, because that is what
 * every layer above depends on.
 */

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('a Supabase factory with no configuration', () => {
  it('supabaseAdmin throws our MissingEnvError, not supabase-js prose', () => {
    let thrown: unknown;
    try {
      supabaseAdmin();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('MissingEnvError');
    expect((thrown as Error).message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    // The exact string the `!` used to produce.
    expect((thrown as Error).message).not.toContain('required to create a Supabase client');
  });

  it('supabaseBrowser throws our MissingEnvError too', () => {
    let thrown: unknown;
    try {
      supabaseBrowser();
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).name).toBe('MissingEnvError');
    expect((thrown as Error).message).not.toContain('required to create a Supabase client');
  });

  /*
   * The point of the change: the error now reaches the API layer as a
   * classifiable 503 rather than an opaque 500. Asserted end to end, because
   * the two halves were committed separately and only the pair is useful —
   * mapping MissingEnvError does nothing while the factories never throw it.
   */
  it('surfaces as a 503 not_configured through the API error handler', async () => {
    let thrown: unknown;
    try {
      supabaseAdmin();
    } catch (error) {
      thrown = error;
    }

    const response = toErrorResponse(thrown);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('not_configured');
  });
});

describe('a Supabase factory WITH configuration', () => {
  /*
   * Positive control. Without it, a factory that threw unconditionally would
   * pass every assertion above.
   */
  it('constructs a client', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

    expect(supabaseAdmin()).toBeTruthy();
    expect(supabaseBrowser()).toBeTruthy();
  });
});
