// Text typography outside the inspector: the per-doc "last text style" that new text from the Text
// tool copies, and the text formatting shortcuts (bold/italic/underline, size, weight, spacing).
import { getStore, useStore } from '../model/store'
import { applyStylePatch } from '../model/ops'
import type { CNode, Style, StylePatch } from '../model/types'
import { fontSizeOf, letterSpacingPct, lineHeightOf, weightOf } from './inspector/TextSection'

/** Typography copied to new text (never size or position). */
const TYPOGRAPHY_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'color',
  'textAlign',
  'textTransform',
  'textDecoration',
  'textDecorationLine',
  'textDecorationColor',
  'textDecorationThickness',
  'textUnderlineOffset',
  'fontVariantNumeric',
  'fontVariantLigatures',
  'fontVariantCaps',
  'fontFeatureSettings',
  'fontVariationSettings',
  'WebkitTextStrokeWidth',
  'WebkitTextStrokeColor',
  'paintOrder'
]

// In memory only: the typography of the text most recently selected or edited, per doc.
const lastStyle = new Map<string, Style>()

export function typographyOf(n: CNode): Style {
  const out: Style = {}
  for (const k of TYPOGRAPHY_KEYS) if (n.style[k] !== undefined) out[k] = n.style[k]
  return out
}

/** Style for a new text node in this doc (undefined → the usual text defaults). */
export const lastTextStyle = (docId: string): Style | undefined => {
  const s = lastStyle.get(docId)
  return s ? { ...s } : undefined
}

/**
 * Keep the doc's last text style up to date: whenever the selection or the doc changes, the first
 * selected text node's typography is remembered. Returns an uninstall function.
 */
export function trackLastTextStyle(docId: string): () => void {
  const remember = (): void => {
    const s = getStore()
    const doc = s.docs[docId]
    const sel = s.editors[docId]?.selection ?? []
    const text = sel.map((id) => doc?.nodes[id]).find((n) => n?.type === 'text')
    if (text) lastStyle.set(docId, typographyOf(text))
  }
  remember()
  return useStore.subscribe((s, prev) => {
    if (s.docs[docId] !== prev.docs[docId] || s.editors[docId]?.selection !== prev.editors[docId]?.selection) remember()
  })
}

// ------------------------------------------------------------------------------------------ shortcuts
/** Selected, unlocked text nodes. */
function selectedText(docId: string): CNode[] {
  const s = getStore()
  const doc = s.docs[docId]
  const sel = s.editors[docId]?.selection ?? []
  return sel.map((id) => doc?.nodes[id]).filter((n): n is CNode => n?.type === 'text' && !n.locked)
}

/** One undo step: `fn` returns the patch for each selected text node. False when no text is selected. */
function editText(docId: string, label: string, fn: (n: CNode) => StylePatch): boolean {
  const ids = selectedText(docId).map((n) => n.id)
  if (!ids.length) return false
  getStore().mutate(docId, label, (d) => {
    for (const id of ids) {
      const n = d.nodes[id]
      if (n) applyStylePatch(n.style, fn(n))
    }
  })
  return true
}

const isUnderlined = (n: CNode): boolean => /underline/.test(String(n.style.textDecorationLine ?? n.style.textDecoration ?? ''))

/** Ctrl+B / Ctrl+I / Ctrl+U: on for all when any selected text is off, else off for all. */
export function toggleText(docId: string, what: 'bold' | 'italic' | 'underline'): boolean {
  const nodes = selectedText(docId)
  if (!nodes.length) return false
  if (what === 'bold') {
    const on = nodes.every((n) => Number(weightOf(n)) >= 700)
    return editText(docId, on ? 'Remove bold' : 'Bold', () => ({ fontWeight: on ? null : 700 }))
  }
  if (what === 'italic') {
    const on = nodes.every((n) => n.style.fontStyle === 'italic' || n.style.fontStyle === 'oblique')
    return editText(docId, on ? 'Remove italic' : 'Italic', () => ({ fontStyle: on ? null : 'italic' }))
  }
  const on = nodes.every(isUnderlined)
  return editText(docId, on ? 'Remove underline' : 'Underline', () =>
    on ? { textDecoration: null, textDecorationLine: null } : { textDecoration: null, textDecorationLine: 'underline' }
  )
}

const round = (v: number, p = 100): number => Math.round(v * p) / p

/** Size ±1px, weight ±100, letter spacing ±0.01em, line height ±1px (dir is +1 or -1). */
export function nudgeText(docId: string, what: 'size' | 'weight' | 'tracking' | 'leading', dir: number): boolean {
  if (what === 'size') return editText(docId, 'Font size', (n) => ({ fontSize: Math.max(1, round(fontSizeOf(n) + dir)) }))
  if (what === 'weight')
    return editText(docId, 'Font weight', (n) => {
      const w = Math.min(900, Math.max(100, Number(weightOf(n)) + dir * 100))
      return { fontWeight: w === 400 ? null : w }
    })
  if (what === 'tracking')
    return editText(docId, 'Letter spacing', (n) => {
      const em = round(letterSpacingPct(n) / 100 + dir * 0.01, 10000)
      return { letterSpacing: em ? `${em}em` : null }
    })
  return editText(docId, 'Line height', (n) => {
    const lh = lineHeightOf(n)
    const base = lh === 'Auto' ? Math.round(fontSizeOf(n) * 1.2) : lh
    return { lineHeight: `${Math.max(0, round(base + dir))}px` }
  })
}
