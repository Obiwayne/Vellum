# Canvas, toolbar and editor shortcuts

The canvas code lives in `src/renderer/src/editor/canvas/`. The toolbar is in `editor/toolbar/Toolbar.tsx`, and every editor keyboard shortcut is in `editor/shortcuts.ts`.

## What's implemented
- **Rendering**
  - Nodes render as real DOM in a world container. Only the world container is transformed by the camera.
  - Each `NodeView` subscribes to its own node object, so a mutation re-renders only the nodes it changed.
  - Tokens are applied as CSS vars on the world container. Text, image and SVG nodes are supported.
- **Frame labels**
  - Top-level frames show their name as a label above the frame (muted; accent when the frame is selected or hovered).
  - Click or drag a label to select or move the frame. Double-click it to rename.
- **Camera**
  - Wheel or trackpad scrolling pans. Ctrl+wheel and pinch zoom at the cursor. Zoom ranges from 2% to 25600%.
  - You can also pan with Space+drag, middle-drag or the Pan tool.
  - A pixel grid appears at 800% zoom and above.
- **Selection** (`selection.ts`)
  - Picking: a click on an artboard child selects the child directly under the artboard. Double-click drills one level deeper, or edits text. Ctrl/Meta+click selects the deepest node.
  - Shift+click toggles a node in the selection.
  - A marquee selects top-level nodes; for an artboard it only partly covers, it selects the children it touches.
  - Hovered nodes get an outline. Locked nodes can't be picked.
- **Selection overlay**
  - 1px accent outlines, 4 corner handles, and resizable edges.
  - A size badge: `380 × 380`, `300 × Fit 208`, `Fill …`.
- **Move**
  - Positioned nodes move live, snapping to sibling/parent edges and centres (pink guides) and to whole pixels. Shift locks the axis, Alt+drag duplicates, and Ctrl disables snapping.
  - Flow (flex) children drag as a ghost, and an insertion line marks the drop position. You can reorder them within the parent, or drop them into another frame or onto the canvas.
  - Dropping a node on a different frame reparents it. Artboards are never reparented by dragging.
  - Each drag or resize is a single undo step (`history.begin/end`).
- **Resize** works from corners and edges, and for multi-selections. Shift keeps the aspect ratio, and Alt resizes from the centre.
- **Tools**
  - Frame (F), Rectangle (R) and Shaders (S) are drag-to-create; S makes a gradient "Shader" frame. A click without a drag creates a 100×100 node. The new node becomes a child of the frame under the pointer, and is appended when that frame is flex.
  - Text (T): click, then type. Esc or clicking away commits, and an empty new text node is removed.
  - Pen (P): click points, then Enter, Esc or double-click to finish. Clicking the first point closes the path. Shift snaps angles to 45°. The result is an SVG `<path>` with a 1.5px black stroke.
  - Comment (C) only shows a notice.
  - Create image (Ctrl+Shift+I) opens a file picker and inserts the image as a data URL.
  - Create SVG (Ctrl+Shift+J) opens a paste-markup dialog.
  - After you create something, the tool returns to Move.
- **Context menus** (`menus.ts`) cover the node menu and empty-canvas menu, and every item works. "Cursor chat" is disabled.
- **Agent working state**: nodes in `workingNodes` get a teal outline with a "Claude" tag. While any are present, the viewport shows the orange inset glow.
- **World-rect resolver**: still registered through `ops.setWorldRectResolver`, and it measures `[data-node-id]`.

## Shortcuts (editor/shortcuts.ts, capture phase)
| Area | Shortcuts |
|---|---|
| Tools | V, F, R, P, T, C, S |
| Selection | Esc (tool→Move, else select parent), Enter (select children / edit text), Shift+Enter (parent), Tab / Shift+Tab (siblings), Ctrl+A (select all siblings) |
| Edit | Delete / Backspace, arrows (1) / Shift+arrows (10), Ctrl+D, Ctrl+C / X / V |
| Paste variants | Ctrl+Shift+V (paste on top), Ctrl+Shift+R (paste to replace) |
| Styles | Ctrl+Alt+C / Ctrl+Alt+V |
| Structure | Shift+F (frame selection), Shift+A (add flex, or wrap in flex), Alt+C (clip content) |
| Order | ] and [ (front / back), Ctrl+] and Ctrl+[ (forward / backward) |
| Visibility | Ctrl+Shift+H (show/hide), Ctrl+Shift+L (lock/unlock) |
| Other | Ctrl+L (copy link), N / Shift+N (next / previous artboard), `.` (Hide UI) |
| Zoom | + / = and -, Shift+0 (100%), Shift+1 (fit), Shift+2 (selection), Ctrl+0 |
| Prefs | Shift+' (pixel grid), Ctrl+Shift+' (snap to pixel) |

Nudging a flex child moves it one position along the flex axis.

Clipboard behaviour:
- Copy writes an internal clipboard plus `text/html` and `text/plain` (from `nodeToHtml`) to the system clipboard.
- Paste uses the internal clipboard when the system clipboard still holds that copy.
- Otherwise it pastes HTML or SVG through `insertHtml`, images as image nodes, and plain text as a text node.

## Exports other agents can call
`editor/canvas/camera.ts`: `docId` is optional on every function and defaults to the active doc.
- `zoomIn()`, `zoomOut()`: ×2 and ÷2 around the viewport centre.
- `zoomTo100()`, `zoomToFit()`, `zoomToSelection()`
- `zoomAt(zoom, point?, docId?)`, `zoomToRect(rect, docId?, {padding, maxZoom})`, `centerOn(rect)`
- `visibleWorldRect()`, `pageBounds()`, `viewportSize()`, `zoomLabel(zoom)` → `"100%"`
- `MIN_ZOOM`, `MAX_ZOOM`

`editor/canvas/actions.ts`: all take `docId`.
- Selection: `selectParent`, `selectChildren`, `selectAll`, `selectSibling`, `nextArtboard(docId, ±1)`
- Clipboard: `copySelection`, `cutSelection`, `paste(docId, 'normal'|'onTop'|'replace')`, `copyStyles`, `pasteStyles`, `copyAs(docId, 'html'|'jsx'|'css')`, `copyLink`
- Edit: `deleteSelection`, `duplicateSelection`, `nudge`
- Structure and visibility: `reorder(docId, 'front'|'back'|'forward'|'backward')`, `toggleVisible`, `toggleLocked`, `toggleClip`, `frameSelection`, `wrapOrAddFlex`
- Text editing: `startTextEditing(docId, id)`, `commitTextEditing()`
- Insert: `createImageFromFile`, `insertImage(docId, src, name)`, `insertSvgMarkup(docId, markup)`
- UI: `toggleHideUI()`

`editor/canvas/geometry.ts`: `measure(id)` returns the DOM-measured world rect, `clientToWorld(x, y)`, `nodeEl(id)`, and `notifyLayout()`, which tells the overlay to re-measure.

`editor/toolbar/Toolbar.tsx`: `TOOL_GROUPS`.

Prefs read by the canvas:
- `canvas.pixelGrid`, `canvas.snapToPixel` (both default on)
- `canvas.scrollWheelZooms`, `canvas.invertZoom` (both default off)

The zoom menu can toggle these through `setPref`.

## Known gaps
- Rotation isn't editable, and the overlay uses axis-aligned bounds.
- Edge midpoints have no padding or gap handles.
- Snapping only uses the siblings and parent box, so it doesn't snap to spacing or distances.
- Marquee selection starting inside an artboard behaves like a drag on the artboard.
- The pen makes straight segments only; there are no béziers or point editing.
- Comments, cursor chat and real shaders are not implemented; the Shader tool makes a CSS gradient frame.
- "Adjust text…" only offers auto width, auto height and edit.
- Paste positioning of external HTML uses model sizes; fit-content boxes are placed by their top-left.
- React StrictMode double-invokes effects in dev. The text editor is written to tolerate this.
