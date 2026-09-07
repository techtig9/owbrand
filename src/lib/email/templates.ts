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
