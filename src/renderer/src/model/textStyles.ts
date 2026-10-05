// Text styles: named typography bundles in Doc.textStyles, materialised onto text nodes (the node's
// style carries the real CSS; node.textStyle is the link). Functions mutate the doc: call on an immer draft.
import type { CNode, Doc, Style, StylePatch, TextStyle } from './types'
import { TEXT_STYLE_KEYS } from './types'
import { newId } from './ops'

export const getTextStyle = (doc: Doc, id: string | undefined): TextStyle | undefined =>
  id ? doc.textStyles?.find((s) => s.id === id) : undefined

/** Only the text-style keys of a style (undefined values dropped). */
export function pickTextStyleKeys(style: Style | StylePatch): Style {
  const out: Style = {}
  for (const k of TEXT_STYLE_KEYS) {
    const v = style[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

/** The stored form of a style name: trimmed, with no spaces around slashes ("Heading / H1" -> "Heading/H1"). */
export const normalizeTextStyleName = (name: string): string => name.trim().replace(/\s*\/\s*/g, '/')
const norm = normalizeTextStyleName

/** Name that no other style uses: "Body", "Body 2", "Body 3"… (case-insensitive). */
export function uniqueTextStyleName(doc: Doc, name: string, ignoreId?: string): string {
  const base = norm(name) || 'Text style'
  const taken = new Set((doc.textStyles ?? []).filter((s) => s.id !== ignoreId).map((s) => s.name.toLowerCase()))
  let out = base
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base} ${i}`
  return out
}

/** Create a style from explicit keys, or from a text node's current typography. Returns its id. */
export function createTextStyle(doc: Doc, name: string, from: Style | string): string {
  const src = typeof from === 'string' ? doc.nodes[from]?.style ?? {} : from
  const id = newId(doc)
  ;(doc.textStyles ??= []).push({ id, name: uniqueTextStyleName(doc, name), style: pickTextStyleKeys(src) })
  return id
}

export function renameTextStyle(doc: Doc, id: string, name: string): boolean {
  const s = getTextStyle(doc, id)
  if (!s) return false
  s.name = uniqueTextStyleName(doc, name, id)
  return true
}

/** Write the style's keys onto a node and drop the keys the style leaves unset. Keeps the link. */
export function materialise(node: CNode, s: TextStyle): void {
  for (const k of TEXT_STYLE_KEYS) {
    const v = s.style[k]
    if (v === undefined) delete node.style[k]
    else node.style[k] = v
  }
}

/** Link a text node to a style and copy its keys. False when node or style is missing or not text. */
export function applyTextStyle(doc: Doc, nodeId: string, styleId: string): boolean {
  const n = doc.nodes[nodeId]
  const s = getTextStyle(doc, styleId)
  if (!n || n.type !== 'text' || !s) return false
  materialise(n, s)
  n.textStyle = s.id
  return true
}

/** Unlink a node; its values stay. */
export function detachTextStyle(doc: Doc, nodeId: string): boolean {
  const n = doc.nodes[nodeId]
  if (!n || n.textStyle === undefined) return false
  delete n.textStyle
  return true
}

/** Nodes (any depth, all pages) that follow a style. Instance twins (srcId) are left out: they are rebuilt from their main. */
export function linkedNodes(doc: Doc, styleId: string): CNode[] {
  return Object.values(doc.nodes).filter((n) => n.textStyle === styleId && n.srcId === undefined)
}

/** Instance roots whose overrides point at the style (the style change must be re-synced into them). */
export function instancesUsing(doc: Doc, styleId: string): string[] {
  return Object.values(doc.nodes)
    .filter((n) => n.instance?.overrides && Object.values(n.instance.overrides).some((o) => o.textStyle === styleId))
    .map((n) => n.id)
}

/** True when `patch` changes a text-style key of the node's style (so a linked node should detach). */
export function touchesTextStyle(style: Style, patch: StylePatch): boolean {
  return TEXT_STYLE_KEYS.some((k) => k in patch && patch[k] !== undefined && (patch[k] ?? undefined) !== style[k])
}

/** Manual typography edit of a linked node: unlink it (values stay). Returns the style's name when it detached, else undefined. */
export function detachOnEdit(doc: Doc, node: CNode, patch: StylePatch): string | undefined {
  if (node.textStyle === undefined || !touchesTextStyle(node.style, patch)) return undefined
  const name = getTextStyle(doc, node.textStyle)?.name ?? node.textStyle
  delete node.textStyle
  return name
}

export const detachedMessage = (name: string): string => `Detached from text style ${name}`

/** Rewrite every node linked to the style from the style's current keys. Returns how many. */
export function syncTextStyle(doc: Doc, styleId: string): number {
  const s = getTextStyle(doc, styleId)
  if (!s) return 0
  const nodes = linkedNodes(doc, styleId)
  for (const n of nodes) materialise(n, s)
  return nodes.length
}

/** Merge keys into a style (null removes a key; non text-style keys are ignored) and sync its nodes. */
export function updateTextStyle(doc: Doc, styleId: string, patch: StylePatch): boolean {
  const s = getTextStyle(doc, styleId)
  if (!s) return false
  for (const k of TEXT_STYLE_KEYS) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null) delete s.style[k]
    else s.style[k] = v
  }
  syncTextStyle(doc, styleId)
  return true
}

/** Remove a style; linked nodes (and instance overrides) are unlinked and keep their values. */
export function deleteTextStyle(doc: Doc, styleId: string): boolean {
  const i = doc.textStyles?.findIndex((s) => s.id === styleId) ?? -1
  if (i < 0) return false
  const gone = doc.textStyles![i]
  doc.textStyles!.splice(i, 1)
  for (const n of Object.values(doc.nodes)) {
    if (n.textStyle === styleId) delete n.textStyle
    for (const [key, o] of Object.entries(n.instance?.overrides ?? {})) {
      if (o.textStyle !== styleId) continue
      // an override only stores the link (its keys are written at sync): bake the keys in so the values stay
      const baked: StylePatch = { ...(o.style ?? {}) }
      for (const k of TEXT_STYLE_KEYS) baked[k] = gone.style[k] ?? null
      o.style = baked
      // '' keeps the layer detached when its main follows another style; otherwise there is nothing to say
      if (doc.nodes[key]?.textStyle !== undefined) o.textStyle = ''
      else delete o.textStyle
    }
  }
  return true
}
