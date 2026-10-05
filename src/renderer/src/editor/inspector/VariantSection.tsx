import { Section } from '../../ui'
import { useStore } from '../../model/store'
import { setOf, variantValues } from '../../model/variants'
import { renameVariantProperty, renameVariantValue } from '../canvas/componentActions'
import { CommitInput } from './PropertiesSection'

/** On a variant main: rename the variant property (Variant -> State) and this variant's value (Variant 2 -> Hover). */
export function VariantSection({ docId, mainId }: { docId: string; mainId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const setId = doc ? setOf(doc, mainId) : null
  if (!doc || !setId) return null
  const have = variantValues(doc, mainId)
  const props = (doc.nodes[setId].componentSet?.props ?? []).filter((p) => p.type === 'variant')
  if (!props.length) return null
  return (
    <Section title="Variant">
      {props.map((p) => (
        <div key={p.id} className="insp-prop__row insp-variant" data-variant-prop={p.id}>
          <CommitInput label={`Variant property name ${p.name}`} value={p.name} onCommit={(v) => renameVariantProperty(docId, setId, p.id, v)} />
          <CommitInput label={`Value of ${p.name}`} value={have[p.id]} onCommit={(v) => renameVariantValue(docId, setId, p.id, have[p.id], v)} />
        </div>
      ))}
    </Section>
  )
}
