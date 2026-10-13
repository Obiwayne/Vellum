// What the Dev Mode Spec panel shows for one layer: NodeSpec (model/devSpec.ts) turned into labelled rows.
// Pure, no React and no DOM, so the panel is a thin renderer and the rows are unit-tested.
import type { Doc } from '../../model/types'
import { propDefsOf } from '../../model/components'
import { variantValues } from '../../model/variants'
import { formatNumber, intentLine, type ColorSpec, type EffectSpec, type NodeSpec, type PaintSpec, type SizeRule } from '../../model/devSpec'

export interface SpecRow {
  label: string
  value: string
  /** text put on the clipboard when the row is clicked (default: value) */
  copy?: string
  /** colour to preview as a swatch */
  swatch?: string
  /** token behind the value, shown as a chip */
  token?: string
  /** per-mode values of the token (mode, value, swatch) when the file has modes */
  modes?: Array<{ mode: string; value: string; swatch?: string }>
}

export interface SpecSection {
  id: 'box' | 'layout' | 'typography' | 'fills' | 'strokes' | 'effects' | 'component' | 'tokens'
  title: string
  rows: SpecRow[]
}

const n = (v: number): string => formatNumber(v)
const px = (v: number): string => `${n(v)}px`

export function sizeText(r: SizeRule): string {
  let s: string
  if (r.mode === 'fixed') s = px(r.value)
  else if (r.mode === 'percent') s = `${n(r.value)}%`
  else if (r.mode === 'fill') s = r.weight && r.weight !== 1 ? `Fill (×${n(r.weight)})` : 'Fill'
  else s = 'Fit'
  const extra: string[] = []
  if (r.min !== undefined) extra.push(`min ${px(r.min)}`)
  if (r.max !== undefined) extra.push(`max ${px(r.max)}`)
  if (r.aspect !== undefined) extra.push(`ratio ${n(r.aspect)}`)
  return extra.length ? `${s} (${extra.join(', ')})` : s
}

const sides = (p: [number, number, number, number]): string => {
  const [t, r, b, l] = p
  if (t === r && r === b && b === l) return px(t)
  if (t === b && l === r) return `${px(t)} ${px(r)}`
  return p.map(px).join(' ')
}

function colorRow(label: string, c: ColorSpec | undefined, tokenModes?: SpecRow['modes']): SpecRow {
  if (!c) return { label, value: '—' }
  const shown = c.oklch ?? c.value
  const hex = c.hex8 && c.hex8.toUpperCase().endsWith('FF') ? c.hex8.slice(0, 7) : c.hex8 ?? shown
  const value = c.oklch ? `${c.oklch} · ${hex}` : c.opacity < 1 ? `${hex} · ${n(c.opacity * 100)}%` : hex
  return { label, value, copy: c.hex8 ? hex : shown, swatch: c.hex8 ?? undefined, token: c.token, modes: tokenModes }
}

function modesOf(spec: NodeSpec, token: string | undefined): SpecRow['modes'] {
  if (!token) return undefined
  const t = spec.tokens.find((x) => x.name === token)
  if (!t) return undefined
  const entries = Object.entries(t.values)
  if (entries.length < 2) return undefined
  return entries.map(([mode, v]) => ({ mode, value: v.value, swatch: v.hex8 }))
}

function paintRows(spec: NodeSpec, kind: PaintSpec['kind'][]): SpecRow[] {
  const out: SpecRow[] = []
  for (const p of spec.paints) {
    if (!kind.includes(p.kind)) continue
    const label = p.kind === 'text' ? 'Text colour' : p.kind === 'stroke' ? 'Stroke' : 'Fill'
    if (p.type === 'solid') out.push(colorRow(label, p.color, modesOf(spec, p.color?.token)))
    else if (p.type === 'gradient') out.push({ label, value: p.value ?? 'gradient' })
    else out.push({ label, value: 'Image', copy: p.value })
    if (p.kind === 'stroke' && p.width !== undefined) {
      const w = Array.isArray(p.width) ? p.width.map(px).join(' ') : px(p.width)
      out.push({ label: 'Stroke width', value: `${w}${p.style ? ` ${p.style}` : ''}` })
    }
  }
  return out
}

function effectRow(e: EffectSpec): SpecRow {
  if (e.kind === 'blur' || e.kind === 'backdrop-blur') return { label: e.kind === 'blur' ? 'Blur' : 'Background blur', value: px(e.blur) }
  const parts = [px(e.x ?? 0), px(e.y ?? 0), px(e.blur)]
  if (e.spread) parts.push(px(e.spread))
  const c = e.color?.hex8 ?? e.color?.value ?? ''
  return { label: e.kind === 'inner-shadow' ? 'Inner shadow' : 'Shadow', value: `${parts.join(' ')} ${c}`.trim(), swatch: e.color?.hex8 ?? undefined }
}

/** What a main component, one variant of a set, or a component set itself defines, for the Component section. */
export interface MainInfo {
  /** `component`: a single main; `variant`: one main of a set; `set`: the set frame */
  kind: 'component' | 'variant' | 'set'
  name: string
  /** the set a variant belongs to */
  setName?: string
  /** variant property -> this main's value (the default, for a set) and the options of the set */
  variants: Array<{ prop: string; value: string; options: string[] }>
  /** boolean / text / swap properties with their defaults */
  props: Array<{ name: string; type: string; default: string }>
  /** a set: its variant mains and the values each one has */
  members?: Array<{ name: string; values: string }>
}

/** Header badge text of a selected main, variant or set. */
export const mainBadge = (m: MainInfo): string => (m.kind === 'set' ? 'Component set' : 'Component')

/** Component facts of a node, or null when it is neither a main component nor a component set. */
export function mainInfo(doc: Doc, id: string): MainInfo | null {
  const n = doc.nodes[id]
  if (!n) return null
  if (n.componentSet) {
    const members: NonNullable<MainInfo['members']> = []
    const info: MainInfo = { kind: 'set', name: n.componentSet.name, variants: [], props: [], members }
    for (const d of n.componentSet.props) {
      if (d.type === 'variant') info.variants.push({ prop: d.name, value: String(d.default), options: d.options ?? [] })
      else info.props.push({ name: d.name, type: d.type, default: String(d.default) })
    }
    const names = new Map(n.componentSet.props.map((d) => [d.id, d.name]))
    for (const c of n.children) {
      const m = doc.nodes[c]
      if (!m?.component) continue
      const vals = variantValues(doc, c)
      members.push({ name: m.name, values: Object.entries(vals).map(([k, v]) => `${names.get(k) ?? k}=${v}`).join(', ') })
    }
    return info
  }
  if (!n.component) return null
  const defs = propDefsOf(doc, id)
  const values = variantValues(doc, id)
  const set = n.component.set ? doc.nodes[n.component.set] : undefined
  const info: MainInfo = { kind: set?.componentSet ? 'variant' : 'component', name: n.component.name, variants: [], props: [] }
  if (set?.componentSet) info.setName = set.componentSet.name
  for (const d of defs) {
    if (d.type === 'variant') info.variants.push({ prop: d.name, value: values[d.id] ?? String(d.default), options: d.options ?? [] })
    else info.props.push({ name: d.name, type: d.type, default: String(d.default) })
  }
  return info
}

/** The sections of the Spec panel for a layer; empty sections are left out. `main` adds the main-component facts. */
export function specSections(spec: NodeSpec, main?: MainInfo | null): SpecSection[] {
  const out: SpecSection[] = []
  const box: SpecRow[] = [
    { label: 'Width', value: px(spec.box.width) },
    { label: 'Height', value: px(spec.box.height) }
  ]
  if (spec.box.x !== undefined && spec.box.y !== undefined) {
    box.push({ label: spec.box.relTo === 'artboard' ? 'X, Y in artboard' : 'X, Y in parent', value: `${n(spec.box.x)}, ${n(spec.box.y)}` })
  } else if (spec.flowIndex !== undefined) {
    box.push({ label: 'Position', value: `in flow, item ${spec.flowIndex + 1}` })
  }
  if (spec.rotation) box.push({ label: 'Rotation', value: `${n(spec.rotation)}° (box is the rotated bounds)` })
  if (spec.radius !== undefined) box.push({ label: 'Radius', value: Array.isArray(spec.radius) ? spec.radius.map(px).join(' ') : typeof spec.radius === 'number' ? px(spec.radius) : spec.radius })
  if (spec.opacity !== undefined) box.push({ label: 'Opacity', value: `${n(spec.opacity * 100)}%` })
  out.push({ id: 'box', title: 'Box', rows: box })

  const l = spec.layout
  const layout: SpecRow[] = [
    { label: 'Intent', value: intentLine(spec).replace(/^.*? — /, '') },
    { label: 'Width rule', value: sizeText(spec.sizing.w) },
    { label: 'Height rule', value: sizeText(spec.sizing.h) }
  ]
  if (l.kind === 'flex') {
    layout.push({ label: 'Direction', value: l.direction === 'column' ? 'Column' : 'Row' })
    if (l.gap !== undefined) layout.push({ label: 'Gap', value: px(l.gap) })
    else if (l.rowGap !== undefined || l.columnGap !== undefined) layout.push({ label: 'Gap', value: `row ${px(l.rowGap ?? 0)}, column ${px(l.columnGap ?? 0)}` })
    if (l.align) layout.push({ label: 'Align', value: l.align })
    if (l.justify) layout.push({ label: 'Justify', value: l.justify })
    if (l.wrap) layout.push({ label: 'Wrap', value: 'wraps' })
  } else if (l.kind === 'grid') {
    if (l.columns) layout.push({ label: 'Columns', value: l.columns })
    if (l.rows) layout.push({ label: 'Rows', value: l.rows })
    if (l.gap !== undefined) layout.push({ label: 'Gap', value: px(l.gap) })
  }
  if (l.padding.some((v) => v)) layout.push({ label: 'Padding', value: sides(l.padding) })
  if (l.constraints) layout.push({ label: 'Constraints', value: `${l.constraints.h}, ${l.constraints.v}` })
  if (l.offsets) layout.push({ label: 'Pinned', value: Object.entries(l.offsets).map(([k, v]) => `${k} ${n(v as number)}`).join(', ') })
  if (l.cell) layout.push({ label: 'Grid cell', value: [l.cell.column && `column ${l.cell.column}`, l.cell.row && `row ${l.cell.row}`].filter(Boolean).join(', ') })
  if (l.overflow && l.overflow !== 'visible') layout.push({ label: 'Overflow', value: l.overflow })
  out.push({ id: 'layout', title: 'Layout', rows: layout })

  if (spec.text) {
    const t = spec.text
    const rows: SpecRow[] = []
    if (t.textStyle) rows.push({ label: 'Style', value: t.textStyle })
    if (t.fontFamily) rows.push({ label: 'Font', value: t.fontFamily })
    rows.push({ label: 'Size', value: px(t.fontSize) }, { label: 'Weight', value: String(t.fontWeight) })
    if (t.lineHeightPx !== null) {
      const ratio = t.lineHeightRatio !== null ? ` (${n(t.lineHeightRatio)})` : ''
      rows.push({ label: 'Line height', value: `${px(t.lineHeightPx)}${ratio}`, copy: px(t.lineHeightPx) })
    }
    if (t.letterSpacingPx) rows.push({ label: 'Letter spacing', value: `${n(t.letterSpacingEm)}em · ${px(t.letterSpacingPx)}`, copy: `${n(t.letterSpacingEm)}em` })
    if (t.textAlign) rows.push({ label: 'Align', value: t.textAlign })
    out.push({ id: 'typography', title: 'Typography', rows })
  }

  const fills = paintRows(spec, ['fill', 'text'])
  if (fills.length) out.push({ id: 'fills', title: 'Fill', rows: fills })
  const strokes = paintRows(spec, ['stroke'])
  if (strokes.length) out.push({ id: 'strokes', title: 'Stroke', rows: strokes })
  if (spec.effects.length) out.push({ id: 'effects', title: 'Effects', rows: spec.effects.map(effectRow) })

  if (spec.component) {
    const c = spec.component
    const rows: SpecRow[] = [{ label: 'Component', value: c.name ?? c.ref }]
    for (const [k, v] of Object.entries(c.variant ?? {})) rows.push({ label: k, value: v })
    for (const [k, v] of Object.entries(c.props ?? {})) rows.push({ label: k, value: String(v) })
    if (c.overrides?.length) rows.push({ label: 'Overrides', value: `${c.overrides.length} layer${c.overrides.length === 1 ? '' : 's'}` })
    out.push({ id: 'component', title: 'Component', rows })
  }

  if (main && !spec.component) {
    const kind =
      main.kind === 'set' ? `Component set (${main.members?.length ?? 0} variant${main.members?.length === 1 ? '' : 's'})` : main.setName ? `Component (variant of ${main.setName})` : 'Component'
    const rows: SpecRow[] = [
      { label: 'Component', value: main.name },
      { label: 'Kind', value: kind }
    ]
    for (const v of main.variants) {
      const label = main.kind === 'set' ? `${v.prop} (variant property)` : v.prop
      const value = main.kind === 'set' ? v.options.join(', ') || v.value : v.options.length > 1 ? `${v.value} (of ${v.options.join(', ')})` : v.value
      rows.push({ label, value, copy: v.value })
    }
    for (const p of main.props) rows.push({ label: p.name, value: `${p.default} (${p.type} property)`, copy: p.default })
    for (const m of main.members ?? []) rows.push({ label: 'Variant', value: m.values ? `${m.name} · ${m.values}` : m.name, copy: m.name })
    out.push({ id: 'component', title: 'Component', rows })
  }

  if (spec.tokens.length) {
    out.push({
      id: 'tokens',
      title: 'Tokens used',
      rows: spec.tokens.map((t) => {
        const entries = Object.entries(t.values)
        const first = entries[0]?.[1]
        return {
          label: t.name,
          value: first?.value ?? '',
          copy: `var(${t.name})`,
          swatch: first?.hex8,
          modes: entries.length > 1 ? entries.map(([mode, v]) => ({ mode, value: v.value, swatch: v.hex8 })) : undefined
        }
      })
    })
  }
  return out
}
