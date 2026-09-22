/**
 * Class-name joiner.
 *
 * Local rather than `clsx`, which the audit found listed as a dependency and
 * imported by nothing. Twelve lines beats a package for the one thing every
 * component here needs.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
