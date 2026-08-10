# design-sync notes — @harnessstation/ui-kit

The synced "design system" is a **hand-extracted UI kit** (`packages/ui-kit/`) carved out of
the HarnessStation Tauri app. The app itself is not a component library; these primitives were
decoupled from the app's Zustand stores (`src/lib/dialog`, `src/lib/toast`) and Tauri APIs so
they render standalone in the design canvas.

## Build facts
- **Shape:** package. No dist build — the converter bundles directly from `packages/ui-kit/src/index.ts`
  (`--entry ./packages/ui-kit/src/index.ts`), esbuild handling the TS/TSX. `.d.ts` props come from
  ts-morph over the source.
- **node_modules:** repo root (`./node_modules`) — where react/react-dom/react-markdown resolve.
- **Playwright:** render check pinned to `playwright@1.60.0` (chromium build 1223, already in the
  local `ms-playwright` cache — do NOT bump to latest or it re-downloads chromium 1234).
- **Icons:** the 27 `Icon*` exports are excluded as component cards via `componentSrcMap: null`
  (keeps the picker to the 12 real primitives) but remain importable from `window.HarnessStationUI`
  and should be enumerated in the conventions header.

## Fonts
- **Inter** is bundled (`packages/ui-kit/fonts/inter.css` + 4 latin woff2, SIL OFL) via `cfg.extraFonts`.
  The app only *prefers* Inter (`"Inter", "Segoe UI Variable Text", …`) and relies on the OS copy;
  bundling it makes designs render on-brand in the browser. Weights: 400/500/600/700, latin subset only.
- **Cascadia Code** (code blocks in Markdown) is treated as host-provided via
  `cfg.runtimeFontPrefixes: ["Cascadia"]` — Windows serves it; code falls back to system mono elsewhere.

## Known render warns
- None. Final render check: 12/12 clean, 0 bad / 0 thin / 0 variantsIdentical.

## Preview authoring conventions (why the wrappers exist)
- This is a **dark-first** DS (text is `var(--text)`, light). Design-canvas cards render on
  WHITE by default, so any text-on-transparent or full-screen/overlay component was invisible
  or washed out. Fix: previews for `Splash`, `ClosingOverlay`, `ViewLoading`, `Dialog`,
  `Toaster`, `Markdown`, `Spinner`, `LogoMark` wrap their content in a
  `background: var(--bg)` surface. Self-surfaced components (`Toast`, `ContextMenu`,
  `EmptyState`, `Button`) don't need it. Keep this when editing previews.
- Overlays/fixed-position components use `cfg.overrides.<Name>: {cardMode:"single", viewport:"WxH"}`
  (Dialog, ContextMenu, ClosingOverlay, Splash, ViewLoading, Toaster) so the open/fixed state
  renders inside the card.

## Re-sync risks
- The kit is a manual extraction, NOT generated from the app. If the app's real components or
  `App.css` tokens change, `packages/ui-kit/` does NOT auto-update — the extraction must be
  re-done by hand. Token values in `packages/ui-kit/styles.css` were copied from `src/App.css`
  (dark/light theme blocks) at extraction time and can drift.
- Inter woff2 files are latin-subset only; non-latin glyphs fall back.
