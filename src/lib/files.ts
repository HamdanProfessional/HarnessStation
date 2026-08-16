import { invoke } from "@tauri-apps/api/core";

/**
 * Thin client over the app's filesystem commands, which are backed by the real
 * disk on desktop and by the OPFS workspace on web. In the web build that
 * workspace is the same tree the v86 Linux VM mounts at /mnt over 9p, so this is
 * how you actually see the VM's files, their content, and browse around.
 *
 * All commands take { base, path }. `base` is a working directory on desktop and
 * cosmetic on web (a single sandboxed workspace); the FilesView passes base "".
 */

export interface FsEntry {
  name: string;
  dir: boolean;
}

export const fsList = (path: string, base = "") =>
  invoke<FsEntry[]>("fs_list", { base, path });

export const fsRead = (path: string, base = "") =>
  invoke<string>("fs_read", { base, path });

export const fsWrite = (path: string, content: string, base = "") =>
  invoke("fs_write", { base, path, content, append: false });

export const fsMkdir = (path: string, base = "") =>
  invoke("fs_mkdir", { base, path });

export const fsRemove = (path: string, base = "") =>
  invoke("fs_remove", { base, path });

export const fsExists = (path: string, base = "") =>
  invoke<boolean>("fs_exists", { base, path });

/** Join path segments with forward slashes, trimming empties (workspace-style). */
export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split(/[/\\]+/))
    .filter((s) => s && s !== ".")
    .join("/");
}

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "jsonl", "js", "ts", "tsx", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cc", "hpp", "cs", "php", "sh",
  "bash", "zsh", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "csv", "tsv",
  "html", "htm", "css", "scss", "less", "xml", "svg", "sql", "log", "gitignore",
  "dockerfile", "makefile", "lock", "properties", "gradle", "kt", "swift", "lua",
  "r", "pl", "vue", "svelte", "astro", "graphql", "proto",
]);

/** Best-effort: does this filename look like readable text? */
export function looksTextual(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.includes(".")) return true; // extensionless (README, Dockerfile, LICENSE)
  const ext = lower.split(".").pop() ?? "";
  return TEXT_EXT.has(ext);
}

/** A rough language hint for syntax highlighting, from the extension. */
export function langFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", cs: "csharp",
    sh: "bash", bash: "bash", zsh: "bash", yaml: "yaml", yml: "yaml", toml: "toml",
    json: "json", jsonl: "json", html: "html", css: "css", md: "markdown",
    sql: "sql", xml: "xml", c: "c", cpp: "cpp", h: "c",
  };
  return map[ext] ?? "";
}
