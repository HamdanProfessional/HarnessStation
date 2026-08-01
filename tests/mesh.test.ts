import { beforeEach, describe, expect, it } from "vitest";
import {
  addressExposure,
  authorize,
  describeSelf,
  deviceId,
  exposureNote,
  hostOf,
  looksLikeCode,
  needsWarning,
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

describe("how exposed an address is", () => {
  it("recognises a LAN", () => {
    for (const addr of [
      "192.168.1.20",
      "192.168.1.20:8793",
      "10.0.0.4",
      "172.16.5.5",
      "172.31.255.254",
      "169.254.10.1",
      "desk.local",
      "desk",
      "[fe80::1]:8793",
      "fd00::1",
    ]) {
      expect(addressExposure(addr), addr).toBe("private");
    }
  });

  it("recognises loopback and overlay networks", () => {
    expect(addressExposure("127.0.0.1:8793")).toBe("loopback");
    expect(addressExposure("localhost")).toBe("loopback");
    // Tailscale and other overlays hand out CGNAT addresses; they're tunnelled,
    // so they shouldn't trigger the unencrypted-link warning.
    expect(addressExposure("100.101.102.103")).toBe("vpn");
    expect(addressExposure("100.64.0.1")).toBe("vpn");
  });

  it("calls a routable address public — including the near misses", () => {
    for (const addr of [
      "8.8.8.8",
      "172.32.0.1", // one past the private block
      "172.15.0.1", // one before it
      "100.128.0.1", // one past CGNAT
      "192.169.1.1", // not 192.168
      "203.0.113.9",
      "[2606:4700::1111]:8793",
    ]) {
      expect(addressExposure(addr), addr).toBe("public");
    }
  });

  it("won't guess about a hostname it can't resolve", () => {
    // Erring towards "safe" here would be the one dangerous mistake.
    expect(addressExposure("mybox.example.com")).toBe("unknown");
    expect(addressExposure("")).toBe("unknown");
  });

  it("warns for public and unknown, and stays quiet for the rest", () => {
    expect(needsWarning("public")).toBe(true);
    expect(needsWarning("unknown")).toBe(true);
    expect(needsWarning("private")).toBe(false);
    expect(needsWarning("vpn")).toBe(false);
    expect(needsWarning("loopback")).toBe(false);
  });

  it("explains why, and suggests the fix", () => {
    const note = exposureNote(addressExposure("8.8.8.8"));
    expect(note).toMatch(/isn't encrypted/);
    expect(note).toMatch(/VPN or tunnel/);
    expect(exposureNote("private")).toBeNull();
    expect(exposureNote("vpn")).toBeNull();
  });

  it("pulls the host out of whatever form the address takes", () => {
    expect(hostOf("192.168.1.5:8793")).toBe("192.168.1.5");
    expect(hostOf("ws://192.168.1.5:8793")).toBe("192.168.1.5");
    expect(hostOf("[2606:4700::1111]:8793")).toBe("2606:4700::1111");
    expect(hostOf("2606:4700::1111")).toBe("2606:4700::1111");
  });
});
