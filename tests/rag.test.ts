import { describe, expect, it } from "vitest";
import { chunkText, topChunks } from "../src/lib/rag";
import type { Chunk, KnowledgeBase } from "../src/lib/types";

const kb = (chunks: Chunk[]): KnowledgeBase => ({
  id: "kb",
  name: "KB",
  embedProviderId: "p",
  embedModel: "m",
  chunks,
});

describe("chunkText", () => {
  it("keeps a short document as one chunk", () => {
    const out = chunkText("hello world", "a.md");
    expect(out).toEqual([{ text: "hello world", source: "a.md" }]);
  });

  it("normalises CRLF and collapses blank-line runs", () => {
    const [first] = chunkText("a\r\n\n\n\n\nb", "a.md");
    expect(first.text).toBe("a\n\nb");
  });

  it("splits long text into overlapping chunks that cover the whole document", () => {
    const text = "abcdefghij".repeat(40); // 400 chars, no boundaries
    const out = chunkText(text, "src", 100, 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.source === "src")).toBe(true);
    expect(out.every((c) => c.text.length <= 100)).toBe(true);
    // every chunk after the first re-includes the previous chunk's tail
    expect(out[1].text.slice(0, 20)).toBe(out[0].text.slice(-20));
  });

  it("prefers a sentence boundary past the halfway mark", () => {
    const text = `${"x".repeat(70)}. ${"y".repeat(200)}`;
    const [first] = chunkText(text, "s", 100, 20);
    expect(first.text.endsWith(".")).toBe(true);
  });

  it("terminates on a normal document at the default settings", () => {
    // Regression: the tail window (end === length) used to step back by `overlap`
    // and re-slice the same range forever, hanging any import over 200 chars.
    const doc = "The quick brown fox jumps over the lazy dog. ".repeat(60);
    const out = chunkText(doc, "doc.txt");
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(20);
    expect(out[out.length - 1].text.endsWith("lazy dog.")).toBe(true);
  });

  it("terminates just past the overlap size", () => {
    expect(chunkText("w".repeat(250), "s").length).toBe(1);
  });

  it("terminates on an empty document", () => {
    expect(chunkText("   \n\n  ", "s")).toEqual([]);
  });

  it("terminates when overlap is not smaller than the chunk size", () => {
    // i = end - overlap would go backwards forever; the guard must break out.
    const out = chunkText("z".repeat(500), "s", 50, 50);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(50);
  });
});

describe("topChunks", () => {
  const c = (text: string, vector: number[]): Chunk => ({ text, source: "s", vector });

  it("ranks by cosine similarity, not magnitude", () => {
    const base = kb([
      c("orthogonal", [0, 1]),
      c("aligned-but-short", [0.1, 0]),
      c("opposite", [-1, 0]),
    ]);
    expect(topChunks(base, [1, 0], 3).map((x) => x.text)).toEqual(["aligned-but-short", "orthogonal", "opposite"]);
  });

  it("caps the result at k", () => {
    const base = kb([c("a", [1, 0]), c("b", [0.9, 0.1]), c("c", [0.8, 0.2])]);
    expect(topChunks(base, [1, 0], 2)).toHaveLength(2);
  });

  it("returns nothing for an empty knowledge base", () => {
    expect(topChunks(kb([]), [1, 0])).toEqual([]);
  });

  it("does not divide by zero on a zero vector", () => {
    const out = topChunks(kb([c("zero", [0, 0])]), [1, 0]);
    expect(out).toHaveLength(1);
  });
});
