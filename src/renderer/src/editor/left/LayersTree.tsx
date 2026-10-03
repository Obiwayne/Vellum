import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Columns3, Eye, EyeOff, Frame, Grid2x2, Image, Lock, LockOpen, PenTool, Rows3, Square } from 'lucide-react'
import { useContextMenu, type MenuEntry } from '../../ui'
import { getStore, useStore } from '../../model/store'
import * as ops from '../../model/ops'
import type { CNode, Doc } from '../../model/types'
import { CANVAS_COMMAND_EVENT } from '../../shell/commands'
import * as A from '../canvas/actions'
import { InlineEdit } from './InlineEdit'

interface Row {
  id: string
  depth: number
  hasChildren: boolean
}

type DropPos = 'before' | 'after' | 'inside'
interface DropTarget {
  id: string
  pos: DropPos
}

/** Expanded layers per doc survive tab switches / panel remounts. */
const expandedByDoc = new Map<string, Set<string>>()
const COLLAPSE_EVENT = 'layers:collapse-all'

/** Collapse every layer of the doc (Alt+L). */
export function collapseAllLayers(docId: string): void {
  expandedByDoc.get(docId)?.clear()
  window.dispatchEvent(new CustomEvent(COLLAPSE_EVENT, { detail: docId }))
}

export function NodeIcon({ node }: { node: CNode }): JSX.Element {
  switch (node.type) {
    case 'text':
      return <span className="lp-aa">Aa</span>
    case 'rect':
      return <Square size={14} />
    case 'image':
      return <Image size={14} />
    case 'svg':
      return <PenTool size={14} />
    default: {
      const d = node.style.display
      if (d === 'grid' || d === 'inline-grid') return <Grid2x2 size={14} />
      if (d === 'flex' || d === 'inline-flex') {
        const dir = String(node.style.flexDirection ?? 'row')
        return dir.startsWith('column') ? <Rows3 size={14} /> : <Columns3 size={14} />
      }
      return <Frame size={14} />
    }
  }
}

function flatten(doc: Doc, rootId: string, expanded: Set<string>): Row[] {
  const out: Row[] = []
  const walk = (id: string, depth: number): void => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const n = doc.nodes[c]
      if (!n) continue
      out.push({ id: c, depth, hasChildren: n.children.length > 0 })
      if (n.children.length && expanded.has(c)) walk(c, depth + 1)
    }
  }
  walk(rootId, 0)
  return out
}

/** Actions shared by the row context menu. `ids` = nodes to act on. */
export function nodeMenu(docId: string, ids: string[], onRename?: () => void): MenuEntry[] {
  const s = getStore()
  const doc = s.docs[docId]
  if (!doc) return []
  const nodes = ids.map((id) => doc.nodes[id]).filter(Boolean)
  const allHidden = nodes.every((n) => !n.visible)
  const allLocked = nodes.every((n) => n.locked)
  const setAll = (label: string, patch: Partial<CNode>): void =>
    s.transact(docId, label, () => {
      for (const id of ids) s.updateNode(docId, id, patch)
    })
  const reorder = (front: boolean): void =>
    s.transact(docId, front ? 'Bring to front' : 'Send to back', () => {
      for (const id of ops.sortByTreeOrder(doc, ids)) {
        const n = getStore().docs[docId]?.nodes[id]
        if (!n?.parent) continue
        const parent = getStore().docs[docId].nodes[n.parent]
        s.moveNodes(docId, [id], n.parent, front ? parent.children.length : 0)
      }
    })
  return [
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => window.dispatchEvent(new CustomEvent(CANVAS_COMMAND_EVENT, { detail: { command: 'copy' } })) },
    {
      label: 'Duplicate',
      shortcut: 'Ctrl+D',
      onSelect: () => {
        const copies = s.duplicateNodes(docId, ids)
        if (copies.length) s.select(docId, copies)
      }
    },
    { label: 'Delete', shortcut: 'Delete', onSelect: () => s.deleteNodes(docId, ids) },
    { type: 'separator' },
    { label: 'Group selection', shortcut: 'Ctrl+G', onSelect: () => (s.select(docId, ids), A.groupSelection(docId)) },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onSelect: () => (s.select(docId, ids), A.ungroupSelection(docId)) },
    { label: 'Frame selection', shortcut: 'Ctrl+Alt+G', onSelect: () => (s.select(docId, ids), A.frameSelection(docId)) },
    {
      label: 'Wrap in flex',
      shortcut: 'Shift+A',
      onSelect: () => {
        const w = s.wrapInFlex(docId, ids)
        if (w) s.select(docId, [w])
      }
    },
    { type: 'separator' },
    { label: 'Bring to front', shortcut: ']', onSelect: () => reorder(true) },
    { label: 'Send to back', shortcut: '[', onSelect: () => reorder(false) },
    { type: 'separator' },
    { label: allHidden ? 'Show' : 'Hide', shortcut: 'Ctrl+Shift+H', onSelect: () => setAll(allHidden ? 'Show' : 'Hide', { visible: allHidden }) },
    { label: allLocked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+Shift+L', onSelect: () => setAll(allLocked ? 'Unlock' : 'Lock', { locked: !allLocked }) },
    ...(onRename && ids.length === 1 ? ([{ type: 'separator' }, { label: 'Rename', onSelect: onRename }] as MenuEntry[]) : [])
  ]
}

export function LayersTree({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const pageId = useStore((s) => s.editors[docId]?.pageId)
  const selection = useStore((s) => s.editors[docId]?.selection)
  const hovered = useStore((s) => s.editors[docId]?.hovered ?? null)
  const [, force] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const anchor = useRef<string | null>(null)
  const dragIds = useRef<string[] | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const ctx = useContextMenu()

  if (!expandedByDoc.has(docId)) expandedByDoc.set(docId, new Set())
  const expanded = expandedByDoc.get(docId)!
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0]
  const selSet = useMemo(() => new Set(selection ?? []), [selection])

  useEffect(() => {
    const on = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === docId) force((n) => n + 1)
    }
    window.addEventListener(COLLAPSE_EVENT, on)
    return () => window.removeEventListener(COLLAPSE_EVENT, on)
  }, [docId])

  // auto-expand ancestors of the selection, then scroll the first selected row into view
  useEffect(() => {
    if (!doc || !selection?.length) return
    let changed = false
    for (const id of selection) {
      if (!doc.nodes[id]) continue
      for (const a of ops.ancestors(doc, id)) {
        if (doc.nodes[a]?.parent && !expanded.has(a)) {
          expanded.add(a)
          changed = true
        }
      }
    }
    if (changed) force((n) => n + 1)
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`[data-layer-id="${CSS.escape(selection[selection.length - 1])}"]`)
      ;(el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  // `expanded` is a mutable set (bumped via force), so recompute every render — cheap for layer counts we expect
  const rows = doc && page ? flatten(doc, page.rootId, expanded) : []

  const toggle = useCallback(
    (id: string, deep: boolean) => {
      const d = getStore().docs[docId]
      const open = !expanded.has(id)
      const ids = deep && d ? [id, ...ops.descendants(d, id)] : [id]
      for (const x of ids) {
        if (open) expanded.add(x)
        else expanded.delete(x)
      }
      force((n) => n + 1)
    },
    [docId, expanded]
  )

  const onRowClick = (e: React.MouseEvent, id: string): void => {
    if (suppressClick.current) return
    const s = getStore()
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.id)
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        s.select(docId, e.ctrlKey || e.metaKey ? [...new Set([...(selection ?? []), ...range])] : range)
        return
      }
    }
    if (e.ctrlKey || e.metaKey) s.select(docId, [id], true)
    else s.select(docId, [id])
    anchor.current = id
  }

  const onContext = (e: React.MouseEvent, id: string): void => {
    let ids = selection ?? []
    if (!ids.includes(id)) {
      getStore().select(docId, [id])
      ids = [id]
      anchor.current = id
    }
    ctx.open(e, nodeMenu(docId, ids, () => setRenaming(id)))
  }

  // ------------------------------------------------------------------ drag and drop
  const computeDrop = (clientY: number, el: HTMLElement, rowId: string): DropTarget | null => {
    const d = getStore().docs[docId]
    const dragging = dragIds.current
    if (!d || !dragging) return null
    const n = d.nodes[rowId]
    if (!n) return null
    // can't drop onto/into itself or its descendants
    if (dragging.some((x) => x === rowId || ops.isAncestor(d, x, rowId))) return null
    const r = el.getBoundingClientRect()
    const f = (clientY - r.top) / r.height
    const container = n.type === 'frame'
    let pos: DropPos
    if (container) pos = f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside'
    else pos = f < 0.5 ? 'before' : 'after'
    // "after" an expanded container = first child of it
    if (pos === 'after' && container && expanded.has(rowId) && n.children.length) pos = 'inside'
    return { id: rowId, pos }
  }

  /** Pointer-driven drag: starts after 4px, hit-tests rows under the cursor, drops on release. */
  const suppressClick = useRef(false)
  const onRowPointerDown = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0 || renaming) return
    const startY = e.clientY
    const startX = e.clientX
    let dragging = false
    let target: DropTarget | null = null
    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4 && Math.abs(ev.clientX - startX) < 4) return
        dragging = true
        const sel = getStore().editors[docId]?.selection ?? []
        dragIds.current = sel.includes(id) ? sel : [id]
        document.body.classList.add('lp-dragging')
      }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const rowEl = hit?.closest('[data-layer-id]') as HTMLElement | null
      target = rowEl ? computeDrop(ev.clientY, rowEl, rowEl.dataset.layerId as string) : null
      setDrop((prev) => (prev?.id === target?.id && prev?.pos === target?.pos ? prev : target))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('lp-dragging')
      if (dragging) {
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        if (target) performDrop(target)
      }
      dragIds.current = null
      setDrop(null)
    }
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      target = null
      up()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc, true)
  }

  const performDrop = (t: DropTarget): void => {
    const s = getStore()
    const d = s.docs[docId]
    const ids = dragIds.current
    if (!d || !ids?.length) return
    const n = d.nodes[t.id]
    if (!n) return
    let parentId: string
    let index: number
    if (t.pos === 'inside') {
      parentId = t.id
      index = expanded.has(t.id) ? 0 : n.children.length
      expanded.add(t.id)
    } else {
      if (!n.parent) return
      parentId = n.parent
      index = d.nodes[parentId].children.indexOf(t.id) + (t.pos === 'after' ? 1 : 0)
    }
    s.moveNodes(docId, ids, parentId, index)
    s.select(docId, ids)
  }

  if (!doc || !page) return null

  const dropLine = (() => {
    if (!drop || drop.pos === 'inside') return null
    const i = rows.findIndex((r) => r.id === drop.id)
    if (i < 0) return null
    return { top: (drop.pos === 'before' ? i : i + 1) * 28, depth: rows[i].depth }
  })()

  return (
    <div
      className="lp-layers"
      ref={scroller}
      onMouseLeave={() => getStore().setHovered(docId, null)}
      onMouseMove={(e) => {
        const t = e.target as HTMLElement
        if (!t.closest('[data-layer-id]') && getStore().editors[docId]?.hovered) getStore().setHovered(docId, null)
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) getStore().select(docId, [])
      }}
    >
      <div className="lp-layers__inner">
        {rows.map((r) => (
          <LayerRow
            key={r.id}
            node={doc.nodes[r.id]}
            depth={r.depth}
            hasChildren={r.hasChildren}
            expanded={expanded.has(r.id)}
            selected={selSet.has(r.id)}
            hovered={hovered === r.id}
            parentSelected={!selSet.has(r.id) && ops.ancestors(doc, r.id).some((a) => selSet.has(a))}
            dropInside={drop?.id === r.id && drop.pos === 'inside'}
            renaming={renaming === r.id}
            onToggle={(deep) => toggle(r.id, deep)}
            onClick={(e) => onRowClick(e, r.id)}
            onRename={() => setRenaming(r.id)}
            onRenameDone={(v) => {
              if (v !== null) getStore().renameNode(docId, r.id, v)
              setRenaming(null)
            }}
            onHover={() => getStore().setHovered(docId, r.id)}
            onContextMenu={(e) => onContext(e, r.id)}
            onSetVisible={(v) => getStore().updateNode(docId, r.id, { visible: v })}
            onSetLocked={(v) => getStore().updateNode(docId, r.id, { locked: v })}
            onPointerDown={(e) => onRowPointerDown(e, r.id)}
          />
        ))}
        {dropLine && <div className="lp-dropline" style={{ top: dropLine.top - 1, left: 8 + dropLine.depth * 16 + 16 }} />}
      </div>
      {ctx.element}
    </div>
  )
}

interface LayerRowProps {
  node: CNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  selected: boolean
  hovered: boolean
  parentSelected: boolean
  dropInside: boolean
  renaming: boolean
  onToggle: (deep: boolean) => void
  onClick: (e: React.MouseEvent) => void
  onRename: () => void
  onRenameDone: (v: string | null) => void
  onHover: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onSetVisible: (v: boolean) => void
  onSetLocked: (v: boolean) => void
  onPointerDown: (e: React.PointerEvent) => void
}

const LayerRow = memo(function LayerRow(p: LayerRowProps): JSX.Element {
  const n = p.node
  const cls = [
    'lp-layer',
    p.selected && 'lp-layer--selected',
    p.parentSelected && 'lp-layer--child-of-selected',
    p.hovered && 'lp-layer--hovered',
    !n.visible && 'lp-layer--hidden',
    n.locked && 'lp-layer--locked',
    p.dropInside && 'lp-layer--drop-inside'
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      data-layer-id={n.id}
      style={{ paddingLeft: 8 + p.depth * 16 }}
      onClick={p.onClick}
      onDoubleClick={(e) => {
        e.stopPropagation()
        p.onRename()
      }}
      onMouseEnter={p.onHover}
      onContextMenu={p.onContextMenu}
      onPointerDown={p.onPointerDown}
    >
      <span
        className="lp-chev"
        onClick={(e) => {
          if (!p.hasChildren) return
          e.stopPropagation()
          p.onToggle(e.altKey)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {p.hasChildren && (p.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </span>
      <span className="lp-layer__icon">
        <NodeIcon node={n} />
      </span>
      {p.renaming ? (
        <InlineEdit value={n.name} onCommit={(v) => p.onRenameDone(v)} onCancel={() => p.onRenameDone(null)} />
      ) : (
        <span className="lp-ellipsis lp-layer__name">{n.name}</span>
      )}
      <span className={['lp-layer__slot', n.locked && 'lp-layer__slot--on'].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="lp-layer__toggle"
          aria-label={n.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation()
            p.onSetLocked(!n.locked)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {n.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </span>
      <span className={['lp-layer__slot', !n.visible && 'lp-layer__slot--on'].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="lp-layer__toggle"
          aria-label={n.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            p.onSetVisible(!n.visible)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {n.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </span>
    </div>
  )
})
