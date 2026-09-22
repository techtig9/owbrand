import { describe, expect, it } from 'vitest';
import { checkUrl, checkUrls, isSafeUrl } from '@/lib/security/safe-url';

/**
 * The cases here are the ones a regex-based check gets wrong. A test suite
 * that only tries `http://localhost` proves nothing: every naive implementation
 * passes that one.
 */

describe('ordinary URLs', () => {
  it('accepts a normal https URL', () => {
    expect(isSafeUrl('https://cdn.example.com/image.jpg')).toBe(true);
  });

  it('accepts an explicit :443', () => {
    expect(isSafeUrl('https://cdn.example.com:443/image.jpg')).toBe(true);
  });

  it('accepts a public IP literal', () => {
    // 8.8.8.8 is public. Blocking all literals would be easier and would also
    // block legitimate CDN pinning, so the check must be by range.
    expect(isSafeUrl('https://8.8.8.8/x.png')).toBe(true);
  });
});

describe('schemes', () => {
  it.each([
    'http://example.com/x.png',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com:70/x',
    'data:text/plain;base64,aGk=',
  ])('rejects %s', (raw) => {
    expect(isSafeUrl(raw)).toBe(false);
  });
});

describe('loopback and private ranges', () => {
  it.each([
    ['https://localhost/x', 'the obvious one'],
    ['https://127.0.0.1/x', 'loopback'],
    ['https://127.1/x', 'short-form loopback, normalised by URL to 127.0.0.1'],
    ['https://2130706433/x', 'loopback as a decimal integer'],
    ['https://0x7f000001/x', 'loopback in hex'],
    ['https://0177.0.0.1/x', 'loopback in octal'],
    ['https://10.0.0.5/x', 'RFC1918'],
    ['https://172.16.0.1/x', 'RFC1918, bottom of the range'],
    ['https://172.31.255.255/x', 'RFC1918, top of the range'],
    ['https://192.168.1.1/x', 'RFC1918'],
    ['https://0.0.0.0/x', 'this network'],
    ['https://100.64.0.1/x', 'CGNAT — shared address space, not public'],
  ])('rejects %s (%s)', (raw) => {
    expect(isSafeUrl(raw)).toBe(false);
  });

  it('accepts 172.32.0.1, which is just outside RFC1918', () => {
    // A positive control. Without it, a check that blocked all of 172/8 would
    // pass every test above while being wrong.
    expect(isSafeUrl('https://172.32.0.1/x')).toBe(true);
  });
});

describe('cloud metadata', () => {
  it('rejects the link-local metadata address', () => {
    expect(isSafeUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejects metadata.google.internal by NAME', () => {
    // The whole point: a range check never sees this one, because it is a
    // hostname and its address is only known after resolution.
    expect(isSafeUrl('https://metadata.google.internal/computeMetadata/v1/')).toBe(false);
  });

  it('rejects other .internal names', () => {
    expect(isSafeUrl('https://vault.internal/v1/secret')).toBe(false);
  });
});

describe('IPv6', () => {
  it.each([
    'https://[::1]/x',
    'https://[::]/x',
    'https://[fe80::1]/x',
    'https://[fd00::1]/x',
    'https://[fc00::1]/x',
    // Loopback written as IPv6. A check that only matched IPv6 prefixes would
    // let this through and reach 127.0.0.1.
    'https://[::ffff:127.0.0.1]/x',
    'https://[::ffff:10.0.0.1]/x',
  ])('rejects %s', (raw) => {
    expect(isSafeUrl(raw)).toBe(false);
  });

  it('accepts a public IPv6 address', () => {
    expect(isSafeUrl('https://[2606:4700:4700::1111]/x')).toBe(true);
  });
});

describe('parser ambiguity', () => {
  it('rejects embedded credentials', () => {
    // Reads as trusted.example.com to a human.
    expect(isSafeUrl('https://evil.example.com@trusted.example.com/x')).toBe(false);
  });

  it('rejects a non-default port', () => {
    expect(isSafeUrl('https://example.com:8500/v1/kv/')).toBe(false);
  });

  it('rejects .local mDNS names', () => {
    expect(isSafeUrl('https://printer.local/x')).toBe(false);
  });

  it('rejects an unparseable string', () => {
    expect(isSafeUrl('not a url at all')).toBe(false);
  });
});

describe('reported reasons', () => {
  it('does not disclose which range matched', () => {
    // Naming the range tells a prober which check fired and lets them map the
    // internal network by bisection.
    const reason = checkUrl('https://10.0.0.5/x').reason ?? '';
    expect(reason).not.toMatch(/10\.|private|rfc1918|loopback/i);
  });

  it('points at the offending entry in a list', () => {
    const result = checkUrls([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      'https://169.254.169.254/c.jpg',
    ]);
    expect(result.ok).toBe(false);
    expect(result.index).toBe(2);
  });

  it('accepts a wholly valid list', () => {
    expect(checkUrls(['https://a.example.com/1.jpg', 'https://b.example.com/2.jpg']).ok).toBe(true);
  });
});
