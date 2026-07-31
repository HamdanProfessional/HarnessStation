import type { Chat, Settings, StylePreset } from "./types";

export const STYLE_PRESETS: StylePreset[] = [
  { id: "normal", name: "Normal", snippet: "" },
  {
    id: "concise",
    name: "Concise",
    snippet:
      "Keep responses short and direct. Skip preamble, caveats, and summaries unless essential.",
  },
  {
    id: "explanatory",
    name: "Explanatory",
    snippet:
      "Give detailed, educational responses. Explain reasoning, define terms, and use examples.",
  },
  {
    id: "formal",
    name: "Formal",
    snippet:
      "Use a polished, professional, business-appropriate tone. Avoid slang and casual phrasing.",
  },
];

/** Compose global instructions + style preset + per-chat prompt into one system message. */
export function composeSystemPrompt(settings: Settings, chat: Chat): string {
  const parts: string[] = [];
  if (settings.globalInstructions.trim()) parts.push(settings.globalInstructions.trim());
  const style = STYLE_PRESETS.find((s) => s.id === chat.styleId);
  if (style?.snippet) parts.push(style.snippet);
  if (chat.systemPrompt.trim()) parts.push(chat.systemPrompt.trim());
  return parts.join("\n\n");
}
