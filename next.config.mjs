/** @type {import('next').NextConfig} */

// Kept in sync with src/lib/security/headers.ts (baseSecurityHeaders).
// Duplicated rather than imported because next.config.mjs is loaded outside the
// TypeScript path-alias graph. The per-request CSP (which needs a nonce) is
// applied in src/middleware.ts instead.
const baseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework version to attackers.
  poweredByHeader: false,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'generativelanguage.googleapis.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: baseSecurityHeaders,
      },
      {
        // API responses must never be cached by a shared proxy — they are
        // per-user and several carry authorization-dependent content.
        source: '/api/:path*',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
