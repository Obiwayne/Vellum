// MCP tools for text styles (docs/factory/T25-plan.md, task T-F). A text style is a named bundle of typography
// (family, size, weight, style, line height, letter spacing, decoration, case) in Doc.textStyles; applying it copies
// the values onto text nodes and links them, so editing the style updates every linked node. Colour styles are colour
// tokens: use get_tokens / set_tokens / create_tokens. Each call is one undo step.
import { getStore } from '../model/store'
import { numericSize } from '../model/ops'
import { getTextStyle, linkedNodes, pickTextStyleKeys } from '../model/textStyles'
import { TEXT_STYLE_KEYS } from '../model/types'
import type { Doc, TextStyle } from '../model/types'
import { arr, getDoc, markWorking, normalizeStyles, registerHandler, requireNode, resolveDocId, scoped, str } from './registry'

/** A style by id, else by name (case-insensitive); throws with the available names. */
export function findTextStyle(doc: Doc, key: unknown): TextStyle {
  const k = str(key)?.trim()
  if (!k) throw new Error('styleId is required (a text style id or name)')
  const list = doc.textStyles ?? []
  const hit = list.find((s) => s.id === k) ?? list.find((s) => s.name.toLowerCase() === k.toLowerCase())
  if (!hit) throw new Error(`Text style "${k}" not found. Available: ${list.map((s) => `${s.name} (${s.id})`).join(', ') || 'none (create one with create_text_style)'}`)
  return hit
}

const describe = (doc: Doc, s: TextStyle): Record<string, unknown> => ({ id: s.id, name: s.name, style: s.style, linkedNodeCount: linkedNodes(doc, s.id).length })

/** Typography keys of a styles argument: px strings become numbers where the model does, unknown keys are reported. */
function styleArg(raw: unknown): { style: Record<string, string | number | null>; ignored: string[] } {
  const norm = normalizeStyles((raw ?? {}) as Record<string, unknown>)
  const style: Record<string, string | number | null> = {}
  const ignored: string[] = []
  for (const [k, v] of Object.entries(norm)) {
    if (!(TEXT_STYLE_KEYS as readonly string[]).includes(k)) ignored.push(k)
    else style[k] = k === 'fontSize' && typeof v === 'string' ? numericSize(v) ?? v : v // the inspector stores font sizes as numbers
  }
  return { style, ignored }
}

registerHandler('get_text_styles', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const styles = (doc.textStyles ?? []).map((s) => describe(doc, s))
  return scoped(docId, { styles, count: styles.length, keys: [...TEXT_STYLE_KEYS] })
})

registerHandler('create_text_style', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const name = str(args.name)?.trim()
  if (!name) throw new Error('name is required (a slash groups styles: "Heading/H1")')
  const fromNodeId = str(args.fromNodeId)
  if (fromNodeId && args.style !== undefined) throw new Error('Pass fromNodeId or style, not both')
  let from: string | Record<string, string | number>
  let ignored: string[] = []
  if (fromNodeId) {
    const n = requireNode(doc, fromNodeId)
    if (n.type !== 'text') throw new Error(`Node ${n.id} is not a text node`)
    from = n.id
  } else {
    const a = styleArg(args.style)
    ignored = a.ignored
    from = pickTextStyleKeys(Object.fromEntries(Object.entries(a.style).filter(([, v]) => v !== null)) as Record<string, string | number>)
    if (!Object.keys(from).length) throw new Error(`Pass fromNodeId (a text node) or style with at least one of: ${TEXT_STYLE_KEYS.join(', ')}`)
  }
  const id = getStore().createTextStyle(docId, name, from)
  const after = getDoc(docId)
  return scoped(docId, { ...describe(after, getTextStyle(after, id) as TextStyle), ...(ignored.length ? { ignoredKeys: ignored } : {}) })
})

registerHandler('update_text_style', (args) => {
  const docId = resolveDocId(args)
  const s = findTextStyle(getDoc(docId), args.styleId)
  const { style, ignored } = styleArg(args.style)
  const name = str(args.name)?.trim()
  if (!Object.keys(style).length && !name) throw new Error('Pass style (typography keys; null removes a key) and/or name')
  const store = getStore()
  store.transact(docId, 'Edit text style', () => {
    if (Object.keys(style).length) store.updateTextStyle(docId, s.id, style)
    if (name) store.renameTextStyle(docId, s.id, name)
  })
  const after = getDoc(docId)
  markWorking(docId, linkedNodes(after, s.id).map((n) => n.id))
  return scoped(docId, { ...describe(after, getTextStyle(after, s.id) as TextStyle), updatedNodeIds: linkedNodes(after, s.id).map((n) => n.id), ...(ignored.length ? { ignoredKeys: ignored } : {}) })
})

registerHandler('delete_text_style', (args) => {
  const docId = resolveDocId(args)
  const s = findTextStyle(getDoc(docId), args.styleId)
  const unlinked = linkedNodes(getDoc(docId), s.id).map((n) => n.id)
  getStore().deleteTextStyle(docId, s.id)
  return scoped(docId, { deletedStyleId: s.id, name: s.name, unlinkedNodeIds: unlinked, message: 'Linked nodes keep their current typography' })
})

registerHandler('apply_text_style', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const ids = arr<string>(args.nodeIds)
  if (!ids.length) throw new Error('nodeIds is required')
  const detach = args.styleId === null
  const s = detach ? undefined : findTextStyle(doc, args.styleId)
  const ok: string[] = []
  const skipped: { nodeId: string; reason: string }[] = []
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n) skipped.push({ nodeId: id, reason: 'not found' })
    else if (n.type !== 'text') skipped.push({ nodeId: id, reason: `a ${n.type} node: text styles apply to text nodes` })
    else ok.push(id)
  }
  if (ok.length) {
    if (s) getStore().applyTextStyle(docId, ok, s.id)
    else getStore().detachTextStyle(docId, ok)
    markWorking(docId, ok)
  }
  return scoped(docId, { [detach ? 'detachedNodeIds' : 'appliedNodeIds']: ok, ...(s ? { styleId: s.id, name: s.name } : {}), ...(skipped.length ? { skipped } : {}) })
})
