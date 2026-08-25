import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS } from "../src/lib/tools";

/**
 * Runs a built-in tool's body the same way `executeTool` does — `new
 * AsyncFunction("args", "ctx", tool.code)` — but with a stub ctx, so paging can
 * be tested without the store, the filesystem or the network.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function run(id: string, args: Record<string, unknown>, ctx: unknown): Promise<string> {
  const tool = BUILTIN_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`no such built-in tool: ${id}`);
  return new AsyncFunction("args", "ctx", tool.code)(args, ctx) as Promise<string>;
}

const fsCtx = (text: string) => ({ fs: { read: async () => text } });
const netCtx = (text: string) => ({ fetch: async () => ({ status: 200, text: async () => text }) });

const LONG = "x".repeat(20000);

describe("read_file paging", () => {
  it("returns a short file whole, with no truncation marker", async () => {
    const out = await run("read_file", { path: "a.txt" }, fsCtx("hello"));
    expect(out).toBe("hello");
  });

  it("says where it stopped and how to continue", async () => {
    // The old version appended a bare "...[truncated]", which told the model the
    // text was incomplete but gave it no way to get the rest.
    const out = await run("read_file", { path: "a.txt" }, fsCtx(LONG));
    expect(out).toContain("truncated at character 8000 of 20000");
    expect(out).toContain("offset=8000");
  });

  it("reads the next window from the reported offset", async () => {
    const out = await run("read_file", { path: "a.txt" }, fsCtx(LONG));
    const at = Number(/offset=(\d+)/.exec(out)![1]);
    const next = await run("read_file", { path: "a.txt", offset: at }, fsCtx(LONG));
    expect(next).toContain("offset=16000");
  });

  it("reaches the end of the file without a trailing marker", async () => {
    const out = await run("read_file", { path: "a.txt", offset: 16000 }, fsCtx(LONG));
    expect(out).toHaveLength(4000);
    expect(out).not.toContain("truncated");
  });

  it("covers the whole file across successive calls, losing nothing", async () => {
    // The point of the change: before this, everything past 8000 was
    // unreachable no matter how the model was prompted.
    const text = Array.from({ length: 20000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    let out = "";
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const chunk = await run("read_file", { path: "a.txt", offset }, fsCtx(text));
      const m = /\n\.\.\.\[truncated at character (\d+)/.exec(chunk);
      out += m ? chunk.slice(0, chunk.indexOf("\n...[truncated")) : chunk;
      if (!m) break;
      offset = Number(m[1]);
    }
    expect(out).toBe(text);
  });

  it("explains an offset past the end rather than returning nothing", async () => {
    const out = await run("read_file", { path: "a.txt", offset: 999 }, fsCtx("short"));
    expect(out).toContain("past the end of the file");
    expect(out).toContain("5 characters");
  });

  it("treats a missing or negative offset as the start", async () => {
    expect(await run("read_file", { path: "a.txt" }, fsCtx("abc"))).toBe("abc");
    expect(await run("read_file", { path: "a.txt", offset: -5 }, fsCtx("abc"))).toBe("abc");
  });

  it("returns an empty file as empty, not as an offset error", async () => {
    expect(await run("read_file", { path: "a.txt" }, fsCtx(""))).toBe("");
  });
});

describe("http_request paging", () => {
  it("marks where a long body was cut and how to resume", async () => {
    // http_request absorbed http_get's raw-fetch role when the two merged, so it
    // also inherited the resume protocol: a bare slice with no way to continue
    // would strand the rest of a large API response.
    const out = await run("http_request", { url: "https://x" }, netCtx(LONG));
    expect(out).toContain("truncated at character 6000 of 20000");
    expect(out).toContain("offset=6000");
    expect(out).toMatch(/^HTTP 200\n/);
  });

  it("returns a short body untouched behind the status line", async () => {
    const out = await run("http_request", { url: "https://x" }, netCtx("ok"));
    expect(out).toBe("HTTP 200\nok");
  });

  it("resumes from a reported offset without repeating earlier bytes", async () => {
    const first = await run("http_request", { url: "https://x" }, netCtx(LONG));
    const at = Number(/offset=(\d+)/.exec(first)![1]);
    const next = await run("http_request", { url: "https://x", offset: at }, netCtx(LONG));
    expect(next).toContain("[from character 6000]");
    expect(next).toContain("offset=12000");
  });
});

describe("fetch_page paging", () => {
  it("pages the stripped text, not the raw html", async () => {
    // Offsets have to index the text the model actually receives, or a resume
    // lands in the wrong place.
    const html = "<p>" + "y".repeat(20000) + "</p>";
    const out = await run("fetch_page", { url: "https://x" }, netCtx(html));
    expect(out).toContain("of 20000");
    expect(out).not.toContain("<p>");
  });

  it("honours an explicit max alongside the offset", async () => {
    const out = await run("fetch_page", { url: "https://x", max: 100 }, netCtx("z".repeat(500)));
    expect(out).toContain("truncated at character 100 of 500");
  });
});

describe("the descriptions tell the model paging exists", () => {
  it("documents offset on every tool that truncates", () => {
    // A paging parameter the description does not mention will never be used.
    for (const id of ["read_file", "http_request", "fetch_page"]) {
      const tool = BUILTIN_TOOLS.find((t) => t.id === id)!;
      expect(tool.description, id).toContain("offset");
      expect(tool.parameters.properties, id).toHaveProperty("offset");
    }
  });
});
