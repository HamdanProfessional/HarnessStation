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
 * is headless (serial only) and has its own in-memory filesystem — sharing it
 * with the OPFS workspace is the next step and isn't wired here yet.
 *
 * This module boots and runs commands; it does not yet override run_command, so
 * the tested coreutils shell stays the default until the VM is proven in the UI.
 */

/** Where the boot assets are served from (web/public/vm → /vm at runtime). */
const VM_BASE = "/vm";

/** BusyBox's default prompt. Boot is complete once we see it. */
const PROMPT = "~% ";

const BOOT_TIMEOUT_MS = 40_000;
const COMMAND_TIMEOUT_MS = 30_000;

interface Emulator {
  add_listener: (event: string, fn: (byte: number) => void) => void;
  serial0_send: (text: string) => void;
  destroy?: () => void;
}

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
      // 9p filesystem — empty for now; this is the hook the OPFS workspace will
      // mount into so the file tools and the VM share files.
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
    // Quiet the shell's own noise so command output is clean to parse.
    em.serial0_send("export PS1='~% '\n");
    emulator = em;
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
 * Run one shell command in the VM and return its output and exit code.
 *
 * The console echoes back what we type and merges stdout with stderr, so the
 * output has to be fished out precisely. The trick: wrap the command with a
 * marker that carries the exit code — `echo __HSX_$?_END__`. In the *echoed*
 * input line `$?` appears literally (`__HSX_$?_END__`); in the *executed* output
 * it's expanded to a number (`__HSX_0_END__`). Matching the numeric form finds
 * the real marker and never the echo.
 */
export async function vmRunCommand(command: string): Promise<CommandResult> {
  const em = await bootVM();

  // One line: newlines would each get their own echo and prompt.
  const oneLine = command.replace(/\r?\n/g, "; ");
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
    .filter((l) => l.trim() !== PROMPT.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

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
