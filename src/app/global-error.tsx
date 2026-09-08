'use client';

/**
 * Last-resort boundary for errors thrown in the root layout itself, where the
 * normal error.tsx cannot render. Must supply its own <html>/<body>, and must
 * not depend on app CSS or fonts — those may be exactly what failed.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FBF7F2',
          color: '#241F1B',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>OwBrand is temporarily unavailable</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5C554E', margin: '0 0 24px' }}>
            We hit a problem loading the application. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#241F1B',
              color: '#FBF7F2',
              border: 'none',
              borderRadius: 999,
              padding: '12px 26px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: 28, fontSize: 12, color: '#9A9188' }}>Reference: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
