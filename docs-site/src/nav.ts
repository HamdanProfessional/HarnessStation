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
      { slug: "start/install", label: "Install" },
      { slug: "start/first-chat", label: "Your first chat" },
      { slug: "start/tour", label: "A tour of the app" },
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
      { slug: "guide/browser", label: "Browser control" },
      { slug: "guide/mcp", label: "MCP servers" },
      { slug: "guide/skills", label: "Skills" },
      { slug: "guide/media", label: "Images & media" },
    ],
  },
  {
    title: "Automation",
    items: [
      { slug: "guide/agents", label: "Agents" },
      { slug: "guide/workflows", label: "Workflows" },
      { slug: "guide/schedules", label: "Schedules" },
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
      { slug: "models/local", label: "Running models locally" },
      { slug: "models/comparing", label: "Comparing & evaluating" },
    ],
  },
  {
    title: "Advanced",
    items: [
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
