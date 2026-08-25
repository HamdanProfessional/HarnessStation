/**
 * The sidebar, written out by hand.
 *
 * Order is the whole point of documentation navigation, and no filename scheme
 * survives contact with it — `01-`, `02-` prefixes leak into URLs and have to be
 * renumbered every time something is inserted. An explicit list costs one line
 * per page and reads as the table of contents it is.
 *
 * A slug here with no matching file under `content/` is caught by a test rather
 * than becoming a dead link.
 */

export interface NavItem {
  slug: string;
  /** Overrides the page's own title in the sidebar, where a shorter one reads better. */
  label?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Getting started",
    items: [
      { slug: "index", label: "What this is" },
      // Deliberately above Install: opening a tab is the fastest way to try the
      // app, and filing it under "Advanced" buried the one thing nothing else
      // in this category does.
      { slug: "advanced/web", label: "Try it without installing" },
      { slug: "start/install", label: "Install" },
      { slug: "start/first-chat", label: "Your first chat" },
      { slug: "start/tour", label: "A tour of the app" },
    ],
  },
  {
    title: "Use cases",
    items: [
      { slug: "use-cases/overview", label: "Overview" },
      { slug: "use-cases/codebase", label: "Working with a codebase" },
      { slug: "use-cases/research", label: "Researching a topic" },
      { slug: "use-cases/recurring-report", label: "A recurring report" },
      { slug: "use-cases/documents", label: "Working through documents" },
      { slug: "use-cases/scraping", label: "Pulling data off websites" },
      { slug: "use-cases/support-assistant", label: "A business assistant" },
      { slug: "use-cases/hands-free", label: "Hands-free work" },
    ],
  },
  {
    title: "Understanding it",
    items: [
      { slug: "concepts/how-it-works", label: "How it works" },
      { slug: "concepts/prompting", label: "Getting better results" },
      { slug: "concepts/cost", label: "Controlling cost" },
    ],
  },
  {
    title: "Conversations",
    items: [
      { slug: "guide/chats", label: "Chats" },
      { slug: "guide/projects", label: "Projects" },
      { slug: "guide/memory", label: "Memory" },
      { slug: "guide/knowledge", label: "Knowledge" },
    ],
  },
  {
    title: "Giving it abilities",
    items: [
      { slug: "guide/tools", label: "Tools" },
      { slug: "guide/secrets", label: "Secrets" },
      { slug: "guide/browser", label: "Browser control" },
      { slug: "guide/mcp", label: "MCP servers" },
      { slug: "guide/skills", label: "Skills" },
      { slug: "guide/media", label: "Images & media" },
      { slug: "guide/community", label: "Community library" },
    ],
  },
  {
    title: "Automation",
    items: [
      { slug: "guide/agents", label: "Agents" },
      { slug: "guide/workflows", label: "Workflows" },
      { slug: "guide/schedules", label: "Schedules" },
      { slug: "guide/hooks", label: "Hooks & guardrails" },
      { slug: "guide/channels", label: "Channels (Telegram & Discord)" },
    ],
  },
  {
    title: "Voice",
    items: [
      { slug: "voice/talking", label: "Talking to it" },
      { slug: "voice/engines", label: "Voice engines" },
      { slug: "voice/avatars", label: "Avatars" },
    ],
  },
  {
    title: "Models",
    items: [
      { slug: "models/providers", label: "Providers & keys" },
      { slug: "models/local-api", label: "Use it from other tools" },
      { slug: "models/local", label: "Running models locally" },
      { slug: "models/in-browser", label: "In-browser models" },
      { slug: "models/comparing", label: "Comparing & evaluating" },
    ],
  },
  {
    title: "Advanced",
    items: [
      { slug: "advanced/cloud-sync", label: "Cloud sync" },
      { slug: "advanced/devices", label: "Device mesh" },
      { slug: "advanced/data", label: "Where your data lives" },
      { slug: "advanced/privacy", label: "Privacy & security" },
    ],
  },
  {
    title: "Reference",
    items: [
      { slug: "reference/shortcuts", label: "Keyboard shortcuts" },
      { slug: "reference/settings", label: "Settings reference" },
      { slug: "reference/troubleshooting", label: "Troubleshooting" },
      { slug: "reference/faq", label: "FAQ" },
    ],
  },
];

/** Every slug the sidebar links to, in reading order. Drives prev/next. */
export const NAV_ORDER: string[] = NAV.flatMap((s) => s.items.map((i) => i.slug));

export function neighbours(slug: string): { prev?: NavItem; next?: NavItem } {
  const all = NAV.flatMap((s) => s.items);
  const at = all.findIndex((i) => i.slug === slug);
  if (at === -1) return {};
  return { prev: all[at - 1], next: all[at + 1] };
}
