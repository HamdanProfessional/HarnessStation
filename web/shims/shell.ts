/**
 * A small POSIX-ish shell for the web build's terminal tool.
 *
 * A browser can't run a real shell, and a full Linux-in-WASM VM (CheerpX,
 * WebContainers) is a heavy, separately-licensed dependency. Most of what a
 * model actually does with a terminal, though, is move around a filesystem and
 * read and filter text — so this implements those coreutils directly over the
 * same OPFS workspace the file and Python tools share, with pipes, redirection
 * and `&&`/`;` sequencing.
 *
 * It is deliberately a subset. A command it doesn't know returns "command not
 * found" with a code of 127 and a pointer at the file tools or Python, rather
 * than pretending. Real bash remains a future upgrade behind the same seam.
 */

import { registerCommand } from "./core";
import { resolve, WORKSPACE } from "./vfs";
import * as fs from "./fs";

interface Result {
  stdout: string;
  stderr: string;
  code: number;
}

/** cwd is workspace-relative (""=root), threaded through a command's cd's. */
interface Ctx {
  cwd: string;
}

const enc = (path: string, cwd: string) => resolve(cwd, path);

async function readOr(path: string): Promise<string> {
  return fs.readTextFile(path);
}

/** Split a line into tokens, honouring single and double quotes. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const BUILTINS: Record<
  string,
  (args: string[], stdin: string, ctx: Ctx) => Promise<Result> | Result
> = {
  pwd: (_a, _s, ctx) => ok("/" + ctx.cwd),

  cd: async (a, _s, ctx) => {
    const target = a[0] ? resolve(ctx.cwd, a[0]).slice(WORKSPACE.length + 1) : "";
    if (a[0] && !(await fs.exists(resolve(ctx.cwd, a[0])))) return err(`cd: ${a[0]}: no such directory`);
    ctx.cwd = target;
    return ok("");
  },

  echo: (a) => {
    // Drop a `-n`; everything else is echoed with spaces.
    const noNewline = a[0] === "-n";
    const text = (noNewline ? a.slice(1) : a).join(" ");
    return ok(noNewline ? text : text + "\n");
  },

  ls: async (a, _s, ctx) => {
    const flags = a.filter((x) => x.startsWith("-")).join("");
    const target = a.find((x) => !x.startsWith("-")) ?? ".";
    try {
      const entries = await fs.readDir(enc(target, ctx.cwd));
      const names = entries
        .filter((e) => flags.includes("a") || !e.name.startsWith("."))
        .map((e) => (e.isDirectory ? e.name + "/" : e.name))
        .sort();
      return ok(flags.includes("l") ? names.join("\n") + (names.length ? "\n" : "") : names.join("  ") + (names.length ? "\n" : ""));
    } catch {
      return err(`ls: ${target}: no such file or directory`);
    }
  },

  cat: async (a, stdin, ctx) => {
    if (!a.length) return ok(stdin);
    let out = "";
    for (const f of a) {
      try {
        out += await readOr(enc(f, ctx.cwd));
      } catch {
        return err(`cat: ${f}: no such file or directory`);
      }
    }
    return ok(out);
  },

  mkdir: async (a, _s, ctx) => {
    for (const d of a.filter((x) => !x.startsWith("-"))) await fs.mkdir(enc(d, ctx.cwd));
    return ok("");
  },

  rm: async (a, _s, ctx) => {
    const recursive = a.some((x) => x.startsWith("-") && x.includes("r"));
    for (const f of a.filter((x) => !x.startsWith("-"))) {
      try {
        await fs.remove(enc(f, ctx.cwd), { recursive });
      } catch {
        if (!a.some((x) => x.includes("f"))) return err(`rm: ${f}: no such file or directory`);
      }
    }
    return ok("");
  },

  touch: async (a, _s, ctx) => {
    for (const f of a) {
      const p = enc(f, ctx.cwd);
      if (!(await fs.exists(p))) await fs.writeTextFile(p, "");
    }
    return ok("");
  },

  cp: async (a, _s, ctx) => {
    const [src, dst] = a.filter((x) => !x.startsWith("-"));
    if (!src || !dst) return err("cp: needs a source and destination");
    await fs.writeTextFile(enc(dst, ctx.cwd), await readOr(enc(src, ctx.cwd)));
    return ok("");
  },

  mv: async (a, _s, ctx) => {
    const [src, dst] = a.filter((x) => !x.startsWith("-"));
    if (!src || !dst) return err("mv: needs a source and destination");
    await fs.writeTextFile(enc(dst, ctx.cwd), await readOr(enc(src, ctx.cwd)));
    await fs.remove(enc(src, ctx.cwd), {});
    return ok("");
  },

  head: (a, stdin, ctx) => lineSlice(a, stdin, ctx, "head"),
  tail: (a, stdin, ctx) => lineSlice(a, stdin, ctx, "tail"),

  wc: async (a, stdin, ctx) => {
    const text = a.find((x) => !x.startsWith("-"))
      ? await readOr(enc(a.find((x) => !x.startsWith("-"))!, ctx.cwd)).catch(() => "")
      : stdin;
    const lines = text ? text.replace(/\n$/, "").split("\n").length : 0;
    if (a.includes("-l")) return ok(`${lines}\n`);
    const words = text.split(/\s+/).filter(Boolean).length;
    return ok(`${lines} ${words} ${text.length}\n`);
  },

  grep: async (a, stdin, ctx) => {
    const flags = a.filter((x) => x.startsWith("-"));
    const rest = a.filter((x) => !x.startsWith("-"));
    const pattern = rest[0];
    if (!pattern) return err("grep: no pattern");
    const text = rest[1] ? await readOr(enc(rest[1], ctx.cwd)).catch(() => "") : stdin;
    const ci = flags.some((f) => f.includes("i"));
    const re = new RegExp(pattern, ci ? "i" : "");
    const matched = text.split("\n").filter((l) => re.test(l));
    return { stdout: matched.join("\n") + (matched.length ? "\n" : ""), stderr: "", code: matched.length ? 0 : 1 };
  },

  whoami: () => ok("web\n"),
  env: () => ok("HOME=/\nSHELL=/harness-web\n"),
  clear: () => ok(""),
  true: () => ok(""),
  false: () => err("", 1),
};

async function lineSlice(a: string[], stdin: string, ctx: Ctx, which: "head" | "tail"): Promise<Result> {
  const nIdx = a.indexOf("-n");
  const n = nIdx >= 0 ? parseInt(a[nIdx + 1], 10) || 10 : 10;
  const file = a.find((x) => !x.startsWith("-") && x !== String(n));
  const text = file ? await readOr(enc(file, ctx.cwd)).catch(() => "") : stdin;
  const lines = text.replace(/\n$/, "").split("\n");
  const picked = which === "head" ? lines.slice(0, n) : lines.slice(-n);
  return ok(picked.join("\n") + (picked.length ? "\n" : ""));
}

const ok = (stdout: string): Result => ({ stdout, stderr: "", code: 0 });
const err = (stderr: string, code = 1): Result => ({ stdout: "", stderr, code });

/** Run one pipeline (commands joined by |), threading stdout as the next stdin. */
async function runPipeline(segment: string, ctx: Ctx): Promise<Result> {
  const stages = segment.split("|").map((s) => s.trim());
  let stdin = "";
  let last: Result = ok("");
  for (const stage of stages) {
    // Redirection: capture this stage's stdout to a file instead of passing on.
    const redir = stage.match(/\s(>>?)\s*(\S+)\s*$/);
    const body = redir ? stage.slice(0, redir.index).trim() : stage;
    const tokens = tokenize(body);
    const [cmd, ...args] = tokens;
    if (!cmd) continue;

    const builtin = BUILTINS[cmd];
    if (!builtin) {
      return err(
        `${cmd}: command not found. The web terminal runs a subset of coreutils — use the file tools or the Python tool for more.`,
        127,
      );
    }
    last = await builtin(args, stdin, ctx);

    if (redir && last.code === 0) {
      const path = enc(redir[2], ctx.cwd);
      const prev = redir[1] === ">>" && (await fs.exists(path)) ? await readOr(path) : "";
      await fs.writeTextFile(path, prev + last.stdout);
      last = ok("");
      stdin = "";
    } else {
      stdin = last.stdout;
    }
  }
  return last;
}

async function run(command: string, cwd: string): Promise<Result> {
  const ctx: Ctx = { cwd: cwd.replace(new RegExp(`^/?${WORKSPACE}/?`), "").replace(/^\//, "") };
  if (!(await fs.exists(WORKSPACE))) await fs.mkdir(WORKSPACE);

  // Sequencing: `;` always continues, `&&` continues only on success.
  const parts = command.split(/(\s*&&\s*|\s*;\s*)/).filter((s) => s && !/^\s*;\s*$/.test(s));
  let out = "";
  let errOut = "";
  let code = 0;
  let i = 0;
  while (i < parts.length) {
    const seg = parts[i].trim();
    const sep = parts[i + 1]?.trim();
    if (seg === "&&" || seg === ";") { i++; continue; }
    const res = await runPipeline(seg, ctx).catch((e) => err(String((e as Error).message ?? e)));
    out += res.stdout;
    errOut += res.stderr;
    code = res.code;
    if (sep === "&&" && code !== 0) break; // stop the && chain on failure
    i++;
  }
  return { stdout: out, stderr: errOut, code };
}

registerCommand("run_command", (args) => {
  const { command, cwd } = (args ?? {}) as { command: string; cwd?: string };
  return run(String(command ?? ""), String(cwd ?? ""));
});
