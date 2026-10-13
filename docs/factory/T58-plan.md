# T58 — Dev Mode: developer handoff for pixel-accurate builds

Status: discover, concept, design and plan in one document. No code. Written against `model/html.ts` (`computeNodeStyle`, `nodeToHtml`, `nodeToJsx`), `bridge/{tailwind,measure,tools-read,tools-render,jsx-components}.ts`, `editor/inspector/{Inspector,TopBar,exporting}.tsx`, `editor/canvas/{Overlay,actions,menus}.tsx`, `editor/shortcuts.ts`, `model/types.ts`.

Input note: the task text was a title only. Scope below is my reading of "developer handoff for pixel-accurate builds" plus what the code already has. Assumptions are listed under "Decisions to approve".

## 1. Discover: what a developer can get today

| Need | What exists | Gap |
|---|---|---|
| Exact box (x, y, W, H) | Inspector LayoutSection shows the *authored* values; for Fit/Fill it shows "Fit"/"Fill" or a measured number (`dimLabel` in Overlay). `bridge/measure.ts` renders any artboard offscreen and reads real DOM rects, so Fit/Fill/flex results are exact. | Inspector is an editor, not a spec. Position is world coordinates, not relative to parent or artboard. Nothing says "this is 347.5 × 52 after layout". |
| CSS values | "Copy as CSS" (`copyAs 'css'`) = `styleToCss(node.style)`: authored properties only, no resolved layout, no inherited typography, tokens left as `var()`. MCP `get_computed_styles` adds inherited text keys and top-level position. | No single view showing authored → resolved, with token names and per-mode values side by side. |
| Code | Copy as HTML / JSX / React / Tailwind / CSS, MCP `get_jsx` (tailwind or inline), instance output via `jsx-components.ts`. Share → Copy HTML. | Only via right-click, shortcuts or MCP. Not visible while inspecting. Canvas "Copy as React / Tailwind" ignores components (documented in COMPONENTS.md). |
| Spacing / redlines | Padding and gap handles (edit only, Move tool). Alt held during resize/duplicate only. | No read-only distance display between a selected node and its parent or sibling, which is the core of a handoff. |
| Tokens | `Doc.tokens` with per-mode values, `ModeSection` (`data-mode`). Colour and text styles as named bundles. | Inspector shows a style's name only inside its editing control; no "this node uses `--color-primary` = `#3b82f6` (Dark: `#60a5fa`)". |
| Assets | Export section: PNG/JPG/WebP (scale), SVG, HTML, PDF per node; MCP `export`. | No per-asset "download for dev" list (image fills, icons, svg layers) with names and 1x/2x/3x. |
| Fonts | `useDocFonts`, `fonts.ts` load families. | Dev can't see which family/weight/source a text uses without opening Text section. No flag for fonts not available outside Vellum. |
| Components | Main/instance/variant/props model and Assets panel. | Dev can't see component name, variant, property values or which main to build. |
| Verification | MCP `get_screenshot`, export to PNG. | No way to compare a build against the design. |
| Read-only safety | None. A developer or reviewer who selects a layer in the editor can nudge or delete it. | Need a mode where clicks never edit. |

Two structural facts matter for the design:
1. **Every node is real HTML/CSS and layout is measured from the DOM** (`measure`, `worldRect` resolver on `[data-node-id]`). Resolved numbers are available with no new layout engine, so Dev Mode can be exact rather than approximate.
2. **There is already a pure code generator** (`html.ts`, `tailwind.ts`, `jsx-components.ts`) used by both the app and MCP. Dev Mode must reuse it, so the panel, the clipboard and the agent never disagree.

Prior art (Figma Dev Mode, Penpot Inspect, Zeplin, Sketch Cloud): select a layer, get measurements, redlines on hover, code in a few languages, assets list, status ("ready for dev"). Features that matter for a *local, single-user* tool: inspect panel, redlines, copy code, tokens, assets. Features that don't: Ready-for-dev status workflows, seats and permissions, cloud links, Jira/VS Code plugins. Out of scope.

## 2. Concept

**Dev Mode is a read-only view of the same file, optimised for reading numbers and copying code.** It is a mode of the editor, not a separate document.

- One switch (top bar, key `D`, and a command-palette/menu entry) flips the editor between Design and Dev.
- In Dev, the canvas stays navigable (pan, zoom, select, hover, Tab/arrow selection navigation, page switch, comments readable) but never edits: no drag/resize/move, no text editing, no create tools, no delete/paste. The toolbar shows only Move, Pan and Comment (comment is allowed, feedback is part of handoff).
- The left panel keeps Layers (select/search only; no rename/reorder/drop) and Assets (components, copy only).
- The right inspector becomes the **Spec panel**. Sections, in the order a developer reads:
  1. **Header** — layer name, type, component badge (main / instance of X, variant `size=lg`, props).
  2. **Box** — X, Y relative to *parent* (with a toggle for artboard-relative), W, H as laid out, with the authored rule in small text (`Fill`, `Fit`, `Fixed`, `min 320`). Fractional values are shown as-is (`347.5`), never rounded away.
  3. **Layout** — direction, gap, padding (per side), alignment, grid tracks; position/constraints for absolute children.
  4. **Typography** — family, weight, size, line height *in px and as authored*, letter spacing, case, colour; style name if a text style is applied.
  5. **Fill / Stroke / Effects** — each colour: swatch, resolved value in the active mode, token name when `var(--…)`, opacity; gradients as CSS; radius, border, shadows, blur.
  6. **Tokens used** — every `var(--…)` the node and its subtree use, with value per mode.
  7. **Assets** — export rows for the node plus image/SVG layers beneath it: name, format, 1x/2x/3x, Download / Copy.
  8. **Code** — tabs CSS · Tailwind · React · HTML (+ JSX inline), one Copy button, "include children" toggle, "resolve tokens" toggle. Content comes from the existing generators.
- **Redlines on canvas.** With a node selected, hovering another shows pixel distances: selected→hovered (like Figma's Alt-hover, but always on in Dev), and selection→parent edges when nothing is hovered. Each line is labelled in px at any zoom (label size is screen-constant).
- **Compare overlay (stretch).** Drop a PNG of the build over an artboard; slider/difference blend. Closes the loop on "pixel-accurate".

Non-goals: editing from Dev, cloud sharing/links, status workflows, plugin API, auto-generating a whole app. A separate viewer for people without Vellum is out of scope for T58 (see questions).

## 3. Design

### 3.1 State and persistence
- `EditorState.devMode: boolean` (per open file, default false, **not** part of `Doc`, not undoable, not saved). `setDevMode(docId, on)` store action. Optionally remember last value in `prefs.devMode` so reopening a file keeps it.
- No file format change, no migration, `DOC_VERSION` stays 5.
- Entering Dev Mode: commits any text edit, ends gestures, sets tool to Move, closes popovers, keeps selection.
- Agent bridge is unaffected: MCP writes still apply (an agent editing while a dev views is normal). The canvas shows the change live.

### 3.2 Gating edits
One place decides: `canEdit(docId)` = `!ed.devMode`. Used in:
- `CanvasView` pointer handlers (move/resize/rotate/marquee-drag start, handle drags, text edit on double-click/Enter, create tools). Click/hover/marquee *select* stay.
- `shortcuts.ts` — early return for every non-navigation key when devMode (tool keys, delete, nudge, ctrl+c/x/v/d/g, text format). Allowed: V, H, C, Tab, arrows-as-navigation? Arrows nudge in design; in Dev they must not. Use Enter/Shift+Enter/Tab/Shift+Tab (already select parent/children/siblings) and zoom keys. Ctrl+C in Dev copies *CSS of the selection* (the thing a dev expects), not the node.
- Layers tree (no rename, reorder, visibility, lock toggles, drop targets).
- Context menu: only the "Copy as…" group, "Copy link", and navigation items.
- Store-level backstop: the mutating actions stay callable by MCP, so the guard is UI-side. A test lists every `ed.*` mutation entry point in canvas/shortcuts and asserts none runs in Dev.

### 3.3 Spec model (pure, testable)
New `model/devSpec.ts`:

```ts
interface NodeSpec {
  id; name; type
  box: { x; y; width; height; relTo: 'parent' | 'artboard'; rule: { w: SizeRule; h: SizeRule } }
  layout?: { kind: 'flex'|'grid'|'block'|'absolute'; direction?; gap?; rowGap?; columnGap?; padding: [t,r,b,l]; align?; justify?; columns?; rows? }
  text?: { family; weight; size; lineHeightPx; lineHeightAuthored; letterSpacing; textAlign; transform; style?: string }
  paints: { role: 'fill'|'stroke'|'text'|'shadow'; value: string; token?: string; resolved: Record<mode,string>; opacity? }[]
  radius?; border?; effects?
  tokens: { name: string; values: Record<mode,string> }[]
  component?: { kind: 'main'|'instance'; name; variant?: Record<string,string>; props?: Record<string,string|boolean> }
  assets: { id; name; kind: 'node'|'image'|'svg'; formats: ExportFormat[] }[]
}
```
- Inputs: `Doc`, node id, `measure()` rect for each node in the subtree, `computeNodeStyle` for authored style, the active page's mode. No React, no DOM except via the already-injected `measure` callback so unit tests can pass fake rects.
- Resolved numbers (W/H, parent-relative X/Y, `line-height: normal` → px) come from the measured DOM rect/computed style, not from authored style. Authored rule is shown next to it.
- Redline distances are a second pure function `redlines(selRect, otherRect | parentRect)` returning segments `{from, to, px, axis}`; separate from rendering so it is unit-testable (overlap, containment, adjacent, rotated → skipped with a "rotated" note).
- Token resolution reuses `modes.ts` (`tokensCssWithModes` data source) so Light/Dark values match the canvas.

### 3.4 Code output
- No new generators. `Code` tab calls the same functions as `copyAs`: `styleToCss`, `nodeToTailwindJsx`, `nodeToJsx`, `nodeToHtml`, and `jsx-components` for components. Fix the known gap: the canvas Copy as React/Tailwind should go through `jsx-components` so an instance copies as `<Button size="lg" />` plus definition, consistent with `get_jsx`. (Slice 3; touching `copyAs` is the only behaviour change outside Dev Mode, and it is a bug fix.)
- "Resolve tokens" replaces `var(--x)` with the active-mode literal for the CSS tab only.
- Copy button writes through the existing `writeText` + toast path.

### 3.5 MCP
- New tool `get_dev_spec({ fileId?, nodeId, depth? })` returns `NodeSpec[]` (node plus descendants to `depth`, default 1). It is the same `devSpec` function, run in the renderer via the bridge handler like `get_computed_styles`. Gives agents the resolved numbers they currently have to derive from `get_computed_styles` + `find_nodes`.
- Update `docs/MCP.md`, `mcp/src/guide.ts`, and the `mcp-bundle` tool-list test.

### 3.6 UI details
- Top bar: a segmented `Design | Dev` control next to Share; Dev state tints the inspector header and shows a thin accent border around the canvas so the mode is never ambiguous.
- Spec panel rows are `label · value · copy-on-click`: clicking any value copies it (`16px`, `#3B82F6`, `--color-primary`) and shows a toast. Double-click on a token name selects the token in the Theme tab (read-only).
- Numbers: up to 2 decimals, trailing zeros trimmed; units explicit.
- Empty state (no selection): page summary — artboard list with sizes, tokens count, fonts used, and a "Copy all CSS variables" button.
- Redline colour is distinct from selection blue and comment pins; labels use the canvas label style.
- Keyboard: `D` toggles (verified free: shell uses Shift+D for dashboard); Esc selects parent as today; `Ctrl+C` copies CSS in Dev.
- Accessibility: Spec panel is a normal focusable list; values are buttons.

## 4. Plan: slices

Each slice is mergeable and leaves Design mode unchanged.

| # | Slice | Contents | Depends |
|---|---|---|---|
| A | Spec model | `model/devSpec.ts` (`NodeSpec`, `redlines`), pure, with unit tests: Fit/Fill/fixed, flex gap/padding, grid, token + modes, text inherited line-height, component instance, rotated node. | — |
| B | Mode + gating | `devMode` in editor state, `setDevMode`, top-bar switch, `D` key, `canEdit` guards in canvas/shortcuts/layers/context menu, toolbar reduced, tests that no mutation runs in Dev. | — |
| C | Spec panel | Right panel sections 1–6 reading slice A, click-to-copy, empty state, `docs/INSPECTOR.md` section. | A, B |
| D | Code + assets | Code tab (CSS / Tailwind / React / HTML) via existing generators, `copyAs` routed through `jsx-components`, Assets rows with export/download. | C |
| E | Redlines | Canvas overlay from `redlines()`, hover distances, parent edge distances, labels at constant screen size, tests for geometry. | A, B |
| F | MCP `get_dev_spec` | Bridge handler + server tool + docs/guide + bundle test. | A |
| G | End-to-end + docs | Playwright-style regression (existing e2e harness): enter Dev, select, read values, try to drag/type/delete (nothing changes, undo stack unchanged), copy code, exit. README/CANVAS/INSPECTOR/MCP docs. | C–F |
| H (stretch) | Compare overlay | Image drop, opacity and difference blend, per artboard; not saved in the file. | B |

Parallelism: A and B can start together; C, E, F follow A; D follows C.

### Risks
- **Resolved vs authored confusion.** A dev copying `width: 100%` that renders 347.5px. Mitigation: always show resolved first and the authored rule beside it; Code tab shows authored CSS by default with a "computed" toggle.
- **Off-screen pages / unmeasured nodes.** `measure()` renders offscreen so other pages work, but it is costlier. Mitigation: measure the selection subtree lazily, cache per doc object (the measure cache already does this).
- **Rotated / flipped nodes.** Boxes and redlines are bounding boxes in world space; show "rotated 12°" and skip distances rather than misleading.
- **Edit leaks.** A missed handler lets Dev mode edit. Mitigation: the guard test in slice B enumerates entry points; plus store-level `devMode` check on the few user-driven actions that bypass the canvas (layers tree, inspector fields are replaced entirely).
- **Component output gap** noted in COMPONENTS.md; fixed in slice D.

## 5. Decisions to approve
1. Dev Mode is a **mode of the editor** (this plan), not a separate window or exported viewer.
2. Not persisted in the file; remembered in prefs only.
3. Key `D`; `Ctrl+C` copies CSS while in Dev.
4. Comments stay available in Dev.
5. Slice H (compare overlay) is stretch, outside the first release.
6. Ready-for-dev status, cloud links and plugin API are explicitly out of scope.

## 6. Open questions for Obi
- Is the developer someone *inside* Vellum (you, or your agent), or someone who only receives a link/file? If the latter, a static "handoff export" (HTML viewer with the spec panel) becomes the priority and needs its own plan.
- Should Dev Mode show Tailwind class output by default (matches `get_jsx`) or plain CSS?
- Is `px`-only enough, or do you want a `rem` toggle (base 16)?
