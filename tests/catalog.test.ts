import { describe, expect, it } from "vitest";
import { CATALOG, CLOUD_PROVIDERS, fitCaveat, fitFor, isBlackwellGpu, isFp4, parseHfUrl, resolveCatalog } from "../src/lib/catalog";
import { dataUrlToAttachment } from "../src/lib/media";
import { extractArtifact, extractHtml } from "../src/lib/attach";

describe("fitFor", () => {
  const GB = 1024;

  it("prefers full GPU offload when VRAM has room", () => {
    expect(fitFor(4 * GB, 32 * GB, 12 * GB)).toBe("gpu");
  });

  it("falls back to RAM when VRAM is too small", () => {
    expect(fitFor(8 * GB, 32 * GB, 6 * GB)).toBe("cpu");
  });

  it("flags a tight fit between the comfortable and hard limits", () => {
    expect(fitFor(20 * GB, 32 * GB, null)).toBe("tight");
  });

  it("refuses a model larger than the machine", () => {
    expect(fitFor(64 * GB, 32 * GB, 8 * GB)).toBe("no");
  });

  it("treats missing VRAM as CPU-only rather than crashing", () => {
    expect(fitFor(4 * GB, 32 * GB, null)).toBe("cpu");
    expect(fitFor(4 * GB, 32 * GB, 0)).toBe("cpu");
  });
});

describe("parseHfUrl", () => {
  it("parses a resolve URL", () => {
    const out = parseHfUrl("https://huggingface.co/TheBloke/Mistral-7B/resolve/main/mistral.Q4_K_M.gguf");
    expect(out).toMatchObject({ publisher: "TheBloke", model: "Mistral-7B", file: "mistral.Q4_K_M.gguf" });
  });

  it("rewrites a blob URL to a downloadable resolve URL", () => {
    const out = parseHfUrl("https://huggingface.co/org/repo/blob/main/sub/dir/model.gguf");
    expect(out!.url).toContain("/resolve/");
    expect(out!.file).toBe("model.gguf"); // nested path collapses to the file name
  });

  it("rejects non-HF hosts, non-gguf files and junk", () => {
    expect(parseHfUrl("https://example.com/a/b/resolve/main/x.gguf")).toBeNull();
    expect(parseHfUrl("https://huggingface.co/org/repo/resolve/main/model.safetensors")).toBeNull();
    expect(parseHfUrl("not a url")).toBeNull();
    expect(parseHfUrl("")).toBeNull();
  });
});

describe("resolveCatalog", () => {
  it("resolves every catalog entry's default quant to a downloadable file", () => {
    for (const e of CATALOG) {
      const m = resolveCatalog(e, Object.keys(e.quants)[0]);
      expect(m.url, e.model).toMatch(/^https:\/\//);
      expect(m.file, e.model).toMatch(/\.gguf$/i);
      expect(m.sizeMB, e.model).toBeGreaterThan(0);
    }
  });
});

describe("CLOUD_PROVIDERS", () => {
  it("has unique ids and an https base URL each", () => {
    expect(new Set(CLOUD_PROVIDERS.map((p) => p.id)).size).toBe(CLOUD_PROVIDERS.length);
    for (const p of CLOUD_PROVIDERS) {
      expect(p.baseUrl, p.id).toMatch(/^https:\/\//);
      expect(p.models.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("dataUrlToAttachment", () => {
  it("classifies image, audio and video data URLs", () => {
    expect(dataUrlToAttachment("data:image/png;base64,AAAA", "generate_image")).toMatchObject({
      kind: "image",
      name: "generate_image.png",
      mime: "image/png",
    });
    expect(dataUrlToAttachment("data:audio/mpeg;base64,AA", "tts")!.kind).toBe("audio");
    expect(dataUrlToAttachment("data:video/mp4;base64,AA", "vid")!.kind).toBe("video");
  });

  it("strips a +suffix from the extension", () => {
    expect(dataUrlToAttachment("data:image/svg+xml;base64,AA", "t")!.name).toBe("t.svg");
  });

  it("lets plain tool text and text data URLs pass through as null", () => {
    expect(dataUrlToAttachment("Just some tool output", "t")).toBeNull();
    expect(dataUrlToAttachment("data:text/plain;base64,AA", "t")).toBeNull();
  });
});

describe("extractHtml", () => {
  it("pulls a full document out of an ```html fence", () => {
    const md = "Here you go:\n\n```html\n<!doctype html><html><body>hi</body></html>\n```\nEnjoy.";
    expect(extractHtml(md)).toBe("<!doctype html><html><body>hi</body></html>");
  });

  it("detects a bare document with no fence", () => {
    expect(extractHtml("<html><body>x</body></html>")).toContain("<body>");
  });

  it("accepts a fenced body fragment", () => {
    expect(extractHtml("```html\n<div>fragment</div>\n```")).toBe("<div>fragment</div>");
  });

  it("returns null for plain prose and for non-html fences", () => {
    expect(extractHtml("Here is how canvases work in this app.")).toBeNull();
    expect(extractHtml("```js\nconst x = 1;\n```")).toBeNull();
    expect(extractHtml("```html\nnot really markup\n```")).toBeNull();
  });

  it("is deliberately loose: prose that mentions <html> is still treated as a document", () => {
    // Known trade-off — the canvas heuristic favours catching unfenced output.
    expect(extractHtml("Every page starts with an <html> element.")).not.toBeNull();
  });
});
describe("extractArtifact", () => {
  const fence = (lang: string, body: string) => ["```" + lang, body, "```"].join("\n");
  const CIRCLE = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

  it("recognises a fenced svg block", () => {
    expect(extractArtifact("Here:\n\n" + fence("svg", CIRCLE))).toEqual({ kind: "svg", code: CIRCLE });
  });

  it("recognises a bare svg document, including an xml prolog", () => {
    expect(extractArtifact('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')?.kind).toBe("svg");
    expect(extractArtifact('<?xml version="1.0"?>\n<svg><rect/></svg>')?.kind).toBe("svg");
  });

  it("does not treat prose about svg, or a truncated one, as an artifact", () => {
    expect(extractArtifact("You can use an <svg> element for this.")).toBeNull();
    expect(extractArtifact("<svg><rect/>")).toBeNull();
  });

  it("prefers svg over the html fragment rule", () => {
    // An <svg> document also matches the loose HTML fragment test; svg must win
    // so it renders centred and script-free rather than as a bare body.
    expect(extractArtifact(fence("svg", "<svg><rect/></svg>"))?.kind).toBe("svg");
  });

  it("still returns html documents and fragments", () => {
    const doc = "<!doctype html><html><body>hi</body></html>";
    expect(extractArtifact(fence("html", doc))).toEqual({ kind: "html", code: doc });
    expect(extractArtifact(fence("html", "<div>frag</div>"))?.kind).toBe("html");
  });

  it("returns null when there is nothing to render", () => {
    expect(extractArtifact("Just a plain answer.")).toBeNull();
    expect(extractArtifact(fence("js", "const x = 1;"))).toBeNull();
  });
});

describe("FP4 fit caveat", () => {
  it("recognises NVFP4 and MXFP4 in a real third-party filename", () => {
    expect(isFp4("Qwen3.8-27B-NVFP4-MTP-GGUF")).toBe(true);
    expect(isFp4("model-MXFP4.gguf")).toBe(true);
    expect(isFp4("nvfp4")).toBe(true);
  });

  it("does not mistake ordinary quants for FP4", () => {
    // Q4_K_M and IQ4_XS are 4-bit but not the FP4 tensor-core formats; treating
    // them as such would put a hardware warning on almost every model we ship.
    expect(isFp4("Qwen3.8-27B-UD-Q4_K_M.gguf")).toBe(false);
    expect(isFp4("Qwen3.6-27B-IQ4_XS.gguf")).toBe(false);
    expect(isFp4("Q4_0")).toBe(false);
  });

  it("identifies Blackwell cards by series and by name", () => {
    expect(isBlackwellGpu("NVIDIA GeForce RTX 5090")).toBe(true);
    expect(isBlackwellGpu("NVIDIA RTX PRO 6000 Blackwell")).toBe(true);
    expect(isBlackwellGpu("NVIDIA B200")).toBe(true);
    expect(isBlackwellGpu("NVIDIA GeForce RTX 4090")).toBe(false);
    expect(isBlackwellGpu("AMD Radeon RX 7900 XTX")).toBe(false);
  });

  it("treats an unknown GPU as non-Blackwell so the caveat is shown, not withheld", () => {
    expect(isBlackwellGpu(null)).toBe(false);
    expect(isBlackwellGpu("Some Future Accelerator")).toBe(false);
  });

  it("warns only when an FP4 file meets a non-Blackwell card", () => {
    expect(fitCaveat("Qwen3.8-27B-NVFP4.gguf", "NVIDIA GeForce RTX 4090")).toContain("Blackwell");
    // Right hardware: nothing to say.
    expect(fitCaveat("Qwen3.8-27B-NVFP4.gguf", "NVIDIA GeForce RTX 5090")).toBeNull();
    // Ordinary quant: nothing to say, whatever the card.
    expect(fitCaveat("Qwen3.8-27B-UD-Q4_K_M.gguf", "NVIDIA GeForce RTX 4090")).toBeNull();
  });
});
