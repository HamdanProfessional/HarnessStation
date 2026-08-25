import { describe, expect, it } from "vitest";
import { mergeEdits } from "../src/lib/settingsMerge";
import type { Settings } from "../src/lib/types";

/**
 * WP2 of the ACP plan (docs/research/acp-b-plan.md): the settings surface for
 * configured ACP agents. The merge machinery is key-generic, so what is under
 * test is that the new key rides it — added when edited, untouched when not.
 */

const agent = { id: "a1", name: "Claude Code (ACP)", command: "node", args: ["acp.mjs"] };

const base = (): Settings =>
  ({ providers: [], globalInstructions: "", theme: "dark", acpAgents: [agent] }) as Settings;

describe("acpAgents in settings", () => {
  it("survives a JSON round-trip intact", () => {
    const s = base();
    const back = JSON.parse(JSON.stringify(s)) as Settings;
    expect(back.acpAgents).toEqual([agent]);
  });

  it("an edited list is carried into the merged settings", () => {
    const baseline = base();
    const draft = { ...baseline, acpAgents: [agent, { id: "a2", name: "Gemini", command: "npx" }] };
    const out = mergeEdits(baseline, draft, structuredClone(baseline));
    expect(out.acpAgents).toHaveLength(2);
    expect(out.acpAgents![1].name).toBe("Gemini");
  });

  it("an untouched list keeps the live value, even if a sibling panel changed it", () => {
    const baseline = base();
    const draft = { ...baseline, globalInstructions: "new instructions" };
    const live = {
      ...base(),
      acpAgents: [{ id: "live", name: "Added elsewhere", command: "x" }],
    } as Settings;
    const out = mergeEdits(baseline, draft, live);
    expect(out.globalInstructions).toBe("new instructions");
    expect(out.acpAgents![0].id).toBe("live");
  });

  it("a removed list is removed, not resurrected", () => {
    const baseline = base();
    const draft = { ...baseline };
    delete (draft as Record<string, unknown>).acpAgents;
    const out = mergeEdits(baseline, draft, structuredClone(baseline));
    expect(out.acpAgents).toBeUndefined();
  });
});
