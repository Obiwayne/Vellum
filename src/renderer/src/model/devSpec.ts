// Spec model for developer handoff (T60 / H1): one pure function turns a node of the document into a
// `NodeSpec` an agent can build from. Layout is recorded as *intent* (Fixed / Fit / Fill, flex / grid,
// constraints, min / max) next to the *measured* result, with the precision rules of docs/factory/T58-plan.md
// section 10: values are measured, kept to 2 decimals with trailing zeros trimmed, never silently
// rounded to integers.
//
// No React, no DOM: measured rects arrive through the injected `measure` callback (the canvas supplies
// `bridge/measure`). Without one, the spec falls back to model arithmetic and says so (`box.measured`).
// Hidden layers are never emitted and locked state is dropped (plan section 11).
import type { CNode, Doc, Style, Token, WorldRect } from './types'
import { effectiveMode, modesOf, tokenValueIn } from './modes'
import { axisConstraint, canConstrain, isFlowChild, isFlowLayout, isGrid, isFlex, isPageRoot, modelWorldPosition, numericSize, topLevelOf } from './ops'
import type { Constraint } from './ops'
import { cssValue } from './html'
import { formatColor, parseColor } from '../ui/color'

// ---------------------------------------------------------------------------------------------
// types

/** Measured world rect of a node, or null when it is not rendered. */
export type Measure = (id: string) => WorldRect | null

export type SizeRule = (
  | { mode: 'fixed'; value: number }
  | { mode: 'fit' }
  | { mode: 'fill'; weight?: number }
  | { mode: 'percent'; value: number }
) & { min?: number; max?: number; aspect?: number }

export interface LayoutIntent {
  /** the node's own children layout; 'positioned' = children placed by x/y, 'block' = no children flow */
  kind: 'flex' | 'grid' | 'block' | 'positioned'
  // flex
  direction?: 'row' | 'column'
  wrap?: boolean
  gap?: number
  rowGap?: number
  columnGap?: number
  align?: string
  justify?: string
  padding: [number, number, number, number]
  // grid
  columns?: string
  rows?: string
  autoFlow?: string
  /** this node as a grid item */
  cell?: { column?: string; row?: string; align?: string }
  /** this node as a positioned child of a frame */
  constraints?: {
    h: 'left' | 'right' | 'left-right' | 'center' | 'scale'
    v: 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'
  }
  /** px distance to each pinned edge (Left & right pins both); percentages stay in `sizing` */
  offsets?: { left?: number; right?: number; top?: number; bottom?: number }
  /** px from the parent's centre for a Center constraint */
  centerOffset?: { x?: number; y?: number }
  position?: 'absolute' | 'fixed' | 'relative'
  zIndex?: number
  overflow?: 'visible' | 'clip' | 'scroll'
  /** plain-language line the markdown prints */
  summary: string
}

export interface ColorSpec {
  /** as authored after token substitution ("oklch(0.6 0.2 250)", "#2563EB", "rgba(…)") */
  value: string
  /** sRGB, always 8 hex digits (#RRGGBBAA); null when the value cannot be read without a browser */
  hex8: string | null
  /** 0 to 1 */
  opacity: number
  /** kept as authored when the value is oklch()/oklab(); `hex8` is its sRGB fallback */
  oklch?: string
  /** token the authored value pointed at */
  token?: string
}

export interface PaintSpec {
  kind: 'fill' | 'stroke' | 'text'
  type: 'solid' | 'gradient' | 'image'
  color?: ColorSpec
  /** gradient: the CSS function; image: 'data-url' or the url */
  value?: string
  /** stroke: widths top, right, bottom, left */
  width?: number | [number, number, number, number]
  style?: string
}

export interface EffectSpec {
  kind: 'shadow' | 'inner-shadow' | 'blur' | 'backdrop-blur'
  x?: number
  y?: number
  blur: number
  spread?: number
  color?: ColorSpec
}

export interface TextSpec {
  content: string
  fontFamily?: string
  fontSize: number
  fontWeight: number | string
  fontStyle?: string
  /** px; `normal` is resolved from the measured line box */
  lineHeightPx: number | null
  /** unitless ratio of the font size, null when the line height could not be resolved */
  lineHeightRatio: number | null
  lineHeightSource: 'authored' | 'measured' | 'estimated' | 'unknown'
  letterSpacingPx: number
  letterSpacingEm: number
  textAlign?: string
  textTransform?: string
  textDecoration?: string
  /** name of the text style the node follows */
  textStyle?: string
}

export interface TokenValue {
  value: string
  /** sRGB hex8 when the value is a colour */
  hex8?: string
}

export interface TokenUse {
  name: string
  type: 'color' | 'length' | 'number' | 'other'
  /** keyed by mode name; a document without modes has the single key `base` */
  values: Record<string, TokenValue>
}

export interface Box {
  /** parent's padding-box origin; omitted for flow children (their place is the layout, see `flowIndex`) */
  x?: number
  y?: number
  width: number
  height: number
  relTo: 'parent' | 'artboard'
  /** false: no measure was available and the size comes from the authored style */
  measured: boolean
}

export interface NodeSpec {
  id: string
  name: string
  type: CNode['type']
  /** html tag the node came from (attrs.tag), when not a plain div/img/svg */
  tag?: string
  box: Box
  /** top-left in the artboard (always present for non-roots with a measure); redlines read this */
  artboardBox?: { x: number; y: number }
  /** order index among the parent's in-flow children */
  flowIndex?: number
  sizing: { w: SizeRule; h: SizeRule }
  layout: LayoutIntent
  style: { authored: Style; resolved: Record<string, string> }
  /** degrees, when rotated (the box is then the measured bounding rect) */
  rotation?: number
  opacity?: number
  /** px or per-corner px; a string when it is not a px value */
  radius?: number | [number, number, number, number] | string
  text?: TextSpec
  paints: PaintSpec[]
  effects: EffectSpec[]
  tokens: TokenUse[]
  component?: { ref: string; name?: string; variant?: Record<string, string>; props?: Record<string, string | boolean>; overrides?: string[] }
  /** image nodes */
  image?: { alt?: string; objectFit?: string }
  children: NodeSpec[]
}

export interface SpecOptions {
  /** measured world rects (bridge/measure); missing = authored values only */
  measure?: Measure
  /** mode to resolve tokens in; default: the mode in effect at the node */
  mode?: string | null
  /** number of rendered lines of a text node, for `line-height: normal`; default: explicit newlines + 1 */
  lineCount?: (id: string) => number | null
  /** how many levels below the node to emit (default: all) */
  depth?: number
  /** decimals kept (default 2) */
  precision?: number
}

export const BASE_MODE = 'base'
export const REM_BASE = 16

// ---------------------------------------------------------------------------------------------
// precision

/** Round to `precision` decimals; trailing zeros disappear because the result is a number. -0 becomes 0. */
export function round(v: number, precision = 2): number {
  if (!Number.isFinite(v)) return 0
  const f = Math.pow(10, precision)
  const r = Math.round((v + Math.sign(v) * Number.EPSILON) * f) / f
  return r === 0 ? 0 : r
}

/** `347.5`, `12`, never `347.50`. */
export const formatNumber = (v: number, precision = 2): string => String(round(v, precision))

/** px as rem text, base 16 unless given (`1.5rem`). */
export const toRem = (px: number, base = REM_BASE, precision = 4): string => `${formatNumber(px / base, precision)}rem`

/** A measured size is fractional when it has a non-zero decimal part after rounding. */
export const isFractional = (v: number, precision = 2): boolean => !Number.isInteger(round(v, precision))

/** Nodes of a spec tree whose measured size is fractional (build with the rule, not the number). */
export function fractionalNodes(root: NodeSpec): Array<{ id: string; name: string; width: number; height: number }> {
  const out: Array<{ id: string; name: string; width: number; height: number }> = []
  const walk = (s: NodeSpec): void => {
    if (isFractional(s.box.width) || isFractional(s.box.height)) out.push({ id: s.id, name: s.name, width: s.box.width, height: s.box.height })
    s.children.forEach(walk)
  }
  walk(root)
  return out
}

// ---------------------------------------------------------------------------------------------
// value helpers

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g

/** Token names referenced by a value, in order. */
export function varsIn(value: string | number | undefined): string[] {
  if (typeof value !== 'string') return []
  return Array.from(value.matchAll(VAR_RE), (m) => m[1])
}

function tokenByName(doc: Doc, name: string): Token | undefined {
  return doc.tokens.find((t) => t.name === name)
}

/** Replace var(--token) by its value in `mode` (nested tokens too). Unknown tokens use their fallback, else stay. */
export function substituteVars(doc: Doc, value: string, mode: string | null, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value
  return value.replace(VAR_RE, (whole, name: string, fallback: string | undefined) => {
    const t = doc.tokens.find((x) => x.name === name)
    if (!t) return fallback !== undefined ? substituteVars(doc, fallback.trim(), mode, depth + 1) : whole
    return substituteVars(doc, tokenValueIn(doc, t, mode), mode, depth + 1)
  })
}

/** px from 12, '12px', '0', '1rem'; null for anything else (%, auto, calc…). */
export function px(v: string | number | undefined | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*(-?\d*\.?\d+)(px|rem)?\s*$/.exec(v)
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2] === 'rem' ? n * REM_BASE : n
}

/** Split on spaces / commas at paren depth 0. */
function splitTop(s: string, sep: RegExp | string = /\s+/): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  const isSep = (ch: string): boolean => (typeof sep === 'string' ? ch === sep : sep.test(ch))
  for (const ch of s.trim()) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && isSep(ch)) {
      if (cur) parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

const COLOR_START = /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|transparent$)/i

function colorSpec(doc: Doc, authored: string | number | undefined, mode: string | null, precision: number): ColorSpec | undefined {
  if (typeof authored !== 'string' || !authored.trim()) return undefined
  const value = substituteVars(doc, authored.trim(), mode)
  const token = varsIn(authored)[0]
  const out: ColorSpec = { value, hex8: null, opacity: 1 }
  if (COLOR_START.test(value)) {
    const c = parseColor(value)
    if (c) {
      const hex6 = formatColor({ ...c, a: 1 })
      const a255 = Math.round(Math.min(1, Math.max(0, c.a)) * 255)
      out.hex8 = `${hex6}${a255.toString(16).padStart(2, '0').toUpperCase()}`
      out.opacity = round(c.a, Math.max(precision, 3))
    }
    if (/^okl(ch|ab)\(/i.test(value)) out.oklch = value
  }
  if (token) out.token = token
  return out
}

function tokenType(value: string): TokenUse['type'] {
  const v = value.trim()
  if (/^-?\d*\.?\d+$/.test(v)) return 'number'
  if (/^-?\d*\.?\d+(px|rem|em|%|vw|vh)$/i.test(v)) return 'length'
  if (COLOR_START.test(v)) return 'color'
  return 'other'
}

/** One token with its value in every mode of the document (nested tokens resolved). */
export function tokenUse(doc: Doc, name: string, precision = 2): TokenUse | null {
  const t = tokenByName(doc, name)
  if (!t) return null
  const modes = modesOf(doc)
  const keys = modes.length ? modes : [BASE_MODE]
  const values: Record<string, TokenValue> = {}
  for (const k of keys) {
    const mode = modes.length ? k : null
    const value = substituteVars(doc, tokenValueIn(doc, t, mode), mode)
    const tv: TokenValue = { value }
    if (tokenType(value) === 'color') {
      const hex = colorSpec(doc, value, mode, precision)?.hex8
      if (hex) tv.hex8 = hex
    }
    values[k] = tv
  }
  const base = values[keys[0]].value
  return { name, type: tokenType(base), values }
}

// ---------------------------------------------------------------------------------------------
// sizing and layout intent

type Axis = 'w' | 'h'

const cssProp = (axis: Axis): 'width' | 'height' => (axis === 'w' ? 'width' : 'height')

function parentOf(doc: Doc, n: CNode): CNode | undefined {
  return n.parent && !isPageRoot(doc, n.parent) ? doc.nodes[n.parent] : undefined
}

/** Parse an aspect ratio: 1.5, '16 / 9', '16/9'. */
function aspectOf(v: string | number | undefined): number | undefined {
  if (typeof v === 'number') return v > 0 ? v : undefined
  if (typeof v !== 'string') return undefined
  const m = /^\s*(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?\s*$/.exec(v)
  if (!m) return undefined
  const r = parseFloat(m[1]) / (m[2] ? parseFloat(m[2]) : 1)
  return r > 0 && Number.isFinite(r) ? r : undefined
}

/** First number of a flex-grow / `flex` shorthand value. */
function growOf(s: Style): number {
  const g = s.flexGrow
  if (g !== undefined && g !== '') {
    const n = typeof g === 'number' ? g : parseFloat(String(g))
    if (Number.isFinite(n)) return n
  }
  const f = s.flex
  if (f === undefined || f === '') return 0
  if (typeof f === 'number') return f
  const first = String(f).trim().split(/\s+/)[0]
  if (first === 'auto') return 1
  const n = parseFloat(first)
  return Number.isFinite(n) ? n : 0
}

/**
 * Fixed / Fit / Fill / percent for one axis, with min / max / aspect. Encoded like the app does
 * (Inspector Fit = fit-content, Fill = 100% in a flex/grid parent), plus flex-grow on the main axis and
 * the two constraints that stretch a box (Left & right, Scale).
 */
export function sizeRule(doc: Doc, id: string, axis: Axis, resolved?: Style): SizeRule {
  const n = doc.nodes[id]
  const s = resolved ?? n.style
  const key = cssProp(axis)
  const p = parentOf(doc, n)
  const mm = (k: string): number | undefined => {
    const v = px(s[k] as string | number | undefined)
    return v === null ? undefined : round(v)
  }
  const extras: { min?: number; max?: number; aspect?: number } = {}
  const min = mm(axis === 'w' ? 'minWidth' : 'minHeight')
  const max = mm(axis === 'w' ? 'maxWidth' : 'maxHeight')
  const aspect = aspectOf(s.aspectRatio as string | number | undefined)
  if (min !== undefined) extras.min = min
  if (max !== undefined) extras.max = max
  if (aspect !== undefined) extras.aspect = round(aspect, 4)
  const rule = (r: SizeRule): SizeRule => ({ ...r, ...extras })

  // a constraint that stretches the box
  if (canConstrain(doc, id) && n.type !== 'text') {
    const c = axisConstraint(n, axis === 'w' ? 'h' : 'v')
    if (c === 'both') return rule({ mode: 'fill' })
    if (c === 'scale') {
      const pc = /^(-?\d*\.?\d+)%$/.exec(String(s[key] ?? '').trim())
      if (pc) return rule({ mode: 'percent', value: round(parseFloat(pc[1])) })
    }
  }

  const v = s[key]
  const num = px(v as string | number | undefined)
  const flowParent = p && isFlowLayout(p.style) && n.style.position !== 'absolute'
  const mainAxis =
    p && isFlex(p)
      ? ((String(p.style.flexDirection ?? 'row').startsWith('column') ? 'h' : 'w') as Axis)
      : null

  if (flowParent && isFlex(p) && mainAxis === axis) {
    const g = growOf(s)
    if (g > 0) return rule({ mode: 'fill', ...(g !== 1 ? { weight: g } : {}) })
  }
  if (num !== null) return rule({ mode: 'fixed', value: round(num) })
  if (typeof v === 'string') {
    const t = v.trim()
    const pc = /^(-?\d*\.?\d+)%$/.exec(t)
    if (pc) {
      const value = round(parseFloat(pc[1]))
      return value === 100 && flowParent ? rule({ mode: 'fill' }) : rule({ mode: 'percent', value })
    }
  }
  // cross axis of a flex parent: stretch fills, as the browser does
  if (flowParent && isFlex(p) && mainAxis && mainAxis !== axis && (v === undefined || v === 'auto')) {
    const self = String(n.style.alignSelf ?? 'auto')
    const items = String(p!.style.alignItems ?? 'normal')
    const stretch = self === 'stretch' || (self === 'auto' && (items === 'stretch' || items === 'normal'))
    if (stretch && n.type !== 'text') return rule({ mode: 'fill' })
  }
  return rule({ mode: 'fit' })
}

/** padding as [t, r, b, l] px from the shorthand and the side keys. */
function paddingOf(s: Style): [number, number, number, number] {
  let t = 0
  let r = 0
  let b = 0
  let l = 0
  if (s.padding !== undefined) {
    const v = splitTop(String(s.padding)).map((x) => px(x) ?? 0)
    if (v.length === 1) [t, r, b, l] = [v[0], v[0], v[0], v[0]]
    else if (v.length === 2) [t, r, b, l] = [v[0], v[1], v[0], v[1]]
    else if (v.length === 3) [t, r, b, l] = [v[0], v[1], v[2], v[1]]
    else if (v.length >= 4) [t, r, b, l] = [v[0], v[1], v[2], v[3]]
  }
  const side = (k: string, cur: number): number => {
    const v = px(s[k] as string | number | undefined)
    return v === null ? cur : v
  }
  return [side('paddingTop', t), side('paddingRight', r), side('paddingBottom', b), side('paddingLeft', l)].map((v) => round(v)) as [
    number,
    number,
    number,
    number
  ]
}

const H_NAME: Record<Constraint, 'left' | 'right' | 'left-right' | 'center' | 'scale'> = {
  start: 'left',
  end: 'right',
  both: 'left-right',
  center: 'center',
  scale: 'scale'
}
const V_NAME: Record<Constraint, 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'> = {
  start: 'top',
  end: 'bottom',
  both: 'top-bottom',
  center: 'center',
  scale: 'scale'
}

function ruleText(r: SizeRule): string {
  const base = r.mode === 'fixed' ? `${formatNumber(r.value)}` : r.mode === 'percent' ? `${formatNumber(r.value)}%` : r.mode === 'fill' && r.weight ? `fill ×${formatNumber(r.weight)}` : r.mode
  const lim: string[] = []
  if (r.min !== undefined) lim.push(`min ${formatNumber(r.min)}`)
  if (r.max !== undefined) lim.push(`max ${formatNumber(r.max)}`)
  if (r.aspect !== undefined) lim.push(`ratio ${formatNumber(r.aspect, 3)}`)
  return lim.length ? `${base} (${lim.join(', ')})` : base
}

/** `width fill (max 480), height fit`: the sizing half of an intent line. */
export const sizingText = (w: SizeRule, h: SizeRule): string => `width ${ruleText(w)}, height ${ruleText(h)}`

/**
 * The layout intent of a node: how it lays out its children and how it is placed in its parent.
 * Derived from the authored style only (never from measured numbers), so it matches the canvas.
 */
export function layoutIntent(doc: Doc, id: string, resolved?: Style): LayoutIntent {
  const n = doc.nodes[id]
  const s = resolved ?? n.style
  const kind: LayoutIntent['kind'] = isGrid(n) ? 'grid' : isFlex(n) ? 'flex' : n.children.length ? 'positioned' : 'block'
  const out: LayoutIntent = { kind, padding: paddingOf(s), summary: '' }
  const parts: string[] = []

  if (kind === 'flex') {
    const dir = String(s.flexDirection ?? 'row')
    out.direction = dir.startsWith('column') ? 'column' : 'row'
    out.wrap = String(s.flexWrap ?? 'nowrap') !== 'nowrap'
    parts.push(out.direction === 'column' ? 'Column' : 'Row')
  } else if (kind === 'grid') {
    parts.push('Grid')
  } else if (kind === 'positioned') {
    parts.push('Positioned children')
  }

  if (kind === 'flex' || kind === 'grid') {
    const g = splitTop(String(s.gap ?? '')).map((x) => px(x))
    const rowGap = px(s.rowGap as string | number | undefined) ?? (g.length ? g[0] : null)
    const colGap = px(s.columnGap as string | number | undefined) ?? (g.length > 1 ? g[1] : g.length ? g[0] : null)
    if (rowGap !== null && colGap !== null && rowGap === colGap) {
      out.gap = round(rowGap)
      parts.push(`gap ${formatNumber(rowGap)}`)
    } else {
      if (rowGap !== null) out.rowGap = round(rowGap)
      if (colGap !== null) out.columnGap = round(colGap)
      if (rowGap !== null || colGap !== null) parts.push(`gap ${rowGap === null ? '' : `row ${formatNumber(rowGap)}`}${rowGap !== null && colGap !== null ? ', ' : ''}${colGap === null ? '' : `column ${formatNumber(colGap)}`}`)
    }
    if (s.alignItems !== undefined) out.align = String(s.alignItems)
    if (s.justifyContent !== undefined) out.justify = String(s.justifyContent)
    if (out.wrap) parts.push('wraps')
    if (kind === 'grid') {
      if (s.gridTemplateColumns !== undefined) out.columns = String(s.gridTemplateColumns)
      if (s.gridTemplateRows !== undefined) out.rows = String(s.gridTemplateRows)
      if (s.gridAutoFlow !== undefined) out.autoFlow = String(s.gridAutoFlow)
      if (out.columns) parts.push(`columns ${out.columns}`)
    }
  }
  const pad = out.padding
  if (pad.some((v) => v !== 0)) {
    parts.push(pad.every((v) => v === pad[0]) ? `padding ${formatNumber(pad[0])}` : `padding ${pad.map((v) => formatNumber(v)).join(' ')}`)
  }

  // grid item
  const p = parentOf(doc, n)
  if (p && isGrid(p) && n.style.position !== 'absolute') {
    const cell: NonNullable<LayoutIntent['cell']> = {}
    if (s.gridColumn !== undefined) cell.column = String(s.gridColumn)
    if (s.gridRow !== undefined) cell.row = String(s.gridRow)
    if (s.justifySelf !== undefined) cell.align = String(s.justifySelf)
    if (Object.keys(cell).length) {
      out.cell = cell
      if (cell.column) parts.push(`column ${cell.column}`)
      if (cell.row) parts.push(`row ${cell.row}`)
    }
  }

  // positioned child: constraints and pinned distances
  if (canConstrain(doc, id)) {
    const ch = axisConstraint(n, 'h')
    const cv = axisConstraint(n, 'v')
    out.constraints = { h: H_NAME[ch], v: V_NAME[cv] }
    const offsets: NonNullable<LayoutIntent['offsets']> = {}
    const center: NonNullable<LayoutIntent['centerOffset']> = {}
    const num = (k: string): number | undefined => {
      const v = px(s[k] as string | number | undefined)
      return v === null ? undefined : round(v)
    }
    const calcOffset = (k: string): number | undefined => {
      const m = /^calc\(\s*50%\s*([+-])\s*(\d*\.?\d+)px\s*\)$/.exec(String(s[k] ?? ''))
      return m ? round((m[1] === '-' ? -1 : 1) * parseFloat(m[2])) : s[k] === '50%' ? 0 : undefined
    }
    if (ch === 'start' || ch === 'both') offsets.left = round(n.x)
    if (ch === 'end' || ch === 'both') offsets.right = num('right')
    if (cv === 'start' || cv === 'both') offsets.top = round(n.y)
    if (cv === 'end' || cv === 'both') offsets.bottom = num('bottom')
    if (ch === 'center') center.x = calcOffset('left')
    if (cv === 'center') center.y = calcOffset('top')
    for (const k of Object.keys(offsets) as Array<keyof typeof offsets>) if (offsets[k] === undefined) delete offsets[k]
    for (const k of Object.keys(center) as Array<keyof typeof center>) if (center[k] === undefined) delete center[k]
    if (Object.keys(offsets).length) out.offsets = offsets
    if (Object.keys(center).length) out.centerOffset = center
    const pins: string[] = []
    const edge = (name: string, v: number | undefined): void => {
      if (v !== undefined) pins.push(`${name} ${formatNumber(v)}`)
    }
    if (ch === 'both') {
      edge('left', offsets.left)
      edge('right', offsets.right)
    } else if (ch === 'start') edge('left', offsets.left)
    else if (ch === 'end') edge('right', offsets.right)
    else if (ch === 'center') pins.push('centred horizontally')
    else pins.push('scales horizontally')
    if (cv === 'both') {
      edge('top', offsets.top)
      edge('bottom', offsets.bottom)
    } else if (cv === 'start') edge('top', offsets.top)
    else if (cv === 'end') edge('bottom', offsets.bottom)
    else if (cv === 'center') pins.push('centred vertically')
    else pins.push('scales vertically')
    parts.push(`pinned ${pins.join(', ')}`)
  }

  const pos = s.position
  if (pos === 'absolute' || pos === 'fixed' || pos === 'relative') out.position = pos
  const z = s.zIndex
  if (z !== undefined && z !== '' && Number.isFinite(Number(z))) out.zIndex = Number(z)
  const ov = String(s.overflow ?? 'visible')
  out.overflow = ov === 'hidden' || ov === 'clip' ? 'clip' : ov === 'auto' || ov === 'scroll' ? 'scroll' : 'visible'
  if (out.overflow !== 'visible') parts.push(out.overflow === 'clip' ? 'clips content' : 'scrolls')

  out.summary = parts.length ? parts.join(', ') : 'Block'
  return out
}

/** One line of intent first, numbers second: `Card — Column, gap 12, padding 16, width fill (max 480), height fit`. */
export const intentLine = (spec: NodeSpec): string =>
  `${spec.name} — ${spec.layout.summary}, ${sizingText(spec.sizing.w, spec.sizing.h)}`

// ---------------------------------------------------------------------------------------------
// paints, effects, text

const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'none', 'hidden'])

function strokeOf(doc: Doc, s: Style, mode: string | null, precision: number): PaintSpec | null {
  const widths: Array<number | null> = [null, null, null, null]
  let style: string | undefined
  let colorValue: string | number | undefined
  const sides = ['Top', 'Right', 'Bottom', 'Left']
  const apply = (shorthand: unknown, which: number[]): void => {
    if (typeof shorthand !== 'string' && typeof shorthand !== 'number') return
    for (const tok of splitTop(String(shorthand))) {
      const w = px(tok)
      if (w !== null) which.forEach((i) => (widths[i] = w))
      else if (BORDER_STYLES.has(tok)) style = tok
      else colorValue = tok
    }
  }
  apply(s.border, [0, 1, 2, 3])
  sides.forEach((side, i) => apply(s[`border${side}`], [i]))
  if (s.borderWidth !== undefined) {
    const v = splitTop(String(s.borderWidth)).map((x) => px(x))
    const [t, r = t, b = t, l = r] = v
    widths[0] = t ?? widths[0]
    widths[1] = r ?? widths[1]
    widths[2] = b ?? widths[2]
    widths[3] = l ?? widths[3]
  }
  sides.forEach((side, i) => {
    const w = px(s[`border${side}Width`] as string | number | undefined)
    if (w !== null) widths[i] = w
  })
  if (typeof s.borderStyle === 'string') style = s.borderStyle
  if (s.borderColor !== undefined) colorValue = s.borderColor as string | number
  if (style === 'none' || style === 'hidden') return null
  const w = widths.map((x) => round(x ?? 0)) as [number, number, number, number]
  if (w.every((x) => x === 0)) return null
  const out: PaintSpec = { kind: 'stroke', type: 'solid', width: w.every((x) => x === w[0]) ? w[0] : w, style: style ?? 'solid' }
  const c = colorSpec(doc, colorValue ?? 'currentColor', mode, precision)
  if (c) out.color = c
  return out
}

function parseShadows(doc: Doc, value: string, mode: string | null, precision: number): EffectSpec[] {
  const out: EffectSpec[] = []
  if (!value || value === 'none') return out
  for (const layer of splitTop(value, ',')) {
    const toks = splitTop(layer)
    let inset = false
    const nums: number[] = []
    let color: string | undefined
    for (const t of toks) {
      if (t === 'inset') inset = true
      else if (px(t) !== null) nums.push(px(t) as number)
      else color = t
    }
    if (nums.length < 2) continue
    const e: EffectSpec = { kind: inset ? 'inner-shadow' : 'shadow', x: round(nums[0], precision), y: round(nums[1], precision), blur: round(nums[2] ?? 0, precision), spread: round(nums[3] ?? 0, precision) }
    const c = colorSpec(doc, color ?? '#000000', mode, precision)
    if (c) e.color = c
    out.push(e)
  }
  return out
}

const blurOf = (v: unknown): number | null => {
  const m = /blur\(\s*(-?\d*\.?\d+)(px)?\s*\)/.exec(String(v ?? ''))
  return m ? parseFloat(m[1]) : null
}

/** Typography inherits down the tree: the nearest ancestor (or self) that sets it. */
function inheritedStyle(doc: Doc, id: string, key: string): string | number | undefined {
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n: CNode | undefined = doc.nodes[cur]
    if (!n) break
    const v = n.style[key]
    if (v !== undefined && v !== '' && v !== 'inherit') return v
    cur = n.parent
  }
  return undefined
}

/** Own vertical padding and border of a layer (px), which a measured box includes but its text lines do not. */
function verticalInsets(doc: Doc, n: CNode): number {
  const pad = layoutIntent(doc, n.id).padding
  const border = (side: string): number => {
    const style = n.style[`border${side}Style`] ?? n.style.borderStyle
    if (style === 'none' || style === 'hidden') return 0
    for (const key of [`border${side}Width`, 'borderWidth']) {
      const w = numericSize(n.style[key] as string | number | undefined)
      if (w !== null) return w
    }
    // shorthands: `1px solid #E2E8F0`
    for (const key of [`border${side}`, 'border']) {
      const v = n.style[key]
      if (typeof v !== 'string' || /^\s*(none|hidden|0)/.test(v)) continue
      const m = /(?:^|\s)(\d*\.?\d+)px(?:\s|$)/.exec(v)
      if (m) return parseFloat(m[1])
    }
    return 0
  }
  return (pad[0] || 0) + (pad[2] || 0) + border('Top') + border('Bottom')
}

function textSpecOf(doc: Doc, n: CNode, mode: string | null, rect: WorldRect | null, opts: SpecOptions, precision: number): TextSpec {
  const get = (k: string): string | number | undefined => {
    const v = inheritedStyle(doc, n.id, k)
    return typeof v === 'string' ? substituteVars(doc, v, mode) : v
  }
  const size = px(get('fontSize')) ?? 16
  const content = n.text ?? ''
  const weightRaw = get('fontWeight')
  const weightNum = Number(weightRaw)
  const fontWeight: number | string = weightRaw === undefined ? 400 : Number.isFinite(weightNum) ? weightNum : weightRaw === 'bold' ? 700 : weightRaw === 'normal' ? 400 : String(weightRaw)

  // line height: px, unitless ratio, %, or `normal` resolved from the measured line box
  const lh = get('lineHeight')
  let lineHeightPx: number | null = null
  let lineHeightSource: TextSpec['lineHeightSource'] = 'unknown'
  if (typeof lh === 'number' || (typeof lh === 'string' && /^\d*\.?\d+$/.test(lh.trim()))) {
    lineHeightPx = Number(lh) * size
    lineHeightSource = 'authored'
  } else if (typeof lh === 'string' && /^\d*\.?\d+%$/.test(lh.trim())) {
    lineHeightPx = (parseFloat(lh) / 100) * size
    lineHeightSource = 'authored'
  } else if (typeof lh === 'string' && /^-?\d*\.?\d+(px|rem)$/.test(lh.trim())) {
    lineHeightPx = px(lh)
    lineHeightSource = 'authored'
  } else if (rect && rect.height > 0 && n.visible) {
    const counted = opts.lineCount?.(n.id)
    const lines = counted && counted > 0 ? counted : content.split('\n').length
    // the measured box includes the layer's own vertical padding and border: the line box is what is left
    lineHeightPx = Math.max(0, rect.height - verticalInsets(doc, n)) / lines
    lineHeightSource = counted ? 'measured' : 'estimated'
  }

  const ls = get('letterSpacing')
  let lsPx = 0
  if (typeof ls === 'string' && /^-?\d*\.?\d+em$/.test(ls.trim())) lsPx = parseFloat(ls) * size
  else if (ls !== undefined && ls !== 'normal') lsPx = px(ls) ?? 0

  const spec: TextSpec = {
    content,
    fontSize: round(size, precision),
    fontWeight,
    lineHeightPx: lineHeightPx === null ? null : round(lineHeightPx, precision),
    lineHeightRatio: lineHeightPx === null || size === 0 ? null : round(lineHeightPx / size, 4),
    lineHeightSource,
    letterSpacingPx: round(lsPx, precision),
    letterSpacingEm: size === 0 ? 0 : round(lsPx / size, 4)
  }
  const fam = get('fontFamily')
  if (fam !== undefined) spec.fontFamily = String(fam)
  const st = get('fontStyle')
  if (st !== undefined && st !== 'normal') spec.fontStyle = String(st)
  const ta = get('textAlign')
  if (ta !== undefined) spec.textAlign = String(ta)
  const tt = get('textTransform')
  if (tt !== undefined && tt !== 'none') spec.textTransform = String(tt)
  const td = get('textDecorationLine') ?? get('textDecoration')
  if (td !== undefined && td !== 'none') spec.textDecoration = String(td)
  if (n.textStyle) {
    const ts = doc.textStyles?.find((x) => x.id === n.textStyle)
    if (ts) spec.textStyle = ts.name
  }
  return spec
}

// ---------------------------------------------------------------------------------------------
// the spec

const parseDeg = (v: unknown): number => {
  const m = /(-?\d*\.?\d+)deg/.exec(String(v ?? ''))
  return m ? parseFloat(m[1]) : 0
}

function radiusOf(s: Style): NodeSpec['radius'] | undefined {
  const raw = s.borderRadius
  if (raw === undefined || raw === '') return undefined
  const toks = splitTop(String(raw))
  const nums = toks.map((t) => px(t))
  if (nums.some((v) => v === null)) return String(raw)
  const v = (nums as number[]).map((x) => round(x))
  if (v.length === 1) return v[0] === 0 ? undefined : v[0]
  const [a, b = a, c = a, d = b] = v
  return a === b && b === c && c === d ? (a === 0 ? undefined : a) : [a, b, c, d]
}

const DATA_URL_RE = /url\(\s*(?:(['"])data:[\s\S]*?\1|data:[^)]*)\s*\)/gi

/** Image bytes are exported as assets, never inlined in the spec: `url(data:...)` becomes `url(data-url)`. */
const stripDataUrls = (v: string): string => (v.length > 5 && /data:/i.test(v) ? v.replace(DATA_URL_RE, 'url(data-url)') : v)

function authoredStyle(style: Style): Style {
  const out: Style = {}
  for (const [k, v] of Object.entries(style)) out[k] = typeof v === 'string' ? stripDataUrls(v) : v
  return out
}

/** Resolved style: every key as CSS text, tokens substituted for the mode. */
function resolveStyle(doc: Doc, style: Style, mode: string | null, precision: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === null || v === '') continue
    const text = typeof v === 'number' ? cssValue(k, round(v, precision)) : cssValue(k, v)
    out[k] = typeof v === 'string' ? stripDataUrls(substituteVars(doc, text, mode)) : text
  }
  return out
}

function borderWidths(n: CNode | undefined): { l: number; t: number } {
  if (!n) return { l: 0, t: 0 }
  const w = (k: string): number => numericSize((n.style[k] ?? n.style.borderWidth) as string | number | undefined) ?? 0
  return { l: w('borderLeftWidth'), t: w('borderTopWidth') }
}

/**
 * NodeSpec of a node and its visible descendants, or null when the node is hidden or missing.
 * Never reads another page, a hidden layer, a comment or any profile data.
 */
export function nodeSpec(doc: Doc, id: string, opts: SpecOptions = {}): NodeSpec | null {
  return build(doc, id, opts, opts.depth ?? Infinity, 0)
}

function build(doc: Doc, id: string, opts: SpecOptions, depth: number, index: number): NodeSpec | null {
  const n = doc.nodes[id]
  if (!n || !n.visible) return null
  const precision = opts.precision ?? 2
  const mode = opts.mode !== undefined ? opts.mode : effectiveMode(doc, id)
  const resolved = resolveStyle(doc, n.style, mode, precision)
  const rect = opts.measure?.(id) ?? null
  const root = !n.parent || isPageRoot(doc, n.parent)
  const flow = isFlowChild(doc, id)

  // ---- box
  const wNum = numericSize(n.style.width as string | number | undefined)
  const hNum = numericSize(n.style.height as string | number | undefined)
  const box: Box = {
    width: round(rect ? rect.width : wNum ?? 0, precision),
    height: round(rect ? rect.height : hNum ?? 0, precision),
    relTo: root ? 'artboard' : 'parent',
    measured: Boolean(rect)
  }
  let artboardBox: NodeSpec['artboardBox']
  if (root) {
    box.x = 0
    box.y = 0
  } else {
    const parentRect = n.parent ? opts.measure?.(n.parent) ?? null : null
    const top = topLevelOf(doc, id)
    const abRect = top ? opts.measure?.(top) ?? null : null
    // flow children carry an order index only: an offset they do not own would be copied as stale CSS
    if (flow) artboardBox = undefined
    else if (rect && abRect) artboardBox = { x: round(rect.x - abRect.x, precision), y: round(rect.y - abRect.y, precision) }
    else if (!rect) {
      const wp = modelWorldPosition(doc, id)
      const tp = top ? modelWorldPosition(doc, top) ?? { x: 0, y: 0 } : null
      if (wp && tp) artboardBox = { x: round(wp.x - tp.x, precision), y: round(wp.y - tp.y, precision) }
    }
    if (!flow) {
      const pb = borderWidths(n.parent ? doc.nodes[n.parent] : undefined)
      if (rect && parentRect) {
        box.x = round(rect.x - parentRect.x - pb.l, precision)
        box.y = round(rect.y - parentRect.y - pb.t, precision)
      } else {
        box.x = round(n.x, precision)
        box.y = round(n.y, precision)
      }
    }
  }

  const spec: NodeSpec = {
    id,
    name: n.name,
    type: n.type,
    box,
    sizing: { w: sizeRule(doc, id, 'w', resolved), h: sizeRule(doc, id, 'h', resolved) },
    layout: layoutIntent(doc, id, resolved),
    style: { authored: authoredStyle(n.style), resolved },
    paints: [],
    effects: [],
    tokens: [],
    children: []
  }
  if (artboardBox) spec.artboardBox = artboardBox
  if (flow) spec.flowIndex = index
  if (n.attrs?.tag) spec.tag = n.attrs.tag

  const rotation = parseDeg(n.style.rotate)
  if (rotation) spec.rotation = round(rotation, precision)
  const op = n.style.opacity
  if (op !== undefined && op !== '' && Number.isFinite(Number(op)) && Number(op) !== 1) spec.opacity = round(Number(op), 3)
  const radius = radiusOf(resolved)
  if (radius !== undefined) spec.radius = radius

  // ---- paints
  const bg = n.style.backgroundColor ?? n.style.background
  const bgImage = n.style.backgroundImage ?? (typeof n.style.background === 'string' && /gradient\(|url\(/.test(n.style.background) ? n.style.background : undefined)
  if (typeof bgImage === 'string' && /gradient\(/i.test(bgImage)) {
    spec.paints.push({ kind: 'fill', type: 'gradient', value: substituteVars(doc, bgImage, mode) })
  } else if (typeof bgImage === 'string' && /url\(/i.test(bgImage)) {
    spec.paints.push({ kind: 'fill', type: 'image', value: /url\(\s*['"]?data:/i.test(bgImage) ? 'data-url' : bgImage })
  } else if (bg !== undefined && bg !== 'transparent' && bg !== 'none') {
    const c = colorSpec(doc, bg, mode, precision)
    if (c && !(c.hex8 !== null && c.opacity === 0)) spec.paints.push({ kind: 'fill', type: 'solid', color: c })
  }
  if (n.type === 'text') {
    const c = colorSpec(doc, inheritedStyle(doc, id, 'color'), mode, precision)
    if (c) spec.paints.push({ kind: 'text', type: 'solid', color: c })
  }
  const stroke = strokeOf(doc, resolved, mode, precision)
  if (stroke) spec.paints.push(stroke)

  // ---- effects
  if (typeof n.style.boxShadow === 'string') spec.effects.push(...parseShadows(doc, substituteVars(doc, n.style.boxShadow, mode), mode, precision))
  const blur = blurOf(resolved.filter)
  if (blur !== null) spec.effects.push({ kind: 'blur', blur: round(blur, precision) })
  const bblur = blurOf(resolved.backdropFilter)
  if (bblur !== null) spec.effects.push({ kind: 'backdrop-blur', blur: round(bblur, precision) })

  // ---- text, image
  if (n.type === 'text') spec.text = textSpecOf(doc, n, mode, rect, opts, precision)
  if (n.type === 'image') {
    const img: NonNullable<NodeSpec['image']> = {}
    if (n.attrs?.alt !== undefined) img.alt = n.attrs.alt
    if (resolved.objectFit) img.objectFit = resolved.objectFit
    spec.image = img
  }

  // ---- tokens used by this node (authored values, plus the text style's)
  const names = new Set<string>()
  for (const v of Object.values(n.style)) for (const t of varsIn(v as string | number)) names.add(t)
  for (const t of varsIn(n.attrs?.fill)) names.add(t)
  for (const name of names) {
    const u = tokenUse(doc, name, precision)
    if (u) spec.tokens.push(u)
  }

  // ---- component reference
  if (n.instance) {
    const main = doc.nodes[n.instance.of]
    const comp: NonNullable<NodeSpec['component']> = { ref: n.instance.of }
    if (main?.component?.name) comp.name = main.component.name
    else if (main?.name) comp.name = main.name
    if (main?.component?.variant) comp.variant = { ...main.component.variant }
    if (n.instance.props && Object.keys(n.instance.props).length) comp.props = { ...n.instance.props }
    if (n.instance.overrides && Object.keys(n.instance.overrides).length) {
      // override keys are main-side ids ('' = the instance itself): report the ids that exist in this spec's tree
      const twins = new Map<string, string>()
      const walk = (cid: string): void => {
        for (const k of doc.nodes[cid]?.children ?? []) {
          const c = doc.nodes[k]
          if (c?.srcId !== undefined && !twins.has(c.srcId)) twins.set(c.srcId, k)
          walk(k)
        }
      }
      walk(id)
      const ids = Object.keys(n.instance.overrides).map((key) => (key === '' ? id : twins.get(key))).filter((v): v is string => v !== undefined)
      if (ids.length) comp.overrides = ids
    }
    spec.component = comp
  }

  // ---- children: hidden layers are never emitted
  if (depth > 0) {
    let flowIdx = 0
    for (const cid of n.children) {
      const child = doc.nodes[cid]
      if (!child || !child.visible) {
        // a hidden flow child still occupies no slot, so it does not advance the order index
        continue
      }
      const isFlow = isFlowChild(doc, cid)
      const c = build(doc, cid, opts, depth - 1, isFlow ? flowIdx : 0)
      if (c) {
        spec.children.push(c)
        if (isFlow) flowIdx++
      }
    }
  }
  return spec
}
