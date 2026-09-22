/**
 * Deterministic JSON extraction and repair.
 *
 * Five routes previously did a bare `JSON.parse(raw)` on model output and wrote
 * the result straight to the database with no shape checking at all. This
 * module is the first rung of the ladder the master command specifies:
 *
 *   1. attempt safe repair only when deterministic  <- here
 *   2. otherwise retry
 *   3. otherwise fail gracefully and refund reserved credits
 *
 * "Deterministic" is the operative constraint. Every transform below is a
 * mechanical un-mangling of a known formatting habit — unwrapping a fence,
 * dropping a trailing comma. Nothing here guesses at missing values or invents
 * content; if the JSON is genuinely incomplete, repair fails and the caller
 * retries instead.
 */

export interface RepairOutcome {
  value: unknown;
  /** Which transforms were applied, in order. Recorded for observability. */
  repairs: string[];
}

/**
 * Parses model output into a value, applying deterministic repairs as needed.
 * Returns null when the text cannot be parsed without guessing.
 */
export function parseJsonLoosely(raw: string): RepairOutcome | null {
  const repairs: string[] = [];

  // 0. The happy path.
  const direct = tryParse(raw);
  if (direct.ok) return { value: direct.value, repairs };

  let text = raw;

  // 1. Strip a markdown code fence. Models add these even when told not to.
  const unfenced = stripCodeFence(text);
  if (unfenced !== text) {
    text = unfenced;
    repairs.push('stripped_code_fence');
    const parsed = tryParse(text);
    if (parsed.ok) return { value: parsed.value, repairs };
  }

  // 2. Take the outermost balanced JSON value, discarding any prose around it.
  const extracted = extractBalancedJson(text);
  if (extracted && extracted !== text) {
    text = extracted;
    repairs.push('extracted_json_span');
    const parsed = tryParse(text);
    if (parsed.ok) return { value: parsed.value, repairs };
  }

  // 3. Remove trailing commas before a closing brace/bracket.
  const decommaed = removeTrailingCommas(text);
  if (decommaed !== text) {
    text = decommaed;
    repairs.push('removed_trailing_commas');
    const parsed = tryParse(text);
    if (parsed.ok) return { value: parsed.value, repairs };
  }

  // 4. Strip // and /* */ comments, which are not valid JSON.
  const uncommented = stripJsonComments(text);
  if (uncommented !== text) {
    text = uncommented;
    repairs.push('stripped_comments');
    const parsed = tryParse(text);
    if (parsed.ok) return { value: parsed.value, repairs };
  }

  // Anything beyond this would mean inventing structure. Refuse.
  return null;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Unwraps ```json … ``` or ``` … ``` fences. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * Finds the outermost balanced `{...}` or `[...]`, ignoring braces inside
 * string literals and respecting escapes. A naive indexOf/lastIndexOf slice
 * breaks the moment the content itself contains a brace in a string.
 */
export function extractBalancedJson(text: string): string | null {
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');

  const candidates = [firstObject, firstArray].filter((i) => i !== -1);
  if (candidates.length === 0) return null;

  const start = Math.min(...candidates);
  const open = text[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unbalanced — the output was truncated. Do not attempt to close it: that
  // would fabricate structure the model never produced.
  return null;
}

/** Removes `,` immediately before `}` or `]`, outside string literals. */
export function removeTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      out += char;
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString) {
      out += char;
      continue;
    }

    if (char === ',') {
      // Look ahead past whitespace for a closer.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue; // drop the comma
    }

    out += char;
  }

  return out;
}

/** Removes // line and /* block *\/ comments outside string literals. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (escaped) {
      out += char;
      escaped = false;
      i++;
      continue;
    }
    if (char === '\\') {
      out += char;
      if (inString) escaped = true;
      i++;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      i++;
      continue;
    }
    if (inString) {
      out += char;
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += char;
    i++;
  }

  return out;
}
