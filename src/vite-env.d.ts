/// <reference types="vite/client" />

// Minimal surface of @babel/standalone — it ships no types of its own and the
// app only transforms JSX/TSX for canvas artifacts.
declare module "@babel/standalone" {
  export interface BabelTransformOptions {
    filename?: string;
    sourceType?: "script" | "module" | "unambiguous";
    presets?: (string | [string, Record<string, unknown>?])[] | null;
    plugins?: (string | [string, Record<string, unknown>?])[] | null;
    compact?: boolean | "auto";
  }
  export const availablePlugins: Record<string, unknown>;
  export function transform(code: string, options: BabelTransformOptions): { code: string | null | undefined };
}
