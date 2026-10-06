# Left panel and Dashboard

## Editor left panel (`src/renderer/src/editor/left/`)
- `LeftPanel.tsx` has the header (double-click the name to rename the doc) and the collapse button.
  - Ctrl+\ toggles the panel and is stored as the pref `leftCollapsed`.
  - When collapsed, the Editor grid column is dropped through `.ed:has(.lp--collapsed)` in `left.css`, and a floating restore button is portalled to the body.
  - It also holds the Design | Theme tabs and the footer.
  - Drag the right edge to resize (200–480px, double-click resets to 240); stored as the pref `leftWidth` and applied as `--left-w` on `.ed` by `Editor.tsx`. The divider between Pages and Layers drags the Pages height (pref `pagesHeight`, double-click resets to auto).
- `PagesSection.tsx` covers the pages list: add, rename, duplicate and delete. `duplicatePage()` is exported.
  - Pages reorder by pointer drag (drop line, Esc cancels) or Move up / Move down in the menu, through the undoable store action `movePage(docId, pageId, index)`.
  - New pages use the `defaultPageColor` pref.
- `LayersTree.tsx` is the layers tree in DOM order.
  - Selection supports click, Shift-click range and Ctrl-click toggle. Hovering a row sets `hovered` in the store.
  - Ancestors of the selection auto-expand. Alt-click on a chevron expands or collapses the whole subtree.
  - Pointer-based drag and drop reorders and reparents nodes through `moveNodes`, with an insertion line and an into-frame highlight. Esc cancels a drag.
  - Rows have eye and lock toggles. `nodeMenu(docId, ids)` is exported and returns the row context-menu items. Copy dispatches `canvas:command`.
- `ThemePanel.tsx` shows tokens grouped by name prefix (grouping is in `tokenUtils.ts`).
  - It has search, the empty state and the '+' menu: new token by type, import/export/copy CSS, starter theme and delete all.
  - Clicking a row opens an edit popover with name, value and a colour picker for colours. Live drags are coalesced into one undo step.
  - The right-click menu has Edit, Rename, Duplicate, Copy name and Delete.
- `StylesPanel.tsx` is the **Styles** view of the Theme tab (Tokens | Styles switch; the Light/Dark mode switch is shared). Two lists:
  - **Text styles** (`Doc.textStyles`): rows show an "Ag" preview in the style's own typography, a caption (family, size, weight) and the number of layers that follow it. `+` creates a style named "Text style" from the single selected text layer (that layer follows it) and opens the name for renaming; with no or several text layers it makes a default one (16px, weight 400, line height 1.25); a slash in the name groups rows (`Heading/H1` shows as `H1` under *Heading*). Click a row to open the editor popover (name, family, size, weight, style, line height, letter spacing, decoration, case; **Apply to selection**; Delete), double-click renames, the context menu has Rename, Duplicate and Delete. Editing a style rewrites every layer that follows it in one undo step, so a bigger `fontSize` grows Fit containers (unitless line heights scale with it).
  - **Colour styles** are the file's `--color-*` tokens: one row per token with a swatch per theme mode and the value of the viewed mode. `+` names a new style from the first literal colour of the selection (a text layer: text colour, then fill, then border; other layers: fill, border, then text colour) and writes the reference back to that layer, in one undo step (duplicate names are refused with a message); clicking a row edits the token like the Tokens view does. Colour styles are applied from any colour field (see `INSPECTOR.md`), and they follow the Light/Dark modes because a field holds `var(--color-name)`. Known limit (fixed by T38): `oklch()` colours (the starter theme) show their swatch here, but the colour fields do not list them yet.
  - Same model as the rest of the file: undo/redo, history and MCP (`get_text_styles`, `create_text_style`, `update_text_style`, `delete_text_style`, `apply_text_style`; colour styles use `get_tokens` / `set_tokens`).
- `starterTheme.ts` contains the 84 tokens bundled as the starter theme.
- `WhatsNew.tsx` exports `FooterLinks` and `WhatsNewModal` (`APP_VERSION`). `InlineEdit.tsx` is the shared rename input.

### Theme modes
`model/modes.ts`. `Doc.modes` lists the modes (`[0]` is the base mode, whose values are `token.value`); `Token.modes[mode]` holds the other values. The Theme panel shows a mode strip (click to view/edit that mode, double-click to rename, right-click to delete, + to add); rows show the viewed mode's values and a dot when the token has its own value there. The token editor edits the viewed mode and can reset it to the base value. A frame's mode is `attrs['data-mode']`: `computeNodeStyle` puts that mode's token values on the frame as custom properties (canvas, thumbnails, screenshots); exports keep the attribute and add `[data-mode="…"]` blocks (`tokensCssWithModes`).

## Dashboard (`src/renderer/src/dashboard/`)
- `Dashboard.tsx` has the sidebar: the account row (profile picture + name; menu: Edit profile…, Switch profile, Lock for protected profiles, Settings, Delete profile…), search (Ctrl+F), Recents, Learn, Files, Archive, Settings, the dismissible "Using agents" card and the footer.
  - The main area has the title, "+ New file" (`createFile()` applies the default page colour) and the grid/list toggle.
  - It also contains the delete confirmation.
- **Folders** (`folders.ts`, `FolderViews.tsx`): nested folders stored in the profile prefs (`prefs.folders`: `{id, name, parent}`); a file's folder is `Doc.folderId`. Files view shows the current folder's subfolders (cards or rows) and files, with a breadcrumb; the sidebar shows the folder tree under Files. Files and folders drag onto folders, tree rows and breadcrumb crumbs; file menus have "Move to folder". Deleting a folder moves its files and subfolders to its parent. "New file" inside a folder creates it there.
- **Multi-select**: Ctrl-click toggles a file, Shift-click selects a range, Ctrl+A selects every file shown, Esc or a click on empty space clears; the selection resets when the view changes. A bottom action bar (Move to folder, Archive/Unarchive, Delete…) and the right-click menu (`filesMenu`) act on the whole selection; dragging a selected file drags them all (`DND_FILE` carries newline-separated ids). The Scratchpad is never moved, archived or deleted. Empty Recents/Files views have a "New file" button.
- `FileCard.tsx` has the cards and list rows with relative times. Its file menu has Open, Open in new tab, Rename, Duplicate (`duplicateDoc`), Archive/Unarchive and Delete…, and hides the unsafe items for the Scratchpad.
- `Thumbnail.tsx` renders a scaled live DOM preview of page 1. It has no `data-node-id`, so the canvas resolver is not affected.
- `LearnPage.tsx` has the shortcut reference and the Claude setup. `ConnectAgentModal.tsx` exports `ConnectAgentBody`, `MCP_COMMAND` and `ConnectAgentModal`.
- `SettingsPage.tsx` stores local prefs. It starts with the profile row (Edit profile…) and, for protected profiles, "Auto-lock after" (Off/5/15/30/60 min, stored on the profile in `profiles.json`). `userName` is only a fallback now; the profile name is used everywhere. The `PREF` keys are: `userName`, `defaultPageColor`, `scrollWheelZooms` (default false), `snapToPixel` (default true), `showPixelGrid` (default true), `dashboardView`, `agentsCardDismissed`.
  - The canvas and inspector should read the zoom and snap keys from `prefs`.
