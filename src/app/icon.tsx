import { ImageResponse } from 'next/og';

/**
 * The favicon, generated for the same reason as the OG image.
 *
 * Before this, the app shipped no icon at all: every page load produced a 404
 * for /favicon.ico, and browser tabs showed a blank document glyph.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // --color-primary. Light text on it clears 4.5:1, which matters even
        // at 32px: a favicon is rendered at 16px on most tabs.
        background: '#4338ca',
        borderRadius: 7,
        color: '#ffffff',
        fontSize: 22,
        fontWeight: 800,
        fontFamily: 'sans-serif',
      }}
    >
      o
    </div>,
    size
  );
}
