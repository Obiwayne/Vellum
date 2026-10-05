import { useState } from 'react'
import { Diamond, Search } from 'lucide-react'
import { useContextMenu } from '../../ui'
import { useStore } from '../../model/store'
import { COMPONENT_DRAG_TYPE, assetGroups, goToComponent, insertInstance, renameComponent } from '../canvas/componentActions'
import { InlineEdit } from './InlineEdit'

/**
 * Assets: the components of every page of the file, grouped by page, with a name search. Click a row to place an
 * instance (in the selected frame, else in view); drag it onto the canvas to drop one where you want it;
 * right-click for Go to main component, Create instance and Rename. Hidden when the file has no components.
 */
export function ComponentsSection({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
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
          {g.items.map((it) => (
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              className="lp-component"
              title="Click to insert, drag onto the canvas"
              draggable={renaming !== it.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(COMPONENT_DRAG_TYPE, it.id)
                e.dataTransfer.setData('text/plain', it.name)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => renaming !== it.id && insertInstance(docId, it.id)}
              onDoubleClick={() => goToComponent(docId, it.id)}
              onContextMenu={(e) =>
                ctx.open(e, [
                  { label: 'Go to main component', onSelect: () => goToComponent(docId, it.id) },
                  { label: 'Create instance', onSelect: () => void insertInstance(docId, it.id) },
                  { type: 'separator' },
                  { label: 'Rename', onSelect: () => setRenaming(it.id) }
                ])
              }
            >
              <Diamond size={14} fill="currentColor" className="lp-component__icon" />
              {renaming === it.id ? (
                <InlineEdit
                  value={it.name}
                  onCommit={(v) => {
                    renameComponent(docId, it.id, v)
                    setRenaming(null)
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <span className="lp-ellipsis">{it.name}</span>
              )}
              {it.variants > 1 && <span className="lp-component__count">{it.variants} variants</span>}
              <span className="lp-component__count">{it.instances}</span>
            </div>
          ))}
        </div>
      ))}
      {ctx.element}
    </div>
  )
}
