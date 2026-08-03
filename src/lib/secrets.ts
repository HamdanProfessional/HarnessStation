/**
 * The secrets vault: credentials the model can *use* but never *see*.
 *
 * The problem this solves: paste an API key into a chat and it lives in the
 * transcript forever — providers now scan for that and auto-revoke ("this key
 * was leaked, rotate it"), which stops you mid-build. So we never let the value
 * into the conversation at all.
 *
 * How it works:
 *   1. You save a secret in Settings → Secrets: a ref (CLOUDFLARE_API_TOKEN), a
 *      description, and the value. The value goes straight to the OS keychain.
 *   2. The model sees only the ref + description via the list_secrets tool.
 *   3. When the model puts `{{CLOUDFLARE_API_TOKEN}}` in a file it writes, a
 *      command it runs, or a request it makes, the app swaps in the real value
 *      at execution time — after the model has spoken, so the value is never in
 *      what the model typed.
 *   4. Anything a tool hands back to the model is scrubbed of every known secret
 *      value first, so a stray `cat .env` or an echoed header can't leak one.
 *
 * Net effect: the key reaches the file/command/API it's meant for, and nothing
 * else. The user can't read it back either — by design, it's the model's to use.
 */
import { useStore } from "./store";
import { vaultGet } from "./storage";

/** Placeholder forms accepted for a ref REF: `{{REF}}` and `${REF}`. */
function placeholderRegex(ref: string): RegExp {
  const r = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{\\{\\s*${r}\\s*\\}\\}|\\$\\{\\s*${r}\\s*\\}`, "g");
}

/** A ref is a shell-style env name; keeps placeholders unambiguous. */
export function normalizeRef(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The refs the user has configured (metadata only — no values). */
function configuredRefs(): string[] {
  return (useStore.getState().settings.secrets ?? []).map((s) => s.ref);
}

/**
 * In-memory cache of ref -> value. Populated from the keychain on demand and
 * invalidated whenever a secret is added, changed or removed. Holding plaintext
 * here is the same trust level as the provider keys already in memory.
 */
let valueCache: Map<string, string> | null = null;

export function invalidateSecretCache(): void {
  valueCache = null;
}

async function loadValues(): Promise<Map<string, string>> {
  if (valueCache) return valueCache;
  const map = new Map<string, string>();
  await Promise.all(
    configuredRefs().map(async (ref) => {
      const v = await vaultGet(ref);
      if (v) map.set(ref, v);
    }),
  );
  valueCache = map;
  return map;
}

/**
 * Replace `{{REF}}`/`${REF}` for known secrets with their real values, walking
 * every string in the tool arguments. Returns the args untouched when there are
 * no secrets or no placeholders, so the common path costs nothing.
 */
export async function resolveSecretsInArgs<T>(args: T): Promise<T> {
  const refs = configuredRefs();
  if (!refs.length) return args;
  const serialized = JSON.stringify(args);
  const referenced = refs.filter((ref) => placeholderRegex(ref).test(serialized));
  if (!referenced.length) return args;

  const values = await loadValues();
  const subs = referenced
    .map((ref) => ({ ref, value: values.get(ref) }))
    .filter((s): s is { ref: string; value: string } => !!s.value);
  if (!subs.length) return args;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let out = node;
      for (const { ref, value } of subs) out = out.replace(placeholderRegex(ref), value);
      return out;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) o[k] = walk(v);
      return o;
    }
    return node;
  };
  return walk(args) as T;
}

/**
 * Scrub every known secret value out of text a tool is about to hand back to the
 * model, replacing each with its `{{REF}}` placeholder. Defends against a tool
 * echoing a value that was substituted in, or reading a file that contains one.
 */
export async function redactSecrets(text: string): Promise<string> {
  if (!text || !configuredRefs().length) return text;
  const values = await loadValues();
  let out = text;
  for (const [ref, value] of values) {
    if (value && out.includes(value)) out = out.split(value).join(`{{${ref}}}`);
  }
  return out;
}

/** The model-facing listing: refs and descriptions, never values. */
export function listSecretsForModel(): string {
  const secrets = useStore.getState().settings.secrets ?? [];
  if (!secrets.length) {
    return "No secrets are saved. The user can add API keys under Settings → Secrets.";
  }
  const lines = secrets.map(
    (s) => `- {{${s.ref}}} — ${s.name}${s.description ? `: ${s.description}` : ""}`,
  );
  return (
    `Saved secrets you can use but not read. To use one, put its placeholder ` +
    `(e.g. {{${secrets[0].ref}}}) into any file you write, command you run, or request ` +
    `you make. The app substitutes the real value at run time; you will never see it, ` +
    `and it never appears in this conversation.\n\n${lines.join("\n")}`
  );
}
