# Vellum 1.0.0

The first public release of Vellum, a local design tool where every layer is real HTML and CSS.

## What's in it

- **Design with real HTML/CSS.** Frames, flex layouts, text, shapes, images and SVG, on pages with a layers tree and drag and drop.
- **Components and variants.** Make a component, give it props and variants, and place instances that follow it.
- **Styles and tokens.** Text styles and design tokens, with light and dark themes.
- **Assets panel.** Your components and styles in one place.
- **Dev Mode.** Press `D` (or the **Dev** switch at the top of the inspector) and the file becomes read-only for inspecting: select a layer to see its layout rule (Fixed, Fit or Fill, min and max, gap, padding), measured size, tokens per theme mode and notes; hover to see the distances to its neighbours and its parent (`Alt` measures to any layer); copy a layer as CSS, Tailwind, React or HTML. A file's menu on the dashboard has **Open in Dev Mode**.
- **Developer handoff.** Tag top-level frames as screens with breakpoints, mark them **ready for dev**, add notes, state rules and accessibility info, then **Export handoff…** (next to Share) writes a folder or zip a developer's own Claude Code can build from: layout rules first, tokens, components and states, assets, fonts, a PNG per breakpoint and what changes between breakpoints. Export again after edits and the folder carries a `CHANGES.md` that says what to rebuild. Nothing hidden leaves the file and nothing is uploaded. The MCP tools `get_dev_spec` and `export_handoff` do the same for agents.
- **Windows installer.** A per-user installer: no administrator rights needed, and your data stays in your user profile when you uninstall.
- **Automatic updates.** Vellum checks for new versions in the background and installs one when you choose. Release notes show in the update card.
- **Crash recovery.** Saves are crash-safe, and a recovery copy is kept so an unexpected close does not lose your work.
- **MCP server.** Claude can read and write your designs through the built-in MCP server.

## Install

Download `Vellum-Setup-1.0.0.exe` below and run it.

This build is not code-signed yet, so Windows may show "Windows protected your PC" (SmartScreen). Choose **More info**, then **Run anyway**.

## Updating

Installed copies pick up later releases on their own. Your files are not touched by an update.
