# T58 — Dev Mode and developer handoff: plan (revision 2)

Status: plan only, no code. Revision 2 after the Captain's correction (message F1313): revision 1 answered "inspect mode inside Vellum" because the task text arrived as a title only. The inspect half is kept (section 7). The priority is the **handoff export**.

Written against `model/{types,html,ops,modes,textStyles}.ts`, `bridge/{measure,tailwind,tools-render,jsx-components}.ts`, `shared/docDiff.ts`, `main/history.ts`, `editor/inspector/{Inspector,TopBar,exporting}.tsx`, `editor/canvas/{Overlay,actions,menus}.tsx`, `editor/inspector/fonts.ts`, `docs/{CANVAS,COMPONENTS,MCP}.md`.

Related: `docs/factory/T58-concept.md` (options and names; its option C is now the lead).

## 0. The case (from the Captain)

Andy builds a UI for **another project** from a Vellum design. **His own Claude Code** implements it from an exported spec. Design files and the code repo stay separate. Andy may not have Vellum. He needs: exact layout and intent, tokens, components with states, responsive behaviour, assets, a way to verify the build, and a way to learn what changed after the first handoff.

Success test: in a fresh repo with only the bundle next to it, Claude Code builds a screen whose screenshot matches the PNG reference within a stated tolerance, without asking a question that the bundle should have answered; and after a design change, the second bundle's `CHANGES.md` lets the agent update only what changed.

## 1. What exists today (discover, short)

Full table was in revision 1; the parts that matter for the handoff:

- Everything is real HTML/CSS, and `bridge/measure.ts` can render any artboard (any page, even unopened files) offscreen and read real rects. Resolved numbers are available.
- Generators exist and agree with MCP: `nodeToHtml`, `nodeToJsx`, `nodeToTailwindJsx`, `jsx-components` (components as usage, with a known gap in canvas copy), `styleToCss`.
- Tokens with per-mode values (`Doc.tokens`, `Doc.modes`), text styles (`Doc.textStyles`), components, variants, properties, constraints, grid, min/max via style.
- Exports (PNG/JPG/WebP/SVG/HTML/PDF) per node; Share → `.vellum` JSON.
- Version history with a diff summary (`shared/docDiff.ts`, `main/history.ts`), stored in the profile; named versions via `SaveVersionModal`.
- Comments (`Doc.comments`), alt text (`attrs.alt`), fonts catalogue with source `system | local | google`.
- Not present: any "for dev" metadata (ready marks, dev notes, states beyond variants, breakpoint grouping, a11y roles), any bundle writer, any read-only mode.
- The MCP bridge is local (stdio to the app). The remote connector (`docs/REMOTE.md`) is for claude.ai, not for a second person.

## 2. Delivery options: how does Andy's Claude Code get the design?

| | (a) Handoff bundle | (b) Andy opens the file read-only in Dev Mode | (c) Live MCP access |
|---|---|---|---|
| What Andy gets | A folder or zip: `HANDOFF.md`, `spec.json`, per-frame markdown, tokens, assets, PNG renders, `CHANGES.md` | The `.vellum` file; Vellum installed; Dev Mode inspect panel | His agent talks to a running Vellum over MCP |
| Needs Vellum | No | Yes (Windows installer) | Yes, running, with the file open |
| Works for Claude Code | Best: plain files, read by `Read`, greppable, committed or not | Poor: agent can't see the GUI; human copies values | Good for exploration, fragile for a build (app must stay open; bridge is local only) |
| Design/code repos separate | Yes, drop next to the repo | Yes | Needs same machine or a tunnel |
| Versioned / diffable | Yes (`CHANGES.md`, `spec.json` diff in git) | By Vellum's history, in the app only | No snapshot |
| Safe by construction | Only chosen frames exported; reviewed in a dialog | Whole file, incl. other pages, hidden layers, comments | Whole file, and the agent can write |
| Cost | Large but mostly pure functions | Moderate (section 7) | Already exists |

**Recommendation: (a) the bundle as the primary handoff, plus (b) Dev Mode as the human companion (and the way to build (a)'s review step).** Keep (c) for same-machine use by Obi. Reasons: the stated reader is an agent without the app; bundle data is also exactly what (b) shows, so (b) is the same `NodeSpec` model with a GUI; (c) fails the "no Vellum" requirement and the safety requirement.

## 3. The bundle

### 3.1 Layout

```
acme-checkout-handoff-v3/            (folder, or the same tree zipped)
  HANDOFF.md        what this is, how to build from it, how to verify. Also copied as CLAUDE.md
  CHANGES.md        what changed since handoff v2 (absent for v1)
  spec.json         machine-readable, schema "vellum.handoff/1" (+ spec.schema.json)
  screens/
    checkout.md             one markdown spec per exported screen
    checkout.desktop.png    PNG reference at 1x, @2x variants for retina checks
    checkout.mobile.png
  tokens/
    tokens.css              CSS custom properties, one block per mode
    tokens.json             W3C Design Tokens format (DTCG), $type/$value, modes as groups
    tailwind.css            Tailwind v4 `@theme` block (and tailwind.config.ts for v3)
  components/
    button.md               definition, variants, props, states
  assets/
    images/hero.jpg  hero@2x.jpg  hero@3x.jpg
    icons/arrow-right.svg
  fonts.md          families, weights, source, licence note
  .handoff.json     state used by the next export's diff (hashes per screen); human can ignore
```

Rules: relative paths only; ids in `spec.json` equal Vellum node ids so a later bundle diffs cleanly; the folder name includes the handoff version.

### 3.2 `HANDOFF.md` (also `CLAUDE.md`)

Short, written for Claude Code. Fixed template filled with the file's facts:
1. Read order: `HANDOFF.md` → `tokens/` → `components/` → each `screens/*.md`; `spec.json` for exact data.
2. Stack-neutral rules: build with the project's framework; map tokens to the project's theme (tokens.css values are the truth, names are suggestions); reuse existing components before creating new ones; never hard-code a value that has a token.
3. Layout rules: honour the **layout intent** (flex/grid/sizing rules, section 4); never convert intent to absolute pixel positions; px values in `spec.json` describe the design-time size.
4. Verify: render each screen at the design viewport width, compare with `screens/*.png`; tolerance (default: ≤ 1px position error, text within the same line breaks, colours exact); list what differs; don't tweak the design silently.
5. Ask/flag: anything marked `needs-decision` or `dev note` stays in the PR description.
6. Update flow: read `CHANGES.md` first; rebuild only listed screens/components.

### 3.3 `spec.json` (versioned)

```ts
interface Handoff {
  schema: 'vellum.handoff/1'          // bump major on breaking change; readers must check
  handoff: { version: number; exportedAt: string; vellum: string; fileId: string; fileName?: string; previous?: number }
  units: { length: 'px'; remBase: 16; precision: 2 }
  modes: string[]                     // first is base
  screens: Screen[]                   // chosen frames, grouped by breakpoints (section 6)
  components: ComponentSpec[]         // mains used by the screens (section 5)
  tokens: TokenSpec[]                 // name, type, value per mode, usage count
  textStyles: TextStyleSpec[]
  assets: AssetSpec[]                 // section 8
  fonts: FontSpec[]
  changes?: ChangeSet                 // vs previous handoff (section 9)
}
```
`Screen` = `{ id, name, slug, ready: {at: version} , breakpoints: [{name, width, frameId, png}], root: NodeSpec }`. `NodeSpec` is the structure from revision 1 section 3.3, extended:

```ts
interface NodeSpec {
  id; name; type; role?                         // role: semantic role (section 10), inferred or authored
  box: { x; y; width; height; relTo: 'parent'|'artboard' }   // resolved, measured, as laid out at design size
  sizing: { w: SizeRule; h: SizeRule }          // layout intent
  layout?: LayoutIntent                         // flex / grid / positioned
  style: { authored: Style; resolved: Record<string,string> } // authored keeps var(--token); resolved = active mode literal
  text?: TextSpec; paints: PaintSpec[]; effects?: EffectSpec[]
  tokens: string[]                              // names used here
  component?: { ref: string; variant?: Record<string,string>; props?: Record<string,string|boolean>; overrides?: string[] }
  states?: Record<StateName, StateSpec>         // section 7
  a11y?: A11ySpec; notes?: string[]             // dev notes, never design comments
  children: NodeSpec[]
}
```
Hidden layers (`visible: false`) are never emitted. Locked state is dropped.

## 4. Layout intent, not just numbers (item 2)

A box of numbers can't be resized correctly. The export records the **rule** next to the **result**.

```ts
type SizeRule =
  | { mode: 'fixed'; value: number }
  | { mode: 'fit' }                       // fit-content
  | { mode: 'fill'; weight?: number }     // flex: 1 / 100% / grid 1fr
  | { mode: 'percent'; value: number }
  & { min?: number; max?: number; aspect?: number }

interface LayoutIntent {
  kind: 'flex' | 'grid' | 'block' | 'positioned'
  // flex
  direction?: 'row'|'column'; wrap?: boolean; gap?: number; rowGap?: number; columnGap?: number
  align?: Align; justify?: Justify; padding: [t,r,b,l]
  // grid
  columns?: string; rows?: string; autoFlow?: string; cell?: { colSpan?; rowSpan?; align? }
  // positioned children
  constraints?: { h: 'left'|'right'|'left-right'|'center'|'scale'; v: 'top'|'bottom'|'top-bottom'|'center'|'scale' }
  position?: 'absolute'|'fixed'|'relative'; zIndex?; overflow?: 'visible'|'clip'|'scroll'
  // plain-language summary the markdown prints
  summary: string                          // "Row, gap 16, children fill equally; shrinks, wraps below 480"
}
```
- All of it is derived by one pure function `layoutIntent(doc, id)` from the authored `style` (`display`, `flexDirection`, `gap`, Fixed/Fit/Fill as the app already encodes them, `minWidth/maxWidth`, constraints via `ops`), so it matches what the canvas does.
- The markdown spec prints, per node, **one line of intent first** and numbers second: `Card — column, gap 12, padding 16, width fill (max 480), height fit`.
- Absolutely positioned children in a frame with constraints print the constraint (`pinned right 24, top 16`), not just `left`.
- Auto layout nodes carry **no x/y** for flow children (only a computed order index), so the agent can't copy stale offsets.
- A check in export: any node whose measured size differs from its authored rule in a way the rule can't explain (e.g. fixed 100 but measured 120 due to min-height) is listed in `HANDOFF.md` under "Notes on sizing".

## 5. Components, variants and states (item 3)

### 5.1 What is exported
- `components/<slug>.md` + `spec.json.components[]`: main name, set, variant props with options, boolean/text/swap props with defaults, each variant's `NodeSpec`, used-by list (screens/instances), and the code-ready usage (`<Button size="lg" label="Buy" />` from `jsx-components`).
- Instances on a screen reference `component.ref` and list only non-default prop values and overrides.
- Component definitions from other pages are pulled in **only if** an exported screen uses them (flagged in the dialog).

### 5.2 States
Vellum has variants but no interaction state concept. Two layers:

1. **Drawn states (preferred, already supported).** A variant property named `State` (or `Status`) whose options match a known vocabulary: `default, hover, pressed|active, focus, focus-visible, disabled, loading, selected, error`. The exporter maps these to CSS selectors/ARIA (`:hover`, `:active`, `:focus-visible`, `:disabled`/`aria-disabled`, `[aria-selected]`, `aria-invalid`) and emits **deltas against `default`** (only properties that differ), not full copies. Unknown option names pass through as `data-state="…"`. The Dev panel offers "Make State property" on a component set to set this up in one step.
2. **Undrawn states.** Many states (hover on every link) are never drawn. Allow a state to be described **without** a variant: a **State rules** list on a main/node (`CNode.dev.states`, section 11): `{ state: 'hover', style: { background: 'var(--color-primary-hover)' }, note?: 'transition 150ms ease-out' }`. Authoring UI is a small table in the Dev section of the inspector (state dropdown, property, value with token picker). It reuses `StylePatch`, so no new value types.
3. **Behaviour that is not style** (transition, focus ring, keyboard) goes in dev notes (section 8) with a few structured fields for the common ones: `transition` (property, duration, easing), `focusRing` (width, offset, colour token).
4. The component markdown prints a **State table**: rows = states, columns = what changes, with a `drawn | described | missing` badge. `HANDOFF.md` lists interactive components without hover/focus/disabled as "states not specified; use project defaults" so the agent doesn't invent silently.

## 6. Responsive and breakpoints (item 4)

Vellum has no breakpoints: an artboard is one fixed width. Two additive pieces:

### 6.1 Per-node resize rules (reuse, plus min/max in the UI)
- Fill/Fit/Fixed, constraints, wrap, grid tracks already define how a node reacts when its parent's width changes. They are exported as layout intent (section 4). Missing today: a first-class **min/max** in the Layout section (they exist as raw CSS in Other styles). Add Min W / Max W / Min H / Max H fields to the Dev section so authors can state them without raw CSS (`dev.resize`-free; writes `minWidth` etc.).
- For changes the engine can't express (row → column below 640, hide on mobile, swap component), use **breakpoint variants** below, not new CSS-like rules.

### 6.2 Breakpoint variants of one screen
- A top-level frame can be tagged **Screen: `<name>` · Breakpoint: Desktop | Tablet | Mobile | custom width** (`CNode.dev.screen = { name, bp }`). Frames with the same screen name form one screen with several breakpoints. Default widths 1280 / 768 / 390, editable per file; the frame's own width is the truth and is written to the spec.
- Export `screens/<name>.md` has one section per breakpoint **and** a *delta* table versus the base (largest) breakpoint: nodes matched by layer-name path (id when the variant was created via duplicate and renamed; ambiguity listed). Matched nodes list only changed intent/properties; unmatched nodes are `only at Mobile` / `hidden at Mobile`.
- Mapping to code suggestions: `min-width` media queries (mobile-first), container queries if the parent is a component; it is a suggestion, stated as such.
- Shipping rule: each breakpoint gets its own PNG; `HANDOFF.md` tells the agent to verify at each width and to treat widths in between as governed by the layout intent.
- Not in scope: fluid typography scales, per-breakpoint token overrides, orientation, container-query authoring.

## 7. Dev notes, ready marks, accessibility (items 7, 6, 8) and the document change

One additive per-node field, `CNode.dev?: DevInfo` (all optional), plus migration `DOC_VERSION` 5 → 6 that only bumps the number (like v2→v5). Not part of component-sync except where noted.

```ts
interface DevInfo {
  ready?: { at: number }                 // frames: handoff version in which it was marked, set on "Mark ready for dev"
  notes?: string                         // dev notes: behaviour, data, edge cases (markdown-lite)
  states?: Record<string, StylePatch>    // undrawn states (section 5.2)
  role?: string; label?: string          // a11y (alt stays in attrs.alt)
  tab?: number                           // focus order override (positive = explicit order)
  screen?: { name: string; bp: string }  // top-level frames only (section 6.2)
  needsDecision?: string                 // open question for the dev; listed in HANDOFF.md
}
```

- **Dev notes** are a field on the node, not comments: comments are conversations that get resolved; notes are specification. They never appear in the Share/Copy HTML, only in the bundle (`notes` in `spec.json`, a "Dev notes" bullet in the markdown). Separate UI: "Dev" section in the inspector.
- **Ready for dev**: frame-level toggle (and "mark all on page"). A frame edited after being marked ready shows **Changed since ready** (computed by comparing the frame's content hash with the one stored at mark time, in `.handoff` state in the history snapshot, not in the node, so the node field stays a number). Export defaults to ready frames only, warns on unready or changed.
- **Accessibility hints**:
  - `role`/`label`: authored in the Dev section; defaults inferred from component names and node types (Button → button, Input → textbox, Link → link, Image → img, headings by text style name), always marked `inferred` in the spec.
  - Alt text: reuses `attrs.alt`; export lists images without alt (decorative must be set explicitly).
  - **Contrast**: computed at export per text node, foreground vs the nearest opaque ancestor background in each mode, WCAG ratio and AA/AAA pass flags; failures are listed in `HANDOFF.md`. (Gradient/image backgrounds → "not computed".)
  - **Focus order**: default is document (reading) order; `dev.tab` overrides; listed per screen.
- Undo/redo: these are normal store actions (`setDev`), one history entry each, docDiff gets a `dev` aspect so version history shows "dev info changed".

## 8. Assets (item 5)

- **Images.** Images live as data URLs in `attrs.src`. Export decodes the **original bytes** (no re-encode) as `assets/images/<name>.<ext>`. If the layout size × 2 / × 3 exceeds the intrinsic size, only `@1x` (and the original) are exported and the spec says `maxDensity: 1.4`. Otherwise `@2x` / `@3x` are resampled from the original (down-sampling only, same format; JPG quality 90). Never upscale.
- **Image fills** (`background-image` on shapes) are exported the same way and referenced by asset id.
- **SVG icons.** From SVG layers and the icon picker. Optimised by a small in-house pass (strip metadata, comments, empty groups, redundant attributes, `width/height` kept as `viewBox`), and **recoloured to `currentColor`** when the icon uses a single colour (stroke or fill) so it follows text colour. Multi-colour SVGs are kept as they are and flagged. Decision: use `svgo` (devDependency, MIT) rather than hand-rolling; it is bundled in the main process only. (To approve, section 12.)
- **Fonts.** `fonts.md` and `spec.json.fonts[]`: family, weights and italic actually used (from the exported text nodes), source (`google | local | system`), CSS stack with a fallback, and a licence note: Google fonts → "SIL OFL / Apache 2.0 per family, check https://fonts.google.com/specimen/<Name>"; local/system → "installed on the designer's PC, **not bundled and not redistributable**; license or substitute". Font files are not included by default; an option adds Google font files (OFL) only.
- **Naming.** `<screen-slug>-<layer-slug>`, kebab-case, ASCII; icons `icon-<name>` (the icon-picker name when known); collisions get `-2`. The exported layer name is also recorded so a human can find it.
- **De-dup.** Content hash (SHA-256 of bytes after optimisation); identical assets used by several nodes are written once and referenced by id from each.
- PNG reference renders: `bridge/measure` + the existing offscreen export path at 1x and, on request, 2x.

## 9. Versioning after handoff (item 6)

- **Handoff version** is an integer per file, bumped on each export (`Doc.dev`-level counter would be a new field; stored instead in the file's version history as a named version "Handoff v3", so no doc field is needed and it uses existing infrastructure).
- **Snapshot**: each export saves a named version in history (`main/history.ts`) containing the doc as exported plus `.handoff.json` (per-screen content hashes). The bundle also contains `.handoff.json`, so the next export can diff **against the snapshot in the app**, and Andy's agent can diff two bundles with no Vellum.
- **CHANGES.md** (generated): per screen, `added | removed | changed | unchanged`; per changed screen/component, a bullet list `node path — property: old → new` limited to exported frames, token changes (`--color-primary: #2563EB → #1D4ED8`), new/removed assets, new dev notes and states. Machine form in `spec.json.changes`.
- **Reuse**: `shared/docDiff.ts` decides *which nodes changed and how* (aspects). A new `devSpecDiff(oldSpec, newSpec)` in the pure spec module produces the values (old → new) since docDiff reports aspects, not values. Both are pure; a unit test compares them on a fixture.
- **Rebuild guidance**: `CHANGES.md` opens with "Rebuild only these: …", followed by "Unchanged: …".
- **Ready marks** drive scope (section 7). Export dialog shows the diff size per frame before writing.

## 10. Precision (item 9)

- Values are written from **measured** layout, not authored, with up to **2 decimals, trailing zeros trimmed** (`347.5`, never `347.50`, never silently `348`).
- Subpixel positions/sizes are flagged per screen: "11 nodes have fractional sizes (e.g. 347.5 × 52); build with the rule, not the number" — the layout intent is the source of truth for fractional results.
- **Units**: all lengths as `px` numbers in `spec.json`; markdown prints px and, with the `rem` option, `rem` beside it (base 16, configurable). Font sizes, spacing, radius, gap are rem-convertible; borders and shadows stay px.
- **Line height**: both `lineHeightPx` and unitless `ratio`; `normal` is resolved from the measured line box. **Letter spacing**: em and px.
- **Colour**: hex8 for sRGB; `oklch()` tokens (T38) kept as authored **and** with the resolved sRGB hex fallback; opacity 0–1.
- **Rounding for rasters**: PNG renders use `ceil` of the artboard size like the current export; the spec states the render scale and pixel size.
- **Tolerance** in `HANDOFF.md`: ±0.5px for layout compare, with the 2-decimal rule above.

## 11. Safety (item 10)

- **Whitelist**: the export contains only the frames chosen in the dialog, and their descendants. Nothing else from the file: no other pages, no unchosen frames, no scratch layers outside.
- **No hidden layers**: `visible: false` nodes are dropped from specs, markdown, assets, and from any text search the exporter does. Hidden layers in components are dropped too.
- **Assets**: only those referenced by emitted nodes.
- **Components** from other pages: included only as definitions of what the chosen frames use; listed in the review step ("pulls in Button, Input from page Library").
- **Comments are off by default**; opting in exports only threads attached to included nodes, in a separate `comments.md`. Dev notes are always included (they are written for the dev).
- **Metadata**: no profile name, email, absolute paths, file thumbnails, or other versions. File name is optional (default on, can be replaced by a project label).
- **Review step**: before writing, the dialog shows counts (frames, nodes, assets, fonts, components pulled in, notes, comments) and a file tree preview; nothing is written until confirmed.
- **Local only**: export writes to a folder or zip chosen by the user through the main process. No network, no upload, no MCP tool that sends the bundle anywhere. The MCP bridge stays local; the new MCP tools only read/return data to the already-connected local client.
- **Encrypted profiles**: export is an explicit decrypted copy; the dialog says so.
- Tests: a fixture file with a hidden layer, a locked layer, a second page, a comment, and a profile name assert none appear in the output.

## 12. Dev Mode inside Vellum (inspect half, from revision 1; item (b))

Kept, with changes in scope: it is now a **review and companion surface** for the same `NodeSpec` data.

- **Mode** `D` / top bar `Design | Dev`: `EditorState.devMode` (not in file). Canvas navigable, never edits. Gating via one `canEdit`; guard test enumerates entry points.
- **Opening a file read-only**: opening a `.vellum` file (Share → Export `.vellum`) from outside offers "Open in Dev Mode (read-only)"; the file is imported as a copy flagged read-only so Andy cannot damage his copy of the design.
- **Spec panel**: header (component badge), box (parent/artboard relative), layout intent, typography, paints with token + per-mode values, tokens used, assets, code tabs (CSS · Tailwind · React · HTML, existing generators; fix canvas copy to use `jsx-components`), the **Dev section** (notes, states, role/label, tab order, ready mark, screen/breakpoint) which is editable **only in Design mode**.
- **Redlines**: hover distances selected→hovered and to parent edges; labels at constant screen size; rotated nodes show "rotated" and skip distances.
- **Empty state**: screen list with ready/changed badges, "Export handoff…" button.
- **MCP**: `get_dev_spec({nodeId, depth})` and `export_handoff({frames, options, to})` (writes to a path on the local machine, returns the file list). Agents can drive the same dialog's logic. Documented in `docs/MCP.md`/`mcp/src/guide.ts`; `mcp-bundle` test updated.

## 13. Design deliverable (item 11)

Screens to draw in Vellum (drawn in this file's own app): (1) Dev Mode toggle in the top bar and the mode frame; (2) Spec panel for a frame, text and component instance; (3) redlines on canvas; (4) Export handoff dialog: frame list with ready/changed badges, options, review counts and tree; (5) ready-for-dev mark and "Changed since ready" in Layers and inspector; (6) CHANGES summary view; (7) Dev section (notes, states table, a11y, breakpoint tagging).

Status: see the end of this document ("Design screens") for what could be drawn in this session; whatever isn't drawn is for the design crew, with the list above as the brief.

## 14. Slices (build order)

Priority is the bundle; Dev Mode inspect follows. Each slice is mergeable and leaves Design mode unchanged. Estimates are crew-days at the pace of the variants milestone (7 slices ≈ 1 slice/day with review).

| # | Slice | Contents | Depends | Est. |
|---|---|---|---|---|
| H1 | Spec model | `model/devSpec.ts`: `NodeSpec`, `layoutIntent`, sizing rules, precision/rounding, tokens per mode, component refs; pure with measured-rect injection. Tests incl. Fit/Fill/min-max/grid/constraints/oklch/subpixel. | — | 2 |
| H2 | Dev info on the doc | `CNode.dev`, v6 migration, store actions (`setDev`, ready, screen tag), undo, docDiff aspect, persistence tests, v0.1.0–v5 files still open (reuse T46/T47 fixtures). | — | 2 |
| H3 | Bundle writer (pure) | `Doc + options → file map`: `spec.json` + `spec.schema.json`, screens/components markdown, tokens (css, DTCG json, tailwind), `HANDOFF.md`/`CLAUDE.md`; snapshot-style tests on a fixture; safety whitelist tests. | H1, H2 | 3 |
| H4 | Assets pipeline | Image decode/density/de-dup, SVG optimise + `currentColor`, fonts info, PNG renders via offscreen. | H3 | 3 |
| H5 | Export dialog + ready marks | Top-bar/menu entry, frame picker, options, review counts + tree, write folder/zip through main (`dialog.showSaveDialog`, no network), Ready toggles and "Changed since ready" in Layers/inspector. | H3, H4 | 3 |
| H6 | Versioning | Named "Handoff vN" snapshot in history, `.handoff.json`, `devSpecDiff`, `CHANGES.md` + `spec.changes`, dialog diff preview. | H5 | 2 |
| H7 | States and dev notes UI | Dev section: notes, states table with token picker, Make State property, a11y fields, contrast, focus order; markdown/State table output. | H2, H3 | 3 |
| H8 | Breakpoints | Screen/breakpoint tagging, delta tables, per-breakpoint PNG; Min/Max fields in Layout section. | H3 | 2 |
| H9 | Dev Mode inspect | `devMode` + gating, Spec panel (reuses H1), code tabs, copy-on-click, read-only open. | H1 | 3 |
| H10 | Redlines | `redlines()` pure + overlay. | H1, H9 | 2 |
| H11 | MCP tools | `get_dev_spec`, `export_handoff`, docs, guide, bundle test. | H3 | 1 |
| H12 | End-to-end and dogfood | e2e: tag, mark ready, export, assert tree and safety, edit, re-export, assert `CHANGES.md`; then a real build: Claude Code builds one screen from the bundle in a throwaway repo and the PNG compare passes; docs (README, CANVAS, INSPECTOR, MCP, new `docs/HANDOFF.md`), sample bundle. | all | 2 |

Parallel: H1 ∥ H2; after H3, H4 ∥ H7 ∥ H8; H9 can start after H1.

## 15. Milestone placement (item 12)

Proposal: a **post-1.0 milestone "Handoff"**, running **before Live collaboration**, because Andy needs it first and collaboration changes the document model (dev info should land on the pre-collab model once). Dates are proposals from today (2026-10-13) and assume v1.0.0 (T55, waiting on Obi's signing decision) ships first; shift the whole block if it slips.

| Phase | Window | Goal | Exit criteria |
|---|---|---|---|
| H-A "One screen" | 2026-11-02 → 2026-11-20 | H1–H5: a bundle with spec, tokens, assets, PNGs, HANDOFF.md from chosen ready frames | A fresh-repo Claude Code build of one real screen from the bundle matches the PNG within ±0.5px layout; safety fixture passes; v0.1.0–v5 files open unchanged |
| H-B "Stays in sync" | 2026-11-23 → 2026-12-11 | H6–H8: versioning, states, notes, a11y, breakpoints | Second export's `CHANGES.md` lists exactly the edited nodes in a test file (no false positives on 20 unedited screens); a three-breakpoint screen exports with deltas; every interactive component shows a states badge |
| H-C "Review in the app" | 2026-12-14 → 2026-12-23 | H9–H12: Dev Mode, redlines, MCP tools, docs, dogfood | Read-only open works; guard test shows no edit path in Dev; `export_handoff` via MCP matches the dialog output byte-for-byte; docs + sample bundle merged |

Goals to register with the Captain (names are mine): G14 Handoff export; G15 Handoff versioning; G16 Dev Mode in app. The Captain owns the roadmap; this is a proposal.

## 16. Decisions to approve

1. **Bundle first** (a) plus Dev Mode (b) as companion; (c) MCP stays for same-machine use.
2. **Document format v6** with an additive `CNode.dev`; migration only bumps the version.
3. **Dev notes ≠ comments**; notes are always exported, comments opt-in.
4. **State vocabulary** on a variant property named `State`, plus undrawn state rules.
5. **Breakpoints** are tagged frames (Desktop/Tablet/Mobile + custom), not CSS-like rules.
6. **`svgo`** as a main-process devDependency for icon optimisation and `currentColor` (otherwise a small in-house pass, with weaker output).
7. **Fonts are never bundled** except Google font files on request; local fonts get a licence warning.
8. **Handoff version** lives in version history as a named version, not a doc field.
9. **Default export scope** = ready frames only; hidden layers never; comments off.
10. **Milestone** placement and dates in section 15 (Captain/Obi to confirm).
11. Naming: UI "Dev Mode" and "Export handoff"; schema id `vellum.handoff/1`.

## 17. Risks

- **Intent derivation drifts from the canvas.** Mitigation: `layoutIntent` is the only reader; round-trip tests render the intent to CSS and compare to `computeNodeStyle`.
- **Breakpoint matching by name is heuristic.** Mitigation: unmatched nodes are listed, not guessed; ids match when frames were duplicated and tracked.
- **Bundle becomes stale quietly.** Mitigation: version stamp, "Changed since ready" badges, export warns.
- **Safety leaks** (hidden layer text in a component description, a comment in notes). Mitigation: whitelist emitter, a single `emitNode` gate, fixture test with canaries.
- **Large images** blow up bundle size. Mitigation: original only, densities only when they carry information, size shown in the review step.
- **The agent over-trusts px.** Mitigation: layout intent first in every line; `HANDOFF.md` rule 3.
- **Doc format change before 1.0 release.** v6 is additive and lands after 1.0; migration test reuses T46/T47 fixtures.
- **Scope.** This is large; H-A alone already delivers value. Slices are ordered so stopping after H5 or H6 is coherent.
- **svgo** adds a dependency; its output is deterministic and covered by golden tests.

## 18. Out of scope

Cloud sharing and links, accounts, comments sync, status workflows beyond ready/changed, Figma/Zeplin import or export, plugin API, generating a full app or choosing a framework for Andy, per-breakpoint token overrides, fluid type scales, interaction prototyping/animation specs beyond the structured `transition` note, bundling licensed fonts.

## Design screens

Drawn in Vellum, file **"Vellum — Dev Mode and handoff"** (page 1, four artboards, tokens reuse the app's UI tokens plus `--color-dev`, `--color-redline`, `--color-ready`, `--color-changed`). Exported PNGs are in `docs/factory/T58-screens/`.

| Artboard | Shows | PNG |
|---|---|---|
| D01 · Dev Mode, spec panel and redlines | Mode banner, layers with ready/changed dots, canvas redlines (120 / 80 / 60) and size chip, Spec panel: box, layout intent, fill and tokens per mode, assets, code tabs | `D01-dev-mode-spec-panel.png` |
| D02 · Export handoff dialog | Screen picker with Ready / Changed since ready / Not ready, breakpoint grouping note, options, review counts, "pulls in" warning, tree preview, folder or zip | `D02-export-handoff-dialog.png` |
| D03 · Inspector Dev section | Ready mark and "Changed since v3", dev notes, states table (drawn / described / missing), a11y role/label/focus order/contrast, screen and breakpoint tag | `D03-inspector-dev-section.png` |
| D04 · Changes since last handoff | Rebuild list with old to new values, tokens, assets, unchanged list; becomes CHANGES.md | `D04-changes-since-handoff.png` |

Not drawn (for the design crew, from the section 13 list): the Design | Dev switch in the top bar at component level, the Layers-tree ready badge states in context, "Open in Dev Mode (read-only)" file-open prompt, "Make State property" flow, breakpoint tagging control, and empty states. The four screens are layout sketches in the app's own style, not final visual design.
