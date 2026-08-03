/**
 * A real Linux VM in the browser, via v86.
 *
 * The coreutils shim (`shell.ts`) covers most of what a model does with a
 * terminal, but it isn't Linux — no real binaries, no package manager, no
 * arbitrary programs. This boots an actual 32-bit Linux kernel (Buildroot +
 * BusyBox) in the tab through v86, an open-source x86-to-WebAssembly emulator,
 * and drives its serial console. It's genuine Linux: `uname` is real, `grep` is
 * real busybox, and a program the guest has really runs.
 *
 * v86 is BSD-licensed and free for commercial use — deliberately chosen over the
 * faster CheerpX, which is proprietary and would bill for a commercial product.
 *
 * Costs, stated plainly: the kernel is a ~10 MB one-time download, boot takes a
 * few seconds, and execution is emulated so it's slower than native. The guest
 * is headless (serial only); its filesystem is bridged to the OPFS workspace
 * over 9p, so files created by the file tools and by Linux are the same files.
 *
 * run_command routes here when the user enables the real-Linux terminal
 * (Settings, off by default); otherwise it falls back to the coreutils shell.
 * The OPFS workspace is bridged in and out over 9p so the file tools and the VM
 * operate on the same files.
 */

import { registerCommand } from "./core";
import { shellRun } from "./shell";
import * as fs from "./fs";
import { WORKSPACE } from "./vfs";

/** Where the boot assets are served from (web/public/vm → /vm at runtime). */
const VM_BASE = "/vm";

/** BusyBox's default prompt. Boot is complete once we see it. */
const PROMPT = "~% ";
/** Fixed prompt we set post-boot, so it can be stripped from output cleanly. */
const RUN_PROMPT = "__HSVM__";

const BOOT_TIMEOUT_MS = 40_000;
const COMMAND_TIMEOUT_MS = 30_000;

interface Emulator {
  add_listener: (event: string, fn: (byte: number) => void) => void;
  serial0_send: (text: string) => void;
  // 9p bridge: create_file/read_file operate on the tree the guest sees at /mnt.
  create_file: (path: string, data: Uint8Array) => Promise<void>;
  read_file: (path: string) => Promise<Uint8Array>;
  destroy?: () => void;
}

/**
 * The guest mounts the 9p share at /mnt, and host create_file("x") appears there
 * as /mnt/x. We put the model's workspace under /mnt/workspace and run commands
 * there, so the file tools (OPFS) and the VM operate on the same files.
 */
const GUEST_MOUNT = "/mnt";
const SHARE_PREFIX = "workspace";
const GUEST_WORKDIR = `${GUEST_MOUNT}/${SHARE_PREFIX}`;

interface V86Ctor {
  new (opts: Record<string, unknown>): Emulator;
}

let emulator: Emulator | null = null;
let booting: Promise<Emulator> | null = null;

/** Everything the serial console has emitted, decoded as it arrives. */
let serialBuffer = "";
/** Waiters watching the buffer for a substring or pattern to appear. */
type Watcher = { test: (buf: string) => boolean; resolve: () => void };
const watchers: Watcher[] = [];

function onSerialByte(byte: number): void {
  serialBuffer += String.fromCharCode(byte);
  // Notify anyone waiting for a marker or prompt. Copy first: a resolved waiter
  // removes itself, so iterate over a snapshot.
  for (const w of [...watchers]) {
    if (w.test(serialBuffer)) {
      watchers.splice(watchers.indexOf(w), 1);
      w.resolve();
    }
  }
}

/** Resolve when the serial buffer satisfies `test`, or reject on timeout. */
function waitFor(test: (buf: string) => boolean, timeoutMs: number, label: string): Promise<void> {
  if (test(serialBuffer)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const w: Watcher = { test, resolve: () => { clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => {
      const i = watchers.indexOf(w);
      if (i >= 0) watchers.splice(i, 1);
      reject(new Error(`VM timed out waiting for ${label}`));
    }, timeoutMs);
    watchers.push(w);
  });
}

/** Load v86 and boot the kernel to a shell. Reuses an in-flight boot. */
export function bootVM(): Promise<Emulator> {
  if (emulator) return Promise.resolve(emulator);
  if (booting) return booting;

  booting = (async () => {
    // v86 exposes V86 as a named ESM export (and, in some builds, a global).
    const mod = (await import("v86")) as { V86?: V86Ctor; default?: V86Ctor };
    const V86 = mod.V86 ?? mod.default ?? (globalThis as { V86?: V86Ctor }).V86;
    if (!V86) throw new Error("v86 failed to load");

    const em = new V86({
      wasm_path: `${VM_BASE}/v86.wasm`,
      bios: { url: `${VM_BASE}/seabios.bin` },
      vga_bios: { url: `${VM_BASE}/vgabios.bin` },
      bzimage: { url: `${VM_BASE}/buildroot-bzimage68.bin` },
      // The 9p filesystem the OPFS workspace bridges into. v86 auto-mounts it in
      // the guest at /mnt, tag "host9p".
      filesystem: {},
      cmdline: "tsc=reliable mitigations=off random.trust_cpu=on",
      // 128 MB guest: ample for BusyBox, and well under what the tab can spare
      // alongside the app.
      memory_size: 128 * 1024 * 1024,
      autostart: true,
      disable_keyboard: true,
      disable_speaker: true,
    });

    em.add_listener("serial0-output-byte", onSerialByte);

    await waitFor((b) => b.includes(PROMPT), BOOT_TIMEOUT_MS, "the shell prompt");
    emulator = em;
    // Turn off input echo. The console otherwise echoes every command back, and
    // a long one wraps at 80 columns into fragments that leak into the captured
    // output. With echo off the serial buffer holds only real command output, so
    // parsing is just "everything up to the exit marker". `stty cols` doesn't
    // reliably widen the busybox line editor, so `-echo` is the robust fix.
    await sendRaw(em, `stty -echo`);
    // A fixed prompt so output parsing can strip it deterministically. The
    // default is `\w% `, which changes with the working directory (cd into the
    // workspace makes it `workspace% `) and would otherwise leak into output.
    await sendRaw(em, `export PS1='${RUN_PROMPT}'`);
    await sendRaw(em, `mkdir -p ${GUEST_WORKDIR}`);
    return em;
  })();

  // A failed boot must not wedge every later attempt.
  booting.catch(() => {
    booting = null;
  });
  return booting;
}

export function vmReady(): boolean {
  return emulator !== null;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Send one line to the shell and wait for it to complete, discarding output.
 * Used for setup commands (stty, mkdir) where only completion matters.
 */
async function sendRaw(em: Emulator, line: string): Promise<void> {
  const marker = /__HSR_(\d+)_END__/;
  const start = serialBuffer.length;
  em.serial0_send(`${line}\n`);
  em.serial0_send('echo "__HSR_$?_END__"\n');
  await waitFor((b) => marker.test(b.slice(start)), COMMAND_TIMEOUT_MS, "setup command");
}

// --- OPFS ⇆ 9p bridge --------------------------------------------------------

/**
 * Push every file in the OPFS workspace into the guest's 9p share, so the VM
 * sees exactly what the file tools have written. Done before each command; the
 * guest's filesystem is in-memory and doesn't survive a reload, so OPFS stays
 * the source of truth.
 */
async function pushWorkspace(em: Emulator): Promise<void> {
  const walk = async (opfsDir: string, rel: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fs.readDir>>;
    try {
      entries = await fs.readDir(opfsDir);
    } catch {
      return; // workspace not created yet
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) {
        await walk(`${opfsDir}/${e.name}`, childRel);
      } else {
        const bytes = await fs.readFile(`${opfsDir}/${e.name}`);
        await em.create_file(`${SHARE_PREFIX}/${childRel}`, bytes);
      }
    }
  };
  await walk(WORKSPACE, "");
}

/**
 * Pull files the command created or changed back into OPFS. The guest is
 * enumerated with `find` (the shell path is proven reliable), then each file is
 * read over the 9p bridge and written to the workspace.
 */
async function pullWorkspace(em: Emulator): Promise<void> {
  const listing = await rawCapture(em, `find ${GUEST_WORKDIR} -type f 2>/dev/null`);
  const paths = listing
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${GUEST_WORKDIR}/`));
  for (const guestPath of paths) {
    const rel = guestPath.slice(GUEST_WORKDIR.length + 1);
    try {
      const bytes = await em.read_file(`${SHARE_PREFIX}/${rel}`);
      const opfsPath = `${WORKSPACE}/${rel}`;
      const dir = opfsPath.slice(0, opfsPath.lastIndexOf("/"));
      await fs.mkdir(dir);
      await fs.writeFile(opfsPath, bytes);
    } catch {
      // A file that vanished between find and read is not worth failing over.
    }
  }
}

/** Run a command purely for its stdout (no exit code), used by the bridge. */
async function rawCapture(em: Emulator, command: string): Promise<string> {
  const marker = /__HSC_(\d+)_END__/;
  const start = serialBuffer.length;
  em.serial0_send(`${command}\n`);
  em.serial0_send('echo "__HSC_$?_END__"\n');
  await waitFor((b) => marker.test(b.slice(start)), COMMAND_TIMEOUT_MS, "capture");
  // eslint-disable-next-line no-control-regex
  const seg = serialBuffer.slice(start).replace(/\[[0-9;]*m/g, "");
  const body = seg.slice(0, seg.search(marker));
  return body
    .split(/\r?\n/)
    .filter((l) => l.trim() !== command.trim())
    .filter((l) => !l.includes('echo "__HSC_$?_END__"'))
    .filter((l) => l.trim() !== RUN_PROMPT && l.trim() !== PROMPT.trim())
    .join("\n");
}

/**
 * Run one shell command in the VM and return its output and exit code, with the
 * OPFS workspace bridged in and out around it. `cwd` is the workspace-relative
 * directory the file tools use, so a command sees the same current directory.
 *
 * The console echoes back what we type and merges stdout with stderr, so the
 * output has to be fished out precisely. The trick: wrap the command with a
 * marker that carries the exit code — `echo __HSX_$?_END__`. In the *echoed*
 * input line `$?` appears literally (`__HSX_$?_END__`); in the *executed* output
 * it's expanded to a number (`__HSX_0_END__`). Matching the numeric form finds
 * the real marker and never the echo.
 */
export async function vmRunCommand(command: string, cwd = ""): Promise<CommandResult> {
  const em = await bootVM();
  await pushWorkspace(em);

  // Run inside the shared workspace so paths line up with the file tools.
  const dir = cwd ? `${GUEST_WORKDIR}/${cwd}` : GUEST_WORKDIR;
  const oneLine = `cd ${dir} 2>/dev/null; ` + command.replace(/\r?\n/g, "; ");
  const marker = /__HSX_(\d+)_END__/;

  const start = serialBuffer.length;
  em.serial0_send(`${oneLine}\n`);
  em.serial0_send('echo "__HSX_$?_END__"\n');

  await waitFor((b) => marker.test(b.slice(start)), COMMAND_TIMEOUT_MS, "the command to finish");

  // Strip ANSI escapes (busybox colourises ls and friends) before parsing, so
  // the model gets clean text rather than terminal control codes.
  // eslint-disable-next-line no-control-regex
  const ansi = /\u001b\[[0-9;]*m/g;
  const segment = serialBuffer.slice(start).replace(ansi, "");
  const m = segment.match(marker)!;
  const code = parseInt(m[1], 10);

  // Everything up to the real marker, minus the two echoed input lines.
  const body = segment.slice(0, segment.indexOf(m[0]));
  const lines = body.split(/\r?\n/);
  const cleaned = lines
    .filter((l) => l.trim() !== oneLine.trim())
    .filter((l) => !l.includes('echo "__HSX_$?_END__"'))
    .filter((l) => l.trim() !== RUN_PROMPT && l.trim() !== PROMPT.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

  // Bring anything the command wrote back into OPFS so the file tools see it.
  await pullWorkspace(em);

  return { stdout: cleaned + (cleaned ? "\n" : ""), stderr: "", code };
}

/** Tear the VM down (used on teardown or to reclaim memory). */
export function shutdownVM(): void {
  emulator?.destroy?.();
  emulator = null;
  booting = null;
  serialBuffer = "";
  watchers.length = 0;
}

// --- routing -----------------------------------------------------------------

const VM_FLAG = "hs-web-vm";

/** Whether the user has opted into the real-Linux terminal. Default off. */
export function vmEnabled(): boolean {
  return localStorage.getItem(VM_FLAG) === "1";
}

export function setVmEnabled(on: boolean): void {
  localStorage.setItem(VM_FLAG, on ? "1" : "0");
}

/**
 * run_command routes here. With the VM enabled it runs the command in real
 * Linux; if the VM is off — or fails to boot — it falls back to the instant
 * coreutils shell, so the terminal always works and the download/boot cost is
 * only paid by users who ask for it.
 */
registerCommand("run_command", async (args) => {
  const { command, cwd } = (args ?? {}) as { command: string; cwd?: string };
  if (vmEnabled()) {
    try {
      return await vmRunCommand(String(command ?? ""), String(cwd ?? ""));
    } catch (e) {
      return {
        stdout: "",
        stderr: `real-Linux terminal unavailable (${(e as Error).message}); using the built-in shell`,
        code: 127,
      };
    }
  }
  return shellRun(String(command ?? ""), String(cwd ?? ""));
});

