/**
 * URL validation for anything a user supplies.
 *
 * ## What this is for, honestly
 *
 * At the time of writing, **no server-side code in this product fetches a
 * user-supplied URL.** The two places a user can submit one — media URLs on
 * publish, source images on the product pipeline — hand them to Meta, which
 * does the fetching. So this module is not closing a live SSRF hole; it is
 * making sure the next feature that *does* fetch (importing a logo, scraping a
 * site to seed a Brand Brain, a webhook target) cannot introduce one silently.
 *
 * It earns its place today regardless, because a `http://192.168.1.4/x.jpg`
 * accepted into `social_posts.media_urls` is either a publish that fails
 * hours later inside a worker, or a private URL stored in a database and sent
 * to a third party. Validating at the edge turns both into a 400.
 *
 * ## Why a blocklist of ranges and not a regex
 *
 * The addresses that matter are numeric ranges, and every textual shortcut for
 * writing them (`0x7f.1`, `2130706433`, `[::ffff:127.0.0.1]`, `127.1`) is a
 * way past a pattern match. `URL` normalises IPv4 forms for us, so the check
 * runs on the parsed host, and IPv6 is handled explicitly including the
 * IPv4-mapped form that reaches loopback through an AAAA record.
 *
 * ## The limit you must not forget
 *
 * `isSafeUrl` validates a *string*. It cannot stop DNS rebinding: a hostname
 * that resolves to a public address when checked and to 169.254.169.254 when
 * fetched passes here and is unsafe at connect time. For code that actually
 * performs a fetch, `assertSafeFetchTarget` resolves the name first and checks
 * every returned address — which narrows, but does not close, the window
 * between resolution and connection. Closing it entirely requires pinning the
 * socket to the resolved address, which belongs in the fetch layer that does
 * not exist yet. That is recorded in FIXES.md rather than implied away here.
 */

export interface UrlCheck {
  ok: boolean;
  /** Safe to show a user; never contains the resolved address. */
  reason?: string;
}

const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * Hostnames that are never legitimate targets regardless of what they resolve
 * to. `metadata.google.internal` is the one that matters most: it is a plain
 * name, not an address, and a range check alone never sees it.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Suffixes that only ever resolve inside a private network. */
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home.arpa'];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 — "this network", routes to local
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT — shared, not public
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved, incl. 255.255.255.255

  return false;
}

function isPrivateIPv6(host: string): boolean {
  // `URL` keeps IPv6 hosts in brackets and lowercased.
  const address = host.replace(/^\[|\]$/g, '').toLowerCase();

  if (address === '::' || address === '::1') return true; // unspecified, loopback
  if (address.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(address)) return true; // unique local (fc00::/7)

  /*
   * IPv4-mapped and IPv4-compatible forms. `::ffff:127.0.0.1` is loopback
   * written as IPv6, and a check that only looked at IPv6 prefixes waves it
   * through.
   *
   * BOTH spellings have to be handled, because `URL` rewrites the dotted form
   * into hextets: `[::ffff:127.0.0.1]` parses to `[::ffff:7f00:1]`. Matching
   * only the dotted notation — which is the form an attacker types, the form
   * every write-up uses, and the form this check originally had — passes the
   * obvious test and misses every real request. The test suite caught it.
   */
  const dotted = address.match(/^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) return isPrivateIPv4(dotted[1]);

  const hex = address.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const quad = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    return isPrivateIPv4(quad);
  }

  return false;
}

function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (lower.startsWith('[')) return isPrivateIPv6(lower);
  if (isPrivateIPv4(lower)) return true;

  return false;
}

/**
 * Validates a user-supplied URL string.
 *
 * Returns a reason rather than throwing, because most callers want to report
 * which of several URLs was rejected and why.
 */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    // `https` only. Plain http would send the request, and anything a platform
    // fetches from it, over the open network — and `file:`, `gopher:` and
    // `data:` are each their own category of bad idea.
    return { ok: false, reason: 'Only https:// URLs are accepted.' };
  }

  if (url.username || url.password) {
    // `https://evil.com@trusted.com/` reads as trusted.com to a human and
    // resolves to evil.com in some parsers. Refusing credentials removes the
    // ambiguity rather than trying to resolve it.
    return { ok: false, reason: 'URLs must not contain credentials.' };
  }

  if (url.port && url.port !== '443') {
    // A non-standard port on an https URL is almost always an internal service.
    return { ok: false, reason: 'Only the default https port is accepted.' };
  }

  if (isBlockedHost(url.hostname)) {
    // Deliberately vague: naming the range tells a prober which check fired.
    return { ok: false, reason: 'That host is not reachable from this service.' };
  }

  return { ok: true };
}

export function isSafeUrl(raw: string): boolean {
  return checkUrl(raw).ok;
}

/**
 * Validates every URL in a list and reports the first failure with its index,
 * so an error message can point at the offending entry.
 */
export function checkUrls(raws: string[]): { ok: boolean; index?: number; reason?: string } {
  for (let index = 0; index < raws.length; index++) {
    const result = checkUrl(raws[index]);
    if (!result.ok) return { ok: false, index, reason: result.reason };
  }
  return { ok: true };
}

/**
 * The stricter check for code that is about to fetch the URL itself.
 *
 * Resolves the hostname and applies the same range checks to every address it
 * returns — a name that resolves to a private address fails here even though
 * the string looked fine. See the TOCTOU note in the module header: this
 * narrows the window, it does not remove it.
 *
 * Separate from `checkUrl` because it costs a DNS lookup, and the callers that
 * only store or forward a URL should not pay for one.
 */
export async function assertSafeFetchTarget(raw: string): Promise<URL> {
  const result = checkUrl(raw);
  if (!result.ok) throw new Error(result.reason ?? 'Unsafe URL.');

  const url = new URL(raw);

  // Imported lazily: this module is imported by route validation that runs in
  // contexts where `node:dns` is not available.
  const { lookup } = await import('node:dns/promises');

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error('That host could not be resolved.');
  }

  // EVERY address, not the first: a name with one public and one private
  // record is a rebinding primitive, and which one a fetch uses is not ours
  // to predict.
  for (const { address } of addresses) {
    const blocked = address.includes(':') ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (blocked) throw new Error('That host is not reachable from this service.');
  }

  return url;
}
