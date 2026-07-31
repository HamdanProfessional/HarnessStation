import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const fetchMock = vi.fn();
const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...(a as [])) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ size: 999_999_999 })),
  writeFile: vi.fn(async () => {}),
  readFile: (...a: unknown[]) => readFile(...(a as [])),
}));
vi.mock("../src/lib/local", () => ({ downloadFile: vi.fn(), extractZip: vi.fn() }));
vi.mock("../src/lib/platform", () => ({ isLinux: () => false }));

const { startSttServer, stopSttServer, sttLanguageName, transcribeFast, transcribeViaServer } =
  await import("../src/lib/whisper");

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(async () => {
  invoke.mockReset();
  fetchMock.mockReset();
  readFile.mockClear();
  invoke.mockResolvedValue(8178);
  await stopSttServer();
  invoke.mockReset();
  invoke.mockResolvedValue(8178);
});

/** Bring the in-module server state up so transcribeViaServer will use it. */
async function serverUp() {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
  expect(await startSttServer("base")).toBe(true);
  fetchMock.mockReset();
}

describe("transcribeViaServer", () => {
  it("posts the wav and returns the transcript", async () => {
    await serverUp();
    fetchMock.mockResolvedValueOnce(ok({ text: "  hello there  " }));

    expect(await transcribeViaServer("tmp/a.wav", "base")).toBe("hello there");

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain("/inference");
    expect(init.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("forgets a server that stops answering, so the next call restarts it", async () => {
    // Regression: serverModel stayed set after a failure, so one crash pinned the
    // whole session to the much slower one-shot CLI.
    await serverUp();
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    expect(await transcribeViaServer("tmp/a.wav", "base")).toBeNull();

    // Next attempt must try to bring the server back up rather than assume it's live.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 }); // health poll
    fetchMock.mockResolvedValueOnce(ok({ text: "recovered" }));
    expect(await transcribeViaServer("tmp/a.wav", "base")).toBe("recovered");
  });

  it("treats a non-ok response as a dead server too", async () => {
    await serverUp();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    expect(await transcribeViaServer("tmp/a.wav", "base")).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    fetchMock.mockResolvedValueOnce(ok({ text: "back" }));
    expect(await transcribeViaServer("tmp/a.wav", "base")).toBe("back");
  });

  it("returns null when the server cannot be started at all", async () => {
    invoke.mockRejectedValue(new Error("no binary"));
    expect(await transcribeViaServer("tmp/a.wav", "base")).toBeNull();
  });
});

describe("transcribeFast", () => {
  it("falls back to the one-shot CLI when the server is unusable", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stt_serve") throw new Error("unavailable");
      if (cmd === "transcribe") return "cli transcript";
      return undefined;
    });

    expect(await transcribeFast("tmp/a.wav", "base")).toBe("cli transcript");
    expect(invoke.mock.calls.some((c) => c[0] === "transcribe")).toBe(true);
  });

  it("passes the language and translate options through to the CLI", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stt_serve") throw new Error("unavailable");
      return "x";
    });

    await transcribeFast("tmp/a.wav", "small", { language: "fr", translate: true });

    const call = invoke.mock.calls.find((c) => c[0] === "transcribe")!;
    expect(call[1]).toMatchObject({
      language: "fr",
      translate: true,
      model: "whisper/ggml-small.bin",
    });
  });
});

describe("sttLanguageName", () => {
  it("gives the plain English name", () => {
    expect(sttLanguageName("fr")).toBe("French");
    expect(sttLanguageName("zh")).toBe("Chinese");
  });

  it("is empty for auto-detect and unknown codes", () => {
    expect(sttLanguageName("auto")).toBe("");
    expect(sttLanguageName("xx")).toBe("");
    expect(sttLanguageName("")).toBe("");
  });
});
