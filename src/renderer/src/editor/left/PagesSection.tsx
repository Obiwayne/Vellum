import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File, Plus } from 'lucide-react'
import { IconButton, useContextMenu, type MenuEntry } from '../../ui'
import { getStore, useStore } from '../../model/store'
import * as ops from '../../model/ops'
import { InlineEdit } from './InlineEdit'

/** Duplicate a page (all its nodes) as one undo step and activate the copy. */
export function duplicatePage(docId: string, pageId: string): void {
  let newPageId = ''
  getStore().mutate(docId, 'Duplicate page', (d) => {
    const src = d.pages.find((p) => p.id === pageId)
    if (!src) return
    const page = ops.makePage(d, `${src.name} copy`)
    page.background = src.background
    // move the new page right after the source
    d.pages = d.pages.filter((p) => p.id !== page.id)
    d.pages.splice(d.pages.findIndex((p) => p.id === pageId) + 1, 0, page)
    const root = d.nodes[page.rootId]
    for (const c of [...d.nodes[src.rootId].children]) {
      const cid = ops.cloneSubtree(d, c)
      d.nodes[cid].parent = root.id
      root.children.push(cid)
    }
    newPageId = page.id
  })
  if (newPageId) getStore().setActivePage(docId, newPageId)
}

export function PagesSection({ docId }: { docId: string }): JSX.Element {
  const pages = useStore((s) => s.docs[docId]?.pages ?? [])
  const activePageId = useStore((s) => s.editors[docId]?.pageId)
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const pagesHeight = useStore((s) => s.prefs.pagesHeight)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const suppressClick = useRef(false)
  const ctx = useContextMenu()
  const store = getStore

  const addPage = (): void => {
    const s = store()
    const id = s.addPage(docId, `Page ${(s.docs[docId]?.pages.length ?? 0) + 1}`)
    const bg = s.prefs.defaultPageColor
    if (id && typeof bg === 'string' && bg) {
      // fold the background into the same undo step as the add
      s.mutate(docId, 'Add page', (d) => {
        const p = d.pages.find((x) => x.id === id)
        if (p) p.background = bg
      }, { noHistory: true })
    }
  }

  const menu = (pageId: string): MenuEntry[] => {
    const i = pages.findIndex((p) => p.id === pageId)
    return [
      { label: 'Rename', onSelect: () => setRenaming(pageId) },
      { label: 'Duplicate', onSelect: () => duplicatePage(docId, pageId) },
      { type: 'separator' },
      { label: 'Move up', disabled: i <= 0, onSelect: () => store().movePage(docId, pageId, i - 1) },
      { label: 'Move down', disabled: i >= pages.length - 1, onSelect: () => store().movePage(docId, pageId, i + 1) },
      { type: 'separator' },
      { label: 'Delete', danger: true, disabled: pages.length <= 1, onSelect: () => store().deletePage(docId, pageId) }
    ]
  }

  /** Pointer-driven reorder (same feel as the layers tree): starts after 4px, drop line between rows, Esc cancels. */
  const onRowPointerDown = (e: React.PointerEvent, pageId: string): void => {
    if (e.button !== 0 || renaming) return
    const startY = e.clientY
    const list = (e.currentTarget as HTMLElement).parentElement
    let dragging = false
    let slot: number | null = null
    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return
        dragging = true
        document.body.classList.add('lp-dragging')
      }
      const rows = list ? [...list.querySelectorAll<HTMLElement>('[data-page-id]')] : []
      // slot = gap index (0..n) nearest the pointer
      slot = rows.length ? rows.length : null
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          slot = i
          break
        }
      }
      setDropAt(slot)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('lp-dragging')
      if (dragging) {
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        const from = store().docs[docId]?.pages.findIndex((p) => p.id === pageId) ?? -1
        // the gap index counts the dragged page itself; convert to an index in the list without it
        if (slot !== null && from >= 0) store().movePage(docId, pageId, slot > from ? slot - 1 : slot)
      }
      setDropAt(null)
    }
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      slot = null
      up()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc, true)
  }

  return (
    <div
      className="lp-pages"
      style={open && typeof pagesHeight === 'number' ? { height: pagesHeight, maxHeight: 'calc(100% - 80px)' } : undefined}
    >
      <div className="lp-section-head" onClick={() => setOpen((o) => !o)}>
        <span className="lp-chev">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <span className="lp-section-title">Pages</span>
        <IconButton
          icon={<Plus size={16} />}
          label="Add page"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
            addPage()
          }}
        />
      </div>
      {open && (
        <div className="lp-pages__list">
          {pages.map((p) => (
            <div
              key={p.id}
              data-page-id={p.id}
              className={['lp-page', p.id === activePageId && 'lp-page--active'].filter(Boolean).join(' ')}
              onClick={() => {
                if (!suppressClick.current) store().setActivePage(docId, p.id)
              }}
              onDoubleClick={() => setRenaming(p.id)}
              onContextMenu={(e) => ctx.open(e, menu(p.id))}
              onPointerDown={(e) => onRowPointerDown(e, p.id)}
            >
              <File size={14} className="lp-page__icon" />
              {renaming === p.id ? (
                <InlineEdit
                  value={p.name}
                  onCommit={(v) => {
                    store().renamePage(docId, p.id, v)
                    setRenaming(null)
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <span className="lp-ellipsis">{p.name}</span>
              )}
            </div>
          ))}
          {dropAt !== null && <div className="lp-dropline" style={{ top: dropAt * 28 - 1, left: 20 }} />}
        </div>
      )}
      {ctx.element}
    </div>
  )
}
