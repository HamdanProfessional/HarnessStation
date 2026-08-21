/**
 * The instructions every chat gets before anything the user configured.
 *
 * Until now `composeSystemPrompt` was global instructions + a style snippet +
 * the per-chat prompt, and all three are empty by default — so out of the box
 * the model received no system prompt at all. Every behaviour worth stating
 * (how to use the tools, whether to call them in parallel, whether to agree
 * with the user) was left to whatever the model happened to do.
 *
 * Deliberately general. `agentPresets.ts` already carries detailed
 * domain instructions per agent, and styles carry tone; this must not fight
 * either. It states only what is true of every chat in this app.
 *
 * Sections are conditional on context rather than always emitted. Telling a
 * chat with no tools how to call tools in parallel is tokens spent on advice
 * it cannot take, and it makes the model likelier to invent a tool it has not
 * been given.
 */

export interface BasePromptContext {
  /** How many tools this turn actually has. Zero drops the tool sections. */
  toolCount: number;
  /** Whether a shell tool is enabled — the "prefer the specific tool" advice needs one. */
  hasShell: boolean;
  /** Whether the chat can reach the filesystem (desktop with a working directory). */
  hasFiles: boolean;
}

const IDENTITY = `You are the assistant in HarnessStation, a local-first AI chat app running on the user's own machine. Your replies are rendered as GitHub-flavored markdown.`;

const TONE = `# Tone
- Be direct. Answer the question asked, then stop. Skip preamble ("Great question!"), and skip a closing summary of what you just said.
- Only use emoji if the user uses them first or asks for them.
- Match the user's level of detail. A one-line question wants a one-line answer.`;

// Lifted in substance from opencode's prompts, which lift it in turn from the
// published assistant guidelines. The point is worth stating in any app where
// the model is being asked for an opinion.
const OBJECTIVITY = `# Objectivity
Prioritise being right over being agreeable. Give the user your actual assessment, including when it is not what they hoped: say when an approach has a problem, when a claim is wrong, and when you are unsure. Agreement you do not mean is worth nothing to them. When you do not know, investigate or say so rather than producing something plausible.`;

const NO_INVENTED_URLS = `Never invent a URL. Use ones the user gave you, ones a tool returned, or none at all — a fabricated link costs the user a click to discover it is fake.`;

const CODE_REFS = `When you point at code, write it as \`path/to/file.ts:42\` so the user can jump straight there.`;

function toolPolicy(ctx: BasePromptContext): string {
  const lines = [
    "# Using tools",
    "- You can call several tools in one response. When the calls do not depend on each other, make them together rather than one per turn. When one needs the result of another, do them in order.",
    "- Never guess a required argument. If you do not have it, ask or use a tool to find it.",
    "- Tools are for doing things, not for talking. Everything you want the user to read goes in your reply text.",
  ];
  if (ctx.hasShell && ctx.hasFiles) {
    // Both exist, so the model has a genuine choice to make and will otherwise
    // reach for the shell out of habit.
    lines.push(
      "- Prefer the specific tool over the shell: `read_file` rather than `cat`, `edit_file` rather than `sed`, `find_files` and `grep_files` rather than `dir` or `find`. Keep `run_terminal` for things that genuinely need a shell — builds, tests, git.",
    );
  }
  return lines.join("\n");
}

/** Build the base prompt. Returns "" only if there is genuinely nothing to say. */
export function basePrompt(ctx: BasePromptContext): string {
  const parts = [IDENTITY, TONE, OBJECTIVITY];
  if (ctx.toolCount > 0) parts.push(toolPolicy(ctx));

  const notes = [NO_INVENTED_URLS];
  if (ctx.hasFiles) notes.push(CODE_REFS);
  parts.push(`# Also\n- ${notes.join("\n- ")}`);

  return parts.join("\n\n");
}
