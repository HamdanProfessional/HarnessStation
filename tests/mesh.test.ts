import { beforeEach, describe, expect, it } from "vitest";
import {
  authorize,
  describeSelf,
  deviceId,
  looksLikeCode,
  newPairingCode,
  normalizePairingCode,
  remotelySafe,
  type MeshPeer,
  type MeshShare,
} from "../src/lib/mesh";
import type { Settings, Tool } from "../src/lib/types";

const OFF: MeshShare = { models: false, tools: false, knowledge: false };
const ALL: MeshShare = { models: true, tools: true, knowledge: true };

const peer = (over: Partial<MeshPeer> = {}): MeshPeer => ({
  id: "peer-1",
  name: "Laptop",
  addr: "192.168.1.5:8793",
  paired: true,
  online: true,
  seen: 0,
  capabilities: null,
  ...over,
});

const tool = (id: string): Tool => ({
  id,
  name: id,
  description: "",
  parameters: { type: "object", properties: {} },
  code: "",
  builtin: true,
});

const settings = (): Settings =>
  ({
    providers: [
      { id: "p1", name: "Local", kind: "openai", baseUrl: "", apiKey: "", models: ["qwen3", "llama"] },
    ],
    globalInstructions: "",
    theme: "dark",
  }) as Settings;

describe("pairing codes", () => {
  it("are readable: no characters people confuse when retyping", () => {
    for (let i = 0; i < 200; i++) {
      expect(newPairingCode()).not.toMatch(/[BILOSZ0158]/);
    }
  });

  it("carry enough entropy to not be guessable", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newPairingCode()));
    expect(seen.size).toBe(500);
    expect(newPairingCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("normalise to one form however they're typed", () => {
    // Both ends hash the normalised string; if these disagreed, pairing would
    // fail with an authentication error and no hint as to why.
    const canonical = "KMEN-7RQT-VDXA";
    for (const typed of [
      "KMEN-7RQT-VDXA",
      "kmen7rqtvdxa",
      "KMEN 7RQT VDXA",
      "  kmen-7rqt-vdxa  ",
      "KMEN—7RQT—VDXA",
    ]) {
      expect(normalizePairingCode(typed)).toBe(canonical);
    }
  });

  it("only look complete at full length", () => {
    expect(looksLikeCode("KMEN-7RQT")).toBe(false);
    expect(looksLikeCode("KMEN-7RQT-VDXA")).toBe(true);
    expect(looksLikeCode("kmen7rqtvdxa")).toBe(true);
  });
});

describe("what this device offers", () => {
  it("advertises nothing at all when sharing is off", () => {
    const caps = describeSelf(settings(), [tool("read_file")], ["Docs"], OFF, "Desk");
    expect(caps.models).toEqual([]);
    expect(caps.tools).toEqual([]);
    expect(caps.knowledge).toEqual([]);
  });

  it("lists models as provider / model when models are shared", () => {
    const caps = describeSelf(settings(), [], [], { ...OFF, models: true });
    expect(caps.models).toEqual(["Local / qwen3", "Local / llama"]);
  });

  it("never offers a shell, a file write, or Python — even with everything shared", () => {
    const caps = describeSelf(
      settings(),
      [tool("run_command"), tool("python"), tool("write_file"), tool("read_file"), tool("search_web")],
      ["Docs"],
      ALL,
    );
    expect(caps.tools).toEqual(["read_file", "search_web"]);
    expect(remotelySafe(tool("run_command"))).toBe(false);
    expect(remotelySafe(tool("fs_write"))).toBe(false);
    expect(remotelySafe(tool("read_file"))).toBe(true);
  });
});

describe("authorising an inbound request", () => {
  it("refuses anything from a device that isn't paired", () => {
    const unpaired = [peer({ paired: false })];
    for (const method of ["describe", "ask", "run_tool", "search_knowledge"]) {
      expect(authorize({ method, peerId: "peer-1" }, ALL, unpaired)).toMatch(/doesn't recognise/);
    }
    expect(authorize({ method: "ask", peerId: "stranger" }, ALL, [peer()])).toMatch(
      /doesn't recognise/,
    );
  });

  it("refuses each capability independently", () => {
    const peers = [peer()];
    expect(authorize({ method: "ask", peerId: "peer-1" }, OFF, peers)).toMatch(/models/);
    expect(authorize({ method: "run_tool", peerId: "peer-1" }, OFF, peers)).toMatch(/tools/);
    expect(authorize({ method: "search_knowledge", peerId: "peer-1" }, OFF, peers)).toMatch(
      /knowledge/,
    );

    // Sharing models must not quietly grant tools.
    const modelsOnly = { ...OFF, models: true };
    expect(authorize({ method: "ask", peerId: "peer-1" }, modelsOnly, peers)).toBeNull();
    expect(authorize({ method: "run_tool", peerId: "peer-1" }, modelsOnly, peers)).not.toBeNull();
  });

  it("always answers describe, so a peer can see there's nothing on offer", () => {
    expect(authorize({ method: "describe", peerId: "peer-1" }, OFF, [peer()])).toBeNull();
  });

  it("rejects methods it doesn't know rather than falling through", () => {
    expect(authorize({ method: "eval", peerId: "peer-1" }, ALL, [peer()])).toMatch(/unknown/);
  });
});

describe("device identity", () => {
  beforeEach(() => localStorage.clear());

  it("is generated once and then stable — peers key their tokens to it", () => {
    const first = deviceId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceId()).toBe(first);
  });
});
