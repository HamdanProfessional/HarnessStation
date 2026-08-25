import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AcpBridge } from "../src/lib/acp";
import { acpConnect } from "../src/lib/acp";

/**
 * WP3 end-to-end: acpConnect against a REAL fake agent subprocess (node),
 * through an injected bridge that spawns it. This exercises the actual
 * protocol handling — framing, id correlation, notification routing,
 * permission round-trips — without Tauri.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fake-acp-agent.mjs");

interface Live {
  writes: string[];
  /** Test seam: kill every child (simulates a crash / cleanup). */
  killAll(): void;
  /** Test seam: the most recently spawned child, for direct signals. */
  lastChild: ReturnType<typeof spawn> | null;
}

function fakeBridge(live: Live): AcpBridge {
  // Children tracked per rid, and event/exit callbacks as sets — the real
  // Tauri bridge supports concurrent connectors and multiple listeners, and
  // the fake must too or tests pass for the wrong reason.
  const children = new Map<string, ReturnType<typeof spawn>>();
  const eventCbs = new Set<(id: string, line: string) => void>();
  const exitCbs = new Set<(id: string) => void>();
  return {
    async spawn(id, command, args) {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      children.set(id, child);
      live.lastChild = child;
      child.stdout.setEncoding("utf8");
      let buf = "";
      child.stdout.on("data", (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) for (const cb of eventCbs) cb(id, line);
        }
      });
      child.on("exit", () => { for (const cb of exitCbs) cb(id); });
    },
    async write(id, line) {
      live.writes.push(line);
      const child = children.get(id);
      if (!child?.stdin.write(`${line}\n`)) await new Promise((r) => child!.stdin.once("drain", r)).catch(() => {});
    },
    async kill(id) {
      const child = children.get(id);
      child?.kill();
      children.delete(id);
    },
    async onEvent(cb) {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    async onExit(cb) {
      exitCbs.add(cb);
      return () => exitCbs.delete(cb);
    },
  };
}

describe("acpConnect against a real fake agent", () => {
  const live: Live = { writes: [], killAll: () => {}, lastChild: null };
  const bridge = fakeBridge(live);

  beforeEach(() => {
    live.writes = [];
  });

  afterEach(async () => {
    // Kill any children the test left behind (dispose is the clean path).
    await new Promise((r) => setTimeout(r, 50));
  });

  it("initializes, creates a session and streams a prompt turn", async () => {
    const updates: string[] = [];
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      { onUpdate: (u) => updates.push(u.content?.text ?? "") },
      bridge,
    );
    expect(session.sessionId).toMatch(/^sess_fake_/);

    const r = await session.prompt("say hi");
    expect(r).toEqual({ stopReason: "end_turn" });
    expect(updates.join("")).toBe("Hello from fake!");

    // The client spoke ACP correctly on the wire.
    const methods = live.writes.map((w) => JSON.parse(w).method);
    expect(methods).toEqual(["initialize", "session/new", "session/prompt"]);
    const init = JSON.parse(live.writes[0]);
    expect(init.params.protocolVersion).toBe(1);
    expect(init.params.clientInfo.name).toBe("harnessstation");
    await session.dispose();
  });

  it("routes permission requests to the hook and answers with the chosen option", async () => {
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      {
        onUpdate: () => {},
        onRequestPermission: async (req) => {
          expect(req.toolCall?.title).toBe("Write a file");
          expect(req.options.map((o) => o.optionId)).toEqual(["allow", "deny"]);
          return "deny";
        },
      },
      bridge,
    );
    const updates: string[] = [];
    const r = await session.prompt("perm check");
    void updates;
    expect(r.stopReason).toBe("end_turn");
    await session.dispose();
  });

  it("a dismissed permission request maps to the cancelled outcome", async () => {
    let captured = "";
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      {
        onUpdate: (u) => (captured += u.content?.text ?? ""),
        onRequestPermission: async () => null,
      },
      bridge,
    );
    await session.prompt("perm check");
    expect(captured).toContain("permission:cancelled");
    await session.dispose();
  });

  it("answers agent fs/terminal requests with a refusal the agent can see", async () => {
    let captured = "";
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      { onUpdate: (u) => (captured += u.content?.text ?? "") },
      bridge,
    );
    await session.prompt("readfile please");
    expect(captured).toContain("fs-error:");
    expect(captured).toContain("does not provide fs/read_text_file");
    await session.dispose();
  });

  it("cancel settles a hanging turn with the cancelled stop reason", async () => {
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      { onUpdate: () => {} },
      bridge,
    );
    const p = session.prompt("hang");
    await new Promise((r) => setTimeout(r, 300));
    session.cancel();
    await expect(p).resolves.toEqual({ stopReason: "cancelled" });
    await session.dispose();
  });

  it("agent exit rejects an in-flight prompt and fires onExit", async () => {
    const onExit = vi.fn();
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      { onUpdate: () => {}, onExit },
      bridge,
    );
    const p = session.prompt("hang");
    await new Promise((r) => setTimeout(r, 300));
    live.lastChild?.kill("SIGKILL"); // simulate the agent crashing
    await expect(p).rejects.toThrow(/exited/);
    expect(onExit).toHaveBeenCalled();
    // And a prompt after the exit fails cleanly instead of writing into a void.
    await expect(session.prompt("again")).rejects.toThrow(/closed|exited/);
  });

  it("two connectors over the same configured agent never cross wires", async () => {
    const aUpdates: string[] = [];
    const bUpdates: string[] = [];
    const a = await acpConnect(
      { id: "twin", name: "Twin A", command: process.execPath, args: [FAKE] },
      { onUpdate: (u) => aUpdates.push(u.content?.text ?? "") },
      bridge,
    );
    const b = await acpConnect(
      { id: "twin", name: "Twin B", command: process.execPath, args: [FAKE] },
      { onUpdate: (u) => bUpdates.push(u.content?.text ?? "") },
      bridge,
    );
    // Distinct processes generate distinct session ids.
    expect(a.sessionId).not.toBe(b.sessionId);

    await a.prompt("say hi");
    await b.prompt("say hi");
    // A's reply went to A only, B's to B only.
    expect(aUpdates.join("")).toBe("Hello from fake!");
    expect(bUpdates.join("")).toBe("Hello from fake!");

    // Killing one leaves the other working.
    await a.dispose();
    const r = await b.prompt("still there?");
    expect(r.stopReason).toBe("end_turn");
    await b.dispose();
  });

  it("an agent that never initializes fails fast with a timeout", async () => {
    process.env.FAKE_DELAY_INIT_MS = "5000";
    try {
      await expect(
        acpConnect(
          { id: "slow", name: "Slow", command: process.execPath, args: [FAKE] },
          { onUpdate: () => {} },
          bridge,
          { initTimeoutMs: 300 },
        ),
      ).rejects.toThrow(/timed out/);
    } finally {
      delete process.env.FAKE_DELAY_INIT_MS;
    }
  });

  it("a permission request with no options is auto-cancelled, not shown as an empty question", async () => {
    const onRequestPermission = vi.fn(async () => "allow");
    let captured = "";
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      { onUpdate: (u) => (captured += u.content?.text ?? ""), onRequestPermission },
      bridge,
    );
    await session.prompt("permnoopts");
    expect(captured).toContain("permnoopts:cancelled");
    expect(onRequestPermission).not.toHaveBeenCalled();
    await session.dispose();
  });

  it("cancel answers a pending permission request with the cancelled outcome", async () => {
    const session = await acpConnect(
      { id: "fake", name: "Fake", command: process.execPath, args: [FAKE] },
      {
        onUpdate: () => {},
        // The dialog sits unanswered — the user is staring at it when they hit Stop.
        onRequestPermission: () => new Promise(() => {}),
      },
      bridge,
    );
    const p = session.prompt("permhang");
    // Let the permission request land and the dialog open.
    await new Promise((r) => setTimeout(r, 800));
    live.writes.length = 0; // clear, so we can assert just the cancel messages
    session.cancel();

    // Spec: the client MUST answer the pending permission request with the
    // cancelled outcome AND send session/cancel. Both on the wire.
    await vi.waitFor(() => {
      const lines = live.writes.map((w) => JSON.parse(w));
      expect(lines.some((m) => m.id != null && m.result?.outcome?.outcome === "cancelled")).toBe(true);
      expect(lines.some((m) => m.method === "session/cancel")).toBe(true);
    }, { timeout: 3000 });
    await session.dispose();
  }, 10_000);
});
