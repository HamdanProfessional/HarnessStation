import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundRequest, MeshPeer, MeshShare } from "../src/lib/mesh";

/**
 * The one invariant that matters here: *every* inbound request gets a reply.
 *
 * A request the host drops doesn't fail — it hangs the calling device until its
 * 60-second timeout, which reads as a broken network rather than a refused
 * permission. Refusals and crashes both have to come back as errors.
 */

type Handler = (event: { payload: InboundRequest }) => void;
let handler: Handler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, fn: Handler) => {
    handler = fn;
    return () => {
      handler = null;
    };
  }),
}));

const replies: { rid: number; result: unknown; error: string | null }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "mesh_reply") {
      replies.push({
        rid: args.rid as number,
        result: args.result,
        error: (args.error as string) ?? null,
      });
    }
    return null;
  }),
}));

const { startHost, stopHost } = await import("../src/lib/meshHost");

const ALL: MeshShare = { models: true, tools: true, knowledge: true };
const OFF: MeshShare = { models: false, tools: false, knowledge: false };

const PAIRED: MeshPeer[] = [
  {
    id: "peer-1",
    name: "Laptop",
    addr: "10.0.0.2:8793",
    paired: true,
    online: true,
    seen: 0,
    capabilities: null,
  },
];

function ctx(over: Record<string, unknown> = {}) {
  return {
    share: () => ALL,
    peers: () => PAIRED,
    ask: async () => "an answer",
    runTool: async () => "tool output",
    searchKnowledge: async () => "a passage",
    describe: () => ({
      name: "Desk",
      version: 1,
      models: ["Local / qwen3"],
      tools: ["read_file"],
      knowledge: [],
      share: ALL,
    }),
    ...over,
  } as Parameters<typeof startHost>[0];
}

/** Deliver a request and wait for the host to finish with it. */
async function send(req: Partial<InboundRequest>) {
  handler?.({
    payload: {
      rid: 1,
      peerId: "peer-1",
      peerName: "Laptop",
      method: "describe",
      params: {},
      ...req,
    } as InboundRequest,
  });
  // The handler is async and fire-and-forget; let its microtasks drain.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  replies.length = 0;
  await startHost(ctx());
});

describe("serving another device", () => {
  it("answers describe with what this device shares", async () => {
    await send({ method: "describe" });
    expect(replies).toHaveLength(1);
    expect(replies[0].error).toBeNull();
    expect((replies[0].result as { models: string[] }).models).toEqual(["Local / qwen3"]);
  });

  it("replies with a reason when a capability isn't shared — never silence", async () => {
    await startHost(ctx({ share: () => OFF }));
    await send({ method: "ask", params: { prompt: "hi" } });
    expect(replies).toHaveLength(1);
    expect(replies[0].error).toMatch(/isn't sharing its models/);
  });

  it("replies with an error when the handler throws", async () => {
    await startHost(
      ctx({
        ask: async () => {
          throw new Error("no provider configured");
        },
      }),
    );
    await send({ method: "ask", params: { prompt: "hi" } });
    expect(replies).toHaveLength(1);
    expect(replies[0].error).toBe("no provider configured");
  });

  it("refuses a tool that isn't in the advertised list, even though tools are shared", async () => {
    // authorize() only knows "tools are shared"; the specific tool is checked
    // again at run time, because the peer's cached list can be out of date.
    await send({ method: "run_tool", params: { id: "run_command" } });
    expect(replies[0].error).toMatch(/isn't sharing "run_command"/);
  });

  it("runs a tool that is shared", async () => {
    await send({ method: "run_tool", params: { id: "read_file", args: { path: "a.txt" } } });
    expect(replies[0].error).toBeNull();
    expect(replies[0].result).toEqual({ output: "tool output" });
  });

  it("rejects an empty prompt rather than calling the model", async () => {
    const ask = vi.fn(async () => "x");
    await startHost(ctx({ ask }));
    await send({ method: "ask", params: { prompt: "   " } });
    expect(ask).not.toHaveBeenCalled();
    expect(replies[0].error).toMatch(/no prompt/);
  });

  it("rejects an unknown method", async () => {
    await send({ method: "shutdown" });
    expect(replies[0].error).toMatch(/unknown request/);
  });

  it("stops listening when the mesh is turned off", async () => {
    await stopHost();
    await send({ method: "describe" });
    expect(replies).toHaveLength(0);
  });
});
