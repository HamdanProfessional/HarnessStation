/**
 * Loading the documentation.
 *
 * Every page is a markdown file under `content/`, and that markdown is the
 * source of truth — the site is a renderer, not a second copy. Files are pulled
 * in at build time by Vite's glob import, so adding a page means adding a `.md`
 * and listing it in `nav.ts`; there is no build step to remember and no database.
 */

/** Front matter we understand. Anything else in the block is ignored, not an error. */
export interface DocMeta {
  title: string;
  /** One line under the title, and the search result summary. */
  description?: string;
}

export interface Doc extends DocMeta {
  /** Route path, e.g. "guide/chats" — the file path minus `content/` and `.md`. */
  slug: string;
  /** Markdown body, front matter removed. */
  body: string;
  headings: Heading[];
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

const raw = import.meta.glob<string>("../content/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Parse a YAML-ish front matter block.
 *
 * Deliberately not a YAML parser: the docs only ever use `key: value` strings,
 * and pulling in a parser to read two fields would be a dependency to keep
 * patched for no gain. Anything more structured belongs in the page body.
 */
function parseFrontMatter(text: string): { meta: Partial<DocMeta>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    // Quotes are optional; strip them when present so titles can contain colons.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta: meta as Partial<DocMeta>, body: text.slice(match[0].length) };
}

/**
 * Turn heading text into a URL fragment.
 *
 * Must match what the markdown renderer puts on the heading element, or the
 * table of contents will link to anchors that don't exist — so both sides call
 * this one function rather than each having their own idea.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Collect the headings for the on-page contents.
 *
 * Fenced code is stripped first: a `# comment` inside a bash block is a comment,
 * not a section, and without this every shell example adds a phantom entry.
 */
function extractHeadings(body: string): Heading[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "");
  const out: Heading[] = [];
  for (const line of withoutCode.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "");
    out.push({ depth: m[1].length, text, id: slugify(text) });
  }
  return out;
}

function toSlug(path: string): string {
  return path
    .replace(/^\.\.\/content\//, "")
    .replace(/\.md$/, "")
    .replace(/\/index$/, "");
}

export const docs: Record<string, Doc> = {};

for (const [path, text] of Object.entries(raw)) {
  const slug = toSlug(path);
  const { meta, body } = parseFrontMatter(text);
  // Fall back to the first H1 so a page without front matter still has a name in
  // the sidebar rather than showing up blank.
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  docs[slug] = {
    slug,
    title: meta.title || h1 || slug,
    description: meta.description,
    body,
    headings: extractHeadings(body),
  };
}

export function getDoc(slug: string): Doc | undefined {
  return docs[slug] ?? docs[slug.replace(/\/$/, "")];
}
