# T25 — Text styles and colour styles: plan

Status: plan only, no code. Written against `model/types.ts` (`Token`, `Doc.tokens`, `Doc.modes`), `editor/inspector/{TextSection,ColorInput,SelectionColorsSection}.tsx`, `editor/left/{ThemePanel,tokenUtils}.ts*`, `editor/textStyle.ts`, `model/components.ts`.

Input note: `docs/factory/T25-concept.md` and a discovery document do not exist in the repo. Scope is my reading of the title plus what the code already has. Assumptions are listed under "Decisions to approve".

## What exists today
- **Colours are already shared by name.** A fill, stroke or text colour can hold `var(--color-x)`. Tokens live in `Doc.tokens`, have per-mode values (Light/Dark), a picker in `ColorInput`, a list in the Theme tab, and "Selection colors" can turn a literal into a token. Editing a token updates every node live because the browser resolves `var()`.
- **Typography is not shared as a unit.** There are single tokens (`--text-lg`, `--font-sans`) but no named bundle of family + size + weight + line height + letter spacing. Every text node carries its own copy of those keys.

So the plan is asymmetric on purpose: **colour styles are a thin layer over colour tokens; text styles are new.**

## Approach

### Colour styles = named colour tokens, surfaced as styles
No new data. A colour style is a token whose name starts with `--color-` (already grouped by `tokenUtils.groupOf`). What we add:
- A "Colour styles" list (grouped by slash/hyphen prefix, swatch + name) in the Styles panel, reading `Doc.tokens`.
- "Create colour style" from a selected fill/stroke/text colour (reuses `addColorToken`, one undo step) and "Apply" to fill, stroke or text colour of the selection (writes `var(--token)`).
- "Detach" on a field turns `var(--token)` back into the resolved literal for the active mode.
- Theme modes keep working unchanged, because the value is still a CSS variable.
Gradients and multi-layer fills as styles are left out (a token holds one colour).

### Text styles = new doc-level data, materialised on nodes
```ts
interface TextStyle {
  id: string
  name: string                 // "Heading/H1": slash groups it in the list
  style: Style                 // only keys from TEXT_STYLE_KEYS, values may be var(--token)
}
const TEXT_STYLE_KEYS = ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textDecorationLine','textTransform']
interface Doc  { textStyles?: TextStyle[] }          // optional, additive
interface CNode { textStyle?: string }               // id of the style this text node follows
```
- Text colour is **not** part of a text style (it is a colour style). Alignment is not part of it either.
- **Materialised, not virtual**, like component instances: applying a style copies its keys onto the node's `style` and sets `node.textStyle`. Renderer, export, bridge tools, `get_jsx` and the importer keep reading plain CSS. The alternative (resolve at render time) would touch every consumer of `node.style`.
- **Sync:** editing a text style rewrites those keys on every node linked to it, inside the same store transaction, so one undo step covers the style and all nodes. Reuse the `staleAfter` / settle pattern from `model/components.ts`.
- **Detach on manual edit:** changing a typography key of a linked node from the inspector clears `node.textStyle` (values stay as they are, nothing is rewritten) and shows a toast "Detached from text style X". This is done in the store's `updateStyles` for text-style keys only; `applyStylePatch` is not touched (lesson from T10).
- **Inside component instances:** applying a style to a node inside an instance goes through the existing override path; `NodeOverride` gains `textStyle`. Main edits still flow to instances.
- **Deleting a style** unlinks its nodes and keeps their values. **Duplicating** nodes keeps the link.
- "New text" from the Text tool copies the last text style including the link (`textStyle.ts` `TYPOGRAPHY_KEYS` gains the link).
- Migration: `DOC_VERSION` bump with a no-op `migrateDoc` step (fields optional). The version number is whatever is next free when this lands; T17 also plans a bump.

## Order of work
1. Model: types, `ops` for create/update/delete/apply/detach/sync, migration, tests.
2. Store: actions, unlink-on-edit, instance override path, docDiff, persistence round trip, undo tests.
3. Inspector: text style row (picker, create from selection, detach, edit marker).
4. Styles panel in the left Theme tab: text style list (live preview, create/rename/delete/edit) and colour style list over tokens.
5. Colour style apply/detach in the Fill, Stroke and text colour fields and in "Selection colors".
6. MCP tools and docs.
7. End-to-end run and docs.

## Risks
- **Rewriting node style on style edit** could clobber a deliberate per-node tweak. Mitigation: any manual typography edit detaches first, so only linked, untouched nodes are rewritten; tests cover it.
- **Fit containers**: a style change that raises font size or line height must still grow Fit parents. Style sync only writes the same CSS keys as the inspector, so the T10 behaviour applies; one e2e check proves it with a unitless line height.
- **Instances and sync order**: text style sync followed by instance sync in one transaction. Test a main edit plus style edit in one undo step.
- **Name collisions and slashes** in style names; reuse `uniqueName`/`normalizeName` behaviour and test duplicates.
- **Colour "styles" that are just tokens** may disappoint if the concept expects gradient styles. Called out for approval rather than hidden.
- **Importer pinned by `html.test.ts`** stays untouched: no import path writes `textStyle`.
- **File size/format**: `Doc.textStyles` must pass through `main/storage.ts` untouched; round-trip test.

## How it is tested
- Unit (vitest, `model/*.test.ts`): apply copies exactly the style keys and removes unset ones; sync updates all linked nodes; detach-on-edit; delete unlinks; var() values survive; instance override path; migration; docDiff lists a style change once.
- Store tests: one undo restores style and every linked node.
- UI wiring tests like `componentUi.test.ts`: inspector row and panel render for the right selection; menu entries.
- Playwright e2e next to the existing ones: create a text style from a selected text, apply it to a second text, edit the style (16 → 48) and see both grow, edit one node manually and see it detach, undo; create a colour style, apply it, change the token and read the DOM colour in Light and Dark.
- Existing suites stay green (`npm test`, typecheck, `npm run test:mcp` for the MCP task).

## Decisions to approve
- Colour styles are colour tokens with a Styles-panel view and apply/create/detach actions; no new data, no gradient styles in this slice.
- Text styles are a new `Doc.textStyles` list materialised on nodes with a `textStyle` link.
- A text style holds family, size, weight, style, line height, letter spacing, underline/strikethrough, case. Not colour, not alignment.
- A manual typography edit detaches the link (toast); style edits rewrite only linked nodes.
- Same-doc only; styles do not vary per theme mode.

## Left out
Gradient/image/effect/grid styles, per-mode text styles, cross-file libraries and publishing, applying styles by drag from an Assets panel (G7), numeric/spacing styles, importing styles from CSS files.

## Task breakdown

**T-A. Text styles model** — line: feature
- `TextStyle`, `Doc.textStyles`, `CNode.textStyle`, `TEXT_STYLE_KEYS` and `NodeOverride.textStyle` are added; `migrateDoc` bumps the version with a test.
- `ops` create, rename, update, delete, apply and detach exist; apply writes exactly the style keys and removes keys the style leaves unset; delete unlinks nodes and keeps their values.
- `syncTextStyle` rewrites all linked nodes; unit tests cover each function; `npm test` passes.

**T-B. Store actions, detach-on-edit, history, diff** — line: feature (needs T-A)
- Store actions `createTextStyle`, `updateTextStyle`, `deleteTextStyle`, `applyTextStyle`, `detachTextStyle` each make one undo step including every linked node.
- `updateStyles` on a linked node with a typography key clears the link, keeps the values, and the UI toast text is available; MCP `update_styles` behaves the same.
- Applying inside a component instance goes through the override path; docDiff lists a style change once; a doc with styles round-trips through storage; tests for each.

**T-C. Inspector: text style row** — line: ui (needs T-B)
- The Text section shows a style picker (name, "None"), "Create style from selection", "Detach", and a marker when the node follows a style.
- Picking a style applies it in one undo step; multi-selection works; wiring tests render each state.
- Screenshots before and after for the three states (none, linked, detached).

**T-D. Styles panel: text styles and colour styles** — line: ui (needs T-B)
- A Styles view in the left Theme tab lists text styles (live preview, slash grouping) with create, rename, delete and edit-in-place, and colour styles (swatch, name, per-mode value) over `Doc.tokens`.
- "Create colour style" from the selected fill/stroke/text colour uses `addColorToken` in one undo step; duplicate names are refused with a message.
- Wiring tests plus a screenshot of the panel with both lists.

**T-E. Apply and detach colour styles in fields** — line: ui (needs T-D)
- Fill, Stroke and text colour pickers list colour styles first; choosing one writes `var(--token)`; "Detach" writes the resolved literal for the active mode.
- "Selection colors" offers "Convert to style" for literals; undo restores in one step.
- A test switches theme mode and reads the resolved colour; unit tests for detach.

**T-F. MCP tools** — line: feature (needs T-B)
- New tools `get_text_styles`, `create_text_style`, `apply_text_style`; colour styles use the existing `get_tokens`/`set_tokens`; `docs/MCP.md` lists them.
- `npm run test:mcp` covers create, apply, edit-style-follows and undo; `get_node_info` reports `textStyle`.

**T-G. End-to-end and docs** — line: bugfix (needs T-C, T-D, T-E)
- `scripts/e2e-styles.mjs` runs the flow from "How it is tested" on a fresh build; every step passes, including a 16 → 48 style edit growing a Fit container.
- Docs updated (a Styles section in `docs/INSPECTOR.md` or `docs/LEFT_DASHBOARD.md`, README/Learn page for any new shortcut).
- `npm test`, typecheck and `npm run test:mcp` pass.
