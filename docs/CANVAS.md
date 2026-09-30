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
- **Image crop** (`crop.ts`): with one image selected, Ctrl+drag a handle to crop: the box changes, the picture stays put, and the box can't grow past the image. CSS: `objectViewBox: inset(t% r% b% l%)` (visible part, in % of the natural size) + `objectFit: cover` (or `fill` for a distorted image) + `objectPosition` at the crop's spot, a fallback for browsers without `object-view-box` (Chromium has it; others show the image cover-fitted around that spot). A normal resize afterwards scales the cropped picture. Inspector: Image → Reset crop. One drag is one undo step.
- **Constraints** (`ops.ts` "constraints", inspector `ConstraintsSection.tsx`): positioned children of a frame get Left / Right / Left & right / Center / Scale (and Top / Bottom / …). Plain CSS: Right = `left:auto; right`, Left & right = `left + right; width:auto`, Center = `left: calc(50% + Npx)`, Scale = `left` and `width` in %. Choosing one converts from the measured box, so nothing moves. Move, nudge, resize and the X/Y/W/H fields detach the node to a px box (`detachAnchors`), edit it and write the constraint back (`restoreConstraints`, or `editPlain` for one-shot edits). Measurements use bounding rects, so rotated children convert approximately.
- **Layers under the pointer**: Ctrl+right-click lists every layer under the pointer (covered ones too), deepest first, indented by depth with the parent's name on the right; choosing one selects it (`menus.ts` `layersMenu`).
- **Padding and gap handles** (`SpacingHandles.tsx`)
  - Shown for one selected flex/grid frame with the Move tool, while the pointer is over the frame. Hovering a padding band hatches the padding; hovering a gap tints the gaps. Each side and each gap has a small pink handle.
  - Drag a padding handle to change that side (whole px, min 0). Shift sets all sides, Alt sets the opposite side too. It writes the `padding` shorthand through `writeBox`.
  - Drag a gap handle to change the gap (min 0). Flex changes the main-axis gap (`gap`, or the `columnGap`/`rowGap` longhand when the frame already uses one); dragging an "Auto" (space-between) gap starts from its measured size and switches back to packed. Grid: gaps between columns change `columnGap`, gaps between rows change `rowGap`, and `gap` is kept when they are equal (as the Grid section does); Shift sets both.
  - Double-click a flex gap handle to toggle the "Auto" gap (`justifyContent: space-between`).
  - Values are read from the rendered DOM (computed padding, gaps and grid tracks), so tokens and fit sizes work. A pink badge shows the value while dragging.
- **Gradient handles** (`GradientHandles.tsx`, target in `gradientEdit.ts`)
  - Turned on from the Fill section: the crosshair button on a gradient fill ("Edit on canvas"), or pressing one of its stops in the gradient bar. They stay on until the selection changes or the button is toggled off.
  - Linear: the CSS gradient line through the centre, with a knob beyond each end. Drag a knob to rotate (Shift snaps to 15°). Drag a stop dot along the line to move it (0–100%). Click the line to add a stop there (and keep dragging it).
  - Radial: drag the centre to set `at X% Y%` (Shift snaps to 5%). The dashed shape is the ending shape; drag the right knob (and the bottom knob for ellipses) to set the radius, which writes `circle Rpx` or `ellipse RXpx RYpx` (Shift keeps it a circle). Stops sit along the horizontal radius.
  - Everything is read and written with `fills.ts`, which now keeps a radial gradient's shape/size and `at` position.
- Padding, gap and gradient handles are hidden during other gestures, while editing text, for locked, rotated or flipped nodes, and when the node is under 24px on screen. Each handle drag is one undo step, and Esc cancels it.
- **Tools**
  - Frame (F), Rectangle (R) and Shaders (S) are drag-to-create; S makes a gradient "Shader" frame. A click without a drag creates a 100×100 node. The new node becomes a child of the frame under the pointer, and is appended when that frame is flex.
  - Text (T): click, then type. Esc or clicking away commits, and an empty new text node is removed. New text copies the typography of the text most recently selected or edited in that doc (font, size, weight, style, line height, letter spacing, colour, align, case, decoration, OpenType/variation settings, stroke; never size or position). This "last text style" is kept in memory per doc (`editor/textStyle.ts`); without one, the usual defaults apply.
  - Pen (P): click points, then Enter, Esc or double-click to finish. Clicking the first point closes the path. Shift snaps angles to 45°. The result is an SVG `<path>` with a 1.5px black stroke.
  - Comment (C): click a layer (or empty canvas) and type; Enter posts, Shift+Enter adds a line, Esc cancels and a second Esc leaves the tool. The numbered pin is attached to the exact layer under the pointer (highlighted while hovering) and follows it. Click a pin for its thread: reply, resolve/reopen, delete. The left panel's Comments tab lists threads (Open / Resolved / All); clicking one jumps to it. Shift+C toggles pins. Threads are saved in the file (`Doc.comments`) and are not part of undo history. Agents read and answer them through the MCP comment tools.
  - Create image (Ctrl+Shift+I) opens a file picker and inserts the image as a data URL.
  - Create SVG (Ctrl+Shift+J) opens a paste-markup dialog.
  - Icons (Shift+I, `editor/toolbar/IconPicker.tsx`) searches the bundled Lucide set (loaded on first open) and inserts the icon as an SVG layer through `insertSvgMarkup`, with the chosen size, stroke and colour baked in. Enter inserts the first match; Shift+click keeps the picker open.
  - After you create something, the tool returns to Move.
- **Context menus** (`menus.ts`) cover the node menu and empty-canvas menu, and every item works. "Cursor chat" is disabled.
  - "Copy as..." offers HTML, JSX (inline styles), React (a component with inline styles), Tailwind (JSX with the same classes as `get_jsx`; tokens stay as `bg-primary` / `p-(--gap)` references) and CSS. Each copy shows a toast.
  - The empty-canvas menu (and File in the hamburger menu) has "Export PDF of all artboards…": one PDF of the current page, one page per visible artboard, each page the size of its artboard (`actions.exportPagePdf`).
- **Agent working state**: nodes in `workingNodes` get a teal outline with a "Claude" tag.
- **World-rect resolver**: still registered through `ops.setWorldRectResolver`, and it measures `[data-node-id]`.

## Shortcuts (editor/shortcuts.ts, capture phase)
| Area | Shortcuts |
|---|---|
| Tools | V, H (Pan), F, R, P, T, C, S |
| Selection | Esc (tool→Move, else select parent), Enter (select children / edit text), Shift+Enter (parent), Tab / Shift+Tab (siblings), Ctrl+A (select all siblings) |
| Edit | Delete / Backspace, arrows (1) / Shift+arrows (10), Ctrl+D, Ctrl+C / X / V |
| Paste variants | Ctrl+Shift+V (paste on top), Ctrl+Shift+R (paste to replace) |
| Styles | Ctrl+Alt+C / Ctrl+Alt+V |
| Text (text layers selected; `editor/textStyle.ts`) | Ctrl+B bold (700 ↔ 400), Ctrl+I italic, Ctrl+U underline; Ctrl+Shift+. / , font size ±1; Ctrl+Alt+. / , weight ±100; Alt+. / , letter spacing ±0.01em; Alt+Shift+. / , line height ±1px (from Auto: 1.2 × size). Each press is one undo step. With no text selected the keys do nothing here, so they fall through |
| Structure | Shift+F (frame selection), Shift+A (add flex, or wrap in flex), Alt+C (clip content) |
| Order | ] and [ (front / back), Ctrl+] and Ctrl+[ (forward / backward) |
| Visibility | Ctrl+Shift+H (show/hide), Ctrl+Shift+L (lock/unlock) |
| Opacity | 1–9 (10–90%), 0 (100%); with the `canvas.zoomNumberKeys` pref on, 0 / 1 / 2 zoom like Shift+0/1/2 instead |
| Layers | Alt+L (collapse all, `LayersTree.collapseAllLayers`) |
| Other | Ctrl+L (copy link), Alt+T (copy as Tailwind), Alt+R (copy as React), N / Shift+N (next / previous artboard), `.` (Hide UI) |
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

`editor/canvas/geometry.ts`: `measure(id)` returns the DOM-measured world rect, `clientToWorld(x, y)`, `toScreen(rect, camera)`, `nodeEl(id)`, and `notifyLayout()`, which tells the overlay to re-measure.

`editor/canvas/gradientEdit.ts`: `useGradientEdit` / `setGradientTarget({docId, nodeId, index} | null)` picks the gradient fill shown with on-canvas handles.

`editor/toolbar/Toolbar.tsx`: `TOOL_GROUPS`.

Prefs read by the canvas:
- `canvas.pixelGrid`, `canvas.snapToPixel` (both default on)
- `canvas.scrollWheelZooms`, `canvas.invertZoom` (both default off)

The zoom menu can toggle these through `setPref`.

## Known gaps
- Rotation isn't editable, and the overlay uses axis-aligned bounds.
- Grid gap handles assume the tracks start at the content edge (`justifyContent` normal/start). Flex gap handles only cover the main axis; wrapped lines have no cross-axis gap handle.
- Gradient handles: stop positions are limited to 0–100%, stops written in px (not %) aren't understood, radial positions other than 1–2 simple values (e.g. `calc()`, 4-value offsets) show no handles, and `repeating-` gradients lose their prefix when edited (as in the Fill section).
- Snapping only uses the siblings and parent box, so it doesn't snap to spacing or distances.
- Marquee selection starting inside an artboard behaves like a drag on the artboard.
- The pen makes straight segments only; there are no béziers or point editing.
- Cursor chat and real shaders are not implemented; the Shader tool makes a CSS gradient frame.
- "Adjust text…" only offers auto width, auto height and edit.
- Paste positioning of external HTML uses model sizes; fit-content boxes are placed by their top-left.
- React StrictMode double-invokes effects in dev. The text editor is written to tolerate this.
