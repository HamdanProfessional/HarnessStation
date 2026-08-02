import { docs, slugify, type Doc } from "./content";

/**
 * Search.
 *
 * The whole corpus is a few hundred kilobytes of markdown already in memory, so
 * an index — and the dependency to build one — buys nothing. This scans it.
 *
 * The ranking is what matters: a page whose *title* matches is almost always
 * what someone wants, and a match buried in a paragraph almost never is, so the
 * two must not be scored alike.
 */

export interface Hit {
  slug: string;
  title: string;
  /** Section within the page, when the match was under a heading. */
  section?: string;
  /** Fragment to jump to, if any. */
  hash?: string;
  /** Surrounding text, with the query marked by \x00 delimiters for the UI. */
  excerpt: string;
  score: number;
}

/** Strip markdown noise so a match on `**bold**` doesn't show the asterisks. */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^---[\s\S]*?---/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The heading a character offset falls under, for "page › section" results. */
function sectionAt(body: string, index: number): { text: string; id: string } | undefined {
  const before = body.slice(0, index);
  const headings = [...before.matchAll(/^#{2,3}\s+(.+)$/gm)];
  const last = headings[headings.length - 1];
  if (!last) return undefined;
  const text = last[1].replace(/[*_`]/g, "").trim();
  return { text, id: slugify(text) };
}

function excerptAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + length + 90);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  // \x00 brackets the match; the component turns those into <mark>. Passing
  // HTML through would mean trusting the corpus not to contain any.
  return (
    head +
    text.slice(start, at) +
    "\x00" +
    text.slice(at, at + length) +
    "\x00" +
    text.slice(at + length, end) +
    tail
  );
}

function scoreDoc(doc: Doc, query: string): Hit | null {
  const q = query.toLowerCase();

  // A title match wins outright: someone typing "memory" wants the Memory page,
  // not the sentence about memory on the Projects page.
  const title = doc.title.toLowerCase();
  if (title.includes(q)) {
    return {
      slug: doc.slug,
      title: doc.title,
      excerpt: doc.description ?? plain(doc.body).slice(0, 150),
      score: title === q ? 1000 : 500 - title.indexOf(q),
    };
  }

  // Then a heading, which is still a section someone can be sent to.
  const heading = doc.headings.find((h) => h.text.toLowerCase().includes(q));
  if (heading) {
    return {
      slug: doc.slug,
      title: doc.title,
      section: heading.text,
      hash: `#${heading.id}`,
      excerpt: doc.description ?? "",
      score: 300,
    };
  }

  const text = plain(doc.body);
  const at = text.toLowerCase().indexOf(q);
  if (at === -1) return null;

  const section = sectionAt(doc.body, doc.body.toLowerCase().indexOf(q));
  return {
    slug: doc.slug,
    title: doc.title,
    section: section?.text,
    hash: section ? `#${section.id}` : undefined,
    excerpt: excerptAround(text, at, query.length),
    score: 100,
  };
}

export function search(query: string, limit = 8): Hit[] {
  const q = query.trim();
  // One or two characters match nearly everything, which is noise rather than
  // help — the list would be the whole site in arbitrary order.
  if (q.length < 2) return [];

  return Object.values(docs)
    .map((doc) => scoreDoc(doc, q))
    .filter((hit): hit is Hit => hit !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
