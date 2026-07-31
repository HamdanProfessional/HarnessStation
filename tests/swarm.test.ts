import { beforeEach, describe, expect, it } from "vitest";
import {
  describe as describeSwarm,
  joinSwarm,
  leaveSwarm,
  listSessions,
  noteRead,
  noteWrite,
  sendMessage,
  takeInbox,
  trackToolFile,
} from "../src/lib/swarm";

// The module keeps sessions in a module-level map, so each test cleans up after itself.
beforeEach(() => {
  for (const s of listSessions()) leaveSwarm(s.id);
});

describe("session bookkeeping", () => {
  it("registers and removes sessions", () => {
    const a = joinSwarm("alpha", "/work");
    expect(listSessions()).toEqual([{ id: a, name: "alpha", cwd: "/work" }]);
    leaveSwarm(a);
    expect(listSessions()).toEqual([]);
  });

  it("issues distinct ids", () => {
    expect(joinSwarm("a")).not.toBe(joinSwarm("b"));
  });
});

describe("file-conflict notices", () => {
  it("tells a reader when someone else writes the file", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteRead(a, "C:/proj/src/app.ts");
    noteWrite(b, "C:/proj/src/app.ts");
    const inbox = takeInbox(a);
    expect(inbox).toContain("[swarm]");
    expect(inbox).toContain("beta");
    expect(inbox).toContain("Re-read it");
  });

  it("matches paths regardless of slash direction and case", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteRead(a, "C:\\Proj\\App.ts");
    noteWrite(b, "c:/proj/app.ts");
    expect(takeInbox(a)).not.toBe("");
  });

  it("does not notify the writer about its own edit", () => {
    const a = joinSwarm("alpha");
    noteRead(a, "f.ts");
    noteWrite(a, "f.ts");
    expect(takeInbox(a)).toBe("");
  });

  it("does not notify a session that never read the file", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteWrite(b, "untouched.ts");
    expect(takeInbox(a)).toBe("");
  });

  it("treats a write as a read, so the writer hears about later edits", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteWrite(a, "f.ts");
    noteWrite(b, "f.ts");
    expect(takeInbox(a)).toContain("f.ts");
  });

  it("ignores empty paths", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteRead(a, "");
    noteWrite(b, "");
    expect(takeInbox(a)).toBe("");
  });
});

describe("messaging", () => {
  it("delivers to a session addressed by name, case-insensitively", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("Beta");
    expect(sendMessage(a, "beta", "ping")).toBe("Sent to Beta.");
    expect(takeInbox(b)).toBe("[swarm] alpha: ping");
  });

  it("broadcasts with * to everyone but the sender", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    const c = joinSwarm("gamma");
    sendMessage(a, "*", "hi all");
    expect(takeInbox(b)).toContain("hi all");
    expect(takeInbox(c)).toContain("hi all");
    expect(takeInbox(a)).toBe("");
  });

  it("reports who is running when the target is unknown", () => {
    const a = joinSwarm("alpha");
    joinSwarm("beta");
    const out = sendMessage(a, "nobody", "hi");
    expect(out).toContain('No other agent matches "nobody"');
    expect(out).toContain("beta");
  });

  it("drains the inbox — a second take is empty", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    sendMessage(a, "*", "once");
    expect(takeInbox(b)).not.toBe("");
    expect(takeInbox(b)).toBe("");
  });

  it("returns empty for an unknown session id", () => {
    expect(takeInbox("nope")).toBe("");
  });
});

describe("describe", () => {
  it("says so when nobody else is running", () => {
    const a = joinSwarm("alpha");
    expect(describeSwarm(a)).toBe("no other agents are running.");
  });

  it("lists the others with their ids", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    expect(describeSwarm(a)).toBe(`beta (${b})`);
  });
});

describe("trackToolFile", () => {
  it("records reads from read-style tools and writes from write-style tools", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    trackToolFile(a, "read_file", { path: "shared.ts" });
    trackToolFile(b, "write_file", { path: "shared.ts" });
    expect(takeInbox(a)).toContain("shared.ts");
  });

  it("accepts the alternate arg names tools use", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    trackToolFile(a, "list_folder", { dir: "src" });
    trackToolFile(b, "create_folder", { path: "src" });
    expect(takeInbox(a)).not.toBe("");
  });

  it("is a no-op without a session, path, or tracked tool", () => {
    const a = joinSwarm("alpha");
    const b = joinSwarm("beta");
    noteRead(a, "x.ts");
    trackToolFile(undefined, "write_file", { path: "x.ts" });
    trackToolFile(b, "web_search", { path: "x.ts" });
    trackToolFile(b, "write_file", {});
    expect(takeInbox(a)).toBe("");
  });
});
