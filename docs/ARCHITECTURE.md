# Vellum — architecture

A local-first desktop design tool that uses a compact dark editor layout and a real-HTML/CSS editing model
(designs are real HTML/CSS), with no accounts, teams or billing, plus an MCP server so Claude can design in it.
UI conventions: fixed panel widths, 12px Inter UI, dark colour tokens (`src/renderer/src/styles/tokens.css`),
consistent menus and shortcuts. The product name is "Vellum".

## Stack
- Electron + electron-vite + React 18 + TypeScript (strict). Frameless window with custom title bar.
- State: zustand + immer (with `enablePatches`) for undo/redo.
- Icons: `lucide-react` (thin 1.5px icons), size 16 in panels, 20 in toolbar.
- Fonts: Inter + DM Mono via `@fontsource-variable/inter` and `@fontsource/dm-mono` (bundled, offline).
- MCP: `mcp/` package, Node, `@modelcontextprotocol/sdk` (v1.x), stdio transport, talks to the app over WebSocket.
- Package manager: npm. Node 22.

## Folder layout
```
<path-to-Vellum>
  package.json               electron-vite app
  electron.vite.config.ts
  src/main/                  Electron main: window, menu IPC, file storage, bridge WS server
  src/preload/               contextBridge api: window.canvasApi
  src/renderer/index.html
  src/renderer/src/
    main.tsx, App.tsx        App = TitleBar + (Dashboard | Editor) by active tab
    styles/tokens.css        UI design tokens (CSS vars) from NOTES §1
    styles/global.css
    model/types.ts           Doc, Page, Node, Token types
    model/store.ts           zustand store (docs, tabs, editor state) + actions
    model/history.ts         undo/redo (immer patches), transactions
    model/ops.ts             pure node operations (create, move, reparent, duplicate, delete, html import/export)
    model/html.ts            htmlToNodes(html) and nodeToJsx/nodeToHtml(node)
    model/persist.ts         load/save via window.canvasApi
    ui/                      primitives: Button, IconButton, Field (label+number/text input w/ drag-to-scrub),
                             Segmented, Select, Menu/ContextMenu (with submenus+shortcuts), Popover, Tooltip,
                             Checkbox, Slider, ColorPicker, Modal, Section (inspector section w/ title + '+')
    shell/TitleBar.tsx       hamburger menu, tabs, window buttons
    dashboard/               Dashboard (sidebar, Recents grid/list, New file, Files, Archive, Settings(local prefs only))
    editor/Editor.tsx        LeftPanel | Toolbar | CanvasView | Inspector
    editor/left/             LeftPanel: header, Design|Theme, Pages, Layers tree, Theme tokens
    editor/toolbar/          Toolbar
    editor/canvas/           CanvasView: camera, render nodes, selection overlay, handles, tools, snapping, context menus
    editor/inspector/        Inspector sections
    editor/comments/         Comment tool UI: pins + thread card (CommentsLayer), Comments tab (CommentsPanel)
    editor/shortcuts.ts      global keyboard shortcuts
    bridge/                  handlers that execute MCP commands against the store (renderer side)
  mcp/                       MCP server package (own package.json, builds to mcp/dist/index.js)
  docs/                      this file, MCP.md
```

## Document model (`model/types.ts`) — the shared contract
```ts
export type NodeType = 'frame' | 'rect' | 'text' | 'image' | 'svg';
export type Style = Record<string, string | number>;   // React CSSProperties keys (camelCase)
export interface CNode {
  id: string;               // short unique id, e.g. "1-0" style counter per doc ("<page#>-<n>")
  type: NodeType;
  name: string;             // layer name ("Frame", "Rectangle", text content preview for text)
  parent: string | null;    // page root id for top-level (artboards)
  children: string[];
  style: Style;             // full CSS of the node. Top-level + absolutely positioned nodes use left/top in style? NO:
  x: number; y: number;     // position: world coords for top-level; offset within parent when parent is not flex
                            // or style.position === 'absolute'. Ignored for flex-flow children.
  text?: string;            // text nodes (plain text; newlines allowed)
  svg?: string;             // svg nodes: inner markup of <svg>, with style.width/height + viewBox in `attrs`
  attrs?: Record<string, string>; // extra HTML attrs (viewBox, src, alt)
  visible: boolean;
  locked: boolean;
}
export interface Page { id: string; name: string; rootId: string; background: string /* '#282828' */ }
export interface Token { name: string; value: string }   // name like '--color-gray-50'
export interface Doc {
  id: string; name: string; pages: Page[]; nodes: Record<string, CNode>;
  tokens: Token[]; nextId: number; createdAt: number; updatedAt: number; archived?: boolean;
  thumbnail?: string;       // data URL, optional
  comments?: CommentThread[]; // pinned threads {id, number, pageId, nodeId|null, ox, oy, x, y, status, messages[]}
}
```
Rules
- Width/height live in `style.width` / `style.height` (number = px, or 'fit-content' = "Fit", '100%' = "Fill").
- Flex is plain CSS on the frame: `display:'flex', flexDirection, gap, padding, alignItems, justifyContent, flexWrap`.
- Children of a non-flex frame are rendered `position:absolute; left:x; top:y`. Children of a flex frame flow unless
  `style.position==='absolute'`.
- Frames default `overflow:'clip'` (Clip content) and `backgroundColor:'#FFFFFF'`.
- Text defaults: `fontFamily:'system-ui, sans-serif', fontSize:16, lineHeight:'20px', color:'#000000'`, width 'fit-content'.
- Rect defaults: `backgroundColor:'#D9D9D9'`.
- Tokens are applied by injecting `:root{...}` CSS into the canvas scope, so `var(--color-x)` works in node styles.

## Store (`model/store.ts`) — the shared API (all panels and the bridge use ONLY these)
```ts
interface EditorState { docId; pageId; selection: string[]; hovered: string|null; tool: Tool;
  camera: {x:number;y:number;zoom:number}; editingTextId: string|null; workingNodes: string[] /* agent */ }
type Tool = 'move'|'pan'|'frame'|'rect'|'pen'|'text'|'comment'|'shader'|'image'|'svg';
interface Store {
  docs: Record<string, Doc>; tabs: string[] /* 'dashboard' | docId */; activeTab: string;
  editors: Record<string /*docId*/, EditorState>;
  // files
  createDoc(name?): string; openDoc(id); closeTab(id); setActiveTab(id); renameDoc(id,name); archiveDoc(id,bool); deleteDoc(id);
  // pages
  addPage(docId,name?): string; renamePage(docId,pageId,name); deletePage(docId,pageId); setActivePage(docId,pageId); setPageBackground(...)
  // nodes (all undoable)
  createNode(docId, partial: Partial<CNode> & {type}, parentId, index?): string;
  insertHtml(docId, parentId, html, index?): string[];      // uses model/html.ts
  updateStyles(docId, ids: string[], patch: Style /* value null removes */);
  updateNode(docId, id, patch: Partial<CNode>);
  setText(docId, id, text); renameNode(docId,id,name);
  moveNodes(docId, ids, newParentId, index?); deleteNodes(docId, ids); duplicateNodes(docId, ids): string[];
  wrapInFlex(docId, ids); removeFlex(docId,id);
  // tokens
  setTokens(docId, tokens: Token[]); upsertTokens(docId, tokens); removeToken(docId, name);
  // editor
  select(docId, ids, additive?); setTool; setCamera; setHovered; setEditingText;
  undo(docId); redo(docId); transact(docId, label, fn)   // groups several mutations into one undo step
}
```
Persistence: every doc is saved (debounced 500ms) by the main process to the open profile's folder,
`%APPDATA%/Vellum/profiles/<profileId>/files/<id>.json`; `index.json` next to `files/` keeps recents, open tabs and prefs.
Profiles (`src/main/vault.ts`): `profiles.json` lists them (name, avatar, colour, KDF params, wrapped data keys). A profile
with a password has every file AES-256-GCM encrypted (`VLME` header, version, IV, tag, ciphertext) with a random data key
that is wrapped by an scrypt password key and by a recovery key; the key only lives in main-process memory while the
profile is open. The renderer shows a profile picker (`src/renderer/src/profile/`) until a profile is open. On first run create a "Scratchpad" doc (permanent draft, can't be deleted).

## Version history
- Main: `src/main/history.ts`, stored per profile in `history/<docId>/` (encrypted like the rest of the profile):
  `index.json` (VersionMeta[], newest first), `<versionId>.bin` (gzipped doc JSON whose strings >= 4 KB — images —
  are replaced by refs) and `blobs/<sha1>.bin` (each big string once, shared by all versions).
- Automatic versions: `saveDoc` calls `beforeSave` first; when the newest version is older than 5 minutes
  (`VELLUM_HISTORY_INTERVAL_MS` overrides it for tests) the doc as it is on disk, i.e. the state before this
  save, becomes a version. So the last state before every break is kept. The newest 100 automatic versions are
  kept; `named` and `restore` versions are never pruned. Deleting a doc deletes its history.
- Each version stores a `summary` (counts from `src/shared/docDiff.ts`, which both processes use) of the changes
  since the previous version; deleting a version recomputes its newer neighbour's summary.
- Renderer: `src/renderer/src/history/`. `HistoryView` replaces the dashboard/editor while `store.historyDocId`
  is set (dashboard `…` → History, File menu, `Ctrl+Alt+H`); `VersionCanvas` is a read-only pan/zoom render
  with added/edited layers outlined. Restore saves the current state as a `restore` version, then replaces
  pages/nodes/tokens/modes in one undoable `mutate` (name, folder and comments are kept).

## Bridge / MCP
- Electron main runs a WebSocket server on `ws://127.0.0.1:29170` (env `VELLUM_PORT`). Messages `{id, tool, args}` → main
  forwards to renderer via IPC → `bridge/handlers.ts` executes against the store and returns `{id, result|error}`.
- `get_screenshot`/`export` use `webContents.capturePage` on an offscreen render of the node (renderer provides rect),
  or render the node's HTML in a hidden BrowserWindow. PNG base64 returned.
- `mcp/` exposes the design tools listed in docs/MCP.md. Registered in Claude Code as
  `claude mcp add vellum -- node <path-to-Vellum>/mcp/dist/index.js`.
- While the agent works on nodes they appear in `workingNodes` → canvas outlines them in teal with a label, and the
  `finish_working_on_nodes` clears it.

## Out of scope
Accounts, teams, billing, sharing, multiplayer, AI image generation.
