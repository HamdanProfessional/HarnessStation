/**
 * Which llama.cpp lineage a local engine directory holds.
 *
 * Both build a binary called `llama-server`, both serve an OpenAI-compatible
 * API, and both take most of the same flags — so everything downstream of the
 * launch is shared. The differences are confined to two places: how you *get*
 * the engine (this file) and what its command line accepts (`launch_flag_args`
 * in src-tauri/src/local.rs, which is where the translation is tested).
 */

export type EngineKind = "llama.cpp" | "ik_llama";

export const ENGINE_LABEL: Record<EngineKind, string> = {
  "llama.cpp": "llama.cpp",
  ik_llama: "ik_llama.cpp",
};

export const ENGINE_BLURB: Record<EngineKind, string> = {
  "llama.cpp": "Upstream. Downloaded for you, CUDA or Vulkan when a GPU is present.",
  ik_llama: "CPU-focused fork. Faster prompt processing and quantized matmul on CPU — you build it yourself.",
};

/**
 * Engine directories are named after what produced them, so the lineage is
 * recoverable from the path alone and doesn't need a sidecar file.
 * `installEngine` writes `engines/llama.cpp-<tag>-<kind>`; an ik_llama engine
 * is whatever directory the user points at, so the check is on the name rather
 * than an exact prefix.
 */
export function engineKindOf(dir: string): EngineKind {
  return /ik[_-]?llama/i.test(dir) ? "ik_llama" : "llama.cpp";
}

export const isIk = (k: EngineKind) => k === "ik_llama";

/**
 * Whether the engine takes the `--spec-draft-*` tuning flags alongside MTP.
 *
 * Upstream does. ik_llama has MTP — it names the stage `mtp` rather than
 * `draft-mtp` — but tunes stages with an inline `key=value` syntax on
 * `--spec-type` instead, and has no `--spec-draft-*` flags at all. The draft
 * number box is therefore hidden rather than ignored on the fork.
 */
export const supportsMtpTuning = (k: EngineKind) => !isIk(k);

/**
 * Whether auto-fit is on by default and can be switched off with a flag.
 *
 * Upstream: on by default, `--fit off` disables. The fork: off by default,
 * bare `--fit` opts in — so there is nothing for a "disable auto-fit" control
 * to do there.
 */
export const supportsFitOff = (k: EngineKind) => !isIk(k);

/** Where a user-supplied ik_llama build lives. Absolute; empty when unset. */
const IK_DIR_KEY = "hs-ik-llama-dir";

export const ikDir = (): string => localStorage.getItem(IK_DIR_KEY) ?? "";

export function setIkDir(dir: string): void {
  const clean = normalizeEngineDir(dir);
  if (clean) localStorage.setItem(IK_DIR_KEY, clean);
  else localStorage.removeItem(IK_DIR_KEY);
}

/**
 * Tidy a hand-typed path.
 *
 * There is no native folder picker in the app, so this arrives as pasted text —
 * and the two things Windows users paste are a quoted path (from "Copy as
 * path", which includes the quotes) and one with a trailing separator. Both
 * would resolve to nothing.
 */
export function normalizeEngineDir(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  s = s.replace(/[\\/]+$/, "");
  return s;
}

/**
 * ik_llama.cpp publishes no binaries — its GitHub releases carry no assets, and
 * the README says to compile locally. So there is no download button for it,
 * and pretending otherwise would just fail at the first fetch. This is the
 * build, verbatim, for the CPU-only case it exists to serve.
 *
 * `-DGGML_NATIVE=ON` is the flag that matters: without it the IQK quantized
 * GEMM kernels fall back to a generic path and the fork loses most of its
 * reason to exist.
 */
export const IK_BUILD_STEPS = [
  "git clone https://github.com/ikawrakow/ik_llama.cpp",
  "cd ik_llama.cpp",
  "cmake -B build -DGGML_NATIVE=ON -DGGML_CUDA=OFF",
  "cmake --build build --config Release -j",
] as const;

/** Where `llama-server` lands after the build above, relative to the clone. */
export const IK_BUILD_OUTPUT = "build/bin";
