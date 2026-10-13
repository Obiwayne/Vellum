// Markdown specs: screens/<slug>.md and components/<slug>.md. Per node the layout *intent* comes first and the
// numbers second (T58 plan section 4); nothing here reads the document, only the built spec, so the markdown and
// spec.json cannot disagree.
import { formatNumber, sizingText, toRem } from '../devSpec'
import type { EffectSpec, PaintSpec } from '../devSpec'
import type { ComponentSpec, HandoffNode, ScreenSpec, TextStyleSpec } from './types'

export interface MdOptions {
  rem: boolean
  /** screen / component names by id, for "used by" lists */
  names: Map<string, string>
  /** component property id -> display name, for variant and prop keys on instances */
  propNames: Map<string, string>
  /** per frame id: fractional nodes */
  fractional: Map<string, Array<{ id: string; name: string; width: number; height: number }>>
}

/** One line of user text: no newlines, no table or code breakers. */
const inline = (s: string): string => s.replace(/\s+/g, ' ').replace(/[`|]/g, "'").trim()

const px = (v: number, rem: boolean): string => `${formatNumber(v)}px${rem ? ` (${toRem(v)})` : ''}`
const size = (n: HandoffNode, rem: boolean): string => {
  const { w, h } = n.sizing
  if (n.box.measured) return `${px(n.box.width, rem)} × ${px(n.box.height, rem)}`
  if (w.mode === 'fixed' && h.mode === 'fixed') return `${px(w.value, rem)} × ${px(h.value, rem)} (authored, not measured)`
  return 'not measured'
}

function paintText(p: PaintSpec): string {
  const c = p.color
  const col = c ? `${c.oklch ?? c.hex8 ?? c.value}${c.hex8 && c.oklch ? ` (sRGB ${c.hex8})` : ''}${c.token ? ` [${c.token}]` : ''}` : ''
  if (p.kind === 'stroke') {
    const w = Array.isArray(p.width) ? p.width.map((v) => formatNumber(v)).join(' ') : formatNumber(p.width ?? 0)
    return `stroke ${w}px ${p.style ?? 'solid'} ${col}`.trim()
  }
  if (p.kind === 'text') return `text colour ${col}`
  if (p.type === 'gradient') return `fill ${inline(p.value ?? 'gradient')}`
  if (p.type === 'image') return `fill image (${p.value === 'data-url' ? 'embedded' : inline(p.value ?? '')})`
  return `fill ${col}`
}

function effectText(e: EffectSpec): string {
  if (e.kind === 'blur' || e.kind === 'backdrop-blur') return `${e.kind === 'blur' ? 'blur' : 'backdrop blur'} ${formatNumber(e.blur)}`
  const col = e.color ? ` ${e.color.hex8 ?? e.color.value}` : ''
  return `${e.kind === 'inner-shadow' ? 'inner shadow' : 'shadow'} ${formatNumber(e.x ?? 0)} ${formatNumber(e.y ?? 0)} ${formatNumber(e.blur)} ${formatNumber(e.spread ?? 0)}${col}`
}

function nodeLines(n: HandoffNode, depth: number, o: MdOptions): string[] {
  const pad = '  '.repeat(depth)
  const sub = `${pad}  - `
  const name = inline(n.name) || n.type
  const out = [`${pad}- **${name}** \`${n.id}\` — ${n.layout.summary}, ${sizingText(n.sizing.w, n.sizing.h)}`]
  const where =
    n.flowIndex !== undefined
      ? `flow item ${n.flowIndex + 1}`
      : n.box.relTo === 'artboard'
        ? 'artboard root'
        : n.box.x !== undefined && n.box.y !== undefined
          ? `at ${formatNumber(n.box.x)}, ${formatNumber(n.box.y)} in parent`
          : ''
  out.push(`${sub}size: ${size(n, o.rem)}${where ? ` · ${where}` : ''}`)
  if (n.paints.length) out.push(`${sub}paint: ${n.paints.map(paintText).join('; ')}`)
  if (n.text) {
    const t = n.text
    const lh = t.lineHeightPx === null ? 'line height unknown' : `line height ${px(t.lineHeightPx, o.rem)} (${formatNumber(t.lineHeightRatio ?? 0, 4)})`
    const bits = [
      JSON.stringify(t.content),
      `${t.fontFamily ? `${inline(t.fontFamily)} ` : ''}${px(t.fontSize, o.rem)} weight ${t.fontWeight}${t.fontStyle ? ` ${t.fontStyle}` : ''}`,
      lh,
      t.letterSpacingPx ? `letter spacing ${formatNumber(t.letterSpacingPx)}px (${formatNumber(t.letterSpacingEm, 4)}em)` : '',
      t.textAlign ? `align ${t.textAlign}` : '',
      t.textTransform ? t.textTransform : '',
      t.textDecoration ? t.textDecoration : '',
      t.textStyle ? `text style ${inline(t.textStyle)}` : ''
    ].filter(Boolean)
    out.push(`${sub}text: ${bits.join(' · ')}`)
  }
  const look: string[] = []
  if (n.radius !== undefined) look.push(`radius ${Array.isArray(n.radius) ? n.radius.map((v) => formatNumber(v)).join(' ') : typeof n.radius === 'number' ? px(n.radius, o.rem) : inline(n.radius)}`)
  if (n.opacity !== undefined) look.push(`opacity ${formatNumber(n.opacity, 3)}`)
  if (n.rotation !== undefined) look.push(`rotated ${formatNumber(n.rotation)}° (box is the bounding rect)`)
  for (const e of n.effects) look.push(effectText(e))
  if (look.length) out.push(`${sub}look: ${look.join('; ')}`)
  if (n.image) out.push(`${sub}image: ${n.image.alt !== undefined ? `alt ${JSON.stringify(n.image.alt)}` : 'no alt text'}${n.image.objectFit ? `, fit ${n.image.objectFit}` : ''}`)
  if (n.tokens.length) out.push(`${sub}tokens: ${n.tokens.map((t) => t.name).join(', ')}`)
  if (n.component) {
    const c = n.component
    const parts = [
      c.variant ? `variant ${Object.entries(c.variant).map(([k, v]) => `${inline(o.propNames.get(k) ?? k)}=${inline(v)}`).join(', ')}` : '',
      c.props ? `props ${Object.entries(c.props).map(([k, v]) => `${inline(o.propNames.get(k) ?? k)}=${JSON.stringify(v)}`).join(', ')}` : '',
      c.overrides ? `overrides on ${c.overrides.join(', ')}` : ''
    ].filter(Boolean)
    out.push(`${sub}component: ${inline(c.name ?? c.ref)} \`${c.ref}\`${parts.length ? ` (${parts.join('; ')})` : ''}`)
  }
  if (n.a11y) {
    const a = n.a11y
    const bits = [a.role ? `role ${a.role}` : '', a.label ? `label ${JSON.stringify(a.label)}` : '', a.tab !== undefined ? `focus order ${a.tab}` : ''].filter(Boolean)
    if (bits.length) out.push(`${sub}a11y: ${bits.join(', ')}`)
  }
  if (n.states) {
    for (const [state, patch] of Object.entries(n.states)) {
      const css = Object.entries(patch)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
      out.push(`${sub}state ${inline(state)}: ${css}`)
    }
  }
  for (const note of n.notes ?? []) out.push(`${sub}note: ${inline(note)}`)
  if (n.needsDecision) out.push(`${sub}**needs-decision:** ${inline(n.needsDecision)}`)
  for (const c of n.children) out.push(...nodeLines(c, depth + 1, o))
  return out
}

export const nodeTree = (root: HandoffNode, o: MdOptions): string => nodeLines(root, 0, o).join('\n')

export function screenMarkdown(s: ScreenSpec, o: MdOptions): string {
  const L: string[] = [`# ${inline(s.name)}`, '']
  L.push(`- Screen id: \`${s.id}\` · file \`${s.doc}\``)
  if (s.ready) L.push(`- Marked ready for dev in handoff v${s.ready.at}`)
  L.push(`- Breakpoints: ${s.breakpoints.map((b) => `${inline(b.name)} ${formatNumber(b.width)} × ${formatNumber(b.height)}`).join(', ')}`)
  L.push('')
  L.push('Each line below is: layout intent first (how the box behaves), then its size, then what it looks like. Build from the intent; the numbers are the design-time result.')
  for (const b of s.breakpoints) {
    L.push('', `## ${inline(b.name)} · ${formatNumber(b.width)} × ${formatNumber(b.height)}`, '')
    L.push(`Frame \`${b.frameId}\` · reference render \`${b.png}\``)
    const frac = o.fractional.get(b.frameId) ?? []
    if (frac.length) {
      const e = frac[0]
      L.push('', `${frac.length} node${frac.length === 1 ? ' has' : 's have'} fractional sizes (e.g. ${formatNumber(e.width)} × ${formatNumber(e.height)}); build with the rule, not the number.`)
    }
    L.push('', nodeTree(b.root, o))
  }
  return `${L.join('\n')}\n`
}

// ---------------------------------------------------------------------------------------------
// component states

const CORE_STATES = ['hover', 'pressed', 'focus-visible', 'disabled']
const INTERACTIVE = /button|btn|link|input|field|select|toggle|switch|checkbox|radio|tab\b|chip|menu|dropdown|slider/i

/** Vocabulary of T58 plan 5.2: an option name mapped to a canonical state. */
export function canonicalState(option: string): string {
  const k = option.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (k === 'active' || k === 'press' || k === 'pressed') return 'pressed'
  if (k === 'focused' || k === 'focus') return 'focus'
  if (k === 'hovered') return 'hover'
  if (k === 'normal' || k === 'rest' || k === 'default') return 'default'
  return k
}

export interface StateRow {
  state: string
  badge: 'drawn' | 'described' | 'missing'
  changes: string[]
}

/** CSS-ish deltas of one node and its same-named children against a base. */
function deltas(base: HandoffNode, other: HandoffNode, path: string, out: string[]): void {
  const keys = new Set([...Object.keys(base.style.resolved), ...Object.keys(other.style.resolved)])
  for (const k of [...keys].sort()) {
    if (['width', 'height', 'left', 'top'].includes(k)) continue
    const a = base.style.resolved[k]
    const b = other.style.resolved[k]
    if (a !== b) out.push(`${path}${k}: ${a ?? 'unset'} → ${b ?? 'unset'}`)
  }
  const used = new Set<number>()
  base.children.forEach((c, i) => {
    const j = other.children.findIndex((d, idx) => !used.has(idx) && d.name === c.name && d.type === c.type)
    const pick = j >= 0 ? j : other.children[i] && !used.has(i) && other.children[i].type === c.type ? i : -1
    if (pick < 0) return
    used.add(pick)
    deltas(c, other.children[pick], `${path}${inline(c.name)} › `, out)
  })
}

export function stateRows(c: ComponentSpec): StateRow[] {
  const stateProp = c.props.find((p) => p.type === 'variant' && /^(state|status)$/i.test(p.name.trim()))
  const rows = new Map<string, StateRow>()
  let base: ComponentSpec['variants'][number] | undefined
  if (stateProp) {
    const def = canonicalState(String(stateProp.default))
    base = c.variants.find((v) => canonicalState(v.values[stateProp.id] ?? '') === def) ?? c.variants[0]
    for (const v of c.variants) {
      const opt = v.values[stateProp.id]
      if (opt === undefined) continue
      const state = canonicalState(opt)
      if (rows.has(state)) continue
      const changes: string[] = []
      if (v !== base && base) deltas(base.root, v.root, '', changes)
      rows.set(state, { state, badge: 'drawn', changes })
    }
  }
  // described (undrawn) states on the component's roots
  for (const v of c.variants) {
    for (const [name, patch] of Object.entries(v.root.states ?? {})) {
      const state = canonicalState(name)
      if (rows.has(state)) continue
      rows.set(state, {
        state,
        badge: 'described',
        changes: Object.entries(patch)
          .filter(([, val]) => val !== null && val !== undefined)
          .map(([k, val]) => `${k}: ${val}`)
      })
    }
  }
  const interactive = Boolean(stateProp) || INTERACTIVE.test(c.name) || c.variants.some((v) => ['button', 'link', 'textbox', 'checkbox', 'switch', 'tab'].includes(v.root.a11y?.role ?? ''))
  if (interactive) for (const s of CORE_STATES) if (!rows.has(s)) rows.set(s, { state: s, badge: 'missing', changes: [] })
  const rank = (r: StateRow): number => (r.state === 'default' ? 0 : CORE_STATES.indexOf(r.state) + 1 || 99)
  return [...rows.values()].sort((a, b) => rank(a) - rank(b) || a.state.localeCompare(b.state))
}

export function componentMarkdown(c: ComponentSpec, o: MdOptions): string {
  const L: string[] = [`# ${inline(c.name)}`, '']
  L.push(`- Component id: \`${c.id}\` · ${c.set ? `set of ${c.variants.length} variant${c.variants.length === 1 ? '' : 's'}` : 'single component'}`)
  L.push(`- Used by: ${c.usedBy.length ? c.usedBy.map((id) => inline(o.names.get(id) ?? id)).join(', ') : 'nothing in the exported frames'}`)
  if (c.props.length) {
    L.push('', '## Properties', '', '| Name | Type | Default | Options |', '| --- | --- | --- | --- |')
    for (const p of c.props) L.push(`| ${inline(p.name)} | ${p.type} | ${inline(JSON.stringify(p.default))} | ${(p.options ?? []).map(inline).join(', ')} |`)
  }
  const rows = stateRows(c)
  if (rows.length) {
    L.push('', '## States', '', 'Drawn = a variant exists; described = written down without a drawing; missing = not specified, use project defaults.', '')
    L.push('| State | Status | What changes |', '| --- | --- | --- |')
    for (const r of rows) L.push(`| ${r.state} | ${r.badge} | ${r.changes.length ? r.changes.slice(0, 12).map(inline).join('; ') : r.badge === 'missing' ? '—' : 'base appearance'} |`)
  }
  L.push('', '## Variants')
  for (const v of c.variants) {
    const vals = Object.entries(v.values)
    const label = vals.length ? vals.map(([k, val]) => `${inline(c.props.find((p) => p.id === k)?.name ?? k)}=${inline(val)}`).join(', ') : inline(v.name)
    L.push('', `### ${label}`, '', nodeTree(v.root, o))
  }
  return `${L.join('\n')}\n`
}

export function textStylesMarkdown(styles: TextStyleSpec[]): string[] {
  if (!styles.length) return []
  return ['## Text styles', '', ...styles.map((s) => `- **${inline(s.name)}**: ${Object.entries(s.style).map(([k, v]) => `${k} ${v}`).join(', ')}`)]
}
