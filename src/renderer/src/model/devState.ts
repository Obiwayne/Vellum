// Interaction states for the developer handoff (T58 plan section 5.2): the vocabulary a `State` variant property
// uses, how each state maps to CSS and ARIA, the deltas of a drawn state against the default variant, and the
// one-step "Make State property". Pure; mutating functions take an immer draft like the rest of the model.
import type { CNode, Doc, PropDef, StylePatch } from './types'
import { createVariant, matchTrees, renameVariantOption, renameVariantProp, setOf, variantsOf, variantValues } from './variants'
import { propDefsOf } from './components'

/** The states the handoff knows how to map. Any other option name passes through as `data-state="…"`. */
export const STATE_VOCAB = ['default', 'hover', 'pressed', 'focus', 'focus-visible', 'disabled', 'loading', 'selected', 'error'] as const
export type KnownState = (typeof STATE_VOCAB)[number]

/** States an interactive component should say something about. */
export const CORE_STATES = ['hover', 'pressed', 'focus-visible', 'disabled'] as const

/** Names for the same state: `active` is `pressed`, `focused` is `focus`, `rest` is `default`. */
export function canonicalState(name: string): string {
  const k = name.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (k === 'active' || k === 'press' || k === 'pressed' || k === 'down') return 'pressed'
  if (k === 'focused' || k === 'focus') return 'focus'
  if (k === 'focus-visible' || k === 'keyboard-focus') return 'focus-visible'
  if (k === 'hovered' || k === 'hover') return 'hover'
  if (k === 'inactive' || k === 'disabled') return 'disabled'
  if (k === 'normal' || k === 'rest' || k === 'default' || k === 'enabled' || k === '') return 'default'
  return k
}

export interface StateTarget {
  /** CSS selector suffix, `:hover`, or `''` when only the attribute applies */
  css: string
  /** the ARIA / data attribute the same state is usually written as */
  attr?: string
}

const TARGETS: Record<string, StateTarget> = {
  default: { css: '' },
  hover: { css: ':hover' },
  pressed: { css: ':active' },
  focus: { css: ':focus' },
  'focus-visible': { css: ':focus-visible' },
  disabled: { css: ':disabled', attr: '[aria-disabled="true"]' },
  loading: { css: '', attr: '[aria-busy="true"]' },
  selected: { css: '', attr: '[aria-selected="true"]' },
  error: { css: '', attr: '[aria-invalid="true"]' }
}

/** CSS and ARIA form of a state; an unknown name becomes `[data-state="name"]`. */
export function stateTarget(state: string): StateTarget {
  const k = canonicalState(state)
  return TARGETS[k] ?? { css: '', attr: `[data-state="${k.replace(/["\\]/g, '')}"]` }
}

/** The `State` / `Status` variant property of a set or of a main in one, when it has one. */
export function stateProp(doc: Doc, id: string): PropDef | undefined {
  const defs = doc.nodes[id]?.componentSet?.props ?? propDefsOf(doc, id)
  return defs.find((p) => p.type === 'variant' && /^(state|status)$/i.test(p.name.trim()))
}

export interface LayerChange {
  /** layer names from the component root, `Label` or `Icon › Path` ('' = the root) */
  layer: string
  /** property -> value in the state (`null`: unset there) */
  patch: StylePatch
}

export interface StateDelta {
  /** canonical state name */
  state: string
  /** the option as the designer named it */
  option: string
  mainId: string
  /** only what differs from the default variant */
  changes: LayerChange[]
}

const SKIP = new Set(['width', 'height', 'left', 'top', 'right', 'bottom'])

/** Keys whose value differs; size and position are not state changes. */
export function styleDelta(base: CNode['style'], other: CNode['style']): StylePatch {
  const out: StylePatch = {}
  for (const k of new Set([...Object.keys(base), ...Object.keys(other)])) {
    if (SKIP.has(k)) continue
    if (base[k] !== other[k]) out[k] = other[k] === undefined ? null : other[k]
  }
  return out
}

/**
 * The deltas of every drawn state of a component set against its default variant. The default is the main
 * whose State option is the property's default (else the first). Matching layers are found by position and
 * type like variant switching does; layers with no counterpart are not compared.
 */
export function drawnStateDeltas(doc: Doc, setId: string): StateDelta[] {
  const set = doc.nodes[setId]
  if (!set?.componentSet) return []
  const prop = set.componentSet.props.find((p) => p.type === 'variant' && /^(state|status)$/i.test(p.name.trim()))
  if (!prop) return []
  const mains = variantsOf(doc, setId)
  const optionOf = (m: CNode): string => variantValues(doc, m.id)[prop.id] ?? String(prop.default)
  const base = mains.find((m) => optionOf(m) === prop.default) ?? mains[0]
  if (!base) return []
  const out: StateDelta[] = []
  const seen = new Set<string>()
  for (const m of mains) {
    const option = optionOf(m)
    const state = canonicalState(option)
    if (seen.has(state)) continue
    seen.add(state)
    const changes: LayerChange[] = []
    if (m.id !== base.id) {
      const map = matchTrees(doc, base.id, doc, m.id)
      const name = (id: string): string => {
        const parts: string[] = []
        for (let cur: string | null = id; cur && cur !== base.id; cur = doc.nodes[cur]?.parent ?? null) parts.unshift(doc.nodes[cur]?.name ?? cur)
        return parts.join(' › ')
      }
      for (const [from, to] of map) {
        const patch = styleDelta(doc.nodes[from].style, doc.nodes[to].style)
        if (Object.keys(patch).length) changes.push({ layer: name(from), patch })
      }
    }
    out.push({ state, option, mainId: m.id, changes })
  }
  return out
}

export type MakeStateResult = { ok: true; setId: string } | { ok: false; reason: string }

/**
 * Set a component up for drawn states in one step. A lone main becomes a set with a `State` property (options
 * `default` and `hover`, the second a copy to restyle); a set whose only variant property is not called State has
 * it renamed to `State`. A set that already has a State property is left alone.
 */
export function makeStateProperty(doc: Doc, mainOrSetId: string): MakeStateResult {
  const node = doc.nodes[mainOrSetId]
  if (!node) return { ok: false, reason: 'Layer not found' }
  let setId: string | null = node.componentSet ? mainOrSetId : node.component ? setOf(doc, mainOrSetId) : null
  if (!setId) {
    if (!node.component) return { ok: false, reason: 'Select a component first' }
    // a lone main: wrap it in a set (its first variant is "Default") and add the hover copy
    try {
      createVariant(doc, mainOrSetId)
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'Could not create the variant' }
    }
    setId = setOf(doc, mainOrSetId)
    if (!setId) return { ok: false, reason: 'Could not create the variant set' }
    const p = doc.nodes[setId].componentSet!.props.find((x) => x.type === 'variant')!
    renameVariantProp(doc, setId, p.id, 'State')
    renameVariantOption(doc, setId, p.id, 'Default', 'default')
    const second = (p.options ?? []).find((o) => o !== 'default')
    if (second) renameVariantOption(doc, setId, p.id, second, 'hover')
    return { ok: true, setId }
  }
  const set = doc.nodes[setId]
  if (stateProp(doc, setId)) return { ok: true, setId }
  const variantProps = set.componentSet!.props.filter((p) => p.type === 'variant')
  if (variantProps.length !== 1) return { ok: false, reason: 'This set has more than one variant property; name the one that is the State' }
  const p = variantProps[0]
  try {
    renameVariantProp(doc, setId, p.id, 'State')
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not rename the property' }
  }
  return { ok: true, setId }
}

/** ARIA roles the Dev section offers (anything else can be typed in the spec by hand). */
export const ROLES = ['button', 'link', 'textbox', 'checkbox', 'radio', 'switch', 'tab', 'tablist', 'tabpanel', 'menu', 'menuitem', 'listbox', 'option', 'combobox', 'slider', 'dialog', 'alert', 'navigation', 'heading', 'img', 'list', 'listitem', 'table', 'region', 'main', 'banner', 'contentinfo', 'search', 'form', 'status', 'tooltip', 'progressbar', 'presentation'] as const

/** A role guessed from the layer: used as a hint, always labelled "inferred", never written to the file. */
export function inferRole(doc: Doc, id: string): string | undefined {
  const n = doc.nodes[id]
  if (!n) return undefined
  if (n.type === 'image') return 'img'
  const comp = n.instance ? doc.nodes[n.instance.of]?.component?.name : n.component?.name
  const name = `${comp ?? ''} ${n.name}`.toLowerCase()
  if (/\b(button|btn|cta)\b/.test(name)) return 'button'
  if (/\blink\b/.test(name)) return 'link'
  if (/\b(input|field|textbox|text field|search box)\b/.test(name)) return 'textbox'
  if (/\bcheckbox\b/.test(name)) return 'checkbox'
  if (/\bradio\b/.test(name)) return 'radio'
  if (/\b(switch|toggle)\b/.test(name)) return 'switch'
  if (/\btab\b/.test(name)) return 'tab'
  if (/\b(nav|navigation|menu bar)\b/.test(name)) return 'navigation'
  if (n.type === 'text') {
    const style = n.textStyle ? doc.textStyles?.find((x) => x.id === n.textStyle)?.name.toLowerCase() : ''
    if (/\b(heading|title|h[1-6])\b/.test(`${style} ${n.name.toLowerCase()}`)) return 'heading'
  }
  return undefined
}
