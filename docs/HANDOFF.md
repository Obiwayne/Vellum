# Developer handoff

Vellum can hand a finished design to a developer (or to their AI) as a folder of plain files: the layout **rules**
first, then the numbers, the tokens, the components and states, the assets and PNG references to check the build
against. The developer does not need Vellum and nothing is uploaded.

A small real export is checked in at [`docs/handoff-sample/`](handoff-sample/) (a two-breakpoint Checkout screen).

## The workflow

1. **Design as usual.** Anything hidden (the eye in Layers) is never exported.
2. **Tag screens** (optional). Select a top-level frame: the **Screen** section of the inspector has a name and a
   breakpoint (Mobile, Tablet, Desktop or a custom width). Frames with the same name are one screen at several
   breakpoints; the widest is the base the others are compared with.
3. **Add dev info** (optional): the **Dev notes**, **States** and **Accessibility** sections write notes, an open
   question, state rules, role, label and focus order (see [INSPECTOR.md](INSPECTOR.md)).
4. **Mark frames ready.** Layers context menu *Mark ready for dev*, or the *Ready for dev* switch at the top of
   the inspector. A green dot shows in Layers; edit a ready frame and it turns amber (*Changed since vN*).
5. **Export.** The export button next to **Share** in the top bar opens *Export handoff · vN*: pick screens
   (ready ones are ticked), options (PNG references at 1x and 2x, rem next to px, dev notes) and **Export folder…** or
   **Save as zip…**. The bundle is built in a temporary folder and moved into place, so a failed export leaves
   nothing behind. Each export is saved as a named version `Handoff vN` in the file's history.

Agents can do the same through MCP: `get_dev_spec` (one layer's spec) and `export_handoff` (the whole bundle as an
inline file map, nothing written to disk). See [MCP.md](MCP.md).

## What is in the folder

```
checkout-handoff-v1/
  HANDOFF.md        how to build from this folder; the quick start. CLAUDE.md is the same file.
  spec.json         everything, machine readable (schema "vellum.handoff/1"); spec.schema.json next to it
  screens/
    checkout.md             one spec per screen: rules first, then sizes; a table of what changes per breakpoint
    checkout.tablet.png     reference render per breakpoint at 1x (and @2x)
    checkout.mobile.png
  tokens/           tokens.css (one block per mode), tokens.json (W3C Design Tokens), tailwind.css (@theme)
  components/       one file per component the screens use: props, variants, a state table
  assets/           images (original bytes, @2x / @3x only when the pixels exist) and optimised SVG icons
  fonts.md          families, weights, where each comes from, the licence note
  .handoff.json     per-screen hashes the next export compares against
```

Rules the files follow:

- **Layout intent before numbers.** Every layer lists its rule (flex or grid, Fixed / Fit / Fill, min and max,
  constraints, gap, padding) and then its measured size. Measured values keep two decimals (`347.5`, never `348`);
  a fractional size is flagged: build with the rule, not the number.
- **Stack neutral.** No framework is assumed. Token names are suggestions; the values are the truth.
- **Only what you chose.** Chosen frames and what they use. Never hidden layers, other pages, unchosen frames,
  comments, thumbnails, the profile name or absolute paths. Locked layers are exported as normal layers (the lock
  state is dropped). Image bytes are never inlined in `spec.json` or the markdown.
- **Safe text.** Layer names and notes cannot start a heading, an image or a code fence in the markdown.
- **Same input, same bytes** (apart from the export time and version you supply).

## What the developer does

Drop the folder next to the repo and tell Claude Code (or read it yourself):

> Read handoff/HANDOFF.md first, then build screens/checkout.md; verify against the PNGs in screens/.

`HANDOFF.md` carries the rules for the build: use the project's own framework and theme, reuse components, never
hard-code a value that has a token, never turn layout intent into absolute positions, and render each screen at
its design width to compare with the PNG. **Tolerance**: layout within 0.5 px, text breaking on the same lines,
colours exact; list what differs instead of tweaking the design.

## Does it work? The dogfood run

`npm run build` then `node scripts/dogfood-handoff.mjs <out-dir>` exports the sample Checkout screen from the real
app, copies the bundle to a throwaway folder outside the repo, runs `claude -p` there with only file tools (Read,
Write, Edit, Glob, Grep), and renders what it wrote at each breakpoint's design size next to the bundle's PNG. The
prompt, Claude's output, the page it wrote, both PNGs, the diff image and the numbers are saved in `<out-dir>`.
`scripts/e2e-handoff.mjs` is the unattended check of the export itself (tag, mark ready, export, file tree, nothing
hidden leaks); both use a temporary profile.

First result (a pixel counts as different when a channel is off by more than 24/255):

| Breakpoint | Reference | Render | Pixels different | Mean abs diff |
|---|---|---|---|---|
| Tablet 720 | 720x371 | 720x371 | 0.00% | 0.05 |
| Mobile 360 | 360x305 | 360x305 | 0.01% | 0.11 |

The run also found three real bugs, all fixed with the run: a text layer's own background was ignored by the
contrast check (a white button label was reported 1.05:1), `line-height: normal` was measured including the
layer's own padding and border (a 49px line for a 16px label), and PNG/HTML/SVG exports used `line-height: 20px`
where the canvas uses `normal`, so every export laid text out tighter than the canvas it was drawn on.

## Files in the code

| Where | What |
|---|---|
| `src/renderer/src/model/devSpec.ts` | `nodeSpec`: measured box, layout intent, tokens per mode, component reference |
| `src/renderer/src/model/dev.ts`, `devState.ts`, `contrast.ts` | `CNode.dev` (notes, states, screen, ready), state vocabulary, WCAG contrast |
| `src/renderer/src/handoff/` | `buildHandoff(doc, options)`: the pure bundle writer; `deltas.ts` breakpoint tables |
| `src/renderer/src/handoff/assets/` | images, SVG icons (svgo), PNG references |
| `src/renderer/src/editor/handoff/` | the export dialog and ready marks |
| `src/main/handoffExport.ts` | writes the folder or zip (temporary folder, then rename; paths re-checked) |
| `src/renderer/src/bridge/tools-dev.ts` | the MCP tools |

Design notes and the plan: `docs/factory/T58-plan.md` and the task notes next to it.
