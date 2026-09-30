import { useState } from 'react'
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

  const menu = (pageId: string): MenuEntry[] => [
    { label: 'Rename', onSelect: () => setRenaming(pageId) },
    { label: 'Duplicate', onSelect: () => duplicatePage(docId, pageId) },
    { type: 'separator' },
    { label: 'Delete', danger: true, disabled: pages.length <= 1, onSelect: () => store().deletePage(docId, pageId) }
  ]

  return (
    <div className="lp-pages">
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
      {open &&
        pages.map((p) => (
          <div
            key={p.id}
            className={['lp-page', p.id === activePageId && 'lp-page--active'].filter(Boolean).join(' ')}
            onClick={() => store().setActivePage(docId, p.id)}
            onDoubleClick={() => setRenaming(p.id)}
            onContextMenu={(e) => ctx.open(e, menu(p.id))}
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
      {ctx.element}
    </div>
  )
}
