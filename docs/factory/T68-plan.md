# T68 plan: Dev Mode H11, MCP tools `get_dev_spec` and `export_handoff`

Slice H11 of [T58-plan.md](T58-plan.md) (sections 11, 12 and task 13 of its breakdown). It needs H1 (`model/devSpec.ts`, T60), H2 (`CNode.dev`, T61) and H3 (`buildHandoff`, T62), all merged. This plan says how the two tools are split across the three processes that already carry every MCP tool, and cuts the work into three branches.

## 1. What is asked

| Tool | Purpose | Reads the file | Writes |
|---|---|---|---|
| `get_dev_spec({ fileId?, nodeId \| nodeIds, depth?, mode? })` | the `NodeSpec` of one or more layers: measured box, layout intent, resolved and authored style, tokens per mode, component reference, dev notes | yes | nothing |
| `export_handoff({ fileId?, frames?, version?, rem?, projectLabel?, outputDir? })` | the same bundle the Export dialog (H5) writes, written to a folder on this PC; returns the file list and the summary | yes | a new folder under the export folder |

An agent that can already read the design (`get_jsx`, `get_computed_styles`) gets, through `get_dev_spec`, the numbers and the layout rules in one call, and through `export_handoff` the whole hand-off for a person or another agent. Both work in Dev Mode (they never change the document).

## 2. Approach: where each piece lives

Every Vellum MCP tool crosses three layers (docs/MCP.md "Architecture"): `mcp/src/server.ts` (zod schema, forwards, formats), the main-process bridge (WebSocket, auth), and a renderer handler in `src/renderer/src/bridge/tools-*.ts` that runs against the store. The existing `export` tool shows the one place a tool may touch the disk: the MCP server process, inside an export folder it has authorised. The new tools follow that split exactly; nothing new is added to the bridge or to main.

```
agent ──> mcp/src/server.ts ──ws──> main (bridge) ──ipc──> renderer handlers
          export_handoff              unchanged             get_dev_spec
            1. resolveExportDir()                           _build_handoff   (internal, like _render_node)
            2. bridge.call('_build_handoff')  ───────────>  buildHandoff(doc, options) with measure
            3. write files to a temp folder, then rename
            4. return paths + summary
```

- **`get_dev_spec`** is a plain renderer handler in a new `src/renderer/src/bridge/tools-dev.ts` (registered next to `tools-read.ts`): `resolveDocId`, `requireNode`, `nodeSpec(doc, id, { depth, mode, measure })`, returned through `scoped(docId, …)` like the other read tools so the header block (file, page, selection) stays the same. `measure` comes from `geometry`/`measureOffscreen` (the same offscreen layout the other tools use), so numbers match what the canvas shows. A hidden or missing node is a clear error, not an empty spec.
- **`_build_handoff`** is an internal handler (leading underscore: not registered as a tool): `{ fileId, frames?, version, exportedAt, projectLabel?, rem?, mode? }` in, `buildHandoff(...)` out (`{ files, summary, warnings }`). The renderer builds the map because only it can measure; the map is plain text, so it crosses the bridge as JSON. Frame ids are validated by `selectFrames` (nested/hidden/missing are warnings, not crashes).
- **`export_handoff`** (MCP process) calls `_build_handoff`, then writes. It reuses `resolveExportDir`, `exportRoots`, `within`/`realish` (symlink and junction checks) and the `wx` write rule from the `export` tool, so the same authorisation rules apply: a relative `outputDir` under the export folder, or an absolute one inside `VELLUM_EXPORT_ROOTS`. The folder name is `<slug(projectLabel or file name)>-handoff-v<N>`; `N` is `version` when given, otherwise the next number not yet present in the export folder (so repeated calls never overwrite a previous hand-off and no history counter is needed before H6). Files are written into a temp folder inside the export folder and renamed in one step, so a failure leaves nothing half-written. Every path from the map is re-checked (`relative`, no `..`, no absolute, no reserved names) before writing, on top of `assertSafePaths` in the builder.
- **Local only.** `export_handoff` writes to this PC's disk, so it joins `export` in `REMOTE_SKIP` (mcp/src/remote/connector.ts): the remote connector never offers it. `get_dev_spec` is read-only and stays available remotely like `get_jsx`.
- **Same bytes as the dialog.** The dialog (H5) and this tool both call `buildHandoff` with the same options object built by one shared function, `handoffOptionsFor(doc, request)`, kept in `src/renderer/src/handoff/` next to the builder (renderer code, no Electron). The test compares the file map from the handler with a direct `buildHandoff` call and with the map the dialog code path produces for the same inputs.

### Decisions this plan makes (so build tasks do not re-open them)

1. **No new bridge channel and no main-process change.** Writing happens in the MCP server process, which already owns the export folder rules.
2. **Version.** `version` is optional. Without it the next free `-handoff-vN` folder number is used. The history snapshot and `CHANGES.md` stay with H6; the tool says so in its description.
3. **`exportedAt`** is taken from the MCP server's clock when the tool runs (and can be passed for tests). The builder itself never reads a clock.
4. **Scope** is the builder's: ready frames by default, `frames` overrides. Hidden layers, comments, other pages and the file name (when `projectLabel` is given) follow T58 section 11 because the builder enforces them.
5. **Response** is small: `{ folder, files: string[], summary, warnings }`. File contents are not returned (an agent can read the folder), which also keeps the 30 s bridge limit and message size out of play for large files.
6. **Dev Mode does not block either tool.** `onEditRefused` fires only for edits; these never edit.

## 3. Order of work

```
A  renderer handlers: get_dev_spec + _build_handoff (+ shared handoffOptionsFor)
B  MCP server: get_dev_spec and export_handoff tools, writer, REMOTE_SKIP
C  docs: MCP.md, guide.ts, SECURITY.md note, tool-list/bundle test, test:mcp case
```

A first (nothing else compiles against it). B after A. C after B; the docs can be drafted while B is in review.

## 4. Risks

1. **Measure cost on a big file.** `buildHandoff` asks for a rect per node, and `measureOffscreen` renders each artboard once per cache entry (cache of 6). Mitigation: handler measures the chosen frames only, in one pass per frame; the test builds the 20-screen generated doc through the handler and records the time; the tool timeout stays the bridge's 30 s and the error says which stage ran out.
2. **Path escape.** The folder name comes from a file name and the file paths from layer names. Mitigation: slugs only (already in the builder), the MCP side re-checks each path and the final folder with the same `within`/`realish` helpers the export tool uses, and the test feeds a hostile project label and hostile layer names.
3. **Overwrite.** Mitigation: `wx` writes into a fresh temp folder, rename to a name that does not exist, next free `vN`; no existing folder is touched.
4. **Remote leak.** `export_handoff` accidentally offered through the remote connector. Mitigation: a test in `mcp/test/remote.mjs` and in the bundle tool-list test asserts the remote tool list lacks it.
5. **Drift between dialog and tool.** Mitigation: one `handoffOptionsFor` and a byte-equality test (section 5).
6. **Docs drift.** `docs/MCP.md`, `guide.ts` and the tool list are three places. Mitigation: task C updates all three and the existing bundle test already derives the expected tool list from the source.

## 5. How it is tested

- **Renderer (vitest, `npm test`)**, in `src/renderer/src/bridge/tools-dev.test.ts`, with the T62 checkout fixture and the store:
  - `get_dev_spec`: one node, several nodes, `depth` 0 and 1, `mode`; values equal `nodeSpec` called directly; hidden node and unknown id are errors; the document object is unchanged afterwards; works with `devMode` on.
  - `_build_handoff`: file map equals `buildHandoff` for the same options (deep equal); default scope is ready frames; explicit `frames` with a nested id gives a warning and still builds; hostile project label cannot escape; no `undefined`/`NaN` in any file.
  - Size: the 20-screen generated doc through the handler within the recorded bound.
- **MCP process** (`mcp/test`, run by `npm run test:mcp`, skipped when the app is not running like the other suites): `export_handoff` writes the folder under a temp `VELLUM_EXPORT_DIR`; file list equals the map keys; running it twice gives `-v1` and `-v2`; an `outputDir` outside the roots, a symlink/junction out, and a project label such as `..\..\x` are refused or slugged; a mid-write failure (read-only target) leaves no folder; `get_dev_spec` returns the header block plus specs.
- **Bundle and remote**: the existing `src/main/mcp-bundle.test.ts` lists tools from the source and from the bundled server; both gain the two names automatically. A test asserts `REMOTE_SKIP` contains `export_handoff` and not `get_dev_spec`.
- **Evidence for each task**: `npm test` output; for B and C also `npm run test:mcp` output and a listing of a written bundle folder.

## 6. Task breakdown (for the Captain to post)

Lines: `feature` (logic) for all three. Each is one branch and one review.

| # | Title | Acceptance criteria | Line | Needs |
|---|---|---|---|---|
| A | Renderer handlers: `get_dev_spec` and `_build_handoff` | `bridge/tools-dev.ts` registers `get_dev_spec({fileId?, nodeId \| nodeIds, depth?, mode?})` returning `NodeSpec`(s) with the standard scoped header, measured through the offscreen layout, errors for hidden/unknown nodes, no document change, works in Dev Mode; registers `_build_handoff` returning `{ files, summary, warnings }` equal to `buildHandoff` for the same options; one shared `handoffOptionsFor(doc, request)` next to the builder; unit tests for each case in section 5; 20-screen doc timing recorded; `npm test` and typecheck pass | feature | none |
| B | MCP server: `get_dev_spec` and `export_handoff` tools | `mcp/src/server.ts` registers both with zod schemas and descriptions; `get_dev_spec` forwards; `export_handoff` resolves the export folder with the existing authorisation, calls `_build_handoff`, writes into a temp folder and renames to `<slug>-handoff-vN` (next free N or the given `version`), re-checks every path, returns `{ folder, files, summary, warnings }`; `REMOTE_SKIP` includes `export_handoff`; never overwrites; failure leaves no folder; tests in `mcp/test` and `npm run test:mcp` pass | feature | A |
| C | Docs, guide and tool-list tests for the handoff tools | `docs/MCP.md` has both tools in the table (arguments, result, where files go, local only) and the architecture note; `mcp/src/guide.ts` tells agents when to use them and to prefer `get_dev_spec` over screenshots for numbers; `docs/SECURITY.md` states that `export_handoff` writes to the export folder only and is never offered remotely; `mcp-bundle` test and `remote` test cover the tool lists; `npm test` and `npm run test:mcp` pass | feature | B |

## 7. What I want approved

- The split above: renderer builds the map, the MCP process writes it, no bridge or main change; `export_handoff` local only, `get_dev_spec` also remote.
- Folder naming and the "next free `vN`" rule instead of a history counter until H6.
- The small response (paths and summary, not contents).
- The three-task order A, B, C.

Left out on purpose: the history snapshot and `.handoff.json` diffing (H6), PNG and asset bytes (H4), any dialog or UI (H5), a tool that returns the bundle contents inline, and any network upload.

## 8. Amendment (Captain F1513 / F1563): inline file map, no folder writing

- `export_handoff` returns `{ files, summary, warnings, inlineBytes, omitted, skippedBinary }` from the renderer handler directly. The MCP process only forwards it; there is no folder writing, no `resolveExportDir`, no version scan and no `REMOTE_SKIP` entry (T65 owns writing to disk, so the app keeps one writer). Section 2's `_build_handoff` and the MCP-side writer are dropped; tasks A and B collapse into one build (`bridge/tools-dev.ts` + the two registrations in `mcp/src/server.ts`), task C (docs, guide, tests) stays in the same branch.
- **Size cap:** `maxBytes` (default 1,000,000; at most 8,000,000). Files are returned most useful first (HANDOFF.md, tokens, components, screens, fonts.md, spec.json, schema, .handoff.json, then the identical CLAUDE.md copy); files past the cap are listed in `omitted` and a warning points to Export handoff in the app.
- **Binary:** PNG references and assets are planned paths, never bytes: they are listed in `skippedBinary` with a warning.
- **Version:** `version` defaults to 1 (no history counter before H6).
