# Vellum

A free, local-first design tool for Windows where **designs are real HTML/CSS**, with a built-in
**MCP server so Claude (or any MCP-capable agent) can design in it** while you watch.

It gives you an infinite canvas, artboards, flex layout, design tokens and a dark, compact editor UI.
There are no accounts, teams or billing — everything stays on your machine.

## Features

- **Canvas** — infinite pan/zoom (2%–25600%), artboards, frames, rectangles, text, pen paths, images and SVG;
  selection handles, marquee select, snapping guides, drag-to-reorder inside flex layouts, inline text editing.
- **Inspector** — layout (X/Y, rotation, Fixed/Fit/Fill sizing, device size presets), flex (direction,
  alignment grid, gap, padding, wrap), radius, opacity and blend modes, solid/gradient/image fills,
  outline, border, shadows, inner shadows, filters, full typography with a font picker, export (PNG/SVG/HTML).
- **Layers & pages** — layers tree with drag-and-drop, show/hide, lock, rename; multiple pages per file.
- **Theme tokens** — CSS custom-property tokens (colours, type, spacing, radii…) with a starter theme;
  use them anywhere as `var(--token)`.
- **Dashboard** — recents, files, archive, search, grid/list views, live thumbnails.
- **Undo/redo**, copy/paste (including HTML from other apps), copy as HTML/JSX/CSS, keyboard shortcuts throughout.
- **MCP server** — 32 tools (`write_html`, `update_styles`, `get_screenshot`, `get_jsx`, tokens, pages, export…).
  Nodes an agent is working on are outlined live on the canvas.

## Requirements

- Windows 10/11
- Node.js 22+ and npm

## Getting started

```bash
git clone https://github.com/Obiwayne/Vellum.git
cd Vellum
npm install
cd mcp && npm install && npm run build && cd ..
npm run dev
```

Or just double-click **`Vellum.cmd`** — it installs, builds and launches on first run.

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Typecheck and build |
| `npm start` | Run the built app |
| `npm run typecheck` | TypeScript checks only |

Your files are saved as JSON in `%APPDATA%\Vellum\files`.

## Let Claude design in Vellum

1. Start Vellum.
2. Register the MCP server with Claude Code (use the path where you cloned the repo):
   ```bash
   claude mcp add vellum -- node C:/path/to/Vellum/mcp/dist/index.js
   ```
3. Start a new Claude Code session and ask, for example:
   *"Create a pricing card for a coffee subscription in Vellum."*

The server talks to the running app over `ws://127.0.0.1:29170` (override with `VELLUM_PORT`).
See [`docs/MCP.md`](docs/MCP.md) for the full tool list and troubleshooting.

## Keyboard shortcuts (highlights)

| Tool / action | Shortcut |
|---|---|
| Move · Pan | `V` · hold `Space` |
| Frame · Rectangle · Pen · Text | `F` · `R` · `P` · `T` |
| Add / wrap in flex | `Shift+A` |
| Zoom to 100% · fit · selection | `Shift+0` · `Shift+1` · `Shift+2` |
| Duplicate · Delete | `Ctrl+D` · `Delete` |
| Undo · Redo | `Ctrl+Z` · `Ctrl+Shift+Z` |
| Bring to front · Send to back | `]` · `[` |

The full list is on the **Learn** page in the app's dashboard.

## Project structure

```
src/main/        Electron main process: window, file storage, MCP bridge, offscreen rendering
src/preload/     Safe API exposed to the renderer
src/renderer/    React UI: shell, dashboard, editor (canvas, toolbar, inspector, left panel), model/store
mcp/             MCP server (stdio) + tests (mcp/test/regress.mjs)
docs/            Architecture and component docs
```

Built with Electron, electron-vite, React, TypeScript, zustand and immer.

## Docs

- [Architecture](docs/ARCHITECTURE.md) · [Foundation / store API](docs/FOUNDATION.md)
- [Canvas](docs/CANVAS.md) · [Inspector](docs/INSPECTOR.md) · [Left panel & dashboard](docs/LEFT_DASHBOARD.md)
- [MCP server](docs/MCP.md) · [Bug log](docs/BUGS.md)
