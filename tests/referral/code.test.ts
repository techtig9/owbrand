import { describe, expect, it } from 'vitest';

/**
 * The code generator is tested through the module's own export surface by
 * exercising `ensureReferralCode` against a fake db, because the generator
 * itself is deliberately private — it has no callers outside this module and
 * exporting it for a test would widen the API for no reason.
 */
import { ensureReferralCode } from '@/lib/referral/referral';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * A minimal fake of the two calls `ensureReferralCode` makes. Enough to
 * observe the generated codes without a database.
 */
function fakeDb(options: { existing?: string | null; failFirst?: number } = {}) {
  const assigned: string[] = [];
  let failures = options.failFirst ?? 0;

  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: options.existing === undefined ? null : { referral_code: options.existing },
                }),
              };
            },
          };
        },
        update(patch: { referral_code: string }) {
          return {
            eq: async () => {
              assigned.push(patch.referral_code);
              if (failures > 0) {
                failures -= 1;
                // 23505 = unique_violation, the collision path.
                return { error: { code: '23505', message: 'duplicate key' } };
              }
              return { error: null };
            },
          };
        },
      };
    },
  };

  return { db: db as never, assigned };
}

describe('referral codes', () => {
  it('returns the existing code without generating a new one', async () => {
    const { db, assigned } = fakeDb({ existing: 'ABCD2345' });

    expect(await ensureReferralCode('user-1', db)).toBe('ABCD2345');
    // Regenerating would change a code the user may already have shared.
    expect(assigned).toHaveLength(0);
  });

  it('generates an 8-character code from the safe alphabet', async () => {
    const { db } = fakeDb();
    const code = await ensureReferralCode('user-1', db);

    expect(code).toHaveLength(8);
    for (const character of code) expect(ALPHABET).toContain(character);
  });

  it('never emits a look-alike character', async () => {
    const { db } = fakeDb();

    // I/L/O and 0/1 are excluded because a transcription slip on a code that
    // grants credits does not fail — it credits a different real person.
    for (let i = 0; i < 200; i += 1) {
      const code = await ensureReferralCode(`user-${i}`, db);
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it('retries on a unique-violation instead of failing', async () => {
    const { db, assigned } = fakeDb({ failFirst: 2 });
    const code = await ensureReferralCode('user-1', db);

    // Without the retry, one unlucky user gets a permanent 500 on the referral
    // page with no obvious cause.
    expect(code).toHaveLength(8);
    expect(assigned).toHaveLength(3);
    expect(new Set(assigned).size).toBe(3); // each attempt was a fresh code
  });

  it('does not retry a non-collision database error', async () => {
    const db = {
      from() {
        return {
          select() {
            return { eq: () => ({ maybeSingle: async () => ({ data: null }) }) };
          },
          update() {
            return {
              eq: async () => ({ error: { code: '42501', message: 'permission denied' } }),
            };
          },
        };
      },
    } as never;

    // Retrying a permission error five times just delays the failure and
    // hides its cause behind "could not create a unique code".
    await expect(ensureReferralCode('user-1', db)).rejects.toThrow(/Could not create a referral code/);
  });

  /*
   * Distribution check for the rejection sampling.
   *
   * `byte % 31` leaves 256 - 248 = 8 residues over-represented, making the
   * first 8 symbols ~12% likelier. This asserts the shape of the output rather
   * than the implementation: over enough samples every symbol should appear,
   * and no symbol should dominate.
   */
  it('uses the whole alphabet without a heavy skew', async () => {
    const { db } = fakeDb();
    const seen = new Map<string, number>();
    const samples = 400;

    for (let i = 0; i < samples; i += 1) {
      for (const character of await ensureReferralCode(`user-${i}`, db)) {
        seen.set(character, (seen.get(character) ?? 0) + 1);
      }
    }

    expect(seen.size).toBe(ALPHABET.length);

    const counts = [...seen.values()];
    const expected = (samples * 8) / ALPHABET.length;
    // Generous bound: this is a smoke test for a gross skew, not a chi-squared
    // test. A 12% modulo bias would not reliably trip this, which is why the
    // fix is in the code and documented rather than asserted statistically.
    expect(Math.max(...counts)).toBeLessThan(expected * 1.8);
    expect(Math.min(...counts)).toBeGreaterThan(expected * 0.4);
  });
});
