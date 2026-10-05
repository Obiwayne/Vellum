# T17 — Variants and component properties: plan

Status: plan only, no code. Builds on `docs/COMPONENTS.md` (slices 1–3 merged: mains, instances, overrides, UI). Written against `model/components.ts`, `model/types.ts`, `shared/docDiff.ts`, `bridge/tools-*`.

Input note: `docs/factory/T17-concept.md` and a discovery document do not exist in the repo, so the scope below is my reading of the title and of the "out of scope" line in COMPONENTS.md ("Variants/component sets"). Anything I assumed is listed under "Decisions to approve".

## Approach

Figma-style, kept additive on the existing model. A **component set** is a group of main components that differ by named variant values. **Component properties** are named inputs on a component that drive things inside it. Both resolve in `syncInstance`; instances stay materialised, so renderer, layers, bridge and export need no new code paths.

### Data model (DOC_VERSION 4, additive, optional fields only)

```ts
type PropType = 'variant' | 'boolean' | 'text' | 'swap'
interface PropDef {
  id: string                 // stable key, never the display name
  name: string               // "Size", "Show icon", "Label"
  type: PropType
  default: string | boolean  // variant: an option, boolean: on/off, text: string, swap: main id
  options?: string[]         // variant only
}

interface CNode {
  component?: {
    name: string
    set?: string             // id of the set frame this main belongs to (variants only)
    variant?: Record<string, string>   // propId -> option, for a main inside a set
    props?: PropDef[]        // boolean/text/swap defs live on the main (set: on the set frame)
  }
  componentSet?: { name: string; props: PropDef[] }   // on the parent frame holding the variant mains
  bind?: { visible?: string; text?: string; swap?: string }  // on a node INSIDE a main: propId it follows
  instance?: { of: string; overrides?: ...; props?: Record<string, string | boolean> }  // existing + props
}
```

- A **set** is a frame (`componentSet`) whose direct children are mains. Variant props live on the set; the variant mains carry their `variant` values. Boolean/text/swap props are defined once on the set (or on a lone main) and apply to every variant, so bindings are by propId.
- An **instance** points at one main (`instance.of`) as today. Its `instance.props` holds values; the variant values choose which main of the set `of` points at.
- Property values land between main and overrides: main < property values < explicit overrides. Editing a bound field in the UI edits the property, not an override.
- No new node types, no virtual children. `migrateDoc` v3→v4 only bumps the version.

### Resolution rules (in `syncInstance`)
1. `of` = the set's main whose `variant` matches the instance's variant values (missing value → default; no exact match → closest by number of matching props, tie → first in order).
2. Copy main subtree as today.
3. For each node with `bind`: `visible` ← boolean value, `text` ← text value, `swap` ← replace this nested instance's `of` with the chosen main (keeping its own overrides where the srcId still exists).
4. Apply explicit overrides.

### Switching variants
Changing a variant value re-points `instance.of` to another main in the same set. Overrides are keyed by the old main's srcIds, so they are remapped through a node map built by matching the two mains by tree position and type (name breaks ties). Unmatched overrides are dropped and counted; the UI says "N overrides could not carry over" in a toast. Undo restores everything in one step.

## Order of work
1. Model: types, v4 migration, sets (`createVariant`, `variantsOf`, `pickMain`), pure `ops` + tests.
2. Model: properties (defs, bindings, values, swap) in `syncInstance` + variant override remap + tests.
3. Store: actions (`addVariant`, `setVariantValue`, `addProp`, `bindProp`, `setInstanceProp`), delete/duplicate rules for sets, docDiff, undo tests.
4. UI: create set from a main ("Add variant"), set frame chrome, Layers icons.
5. UI: inspector — property editor on a main/set, property controls on an instance, bound-field markers.
6. Bridge/MCP: node info fields + three tools + `docs/MCP.md`.
7. Docs, e2e, regression pass over the existing components flow.

## Risks
- **Override remap loses data** when variants differ structurally. Mitigation: documented best-effort match, toast with the dropped count, covered by tests that include a missing layer.
- **Sync cost**: a set with N variants and M instances. Sync stays per-instance and only for stale mains (`staleAfter`); add a perf test like the existing 2000-node one.
- **Cycles through swap props**: a swap target containing the instance being swapped. Reuse the `CYCLE_MSG` check on every `setInstanceProp` and on `bind swap`.
- **Deleting a variant main** that instances use: re-point them to the default variant, never detach silently.
- **Spec drift with the importer / MCP `write_html`**: writes into an instance stay rejected; writes into a main resync as now.
- **Large UI surface**: keep inspector work in its own task so review stays small.

## How it is tested
- Unit (`model/*.test.ts`, vitest): pick-main matching, remap, every prop type, defaults, precedence (main < prop < override), delete/duplicate rules, cycle rejection, v4 migration, docDiff skips derived nodes.
- Store tests: one undo restores main(s) and instances for each action.
- UI wiring tests like `componentUi.test.ts` (icons, inspector sections render for the right selection).
- Playwright e2e next to `scripts/e2e-components.mjs`: build a Button set (Size variant, Show icon boolean, Label text), place an instance, flip each prop and read the DOM, switch variant with an override present, undo.
- Existing suites stay green (`npm test`, typecheck, `npm run test:mcp` for the bridge task).

## Decisions to approve
- Sets are a frame with `componentSet`, variants are its child mains (Figma model), not a flat list with tags.
- Four prop types only: variant, boolean, text, swap. No numeric or color props.
- Explicit overrides win over property values; bound fields edit the property.
- Variant switch remaps overrides best-effort and drops the rest with a toast.
- Same-doc only, as in COMPONENTS.md.

## Left out
Library/cross-file components, numeric/color props, nested property exposure (promoting a nested instance's props), variant-aware drag from an Assets panel (G7), prototype interactions.

## Task breakdown

**T-A. Variants model: sets, pick-main, v4 migration** — line: feature
- `componentSet` / `component.set` / `component.variant` types added; `DOC_VERSION` 4 and `migrateDoc` bump with a test.
- `createVariant(main)` duplicates a main into a set frame (creating the set if needed) with its variant values; `variantsOf`, `pickMain` implemented as pure functions.
- Unit tests cover exact match, partial match, defaults and tie-break; `npm test` passes.

**T-B. Component properties model: defs, bindings, values, swap** — line: feature
- `PropDef`, `node.bind`, `instance.props` added; `syncInstance` applies main < property < override in that order.
- Boolean toggles visibility, text sets text, swap re-points a nested instance; a swap that would create a cycle throws `CYCLE_MSG`.
- Unit tests for each type, defaults, precedence and cycles; `npm test` passes.

**T-C. Store actions, variant switch remap, undo, docDiff** — line: feature (needs T-A, T-B)
- Actions `addVariant`, `setVariantValue`, `addProp`, `bindProp`, `setInstanceProp` exist; each is one undo step covering mains and instances.
- Switching a variant remaps overrides by tree position and type; dropped overrides are returned as a count; test with a missing layer.
- Deleting a variant main re-points its instances to the default variant; duplicating a set duplicates its mains; docDiff skips derived nodes and lists set/props changes once.

**T-D. UI: variant sets on canvas and Layers** — line: ui (needs T-C)
- "Add variant" on a selected main (context menu and inspector) creates a set frame with the new variant beside the original.
- Layers shows a set icon and its variant mains; the instance header shows the current variant.
- UI wiring tests plus a screenshot of a set; the existing component e2e still passes.

**T-E. UI: inspector for properties and variants** — line: ui (needs T-C)
- On a main/set: add, rename, delete a property, choose its type and default, bind a selected layer's visibility/text/swap to it.
- On an instance: a dropdown per variant prop, a toggle per boolean, a text field per text prop, a picker per swap prop; bound fields in the layer inspector show a marker and edit the property.
- Wiring tests for each control; e2e flips every property type and reads the DOM result; one undo reverts each change.

**T-F. Bridge/MCP: variants and properties** — line: feature (needs T-C)
- `get_node_info`, `get_children`, `find_nodes` report `componentSet`, `variant`, `props`, instance `props`.
- New tools `create_variant`, `set_instance_props`; `write_html` into an instance is still rejected; `docs/MCP.md` updated.
- `npm run test:mcp` covers both tools and a round trip with undo.

**T-G. End-to-end regression and docs** — line: bugfix (needs T-D, T-E)
- `scripts/e2e-variants.mjs` builds a Button set and runs the flow listed under "How it is tested"; all steps pass on a fresh build.
- `docs/COMPONENTS.md` gains a Variants and properties section; README and Learn page list any new shortcut.
- Full `npm test`, typecheck and `npm run test:mcp` pass.
