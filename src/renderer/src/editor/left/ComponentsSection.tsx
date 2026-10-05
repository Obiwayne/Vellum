import { Diamond } from 'lucide-react'
import { getStore, useStore } from '../../model/store'
import { instancesOf } from '../../model/components'
import { insertInstance, mainsOf } from '../canvas/componentActions'

/** Main components of the file: click a row to place an instance (in the selected frame, else in view). Hidden when there are none. */
export function ComponentsSection({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const mains = doc ? mainsOf(doc) : []
  if (!doc || !mains.length) return null
  return (
    <div className="lp-components">
      <div className="lp-components__title">Components</div>
      {mains.map((m) => (
        <button
          key={m.id}
          type="button"
          className="lp-component"
          title="Insert an instance"
          onClick={() => insertInstance(docId, m.id)}
          onDoubleClick={() => getStore().select(docId, [m.id])}
        >
          <Diamond size={14} fill="currentColor" className="lp-component__icon" />
          <span className="lp-ellipsis">{m.component?.name ?? m.name}</span>
          <span className="lp-component__count">{instancesOf(doc, m.id).length}</span>
        </button>
      ))}
    </div>
  )
}
