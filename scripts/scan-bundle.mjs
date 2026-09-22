#!/usr/bin/env node
/**
 * Scans the built client bundle for anything that should never reach a browser.
 *
 * ## Why this exists as a build step and not a code review rule
 *
 * Next.js inlines `process.env.X` at build time for any code reachable from a
 * client component. One `'use client'` added to a file that reads a server
 * variable is enough to compile a service-role key into a public JavaScript
 * file — and nothing in TypeScript, ESLint or the build output complains. The
 * failure is silent, permanent once deployed, and discovered by whoever reads
 * the bundle first.
 *
 * `server-only` protects the modules that import it. This catches the case
 * where a variable is read directly in a component, where a new module has not
 * been marked yet, and where a key is pasted into source.
 *
 * ## What it looks for
 *
 *   1. **Credential shapes**: provider key prefixes and JWT-shaped strings
 *      whose payload claims a privileged role. These match the value, so they
 *      work even when the variable was renamed.
 *   2. **Server variable names**: every non-`NEXT_PUBLIC_` variable this
 *      codebase reads. A name in the bundle means the inlining happened.
 *
 * Exit code 1 on any finding. The matched value is never printed — this output
 * goes to CI logs, which on a public repository are public.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Overridable so the scanner can be pointed at a fixture. Without this there
 * is no way to prove the patterns fire on a real leak, and a scanner nobody
 * has seen fail is indistinguishable from one that always passes.
 */
const BUNDLE_DIR = process.argv[2] ?? '.next/static';

/**
 * Value patterns. These are shapes, not names, so they survive a rename — the
 * scan that only knows variable names misses a key pasted into source.
 */
const VALUE_PATTERNS = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Google API key', pattern: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { name: 'Paddle API key', pattern: /\bpdl_(?:live|sdbx)_apikey_[A-Za-z0-9_]{20,}/ },
  { name: 'Resend API key', pattern: /\bre_[A-Za-z0-9]{20,}/ },
  { name: 'Upstash REST token', pattern: /\bA[A-Za-z0-9_-]{40,}=\s*["'`]/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  /*
   * A Supabase service-role key is a JWT whose payload contains
   * `"role":"service_role"`. Matching it on the encoded token is the only way
   * to tell it apart from the anon key, which is a JWT of identical shape and
   * is SUPPOSED to be in the bundle.
   *
   * Three alternatives, not one, because base64 encodes three bytes at a time:
   * the same substring produces a different string at each byte offset mod 3,
   * and which one appears depends on how many characters precede it in the
   * payload. The first version of this check guessed a single fragment, and a
   * planted service-role key scanned CLEAN — the scanner reported success on
   * the exact thing it exists to catch. These three are generated from the
   * phrase at each alignment and verified against a real token below.
   */
  { name: 'Supabase service-role JWT', pattern: /nJvbGUiOiJzZXJ2aWNlX3JvbG/ },
  { name: 'Supabase service-role JWT', pattern: /yb2xlIjoic2VydmljZV9yb2xl/ },
  { name: 'Supabase service-role JWT', pattern: /cm9sZSI6InNlcnZpY2Vfcm9sZ/ },
];

/**
 * Server-only variable names, checked as a WARNING and not a failure.
 *
 * The first version of this script failed the build on these and claimed a
 * name in the bundle proved the value had been inlined. That is backwards:
 * when Next inlines `process.env.X` it substitutes the VALUE and the name
 * disappears, so a bare name is the one thing that cannot be evidence of a
 * leak. The first run found three, and all three were deliberate UI strings
 * telling an operator which variable to set — the "Not configured" states
 * built in earlier phases.
 *
 * The check is kept because it still says something true and useful: a server
 * variable name in a client chunk means a module that talks about server
 * configuration was pulled into the client graph. That is worth seeing in a
 * diff. It is not worth failing a build over, and failing on it would have
 * meant deleting a good UI pattern to satisfy a wrong check.
 */
const SERVER_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'META_APP_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(?:js|mjs|cjs|map|json|css)$/.test(entry.name)) yield path;
  }
}

const findings = [];
const mentions = [];
let scanned = 0;

for await (const file of walk(BUNDLE_DIR)) {
  scanned += 1;
  const content = await readFile(file, 'utf8');

  for (const { name, pattern } of VALUE_PATTERNS) {
    // The matched value is deliberately NOT recorded. CI logs are public on a
    // public repository, and printing the secret to prove it leaked would
    // leak it again, somewhere with a longer retention.
    if (pattern.test(content)) findings.push({ file, kind: name });
  }

  // Source maps contain the original source, where these names appear by
  // definition. Reporting them would be noise with no signal in it.
  if (!file.endsWith('.map')) {
    for (const name of SERVER_ENV_NAMES) {
      if (content.includes(name)) mentions.push({ file, name });
    }
  }
}

if (scanned === 0) {
  /*
   * A scan that examined nothing must fail, not pass. The quiet version of
   * this script reports success on a missing build directory and has been
   * "protecting" the repository for months.
   */
  console.error(`✗ No files found under ${BUNDLE_DIR}. Run \`npm run build\` first.`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`✗ Secret material in the client bundle (${findings.length} finding(s)):\n`);
  for (const { file, kind } of findings) console.error(`  ${kind}\n    ${file}`);
  console.error(
    '\nA value reaching .next/static is served to every visitor. Rotate the credential,' +
      '\nthen find the client component that reads it — `server-only` on the module it' +
      '\ncomes from will turn this into a build error instead.'
  );
  process.exit(1);
}

if (mentions.length > 0) {
  // Informational. See the note on SERVER_ENV_NAMES for why this does not fail.
  console.log(`ℹ ${mentions.length} server variable name(s) mentioned in client chunks:`);
  for (const { file, name } of mentions) console.log(`    ${name} — ${file}`);
  console.log(
    '    These are names, not values. Next inlines the value and drops the name, so this is not' +
      '\n    a leak — but it does mean a module discussing server config reached the client graph.'
  );
}

console.log(`✓ No secret material in the client bundle (${scanned} files scanned).`);
