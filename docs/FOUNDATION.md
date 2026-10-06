# Vellum foundation: guide for feature agents

This guide covers what already exists and how to build on it. `docs/ARCHITECTURE.md` is still the contract. Where this guide differs from it, the difference is listed in "Deviations" below.

## Run
```
npm install            # if electron.exe is missing: node node_modules/electron/install.js
npm run dev            # electron-vite dev (HMR for renderer). Renderer warnings/errors are echoed to the terminal.
npm run typecheck      # tsc for node (main/preload/shared) + web (renderer)
npm run build          # typecheck + electron-vite build -> out/
npm start              # preview the built app
```
Data lives in `%APPDATA%/Vellum/profiles.json` plus one folder per profile, `%APPDATA%/Vellum/profiles/<id>/` (`files/<docId>.json` + `index.json`, encrypted when the profile has a password; see "Profiles" below). The bridge listens on `ws://127.0.0.1:29170` (env `VELLUM_PORT`) and only accepts clients that send the per-install secret from `<userData>/bridge-token` (see `docs/SECURITY.md`); tests that use `VELLUM_USER_DATA` must set it for the MCP side too.

**Testing without touching real data:** set `VELLUM_USER_DATA` to another folder before starting Electron (e.g. `set VELLUM_USER_DATA=%TEMP%\vellum-test && set VELLUM_PORT=29171 && npx electron .` after `npm run build`). The whole userData (profiles, Chromium caches, single-instance lock) then lives there. An empty folder starts at "Create your profile".

Path aliases: `@shared/*` → `src/shared/*` (all targets), `@renderer/*` → `src/renderer/src/*`.

## Layout of what exists
```
src/shared/api.ts          CanvasApi interface, IPC channel names, IndexData, BridgeRequest/Response
src/main/index.ts          frameless window 1440x900 (min 1024x700, bg #2A2A2A), window IPC, capturePage
src/main/storage.ts        list/load/save/delete docs + index (atomic writes, per-file queue)
src/main/bridge.ts         WS server -> renderer 'bridge:request' -> 'bridge:respond' (30 s timeout)
src/preload/index.ts       window.canvasApi (typed in src/renderer/src/env.d.ts)
renderer/src/
  styles/tokens.css        UI tokens (CSS vars); global.css (reset, fonts, scrollbars, focus ring)
  model/types.ts           CNode, Doc, Page, Token, Style, StylePatch, Tool, Camera, EditorState, WorldRect
  model/history.ts         immer-patch undo/redo per doc, transactions, coalescing, cap 200
  model/ops.ts             pure helpers (see below)
  model/html.ts            htmlToNodes, nodeToHtml, nodeToJsx, computeNodeStyle, parseInlineStyle, styleToCss
  model/store.ts           zustand store (useStore) + selectors
  model/persist.ts         startup load, 500 ms debounced saves, Scratchpad on first run
  ui/                      primitives (import from '../ui' or '@renderer/ui')
  shell/TitleBar.tsx       hamburger menu, tabs, window buttons
  shell/commands.ts        app commands, appMenu(), installAppShortcuts(), 'canvas:command' event
  dashboard/Dashboard.tsx  PLACEHOLDER
  editor/Editor.tsx        grid: 240 | 40 | canvas | 280, with 1px hairlines
  editor/left/LeftPanel.tsx         PLACEHOLDER
  editor/toolbar/Toolbar.tsx        working tool strip (tooltips, active tool); exports TOOL_GROUPS
  editor/canvas/CanvasView.tsx      PLACEHOLDER: DOM render + wheel pan/zoom + rect resolver
  editor/inspector/Inspector.tsx    PLACEHOLDER: zoom label, Page colour, MCP button
  bridge/handlers.ts       registerHandler(), resolveDocId(); implements ping + get_basic_info
```
Every placeholder receives `{ docId }`, except Dashboard, which receives nothing. Replace the placeholders freely, but keep the export names (`LeftPanel`, `Toolbar`, `CanvasView`, `Inspector`, `Dashboard`). Put new files next to the placeholder so parallel agents don't collide.

## window.canvasApi (src/shared/api.ts)
- Window: `minimize()`, `toggleMaximize()`, `close()`, `isMaximized(): Promise<boolean>`, `onMaximizedChange(cb) => unsubscribe`, `reload()`, `forceReload()`, `toggleDevTools()`, `toggleFullScreen()`, `quit()`, `openExternal(url)`
- Storage: `listDocs(): Promise<DocSummary[]>`, `loadDoc(id)`, `saveDoc(doc)`, `deleteDoc(id)`, `loadIndex()`, `saveIndex(index)`, `userDataPath()`. Normally you only go through the store, and persist.ts does the saving. All of these act on the open profile and fail with "Vellum is locked…" when none is open.
- Profiles: `profiles.state()`, `create()`, `open()`, `recover()`, `lock()`, `update()`, `setPassword()`, `removePassword()`, `newRecoveryKey()`, `remove()`, `saveRecoveryKey()`; results are `{ok:true,…} | {ok:false,error}`. The renderer never gets key material.

## Profiles
- Main: `src/main/vault.ts` (pure Node, no Electron; tested by `cd mcp && npm run test:profiles`) holds `profiles.json`, the crypto and the file I/O of the open profile; `src/main/storage.ts` wires it to IPC. Password → scrypt (N=2^17, r=8, p=1) → key that wraps the random 256-bit data key (AES-256-GCM); a 128-bit recovery key (Crockford base32, `XXXX-…`) wraps it too (via HKDF). Files: `VLME` + version byte + 12-byte IV + 16-byte tag + ciphertext; version 2 authenticates the file's name inside the profile (`files/<id>.json`) as AAD, version 1 is still read. Plaintext profiles store plain JSON. Writes are atomic (tmp + fsync + rename) and serialised per file. Crash safety (T45): before a design, `index.json` or `profiles.json` is overwritten, the file it replaces is copied to `<file>.bak` when it is known to parse (so a damaged file never replaces a good backup); a file that is there but cannot be read (truncated, bad JSON, fails to decrypt) is read from its `.bak` instead and listed by `takeRestored()` so the renderer can say so. A `.bak` is a byte copy sealed with the file's own AAD, and `.bak` / `.recovery` files are converted with the rest when a password is set or removed. While edits wait for their save the renderer writes `files/<id>.recovery` (a full copy, encrypted like the file, the first copy 120 ms after the first edit following a save, then at most once every 3 s while edits continue); the save deletes it, and at the next start a copy newer than its file is offered as "Unsaved changes found" ("Vellum closed before your last changes to X were saved. Restore them?"; Restore / Discard; the window X decides later). Saves wait at most 2 s under constant editing (debounce 500 ms) and also run when the window loses focus or is hidden. Unlocking a protected profile deletes stale `*.tmp` files and re-encrypts any plaintext file it finds (interrupted conversion). Ids are validated in main (`isSafeId`: `[A-Za-z0-9_-]{1,128}`, no Windows device names) and every read/write/delete must resolve inside the open profile's folder. Wrong passwords / recovery keys are throttled per profile in main (after 3, the next try waits 1 s, then 2, 4… up to 60 s). On quit the open profile is closed (pending writes drained, key zeroed). See docs/SECURITY.md.
- Migration: with no `profiles.json` and legacy `files/*.json` in userData, the first profile created copies them in (encrypting if it has a password), verifies each by reading it back, and only then deletes the legacy files. Any failure rolls the new profile back and leaves the legacy files alone.
- Renderer: `src/renderer/src/profile/`: `profile.ts` (state, `startProfiles`, `enterProfile`, `lockAndReload`, idle auto-lock, `imageFileToAvatar`), `ProfilePicker.tsx` (picker, unlock, recovery, create, recovery-key screens), `ProfileModals.tsx` (Edit / Delete profile), `parts.tsx` (`Avatar`, `PicturePicker`, `RecoveryKeyPanel`). Locking flushes pending saves (`flushAndStop()`), locks in main, then reloads the window so no design stays in renderer memory.
- MCP renders (`main:render_png`) are served from memory through the `vellum-render:` scheme on an in-memory session; nothing is written to %TEMP%.
- `capturePage(rect?: {x,y,width,height}): Promise<string>` takes a rect in CSS px of the window's web contents and returns PNG base64 with no `data:` prefix. Use it for screenshots and exports after rendering the node on screen.
- Bridge: `onBridgeRequest(cb) => unsubscribe`, `bridgeRespond({id, result?|error?})`, `bridgePort()`.

## Store API (`useStore`, `getStore()` in model/store.ts)
State: `ready`, `docs`, `tabs` (always starts with `'dashboard'`), `activeTab`, `recents` (most recent first), `closedTabs`, `scratchpadId`, `editors[docId]: EditorState`, `prefs`, `historyTick`.

The files actions are not undoable:
```ts
createDoc(name?: string, opts?: { open?: boolean }): string   // opens + activates by default
openDoc(id); closeTab(id); setActiveTab(id); reopenClosedTab(); cycleTab(1 | -1); goToLastTab()
renameDoc(id, name); archiveDoc(id, archived: boolean) /* closes tab */; deleteDoc(id) /* no-op for Scratchpad */
setThumbnail(id, dataUrl | undefined)
```
The pages actions are undoable, except `setActivePage`:
```ts
addPage(docId, name?): string /* also activates it */; renamePage(docId, pageId, name)
deletePage(docId, pageId) /* keeps at least one */; setActivePage(docId, pageId)
setPageBackground(docId, pageId, color)   // coalesced, so dragging the picker is one undo step
```
The nodes actions are all undoable:
```ts
createNode(docId, partial: Partial<CNode> & {type}, parentId, index?): string  // applies type defaults
insertHtml(docId, parentId, html, index?): string[]    // root ids; top-level left/top -> x/y
updateStyles(docId, ids, patch: StylePatch, opts?: MutateOptions)   // null/''/undefined removes a key
updateNode(docId, id, patch: Partial<CNode>, opts?)      // id/children/parent in patch are ignored; style replaces
setText(docId, id, text, opts?)                          // auto-renames layers that still have the auto name
renameNode(docId, id, name)
moveNodes(docId, ids, newParentId, index?)               // keeps world position for positioned nodes
deleteNodes(docId, ids); duplicateNodes(docId, ids): string[]   // top-level copies are offset by width+40
addFlex(docId, id)            // column, gap 16, padding 16px, alignItems start, height fit-content
wrapInFlex(docId, ids): string | null   // new transparent flex frame; row/column guessed from geometry
removeFlex(docId, id)         // children -> absolute x/y (measured through the resolver when available)
mutate(docId, label, recipe: (draft: Doc) => void, opts?)   // escape hatch: any draft edit as one undo step
```
`MutateOptions = { coalesce?: string; noHistory?: boolean }`. When consecutive mutations share a `coalesce` key within 1 s, they merge into one undo step. Use this for scrubbing, sliders and live colour drags, e.g. `{coalesce: 'opacity:'+id}`.

The tokens actions are undoable: `setTokens(docId, tokens)`, `upsertTokens(docId, tokens)`, `removeToken(docId, name)`.

The editor actions are not undoable. **Every one takes `docId` first:**
```ts
select(docId, ids, additive?)  // additive toggles each id
setTool(docId, tool); setCamera(docId, Partial<Camera>); setHovered(docId, id|null)
setEditingText(docId, id|null); setWorkingNodes(docId, ids); addWorkingNodes(docId, ids)
```
History: `undo(docId)`, `redo(docId)`, `transact(docId, label, fn)` (nestable; returns fn's result), `canUndo(docId)`, `canRedo(docId)`. After an undo, redo or delete, selection, hover, editing and working ids that point at removed nodes are pruned automatically.

Prefs: `setPref(key, value)`. Prefs are persisted in index.json; use them for the dashboard view mode, zoom options, dismissed cards and so on.

Selectors and helpers: `activeDocId(state)`, `activePage(state, docId)`, `useActiveDoc()`, `useActiveEditor()`, `defaultEditor(doc)`, `DASHBOARD`.

Camera convention: `screen = world * zoom + (camera.x, camera.y)`, relative to the canvas viewport's top-left.

## Model details
- Ids come from `ops.newId(doc)` → `"<n>-0"` (from doc.nextId). Each page has a root node (`type 'frame'`, `parent null`, same name as the page). Page ids are `"p-<rootId>"`, e.g. `p-1-0`.
- Top-level nodes (artboards) have `parent = page.rootId` and x/y in world coordinates.
- Frame defaults are 380×380, `#FFFFFF`, `overflow: clip` and `boxSizing: border-box`. Rect defaults are 100×100 and `#D9D9D9`. Text defaults come from ARCHITECTURE and use `width: 'fit-content'`. Image defaults are 200×200 with `objectFit: cover`. SVG defaults are 24×24.
- ops.ts:
  - `getChildren`, `ancestors` (nearest first, includes the page root), `descendants`, `pageOf`, `topLevelOf`, `isPageRoot`, `isTopLevel`, `isFlex(node)`, `isFlowLayout(style)`, `isFlowChild(doc,id)`, `isPositioned`, `numericSize`, `indexInParent`, `sortByTreeOrder`, `topmostOnly`
  - `makeNode`, `makePage`, `makeDoc`, `insertNode`, `removeNode`, `applyStylePatch`, `reparent`, `cloneSubtree`, `duplicate`, `addFlex`, `removeFlex`, `wrapInFlex`
  - Geometry: `setWorldRectResolver(fn)`, `worldRect(doc,id)`, `modelWorldPosition(doc,id)`
- **World-rect resolver:** the model can't know the size of fit-content boxes or flow-child positions. The canvas registers `setWorldRectResolver((docId, id) => WorldRect | null)`, which measures `[data-node-id]` elements. The placeholder CanvasView already does this. `reparent`/`wrapInFlex`/`removeFlex`/`get_basic_info` use it, so **keep `data-node-id` on rendered nodes and keep registering a resolver.**
- html.ts:
  - `computeNodeStyle(doc, id, {asRoot?, export?})` returns the node's CSS for rendering and export. It adds `position:absolute; left; top` for positioned non-top-level nodes, `position: relative` on non-flow containers with children, `white-space: pre-wrap` on text (render only) and `display: none` when hidden.
  - `htmlToNodes(html, doc)` adds nodes to the draft and returns root ids with `parent: null`. Tag handling:
    - Text-only elements become `text`. `<br>` becomes `\n`, and unstyled inline formatting is flattened. `<p>`, `<h1>` and similar also flatten styled spans.
    - `<img>` becomes `image`, with `attrs.src`/`alt` and the width/height attributes as style.
    - `<svg>` becomes `svg`. `node.svg` holds the inner markup, `attrs` holds viewBox and the other attributes, and width/height come from the attributes or the viewBox.
    - Everything else becomes `frame`.
    - A block container (no display) with flow children is turned into `display:flex; flex-direction:column` (stretch) so it looks like browser block flow; if every flow child is inline-level (span, img, button…) it becomes a wrapping baseline row that follows `text-align`.
    - `htmlToNodes(html, doc, {topLevel})`: only roots written into a page root use left/top as world x/y. Elsewhere `position:absolute` keeps px left/top as x/y, and a missing left/top is stored as `'auto'` so right/bottom anchoring works (`ops.anchoredAxes`). Such nodes read as Right/Bottom constraints (`ops.getConstraints`); gestures keep them through `ops.detachAnchors` + `ops.restoreConstraints` (see docs/CANVAS.md).
    - `data-name` sets the layer name.
    - The original tag is kept as `attrs.tag`. It is used on export and never emitted as an attribute.
  - Inline style parsing: unitless numbers become numbers, other units stay strings, and `width`/`height` in px become numbers.
  - `nodeToHtml(doc, id)` and `nodeToJsx(doc, id, 'inline-styles' | 'tailwind')`. Tailwind currently falls back to inline styles. Hidden children are skipped.
- Rendering rule: children of **flex or grid** parents flow; all other children are absolute at x/y. `isFlowLayout` treats grid as flow.
- Canvas content inherits `CANVAS_CONTENT_DEFAULTS` (system-ui 16px, line-height normal, #000; `editor/canvas/contentDefaults.ts`, re-exported from CanvasView). Text-tool text gets explicit 16/20. `Doc.version` (ops.DOC_VERSION = 2); `ops.migrateDoc` runs on load and gives v1 text that relied on the old inherited 20px an explicit `lineHeight: '20px'`. Tokens are applied as CSS custom properties on the world container.

## UI primitives (`src/renderer/src/ui`, all exported from `ui/index.ts`)
- `Button {variant?: 'default'|'primary'|'ghost', size?: 'sm'|'md' (24/28), icon?, shortcut?, full?, ...button}`
- `IconButton {icon, label? (tooltip + aria), shortcut?, tooltipSide?, active?, accent?, size? = 24, ...button}`
- `Field {label? (text or icon; drag to scrub), value, onChange(v), onScrub?(v), onScrubStart?, onScrubEnd?, type?, unit?, min?, max?, step?, precision?, placeholder?, keywords? (e.g. ['Fit','Fill']), mono?, size?, disabled?, trailing?, title?}`
  - ↑/↓ changes the value by ±step and Shift+↑/↓ by ±10×. Enter commits and selects the text, Esc reverts, blur commits.
  - Alt-drag on the label scrubs in 0.1× steps.
  - Input accepts arithmetic like `10+5*2`.
  - Key events inside the input are stopped from propagating.
- `Segmented {value, options: {value, label?, icon?, title?, shortcut?}[], onChange, size?, full?}`
- `Select {value, options: (SelectOption | 'separator')[], onChange, placeholder?, icon?, size?, variant?: 'field'|'ghost', renderValue?, menuMinWidth?}`
- `Menu {open, onClose, anchor, items: MenuEntry[], placement?, offset?, minWidth?, ignore?}`
  - `MenuEntry = {label, shortcut?, icon?, checked?, disabled?, danger?, onSelect?, submenu?, keepOpen?} | {type:'separator'} | {type:'heading', label}`.
  - Keyboard: ↑ ↓ → ← Enter Esc Home End. Submenus open on hover.
- `ContextMenu {at: {x,y} | null, items, onClose}`. The hook `useContextMenu()` returns `{open(e, items), close, element}`; render `element`.
- `Popover {open, onClose, anchor: HTMLElement | DOMRect | {x,y} | null, placement? ('bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'right-start' | 'left-start' | 'point'), offset?, ignore?, closeOnOutside?, autoFocus?}`
  - Nested popovers work: clicks inside a later-opened popover don't close earlier ones, and Esc closes only the topmost.
  - `isPopoverOpen()` tells you whether one is open.
- `Tooltip {label, shortcut?, side?, delay? = 600, disabled?, children: single element}`. It renders "Name  Ctrl + Shift + I" and shows instantly when moving between tools.
- `Checkbox {checked, onChange, label?, shortcut?, disabled?}`
- `Slider {value, min?, max?, step?, onChange, onChangeStart?, onChangeEnd?, fill?}`
- `Modal {open, onClose, title?, width?, height?, footer?, bare?, children}`
- `Section {title, empty?, onAdd?, onRemove?, actions?, onTitleClick?, children}`. Empty sections have a muted title and no body. `Row` is a flex row with an 8px gap.
- `ColorPicker {value, onChange(color, {live}), previous?, onClose?}` and `ColorPickerPopover {open, anchor, onClose, ...}`.
  - Emitted colours are `#RRGGBB`, or `#RRGGBBAA` when alpha < 1.
- `ColorRow {value (colour or var(--token)), onChange(color, {live}), onTokenClick?(anchorEl), showToken?, showEyedropper?, resolveToken?(name), trailing?}`
  - The swatch opens the picker. The eyedropper uses the Chromium EyeDropper API.
  - Pass `{coalesce}` to the store when `live` is true.
- `Swatch`, `pickScreenColor()`
- color.ts: `parseColor`, `formatColor`, `toHex6`, `rgbToHsv`/`hsvToRgb`, `rgbToHsl`/`hslToRgb`, `cssRgba`, `tokenRef`
- shortcut.ts: `formatShortcut(s, spaced)`, `matchShortcut(e, 'Ctrl+Shift+Z')`

Styling: plain CSS with a `.c-` prefix in `ui/ui.css`. The tokens in `styles/tokens.css` include:
- Surfaces: `--bg-canvas`, `--bg-panel`, `--bg-menu`, `--hairline`
- Controls: `--control-bg`, `--control-hover`, `--segment-active`, `--row-selected(-strong)`
- Text: `--text`, `--text-2`, `--text-3`, `--text-4`
- Accent and agent: `--accent`, `--agent-teal`
- Primary button: `--primary-bg`, `--primary-text`
- Shape and elevation: `--radius`, `--radius-menu`, `--raised-shadow`, `--menu-shadow`
- Fonts: `--font-ui`, `--font-mono`
- Sizes: `--left-w`, `--toolbar-w`, `--inspector-w`, `--control-h` (28), `--control-h-sm` (24), `--row-h`

Use CSS modules or your own prefixed CSS file for feature styles.

## Where to hook things
- **Editor shortcuts** (tools V/F/R/T…, Delete, Ctrl+D, arrows, Shift+A…) go in a new `editor/shortcuts.ts`, installed from the Editor or canvas.
  - App shortcuts are already handled in `shell/commands.ts`: Ctrl+N/T/W, Ctrl+Shift+T/W/D, Ctrl+Tab/Shift+Tab, Ctrl+9, Ctrl+M, Ctrl+R, F11, F12, and Ctrl+Z/Shift+Z/Y.
  - Ctrl+Z is skipped while typing in an input.
  - Ctrl+Shift+I toggles devtools only on the Dashboard; in the editor it is free for "Create image".
  - Check `e.defaultPrevented`, or call `preventDefault()` in your own handlers.
- **Cut/Copy/Paste/Select All** from the Edit menu, when focus isn't in a text field, dispatch `window` `CustomEvent('canvas:command', {detail: {command}})` (`CANVAS_COMMAND_EVENT`). The canvas should listen for it.
- **Bridge tools**: in `bridge/` (e.g. a new `bridge/tools.ts` imported from `main.tsx`), call `registerHandler('write_html', async (args) => …)`. Use `resolveDocId(args)` for `fileId`. Throwing an Error returns `{error}`. Results must be JSON-serialisable.
- **Working nodes (agent outline)**: `setWorkingNodes`/`addWorkingNodes`. Clear them with `setWorkingNodes(docId, [])`.

## Deviations from ARCHITECTURE.md
- Editor actions (`setTool`, `setCamera`, `setHovered`, `setEditingText`) take `docId` as their first argument.
- New actions:
  - Files: `reopenClosedTab`, `cycleTab`, `goToLastTab`, `setThumbnail`
  - Nodes: `addFlex`, `mutate`
  - Editor: `setWorkingNodes`, `addWorkingNodes`
  - History: `canUndo`, `canRedo`
  - Prefs: `setPref`
- New optional `opts` (`coalesce`, `noHistory`) on `updateStyles`, `updateNode` and `setText`.
- `Doc.scratchpad?: boolean` marks the permanent draft. `deleteDoc` and `archiveDoc` ignore it.
- `attrs.tag` stores the original HTML tag of imported nodes.
- `StylePatch` type: `null`, `''` or `undefined` removes a key.
- The index file shape is `IndexData` in `src/shared/api.ts`: `{recents, tabs, activeTab, scratchpadId, prefs}`.
- Doc ids are 12-char nanoids.
- "New Tab" (Ctrl+T) creates a new file, the same as `+`. "New Window" is disabled.
- On first run the Dashboard is active and the Scratchpad tab is open.
