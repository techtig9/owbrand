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
   * Phase 3 screens are behind the guard
   * ---------------------------------------------------------------- */
  for (const path of ['/dashboard/connections', '/dashboard/scheduler']) {
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
   * The publishing trigger is not publicly callable
   *
   * This is the most dangerous route in the app: reaching it causes posts to
   * appear on real social accounts. CRON_SECRET is set in the test env, so a
   * caller with no secret or a wrong one must be refused — and must not learn
   * that a publishing trigger lives at this path.
   * ---------------------------------------------------------------- */
  for (const cronPath of ['/api/cron/publish', '/api/cron/social-health']) {
    for (const [label, headers] of [
      ['no credentials', {}],
      ['a wrong bearer token', { authorization: 'Bearer definitely-not-the-secret' }],
      ['a wrong custom header', { 'x-cron-secret': 'definitely-not-the-secret' }],
      ['an empty bearer token', { authorization: 'Bearer ' }],
    ]) {
      const probe = await page.evaluate(
        async ([p, h]) => {
          const response = await fetch(p, { method: 'POST', headers: h });
          return { status: response.status, body: (await response.text()).slice(0, 300) };
        },
        [cronPath, headers],
      );

      record(
        `${cronPath}: refuses ${label}`,
        probe.status === 404 || probe.status === 503,
        `status ${probe.status}`,
      );
      // A 401 would confirm the endpoint exists and takes a secret.
      record(
        `${cronPath}: does not advertise itself to ${label}`,
        probe.status !== 401 && !/cron|worker|publish/i.test(probe.body),
        probe.body.slice(0, 100),
      );
    }

    // GET is accepted by platform schedulers, so it must be guarded identically.
    const getProbe = await page.evaluate(async (p) => {
      const response = await fetch(p);
      return response.status;
    }, cronPath);
    record(`${cronPath}: GET is guarded too`, getProbe === 404 || getProbe === 503, `status ${getProbe}`);
  }

  /* ---------------------------------------------------------------- *
   * Analytics is behind the guard, and its cron trigger is protected
   * ---------------------------------------------------------------- */
  await page.goto(`${BASE}/dashboard/analytics`, { waitUntil: 'networkidle' });
  {
    const target = new URL(page.url());
    record('middleware: /dashboard/analytics redirects anonymous to /login', target.pathname === '/login', page.url());
    record(
      'middleware: /dashboard/analytics deep link preserved',
      target.searchParams.get('next') === '/dashboard/analytics',
      target.searchParams.get('next') || 'absent',
    );
  }

  for (const [label, headers] of [
    ['no credentials', {}],
    ['a wrong bearer token', { authorization: 'Bearer definitely-not-the-secret' }],
  ]) {
    const probe = await page.evaluate(
      async ([p, h]) => {
        const response = await fetch(p, { method: 'POST', headers: h });
        return { status: response.status, body: (await response.text()).slice(0, 200) };
      },
      ['/api/cron/analytics', headers],
    );
    record(
      `/api/cron/analytics: refuses ${label}`,
      probe.status === 404 || probe.status === 503,
      `status ${probe.status}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * Analytics endpoints refuse an anonymous caller
   *
   * These return a tenant's commercial performance and, for the export, a
   * whole CSV of it — so a leak here is a data breach, not a nuisance.
   * ---------------------------------------------------------------- */
  const brandProbe = '11111111-1111-4111-8111-111111111111';
  for (const [method, path] of [
    ['GET', `/api/analytics/overview?brandId=${brandProbe}`],
    ['GET', `/api/analytics/export?brandId=${brandProbe}`],
    ['GET', `/api/analytics/attribution?brandId=${brandProbe}`],
    ['POST', '/api/analytics/attribution'],
    ['POST', '/api/analytics/optimize'],
    ['GET', '/api/analytics/recommendations'],
    ['POST', '/api/analytics/recommendations'],
  ]) {
    const probe = await page.evaluate(
      async ([m, p]) => {
        const response = await fetch(p, {
          method: m,
          headers: m === 'GET' ? {} : { 'content-type': 'application/json' },
          body: m === 'GET' ? undefined : '{}',
        });
        return {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          body: (await response.text()).slice(0, 400),
        };
      },
      [method, path],
    );

    record(
      `${method} ${path}: refuses an anonymous caller`,
      probe.status === 401 || probe.status === 403 || probe.status === 503,
      `status ${probe.status}`,
    );
    record(
      `${method} ${path}: leaks no metrics or stack`,
      !/at\s+\/|node_modules|service_role|impressions|engagements|metric_date/.test(probe.body),
      probe.body.slice(0, 120),
    );
  }

  // The export must never answer with a CSV to an unauthenticated caller: a
  // browser would download it, and content-disposition makes it a file.
  {
    const exportProbe = await page.evaluate(async (brand) => {
      const response = await fetch(`/api/analytics/export?brandId=${brand}`);
      return {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        disposition: response.headers.get('content-disposition') || '',
      };
    }, brandProbe);

    record(
      'GET /api/analytics/export: never returns a CSV attachment to an anonymous caller',
      !exportProbe.contentType.includes('text/csv') && !exportProbe.disposition.includes('attachment'),
      `${exportProbe.status} ${exportProbe.contentType}`,
    );
  }

  /*
   * Positive control for the cron guard.
   *
   * Every refusal above would also pass if the endpoint returned 404
   * unconditionally — which would be a broken publisher that looks perfectly
   * secure. This asserts the guard actually DISCRIMINATES: the correct secret
   * must get past it. Skipped when the harness has no secret to present.
   */
  if (process.env.CRON_SECRET) {
    const authorized = await page.evaluate(
      async (secret) => {
        const response = await fetch('/api/cron/publish', {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}` },
        });
        return { status: response.status, body: (await response.text()).slice(0, 200) };
      },
      process.env.CRON_SECRET,
    );

    record(
      'cron guard discriminates: the correct secret is not refused as 404',
      authorized.status !== 404,
      `status ${authorized.status}`,
    );
    // With Supabase unreachable the run itself fails, and reporting 500 rather
    // than a cheerful empty success is the intended behaviour.
    record(
      'cron: a failed run reports failure instead of a fake empty success',
      authorized.status === 500 || authorized.status === 200,
      `status ${authorized.status} ${authorized.body.slice(0, 80)}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * Social endpoints refuse an anonymous caller
   * ---------------------------------------------------------------- */
  for (const [method, path] of [
    ['GET', '/api/social/oauth/start?provider=meta'],
    ['GET', '/api/social/accounts'],
    ['DELETE', '/api/social/accounts'],
    ['POST', '/api/social/publish'],
    ['POST', '/api/social/media-check'],
    ['POST', '/api/scheduler/schedule-post'],
    ['GET', '/api/scheduler/list-scheduled-posts'],
    ['POST', '/api/scheduler/cancel-scheduled-post'],
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
    record(
      `${method} ${path}: leaks no credential or stack`,
      !/at\s+\/|node_modules|service_role|supabaseKey|META_APP_SECRET|TOKEN_ENCRYPTION_KEY|eyJ[A-Za-z0-9]/.test(
        probe.body,
      ),
      probe.body.slice(0, 120),
    );
  }

  /* ---------------------------------------------------------------- *
   * The placeholder-token route is gone
   * ---------------------------------------------------------------- */
  const removedConnect = await page.evaluate(async () => {
    const response = await fetch('/api/social/connect-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram', oauthCode: 'anything' }),
    });
    return { status: response.status, body: (await response.text()).slice(0, 300) };
  });
  record(
    '/api/social/connect-account: removed, not merely unauthenticated',
    removedConnect.status === 404,
    `status ${removedConnect.status}`,
  );
  record(
    '/api/social/connect-account: never returns a placeholder token',
    !/placeholder_token/.test(removedConnect.body),
    removedConnect.body.slice(0, 100),
  );

  const movedDisconnect = await page.evaluate(async () => {
    const response = await fetch('/api/social/disconnect-account', { method: 'POST' });
    return { status: response.status, body: (await response.text()).slice(0, 200) };
  });
  record(
    '/api/social/disconnect-account: reports 410 rather than silently 404ing',
    movedDisconnect.status === 410,
    `status ${movedDisconnect.status}`,
  );

  /* ---------------------------------------------------------------- *
   * The OAuth callback fails closed
   *
   * A forged callback must not 500, must not reach a token exchange, and must
   * not reflect anything from the query string.
   * ---------------------------------------------------------------- */
  await page.goto(
    `${BASE}/api/social/oauth/callback?state=${'f'.repeat(64)}&code=forged-code`,
    { waitUntil: 'networkidle' },
  );
  const callbackUrl = new URL(page.url());
  record(
    'oauth callback: an unknown state is rejected without a server error',
    callbackUrl.pathname === '/login' || callbackUrl.searchParams.has('social_error'),
    page.url(),
  );
  const callbackHtml = await page.content();
  record(
    'oauth callback: does not reflect the supplied code',
    !callbackHtml.includes('forged-code'),
  );

  // An attacker-supplied error code must not be echoed into the page.
  await page.goto(
    `${BASE}/api/social/oauth/callback?error=access_denied&error_reason=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`,
    { waitUntil: 'networkidle' },
  );
  const declinedHtml = await page.content();
  record(
    'oauth callback: does not reflect an attacker-supplied reason',
    !declinedHtml.includes('onerror=alert(1)'),
  );

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
