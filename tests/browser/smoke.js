/**
 * Phase 1 browser smoke test.
 *
 * Drives the real production build in Chromium and checks the things only a
 * browser can verify: that pages actually render, that the CSP does not block
 * the app's own scripts, that forms are accessible, and that no console errors
 * are thrown. Supabase is pointed at a non-existent project, so anything
 * requiring a live session is out of scope here and is covered by the SQL and
 * Vitest suites instead.
 */
const { chromium } = require('playwright-core');

/*
 * Requires a running production build:
 *
 *   npm run build && npm run start
 *   node tests/browser/smoke.js
 *
 * BASE_URL overrides the target (default http://localhost:3100).
 * CHROME_PATH overrides the browser binary.
 *
 * Supabase does not need to be reachable: anything requiring a live session is
 * covered by supabase/test/rls-tests.sql and the Vitest suites instead. What
 * this harness proves is what only a browser can — that pages hydrate, that the
 * CSP does not block the app's own scripts, that forms are labelled and
 * validate, and that no viewport produces horizontal overflow.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const results = [];

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${passed || !detail ? '' : `   [${detail}]`}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Collect problems as we browse.
  const consoleErrors = [];
  const cspViolations = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      // Requests to the fake Supabase host are expected to fail.
      if (/supabase\.co|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(text)) return;
      // Next falling back to a browser navigation when a client-side
      // transition hits our auth redirect. Handled gracefully by design.
      if (/Failed to fetch RSC payload/i.test(text)) return;
      consoleErrors.push(text);
    }
    if (/Content Security Policy/i.test(text)) cspViolations.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  /* ---------------------------------------------------------------- *
   * Landing page
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  record('landing: renders with a level-1 heading', (await page.locator('h1').count()) > 0);
  // Real hydration probe: React must have attached its root container.
  record(
    'landing: hydrates (React root attached)',
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some((el) =>
        Object.keys(el).some((k) => k.startsWith('__react')),
      ),
    ),
  );
  record('landing: has a title', (await page.title()).length > 0, await page.title());

  // Pricing is a client component with a monthly/yearly toggle — proves
  // interactivity survived the CSP nonce.
  const yearly = page.getByRole('button', { name: /yearly/i }).first();
  if (await yearly.count()) {
    const before = await yearly.getAttribute('class');
    await yearly.click();
    await page.waitForTimeout(300);
    const after = await yearly.getAttribute('class');
    // The active tab restyles itself, so a changed class proves the click was
    // handled by hydrated React rather than being swallowed.
    record('landing: pricing toggle actually reacts to a click', before !== after, `class unchanged: ${after}`);
  } else {
    record('landing: pricing toggle present', false, 'toggle not found');
  }

  /* ---------------------------------------------------------------- *
   * Auth pages
   * ---------------------------------------------------------------- */
  for (const [path, heading] of [
    ['/login', /welcome back/i],
    ['/signup', /create your account/i],
    ['/forgot-password', /reset your password/i],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    record(`${path}: renders expected heading`, await page.getByRole('heading', { name: heading }).count() > 0);

    const inputs = await page.locator('input').count();
    record(`${path}: has form inputs`, inputs > 0, `${inputs} inputs`);

    // Every input must have an accessible name (WCAG 4.1.2). The old FormField
    // wrapped the input in a bare <label> with no htmlFor/id association.
    const unlabelled = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).filter((el) => {
        if (el.type === 'hidden') return false;
        const id = el.getAttribute('id');
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        return !hasLabel && !el.getAttribute('aria-label') && !el.closest('label');
      }).length,
    );
    record(`${path}: every input has an accessible label`, unlabelled === 0, `${unlabelled} unlabelled`);
  }

  /* ---------------------------------------------------------------- *
   * Client-side validation on signup
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  await page.locator('input[name="name"]').fill('Test Person');
  await page.locator('input[name="email"]').fill('test@owbrand.test');
  await page.locator('input[name="password"]').fill('short');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForTimeout(400);

  const weakPasswordMessage = await page.getByText(/at least 8 characters/i).count();
  record('signup: rejects a weak password before submitting', weakPasswordMessage > 0);

  /* ---------------------------------------------------------------- *
   * Google button reports failure instead of silently doing nothing
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // Locate by position, not by accessible name: the label deliberately changes
  // to "Redirecting to Google…" while the request is in flight, so a
  // name-based locator would stop matching the moment the fix works.
  const googleButton = page.locator('button[type="button"]').first();
  const googleLabel = (await googleButton.textContent()) || '';
  record('login: Google button present', /continue with google/i.test(googleLabel), googleLabel.trim());

  // The real signal that OAuth was initiated is an outbound request to the
  // provider's authorize endpoint carrying a PKCE challenge. Asserting on
  // navigation is unreliable here: the demo Supabase project does not resolve,
  // so the browser ends on an error page and the DOM detaches.
  let authorizeUrl = null;
  page.on('request', (r) => {
    if (/\/auth\/v1\/authorize/.test(r.url())) authorizeUrl = r.url();
  });

  await googleButton.click();
  await page.waitForTimeout(4000);

  record(
    'login: Google click initiates a real OAuth authorize request',
    authorizeUrl !== null,
    authorizeUrl ? 'authorize request issued' : 'NO request issued — silent no-op',
  );
  record(
    'login: OAuth request uses PKCE and our own callback',
    Boolean(
      authorizeUrl &&
        /code_challenge=/.test(authorizeUrl) &&
        /redirect_to=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback/.test(authorizeUrl),
    ),
    authorizeUrl ? decodeURIComponent(authorizeUrl).slice(0, 120) : 'n/a',
  );

  // Back to a known-good page for the remaining checks.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  /* ---------------------------------------------------------------- *
   * Protected routes redirect to login and preserve the deep link
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/dashboard/brand-brain`, { waitUntil: 'networkidle' });
  const url = new URL(page.url());
  record('middleware: unauthenticated /dashboard redirects to /login', url.pathname === '/login', page.url());
  record(
    'middleware: preserves the deep link in ?next',
    url.searchParams.get('next') === '/dashboard/brand-brain',
    url.searchParams.get('next') || 'absent',
  );

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  record('middleware: unauthenticated /admin redirects to /login', new URL(page.url()).pathname === '/login');

  /* ---------------------------------------------------------------- *
   * Phase 2 screens are behind the same guard
   *
   * The Creative Studio, Website builder and Approvals inbox all read tenant
   * data server-side. A new route that middleware does not match would render
   * for an anonymous visitor, so each one is asserted rather than assumed.
   * ---------------------------------------------------------------- */
  for (const path of ['/dashboard/ai-studio', '/dashboard/website', '/dashboard/approvals']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const target = new URL(page.url());
    record(`middleware: ${path} redirects anonymous to /login`, target.pathname === '/login', page.url());
    record(
      `middleware: ${path} deep link preserved`,
      target.searchParams.get('next') === path,
      target.searchParams.get('next') || 'absent',
    );
  }

  /* ---------------------------------------------------------------- *
   * Phase 2 APIs refuse an unauthenticated caller
   *
   * These endpoints return brand-scoped data and accept mutations. What must
   * never happen is a 200 or a stack trace; with Supabase unreachable the
   * honest answers are 401 (no session cookie) or 503 (auth backend down).
   * ---------------------------------------------------------------- */
  for (const [method, path] of [
    ['GET', '/api/approvals'],
    ['POST', '/api/approvals'],
    ['GET', '/api/website?brandId=11111111-1111-4111-8111-111111111111'],
    ['PATCH', '/api/website/sections'],
  ]) {
    const probe = await page.evaluate(
      async ([m, p]) => {
        const response = await fetch(p, {
          method: m,
          headers: m === 'GET' ? {} : { 'content-type': 'application/json' },
          body: m === 'GET' ? undefined : '{}',
        });
        return { status: response.status, body: (await response.text()).slice(0, 400) };
      },
      [method, path],
    );

    record(
      `${method} ${path}: refuses an anonymous caller`,
      probe.status === 401 || probe.status === 403 || probe.status === 503,
      `status ${probe.status}`,
    );
    // A leaked stack trace or connection string would be a real disclosure.
    record(
      `${method} ${path}: error body leaks nothing`,
      !/at\s+\/|node_modules|service_role|supabaseKey|eyJ[A-Za-z0-9]/.test(probe.body),
      probe.body.slice(0, 120),
    );
  }

  /* ---------------------------------------------------------------- *
   * Callback error codes reach the login UI as friendly text
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/login?error=exchange_failed`, { waitUntil: 'networkidle' });
  const alertText = (await page.locator('[role="alert"]').first().textContent().catch(() => '')) || '';
  record(
    'login: surfaces an OAuth callback error',
    /could not finish signing you in/i.test(alertText),
    alertText.trim().slice(0, 80),
  );

  // An unknown code must not be reflected verbatim.
  await page.goto(`${BASE}/login?error=<img src=x onerror=alert(1)>`, { waitUntil: 'networkidle' });
  const reflected = await page.content();
  record(
    'login: does not reflect an attacker-supplied error code',
    !reflected.includes('onerror=alert(1)'),
  );

  /* ---------------------------------------------------------------- *
   * 404 page
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/definitely-not-a-page`, { waitUntil: 'networkidle' });
  record('404: renders the custom not-found page', (await page.getByText(/can.t find that page/i).count()) > 0);

  /* ---------------------------------------------------------------- *
   * Responsive: no horizontal overflow at the spec's breakpoints
   * ---------------------------------------------------------------- */
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/login', '/signup']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      record(`responsive ${width}px ${path}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
    }
  }

  /* ---------------------------------------------------------------- *
   * Global checks
   * ---------------------------------------------------------------- */
  record(
    'no CSP violations blocking the app’s own scripts',
    cspViolations.length === 0,
    cspViolations.slice(0, 2).join(' | '),
  );
  record('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.passed);
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
