/**
 * The agent-driven side panel: auxiliary content that stays on screen while the
 * agent works, instead of being buried in scrollback. A file shown here is polled
 * so it updates live as the agent edits it.
 */
import { create } from "zustand";

export interface SidePanelState {
  open: boolean;
  title: string;
  mode: "markdown" | "code" | "diff";
  content: string;
  /** Path being followed live, relative to the chat's working folder. */
  file: string;
  updatedAt: number;
  show: (p: Partial<Omit<SidePanelState, "show" | "close">>) => void;
  close: () => void;
}

export const useSidePanel = create<SidePanelState>((set) => ({
  open: false,
  title: "",
  mode: "markdown",
  content: "",
  file: "",
  updatedAt: 0,
  show: (p) => set({ ...p, open: true, updatedAt: Date.now() }),
  close: () => set({ open: false, file: "", content: "" }),
}));

/** Read a file through the same backend the file tools use. */
export async function readPanelFile(file: string, cwd: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("fs_read", { base: cwd, path: file });
}

/** Tool entry point for `side_panel`. */
export async function setSidePanel(
  args: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  if (args.clear) {
    useSidePanel.getState().close();
    return "Side panel closed.";
  }
  const file = String(args.file ?? "").trim();
  const title = String(args.title ?? "").trim() || file || "Side panel";
  const mode = (String(args.mode ?? "") || (file ? "code" : "markdown")) as SidePanelState["mode"];

  if (file) {
    try {
      const content = await readPanelFile(file, cwd);
      useSidePanel.getState().show({ title, mode, file, content });
      return `Showing ${file} in the side panel — it refreshes as the file changes.`;
    } catch (e) {
      return `Could not read ${file}: ${(e as Error).message || String(e)}`;
    }
  }

  const content = String(args.content ?? "").trim();
  if (!content) return "Nothing to show — pass content or a file.";
  useSidePanel.getState().show({ title, mode, file: "", content });
  return "Shown in the side panel.";
}
