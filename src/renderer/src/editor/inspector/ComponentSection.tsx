import { Button, Section } from '../../ui'
import { useStore } from '../../model/store'
import { instanceRootOf } from '../../model/components'
import { variantsOf } from '../../model/variants'
import {
  addVariantToSelection,
  detachSelection,
  goToMainOfSelection,
  insertInstance,
  isOverridden,
  resetLayerOverride,
  resetOverridesOfSelection,
  variantLabel
} from '../canvas/componentActions'

/** Top of the inspector for a main component or anything inside an instance. */
export function ComponentSection({ docId, ids }: { docId: string; ids: string[] }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  if (!doc || ids.length !== 1) return null
  const node = doc.nodes[ids[0]]
  if (!node) return null
  if (node.componentSet) {
    const n = variantsOf(doc, node.id).length
    return (
      <Section title="Component set">
        <div className="insp-comp__name">{node.componentSet.name}</div>
        <div className="insp-comp__meta">{n} variant{n === 1 ? '' : 's'}</div>
      </Section>
    )
  }
  if (node.component) {
    return (
      <Section title="Main component">
        <div className="insp-comp__name">{node.component.name}</div>
        {variantLabel(doc, node.id) && <div className="insp-comp__meta">{variantLabel(doc, node.id)}</div>}
        <div className="insp-comp__row">
          <Button onClick={() => insertInstance(docId, node.id)}>Create instance</Button>
          <Button onClick={() => addVariantToSelection(docId)}>Add variant</Button>
        </div>
      </Section>
    )
  }
  const rootId = instanceRootOf(doc, node.id)
  const root = rootId ? doc.nodes[rootId] : undefined
  const main = root?.instance ? doc.nodes[root.instance.of] : undefined
  if (!root?.instance) return null
  const overridden = Object.keys(root.instance.overrides ?? {})
  const here = isOverridden(doc, node.id)
  return (
    <Section title="Instance">
      <div className="insp-comp__name">{main?.component?.name ?? 'Missing component'}</div>
      {main && variantLabel(doc, main.id) && <div className="insp-comp__meta" data-variant>{variantLabel(doc, main.id)}</div>}
      <div className="insp-comp__meta">
        {overridden.length ? `${overridden.length} overridden layer${overridden.length === 1 ? '' : 's'}` : 'No overrides'}
      </div>
      {here && (
        <div className="insp-comp__layer" data-overridden="true">
          <span className="insp-comp__dot" aria-hidden />
          <span>This layer is overridden</span>
          <Button size="sm" onClick={() => resetLayerOverride(docId, node.id)}>
            Reset layer
          </Button>
        </div>
      )}
      <div className="insp-comp__row">
        <Button disabled={!main} onClick={() => goToMainOfSelection(docId)}>
          Go to main
        </Button>
        <Button disabled={!overridden.length} onClick={() => resetOverridesOfSelection(docId)}>
          Reset all
        </Button>
        <Button onClick={() => detachSelection(docId)} shortcut="Ctrl+Alt+B">
          Detach
        </Button>
      </div>
    </Section>
  )
}
