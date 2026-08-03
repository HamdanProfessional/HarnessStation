import { beforeEach, describe, expect, it, vi } from "vitest";

// The value store is the OS keychain in the app; here we stand it in with a map
// so we can exercise substitution/redaction without a real backend.
const vault = new Map<string, string>();
vi.mock("../src/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/storage")>();
  return {
    ...actual,
    vaultGet: (ref: string) => Promise.resolve(vault.get(ref) ?? null),
    vaultSet: (ref: string, v: string) => {
      vault.set(ref, v);
      return Promise.resolve();
    },
    vaultDelete: (ref: string) => {
      vault.delete(ref);
      return Promise.resolve();
    },
  };
});

import { useStore } from "../src/lib/store";
import {
  normalizeRef,
  resolveSecretsInArgs,
  redactSecrets,
  listSecretsForModel,
  invalidateSecretCache,
} from "../src/lib/secrets";
import type { VaultSecret } from "../src/lib/types";

const meta = (ref: string, name = ref, description = ""): VaultSecret => ({
  ref,
  name,
  description,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

function setSecrets(entries: { ref: string; value: string; description?: string }[]) {
  vault.clear();
  for (const e of entries) vault.set(e.ref, e.value);
  useStore.setState({
    settings: { ...useStore.getState().settings, secrets: entries.map((e) => meta(e.ref, e.ref, e.description)) },
  });
  invalidateSecretCache();
}

describe("normalizeRef", () => {
  it("upshouts to a shell-style env name", () => {
    expect(normalizeRef("Cloudflare API token")).toBe("CLOUDFLARE_API_TOKEN");
    expect(normalizeRef("  my-key.v2  ")).toBe("MY_KEY_V2");
    expect(normalizeRef("__stripe__")).toBe("STRIPE");
  });
});

describe("resolveSecretsInArgs", () => {
  beforeEach(() => setSecrets([{ ref: "CF_TOKEN", value: "sk-secret-123" }]));

  it("substitutes {{REF}} and ${REF} anywhere in the args, at any depth", async () => {
    const out = await resolveSecretsInArgs({
      path: ".env",
      content: "TOKEN={{CF_TOKEN}}",
      nested: { cmd: "curl -H 'Authorization: Bearer ${CF_TOKEN}'" },
      list: ["{{CF_TOKEN}}"],
    });
    expect(out).toEqual({
      path: ".env",
      content: "TOKEN=sk-secret-123",
      nested: { cmd: "curl -H 'Authorization: Bearer sk-secret-123'" },
      list: ["sk-secret-123"],
    });
  });

  it("leaves unknown placeholders alone", async () => {
    const out = await resolveSecretsInArgs({ content: "${HOME}/x {{NOT_A_SECRET}}" });
    expect(out).toEqual({ content: "${HOME}/x {{NOT_A_SECRET}}" });
  });

  it("is a no-op with no secrets configured", async () => {
    setSecrets([]);
    const args = { content: "{{CF_TOKEN}}" };
    expect(await resolveSecretsInArgs(args)).toEqual(args);
  });
});

describe("redactSecrets", () => {
  beforeEach(() => setSecrets([{ ref: "CF_TOKEN", value: "sk-secret-123" }]));

  it("replaces a leaked value with its placeholder before the model sees it", async () => {
    const echoed = "your key is sk-secret-123 (from .env)";
    expect(await redactSecrets(echoed)).toBe("your key is {{CF_TOKEN}} (from .env)");
  });

  it("leaves clean output untouched", async () => {
    expect(await redactSecrets("all good")).toBe("all good");
  });
});

describe("listSecretsForModel", () => {
  it("shows refs and descriptions but never values", async () => {
    setSecrets([{ ref: "CF_TOKEN", value: "sk-secret-123", description: "edits DNS" }]);
    const out = listSecretsForModel();
    expect(out).toContain("{{CF_TOKEN}}");
    expect(out).toContain("edits DNS");
    expect(out).not.toContain("sk-secret-123");
  });

  it("explains how to add one when the vault is empty", () => {
    setSecrets([]);
    expect(listSecretsForModel()).toMatch(/Settings → Secrets/);
  });
});
