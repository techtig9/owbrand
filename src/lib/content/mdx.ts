import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

/**
 * Filesystem-backed MDX content: the blog now, the help centre later.
 *
 * Read at request time on the server rather than bundled, so adding a post is
 * adding a file — no import list to update, and nothing to forget.
 *
 * `draft: true` posts are EXCLUDED unless explicitly asked for. That default
 * matters: the alternative is a draft shipping to production because somebody
 * forgot a filter on one of the two places that list posts, and a
 * half-finished post on a public blog is worse than no post.
 */

export interface ContentMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  draft: boolean;
  /** Reading time in minutes, computed rather than declared. */
  readingMinutes: number;
  tags: string[];
  /**
   * Grouping for the help centre. Empty for collections that do not use it
   * (the blog), so one loader serves both rather than two near-identical ones
   * drifting apart.
   */
  category: string;
  /** Sort position within a category. Lower first; unset sorts last. */
  order: number;
}

export interface ContentDocument extends ContentMeta {
  body: string;
}

const ROOT = path.join(process.cwd(), 'content');

function contentDir(collection: string): string {
  // Collections are internal identifiers, never user input, but the join is
  // still constrained: a collection containing `..` would escape the content
  // root, and "it is never user input" is the assumption every path traversal
  // starts from.
  const safe = collection.replace(/[^a-z0-9-]/gi, '');
  return path.join(ROOT, safe);
}

/** ~220 words per minute, the usual reading-speed estimate, floored at 1. */
function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function toMeta(slug: string, data: Record<string, unknown>, body: string): ContentMeta {
  return {
    slug,
    title: typeof data.title === 'string' ? data.title : slug,
    description: typeof data.description === 'string' ? data.description : '',
    date: typeof data.date === 'string' ? data.date : '',
    // Anything other than an explicit `false` is treated as a draft. Defaulting
    // to published means a missing or mistyped field publishes by accident.
    draft: data.draft !== false,
    readingMinutes: readingMinutes(body),
    tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [],
    category: typeof data.category === 'string' ? data.category : '',
    // 999 rather than 0 for an unset order: an article that forgot the field
    // should fall to the end of its section, not jump to the top of it.
    order: typeof data.order === 'number' ? data.order : 999,
  };
}

export async function listContent(
  collection: string,
  options: { includeDrafts?: boolean } = {}
): Promise<ContentMeta[]> {
  let files: string[];
  try {
    files = await readdir(contentDir(collection));
  } catch {
    // A missing collection directory is empty, not an error: the blog should
    // render an empty state rather than a 500 before the first post exists.
    return [];
  }

  const entries = await Promise.all(
    files
      .filter((file) => file.endsWith('.mdx'))
      .map(async (file) => {
        const slug = file.replace(/\.mdx$/, '');
        const raw = await readFile(path.join(contentDir(collection), file), 'utf8');
        const { data, content } = matter(raw);
        return toMeta(slug, data, content);
      })
  );

  return entries
    .filter((entry) => options.includeDrafts || !entry.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function readContent(
  collection: string,
  slug: string,
  options: { includeDrafts?: boolean } = {}
): Promise<ContentDocument | null> {
  // The slug reaches this from a URL segment, so it is constrained to the
  // characters a slug may contain before it is used in a path. Without this a
  // request for `../../.env` is a file read.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;

  try {
    const raw = await readFile(path.join(contentDir(collection), `${slug}.mdx`), 'utf8');
    const { data, content } = matter(raw);
    const meta = toMeta(slug, data, content);

    if (meta.draft && !options.includeDrafts) return null;

    return { ...meta, body: content };
  } catch {
    return null;
  }
}
