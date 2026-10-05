# Components and instances — plan (T9, goal G5)

Status: plan only, no code yet. Written against `model/types.ts`, `model/ops.ts` (DOC_VERSION 2), `model/store.ts`, `bridge/*`, `shared/docDiff.ts`.

## Goal
Figma-style reusable components: make a component from a selection, place instances, edit the main component and see every instance update, override per-instance text/styles, detach.

## Data model (additive, DOC_VERSION 3)
Nodes stay a flat `Record<string, CNode>` tree. Two optional fields on `CNode`, nothing else changes shape:

```ts
interface CNode {
  /** main component: this top-level frame is a component definition (set on the root of the component only) */
  component?: { name: string }          // presence = "is a main component"; ids are stable keys
  /** instance: this frame mirrors the main component `of` */
  instance?: {
    of: string                          // id of the main component root node
    /** sparse overrides keyed by the MAIN's descendant id (the main root is key '') */
    overrides?: Record<string, NodeOverride>
  }
}
interface NodeOverride {
  style?: StylePatch                    // merged over main style (null = remove key)
  text?: string
  attrs?: Record<string, string>
  svg?: string
  visible?: boolean
  name?: string
}
```

Instance children are **materialised** (real CNodes in `doc.nodes`, so renderer, hit-testing, layers tree, bridge tools, export, `getNode` all keep working unchanged). Each materialised child carries `srcId?: string` (the main-side node it mirrors). Sync rebuilds them; they are derived data. Alternative (virtual children resolved at render) was rejected: every consumer of `doc.nodes` (ops, tools-read, html export, docDiff, inspector) would need a resolver.

Rules
- Main must be a `frame`, directly under a page root (artboard level) or inside any frame; instances may be placed anywhere except inside their own main (no cycles; reject `of` chains that loop). Nested instances allowed: an instance inside a main is itself an instance; syncing resolves depth-first.
- Instance root keeps its own `x/y`, `width/height`, `name`, locked/visible (not overridden by main). Everything below the root and the root's other style keys come from main + overrides.
- Override precedence: main value < instance override. Resetting an override deletes its key.
- Deleting a main: instances are detached (materialised nodes become plain nodes, `instance`/`srcId` stripped) in the same undo step.
- Detach: strip `instance` and `srcId` from the subtree. Duplicating an instance yields an instance; duplicating a main yields a plain frame copy (strip `component`) — `cloneSubtree` strips `component` and keeps `instance`.

## Sync
`ops.syncInstances(doc, mainId?)`, pure on a draft:
1. For each instance whose `of` matches (or all, if `mainId` omitted), diff main subtree vs instance subtree by `srcId`.
2. Add missing children (new id, `srcId` set), remove ones whose source is gone, reorder to main's order, copy `type/style/x/y/text/svg/attrs/visible/locked/name` from main, then apply `overrides[srcId]`.
3. Runs inside the same `mutate` transaction as the edit that changed a node under a main (so one undo step covers main + instances). Hook: `store.mutate` post-recipe step — find if any changed node is a descendant of a main (cheap: walk `ancestors`), then sync that main's instances. Not run for edits inside an instance subtree.
4. Editing a node inside an instance (`updateStyles`, `setText`, `moveNodes` on a non-structural prop) is recorded as an override on `instance.overrides[srcId]` instead of mutating main; structural edits (add/delete/reparent children inside an instance) are blocked with a toast "Detach instance to change structure".

Because instance subtrees are derived, `migrateDoc` v2→v3 only bumps the version; no rewrites needed (fields are optional).

## Store / ops API (new)
- `createComponent(docId, id)` — marks a frame as main (`component = {name}`); wraps non-frame / multi selection in a frame first (reuse `wrapNodes`).
- `createInstance(docId, mainId, parentId, index?, at?)` → id; `detachInstance(docId, id)`; `resetOverrides(docId, id, srcId?)`; `goToMain(docId, id)` (select main, switch page).
- `deleteNodes` / `duplicate` / `reparent` updated per the rules above.

## UI
- Layers tree: diamond icon for main, hollow diamond for instance; instance children read-only structure.
- Context menu + shortcuts: Create component (Ctrl+Alt+K), Detach instance (Ctrl+Alt+B), Go to main component, Reset overrides.
- Inspector: instance header (main name, Go to main, Detach, Reset all); overridden fields get a dot + reset affordance.
- Toolbar/left panel: "Components" list of mains in the doc (drag to canvas creates an instance); drag-out behaviour = `createInstance` at drop point.

## Bridge / MCP
- `get_node_info` / `get_children` / `find_nodes` add `isComponent`, `instanceOf` (docs/MCP.md updated). `write_html` into an instance subtree is rejected with a clear error (same message as the UI).
- New tools: `create_component(nodeId)`, `create_instance(componentId, parentId, index?)`, `detach_instance(nodeId)`. Keep to those three; overrides go through the normal `update_styles` / `set_text_content` (which already hit the override path).
- `html.ts` export/`get_jsx`: instances export as their materialised subtree (no special casing).

## Persistence / history / diff
- Fields serialize with the doc (storage already passes unknown node keys through — verify in `main/storage.ts` tests).
- `docDiff`: add `component`/`instance` to `DiffNode`; treat as aspect `'content'`-neutral; do not list derived instance-child changes as separate changes (skip nodes with `srcId` when their instance root is also in `changed`).
- Undo/redo: all sync happens inside `mutate`, so immer patches cover it; add tests.

## Tests (vitest, `model/components.test.ts`)
create → instance mirrors; edit main style/text/add child/remove child/reorder → instances follow; override survives main edit; reset override; detach; delete main detaches; duplicate main/instance; nested instances; cycle rejection; undo restores main and instances in one step; migrateDoc v3; docDiff skips derived nodes.

## Slicing for implementation (T9 station 2 and follow-ups)
1. types + ops (`createComponent`, `createInstance`, `syncInstances`, `detach`) + tests.
2. store hooks (sync in `mutate`, override routing, delete/duplicate rules) + tests.
3. UI (layers icons, menus/shortcuts, inspector header, components list).
4. Bridge tools + docs/MCP.md + docDiff.

## Open questions for Obi
- Variants/component sets: out of scope here (single main per component).
- Cross-file/library components: out of scope (same-doc only).
- Cross-page instances are allowed (`of` is a doc-wide id).
