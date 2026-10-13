# T77 plan: Dev Mode wrap-up

Three loose ends of the Handoff milestone ([T58-plan.md](T58-plan.md) sections 12 and 14; H9, H11, H12 are merged). No concept document exists for T77; this plan is written from the code on `master` at 8697886 and the task title: open in Dev Mode, MCP export matches the dialog, Learn page entries.

## 1. What the code says today

| Item | State on master | Gap |
|---|---|---|
| Open in Dev Mode | `setDevMode(docId, on)` exists (per editor tab, not in the file). The only ways in are the `D` key and the top-bar Design / Dev switch, after the file is open. The file card menu has Open and Open in new tab only. T58 section 12 promised "Open in Dev Mode (read-only)" for a `.vellum` file from outside; **no `.vellum` import exists in the app**, so that sentence describes something that was never built. | A reader (Andy) opens a file in Design mode and can edit it by accident before switching. |
| MCP export matches the dialog | Two call sites build the bundle. The dialog goes through `exportFlow.assemble` (`planAssets`, `fontSource`, `withoutNotes`, `changes` from the last Handoff vN, `nextHandoffNumber`). `bridge/tools-dev.ts` `export_handoff` calls `buildHandoff` directly with none of those. The T68 plan promised a shared `handoffOptionsFor` and a byte-equality test; neither exists. | Same file, same frames: the tool returns no asset records, no `fonts.md` source, always version 1, no `CHANGES.md`, and cannot leave dev notes out. The two outputs differ and nothing tests it. |
| Learn page entries | `LearnPage.tsx` has Keyboard shortcuts, Connect Claude, Updates, Crash recovery. Nothing about Dev Mode, ready marks, Export handoff or CHANGES.md. `D` is not in the shortcut list. | A user cannot find the feature from the app's own help. |

## 2. Approach

### A. Open in Dev Mode (UI, small)
- Add **Open in Dev Mode** to `fileMenu` in `dashboard/FileCard.tsx`, right under Open: `openDoc(id)` then `setDevMode(id, true)`. A file that is already open just switches mode. Also an entry in the editor's file switcher is not added (one entry point is enough).
- A tab opened this way shows the existing read-only toast on a refused edit and the Design | Dev switch as usual; nothing new is persisted.
- Decision to approve: **no `.vellum` import and no read-only copy** in this task. The T58 text is corrected in `docs/HANDOFF.md` (it says what is true: open a file, press `D` or use Open in Dev Mode). A real import is a separate goal; I list it as left out.

### B. One bundle path for the dialog and the tool (logic)
Per the "actions orchestrate, service holds mechanics" rule: the repeated mechanic is "doc + request → file map". Extract it once, keep policy in the callers.

- In `src/renderer/src/handoff/exportFlow.ts` export `assembleBundle(doc, req, deps, version, versions)` (what `assemble` already is: notes stripped when `devNotes` is off, `planAssets`, `changesSince`, `buildHandoff`). It stays free of Electron and of any write. The dialog calls it as now (`previewExport`, `runExport`).
- `export_handoff` in `bridge/tools-dev.ts` calls the same function with `deps` built from the renderer (`listVersions` from `history/versions`, `measure`, `fontSource`, `now`). It keeps its own policy: inline cap, ordered files, PNG and asset bytes never returned, `skippedBinary`, no history write (the tool does not save a Handoff vN; it says so in the result).
- New optional arguments, same names as the dialog's options: `devNotes` (default true), `retina` is not needed (no PNGs). `version` defaults to the next Handoff number (what the dialog would show) instead of 1; an explicit `version` still wins.
- Result adds `version` and `changes` (`null` when this is the first export) so an agent sees what the dialog's review step shows.

### C. Learn page (docs in the app, small)
- New section **Dev Mode and handoff** in `LearnPage.tsx` (`data-learn="devmode"`), after Connect Claude, in the page's existing card style, using the app's real labels: the Design | Dev switch and `D`, Open in Dev Mode (file menu), the Spec panel and redlines (hover to see distances), the ready-for-dev mark and "Changed since ready", **Export handoff…**, Handoff vN and CHANGES.md, and the two MCP tools with the one-line difference (`get_dev_spec` reads a layer, `export_handoff` returns the bundle inline).
- Add `['Dev Mode (Design | Dev)', 'D']` to the App shortcut group and read the key from `shortcuts.ts`'s constant if one exists, so the page cannot drift.
- Where the section says a label (button, menu item), the test imports the string from the component that renders it where one is exported; otherwise it asserts the literal and the component test already pins it.

## 3. Order of work

```
B  shared bundle path (logic, tests)      } independent: any order
A  Open in Dev Mode (menu item)           }
C  Learn page (needs A's label and B's tool wording, so last)
```

B first because it can change what the tool returns; C last because it quotes the other two.

## 4. Risks

1. **Changing `export_handoff`'s output.** Agents may rely on `version: 1` or on the absence of `changes`. Mitigation: the new fields are additive; the version default change is called out in MCP.md and the guide; the tool test pins both.
2. **`assembleBundle` pulling history into the tool.** `listVersions` hits IndexedDB through `history/versions`; the tool must not write. Mitigation: pass only the read dependencies; a test asserts no snapshot is saved by a tool call.
3. **Slow on a big file** (asset planning decodes images). Mitigation: reuse the dialog's measured path; re-run the 20-screen timing the T68 test records and keep its bound.
4. **Dev Mode guard.** Opening via the menu must not bypass `canEdit`. Mitigation: it only sets the existing `devMode` flag; the guard test (`devMode.guard.test.ts`) already enumerates entry points and gains one case.
5. **Docs drift.** Mitigation: the Learn test reads labels from code; `sample.test.ts` style claims for MCP.md.

## 5. How it is tested

- **B (vitest):** with the T62 checkout fixture, the 20-screen doc and a doc with an asset, a doc with dev notes and one prior Handoff v1: for the same frames and options the text files from `export_handoff` equal the files `runExport` hands to the writer (deep equal, key by key); `devNotes: false` removes notes in both; version is the next number and `CHANGES.md` / `spec.changes` appear after an edit; PNG paths are in `skippedBinary`; the tool saves no version and does not change the document; hidden / unready canaries absent. Existing `tools-dev.test.ts` cases still pass.
- **A (vitest, jsdom):** the file menu lists "Open in Dev Mode"; selecting it opens the doc with `devMode` true, a refused edit fires the read-only toast, `D` returns to Design; guard test case.
- **C (vitest, jsdom):** `learnPage.test.ts` gains the section, its headings and labels, and the `D` shortcut.
- **App check:** `node scripts/e2e-handoff.mjs` (built app, temp `VELLUM_USER_DATA`) gets one step: open the sample file from the dashboard menu and assert the top bar shows Dev and a canvas drag shows the read-only toast.
- Evidence per task: `npm test` and typecheck output; for A and C a screenshot from the built app; for B the equality test output.

## 6. Task breakdown (for the Captain to post)

| # | Title | Acceptance criteria | Line | Needs |
|---|---|---|---|---|
| B | `export_handoff` builds through the dialog's path | `exportFlow` exports `assembleBundle`, used by `previewExport`, `runExport` and the tool; tool accepts `devNotes`, defaults `version` to the next Handoff number, returns `version` and `changes`; a test shows the text files equal the dialog's for the fixture, the 20-screen doc, an asset doc and a prior-version doc; the tool writes no history and changes no document; docs/MCP.md and `mcp/src/guide.ts` describe the new fields; `npm test` and typecheck pass | feature | none |
| A | Open in Dev Mode from the file menu | File card menu has "Open in Dev Mode"; it opens the file with Dev Mode on, edits are refused with the read-only toast, `D` switches back; `docs/HANDOFF.md` no longer promises a `.vellum` read-only import; guard test and e2e step added; `npm test` and typecheck pass | ui | none |
| C | Learn page: Dev Mode and handoff | Section with the labels listed in 2C, `D` in the shortcut list, test reads the labels from code or pins the literals, README feature line points to it; no text claims anything the app does not do; `npm test` and typecheck pass | ui | A, B |

## 7. What I want approved

- B changes the tool's default `version` and adds `version` / `changes` to its result (additive otherwise).
- A is a menu item only; no `.vellum` import and no read-only copy.
- The three-task order and that C waits for A and B.

Left out on purpose: importing a `.vellum` file from outside, a persisted per-file read-only flag, writing to disk from the tool (T65 owns the writer), PNG bytes through the tool, a Dev Mode entry in the editor's tab strip.
