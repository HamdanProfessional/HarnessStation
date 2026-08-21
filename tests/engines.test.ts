import { beforeEach, describe, expect, it } from "vitest";
import {
  ENGINE_BLURB,
  ENGINE_LABEL,
  IK_BUILD_OUTPUT,
  IK_BUILD_STEPS,
  engineKindOf,
  ikDir,
  isIk,
  normalizeEngineDir,
  setIkDir,
  supportsFitOff,
  supportsMtpTuning,
  type EngineKind,
} from "../src/lib/engines";

describe("engine identification", () => {
  it("reads the lineage out of the directory name", () => {
    // installEngine writes this shape, so it is the case that matters most.
    expect(engineKindOf("engines/llama.cpp-b1234-cuda")).toBe("llama.cpp");
    expect(engineKindOf("engines/llama.cpp-b1234-cpu")).toBe("llama.cpp");
  });

  it("recognises an ik_llama build under the spellings people actually use", () => {
    for (const dir of [
      "C:/dev/ik_llama.cpp/build/bin",
      "C:/dev/ik-llama.cpp/build/bin",
      "/home/me/ikllama/build/bin",
      "engines/IK_Llama-cpu",
    ]) {
      expect(engineKindOf(dir), dir).toBe("ik_llama");
    }
  });

  it("treats anything unrecognised as upstream", () => {
    // The safe default: upstream's flags are the superset we already emit, and
    // guessing "fork" for a stock build would drop flags that do work.
    expect(engineKindOf("C:/tools/llama-server")).toBe("llama.cpp");
    expect(engineKindOf("")).toBe("llama.cpp");
  });

  it("does not mistake a plain llama.cpp path for the fork", () => {
    expect(isIk(engineKindOf("engines/llama.cpp-b9999-vulkan"))).toBe(false);
  });
});

describe("capability gating", () => {
  it("offers MTP draft tuning only upstream", () => {
    // The fork has --spec-type mtp but no --spec-draft-* flags at all, so the
    // control is hidden rather than sent and ignored.
    expect(supportsMtpTuning("llama.cpp")).toBe(true);
    expect(supportsMtpTuning("ik_llama")).toBe(false);
  });

  it("offers a disable-auto-fit control only upstream", () => {
    // Upstream defaults fit on and takes `--fit off`; the fork defaults it off
    // and takes a bare `--fit` to opt in, so there is nothing to disable.
    expect(supportsFitOff("llama.cpp")).toBe(true);
    expect(supportsFitOff("ik_llama")).toBe(false);
  });

  it("labels and describes every engine it can return", () => {
    const kinds: EngineKind[] = ["llama.cpp", "ik_llama"];
    for (const k of kinds) {
      expect(ENGINE_LABEL[k]).toBeTruthy();
      expect(ENGINE_BLURB[k]).toBeTruthy();
    }
  });
});

describe("path normalisation", () => {
  it('strips the quotes Windows "Copy as path" adds', () => {
    expect(normalizeEngineDir('"C:\\dev\\ik_llama.cpp\\build\\bin"')).toBe("C:\\dev\\ik_llama.cpp\\build\\bin");
  });

  it("strips a trailing separator of either flavour", () => {
    expect(normalizeEngineDir("C:/dev/ik/build/bin/")).toBe("C:/dev/ik/build/bin");
    expect(normalizeEngineDir("C:\\dev\\ik\\build\\bin\\")).toBe("C:\\dev\\ik\\build\\bin");
  });

  it("trims surrounding whitespace, including inside the quotes", () => {
    expect(normalizeEngineDir('  " C:/dev/ik/build/bin "  ')).toBe("C:/dev/ik/build/bin");
  });

  it("leaves an ordinary path alone", () => {
    expect(normalizeEngineDir("C:/dev/ik_llama.cpp/build/bin")).toBe("C:/dev/ik_llama.cpp/build/bin");
  });

  it("does not eat a lone separator's worth of meaning on a root path", () => {
    // "/" normalises to "" rather than staying a root we'd then treat as valid.
    expect(normalizeEngineDir("/")).toBe("");
  });
});

describe("the remembered ik_llama directory", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through storage, normalised on the way in", () => {
    setIkDir('  "C:/dev/ik_llama.cpp/build/bin/"  ');
    expect(ikDir()).toBe("C:/dev/ik_llama.cpp/build/bin");
  });

  it("is empty rather than undefined when never set", () => {
    expect(ikDir()).toBe("");
  });

  it("clears rather than storing a blank", () => {
    setIkDir("C:/dev/ik/build/bin");
    setIkDir("   ");
    expect(ikDir()).toBe("");
  });
});

describe("build guidance", () => {
  it("keeps the flag that is the whole point of the fork", () => {
    // Without -DGGML_NATIVE=ON the IQK quantized CPU kernels fall back to a
    // generic path, and ik_llama is no faster than the upstream build the user
    // could have downloaded in one click.
    expect(IK_BUILD_STEPS.join("\n")).toContain("-DGGML_NATIVE=ON");
  });

  it("clones the repository it claims to and builds Release", () => {
    const steps = IK_BUILD_STEPS.join("\n");
    expect(steps).toContain("github.com/ikawrakow/ik_llama.cpp");
    expect(steps).toContain("--config Release");
  });

  it("points at the directory the build actually writes to", () => {
    expect(IK_BUILD_OUTPUT).toBe("build/bin");
  });
});
