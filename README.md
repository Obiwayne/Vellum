<p align="center"><img src="resources/icon.svg" width="112" alt="Vellum icon" /></p>

<h1 align="center">Vellum</h1>

<p align="center">
  A free, local-first design tool where <b>designs are real HTML/CSS</b> —<br />
  with a built-in <b>MCP server so Claude can design in it</b> while you watch.
</p>

<p align="center">
  <img src="docs/screenshots/editor.png" alt="Vellum editor with a selected app screen, the layers panel and the inspector" />
</p>

Vellum gives you an infinite canvas, artboards, flex layout, design tokens and a compact dark editor.
There are no online accounts, teams or subscriptions: your files stay on your machine. Several people can share
one PC with local profiles, each optionally protected by a password that encrypts their files.

Everything on the canvas is an HTML element with CSS styles, so what you design is exactly what a browser
renders, and it exports cleanly to HTML, JSX or images. That also makes it a natural fit for AI agents:
Claude writes HTML into the canvas through Vellum's MCP server, screenshots its own work and refines it.

## Screenshots

The design shown here is a complete rebuild of a real desktop app, [MayhemDeck](https://github.com/Obiwayne/MayhemDeck):
its design system, component sheets and every screen and dialog (85 artboards), made in Vellum by Claude through the MCP server.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/design-system.png" alt="Design system page: cover, colour, typography and spacing artboards" /><p align="center"><sub>Design system page</sub></p></td>
    <td width="50%"><img src="docs/screenshots/components.png" alt="Component sheets with every state" /><p align="center"><sub>Component sheets with every state</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/editor-games.png" alt="A full-length screen selected, with flex layout in the inspector" /><p align="center"><sub>Full-length screen with flex layout</sub></p></td>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard with live file thumbnails" /><p align="center"><sub>Dashboard with live thumbnails</sub></p></td>
  </tr>
</table>

## Features

- **Canvas** — infinite pan and zoom (2%–25600%), artboards, frames, rectangles, text, pen paths, images and SVG;
  selection handles, marquee select, snapping guides, drag-to-reorder inside flex layouts, inline text editing.
- **Images** — paste screenshots and copied images with `Ctrl+V` (including image files copied in File Explorer),
  or drag image files straight onto the canvas; they land where you drop them.
- **Inspector** — layout (X/Y, rotation, Fixed/Fit/Fill sizing, device size presets), flex (direction,
  alignment grid, gap, padding, wrap), radius, opacity and blend modes, solid/gradient/image fills,
  outline, border, shadows, inner shadows, filters, full typography with a font picker, export (PNG/SVG/HTML).
- **Layers & pages** — layers tree with drag-and-drop, show/hide, lock and rename; multiple pages per file.
- **Theme tokens** — CSS custom-property tokens (colours, type, spacing, radii…) with a starter theme;
  use them anywhere as `var(--token)`.
- **Dashboard** — recents, files, archive, search, grid/list views and live thumbnails.
- **Editing** — undo/redo, copy/paste (including HTML from other apps), copy as HTML/JSX/CSS,
  right-click menus and keyboard shortcuts throughout.
- **Profiles & privacy** — local profiles with an optional password that encrypts your files (see below).
- **MCP server** — 32 tools (`write_html`, `update_styles`, `get_screenshot`, `get_jsx`, tokens, pages, export…).
  Layers an agent is working on are outlined live on the canvas.

### Profiles & privacy

Vellum keeps a separate **profile** for each person using the PC — a name, an optional picture and an optional
password. Profiles are purely local: no server, no online account. On start you pick your profile (with a single
profile that has no password, Vellum opens it straight away). The account menu in the dashboard has
**Edit profile**, **Switch profile**, **Lock** and **Delete profile**; Settings has **Auto-lock after** for
protected profiles.

- **Without a password** your files are stored as plain JSON, readable by anyone who uses this Windows account.
- **With a password** every file of the profile (designs, file list, preferences) is encrypted on disk with
  AES-256-GCM. The encryption key is random and is itself locked by your password (scrypt); it only exists in
  memory while the profile is open, so nobody else on the PC can read your files, in Vellum or from File Explorer.
  While a profile is locked, the MCP tools refuse to work.
- **Recovery key**: when you set a password you get a one-time recovery key (`XXXX-XXXX-…`). Copy it or save it as
  a `.txt` somewhere safe: it is the only way back in if you forget the password (*Forgot password? → Use recovery
  key*). **If you forget the password and lose the recovery key, your files can’t be recovered.**
- You can add, change or remove the password at any time (removing it decrypts the files back to plain JSON) and
  create a new recovery key from **Edit profile**.
- Upgrading from a version without profiles: the first profile you create takes over your existing files (they are
  copied into the profile, encrypted if you set a password, checked, and only then removed from the old folder).

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 22+ and npm

## Getting started

```bash
git clone https://github.com/Obiwayne/Vellum.git
cd Vellum
npm install
cd mcp && npm install && npm run build && cd ..
npm run dev
```

Or just double-click **`Vellum.cmd`**: the first time it installs and builds everything, then it opens the app
and closes its console.

For a launcher with no console at all, run this once — it creates a **Vellum** shortcut with the app icon in the
project folder and on your Desktop:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-shortcuts.ps1
```

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Typecheck and build |
| `npm start` | Run the built app |
| `npm run typecheck` | TypeScript checks only |

Your data lives in `%APPDATA%\Vellum`: `profiles.json` lists the profiles, and each profile's files are in
`profiles\<id>\` (plain JSON, or encrypted when the profile has a password).

## Let Claude design in Vellum

1. Start Vellum.
2. Register the MCP server with Claude Code. The exact command for your copy is shown in the app under
   **Connect your agent**; it looks like this:
   ```bash
   claude mcp add vellum -- node C:/path/to/Vellum/mcp/dist/index.js
   ```
3. Start a new Claude Code session and ask, for example:
   *"Create a pricing card for a coffee subscription in Vellum."*

The MCP server is started by Claude Code in the background — you only need the Vellum app open.
It talks to the app over `ws://127.0.0.1:29170` (change it with the `VELLUM_PORT` environment variable).
The tools work on the profile that is open in the app; while Vellum shows the profile picker or is locked they
return "Vellum is locked — open your profile in the app first".
See [`docs/MCP.md`](docs/MCP.md) for the full tool list and troubleshooting.

## Keyboard shortcuts (highlights)

| Tool / action | Shortcut |
|---|---|
| Move · Pan | `V` · hold `Space` |
| Frame · Rectangle · Pen · Text | `F` · `R` · `P` · `T` |
| Add / wrap in flex | `Shift+A` |
| Zoom to 100% · fit · selection | `Shift+0` · `Shift+1` · `Shift+2` |
| Copy · Paste · Duplicate · Delete | `Ctrl+C` · `Ctrl+V` · `Ctrl+D` · `Delete` |
| Undo · Redo | `Ctrl+Z` · `Ctrl+Shift+Z` |
| Bring to front · Send to back | `]` · `[` |

The full list is on the **Learn** page in the app's dashboard.

## Project structure

```
src/main/        Electron main process: window, file storage, clipboard, MCP bridge, offscreen rendering
src/preload/     Safe API exposed to the renderer
src/renderer/    React UI: shell, dashboard, editor (canvas, toolbar, inspector, left panel), model/store
mcp/             MCP server (stdio) + tests (mcp/test/regress.mjs)
resources/       App icon (SVG, PNG, ICO)
scripts/         Helper scripts (desktop shortcuts)
docs/            Architecture, component docs and screenshots
```

Built with Electron, electron-vite, React, TypeScript, zustand and immer.

## Docs

- [Architecture](docs/ARCHITECTURE.md) · [Foundation / store API](docs/FOUNDATION.md)
- [Canvas](docs/CANVAS.md) · [Inspector](docs/INSPECTOR.md) · [Left panel & dashboard](docs/LEFT_DASHBOARD.md)
- [MCP server](docs/MCP.md) · [Bug log](docs/BUGS.md)
