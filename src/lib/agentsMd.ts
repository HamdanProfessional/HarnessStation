import { invoke } from "@tauri-apps/api/core";
import { isWeb } from "./web";

/**
 * AGENTS.md support — the cross-tool convention (Codex, Cursor, Aider and others
 * honour it) for putting project-specific instructions in a file the agent reads
 * automatically. We load the file sitting in the chat's working directory and
 * fold it into the system prompt, so a repo can steer the model without the user
 * restating its conventions every chat.
 *
 * Desktop only: it reads a real path via the fs_read command, which resolves
 * relative to the working directory (`base`). The web build has no working
 * directory on the real filesystem, so it's a no-op there.
 */
const NAMES = ["AGENTS.md", "AGENT.md", "CLAUDE.md"];
const MAX = 8000;

/** Read the working directory's agent-instructions file, or "" if none/desktop-only. */
export async function loadAgentsMd(workingDir: string | undefined): Promise<string> {
  if (isWeb() || !workingDir) return "";
  for (const name of NAMES) {
    try {
      const text = await invoke<string>("fs_read", { base: workingDir, path: name });
      const trimmed = (text ?? "").trim();
      if (trimmed) {
        const body = trimmed.length > MAX ? `${trimmed.slice(0, MAX)}\n…[truncated]` : trimmed;
        return `Project instructions from ${name} (in the working directory):\n\n${body}`;
      }
    } catch {
      /* not found / unreadable — try the next name */
    }
  }
  return "";
}
