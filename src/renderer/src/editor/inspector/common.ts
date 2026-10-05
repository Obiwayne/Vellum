// Shared inspector helpers: selection hooks, mixed values, CSS value parsers.
import { useCallback } from 'react'
import { useStore, type MutateOptions } from '../../model/store'
import type { CNode, Doc, Style, StylePatch } from '../../model/types'
import { toast } from '../canvas/toast'
import { anchoredAxes, isFlowChild, isFlowLayout, isPageRoot, numericSize, worldRect } from '../../model/ops'

export const MIXED = Symbol('mixed')
export type Mixed<T> = T | typeof MIXED

/** Common value across nodes, or MIXED. */
export function common<N, T>(nodes: N[], get: (n: N) => T): Mixed<T> {
  if (!nodes.length) return MIXED
  const first = get(nodes[0])
  const key = JSON.stringify(first)
  for (let i = 1; i < nodes.length; i++) if (JSON.stringify(get(nodes[i])) !== key) return MIXED
  return first
}
export const isMixed = <T>(v: Mixed<T>): v is typeof MIXED => v === MIXED
/** Field value for a possibly-mixed value (null shows the "Mixed" placeholder). */
export const fv = <T extends string | number>(v: Mixed<T | undefined>): T | null => (v === MIXED ? null : v ?? null)

export interface Ctx {
  docId: string
  doc: Doc
  ids: string[]
  nodes: CNode[]
  /** apply one patch to every selected node */
  set: (patch: StylePatch, opts?: MutateOptions) => void
  /** per-node style edit as one undo step */
  each: (label: string, fn: (n: CNode, doc: Doc) => void, opts?: MutateOptions) => void
}

export function useCtx(docId: string, doc: Doc, ids: string[]): Ctx {
  const updateStyles = useStore((s) => s.updateStyles)
  const mutate = useStore((s) => s.mutate)
  const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is CNode => Boolean(n))
  const set = useCallback(
    (patch: StylePatch, opts?: MutateOptions) => {
      const msg = updateStyles(docId, ids, patch, opts)
      if (msg) toast(msg) // a manual typography edit unlinked a node from its text style
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, ids.join(','), updateStyles]
  )
  const each = useCallback(
    (label: string, fn: (n: CNode, d: Doc) => void, opts?: MutateOptions) =>
      mutate(
        docId,
        label,
        (d) => {
          for (const id of ids) {
            const n = d.nodes[id]
            if (n) fn(n, d)
          }
        },
        opts
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, ids.join(','), mutate]
  )
  return { docId, doc, ids, nodes, set, each }
}

/** Coalesce key helper: one undo step per control + selection while dragging/scrubbing. */
export const co = (ctx: Ctx, what: string): MutateOptions => ({ coalesce: `insp:${what}:${ctx.ids.join(',')}` })

export const parentOf = (doc: Doc, n: CNode): CNode | undefined =>
  n.parent && !isPageRoot(doc, n.parent) ? doc.nodes[n.parent] : undefined

export const inFlexParent = (doc: Doc, n: CNode): boolean => {
  const p = parentOf(doc, n)
  return Boolean(p && isFlowLayout(p.style))
}

/** Position shown in X/Y: model x/y for positioned nodes, measured offset in parent for flow children. */
export function displayPos(doc: Doc, n: CNode): { x: number; y: number } {
  const anchored = anchoredAxes(n)
  if (!isFlowChild(doc, n.id) && !anchored.x && !anchored.y) return { x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100 }
  const r = worldRect(doc, n.id)
  const p = n.parent ? worldRect(doc, n.parent) : null
  if (!r || !p) return { x: 0, y: 0 }
  return { x: Math.round(r.x - p.x), y: Math.round(r.y - p.y) }
}

export type SizeMode = 'fixed' | 'fit' | 'fill'
export function sizeMode(v: string | number | undefined): SizeMode {
  if (v === 'fit-content' || v === 'auto' || v === 'max-content' || v === undefined) return 'fit'
  if (v === '100%') return 'fill'
  return 'fixed'
}
/** Measured size (world px) for W/H display. */
export function measuredSize(doc: Doc, n: CNode, axis: 'width' | 'height'): number {
  const v = numericSize(n.style[axis])
  if (v !== null) return v
  const r = worldRect(doc, n.id)
  return r ? Math.round(r[axis] * 100) / 100 : 0
}

// ---------------------------------------------------------------------------------------------
// CSS parsing helpers

/** Split on a separator at paren depth 0 (outside quotes). */
export function splitTop(s: string, sep = ','): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** '16px' | 16 | '1.5em' → number px (em relative to 16). */
export function px(v: string | number | undefined | null, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'number') return v
  const m = /^(-?\d*\.?\d+)(px|em|rem)?$/.exec(v.trim())
  if (!m) return fallback
  const n = parseFloat(m[1])
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : n
}

/** padding (shorthand or longhands) → [top, right, bottom, left] */
export function readBox(style: Style, prop: 'padding' | 'borderRadius'): [number, number, number, number] {
  const sh = style[prop]
  let v: [number, number, number, number] = [0, 0, 0, 0]
  if (sh !== undefined) {
    const parts = typeof sh === 'number' ? [sh] : splitTop(String(sh).split('/')[0], ' ').map((p) => px(p))
    const [a, b = a, c = a, d = b] = parts
    v = [a ?? 0, b, c, d]
  }
  const long =
    prop === 'padding'
      ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
      : ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
  long.forEach((k, i) => {
    if (style[k] !== undefined) v[i] = px(style[k])
  })
  return v
}
export function writeBox(prop: 'padding' | 'borderRadius', v: number[]): StylePatch {
  const long =
    prop === 'padding'
      ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
      : ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
  const patch: StylePatch = {}
  for (const k of long) patch[k] = null
  const [t, r, b, l] = v
  let value: string | number
  if (t === r && r === b && b === l) value = prop === 'borderRadius' ? t : `${t}px`
  else if (t === b && r === l) value = `${t}px ${r}px`
  else value = `${t}px ${r}px ${b}px ${l}px`
  patch[prop] = prop === 'borderRadius' && value === 0 ? null : value
  return patch
}

/** Shadow list (box-shadow / text-shadow). */
export interface Shadow {
  inset: boolean
  x: number
  y: number
  blur: number
  spread: number
  color: string
}
export function parseShadows(v: string | number | undefined): Shadow[] {
  if (!v || v === 'none') return []
  return splitTop(String(v)).map((s) => {
    const parts = splitTop(s, ' ')
    const sh: Shadow = { inset: false, x: 0, y: 0, blur: 0, spread: 0, color: '#000000' }
    const nums: number[] = []
    for (const p of parts) {
      if (p === 'inset') sh.inset = true
      else if (/^-?\d*\.?\d+(px)?$/.test(p)) nums.push(parseFloat(p))
      else sh.color = p
    }
    ;[sh.x = 0, sh.y = 0, sh.blur = 0, sh.spread = 0] = nums
    return sh
  })
}
export function formatShadows(list: Shadow[], text = false): string | null {
  if (!list.length) return null
  return list
    .map((s) =>
      text
        ? `${s.x}px ${s.y}px ${s.blur}px ${s.color}`
        : `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`
    )
    .join(', ')
}

/** filter: 'blur(4px) brightness(1.2)' → [{fn, value}] */
export interface FilterFn {
  fn: string
  value: number
}
export const FILTER_DEFS: Record<string, { label: string; unit: string; def: number; min: number; max: number; scale: number }> = {
  blur: { label: 'Blur', unit: 'px', def: 4, min: 0, max: 200, scale: 1 },
  brightness: { label: 'Brightness', unit: '%', def: 100, min: 0, max: 500, scale: 100 },
  contrast: { label: 'Contrast', unit: '%', def: 100, min: 0, max: 500, scale: 100 },
  saturate: { label: 'Saturate', unit: '%', def: 100, min: 0, max: 500, scale: 100 },
  grayscale: { label: 'Grayscale', unit: '%', def: 100, min: 0, max: 100, scale: 100 },
  'hue-rotate': { label: 'Hue rotate', unit: '°', def: 90, min: -360, max: 360, scale: 1 },
  invert: { label: 'Invert', unit: '%', def: 100, min: 0, max: 100, scale: 100 },
  sepia: { label: 'Sepia', unit: '%', def: 100, min: 0, max: 100, scale: 100 }
}
export function parseFilters(v: string | number | undefined): FilterFn[] {
  if (!v || v === 'none') return []
  const out: FilterFn[] = []
  const re = /([a-z-]+)\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(v)))) {
    const def = FILTER_DEFS[m[1]]
    const raw = m[2].trim()
    let n = parseFloat(raw)
    if (!Number.isFinite(n)) n = def?.def ?? 0
    // store in display units: % filters as percent
    if (def && def.unit === '%' && !raw.endsWith('%')) n = n * 100
    out.push({ fn: m[1], value: n })
  }
  return out
}
export function formatFilters(list: FilterFn[]): string | null {
  if (!list.length) return null
  return list
    .map((f) => {
      const def = FILTER_DEFS[f.fn]
      const unit = def?.unit === '°' ? 'deg' : def?.unit ?? ''
      return `${f.fn}(${f.value}${unit})`
    })
    .join(' ')
}

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
export const round2 = (v: number): number => Math.round(v * 100) / 100
