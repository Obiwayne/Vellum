# T65 design note: Export handoff dialog and ready marks (H5)

The screens exist (docs/factory/T58-screens/, drawn in T58). This note maps them to the task, lists the states they do not cover, and fixes the decisions the builder must not guess. No new artboards are needed. (The Captain's brief called the dialog D04 and the ready marks D05; in the file they are **D02** and **D01/D03**, see the table.)

## 1. What exists

| Surface | Artboard | Covers |
|---|---|---|
| Export handoff dialog, filled | `D02-export-handoff-dialog.png` | screen list with Ready / Changed since ready / Not ready, breakpoint grouping line, options, review counts, "pulls in" warning, tree preview, "Export folder…" and "Save as zip…", decrypted-copy line |
| Dialog states | `D05-export-states.png` | empty ("No screens are ready for dev", Choose frames anyway), exporting (progress, Cancel), failed ("Nothing was written"), done (counts, path, Copy prompt, Open folder) |
| Ready dots in Layers | `D01-dev-mode-spec-panel.png` (left panel) | ready / changed dots on frame rows |
| Ready toggle and "Changed since v3" | `D03-inspector-dev-section.png` | the toggle inside the inspector's **Dev section**, which is T69 (mabel) |
| CHANGES view | `D04-changes-since-handoff.png` | H6, not this task |

## 2. Surfaces this task builds

1. **Entry points:** "Export handoff…" in the top bar (a button next to Share, hidden in the dashboard) and in the app menu / command palette. Same dialog from both.
2. **Dialog** as D02, with the options that exist today: PNG reference renders (1x, 2x), rem next to px, dev notes. "Comments" and "Include Google font files" stay in the picture as **disabled rows with a one-line reason** ("Not available yet") until the pipeline supports them; they are never silently dropped.
3. **Layers:** a ready dot on top-level frame rows (green ready, amber changed since ready, none otherwise), a context-menu item "Mark ready for dev / Clear ready mark", and a multi-select "Mark all on page".
4. **Inspector (outside the Dev section):** one compact row at the top of a top-level frame's inspector: "Ready for dev" switch and, when changed, the amber line "Changed since v3". The Dev section is T69's; when it lands, this row is what it embeds or replaces. No other inspector change.

## 3. States the artboards miss (builder draws them from the same components)

| State | Text and behaviour |
|---|---|
| Nothing selected in the list | "Export folder…" and "Save as zip…" disabled; count line reads "0 screens"; hint "Tick at least one screen." |
| Frame list loading | Rows appear immediately (the list needs no measuring); counts show "…" until the first plan finishes (planning is async: assets, measure). |
| Planning failed | Inline red line under the counts: "Could not prepare the preview: <reason>. You can still export without images." Export buttons stay enabled with the images option off. |
| Only unready frames, user chose "Choose frames anyway" | list shows all top-level frames, none ticked, banner "These frames are not marked ready." |
| File is in Dev Mode | Dialog works (reads only). Ready toggles in Layers/inspector are disabled with the read-only toast, as every edit. |
| Cancel while exporting | Back to the filled dialog; nothing written (temp folder removed). |
| Save dialog cancelled | Back to the filled dialog, no error. |
| Zip | Same flow; path shown ends in `.zip`; "Open folder" reveals the file. |
| Encrypted profile | The footer line says "Writes a decrypted copy…" (D02); never hidden. |

Empty file (no top-level frames): button disabled with tooltip "Nothing to export: add a frame first".

## 4. Decisions the builder must not guess

1. **Handoff number.** Title "Export handoff · vN": N is one more than the highest `Handoff vN` named version in this file's history (1 when there is none). A successful export saves the named version `Handoff vN` (existing `history.save`, kind `named`) **after** the files are in place; a failed export saves nothing. The H6 diff/CHANGES file is not part of this task.
2. **Ready mark.** `dev.ready = { at, hash }`: `at` is the N the next export will carry; `hash` is the content hash of the frame's spec at mark time (`contentHash` of its `nodeSpec` tree **without** measurement, so it is stable and cheap). This adds an optional `hash` to the H2 field (`model/dev.ts` keeps it; a `ready` without `hash`, from older marks, counts as "not changed"). "Changed since ready" = current hash differs. Marking, clearing and re-marking are normal undoable `setReady` steps. (The T58 plan kept the hash outside the node; a version-history-only home cannot work before the first export, so it lives on the mark.)
3. **Default scope** is ready frames, and "changed since ready" frames are ticked with the amber badge. Breakpoint-tagged frames of one screen are listed as separate rows under the screen name, as D02.
4. **Writing** happens in the main process: renderer builds the file map (T62 writer + T64 assets, measuring needs the DOM), sends it over one IPC call; main shows `dialog.showSaveDialog` (folder name / zip name), writes into a temp folder inside the chosen parent and renames, or writes the zip to a temp file and renames. A failure removes the temp and leaves nothing. No network, no external process.
5. **Paths** from the map are checked again in main (relative, no `..`, no reserved names, under the target) before any write.
6. **"Copy prompt"** copies the fixed sentence from D05, nothing else.
7. **Colour** tokens already exist (`--color-ready`, `--color-changed`, `--color-dev`); no new tokens.

## 5. Not in this task

Comments export, Google font files, CHANGES.md and history diff (H6), inspector Dev section (T69), MCP tools (T68), top-bar Design | Dev switch (done in T63).
