# HarnessStation UI Kit — how to build with it

A **dark-first** React design system extracted from the HarnessStation desktop app.
Every component is exported from `window.HarnessStationUI`. The whole system is themed
with CSS custom properties (tokens) — there is **no theme provider and no wrapper
component to mount**; the tokens live on `:root` and default to the dark theme.

## Setup — put content on the app surface

Components use light text (`var(--text)`) designed for a dark background. Render your
app content on the app surface, or text and transparent overlays will be invisible:

```jsx
<div style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
  <Button variant="primary">New chat</Button>
</div>
```

The light theme is available by setting `data-theme="light"` on a wrapping element (or
`<html>`); with no attribute the dark theme applies. Full-screen states
(`Splash`, `ClosingOverlay`, `ViewLoading`) and overlays (`Dialog`, `ContextMenu`,
`Toaster`) are `position: fixed` and paint their own surface — render them over app content.

## Styling idiom — tokens + a small class vocabulary

Style with the design tokens, never hard-coded colors. Real token names (see `styles.css`):

- **Surfaces:** `--bg` (app), `--bg-2` (raised panels/cards), `--bg-3` (inputs/hover), `--bg-glass`
- **Text:** `--text` (primary), `--text-dim` (secondary/muted)
- **Brand & status:** `--accent`, `--accent-2`, `--ok`, `--warn`, `--danger`
- **Lines:** `--border`, `--border-strong`
- **Radius:** `--radius` (12px), `--radius-sm` (8px)
- **Motion:** `--t-fast` / `--t-base` / `--t-slow` with `--ease` / `--ease-pop`

The only global class family is the button: `className="btn"` (default), plus modifiers
`btn primary`, `btn danger`, `btn ghost`, and `btn small` — but prefer the `<Button>`
component (`variant="default|primary|danger|ghost"`, `size="small"`). All other components
are styled internally; you pass **props**, not classes.

## Icons

27 stroke icons ship in the bundle (importable, not shown as cards): `IconPlus`,
`IconChevron`, `IconX`, `IconSearch`, `IconChat`, `IconCompass`, `IconBox`, `IconChart`,
`IconWrench`, `IconFlow`, `IconPlug`, `IconGear`, `IconDots`, `IconCloud`, `IconBolt`,
`IconColumns`, `IconBook`, `IconBell`, `IconSpeaker`, `IconGrid`, `IconClock`, `IconAgent`,
`IconHeart`, `IconDownload`, `IconUpload`, `IconPencil`, `IconPanelLeft`/`IconPanelRight`.
Each takes `size?: number` and paints in `currentColor`. `LogoMark` is the brand mark.

## Where the truth lives

Read `styles.css` (it `@import`s `_ds_bundle.css` for component styles and `fonts/inter.css`
for the **Inter** UI font) and each component's `<Name>.d.ts` (the props contract) and
`<Name>.prompt.md` before composing.

## Idiomatic example

```jsx
const { EmptyState, Button, IconCompass } = window.HarnessStationUI;

<div style={{ background: "var(--bg)", color: "var(--text)", padding: 24 }}>
  <EmptyState
    icon={<IconCompass size={28} />}
    title="No agents yet"
    hint="Create your first agent to automate tasks with your models."
    action={{ label: "Create agent", onClick: createAgent }}
  />
</div>
```
