import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Checkbox, IconButton, Section, Select } from '../../ui'
import { useStore } from '../../model/store'
import { instanceRootOf, mainOf, propDefsOf } from '../../model/components'
import type { CNode, Doc, PropDef } from '../../model/types'
import {
  addPropertyTo,
  bindLayer,
  deleteProperty,
  mainsOf,
  propsOwner,
  renameProperty,
  setPropertyDefault,
  type PropKind
} from '../canvas/componentActions'

/** Name field that commits on Enter / blur (one undo step per edit, not per keystroke). */
export function CommitInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }): JSX.Element {
  const [v, setV] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setV(value)
  }
  const done = (): void => {
    if (v === value) return
    onCommit(v)
    setV(value) // a refused edit snaps back; an accepted one re-syncs from the new value on the next render
  }
  return (
    <input
      className="insp-prop__input"
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation() // typing must not reach the canvas shortcuts
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(value)
      }}
    />
  )
}

const KINDS: { kind: PropKind; label: string }[] = [
  { kind: 'boolean', label: 'Boolean' },
  { kind: 'text', label: 'Text' },
  { kind: 'swap', label: 'Swap' }
]

/** Property editor on a main component or a component set: add, rename, set default, delete. */
export function PropertiesSection({ docId, ownerId }: { docId: string; ownerId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  if (!doc) return null
  const defs = propDefsOf(doc, ownerId).filter((d) => d.type !== 'variant')
  const mains = mainsOf(doc)
  return (
    <Section title="Properties">
      {defs.map((d) => (
        <div key={d.id} className="insp-prop" data-prop-id={d.id} data-prop-type={d.type}>
          <CommitInput label={`Property name ${d.name}`} value={d.name} onCommit={(v) => renameProperty(docId, ownerId, d.id, v)} />
          <span className="insp-prop__type">{d.type}</span>
          <IconButton icon={<Trash2 size={14} />} label={`Delete ${d.name}`} onClick={() => deleteProperty(docId, ownerId, d.id)} />
          <div className="insp-prop__default">
            {d.type === 'boolean' && <Checkbox checked={d.default === true} label="Default on" onChange={(c) => setPropertyDefault(docId, ownerId, d.id, c)} />}
            {d.type === 'text' && <CommitInput label={`Default of ${d.name}`} value={String(d.default)} onCommit={(v) => setPropertyDefault(docId, ownerId, d.id, v)} />}
            {d.type === 'swap' && (
              <Select<string>
                size="sm"
                value={String(d.default)}
                options={mains.map((m) => ({ value: m.id, label: m.component?.name ?? m.name }))}
                onChange={(v) => setPropertyDefault(docId, ownerId, d.id, v)}
              />
            )}
          </div>
        </div>
      ))}
      <div className="insp-comp__row">
        {KINDS.map((k) => (
          <Button key={k.kind} size="sm" onClick={() => addPropertyTo(docId, ownerId, k.kind)}>
            + {k.label}
          </Button>
        ))}
      </div>
    </Section>
  )
}

const ASPECTS: { aspect: 'visible' | 'text' | 'swap'; type: PropDef['type']; label: string; fits: (n: CNode) => boolean }[] = [
  { aspect: 'visible', type: 'boolean', label: 'Visible', fits: () => true },
  { aspect: 'text', type: 'text', label: 'Text', fits: (n) => n.type === 'text' },
  { aspect: 'swap', type: 'swap', label: 'Swap', fits: (n) => Boolean(n.instance) }
]

/** For a layer inside a main: which property drives its visibility / text / nested component. Hidden when nothing could bind. */
export function BindingsSection({ docId, nodeId }: { docId: string; nodeId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const node = doc?.nodes[nodeId]
  if (!doc || !node || !bindable(doc, node)) return null
  const main = mainOf(doc, nodeId) as string
  const defs = propDefsOf(doc, main)
  const rows = ASPECTS.filter((a) => a.fits(node) && defs.some((d) => d.type === a.type) && !(nodeId === main && a.aspect !== 'swap'))
  if (!rows.length) return null
  return (
    <Section title="Bind to property">
      {rows.map((a) => (
        <div key={a.aspect} className="insp-prop__bind" data-bind-aspect={a.aspect}>
          <span>{a.label}</span>
          <Select<string>
            size="sm"
            value={node.bind?.[a.aspect] ?? ''}
            options={[{ value: '', label: 'None' }, ...defs.filter((d) => d.type === a.type).map((d) => ({ value: d.id, label: d.name }))]}
            onChange={(v) => bindLayer(docId, nodeId, a.aspect, v || null)}
          />
        </div>
      ))}
    </Section>
  )
}

/** A layer of a main (not one of an instance's derived layers) can carry bindings. */
function bindable(doc: Doc, node: CNode): boolean {
  const main = mainOf(doc, node.id)
  if (!main) return false
  const inst = instanceRootOf(doc, node.id)
  return !inst || inst === node.id
}

export { propsOwner }
