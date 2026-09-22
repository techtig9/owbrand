/**
 * Transactional email templates.
 *
 * Rules enforced here, from the master command:
 *  - No passwords, tokens, API keys, magic links or any other secret is ever
 *    placed in an email body. These templates take only a name, a timestamp and
 *    coarse context.
 *  - Table-based layout with inline styles, because Gmail/Outlook strip <style>
 *    blocks and do not support flexbox or CSS custom properties.
 *  - Every email has a plain-text alternative — required for deliverability and
 *    for screen readers.
 */

const BRAND = {
  name: 'OwBrand',
  tagline: 'AI Brand Operating System',
  company: 'Techtig',
  ink: '#241F1B',
  inkSoft: '#5C554E',
  inkFaint: '#9A9188',
  canvas: '#FBF7F2',
  line: '#E7E0D6',
  accent: '#E07049',
};

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function layout(options: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
  siteUrl: string;
}): string {
  const { preheader, heading, bodyHtml, footerNote, siteUrl } = options;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.canvas};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <span style="font-size:20px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.02em;">${BRAND.name}<span style="color:${BRAND.accent};">.</span></span>
              <div style="font-size:12px;color:${BRAND.inkFaint};margin-top:2px;">${BRAND.tagline}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.ink};">${escapeHtml(heading)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;font-size:15px;line-height:1.6;color:${BRAND.inkSoft};">
              ${bodyHtml}
            </td>
          </tr>
          ${
            footerNote
              ? `<tr><td style="padding:0 32px 28px 32px;">
                   <div style="background:${BRAND.canvas};border:1px solid ${BRAND.line};border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.5;color:${BRAND.inkSoft};">
                     ${footerNote}
                   </div>
                 </td></tr>`
              : ''
          }
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding:20px 32px;text-align:center;font-size:12px;line-height:1.6;color:${BRAND.inkFaint};">
              <a href="${escapeAttr(siteUrl)}" style="color:${BRAND.inkFaint};text-decoration:underline;">${escapeHtml(stripScheme(siteUrl))}</a>
              &nbsp;·&nbsp; ${BRAND.name}, a ${BRAND.company} product
              <div style="margin-top:8px;">
                You are receiving this because of activity on your ${BRAND.name} account.
                Manage notification settings in
                <a href="${escapeAttr(siteUrl)}/dashboard/settings" style="color:${BRAND.inkFaint};text-decoration:underline;">Settings</a>.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export function signupNotification(options: { name: string | null; siteUrl: string }): EmailContent {
  const greeting = options.name ? `Welcome, ${options.name}` : 'Welcome to OwBrand';
  const { siteUrl } = options;

  return {
    subject: 'Welcome to OwBrand',
    html: layout({
      preheader: 'Your OwBrand account is ready. Here is how to get started.',
      heading: greeting,
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Your account is ready. OwBrand turns one description of your business into a working brand system — identity, products, creative, campaigns and analytics.</p>
        <p style="margin:0 0 8px 0;font-weight:600;color:${BRAND.ink};">A good first hour:</p>
        <ol style="margin:0 0 20px 0;padding-left:20px;">
          <li style="margin-bottom:6px;">Describe your business to build your <strong>Brand Brain</strong>.</li>
          <li style="margin-bottom:6px;">Add your first product with its approved facts.</li>
          <li style="margin-bottom:6px;">Generate brand-consistent creative from the studio.</li>
        </ol>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BRAND.ink};border-radius:999px;">
            <a href="${escapeAttr(siteUrl)}/dashboard" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">Open your dashboard</a>
          </td>
        </tr></table>`,
      footerNote: `If you did not create this account, you can safely ignore this email &mdash; no further action is needed, and nothing has been charged.`,
    }),
    text: [
      `${greeting}`,
      '',
      'Your OwBrand account is ready. OwBrand turns one description of your business into a working brand system.',
      '',
      'A good first hour:',
      '  1. Describe your business to build your Brand Brain.',
      '  2. Add your first product with its approved facts.',
      '  3. Generate brand-consistent creative from the studio.',
      '',
      `Open your dashboard: ${siteUrl}/dashboard`,
      '',
      'If you did not create this account you can safely ignore this email.',
      '',
      `${BRAND.name}, a ${BRAND.company} product`,
    ].join('\n'),
  };
}

export function signinNotification(options: {
  name: string | null;
  method: string;
  at: Date;
  approximateLocation?: string | null;
  device?: string | null;
  siteUrl: string;
}): EmailContent {
  const { name, method, at, device, siteUrl } = options;
  const when = at.toUTCString();
  const methodLabel = method === 'email' ? 'email and password' : `${method} sign-in`;

  const rows = [
    ['When', when],
    ['Method', methodLabel],
    device ? ['Device', device] : null,
  ].filter(Boolean) as Array<[string, string]>;

  return {
    subject: 'New sign-in to your OwBrand account',
    html: layout({
      preheader: `A new sign-in to your OwBrand account on ${when}.`,
      heading: 'New sign-in to your account',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">${name ? `Hi ${escapeHtml(name)}, we` : 'We'} noticed a new sign-in to your OwBrand account.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${BRAND.line};border-radius:12px;">
          ${rows
            .map(
              ([label, value], i) => `
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:${BRAND.inkFaint};${i > 0 ? `border-top:1px solid ${BRAND.line};` : ''}width:34%;">${escapeHtml(label)}</td>
              <td style="padding:10px 14px;font-size:13px;color:${BRAND.ink};${i > 0 ? `border-top:1px solid ${BRAND.line};` : ''}">${escapeHtml(value)}</td>
            </tr>`
            )
            .join('')}
        </table>`,
      footerNote: `Was this you? Then nothing to do. If not, <a href="${escapeAttr(siteUrl)}/forgot-password" style="color:${BRAND.accent};">reset your password</a> right away and review your connected accounts in Settings.`,
    }),
    text: [
      'New sign-in to your OwBrand account',
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      `If this was not you, reset your password: ${siteUrl}/forgot-password`,
      '',
      `${BRAND.name}, a ${BRAND.company} product`,
    ].join('\n'),
  };
}

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/* ------------------------------------------------------------------ *
 * Operational notifications (Phase 9)
 *
 * Each of these exists because something happened that the user cannot see
 * from inside the product. That is the bar: a mail for something visible on
 * the dashboard is noise, and noise is what makes people filter the mails that
 * matter into a folder they never open.
 * ------------------------------------------------------------------ */

/**
 * A scheduled post did not go out.
 *
 * The single most important transactional mail in this product. Everything
 * else can wait for the next login; a post that silently failed to publish is
 * a marketing campaign with a hole in it, and the user finds out days later
 * from the platform rather than from us.
 */
export function publishFailed(options: {
  brandName: string;
  platform: string;
  reason: string;
  needsReconnect: boolean;
  siteUrl: string;
}): EmailContent {
  const { brandName, platform, reason, needsReconnect, siteUrl } = options;
  const destination = needsReconnect ? '/dashboard/connections' : '/dashboard/scheduler';

  return {
    subject: `A ${platform} post for ${brandName} did not publish`,
    html: layout({
      preheader: needsReconnect
        ? `${platform} needs reconnecting before anything else can publish.`
        : `One post failed. Here is what ${platform} said.`,
      heading: 'A post did not publish',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 14px 0;">A scheduled <strong>${escapeHtml(platform)}</strong> post for <strong>${escapeHtml(brandName)}</strong> could not be published.</p>
        <p style="margin:0 0 8px 0;font-weight:600;color:${BRAND.ink};">What the platform said:</p>
        <p style="margin:0 0 20px 0;padding:12px 14px;background:${BRAND.canvas};border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">${escapeHtml(reason)}</p>
        ${
          needsReconnect
            ? `<p style="margin:0 0 20px 0;"><strong>This needs your attention.</strong> The connection to ${escapeHtml(platform)} has expired, so nothing will publish to it until you reconnect.</p>`
            : `<p style="margin:0 0 20px 0;">We retried this automatically. It is in the queue where you can see the full history.</p>`
        }
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BRAND.ink};border-radius:999px;">
            <a href="${escapeAttr(siteUrl)}${destination}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">${needsReconnect ? 'Reconnect the account' : 'Open the queue'}</a>
          </td>
        </tr></table>`,
    }),
    text: [
      'A post did not publish',
      '',
      `A scheduled ${platform} post for ${brandName} could not be published.`,
      '',
      `What the platform said: ${reason}`,
      '',
      needsReconnect
        ? `The connection to ${platform} has expired. Nothing will publish to it until you reconnect: ${siteUrl}/dashboard/connections`
        : `See the full history: ${siteUrl}/dashboard/scheduler`,
    ].join('\n'),
  };
}

/**
 * Credits are nearly gone.
 *
 * Sent once at a threshold rather than repeatedly, and it names the number.
 * "You are running low" with no figure is the kind of mail that trains people
 * to ignore the sender.
 */
export function creditsLow(options: {
  remaining: number;
  plan: string;
  siteUrl: string;
}): EmailContent {
  const { remaining, plan, siteUrl } = options;

  return {
    subject: `${remaining} credits left on your OwBrand ${plan} plan`,
    html: layout({
      preheader: `${remaining} credits remaining. Generations stop when they run out.`,
      heading: 'Your credits are running low',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 14px 0;">You have <strong>${remaining}</strong> generation credit${remaining === 1 ? '' : 's'} left on the ${escapeHtml(plan)} plan.</p>
        <p style="margin:0 0 20px 0;">When they run out, generations stop until your plan renews. Anything already scheduled still publishes — publishing does not use credits.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BRAND.ink};border-radius:999px;">
            <a href="${escapeAttr(siteUrl)}/dashboard/billing" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">See your usage</a>
          </td>
        </tr></table>`,
      footerNote:
        'Credits are only spent on successful generations. A generation that fails or times out is refunded automatically.',
    }),
    text: [
      'Your credits are running low',
      '',
      `You have ${remaining} generation credit${remaining === 1 ? '' : 's'} left on the ${plan} plan.`,
      '',
      'When they run out, generations stop until your plan renews. Anything already scheduled still publishes.',
      '',
      `See your usage: ${siteUrl}/dashboard/billing`,
    ].join('\n'),
  };
}

/**
 * A webhook endpoint was disabled after repeated failures.
 *
 * Without this mail, an integration goes quiet and the owner has no way to
 * know — their server stopped receiving events and nothing told them why.
 */
export function webhookDisabled(options: {
  url: string;
  failures: number;
  siteUrl: string;
}): EmailContent {
  const { url, failures, siteUrl } = options;
  // Host only. The full path can contain a token, and an email is stored
  // wherever the recipient's mail provider stores things.
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'your endpoint';
    }
  })();

  return {
    subject: 'A webhook endpoint was disabled',
    html: layout({
      preheader: `${host} failed ${failures} times in a row and is no longer receiving events.`,
      heading: 'A webhook endpoint was disabled',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Deliveries to <strong>${escapeHtml(host)}</strong> failed ${failures} times in a row, so we stopped sending to it.</p>
        <p style="margin:0 0 20px 0;">Retrying a dead address on every event indefinitely is a slow flood aimed at whoever owns it now, so we disable rather than keep going. Fix the endpoint and re-enable it and new events resume — the ones that failed are not replayed.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BRAND.ink};border-radius:999px;">
            <a href="${escapeAttr(siteUrl)}/dashboard/settings" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">Open webhook settings</a>
          </td>
        </tr></table>`,
    }),
    text: [
      'A webhook endpoint was disabled',
      '',
      `Deliveries to ${host} failed ${failures} times in a row, so we stopped sending to it.`,
      '',
      'Fix the endpoint and re-enable it and new events resume. The failed ones are not replayed.',
      '',
      `${siteUrl}/dashboard/settings`,
    ].join('\n'),
  };
}

/**
 * Confirmation that an account was deleted.
 *
 * Sent to an address we are about to stop being able to reach, which is the
 * point: it is the user's receipt. It states plainly what was kept, because a
 * deletion confirmation that implies everything is gone while billing records
 * are retained is a misleading statement about a data-subject right.
 */
export function accountDeleted(options: {
  paymentsRetained: number;
  siteUrl: string;
}): EmailContent {
  const { paymentsRetained, siteUrl } = options;

  return {
    subject: 'Your OwBrand account has been deleted',
    html: layout({
      preheader: 'Confirmation of what was removed and what was kept.',
      heading: 'Your account has been deleted',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 14px 0;">Your account and its data have been removed: brands, products, generated content, scheduled posts, connected accounts and analytics.</p>
        <p style="margin:0 0 8px 0;font-weight:600;color:${BRAND.ink};">What was kept, and why:</p>
        <ul style="margin:0 0 20px 0;padding-left:20px;">
          <li style="margin-bottom:6px;">${paymentsRetained} billing record${paymentsRetained === 1 ? '' : 's'}, with your identity removed. Required for tax and accounting.</li>
          <li style="margin-bottom:6px;">A log entry recording that the deletion happened, so it can be evidenced if ever disputed.</li>
        </ul>
        <p style="margin:0 0 6px 0;">Nothing else remains, and this cannot be undone. Signing up again starts from nothing.</p>`,
      footerNote: 'This is the last email we will send to this address.',
    }),
    text: [
      'Your account has been deleted',
      '',
      'Removed: brands, products, generated content, scheduled posts, connected accounts and analytics.',
      '',
      'Kept:',
      `- ${paymentsRetained} billing record${paymentsRetained === 1 ? '' : 's'}, with your identity removed. Required for tax and accounting.`,
      '- A log entry recording that the deletion happened.',
      '',
      'Nothing else remains, and this cannot be undone.',
      '',
      siteUrl,
    ].join('\n'),
  };
}

/**
 * A message from the public contact form, sent to the operator.
 *
 * Every field is escaped. This is the only template whose content comes from
 * an unauthenticated stranger, which makes it the only one where an HTML
 * injection would be trivially reachable — and the recipient is us.
 */
export function contactMessage(options: {
  fromName: string;
  fromEmail: string;
  topic: string;
  message: string;
  siteUrl: string;
}): EmailContent {
  const { fromName, fromEmail, topic, message, siteUrl } = options;

  return {
    subject: `[${topic}] Contact form: ${fromName}`,
    html: layout({
      preheader: `${fromName} <${fromEmail}> — ${topic}`,
      heading: 'New contact message',
      siteUrl,
      bodyHtml: `
        <p style="margin:0 0 6px 0;"><strong>From:</strong> ${escapeHtml(fromName)} &lt;${escapeHtml(fromEmail)}&gt;</p>
        <p style="margin:0 0 14px 0;"><strong>Topic:</strong> ${escapeHtml(topic)}</p>
        <div style="margin:0 0 20px 0;padding:14px;background:${BRAND.canvas};border-radius:10px;white-space:pre-wrap;">${escapeHtml(message)}</div>`,
    }),
    text: [
      'New contact message',
      '',
      `From: ${fromName} <${fromEmail}>`,
      `Topic: ${topic}`,
      '',
      message,
    ].join('\n'),
  };
}
