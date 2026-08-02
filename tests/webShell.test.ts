import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The web terminal runs coreutils over the OPFS workspace. This exercises the
 * real registered run_command through the real invoke() dispatcher, with the
 * filesystem mocked in memory — so tokenizing, pipes, redirection, sequencing
 * and the builtins are all tested, without a browser.
 */

const files = new Map<string, string>();
const dirs = new Set<string>([".harnessx", ".harnessx/workspace"]);

vi.mock("../web/shims/fs", () => ({
  BaseDirectory: { Home: 1 },
  exists: async (p: string) => files.has(p) || dirs.has(p),
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error("ENOENT");
    return files.get(p)!;
  },
  writeTextFile: async (p: string, data: string) => {
    files.set(p, data);
  },
  remove: async (p: string) => {
    files.delete(p);
    dirs.delete(p);
  },
  readDir: async (p: string) => {
    const prefix = p.endsWith("/") ? p : p + "/";
    const names = new Set<string>();
    for (const f of files.keys()) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    for (const d of dirs) if (d.startsWith(prefix)) names.add(d.slice(prefix.length).split("/")[0]);
    return [...names].filter(Boolean).map((name) => ({
      name,
      isFile: files.has(prefix + name),
      isDirectory: dirs.has(prefix + name),
      isSymlink: false,
    }));
  },
}));

await import("../web/shims/shell");
const { invoke } = await import("../web/shims/core");

const sh = (command: string, cwd = "") =>
  invoke<{ stdout: string; stderr: string; code: number }>("run_command", { command, cwd });

beforeEach(() => {
  files.clear();
  dirs.clear();
  dirs.add(".harnessx").add(".harnessx/workspace");
});

describe("the web terminal", () => {
  it("echoes and writes with redirection, then reads back", async () => {
    expect((await sh("echo hello")).stdout).toBe("hello\n");
    await sh("echo 'line one' > notes.txt");
    await sh("echo 'line two' >> notes.txt");
    const cat = await sh("cat notes.txt");
    expect(cat.stdout).toBe("line one\nline two\n");
  });

  it("lists files, and hides dotfiles without -a", async () => {
    await sh("echo x > a.txt");
    await sh("echo y > .hidden");
    expect((await sh("ls")).stdout.trim()).toBe("a.txt");
    expect((await sh("ls -a")).stdout).toContain(".hidden");
  });

  it("pipes through grep and wc", async () => {
    await sh("echo 'apple\nbanana\napricot' > fruit.txt");
    expect((await sh("cat fruit.txt | grep ap")).stdout).toBe("apple\napricot\n");
    expect((await sh("cat fruit.txt | grep ap | wc -l")).stdout.trim()).toBe("2");
  });

  it("honours && (stop on failure) and ; (always continue)", async () => {
    const good = await sh("echo one && echo two");
    expect(good.stdout).toBe("one\ntwo\n");
    // cat of a missing file fails, so the && chain stops before echo.
    const chain = await sh("cat nope.txt && echo reached");
    expect(chain.stdout).not.toContain("reached");
    const semi = await sh("cat nope.txt ; echo reached");
    expect(semi.stdout).toContain("reached");
  });

  it("tracks cwd across cd within a command", async () => {
    await sh("mkdir sub");
    await sh("echo inside > sub/f.txt");
    const r = await sh("cd sub && cat f.txt");
    expect(r.stdout).toBe("inside\n");
    expect((await sh("cd sub && pwd")).stdout.trim()).toBe("/sub");
  });

  it("head and tail slice lines", async () => {
    await sh("echo '1\n2\n3\n4\n5' > n.txt");
    expect((await sh("head -n 2 n.txt")).stdout).toBe("1\n2\n");
    expect((await sh("tail -n 2 n.txt")).stdout).toBe("4\n5\n");
  });

  it("reports an unknown command as 127, not a crash", async () => {
    const r = await sh("nmap localhost");
    expect(r.code).toBe(127);
    expect(r.stderr).toContain("command not found");
  });

  it("cannot escape the workspace", async () => {
    // A traversal write must stay inside the workspace (vfs clamps it).
    await sh("echo pwned > ../../settings.json");
    // The app's real settings path must be untouched by the shell.
    expect(files.has(".harnessx/settings.json")).toBe(false);
  });
});
