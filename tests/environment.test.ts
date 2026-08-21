import { describe, expect, it } from "vitest";
import { environmentNote, type EnvironmentFacts } from "../src/lib/environment";

const AT = new Date("2026-08-21T20:15:00Z"); // a Friday

const facts = (over: Partial<EnvironmentFacts> = {}): EnvironmentFacts => ({
  os: "windows",
  workingDir: "C:\\Users\\me\\project",
  model: "claude-sonnet-5",
  providerName: "Anthropic",
  now: AT,
  ...over,
});

describe("the environment block", () => {
  it("states the date, which is the fact a model most reliably gets wrong", () => {
    // Left out, a model answers from its training cutoff with total confidence.
    expect(environmentNote(facts())).toContain("Today's date: 2026-08-21 (Friday, UTC)");
  });

  it("names the shell run_terminal will actually use", () => {
    // The tool runs PowerShell on Windows. A model that assumes bash writes
    // `ls -la` and gets an error it cannot diagnose from the failure alone.
    expect(environmentNote(facts({ os: "windows" }))).toContain("Platform: Windows (run_terminal uses PowerShell)");
    expect(environmentNote(facts({ os: "linux" }))).toContain("Platform: Linux (run_terminal uses bash)");
    expect(environmentNote(facts({ os: "macos" }))).toContain("Platform: macOS (run_terminal uses bash)");
  });

  it("says which model is answering", () => {
    expect(environmentNote(facts())).toContain("You are powered by the model claude-sonnet-5 via Anthropic");
  });

  it("names the working directory when there is one", () => {
    expect(environmentNote(facts())).toContain("Working directory: C:\\Users\\me\\project");
  });

  it("wraps the facts in a tag the model can recognise as context", () => {
    const out = environmentNote(facts());
    expect(out).toMatch(/^Here is some useful information/);
    expect(out).toContain("<env>");
    expect(out).toContain("</env>");
  });
});

describe("what it refuses to say", () => {
  it("omits an unknown platform rather than writing 'unknown'", () => {
    // A stated fact gets used; an absent one gets asked about. "Platform:
    // unknown" is worse than no line at all.
    const out = environmentNote(facts({ os: "unknown" }));
    expect(out).not.toContain("Platform:");
    expect(out).not.toContain("unknown");
  });

  it("omits the working directory when the chat has none", () => {
    expect(environmentNote(facts({ workingDir: undefined }))).not.toContain("Working directory");
  });

  it("omits the model line when the model is not known yet", () => {
    expect(environmentNote(facts({ model: undefined }))).not.toContain("powered by");
  });

  it("drops the provider but keeps the model when only one is known", () => {
    const out = environmentNote(facts({ providerName: undefined }));
    expect(out).toContain("powered by the model claude-sonnet-5");
    expect(out).not.toContain(" via ");
  });
});

describe("the browser build", () => {
  it("says there is no shell or filesystem instead of naming a directory", () => {
    // Otherwise the model offers to read files in a build that cannot.
    const out = environmentNote(facts({ web: true, os: "unknown" }));
    expect(out).toContain("browser — no shell and no local filesystem");
    expect(out).not.toContain("Working directory");
  });

  it("prefers the browser line over a stale working directory", () => {
    const out = environmentNote(facts({ web: true, workingDir: "/home/me" }));
    expect(out).not.toContain("/home/me");
  });
});

describe("date handling", () => {
  it("uses UTC consistently, so the date and weekday cannot disagree", () => {
    // Late-evening UTC is already tomorrow in some zones; mixing a local date
    // with a UTC weekday would produce a block that contradicts itself.
    const out = environmentNote(facts({ now: new Date("2026-01-01T23:59:00Z") }));
    expect(out).toContain("2026-01-01 (Thursday, UTC)");
  });
});
