# Left panel and Dashboard

## Editor left panel (`src/renderer/src/editor/left/`)
- `LeftPanel.tsx` has the header (double-click the name to rename the doc) and the collapse button.
  - Ctrl+\ toggles the panel and is stored as the pref `leftCollapsed`.
  - When collapsed, the Editor grid column is dropped through `.ed:has(.lp--collapsed)` in `left.css`, and a floating restore button is portalled to the body.
  - It also holds the Design | Theme tabs and the footer.
- `PagesSection.tsx` covers the pages list: add, rename, duplicate and delete. `duplicatePage()` is exported.
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
- `starterTheme.ts` contains the 84 tokens bundled as the starter theme.
- `WhatsNew.tsx` exports `FooterLinks` and `WhatsNewModal` (`APP_VERSION`). `InlineEdit.tsx` is the shared rename input.

## Dashboard (`src/renderer/src/dashboard/`)
- `Dashboard.tsx` has the sidebar: the account row (profile picture + name; menu: Edit profile…, Switch profile, Lock for protected profiles, Settings, Delete profile…), search (Ctrl+F), Recents, Learn, Files, Archive, Settings, the dismissible "Using agents" card and the footer.
  - The main area has the title, "+ New file" (`createFile()` applies the default page colour) and the grid/list toggle.
  - It also contains the delete confirmation.
- `FileCard.tsx` has the cards and list rows with relative times. Its file menu has Open, Open in new tab, Rename, Duplicate (`duplicateDoc`), Archive/Unarchive and Delete…, and hides the unsafe items for the Scratchpad.
- `Thumbnail.tsx` renders a scaled live DOM preview of page 1. It has no `data-node-id`, so the canvas resolver is not affected.
- `LearnPage.tsx` has the shortcut reference and the Claude setup. `ConnectAgentModal.tsx` exports `ConnectAgentBody`, `MCP_COMMAND` and `ConnectAgentModal`.
- `SettingsPage.tsx` stores local prefs. It starts with the profile row (Edit profile…) and, for protected profiles, "Auto-lock after" (Off/5/15/30/60 min, stored on the profile in `profiles.json`). `userName` is only a fallback now; the profile name is used everywhere. The `PREF` keys are: `userName`, `defaultPageColor`, `scrollWheelZooms` (default false), `snapToPixel` (default true), `showPixelGrid` (default true), `dashboardView`, `agentsCardDismissed`.
  - The canvas and inspector should read the zoom and snap keys from `prefs`.
