import { useState } from 'react'
import { Checkbox, Select } from '../../ui'
import { useStore } from '../../model/store'
import { propDefsOf, instanceRootOf } from '../../model/components'
import { setOf } from '../../model/variants'
import type { PropDef } from '../../model/types'
import { chooseVariant, mainsOf, setInstanceValue } from '../canvas/componentActions'

/** Text field that sets the property on Enter / blur (not per keystroke). */
function TextValue({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }): JSX.Element {
  const [v, setV] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setV(value)
  }
  return (
    <input
      className="insp-prop__input"
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(value)
      }}
    />
  )
}

/** Controls for an instance's properties: a dropdown per variant prop, a toggle per boolean, a field per text, a picker per swap. */
export function InstanceProps({ docId, instId }: { docId: string; instId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const inst = doc?.nodes[instId]
  if (!doc || !inst?.instance || instanceRootOf(doc, instId) !== instId) return null
  const mainId = inst.instance.of
  const defs = propDefsOf(doc, mainId)
  if (!defs.length) return null
  const setId = setOf(doc, mainId)
  const main = doc.nodes[mainId]
  const mains = mainsOf(doc)
  const value = (d: PropDef): string | boolean => inst.instance?.props?.[d.id] ?? d.default
  return (
    <div className="insp-prop__list">
      {defs.map((d) => (
        <div key={d.id} className="insp-prop__row" data-prop-id={d.id} data-prop-type={d.type}>
          <span className="insp-prop__name">{d.name}</span>
          {d.type === 'variant' && setId && (
            <Select<string>
              size="sm"
              value={main.component?.variant?.[d.id] ?? String(d.default)}
              options={(d.options ?? []).map((o) => ({ value: o, label: o }))}
              onChange={(o) => chooseVariant(docId, instId, d.id, o)}
            />
          )}
          {d.type === 'boolean' && <Checkbox checked={value(d) === true} onChange={(c) => setInstanceValue(docId, instId, d.id, c)} />}
          {d.type === 'text' && <TextValue label={d.name} value={String(value(d))} onCommit={(v) => setInstanceValue(docId, instId, d.id, v)} />}
          {d.type === 'swap' && (
            <Select<string>
              size="sm"
              value={String(value(d))}
              options={mains.map((m) => ({ value: m.id, label: m.component?.name ?? m.name }))}
              onChange={(v) => setInstanceValue(docId, instId, d.id, v)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
