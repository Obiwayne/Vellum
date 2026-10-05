// Styles panel helpers: grouping by slash, preview style, and which colour of a layer becomes a colour style.
import { parseColor } from '../../ui'
import type { CNode, Style, TextStyle, Token } from '../../model/types'
import { groupOf, normalizeName } from './tokenUtils'

export interface StyleGroup<T> {
  /** text before the first slash/hyphen group separator, '' for ungrouped */
  group: string
  items: { item: T; label: string }[]
}

/** "Heading/H1" -> group "Heading", label "H1". Ungrouped styles come first. */
export function groupTextStyles(styles: TextStyle[]): StyleGroup<TextStyle>[] {
  const out = new Map<string, StyleGroup<TextStyle>>()
  for (const s of styles) {
    const i = s.name.indexOf('/')
    const group = i > 0 ? s.name.slice(0, i) : ''
    const label = i > 0 ? s.name.slice(i + 1) : s.name
    const g = out.get(group) ?? { group, items: [] }
    g.items.push({ item: s, label })
    out.set(group, g)
  }
  return [...out.values()].sort((a, b) => (a.group === '' ? -1 : b.group === '' ? 1 : a.group.localeCompare(b.group)))
}

/** Colour tokens ("--color-brand-primary") grouped by the first word after "color-". */
export function groupColourStyles(tokens: Token[]): StyleGroup<Token>[] {
  const out = new Map<string, StyleGroup<Token>>()
  for (const t of tokens) {
    if (groupOf(t.name) !== 'color') continue
    const rest = t.name.replace(/^--color-/, '')
    const i = rest.indexOf('-')
    const group = i > 0 ? rest.slice(0, i) : ''
    const g = out.get(group) ?? { group, items: [] }
    g.items.push({ item: t, label: i > 0 ? rest.slice(i + 1) : rest })
    out.set(group, g)
  }
  return [...out.values()].sort((a, b) => (a.group === '' ? -1 : b.group === '' ? 1 : a.group.localeCompare(b.group)))
}

/** The style for a live preview: its keys, with a big font size capped so a row stays one line. */
export function previewStyle(style: Style, maxSize = 22): Style {
  const out: Style = { ...style }
  const size = typeof style.fontSize === 'number' ? style.fontSize : parseFloat(String(style.fontSize ?? ''))
  if (Number.isFinite(size) && size > maxSize && !String(style.fontSize).includes('var(')) out.fontSize = maxSize
  out.lineHeight = 1.2
  return out
}

/** Short caption for a row: "32 · Bold". */
export function styleCaption(style: Style): string {
  const parts: string[] = []
  if (style.fontSize !== undefined) parts.push(String(style.fontSize).replace(/px$/, ''))
  const w = style.fontWeight
  if (w !== undefined) parts.push(w === 700 || w === '700' || w === 'bold' ? 'Bold' : w === 400 || w === '400' ? 'Regular' : String(w))
  return parts.join(' · ')
}

/**
 * The colour of the first selected layer that can become a colour style, and the style key it lives in:
 * text colour for text, else the fill, else the stroke. A colour that already is `var(--token)` is not offered.
 */
export function colourSource(nodes: CNode[]): { id: string; key: 'color' | 'backgroundColor' | 'borderColor'; color: string } | { error: string } {
  if (!nodes.length) return { error: 'Select a layer with a colour first' }
  let sawToken = false
  for (const n of nodes) {
    const keys = n.type === 'text' ? (['color', 'backgroundColor', 'borderColor'] as const) : (['backgroundColor', 'borderColor', 'color'] as const)
    for (const key of keys) {
      const v = n.style[key]
      if (typeof v !== 'string') continue
      if (v.startsWith('var(')) {
        sawToken = true
        continue
      }
      if (parseColor(v)) return { id: n.id, key, color: v }
    }
  }
  return { error: sawToken ? 'That colour already is a style' : 'The selection has no colour to save' }
}

/** Token name for a colour style typed by the user: "brand-primary" -> "--color-brand-primary". */
export function colourTokenName(input: string): string {
  const slug = normalizeName(input.trim().replace(/^--/, '').replace(/^color-/, '')) // '' when nothing usable is left
  return slug ? `--color-${slug.slice(2)}` : ''
}
