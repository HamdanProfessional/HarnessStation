import { describe, expect, it } from "vitest";
import { readDeepLink } from "../src/lib/deeplink";

/**
 * readDeepLink turns a query string into a config a boot can apply. It should
 * accept the short aliases, ignore unknown styles/modes, and return null when
 * there's nothing to do so boot can skip the whole path.
 */
describe("readDeepLink", () => {
  it("returns null for an empty or irrelevant query", () => {
    expect(readDeepLink("")).toBeNull();
    expect(readDeepLink("?foo=bar")).toBeNull();
  });

  it("reads the full set of params", () => {
    const cfg = readDeepLink("?provider=openai&model=gpt-4o&style=concise&mode=voice&system=hi&key=sk-1");
    expect(cfg).toEqual({
      provider: "openai",
      model: "gpt-4o",
      style: "concise",
      mode: "voice",
      system: "hi",
      key: "sk-1",
    });
  });

  it("accepts short aliases (p/m/s, apikey, code)", () => {
    const cfg = readDeepLink("?p=groq&m=llama3&s=formal&apikey=abc&code=demo");
    expect(cfg).toMatchObject({ provider: "groq", model: "llama3", style: "formal", key: "abc", trial: "demo" });
  });

  it("drops an unknown style and an unknown mode", () => {
    const cfg = readDeepLink("?provider=x&style=chaotic&mode=telepathy");
    expect(cfg).toEqual({ provider: "x" });
  });

  it("keeps a valid trial code on its own", () => {
    expect(readDeepLink("?trial=demo")).toEqual({ trial: "demo" });
  });
});
