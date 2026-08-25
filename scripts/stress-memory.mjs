#!/usr/bin/env node
/**
 * Memory soak + live RSS sampler.
 *
 *   node scripts/stress-memory.mjs        (or: npm run stress)
 *
 * Part 1 runs tests/memorySoak.test.ts with STRESS=1: thousands of stub chats,
 * one 20k-message hydration, RSS growth printed and bounded. That is the
 * store-layer footprint, measured rather than assumed.
 *
 * Part 2 samples the running app's own RSS, the way the before/after
 * screenshots do (`ps -o rss= -p $PPID`). It is best-effort and read-only:
 * if no HarnessStation process is running it says so and exits 0 — the soak
 * above already carried the verdict. Sample a few times so a single noisy
 * reading can't mislead; report the min/last so GC dips are visible.
 */
import { spawnSync } from "node:child_process";

const soak = spawnSync("npx", ["vitest", "run", "tests/memorySoak.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, STRESS: "1" },
});
if (soak.status !== 0) process.exit(soak.status ?? 1);

const NAMES = ["harnessstation", "HarnessStation", "harnessstation-dev"];
const isWin = process.platform === "win32";
if (!isWin) {
  console.log("[rss] live sampling is Windows-only right now — skipping.");
  process.exit(0);
}

const script = `
$names = @(${NAMES.map((n) => `'${n}'`).join(",")})
$procs = Get-Process -Name $names -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output "NONE"; exit }
$procs | ForEach-Object {
  "{0}`t{1}`t{2}" -f $_.Id, $_.ProcessName, [math]::Round($_.WorkingSet64 / 1MB, 1)
}`;
console.log("\n[rss] sampling the running app (5 reads, 500 ms apart):\n");
const samples = new Map();
for (let i = 0; i < 5; i++) {
  const out = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", shell: true });
  const lines = (out.stdout ?? "").split(/\r?\n/).filter((l) => l && !l.startsWith("NONE"));
  if (!lines.length) {
    console.log("[rss] no HarnessStation process found — start the app to sample it live.");
    process.exit(0);
  }
  for (const line of lines) {
    const [id, name, mbStr] = line.split("\t");
    const mb = Number(mbStr);
    if (!samples.has(id)) samples.set(id, { name, readings: [] });
    samples.get(id).readings.push(mb);
  }
  await new Promise((r) => setTimeout(r, 500));
}
for (const [{ name, readings }, id] of [...samples].map(([id, v]) => [v, id])) {
  const min = Math.min(...readings).toFixed(1);
  const last = readings[readings.length - 1].toFixed(1);
  console.log(`[rss] pid ${id} (${name}): min ${min} MB, last ${last} MB over ${readings.length} samples`);
}
