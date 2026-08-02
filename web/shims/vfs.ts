/**
 * A virtual filesystem for the web build's file, terminal and Python tools.
 *
 * The desktop app's file tools operate on a working directory the user picks on
 * their real disk. A browser has no real disk, so this gives the model a
 * persistent workspace inside the Origin Private File System instead — real
 * files that survive reloads, that the coming terminal and Python tools share,
 * and that the user's actual machine is never exposed to.
 *
 * Everything is sandboxed under one workspace root. The desktop's `base`
 * (working directory) is cosmetic here — there's a single workspace — and paths
 * are resolved relative to it with `..` clamped, so a tool can't climb out into
 * the app's own storage or anywhere else in OPFS.
 */

import { registerCommand } from "./core";
import * as fs from "./fs";

/** The one place the model's files live. Kept apart from app storage. */
export const WORKSPACE = ".harnessx/workspace";

/**
 * Resolve base + path to a safe location under the workspace.
 *
 * Exported so the resolution — the security-critical part — can be tested on its
 * own. Absolute paths are treated as workspace-relative (there is no filesystem
 * root to honour), and any `..` that would escape the workspace is dropped
 * rather than allowed to climb into the app's OPFS data.
 */
export function resolve(base: string, path: string): string {
  const combined = /^([/~]|[A-Za-z]:)/.test(path) ? path : `${base}/${path}`;
  const out: string[] = [];
  for (const seg of combined.split(/[/\\]+/)) {
    if (!seg || seg === "." || seg === "~") continue;
    if (/^[A-Za-z]:$/.test(seg)) continue; // a stray drive letter
    if (seg === "..") out.pop(); // clamp: never climbs past the workspace root
    else out.push(seg);
  }
  return out.length ? `${WORKSPACE}/${out.join("/")}` : WORKSPACE;
}

async function ensureWorkspace(): Promise<void> {
  if (!(await fs.exists(WORKSPACE))) await fs.mkdir(WORKSPACE);
}

registerCommand("fs_read", async (args) => {
  const { base, path } = args as { base: string; path: string };
  return fs.readTextFile(resolve(base ?? "", path));
});

registerCommand("fs_write", async (args) => {
  const { base, path, content, append } = args as {
    base: string;
    path: string;
    content: string;
    append?: boolean;
  };
  await ensureWorkspace();
  const full = resolve(base ?? "", path);
  if (append && (await fs.exists(full))) {
    const prev = await fs.readTextFile(full);
    await fs.writeTextFile(full, prev + content);
  } else {
    await fs.writeTextFile(full, content);
  }
  return null;
});

registerCommand("fs_mkdir", async (args) => {
  const { base, path } = args as { base: string; path: string };
  await fs.mkdir(resolve(base ?? "", path));
  return null;
});

registerCommand("fs_remove", async (args) => {
  const { base, path } = args as { base: string; path: string };
  await fs.remove(resolve(base ?? "", path), { recursive: true });
  return null;
});

registerCommand("fs_exists", async (args) => {
  const { base, path } = args as { base: string; path: string };
  return fs.exists(resolve(base ?? "", path));
});

registerCommand("fs_list", async (args) => {
  const { base, path } = args as { base: string; path: string };
  const entries = await fs.readDir(resolve(base ?? "", path));
  // The desktop returns { name, dir }; match it so the tool layer is unchanged.
  return entries.map((e) => ({ name: e.name, dir: e.isDirectory }));
});
