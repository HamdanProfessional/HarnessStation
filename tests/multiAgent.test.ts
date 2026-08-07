import { describe, expect, it } from "vitest";
import { buildParticipantContext } from "../src/lib/multiAgent";
import type { Message, Participant } from "../src/lib/types";

const A: Participant = { id: "a", label: "Frontend", providerId: "p", model: "m", instructions: "Build the UI" };
const B: Participant = { id: "b", label: "Backend", providerId: "p", model: "m", instructions: "Build the API" };

const convo: Message[] = [
  { role: "user", content: "Build a todo app" },
  { role: "assistant", content: "FE done", reasoning: "FE private thoughts", author: "Frontend" },
  { role: "assistant", content: "API done", reasoning: "BE private thoughts", author: "Backend" },
  { role: "user", content: "add auth" },
];

describe("buildParticipantContext — battle", () => {
  it("a participant sees only the user turns and its own answers, not a rival's", () => {
    const contents = buildParticipantContext(convo, A, "battle", [B]).messages.map((m) => m.content);
    expect(contents).toContain("Build a todo app");
    expect(contents).toContain("FE done");
    expect(contents).not.toContain("API done"); // rival's answer excluded
    expect(contents).toContain("add auth");
  });
  it("uses the participant's own role as the system addition", () => {
    expect(buildParticipantContext(convo, A, "battle", [B]).systemAddition).toBe("Build the UI");
  });
});

describe("buildParticipantContext — collab", () => {
  it("sees peers' written output (tagged) and its own (untagged), but never anyone's reasoning", () => {
    const { messages } = buildParticipantContext(convo, B, "collab", [A]);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("[Frontend] FE done"); // peer output, tagged
    expect(joined).toContain("API done"); // own output present
    expect(joined).not.toContain("[Backend] API done"); // own output not tagged
    expect(joined).not.toContain("private thoughts"); // reasoning never shared
    expect(messages.every((m) => m.reasoning == null)).toBe(true);
  });
  it("system addition names the peers and this participant's role", () => {
    const s = buildParticipantContext(convo, B, "collab", [A]).systemAddition;
    expect(s).toContain("Backend");
    expect(s).toContain("Frontend");
    expect(s).toContain("Build the API");
  });
});
