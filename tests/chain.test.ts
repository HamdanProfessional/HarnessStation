import { describe, expect, it, vi } from "vitest";
import { streamChain } from "../src/lib/providers/index";
import type { ChatParams, Provider } from "../src/lib/types";

const prov = (id: string): Provider => ({
  id,
  name: id,
  kind: "openai-compatible",
  baseUrl: `https://${id}/v1`,
  apiKey: `key-${id}`,
  models: [`${id}-m`],
});

const params = (over: Partial<ChatParams> = {}): ChatParams => ({
  provider: prov("unused"),
  model: "unused",
  system: "",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.7,
  maxTokens: 100,
  signal: new AbortController().signal,
  onDelta: () => {},
  ...over,
});

const ok = (text: string) => async (p: ChatParams) => {
  p.onDelta(text);
  return { toolCalls: null, usage: { promptTokens: 1, completionTokens: 1 } };
};

describe("streamChain", () => {
  it("walks the chain until a step succeeds, passing each step's provider and model", async () => {
    const calls: string[] = [];
    const send = vi.fn(async (p: ChatParams) => {
      calls.push(`${p.provider.id}:${p.model}`);
      if (p.provider.id !== "third") throw new Error("down");
      return ok("hi from third")(p);
    });

    const r = await streamChain(
      [
        { provider: prov("first"), model: "m1" },
        { provider: prov("second"), model: "m2" },
        { provider: prov("third"), model: "m3" },
      ],
      params(),
      send,
    );
    expect(calls).toEqual(["first:m1", "second:m2", "third:m3"]);
    expect(r.toolCalls).toBeNull();
  });

  it("does not advance once text has streamed — a partial reply must not be duplicated", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async (p: ChatParams) => {
        p.onDelta("partial ");
        throw new Error("died mid-stream");
      })
      .mockImplementation(ok("should never happen"));

    await expect(
      streamChain(
        [
          { provider: prov("a"), model: "m" },
          { provider: prov("b"), model: "m" },
        ],
        params(),
        send,
      ),
    ).rejects.toThrow("died mid-stream");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an aborted request stops the walk", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(
      streamChain(
        [
          { provider: prov("a"), model: "m" },
          { provider: prov("b"), model: "m" },
        ],
        params({ signal: controller.signal }),
        send,
      ),
    ).rejects.toThrow("aborted");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every step fails, with a clear message for an empty chain", async () => {
    const send = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(
      streamChain(
        [
          { provider: prov("a"), model: "m" },
          { provider: prov("b"), model: "m" },
        ],
        params(),
        send,
      ),
    ).rejects.toThrow("nope");
    expect(send).toHaveBeenCalledTimes(2);

    await expect(streamChain([], params(), send)).rejects.toThrow(/empty/);
  });

  it("an empty step model falls back to the caller's model", async () => {
    const send = vi.fn(ok("x"));
    await streamChain([{ provider: prov("a"), model: "" }], params({ model: "caller-model" }), send);
    expect(send.mock.calls[0][0].model).toBe("caller-model");
  });

  it("a recently-429'd step is tried last, without being removed", async () => {
    const { recordRateLimit } = await import("../src/lib/quota");
    recordRateLimit("limited", 5 * 60_000, Date.now());

    // Both fail, so the whole chain is walked and the order is observable.
    const order: string[] = [];
    const sendAll = vi.fn(async (p: ChatParams) => {
      order.push(p.provider.id);
      throw new Error("down");
    });
    await expect(
      streamChain(
        [
          { provider: prov("limited"), model: "m" },
          { provider: prov("healthy"), model: "m" },
        ],
        params(),
        sendAll,
      ),
    ).rejects.toThrow("down");
    expect(order).toEqual(["healthy", "limited"]);

    // And a healthy step still short-circuits the chain before the limited one.
    order.length = 0;
    const sendOk = vi.fn(async (p: ChatParams) => {
      order.push(p.provider.id);
      if (p.provider.id === "limited") throw new Error("still limited");
      return ok("ok")(p);
    });
    const r = await streamChain(
      [
        { provider: prov("limited"), model: "m" },
        { provider: prov("healthy"), model: "m" },
      ],
      params(),
      sendOk,
    );
    expect(order).toEqual(["healthy"]);
    expect(r.toolCalls).toBeNull();
  });
});
