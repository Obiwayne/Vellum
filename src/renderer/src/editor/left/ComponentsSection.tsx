import { useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useContextMenu } from '../../ui'
import { useStore } from '../../model/store'
import { COMPONENT_DRAG_TYPE, assetGroups, goToComponent, insertInstance, renameComponent } from '../canvas/componentActions'
import { ComponentThumb } from './ComponentThumb'
import { InlineEdit } from './InlineEdit'

/**
 * Assets: the components of every page of the file, grouped by page, with a name search and a live thumbnail per
 * component. A component set is one row (its default variant) that expands to its variants. Click a row to place an
 * instance (in the selected frame, else in view); drag it onto the canvas to drop one where you want it;
 * right-click for Go to main component, Create instance and Rename. Hidden when the file has no components.
 */
export function ComponentsSection({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const ctx = useContextMenu()
  if (!doc) return null
  const all = assetGroups(doc)
  if (!all.length) return null
  const groups = query.trim() ? assetGroups(doc, query) : all
  return (
    <div className="lp-components">
      <div className="lp-components__title">Assets</div>
      <label className="lp-components__search">
        <Search size={12} />
        <input value={query} placeholder="Search components" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
      </label>
      {!groups.length && <div className="lp-components__empty">No components match</div>}
      {groups.map((g) => (
        <div key={g.page.id}>
          {doc.pages.length > 1 ? <div className="lp-components__page">{g.page.name}</div> : null}
          {g.items.map((it) => {
            const expanded = Boolean(it.variants) && (open.has(it.id) || Boolean(query.trim()))
            const row = (id: string, name: string, count: number, thumbId: string, extra?: JSX.Element, renamable = true, nested = false, variantCount = 0): JSX.Element => (
              <div
                key={id + (nested ? ':v' : '')}
                role="button"
                tabIndex={0}
                className={nested ? 'lp-component lp-component--variant' : 'lp-component'}
                title="Click to insert, drag onto the canvas"
                draggable={renaming !== id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(COMPONENT_DRAG_TYPE, id)
                  e.dataTransfer.setData('text/plain', name)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => renaming !== id && insertInstance(docId, id)}
                onDoubleClick={() => goToComponent(docId, id)}
                onContextMenu={(e) =>
                  ctx.open(e, [
                    { label: 'Go to main component', onSelect: () => goToComponent(docId, id) },
                    { label: 'Create instance', onSelect: () => void insertInstance(docId, id) },
                    ...(renamable ? [{ type: 'separator' } as const, { label: 'Rename', onSelect: () => setRenaming(id) }] : [])
                  ])
                }
              >
                {extra}
                <ComponentThumb doc={doc} id={thumbId} />
                {renaming === id ? (
                  <InlineEdit
                    value={name}
                    onCommit={(v) => {
                      renameComponent(docId, id, v)
                      setRenaming(null)
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="lp-ellipsis">{name}</span>
                )}
                {variantCount > 0 && (
                  <span className="lp-component__variants">{variantCount === 1 ? '1 variant' : `${variantCount} variants`}</span>
                )}
                <span className="lp-component__count">{count}</span>
              </div>
            )
            const chevron = it.variants ? (
              <span
                className="lp-component__chev"
                role="button"
                aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((o) => {
                    const n = new Set(o)
                    if (n.has(it.id)) n.delete(it.id)
                    else n.add(it.id)
                    return n
                  })
                }}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            ) : undefined
            return (
              <div key={it.id}>
                {row(it.id, it.name, it.instances, it.id, chevron, !it.variants, false, it.variants?.length ?? 0)}
                {expanded && it.variants?.map((v) => row(v.id, v.label, v.instances, v.id, undefined, false, true))}
              </div>
            )
          })}
        </div>
      ))}
      {ctx.element}
    </div>
  )
}
