# T62 plan: Handoff H3, the bundle writer (`Doc + options → file map`, pure)

Slice H3 of [T58-plan.md](T58-plan.md) (sections 3, 5, 8–11 and task 3 of its breakdown). H1 (`model/devSpec.ts`, T60) and H2 (`CNode.dev`, format v6, T61) are merged. This plan makes H3 small enough for one branch and one review per piece. Nothing here changes Design mode or the file format.

## 1. Approach

**One pure function.**

```ts
// src/renderer/src/model/handoff/index.ts
export function buildHandoff(doc: Doc, options: HandoffOptions): HandoffResult

interface HandoffOptions {
  frames: string[]            // top-level frame ids chosen by the caller (the whitelist, T58 section 11)
  version: number             // handoff version, supplied by the caller (section 9 of T58: kept in history)
  exportedAt: string          // ISO string supplied by the caller: the writer never reads a clock
  vellum: string              // app version, supplied
  projectLabel?: string       // replaces the file name in the bundle; default: doc.name
  measure?: Measure           // injected, as in nodeSpec; missing = authored values only (box.measured=false)
  lineCount?: (id: string) => number | null
  precision?: number          // default 2
  rem?: boolean               // print rem beside px in markdown (default false)
  mode?: string | null        // token mode for resolved values; default: per node
  assets?: AssetRecord[]      // from H4; default none. H3 only references them, it never decodes images
}

interface HandoffResult {
  files: Record<string, string | Uint8Array>   // POSIX relative path -> content
  summary: { screens: number; nodes: number; components: number; tokens: number; textStyles: number; notes: number; skippedHidden: number; fractional: number; needsDecision: number }
  warnings: string[]                           // human-readable, also listed in HANDOFF.md
}
```

- **Where it lives.** `src/renderer/src/model/handoff/` next to `devSpec.ts`, plain TypeScript, no React, no DOM, no Electron. It imports `devSpec`, `modes` (`tokensCssWithModes`, `tokenValueIn`), `components`, `variants`, `properties`, `textStyles` and `dev` only. The measure callback needs the renderer anyway, so the dialog (H5) and the MCP tool (H11) build the map in the renderer and hand it to the main process to write; main never imports the model. This keeps the "file written through the main process, temp folder then move" rule of T58 section 11 intact and needs no new IPC for H3.
- **Files are values, not I/O.** The writer returns a map. Zip, folder, temp-move and dialogs are H5. PNGs and image bytes are H4: H3 emits only text files and reserves their paths (`screens/<slug>.<bp>.png`, `assets/...`) from `options.assets` and the screen list, so H4 plugs in without changing H3.
- **Deterministic.** Same input, same bytes: no clock, no random ids, no object-key order dependence (builders emit keys in a fixed order; maps are emitted sorted by id or slug), LF line endings, UTF-8, one trailing newline, 2-space JSON. Tests assert it by building twice and by reordering `doc.nodes` keys.
- **Reuse, don't copy.** Layout intent text (`intentLine`, `sizingText`), `round`, `formatNumber`, `toRem`, `tokenUse`, `fractionalNodes`, `varsIn` come from `devSpec.ts`. Token CSS reuses `tokensCssWithModes`. No second implementation of any of them.
- **One module per output family**, each a pure `(ctx) => files`:

| Module | Emits | Depends on |
|---|---|---|
| `scope.ts` | the whitelist: chosen frames (must be top-level, visible), the components, tokens and text styles they actually use, warnings | `devSpec`, `components`, `modes` |
| `paths.ts` | slugs (`kebab-case`, ASCII), collision suffix `-2`, reserved Windows names, no `..`, no absolute path, max length; a registry that hands out each path once | none |
| `specJson.ts` | `spec.json`, `spec.schema.json` (`vellum.handoff/1`) | `scope`, `devSpec` |
| `tokens.ts` | `tokens/tokens.css`, `tokens/tokens.json` (DTCG), `tokens/tailwind.css` | `scope`, `modes` |
| `markdown.ts` | `screens/<slug>.md`, `components/<slug>.md` | `scope`, `specJson` types, `paths` |
| `handoffMd.ts` | `HANDOFF.md` and an identical `CLAUDE.md` with the quick-start box | `scope`, `paths` |
| `index.ts` | `buildHandoff`: runs the above, sorts the map, checks every path with `paths.assertSafe` | all |

Not in H3 (named so nobody grows the slice): `CHANGES.md` and `.handoff.json` (H6), `fonts.md`, images, SVG, PNGs (H4), `comments.md` (opt-in, H5), states table content beyond what `CNode.dev.states` already holds (H7 renders the UI; H3 prints what is in the doc).

## 2. What each file contains (decisions, so build tasks don't re-open them)

- **`spec.json`**: the `Handoff` shape of T58 section 3.3, with `screens[].root` a `NodeSpec` from `nodeSpec(doc, frameId, opts)`. Per node: dev notes from `CNode.dev.notes` as `notes: string[]` (split on blank lines), `dev.role`/`label`/`tab`/`needsDecision` as `a11y` and `needsDecision`, `dev.states` as `states`. `units: { length: 'px', remBase: 16, precision }`. `handoff.fileId = doc.id`; `fileName` is `projectLabel ?? doc.name`. No `thumbnail`, no `comments`, no `updatedAt`, no profile data.
- **Breakpoints**: frames with the same `dev.screen.name` become one `screens[]` entry with several `breakpoints`; an untagged frame is its own screen (name = frame name). The delta table is H8, not H3; H3 prints one section per breakpoint.
- **Components**: a `ComponentSpec` per main used (instance chain, variant sets included), with props, variant options and each variant's `NodeSpec`; used-by lists screen ids. Mains from other pages appear only when a chosen frame uses them; `warnings` says which.
- **Tokens**: only tokens referenced (directly or through other tokens) by emitted nodes or emitted text styles, plus their transitive references; value per mode; colour tokens get `hex8`. `tokens.json` is DTCG (`$type`, `$value`, modes as top-level groups named after the mode); `tailwind.css` is an `@theme` block of the base mode (v4) plus a note line for other modes; `tokens.css` is `tokensCssWithModes(doc, used, true)`.
- **`screens/<slug>.md`**: header (name, frame size, breakpoint, ready version), then the node tree. For each node, **layout intent first** (`intentLine`), then size, then style facts that are not implied by intent, then tokens, component ref, notes, `needs-decision`. Fractional sizes get the T58 section 10 sentence. Depth is not truncated.
- **`HANDOFF.md`**: exactly the T58 section 3.2 template with the quick-start box first, counts from `summary`, the warnings list, the read order for the files that exist in this bundle (it never mentions `CHANGES.md` unless present). `CLAUDE.md` is byte-identical.
- **Safety** (T58 section 11) is enforced in `scope.ts`, not in each renderer: hidden nodes are dropped there (`skippedHidden` counts them), other pages are unreachable because only chosen frames are walked, comments are never read, the document `name` is used only through `projectLabel ?? name`. A final `assertSafe` pass over the finished map rejects any path that is absolute, contains `..`, a drive letter or a backslash, and any text that contains `doc.thumbnail` or a `data:` URL (data URLs in styles were already replaced by `url(data-url)` in H1).

## 3. Order of work

```
W1 scope + paths + skeleton ──┬── W2 spec.json + schema ──┬── W4 screens/components markdown ──┐
                              ├── W3 token files           │                                    ├── W6 fixture, snapshots, canaries
                              └────────────────────────────┴── W5 HANDOFF.md / CLAUDE.md ───────┘
```

W1 first. W2 and W3 in parallel (no shared files). W4 needs W2's types. W5 needs W1 and the summary from W2. W6 closes the slice and is the acceptance proof for the whole of H3.

## 4. Risks

1. **Measure is optional.** Without `measure`, boxes are authored-only and `box.measured=false`. Mitigation: H3 tests run both ways on the fixture; markdown prints "not measured" instead of invented numbers, and `HANDOFF.md` warns when any node was not measured.
2. **Doc size.** A 20-screen file makes a large `spec.json`. Mitigation: the writer stays O(nodes) with no repeated tree walks, and the test builds a generated 20-screen, 3000-node doc and asserts it finishes under a stated time (measured and recorded, not guessed).
3. **Schema drift.** `spec.schema.json` can disagree with the TypeScript types. Mitigation: a test validates the fixture's `spec.json` against the schema with a small in-test validator (or `ajv` if it is already a dependency; no new runtime dependency for this), and a second test fails if a `NodeSpec` key is missing from the schema.
4. **Unsafe output via names.** Layer names become file names (slugs). Mitigation: slugs only from `[a-z0-9-]`, windows-reserved names (`con`, `nul`, `aux`, `com1`…) get a suffix, length capped, tested with hostile names (`../../x`, `C:\\Windows`, `CON`, emoji only, 400 characters).
5. **Scope creep into H4/H6.** Mitigation: the "Not in H3" list above, and review checks that no file other than the table's appears in the map.
6. **Two code paths later** (dialog and MCP `export_handoff`). Mitigation: both call `buildHandoff`; W6 adds a test that `buildHandoff` output for the fixture is the single golden used by H5 and H11.

## 5. How it is tested

- **Unit, per module** (`npm test`): `paths` (slug table, collisions, reserved names, hostile input); `scope` (hidden frame, hidden child, locked layer kept as a normal layer, nested frame chosen by mistake is refused, instance of a main on another page pulls the main in, unused tokens left out, token referencing a token); `tokens` (modes, hex8, DTCG shape, Tailwind block); `markdown` (intent first, fractional sentence, rem option, notes, needs-decision); `handoffMd` (quick-start box present, `CLAUDE.md` identical, no `CHANGES.md` mention).
- **Snapshots** (`toMatchFileSnapshot` per generated file) for one fixed fixture doc `fixtures/handoff/checkout.json` (checked in; built to include flex, grid, a constraint, a fractional size, an oklch token, two modes, a component with a variant set and props, an instance with overrides, a text style, dev notes, a state, a screen tagged at two breakpoints, one hidden layer, one locked layer).
- **Canary test**: the fixture also contains a second page, an unchosen frame, a comment thread, a hidden layer with a unique string, a thumbnail data URL and a document name that looks like a person. The test asserts none of the canary strings appears in any file and every path passes `assertSafe`.
- **Determinism**: build twice, build with `doc.nodes` keys reversed, build with `doc.tokens` reordered where order is not meaningful; maps must be byte-equal.
- **Existing fixtures**: v0.1.0, v4 and the T61 v6 test docs run through `buildHandoff` with all top-level frames chosen: no throw, no `NaN`, no `undefined` in any file, every path safe.
- **Not tested here, by design**: writing to disk and zip (H5), IPC (H5), MCP (H11), images and PNGs (H4). Evidence for each W-task: `npm test` output plus the snapshot files for the fixture.

## 6. Task breakdown (for the Captain to post)

Lines: `feature` (model/logic). All tasks are pure TypeScript; none touches UI, IPC or the file format. H3 itself (T62) closes when W6 merges.

| # | Title | Acceptance criteria | Line | Needs |
|---|---|---|---|---|
| W1 | Handoff scope, safe paths and `buildHandoff` skeleton | `model/handoff/{paths,scope,index}.ts` exist; `buildHandoff(doc, options)` returns `{ files, summary, warnings }`; `scope` walks only chosen top-level visible frames, drops hidden nodes (`skippedHidden`), collects used components, tokens (transitively) and text styles, and refuses non-top-level frame ids with a warning; `paths` tests cover slugs, `-2` collisions, reserved Windows names, `..`, absolute and 400-character names; `assertSafe` rejects unsafe paths; output of an empty selection is an empty map plus a warning; `npm test` and typecheck pass | feature | none |
| W2 | `spec.json` and `spec.schema.json` (`vellum.handoff/1`) | `spec.json` has schema id, handoff block (version, exportedAt, vellum, fileId, fileName from `projectLabel ?? name`), units, modes, screens (breakpoints grouped by `dev.screen`), components with variants and props, tokens with per-mode values, textStyles; dev notes, a11y, states and needs-decision per node from `CNode.dev`; no thumbnail, comments, timestamps from the doc or absolute paths; `spec.schema.json` validates the fixture output; a test fails when a `NodeSpec` or `Handoff` key is missing from the schema | feature | W1 |
| W3 | Token files: `tokens.css`, `tokens.json` (DTCG), `tailwind.css` | Only used tokens (and what they reference) are emitted; `tokens.css` has one block per mode via `tokensCssWithModes`; `tokens.json` uses `$type`/`$value` with a group per mode; colour tokens carry hex8 and keep authored `oklch()`; `tailwind.css` is a v4 `@theme` block for the base mode with a comment line for other modes; documents without modes emit the single `base` set; golden files; invalid token names are skipped with a warning | feature | W1 |
| W4 | Markdown specs: `screens/*.md` and `components/*.md` | One file per screen (one section per breakpoint) and per component used; per node, layout intent first, then size, style facts, tokens, component ref, notes, needs-decision; fractional-size sentence per screen; `rem` option prints rem beside px; components list variants, props with defaults, used-by and the State table with `drawn | described | missing` from the doc; nothing hidden or from another page appears; snapshot per file | feature | W1, W2 |
| W5 | `HANDOFF.md` and identical `CLAUDE.md` | Opens with the quick-start box (steps, version, screen count); then the T58 section 3.2 template filled from `summary`; read order lists only files that exist in the map; warnings and needs-decision list included; `CLAUDE.md` byte-identical; tolerance and verification text matches T58 section 10 | feature | W1, W2 |
| W6 | Fixture, snapshots, canaries and determinism for the bundle writer | `fixtures/handoff/checkout.json` checked in with the contents listed in "How it is tested"; snapshot test for every emitted file; canary test (second page, unchosen frame, comment, hidden layer, thumbnail, person-like name) finds none of them in any file or path; determinism tests (twice, reordered keys); existing v0.1.0, v4 and v6 docs build with no `NaN`/`undefined`; a 20-screen generated doc builds within the measured time recorded in the test; `docs/HANDOFF.md` is not required here (H12) | feature | W2, W3, W4, W5 |

## 7. What I want approved

- The location and shape (`model/handoff/`, pure, renderer-side, `buildHandoff(doc, options)` with injected clock, measure and version) and that the main process only writes files.
- The six-task split and order above, replacing task 3 of the T58 breakdown; T62 closes when W6 merges.
- The deliberate exclusions: `CHANGES.md`/`.handoff.json`, `fonts.md`, images, SVG, PNGs, `comments.md` and breakpoint delta tables (H4–H8).
- That `spec.schema.json` is validated in tests without adding a runtime dependency (`ajv` only if it is already in the tree).

Left out on purpose: any UI, IPC, zip, MCP tool, snapshot in history, and Dev Mode.

## 8. Build notes (changes against the plan above, from the Captain's build instruction F1428)

- **Folder:** `src/renderer/src/handoff/` (not `model/handoff/`): `types`, `paths`, `collect`, `specJson`, `tokens`, `markdown`, `handoffMd`, `index`, plus `fixture.ts` for tests. One build task instead of W1 to W6; the tests follow the W6 list.
- **In H3 after all:** `fonts.md` and `.handoff.json` (per-frame content hashes). Font source comes from an injected `fontSource(family)`; the default marks generic families `system` and everything else `unknown`, so no editor code is imported.
- **Default scope:** every visible top-level frame with `dev.ready`, on any page; `options.frames` overrides. Nested, hidden and missing ids are refused with a warning.
- **Locked layers** are exported as normal layers and the lock state is never written.
- **spec.json nodes** carry `tokens` as names (values live in `spec.tokens`), so the file does not repeat every token on every layer.
- **Tailwind file** keeps token values as authored (oklch stays oklch); dark and other modes are plain `[data-mode]` overrides.
- **Snapshots** are one `toMatchSnapshot` per generated file (`__snapshots__/handoff.test.ts.snap`), which vitest compares with normalised line endings, so Windows checkouts with CRLF do not break them.
