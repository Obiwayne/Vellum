// MCP tools that change the document. Every tool call is one undo step (store.transact / one mutate).
import { getStore } from '../model/store'
import * as ops from '../model/ops'
import { htmlToNodes } from '../model/html'
import { STRUCTURE_MSG, instanceRootOf } from '../model/components'
import type { Doc, StylePatch } from '../model/types'
import {
  arr,
  getDoc,
  markWorking,
  nextArtboardPosition,
  normalizeStyles,
  registerHandler,
  requireNode,
  resolveDocId,
  resolvePage,
  scoped,
  str
} from './registry'
import { treeSummary } from './tools-read'

const CONTAINER_TYPES = new Set(['frame', 'rect'])

function assertContainer(doc: Doc, id: string): void {
  const n = requireNode(doc, id)
  if (!CONTAINER_TYPES.has(n.type)) throw new Error(`Node ${id} is a ${n.type} node and cannot have children`)
}

/** 'root' shorthand → page root of `relativeTo` (or the active page). */
function resolveParent(doc: Doc, parentId: string, relativeTo?: string): string {
  if (parentId !== 'root') return parentId
  const p = relativeTo ? ops.pageOf(doc, relativeTo) : undefined
  return (p ?? resolvePage(doc, undefined)).rootId
}

// ------------------------------------------------------------------------------------------------
// create_artboard

registerHandler('create_artboard', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const page = resolvePage(doc, args.pageId)
  const style = normalizeStyles((args.styles ?? {}) as Record<string, unknown>) as Record<string, string | number | null>
  const pos = nextArtboardPosition(doc, page)
  let x = pos.x
  let y = pos.y
  const left = ops.numericSize(style.left ?? undefined)
  const top = ops.numericSize(style.top ?? undefined)
  if (left !== null) x = left
  if (top !== null) y = top
  delete style.left
  delete style.top
  if (style.position === 'absolute' || style.position === 'relative') delete style.position
  const clean: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(style)) if (v !== null) clean[k] = v
  if (clean.display === undefined) {
    clean.display = 'flex'
    if (clean.flexDirection === undefined) clean.flexDirection = 'column'
  }
  const name = str(args.name)?.trim() || 'Frame'
  const id = getStore().createNode(docId, { type: 'frame', name, style: clean, x, y }, page.rootId)
  if (!id) throw new Error('Could not create artboard')
  markWorking(docId, [id])
  const n = getDoc(docId).nodes[id]
  return scoped(docId, {
    id,
    nodeId: id,
    name,
    pageId: page.id,
    worldX: x,
    worldY: y,
    width: n.style.width ?? null,
    height: n.style.height ?? null
  })
})

// ------------------------------------------------------------------------------------------------
// write_html

registerHandler('write_html', (args) => {
  const docId = resolveDocId(args)
  const html = str(args.html)
  if (!html?.trim()) throw new Error('html is empty')
  const mode = str(args.mode) ?? 'insert-children'
  if (mode !== 'insert-children' && mode !== 'replace') throw new Error('mode must be "insert-children" or "replace"')
  const doc = getDoc(docId)
  const targetArg = str(args.targetNodeId)
  if (!targetArg) throw new Error('targetNodeId is required')
  const target = resolveParent(doc, targetArg)
  requireNode(doc, target)
  // an instance's subtree is derived from its main: the same refusal as editing its structure in the UI
  const inInstance = instanceRootOf(doc, target)
  if (inInstance && (mode === 'insert-children' || inInstance !== target)) throw new Error(`${STRUCTURE_MSG}: node ${target} is part of the instance ${inInstance}. Edit the main component instead, or call detach_instance.`)

  let created: string[] = []
  let parentId: string
  if (mode === 'insert-children') {
    parentId = target
    if (!ops.isPageRoot(doc, target)) assertContainer(doc, target)
    const isRoot = ops.isPageRoot(doc, target)
    const page = isRoot ? doc.pages.find((p) => p.rootId === target) : undefined
    const start = page ? nextArtboardPosition(doc, page) : null
    getStore().mutate(docId, 'Write HTML', (d) => {
      created = htmlToNodes(html, d, { topLevel: isRoot })
      const parent = d.nodes[target]
      let x = start?.x ?? 0
      for (const id of created) {
        const n = d.nodes[id]
        n.parent = target
        parent.children.push(id)
        // top-level nodes without an explicit position go to the next free spot
        if (isRoot && n.x === 0 && n.y === 0 && start) {
          n.x = x
          n.y = start.y
          x += (ops.numericSize(n.style.width) ?? 380) + 80
        }
      }
    })
  } else {
    const t = doc.nodes[target]
    if (!t.parent || ops.isPageRoot(doc, target)) throw new Error('Cannot replace a page root')
    parentId = t.parent
    getStore().mutate(docId, 'Replace with HTML', (d) => {
      const old = d.nodes[target]
      const parent = d.nodes[old.parent as string]
      const index = parent.children.indexOf(target)
      created = htmlToNodes(html, d, { topLevel: ops.isPageRoot(d, parent.id) })
      parent.children.splice(index, 1, ...created)
      for (const id of created) {
        const n = d.nodes[id]
        n.parent = parent.id
        if (n.x === 0 && n.y === 0 && created.length === 1) {
          n.x = old.x
          n.y = old.y
        }
      }
      ops.removeNode(d, target)
    })
  }
  if (!created.length) throw new Error('The HTML did not produce any nodes')
  markWorking(docId, created)
  const after = getDoc(docId)
  const all = created.flatMap((id) => [id, ...ops.descendants(after, id)])
  return scoped(docId, {
    createdNodeIds: created,
    nodeCount: all.length,
    parentId,
    ...(mode === 'replace' ? { replacedNodeId: target } : {}),
    tree: created.map((id) => treeSummary(after, id, 3)).join('\n')
  })
})

// ------------------------------------------------------------------------------------------------
// update_styles

registerHandler('update_styles', (args) => {
  const docId = resolveDocId(args)
  const updates = arr<{ nodeIds?: string[]; styles?: Record<string, unknown> }>(args.updates)
  if (!updates.length) throw new Error('updates is empty')
  const updated = new Set<string>()
  const notFound = new Set<string>()
  getStore().mutate(docId, 'Update styles', (d) => {
    for (const u of updates) {
      const patch = normalizeStyles(u.styles ?? {})
      for (const id of u.nodeIds ?? []) {
        const n = d.nodes[id]
        if (!n || ops.isPageRoot(d, id)) {
          notFound.add(id)
          continue
        }
        const p: StylePatch = { ...patch }
        // left/top of positioned nodes live in x/y
        const willBeAbsolute = (p.position ?? n.style.position) === 'absolute'
        const parentFlow = n.parent ? !ops.isPageRoot(d, n.parent) && ops.isFlowLayout(d.nodes[n.parent]?.style) : false
        const positioned = ops.isTopLevel(d, id) || willBeAbsolute || !parentFlow
        if (positioned) {
          const l = ops.numericSize((p.left ?? undefined) as string | number | undefined)
          const t = ops.numericSize((p.top ?? undefined) as string | number | undefined)
          // a px left/top replaces any 'auto'/'%' left/top kept in the style
          if (l !== null) {
            n.x = l
            p.left = null
          }
          if (t !== null) {
            n.y = t
            p.top = null
          }
          if (ops.isTopLevel(d, id) && (p.position === 'absolute' || p.position === 'relative')) delete p.position
          // becoming absolute with only right/bottom: anchor there, as a browser would (left/top auto)
          if (!ops.isTopLevel(d, id) && willBeAbsolute && n.style.position !== 'absolute') {
            if (p.right != null && p.right !== '' && p.left === undefined && l === null) p.left = 'auto'
            if (p.bottom != null && p.bottom !== '' && p.top === undefined && t === null) p.top = 'auto'
          }
        }
        ops.applyStylePatch(n.style, p)
        updated.add(id)
      }
    }
  })
  markWorking(docId, [...updated])
  return scoped(docId, { updatedNodeIds: [...updated], ...(notFound.size ? { notFound: [...notFound] } : {}) })
})

// ------------------------------------------------------------------------------------------------
// text, names

registerHandler('set_text_content', (args) => {
  const docId = resolveDocId(args)
  const updates = arr<{ nodeId?: string; textContent?: string; text?: string }>(args.updates)
  const results: unknown[] = []
  const done: string[] = []
  getStore().transact(docId, 'Set text', () => {
    for (const u of updates) {
      const doc = getDoc(docId)
      const n = u.nodeId ? doc.nodes[u.nodeId] : undefined
      const t = u.textContent ?? u.text
      if (!n) results.push({ nodeId: u.nodeId, result: 'error', message: 'Node not found' })
      else if (n.type !== 'text') results.push({ nodeId: u.nodeId, result: 'error', message: `Node is a ${n.type}, not a Text node` })
      else if (typeof t !== 'string') results.push({ nodeId: u.nodeId, result: 'error', message: 'Missing textContent' })
      else {
        getStore().setText(docId, n.id, t)
        done.push(n.id)
        results.push({ nodeId: n.id, result: 'updated' })
      }
    }
  })
  markWorking(docId, done)
  return scoped(docId, { results })
})

registerHandler('rename_nodes', (args) => {
  const docId = resolveDocId(args)
  const updates = arr<{ nodeId?: string; name?: string }>(args.updates)
  const results: unknown[] = []
  getStore().mutate(docId, 'Rename layers', (d) => {
    for (const u of updates) {
      const n = u.nodeId ? d.nodes[u.nodeId] : undefined
      const name = (u.name ?? '').trim().slice(0, 50)
      if (!n) results.push({ nodeId: u.nodeId, result: 'error', message: 'Node not found' })
      else if (!name) results.push({ nodeId: u.nodeId, result: 'error', message: 'Name is empty' })
      else {
        n.name = name
        const p = d.pages.find((pg) => pg.rootId === n.id)
        if (p) p.name = name
        results.push({ nodeId: n.id, name, result: 'renamed' })
      }
    }
  })
  return scoped(docId, { results })
})

// ------------------------------------------------------------------------------------------------
// duplicate / move / delete

registerHandler('duplicate_nodes', (args) => {
  const docId = resolveDocId(args)
  const items = arr<{ id?: string; nodeId?: string; parentId?: string }>(args.nodes)
  if (!items.length) throw new Error('nodes is empty')
  const doc0 = getDoc(docId)
  const results: unknown[] = []
  getStore().mutate(docId, 'Duplicate', (d) => {
    let nextPos: { x: number; y: number } | null = null
    for (const it of items) {
      const id = it.id ?? it.nodeId
      const src = id ? d.nodes[id] : undefined
      if (!id || !src || !src.parent) {
        results.push({ sourceId: id, result: 'error', message: 'Node not found or cannot be duplicated' })
        continue
      }
      const parentId = it.parentId ? resolveParent(d, it.parentId, id) : src.parent
      if (!d.nodes[parentId]) {
        results.push({ sourceId: id, result: 'error', message: `Parent ${parentId} not found` })
        continue
      }
      if (!ops.isPageRoot(d, parentId) && !CONTAINER_TYPES.has(d.nodes[parentId].type)) {
        results.push({ sourceId: id, result: 'error', message: `Parent ${parentId} cannot have children` })
        continue
      }
      if (parentId === id || ops.isAncestor(d, id, parentId)) {
        results.push({ sourceId: id, result: 'error', message: 'Cannot duplicate a node into itself' })
        continue
      }
      let cid: string
      if (parentId === src.parent) {
        cid = ops.duplicate(d, id)
      } else {
        cid = ops.cloneSubtree(d, id)
        d.nodes[parentId].children.push(cid)
        d.nodes[cid].parent = parentId
      }
      const copy = d.nodes[cid]
      if (ops.isPageRoot(d, parentId)) {
        // top-level copies go to the next free spot to the right of every artboard
        const page = d.pages.find((p) => p.rootId === parentId)
        if (page) {
          if (!nextPos) nextPos = nextArtboardPosition(doc0, page)
          copy.x = nextPos.x
          copy.y = ops.isPageRoot(d, src.parent) ? src.y : nextPos.y
          nextPos = { x: nextPos.x + (ops.worldRect(doc0, id)?.width ?? ops.numericSize(src.style.width) ?? 380) + 80, y: nextPos.y }
        }
      }
      // map every original descendant to its clone (clone order mirrors the source tree)
      const descendantIdMap: Record<string, string> = {}
      const walk = (a: string, b: string): void => {
        const an = d.nodes[a]
        const bn = d.nodes[b]
        an.children.forEach((c, i) => {
          const cc = bn.children[i]
          if (!cc) return
          descendantIdMap[c] = cc
          walk(c, cc)
        })
      }
      walk(id, cid)
      results.push({ sourceId: id, newId: cid, parentId, descendantIdMap })
    }
  })
  const newIds = results.map((r) => (r as { newId?: string }).newId).filter((x): x is string => Boolean(x))
  markWorking(docId, newIds)
  return scoped(docId, { duplicates: results, newNodeIds: newIds })
})

registerHandler('move_nodes', (args) => {
  const docId = resolveDocId(args)
  type Move = { nodeId?: string; before?: string; after?: string; parentId?: string; index?: number }
  let moves = arr<Move>(args.moves)
  if (!moves.length && Array.isArray(args.nodeIds)) {
    const target = str(args.targetParentId) ?? str(args.parentId)
    if (!target) throw new Error('targetParentId is required with nodeIds')
    const base = typeof args.index === 'number' ? args.index : undefined
    moves = (args.nodeIds as string[]).map((nodeId, i) => ({ nodeId, parentId: target, index: base === undefined ? undefined : base + i }))
  }
  if (!moves.length) throw new Error('Pass moves: [{nodeId, parentId|before|after, index?}] (or nodeIds + targetParentId)')
  const results: unknown[] = []
  const affected = new Set<string>()
  const movedIds: string[] = []
  getStore().transact(docId, 'Move', () => {
    for (const m of moves) {
      const doc = getDoc(docId)
      try {
        const n = requireNode(doc, m.nodeId)
        if (!n.parent) throw new Error('Cannot move a page root')
        let parentId: string
        let pass: number | undefined
        let finalIndex: number
        if (m.before || m.after) {
          const sib = requireNode(doc, m.before ?? m.after)
          if (sib.id === n.id) throw new Error('Sibling cannot be the moved node')
          if (!sib.parent) throw new Error('Sibling has no parent')
          parentId = sib.parent
          const si = doc.nodes[parentId].children.indexOf(sib.id)
          pass = m.after ? si + 1 : si
        } else if (m.parentId) {
          parentId = resolveParent(doc, m.parentId, n.id)
          requireNode(doc, parentId)
          const count = doc.nodes[parentId].children.filter((c) => c !== n.id).length
          if (m.index === undefined) pass = undefined
          else {
            finalIndex = Math.max(0, Math.min(count, Math.floor(m.index)))
            const cur = doc.nodes[parentId].children.indexOf(n.id)
            pass = cur >= 0 && cur < finalIndex ? finalIndex + 1 : finalIndex
          }
        } else throw new Error('Each move needs parentId, before or after')
        if (!ops.isPageRoot(doc, parentId) && !CONTAINER_TYPES.has(doc.nodes[parentId].type)) throw new Error(`Node ${parentId} cannot have children`)
        if (parentId === n.id || ops.isAncestor(doc, n.id, parentId)) throw new Error('Cannot move a node under itself')
        affected.add(n.parent)
        affected.add(parentId)
        getStore().moveNodes(docId, [n.id], parentId, pass)
        const after = getDoc(docId)
        movedIds.push(n.id)
        results.push({ nodeId: n.id, parentId, index: after.nodes[parentId].children.indexOf(n.id), result: 'moved' })
      } catch (err) {
        results.push({ nodeId: m.nodeId, result: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  })
  const doc = getDoc(docId)
  const affectedParents: Record<string, string[]> = {}
  for (const p of affected) if (doc.nodes[p]) affectedParents[p] = [...doc.nodes[p].children]
  markWorking(docId, movedIds)
  return scoped(docId, { results, affectedParents })
})

registerHandler('delete_nodes', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const ids = arr<string>(args.nodeIds)
  const valid = ids.filter((id) => doc.nodes[id] && !ops.isPageRoot(doc, id))
  const notFound = ids.filter((id) => !doc.nodes[id])
  const refused = ids.filter((id) => doc.nodes[id] && ops.isPageRoot(doc, id))
  const deletedCount = valid.reduce((acc, id) => acc + 1 + ops.descendants(doc, id).length, 0)
  if (valid.length) getStore().deleteNodes(docId, valid)
  return scoped(docId, {
    deletedNodeIds: valid,
    deletedCount,
    ...(notFound.length ? { notFound } : {}),
    ...(refused.length ? { refused, message: 'Page roots cannot be deleted' } : {})
  })
})
