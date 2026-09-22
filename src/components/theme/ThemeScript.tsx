/**
 * Applies the stored theme before first paint.
 *
 * Without this, a dark-theme user sees a white flash on every navigation that
 * reaches the server: React cannot set an attribute on <html> until hydration,
 * and hydration is thousands of milliseconds after first paint on a cold load.
 *
 * Two constraints shape the implementation:
 *
 *   1. It must be INLINE and synchronous in <head>. An external script or a
 *      deferred one runs after the first paint, which is the flash.
 *   2. The app runs a strict CSP with `strict-dynamic` on dynamic routes, so an
 *      inline script without the per-request nonce is blocked outright — and a
 *      blocked theme script fails silently, which is the worst kind of bug.
 *      The nonce is threaded from middleware through the root layout.
 *
 * The script is deliberately tiny and defensive: `localStorage` throws outright
 * in some contexts (Safari private mode, embedded webviews, site-data blocked),
 * and an exception here would abort parsing before the page renders at all.
 */
export function ThemeScript({ nonce }: { nonce?: string }) {
  const script = `(function(){try{var t=localStorage.getItem('owbrand-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

  return (
    <script
      nonce={nonce}
      // The content is a fixed string literal defined above — no interpolation
      // of anything user-controlled, which is what makes this safe.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
