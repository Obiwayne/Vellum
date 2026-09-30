# Vellum MCP server

The MCP server lets Claude Code (or any MCP client) design inside the running Vellum app.

## Setup

```
cd <path-to-Vellum>\mcp
npm install
npm run build                     # tsc → mcp/dist/index.js
claude mcp add vellum -- node <path-to-Vellum>/mcp/dist/index.js
```

Start Vellum with `npm run dev` in `<path-to-Vellum>` (or run the built app). The MCP server can start before the app does: it connects on the first tool call and reconnects if the app restarts.

| Env var | Default | Purpose |
|---|---|---|
| `VELLUM_PORT` | `29170` | Bridge WebSocket port. The app and the MCP server must use the same value. `CANVAS_PORT` (the pre-rename name) is still accepted as a fallback. |
| `VELLUM_USER_DATA` | `%APPDATA%\Vellum` | The app's data folder, where the MCP server reads the bridge secret (`bridge-token`). Set it to the same folder as the app's `VELLUM_USER_DATA` for test instances, or when the app runs with `--user-data-dir`. |
| `VELLUM_EXPORT_DIR` | `%USERPROFILE%\Downloads\Vellum` | Export folder: `export` writes here, and a relative `outputDir` is a subfolder of it (`CANVAS_EXPORT_DIR` is still accepted). |
| `VELLUM_EXPORT_ROOTS` | – | More folders `export` may write into when the agent passes an absolute `outputDir` (separated by `;` on Windows, `:` elsewhere). Any other folder is refused, symlinks and junctions can't be used to get out, and existing files are never overwritten (` (2)` is added). |

**Bridge authentication.** The bridge only accepts local connections that present the app's secret. On first
start the app writes 32 random bytes (hex) to `<userData>\bridge-token` (`%APPDATA%\Vellum\bridge-token`). The MCP
server reads that file on every connect and sends it in the `x-vellum-token` header. Handshakes that carry an
`Origin` header (every browser does) or a foreign `Host` are refused, so web pages can't reach the bridge. No
configuration is needed. See `docs/SECURITY.md`.

To use a non-default port: `claude mcp add vellum -e VELLUM_PORT=29174 -- node <path-to-Vellum>/mcp/dist/index.js`

## Response format

Every file-scoped tool returns two text blocks:
1. A header: `{"file":{"id","name"},"contentHash":{"tokens"}}`
2. The body (JSON, or plain text for `get_jsx` and the css/tailwind forms of `get_tokens`).

`get_screenshot` returns the header, an `image/png` block and `{nodeId,width,height}`. Errors come back as `isError: true` with a message. If the app isn't reachable, the message is: *"Vellum app is not running — start it with npm run dev (or the built app) in <path-to-Vellum>"*.

The server's `instructions` tell the model to load `get_guide({topic:"vellum-mcp-instructions"})` first. `"canvas-mcp-instructions"` (the pre-rename topic) is accepted as an alias.

## Tools

`fileId` is optional on every tool and defaults to the file the user is viewing (falling back to the most recent file). `pageId` defaults to the page the user is viewing.

| Tool | Arguments | Result |
|---|---|---|
| `get_guide` | `topic` (`vellum-mcp-instructions`, `mobile-status-bar`) | guide text |
| `get_basic_info` | `fileId?, pageId?` | `fileName, pageName, pageId, rootNodeId, nodeCount, artboardCount, artboards[{id,name,childCount,width,height,worldX,worldY}], pages[{id,name,isActive}], fontFamilies, tokens{items[{name,value}]}` |
| `list_files` | `limit?` | `files[{id,name,updatedAt,createdAt,open,active,pageCount}], count` |
| `open_file` | `fileId, pageId?` | opens and activates the tab, then returns `get_basic_info` |
| `create_file` | `name?, cloneFileId?` | `{fileId, name}` (not opened; call `open_file`) |
| `create_page` | `name?` | `{pageId, name, rootNodeId}` (the user's current page stays active) |
| `rename_pages` | `updates[{pageId,name}]` | per-entry results |
| `create_artboard` | `name, styles, pageId?` | `{id, nodeId, name, pageId, worldX, worldY, width, height}`. Placed 80px to the right of existing artboards unless `left`/`top` are given. Defaults to a flex column. |
| `write_html` | `html, targetNodeId ('root' ok), mode: insert-children \| replace` | `{createdNodeIds, nodeCount, parentId, tree}` |
| `update_styles` | `updates[{nodeIds, styles}]` (`null` or `''` removes a key; `left`/`top` on positioned nodes move them) | `{updatedNodeIds, notFound?}` |
| `set_text_content` | `updates[{nodeId, textContent}]` | per-entry results |
| `rename_nodes` | `updates[{nodeId, name}]` | per-entry results |
| `duplicate_nodes` | `nodes[{id, parentId?}]` | `duplicates[{sourceId,newId,parentId,descendantIdMap}], newNodeIds` |
| `move_nodes` | `moves[{nodeId, before \| after \| parentId+index?}]`, or `nodeIds, targetParentId, index?` | `results, affectedParents` |
| `delete_nodes` | `nodeIds` | `{deletedNodeIds, deletedCount}` |
| `get_selection` | – | `selectedNodes[{id,name,component,width,height,worldX,worldY,x,y,artboardId,artboardName,parentId,childCount}]` |
| `get_children` | `nodeId` | `children[{id,name,component,childCount,width,height,worldX,worldY,x,y}]` |
| `get_node_info` | `nodeId` | `id,name,component,width,height,worldX,worldY,x,y,isVisible,isLocked,parentId,childIds,childCount,artboardId,textContent` |
| `get_tree_summary` | `nodeId, depth=3 (max 10)` | `{summary: 'Frame "Hero" (id) 1440×900\n  Text "Title" (id) 320×40 "…"', nodeId, depth}` |
| `find_nodes` | `query \| name, type, textValue, filters[{styleName,styleValue}], pageId?, nodeId?` | `nodes[{id,name,component,pageId,artboardId,matched}]` |
| `get_jsx` | `nodeId, format: tailwind (default) \| inline-styles` | JSX string |
| `get_computed_styles` | `nodeIds` | `{styles:{[id]: CSSProperties}}`. Text nodes include their inherited typography, read from the live DOM when the node is on screen. |
| `get_screenshot` | `nodeId, scale=1` (max 4) | PNG image at full size (large nodes are captured in tiles, never with scrollbars); only clamped to the MCP image limit (8000 px per side, ~5 MB) |
| `export` | `nodeId + format + scale`, or `nodes{[id]:[{format,scale}]}`, or `pageId` (all artboards); `outputDir?` | `{outputDir, exported[{nodeId,name,format,path,width?,height?}]}`. Formats: `png`, `jpg`, `svg` (HTML in `foreignObject`), `html` (standalone page), `jsx` (component file). Scale can be `2`, `"2x"`, `"512w"`, `"512h"` or `"720p"`. |
| `get_tokens` | `format: json \| css \| tailwind, types?, namePattern?` | tokens (type is inferred from the Tailwind v4 namespace) |
| `set_tokens` | `tokens[{name, newName?, value?, delete?}]`, or `replace: true` with the full list | per-entry results. A rename rewrites `var(--old)` references across the file. |
| `create_tokens` | `tokens[{name, value, type?}]` (upsert) | `{name, result: created \| updated}` per entry |
| `get_font_family_info` | `familyNames` | `fontsPerFamily{family:[{style,weight,isItalic,axes?}]}, sources, notFound?` |
| `finish_working_on_nodes` | `nodeIds?` | `{released, remaining}` |
| `list_comment_threads` / `get_comment_thread` / `set_comment_thread_status` | – | Vellum has no comments: returns an empty list, or "not found" |

Each mutating tool call is a single undo step in the app (`store.mutate` / `store.transact`). Nodes created or edited by the agent put their **artboard** into `editor.workingNodes`, which the canvas draws with the teal outline and orange glow. `finish_working_on_nodes` clears them.

## Architecture

```
Claude Code ──stdio──▶ mcp/dist/index.js ──ws://127.0.0.1:29170──▶ src/main/bridge.ts
                         │                                           │  tool "main:*" → src/main/offscreen.ts (hidden offscreen window)
                         │                                           └─ other tools → IPC 'bridge:request' → renderer
                         │                                                           src/renderer/src/bridge/*  (store actions)
                         └─ local tools: get_guide, get_font_family_info (PowerShell + Google Fonts metadata)
```

- **mcp/src/index.ts** registers the tools (zod schemas), forwards them over the bridge and formats the header and body blocks. `bridge.ts` is the WebSocket client, which connects lazily and reconnects. `guide.ts` holds the server instructions and guides. `fonts.ts` handles font lookup. `render.ts` builds standalone documents.
- **Renderer bridge** (`src/renderer/src/bridge/`):
  - `registry.ts`: handler map, `resolveDocId` / `resolvePage`, geometry, header, working-node helpers.
  - `tools-files.ts`: basic info, files, pages, tokens, finish, comments.
  - `tools-read.ts`: selection, children, node info, tree, find, computed styles.
  - `tools-write.ts`: artboard, write_html, styles, text, rename, duplicate, move, delete.
  - `tools-render.ts`: get_jsx and the internal `_render_node` payload.
  - `tailwind.ts`: style → Tailwind v4 classes.
  - `handlers.ts`: installs the IPC listener. Requests run one at a time, and each one waits a tick so React has committed earlier mutations before anything is measured.
- **Geometry.** When a node is on the page the user is viewing, sizes and positions are measured from the DOM through the canvas's world-rect resolver. Otherwise the artboard is rendered into a hidden container in the renderer document (`bridge/measure.ts`, cached per doc version) and measured there; only hidden nodes fall back to model arithmetic (`null` / `?`).
- **Screenshots and export.** `_render_node` returns the node's markup the way the canvas renders it, along with the tokens as `:root` CSS, the font stacks, the inherited text styles and the measured size. The MCP server adds Google Fonts `<link>`s for any families that aren't installed locally, plus a reset that mirrors the canvas. It then sends the document to `main:render_png`. The main process loads it in a hidden offscreen `BrowserWindow` (in-memory partition `vellum-render`; the HTML is served from memory through the `vellum-render:` scheme, never written to disk), waits for fonts and images (up to 6 s), measures the node, applies `zoom` for the scale, and `capturePage`s exactly the node's rect. This works when the node is off-screen, zoomed, or on another page. The window is destroyed along with the main window.
- **Fonts.** Local fonts come from one PowerShell call that reads the Windows font registry and the GDI+ family list, cached per process. Google Fonts come from `https://fonts.google.com/metadata/fonts`, cached for 7 days in `%LOCALAPPDATA%\Vellum\google-fonts-metadata.json`.

## Testing

```
# terminal 1: a separate data folder (VELLUM_USER_DATA) keeps your real profiles out of it and avoids the
# single-instance lock of another running Vellum
set VELLUM_USER_DATA=%TEMP%\vellum-e2e && set VELLUM_PORT=29174 && npx electron-vite dev
#   first run: create a profile in the window (no password is fine); the tools need an open profile
# terminal 2
cd mcp && npm run build && set VELLUM_USER_DATA=%TEMP%\vellum-e2e && set VELLUM_PORT=29174 && node test/e2e.mjs [outDir]
node test/regress.mjs   # regression checks for docs/BUGS.md (reuses a "regress (temp)" file)
npm run test:profiles   # profile store + encryption (no app needed)
node test/security.mjs  # bridge authentication, content sanitising, offscreen-render script blocking
```

The tools only ever see the profile that is open in the app. With the picker or lock screen showing, every tool
fails with "Vellum is locked — open your profile in the app first", and `list_files` lists only the open profile's files.

`test/e2e.mjs` covers the following, then cleans up after itself (set `KEEP=1` to keep the artboard):
- guide, files, basic info, tokens, fonts
- create_artboard, write_html (twice), update_styles, text, rename
- duplicate, move, delete
- tree, children, find, JSX (both formats), computed styles
- screenshots at 1x and 2x, which are saved to outDir
- export to png, svg, html and jsx
- selection, comments, finish

## Troubleshooting

- **"Vellum refused the connection (bridge authentication failed)"**: the MCP server couldn't read the right
  `bridge-token`. The app and the MCP server must use the same data folder (`VELLUM_USER_DATA`) and port. An MCP
  server process started with an older build doesn't send the token, so restart it (restart Claude Code).
- **"Vellum app is not running"**: start the app, and check that `VELLUM_PORT` matches on both sides. The app logs `[bridge] listening on ws://127.0.0.1:<port>` at startup.
- **Bridge port already in use** (`[bridge] server error: listen EADDRINUSE`): another Vellum instance owns the port. Close it, or run both sides with a different `VELLUM_PORT`.
- **The app quits immediately in dev**: the single-instance lock is held by another Vellum that uses the same user-data-dir. Pass `-- --user-data-dir=<dir>`.
- **"Vellum is locked — open your profile in the app first"**: the app shows the profile picker or a protected profile is locked. Open the profile in the app.
- **"No file is open"**: the dashboard is active and no files exist. Call `create_file` then `open_file`.
- **Sizes are `null` / `?`**: the node is hidden (`display: none`), so it has no layout. Nodes on other pages or in files that aren't open are measured offscreen.
- **Fonts look different in screenshots than on the canvas**: screenshots load Google Fonts over the network. If you're offline, a fallback font is used.
- **Timeouts**: renderer tools time out after 30 s (main bridge). Renders time out after 90 s (MCP side).
