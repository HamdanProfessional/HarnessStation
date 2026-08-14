import { lazy } from "react";
import type { ComponentType } from "react";
import type { View } from "./store";
import {
  IconCompass,
  IconBox,
  IconColumns,
  IconGrid,
  IconChart,
  IconAgent,
  IconBook,
  IconWrench,
  IconFlow,
  IconClock,
  IconPlug,
} from "../components/icons";

/**
 * Single source of truth for the app's views: what renders for each `view` id,
 * plus the sidebar-nav metadata (label, icon, section). App.tsx and Sidebar.tsx
 * both map over this list, so a view is added/removed/regrouped — or toggled off
 * by a profile — in one place instead of two hardcoded ladders.
 *
 * The `chat` view is intentionally NOT here: it's the default surface (ChatWindow
 * + SidePanel + ConfigPanel), rendered as the fallback in App.tsx.
 */

type IconCmp = (props: { size?: number }) => React.ReactElement;

export type NavSection = "library" | "automation";

export interface ViewDef {
  /** The `view` id in the store (excludes the default "chat" surface). */
  id: Exclude<View, "chat">;
  /** Display name (nav label + basis for the loading label). */
  label: string;
  /** Shown while the lazy chunk loads ("Opening …"). */
  loadLabel?: string;
  /** The lazy-loaded view component. */
  Component: ComponentType;
  /** Sidebar icon. Omit → the view exists but has no nav entry (e.g. settings, voice). */
  Icon?: IconCmp;
  /** Sidebar group. Omit → not shown in the sidebar nav. */
  section?: NavSection;
}

// Defer the dynamic import behind a thunk so each view's chunk is fetched on
// first open, not eagerly at module load.
const L = (loader: () => Promise<Record<string, unknown>>, key: string) =>
  lazy(() => loader().then((m) => ({ default: m[key] as ComponentType })));

export const VIEWS: ViewDef[] = [
  // ---- Library ----
  { id: "discover", label: "Discover", loadLabel: "Opening Discover…", section: "library", Icon: IconCompass, Component: L(() => import("../components/DiscoverView"), "DiscoverView") },
  { id: "models", label: "My Models", loadLabel: "Loading your models…", section: "library", Icon: IconBox, Component: L(() => import("../components/ModelsView"), "ModelsView") },
  { id: "compare", label: "Compare", loadLabel: "Opening Compare…", section: "library", Icon: IconColumns, Component: L(() => import("../components/CompareView"), "CompareView") },
  { id: "evals", label: "Evals", loadLabel: "Loading evals…", section: "library", Icon: IconGrid, Component: L(() => import("../components/EvalsView"), "EvalsView") },
  { id: "benchmarks", label: "Benchmarks", loadLabel: "Loading benchmarks…", section: "library", Icon: IconChart, Component: L(() => import("../components/BenchmarksView"), "BenchmarksView") },

  // ---- Automation ----
  { id: "agents", label: "Agents", loadLabel: "Loading agents…", section: "automation", Icon: IconAgent, Component: L(() => import("../components/AgentsView"), "AgentsView") },
  { id: "skills", label: "Skills", loadLabel: "Loading skills…", section: "automation", Icon: IconBook, Component: L(() => import("../components/SkillsView"), "SkillsView") },
  { id: "knowledge", label: "Knowledge", loadLabel: "Loading knowledge bases…", section: "automation", Icon: IconBook, Component: L(() => import("../components/KnowledgeView"), "KnowledgeView") },
  { id: "tools", label: "Tools", loadLabel: "Loading tools…", section: "automation", Icon: IconWrench, Component: L(() => import("../components/ToolsView"), "ToolsView") },
  { id: "workflows", label: "Workflows", loadLabel: "Loading workflows…", section: "automation", Icon: IconFlow, Component: L(() => import("../components/WorkflowsView"), "WorkflowsView") },
  { id: "schedules", label: "Schedules", loadLabel: "Loading schedules…", section: "automation", Icon: IconClock, Component: L(() => import("../components/SchedulesView"), "SchedulesView") },
  { id: "mcp", label: "MCP Servers", loadLabel: "Loading MCP servers…", section: "automation", Icon: IconPlug, Component: L(() => import("../components/McpView"), "McpView") },
  { id: "community", label: "Community", loadLabel: "Opening the community library…", section: "automation", Icon: IconGrid, Component: L(() => import("../components/CommunityView"), "CommunityView") },

  // ---- Reachable but not in the sidebar nav ----
  { id: "settings", label: "Settings", loadLabel: "Opening settings…", Component: L(() => import("../components/SettingsView"), "SettingsView") },
  { id: "voice", label: "Voice", loadLabel: "Opening the voice avatar…", Component: L(() => import("../components/VoiceView"), "VoiceView") },
  { id: "browser", label: "Browser", loadLabel: "Opening browser control…", Component: L(() => import("../components/BrowserView"), "BrowserView") },
];

export const VIEW_BY_ID: Record<string, ViewDef> = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

/** Views that carry a sidebar-nav entry (have both a section and an icon). */
export const NAV_VIEWS = VIEWS.filter((v) => v.section && v.Icon);
