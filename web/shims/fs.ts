/**
 * Browser filesystem, standing in for @tauri-apps/plugin-fs.
 *
 * The desktop app stores everything as files under ~/.harnessx. In the browser
 * that maps cleanly onto the Origin Private File System — a real, persistent,
 * origin-scoped filesystem with directories and files, and unlike localStorage
 * it isn't capped at a few megabytes, which matters once conversations and
 * knowledge-base vectors pile up.
 *
 * Only the handful of functions storage.ts, piper.ts and whisper.ts actually
 * call are implemented, with the same signatures, so the app's storage layer
 * runs unchanged. `baseDir` is ignored: there's one OPFS root and everything the
 * app writes already lives under `.harnessx/`, so it's effectively the home dir.
 */

/** The plugin's enum, reduced to what's referenced (`BaseDirectory.Home`). */
export const BaseDirectory = { Home: 1, AppData: 2, Temp: 3 } as const;

interface FsOptions {
  baseDir?: number;
  recursive?: boolean;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error(
      "This browser has no Origin Private File System (needs a recent Chromium, Firefox or Safari over HTTPS).",
    );
  }
  return navigator.storage.getDirectory();
}

/** "a/b/c.json" -> ["a", "b", "c.json"], tolerant of leading "./" and slashes. */
function parts(path: string): string[] {
  return path
    .replace(/^\.\//, "")
    .split("/")
    .filter((p) => p && p !== ".");
}

/** Walk to the directory holding `path`'s last segment, creating dirs if asked. */
async function parentDir(
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = await root();
  for (const name of segments.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(name, { create });
  }
  return dir;
}

export async function exists(path: string, _opts?: FsOptions): Promise<boolean> {
  const segments = parts(path);
  if (segments.length === 0) return true;
  const name = segments[segments.length - 1];
  try {
    const dir = await parentDir(segments, false);
    // A path is either a file or a directory; try file first, then directory.
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      await dir.getDirectoryHandle(name);
      return true;
    }
  } catch {
    return false;
  }
}

export async function mkdir(path: string, opts?: FsOptions): Promise<void> {
  const segments = parts(path);
  let dir = await root();
  for (const name of segments) {
    // recursive is the app's usual case; without it, a missing parent throws,
    // which matches the plugin's behaviour closely enough for how it's used.
    dir = await dir.getDirectoryHandle(name, { create: true });
  }
  void opts;
}

export async function readTextFile(path: string, _opts?: FsOptions): Promise<string> {
  const segments = parts(path);
  const dir = await parentDir(segments, false);
  const handle = await dir.getFileHandle(segments[segments.length - 1]);
  return (await handle.getFile()).text();
}

export async function readFile(path: string, _opts?: FsOptions): Promise<Uint8Array> {
  const segments = parts(path);
  const dir = await parentDir(segments, false);
  const handle = await dir.getFileHandle(segments[segments.length - 1]);
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function writeTextFile(
  path: string,
  data: string,
  _opts?: FsOptions,
): Promise<void> {
  const segments = parts(path);
  // Create intermediate directories, matching how the plugin behaves when the
  // app writes e.g. conversations/<id>.json into a fresh profile.
  const dir = await parentDir(segments, true);
  const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

export async function writeFile(
  path: string,
  data: Uint8Array,
  _opts?: FsOptions,
): Promise<void> {
  const segments = parts(path);
  const dir = await parentDir(segments, true);
  const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export async function readDir(path: string, _opts?: FsOptions): Promise<DirEntry[]> {
  const segments = parts(path);
  let dir = await root();
  for (const name of segments) {
    dir = await dir.getDirectoryHandle(name);
  }
  const out: DirEntry[] = [];
  // @ts-expect-error - entries() is standard on OPFS handles but missing in the DOM lib.
  for await (const [name, handle] of dir.entries()) {
    out.push({
      name,
      isFile: handle.kind === "file",
      isDirectory: handle.kind === "directory",
      isSymlink: false,
    });
  }
  return out;
}

export async function stat(path: string, _opts?: FsOptions): Promise<{ size: number }> {
  const segments = parts(path);
  const dir = await parentDir(segments, false);
  const handle = await dir.getFileHandle(segments[segments.length - 1]);
  return { size: (await handle.getFile()).size };
}

export async function remove(path: string, opts?: FsOptions): Promise<void> {
  const segments = parts(path);
  const dir = await parentDir(segments, false);
  await dir.removeEntry(segments[segments.length - 1], { recursive: opts?.recursive ?? false });
}
