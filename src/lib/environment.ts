/**
 * The facts about *right now* that a model cannot know and will otherwise guess.
 *
 * Without this block a model answers date questions from its training cutoff,
 * has no idea which shell `run_terminal` will hand its command to, and cannot
 * say which model it is when asked. All three are things users hit in the first
 * few minutes, and all three cost one line of prompt to fix.
 *
 * It is also why `get_current_time` exists as a tool: a whole round-trip to
 * learn something that belongs in the system prompt. That tool stays — a long
 * conversation outlives the timestamp captured when it started — but it should
 * no longer be the only way to learn the date.
 */

export interface EnvironmentFacts {
  /** Resolved OS, from lib/platform. "unknown" is omitted rather than guessed. */
  os: "windows" | "linux" | "macos" | "unknown";
  /** The chat's working directory, if it has one (desktop only). */
  workingDir?: string;
  /** Model id this turn will be sent to. */
  model?: string;
  /** Display name of the provider serving it. */
  providerName?: string;
  /** Injected so the output is deterministic in tests. */
  now: Date;
  /** The browser build has no shell and no filesystem; saying so avoids offers it can't honour. */
  web?: boolean;
}

/** The shell `run_terminal` actually invokes, which the model would otherwise assume. */
function shellFor(os: EnvironmentFacts["os"]): string | null {
  if (os === "windows") return "PowerShell";
  if (os === "linux" || os === "macos") return "bash";
  return null;
}

const OS_LABEL: Record<EnvironmentFacts["os"], string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  unknown: "unknown",
};

/**
 * Render the block, or "" when there is nothing worth saying.
 *
 * Every line is omitted rather than filled with a placeholder: "Working
 * directory: unknown" is worse than silence, because a model treats a stated
 * fact as usable and an absent one as something to ask about.
 */
export function environmentNote(f: EnvironmentFacts): string {
  const lines: string[] = [];

  // ISO date, not a locale string — unambiguous across every reader, and the
  // weekday is genuinely useful for "what did I do on Monday" style questions.
  const iso = f.now.toISOString().slice(0, 10);
  const weekday = f.now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  lines.push(`  Today's date: ${iso} (${weekday}, UTC)`);

  if (f.os !== "unknown") {
    const shell = shellFor(f.os);
    lines.push(`  Platform: ${OS_LABEL[f.os]}${shell ? ` (run_terminal uses ${shell})` : ""}`);
  }

  if (f.web) {
    lines.push("  Build: browser — no shell and no local filesystem");
  } else if (f.workingDir) {
    lines.push(`  Working directory: ${f.workingDir}`);
  }

  if (f.model) {
    lines.push(
      `  You are powered by the model ${f.model}${f.providerName ? ` via ${f.providerName}` : ""}`,
    );
  }

  if (lines.length === 0) return "";
  return ["Here is some useful information about the environment you are running in:", "<env>", ...lines, "</env>"].join(
    "\n",
  );
}
