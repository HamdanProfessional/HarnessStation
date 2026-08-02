import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The documentation is markdown files plus a hand-written sidebar, and the two
 * can drift apart silently: a renamed file leaves a dead sidebar entry, a new
 * file never appears, and a relative link that was right when written breaks
 * when a page moves. None of that fails a build — it just ships broken links.
 *
 * These checks read the real files rather than importing the site, so they run
 * in the existing Node test environment with no browser or Vite involved.
 */

const CONTENT = resolve(__dirname, "../docs-site/content");
const NAV_FILE = resolve(__dirname, "../docs-site/src/nav.ts");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith(".md") ? [full] : [];
  });
}

const files = markdownFiles(CONTENT);

/** "content/guide/tools.md" → "guide/tools", matching content.ts. */
const slugOf = (file: string) =>
  relative(CONTENT, file).replace(/\\/g, "/").replace(/\.md$/, "").replace(/\/index$/, "");

const slugs = new Set(files.map(slugOf));

/** Slugs the sidebar links to, read out of the nav source. */
const navSlugs = [...readFileSync(NAV_FILE, "utf8").matchAll(/slug:\s*"([^"]+)"/g)].map(
  (m) => m[1],
);

describe("the docs sidebar", () => {
  it("only links to pages that exist", () => {
    const missing = navSlugs.filter((slug) => !slugs.has(slug));
    expect(missing, `sidebar links with no file: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists every page, so nothing is unreachable", () => {
    const orphans = [...slugs].filter((slug) => !navSlugs.includes(slug));
    expect(orphans, `pages missing from the sidebar: ${orphans.join(", ")}`).toEqual([]);
  });

  it("has no duplicate entries", () => {
    expect(navSlugs.length).toBe(new Set(navSlugs).size);
  });
});

describe("every page", () => {
  it("declares a title and a description", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      expect(front, `${slugOf(file)} has no front matter`).toBeTruthy();
      // The description is the lede and the search summary, so a page without
      // one looks unfinished in two places.
      expect(front![1], slugOf(file)).toMatch(/^title:\s*\S/m);
      expect(front![1], slugOf(file)).toMatch(/^description:\s*\S/m);
    }
  });

  it("starts with exactly one H1", () => {
    for (const file of files) {
      const body = readFileSync(file, "utf8")
        .replace(/^---[\s\S]*?---\r?\n/, "")
        // A `# Windows` inside a shell example is a comment, not a heading —
        // the renderer's own heading scan drops fenced code for the same reason.
        .replace(/```[\s\S]*?```/g, "");
      const h1s = body.split(/\r?\n/).filter((l) => /^#\s+\S/.test(l));
      expect(h1s.length, `${slugOf(file)} has ${h1s.length} H1s`).toBe(1);
    }
  });
});

describe("internal links", () => {
  /** Resolve a relative markdown link against the page containing it. */
  const resolveLink = (fromSlug: string, href: string) => {
    const dir = fromSlug.includes("/") ? fromSlug.replace(/\/[^/]*$/, "") : "";
    const parts = (dir ? `${dir}/${href}` : href).split("/");
    const out: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  };

  it("all point at real pages", () => {
    const broken: string[] = [];
    for (const file of files) {
      const from = slugOf(file);
      const text = readFileSync(file, "utf8");
      for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
        // External links and pure fragments aren't ours to check.
        if (/^(https?:|mailto:|#)/.test(href)) continue;
        const target = resolveLink(from, href.split("#")[0]);
        if (!slugs.has(target)) broken.push(`${from} → ${href}`);
      }
    }
    expect(broken, `broken links:\n${broken.join("\n")}`).toEqual([]);
  });
});
