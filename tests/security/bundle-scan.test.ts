import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Tests for the bundle secret scanner.
 *
 * These exist because the scanner shipped in a state where a planted
 * service-role key scanned CLEAN. The base64 fragment it matched on was
 * guessed rather than derived, and base64 encodes three bytes at a time — the
 * same substring produces a different string at each byte offset. A scanner
 * nobody has watched fail is indistinguishable from one that always passes,
 * so every pattern below is checked against a planted secret AND against the
 * thing it must not confuse with one.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bundle-scan-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function scan(content: string): Promise<{ code: number; stdout: string }> {
  await writeFile(join(dir, 'chunk.js'), content);
  try {
    const { stdout } = await run('node', ['scripts/scan-bundle.mjs', dir]);
    return { code: 0, stdout };
  } catch (error) {
    const err = error as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: `${err.stdout}${err.stderr}` };
  }
}

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${body}.signature`;
}

describe('Supabase keys', () => {
  it('catches a service-role key', async () => {
    const result = await scan(`var k="${jwt({ iss: 'supabase', role: 'service_role' })}";`);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/service-role/i);
  });

  it('catches it at a different byte alignment', async () => {
    // The bug that shipped. Adding a claim shifts `"role":"service_role"` to a
    // different offset, and a single-fragment check misses it entirely.
    const result = await scan(
      `var k="${jwt({ iss: 'supabase', ref: 'abcd', role: 'service_role' })}";`
    );
    expect(result.code).toBe(1);
  });

  it('catches it at a third alignment', async () => {
    const result = await scan(`var k="${jwt({ ref: 'ab', role: 'service_role' })}";`);
    expect(result.code).toBe(1);
  });

  it('IGNORES the anon key', async () => {
    // The anon key is a JWT of identical shape and belongs in the bundle. A
    // scanner that flags it would be turned off within a day.
    const result = await scan(`var k="${jwt({ iss: 'supabase', role: 'anon' })}";`);
    expect(result.code).toBe(0);
  });
});

describe('provider credentials', () => {
  it.each([
    ['Anthropic', 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['Google', 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['Resend', 're_AAAAAAAAAAAAAAAAAAAAAAAA'],
    ['GitHub', 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ])('catches a %s key', async (_name, secret) => {
    const result = await scan(`const c={key:"${secret}"};`);
    expect(result.code).toBe(1);
  });

  it('never prints the matched value', async () => {
    const secret = 'sk-ant-api03-SUPERSECRETVALUEDONOTPRINT';
    const result = await scan(`const c={key:"${secret}"};`);
    expect(result.code).toBe(1);
    // CI logs are public on a public repository. Printing the secret to prove
    // it leaked would leak it again, somewhere with longer retention.
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain('SUPERSECRET');
  });
});

describe('ordinary bundles', () => {
  it('passes clean JavaScript', async () => {
    const result = await scan('export function add(a,b){return a+b}');
    expect(result.code).toBe(0);
  });

  it('does not fail on a server variable NAME', async () => {
    // Next inlines the value and drops the name, so a bare name cannot be
    // evidence of a leak — and the app deliberately shows these names in its
    // "Not configured" states.
    const result = await scan('var msg="Set ANTHROPIC_API_KEY and restart.";');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/names, not values/i);
  });
});

describe('the scan itself', () => {
  it('fails when there is nothing to scan', async () => {
    // A scanner that reports success on a missing build directory is the
    // quiet failure mode: it "protects" the repository for months.
    try {
      await run('node', ['scripts/scan-bundle.mjs', join(dir, 'does-not-exist')]);
      throw new Error('expected a non-zero exit');
    } catch (error) {
      expect((error as { code: number }).code).toBe(1);
    }
  });
});
