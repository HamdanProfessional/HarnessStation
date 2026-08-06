import { describe, expect, it } from "vitest";
import { deriveKeys, encrypt, decrypt } from "../src/lib/cloud";
import { stripSettingsForSync, mergeDeviceKeys } from "../src/lib/storage";
import type { Settings } from "../src/lib/types";

const baseSettings = (): Settings =>
  ({
    providers: [
      { id: "openai", name: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKey: "sk-secret-1", models: ["gpt-4o"] },
      { id: "groq", name: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk-secret-2", models: ["llama"] },
    ],
    globalInstructions: "",
    theme: "dark",
    aaApiKey: "aa-secret",
    cloud: { enabled: true, email: "me@x.com", token: "tok" },
  }) as Settings;

describe("cloud crypto", () => {
  it("derives a stable auth verifier for the same email+password", async () => {
    const a = await deriveKeys("Me@X.com", "hunter2hunter2");
    const b = await deriveKeys("me@x.com", "hunter2hunter2"); // email normalised
    expect(a.authVerifier).toBe(b.authVerifier);
    expect(a.authVerifier).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives a different verifier for a different password", async () => {
    const a = await deriveKeys("me@x.com", "password-one");
    const b = await deriveKeys("me@x.com", "password-two");
    expect(a.authVerifier).not.toBe(b.authVerifier);
  });

  it("round-trips a payload through encrypt/decrypt", async () => {
    const { encKey } = await deriveKeys("me@x.com", "hunter2hunter2");
    const payload = JSON.stringify({ chats: ["hello", "world"], n: 42, unicode: "café ☕" });
    const blob = await encrypt(encKey, payload);
    expect(blob).toContain(":");
    expect(blob).not.toContain("hello"); // ciphertext, not plaintext
    expect(await decrypt(encKey, blob)).toBe(payload);
  });

  it("a wrong key cannot decrypt", async () => {
    const a = await deriveKeys("me@x.com", "right-password");
    const b = await deriveKeys("me@x.com", "wrong-password");
    const blob = await encrypt(a.encKey, "secret data");
    await expect(decrypt(b.encKey, blob)).rejects.toBeDefined();
  });
});

describe("key stripping / preservation", () => {
  it("stripSettingsForSync blanks all keys and drops the cloud block", () => {
    const out = stripSettingsForSync(baseSettings());
    expect(out.providers.map((p) => p.apiKey)).toEqual(["", ""]);
    expect(out.aaApiKey).toBe("");
    expect(out.cloud).toBeUndefined();
    // non-key fields survive
    expect(out.providers[0].baseUrl).toBe("https://api.openai.com/v1");
  });

  it("mergeDeviceKeys re-injects this device's keys onto an incoming snapshot", () => {
    const incoming = stripSettingsForSync(baseSettings()); // keys blank
    incoming.theme = "light"; // a synced preference change
    const device = baseSettings(); // this machine still has its keys
    const merged = mergeDeviceKeys(incoming, device);
    expect(merged.theme).toBe("light"); // adopted from the snapshot
    expect(merged.providers.find((p) => p.id === "openai")!.apiKey).toBe("sk-secret-1"); // device key kept
    expect(merged.providers.find((p) => p.id === "groq")!.apiKey).toBe("gsk-secret-2");
    expect(merged.aaApiKey).toBe("aa-secret");
    expect(merged.cloud).toEqual(device.cloud); // device session kept
  });

  it("a provider only in the snapshot gets a blank key (re-enter on this device)", () => {
    const incoming = stripSettingsForSync(baseSettings());
    incoming.providers.push({ id: "new", name: "New", kind: "openai-compatible", baseUrl: "x", apiKey: "", models: [] });
    const merged = mergeDeviceKeys(incoming, baseSettings());
    expect(merged.providers.find((p) => p.id === "new")!.apiKey).toBe("");
  });
});
