/**
 * `@`-references: inline context injection in a message.
 *
 * Type `@file:notes/spec.md` or `@https://example.com/page` in the composer and
 * the referenced content is fetched and attached to your message, so the model
 * sees it without you pasting it. Files resolve against the chat's working
 * directory (the same sandbox the file tools use).
 *
 *   "@file:README.md summarise this"
 *   "compare @https://a.com/x and @https://b.com/y"
 *
 * Each reference becomes a text attachment; the message text is left as-is.
 */
import type { Attachment } from "./types";

/** Matches @file:PATH or @http(s)://URL up to whitespace. */
const REF = /@(file:(\S+)|https?:\/\/\S+)/g;
const MAX = 20_000; // per reference, so one huge file can't blow the context

function clip(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX)}\n…[truncated]` : s;
}

async function readFileRef(path: string, cwd: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return clip(await invoke<string>("fs_read", { base: cwd, path }));
}

async function readUrlRef(url: string): Promise<string> {
  const { fetch } = await import("@tauri-apps/plugin-http");
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Cheap de-tag so an HTML page reads as text rather than markup soup.
  const plain = /</.test(text)
    ? text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    : text;
  return clip(plain.trim());
}

/** Resolve every @reference in `text` into text attachments. Bad refs become notes. */
export async function resolveReferences(text: string, cwd = ""): Promise<Attachment[]> {
  const tokens = [...text.matchAll(REF)];
  if (!tokens.length) return [];
  const out: Attachment[] = [];
  for (const m of tokens) {
    const whole = m[0]; // e.g. @file:README.md
    const isFile = !!m[2];
    try {
      const content = isFile ? await readFileRef(m[2], cwd) : await readUrlRef(m[1]);
      out.push({ kind: "text", name: whole, mime: "text/plain", data: `# Reference: ${whole}\n\n${content}` });
    } catch (e) {
      out.push({ kind: "text", name: whole, mime: "text/plain", data: `# Reference: ${whole}\n\n[could not load: ${(e as Error).message}]` });
    }
  }
  return out;
}

/** True if the text contains at least one @reference (so the caller can resolve). */
export function hasReferences(text: string): boolean {
  REF.lastIndex = 0;
  return REF.test(text);
}
