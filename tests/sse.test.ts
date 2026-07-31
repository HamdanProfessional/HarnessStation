import { describe, expect, it } from "vitest";
import { readSSE } from "../src/lib/providers/sse";

/** Build a Response-like object that yields `chunks` from its reader. */
function sseResponse(chunks: string[], init: { ok?: boolean; status?: number; text?: string } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => init.text ?? "",
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

const collect = async (chunks: string[]) => {
  const out: string[] = [];
  await readSSE(sseResponse(chunks), (d) => out.push(d));
  return out;
};

describe("readSSE", () => {
  it("emits each data payload", async () => {
    expect(await collect(['data: {"a":1}\n', 'data: {"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("reassembles an event split across chunks", async () => {
    expect(await collect(['data: {"a', '":1}\n'])).toEqual(['{"a":1}']);
  });

  it("emits a trailing event that has no final newline", async () => {
    // Regression: the leftover buffer was dropped, losing the last chunk —
    // typically the one carrying the usage totals.
    expect(await collect(['data: {"a":1}\n', 'data: {"usage":true}'])).toEqual(['{"a":1}', '{"usage":true}']);
  });

  it("ignores comments, blank lines and non-data fields", async () => {
    expect(await collect([": ping\n\nevent: message\ndata: real\n"])).toEqual(["real"]);
  });

  it("handles a multi-byte character split across chunks", async () => {
    const enc = new TextEncoder().encode("data: héllo\n");
    const out: string[] = [];
    let i = 0;
    const parts = [enc.slice(0, 8), enc.slice(8)]; // splits the é
    await readSSE(
      {
        ok: true,
        body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }) }) },
      } as unknown as Response,
      (d) => out.push(d),
    );
    expect(out).toEqual(["héllo"]);
  });

  it("throws with the server's message on a non-ok response", async () => {
    const res = sseResponse([], { ok: false, status: 401, text: '{"error":"bad key"}' });
    await expect(readSSE(res, () => {})).rejects.toThrow(/HTTP 401.*bad key/);
  });

  it("throws a clear error when there is no response body", async () => {
    const res = { ok: true, status: 200, body: null } as unknown as Response;
    await expect(readSSE(res, () => {})).rejects.toThrow(/no response body/);
  });
});
