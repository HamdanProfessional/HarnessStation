#!/usr/bin/env node
/**
 * stdio transport for the media MCP server — all protocol plumbing, no logic.
 * See lib.mjs for config, tools and engines.
 *
 * stdout carries only JSON-RPC lines; anything human goes to stderr.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { handleRequest, loadConfig } from "./lib.mjs";

const configPath = process.env.MEDIA_CONFIG;
if (!configPath) {
  console.error("MEDIA_CONFIG is not set — point it at a config file or your HarnessStation settings.json");
  process.exit(2);
}

let config;
try {
  config = loadConfig(readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(`Could not load MEDIA_CONFIG (${configPath}): ${e.message}`);
  process.exit(2);
}

const ctx = { config, fetchImpl: fetch, envKey: process.env.MEDIA_API_KEY ?? "" };
const out = process.stdout;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // a malformed line is skipped, not fatal
  }
  void handleRequest(msg, ctx).then((reply) => {
    if (reply) out.write(`${JSON.stringify(reply)}\n`);
  });
});
rl.on("close", () => process.exit(0));
