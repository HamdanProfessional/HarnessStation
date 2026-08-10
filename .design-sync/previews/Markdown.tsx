import type { ReactNode } from "react";
import { Markdown } from "@harnessstation/ui-kit";

/** Markdown renders chat/agent output on the app's dark surface. */
const Surface = ({ children }: { children: ReactNode }) => (
  <div style={{ background: "var(--bg)", borderRadius: 8, padding: 20 }}>{children}</div>
);

const ARTICLE = `# Getting started

HarnessStation runs your models **locally** or through any OpenAI-compatible API.
You can mix providers in a single chat and compare their answers side by side.

## Key ideas

- **Agents** wrap a model with instructions and tools.
- **Knowledge sources** ground answers in your own documents.
- **Media models** generate images, speech, and video from a prompt.

> Everything is stored under \`~/.harnessx\` — plain JSON you can back up or sync.

See the [documentation](https://example.com) for the full provider catalog.`;

const CODE = `Call a tool from an agent loop:

\`\`\`ts
const res = await runTool("web_search", { query: "opus 4.8 release notes" });
console.log(res.results[0].title);
\`\`\`

Inline code like \`generate_image\` is highlighted too.`;

const TABLE = `| Provider | Type | Streaming |
| --- | --- | --- |
| z.ai | Flat-rate plan | Yes |
| MiniMax | Pay-as-you-go | Yes |
| Ollama | Local | Yes |`;

export const Article = () => <Surface><Markdown>{ARTICLE}</Markdown></Surface>;
export const WithCode = () => <Surface><Markdown>{CODE}</Markdown></Surface>;
export const WithTable = () => <Surface><Markdown>{TABLE}</Markdown></Surface>;
