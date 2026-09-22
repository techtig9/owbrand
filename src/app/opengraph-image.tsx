import { ImageResponse } from 'next/og';

/**
 * The social preview card, generated rather than committed as a PNG.
 *
 * Generated because a committed image is a second place the brand's colours
 * live, and it silently goes stale the moment the palette changes — which it
 * already did once here, from coral to indigo. The values below are the token
 * values; if they drift, that is one file to fix rather than a binary to
 * re-export.
 *
 * No external fonts are fetched. `next/og` would have to download a font file
 * at request time, which adds a network dependency to an endpoint crawlers and
 * chat clients hit constantly, and fails closed to an ugly fallback when the
 * fetch is slow. The system stack renders fine at this size.
 */
export const alt = 'OwBrand — a brand operating system that generates from a stored Brand Brain';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        // --color-bg and --color-primary from src/styles/tokens.css.
        background: 'linear-gradient(135deg, #1a1c21 0%, #2a2340 55%, #4338ca 100%)',
        padding: '72px 80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: '#8b8af5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0e1016',
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          o
        </div>
        <div style={{ color: '#fafafb', fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>owbrand</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            color: '#ffffff',
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            maxWidth: 940,
          }}
        >
          Describe your brand once.
        </div>
        <div style={{ color: '#c7c9d1', fontSize: 30, lineHeight: 1.3, maxWidth: 860 }}>
          Every post, page and campaign is then generated from that same Brand Brain — not from a fresh
          prompt.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 28, color: '#9ea2ae', fontSize: 22 }}>
        <span>Brand Brain</span>
        <span>·</span>
        <span>Creative Studio</span>
        <span>·</span>
        <span>Publishing</span>
        <span>·</span>
        <span>Analytics</span>
      </div>
    </div>,
    size
  );
}
