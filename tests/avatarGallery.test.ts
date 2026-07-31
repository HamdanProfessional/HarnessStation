import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const downloadFile = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...(a as [])) }));
vi.mock("../src/lib/local", () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...(a as [])),
  onDownloadProgress: vi.fn(),
}));

const { avatarFileName, fetchGallery, installAvatar, needsAttribution } = await import(
  "../src/lib/avatarGallery"
);

const PROJECTS = [
  { id: "100avatars-r1", name: "100 Avatars R1", license: "CC0", avatar_data_file: "avatars/100avatars-r1.json" },
  // The file name genuinely differs from the id in the real registry.
  { id: "NeonGlitch86-collection", name: "NeonGlitch86", license: "CC0", avatar_data_file: "avatars/NeonGlitch86.json" },
  { id: "vipe-heroes-genesis", name: "VIPE Heroes", license: "CC-BY", avatar_data_file: "avatars/vipe.json" },
];

const avatar = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  name: "Devil",
  project_id: "100avatars-r1",
  description: "a devil",
  model_file_url: "https://arweave.net/model",
  thumbnail_url: "https://arweave.net/thumb",
  format: "VRM",
  is_public: true,
  is_draft: false,
  ...over,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Serve projects.json plus a per-collection file, keyed by file name. */
function serve(files: Record<string, unknown[]>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/projects.json")) return ok(PROJECTS);
    const name = url.split("/").pop()!;
    if (name in files) return ok(files[name]);
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  downloadFile.mockClear();
});

describe("fetchGallery", () => {
  it("joins each avatar to its project's licence", async () => {
    // Licence lives on the project, not the avatar — getting this join wrong
    // would show CC0 on models that actually require attribution.
    serve({
      "100avatars-r1.json": [avatar()],
      "NeonGlitch86.json": [],
      "vipe.json": [avatar({ id: "v1", name: "Hero", project_id: "vipe-heroes-genesis" })],
    });

    const { avatars } = await fetchGallery();

    expect(avatars.find((a) => a.name === "Devil")!.license).toBe("CC0");
    expect(avatars.find((a) => a.name === "Hero")!.license).toBe("CC-BY");
  });

  it("reads the collection file named in avatar_data_file, not the project id", async () => {
    serve({ "100avatars-r1.json": [], "NeonGlitch86.json": [avatar({ id: "n1", name: "Neon" })], "vipe.json": [] });

    const { avatars } = await fetchGallery();

    expect(avatars.map((a) => a.name)).toContain("Neon");
    const asked = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => u.endsWith("/NeonGlitch86.json"))).toBe(true);
    expect(asked.some((u) => u.endsWith("/NeonGlitch86-collection.json"))).toBe(false);
  });

  it("skips drafts, private entries and non-VRM formats", async () => {
    serve({
      "100avatars-r1.json": [
        avatar({ id: "keep", name: "Keep" }),
        avatar({ id: "draft", name: "Draft", is_draft: true }),
        avatar({ id: "private", name: "Private", is_public: false }),
        avatar({ id: "fbx", name: "Fbx", format: "FBX" }),
        avatar({ id: "nourl", name: "NoUrl", model_file_url: undefined }),
      ],
      "NeonGlitch86.json": [],
      "vipe.json": [],
    });

    const { avatars } = await fetchGallery();

    expect(avatars.map((a) => a.name)).toEqual(["Keep"]);
  });

  it("keeps the rest of the gallery when one collection fails", async () => {
    serve({ "100avatars-r1.json": [avatar()], "vipe.json": [] }); // NeonGlitch86.json 404s

    const { avatars } = await fetchGallery();

    expect(avatars).toHaveLength(1);
  });

  it("caches, and refetches when forced", async () => {
    serve({ "100avatars-r1.json": [avatar()], "NeonGlitch86.json": [], "vipe.json": [] });

    await fetchGallery();
    const first = fetchMock.mock.calls.length;
    await fetchGallery();
    expect(fetchMock.mock.calls.length).toBe(first); // served from cache

    await fetchGallery(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first);
  });

  it("throws when the registry itself is unreachable", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchGallery()).rejects.toThrow(/HTTP 500/);
  });
});

describe("avatarFileName", () => {
  const named = (name: string) =>
    avatarFileName({ name } as unknown as Parameters<typeof avatarFileName>[0]);

  it("makes a readable, path-safe .vrm name", () => {
    expect(named("Devil Girl")).toBe("devil-girl.vrm");
    expect(named("Robo/../Bot")).toBe("robo-bot.vrm");
  });

  it("falls back when the name has nothing usable", () => {
    expect(named("###")).toBe("avatar.vrm");
  });

  it("caps the length", () => {
    expect(named("x".repeat(120)).length).toBeLessThanOrEqual(52);
  });
});

describe("installAvatar", () => {
  it("streams the model into the avatars folder", async () => {
    const a = {
      id: "a1",
      name: "Devil",
      modelUrl: "https://arweave.net/model",
    } as unknown as Parameters<typeof installAvatar>[0];

    expect(await installAvatar(a)).toBe("devil.vrm");
    expect(downloadFile).toHaveBeenCalledWith(
      "https://arweave.net/model",
      "avatars/devil.vrm",
      "avatar-a1",
    );
  });
});

describe("needsAttribution", () => {
  it("flags CC-BY but not CC0", () => {
    expect(needsAttribution("CC-BY")).toBe(true);
    expect(needsAttribution("CC-BY-SA")).toBe(true);
    expect(needsAttribution("CC0")).toBe(false);
    expect(needsAttribution("unknown")).toBe(false);
  });
});
