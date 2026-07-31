import { describe, expect, it } from "vitest";
import { humanSsml, pickFiller, spokenForm } from "../src/lib/humanize";

describe("spokenForm", () => {
  it("expands abbreviations nobody says out loud", () => {
    expect(spokenForm("Use it, e.g. here")).toBe("Use it, for example, here");
    // "i.e." expands to "that is," and the contraction pass then shortens it.
    expect(spokenForm("i.e. this")).toBe("that's, this");
    expect(spokenForm("i.e. this", false)).toBe("that is, this");
    expect(spokenForm("cats, dogs, etc.")).toBe("cats, dogs, and so on");
    expect(spokenForm("A vs. B")).toBe("A versus B");
    expect(spokenForm("approx. 5 items")).toBe("roughly 5 items");
    // no spurious sentence break left behind
    expect(spokenForm("A vs. B")).not.toContain(".");
  });

  it("speaks symbols and numbers", () => {
    expect(spokenForm("50%")).toBe("50 percent");
    expect(spokenForm("$20")).toBe("20 dollars");
    expect(spokenForm("A & B")).toBe("A and B");
    expect(spokenForm("2 + 2")).toBe("2 plus 2");
  });

  it("replaces things that would be read out character by character", () => {
    expect(spokenForm("see https://example.com/x for more")).toBe("see the link for more");
    expect(spokenForm("open C:\\Users\\me\\notes.txt now")).toBe("open that folder now");
    expect(spokenForm("open ~/docs/notes.md now")).toBe("open that path now");
  });

  it("applies contractions, and skips them when asked", () => {
    expect(spokenForm("It is done and I will check")).toBe("it's done and I'll check");
    expect(spokenForm("It is done", false)).toBe("It is done");
  });

  it("normalises ellipses and whitespace", () => {
    expect(spokenForm("  wait....   then  go  ")).toBe("wait… then go");
  });
});

describe("humanSsml", () => {
  it("returns an empty string for empty input", () => {
    expect(humanSsml("   ")).toBe("");
  });

  it("wraps sentences in prosody inside a speak root", () => {
    const out = humanSsml("Hello there. How are you?");
    expect(out.startsWith('<speak version="1.0"')).toBe(true);
    expect(out.endsWith("</speak>")).toBe(true);
    expect(out.match(/<prosody /g)).toHaveLength(2);
  });

  it("is deterministic — the same text always sounds the same", () => {
    expect(humanSsml("A stable sentence here.")).toBe(humanSsml("A stable sentence here."));
  });

  it("escapes XML so markup in the text cannot break the document", () => {
    const out = humanSsml('Use <b> & "quotes" now.');
    expect(out).toContain("&lt;b&gt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;");
    expect(out).not.toMatch(/<b>/);
  });

  it("inserts breath pauses at commas and clause breaks", () => {
    const out = humanSsml("First, second; third: fourth.");
    expect(out.match(/<break time="\d+ms"\/>/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("scales pauses with pace and flattens prosody at expressiveness 0", () => {
    const slow = humanSsml("One, two.", { pace: 2 });
    expect(slow).toContain('<break time="320ms"/>');
    const flat = humanSsml("Anything at all here?", { expressiveness: 0 });
    expect(flat).toContain('rate="+0%"');
    expect(flat).toContain('pitch="+0%"');
  });

  it("uses the requested language tag, defaulting to en-US", () => {
    expect(humanSsml("Hola.")).toContain('xml:lang="en-US"');
    expect(humanSsml("Hola.", { lang: " es-ES " })).toContain('xml:lang="es-ES"');
  });
});

describe("pickFiller", () => {
  it("never repeats the previous filler", () => {
    let last = "";
    for (let i = 0; i < 50; i++) {
      const next = pickFiller();
      expect(next).not.toBe(last);
      expect(next.length).toBeGreaterThan(0);
      last = next;
    }
  });
});
