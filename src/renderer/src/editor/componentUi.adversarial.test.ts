// @vitest-environment jsdom
// T21 test station: adversarial probes of the variants UI wiring.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../model/store'
import * as A from './canvas/componentActions'

vi.mock('./canvas/toast', () => ({ toast: vi.fn() }))
import { toast } from './canvas/toast'

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId
const labels = (ids: string[]): string[] => A.componentMenu(id, ids).map((e) => ('label' in e ? e.label : '-'))
const geo = { rects: new Map(), bounds: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0, y: 0 } }

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  vi.mocked(toast).mockClear()
})

function withSet() {
  const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root())
  S().createComponent(id, [btn], geo)
  const second = S().addVariant(id, btn)
  return { btn, second, setId: doc().nodes[btn].component!.set as string }
}

describe('variants UI: adversarial', () => {
  it('Add variant from a variant main adds a third variant to the same set, in one undo step', () => {
    const { second, setId } = withSet()
    S().select(id, [second])
    const before = JSON.stringify(doc().nodes)
    A.addVariantToSelection(id)
    const third = S().editors[id].selection[0]
    expect(doc().nodes[third].parent).toBe(setId)
    expect(doc().nodes[setId].children).toHaveLength(3)
    expect(doc().nodes[setId].componentSet!.props[0].options).toEqual(['Default', 'Variant 2', 'Variant 3'])
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
  })

  it('the set frame itself cannot be turned into a component, nor offered Add variant', () => {
    const { setId } = withSet()
    const entries = A.componentMenu(id, [setId])
    expect(labels([setId])).not.toContain('Add variant')
    const create = entries.find((e) => 'label' in e && e.label === 'Create component')
    // either the entry is gone or disabled; and the action must not corrupt the set
    S().select(id, [setId])
    A.createComponentFromSelection(id)
    expect(doc().nodes[setId].component).toBeUndefined()
    expect(doc().nodes[setId].componentSet).toBeDefined()
    expect(toast).toHaveBeenCalledWith('A component set already groups components')
    expect(create === undefined || ('disabled' in create && create.disabled)).toBe(true)
  })

  it('a variant main is not offered Create component (already one) but is offered Add variant', () => {
    const { second } = withSet()
    expect(labels([second])).toContain('Add variant')
    expect(A.componentMenu(id, [second]).find((e) => 'label' in e && e.label === 'Create component')).toMatchObject({ disabled: true })
  })

  it('an instance, a node inside one, and a plain frame get no Add variant; several mains neither', () => {
    const { btn, second } = withSet()
    const inst = S().createInstance(id, btn, root())
    const inner = doc().nodes[inst].children[0] ?? inst
    expect(labels([inst])).not.toContain('Add variant')
    expect(labels([inner])).not.toContain('Add variant')
    expect(labels([btn, second])).not.toContain('Add variant')
    S().select(id, [inst])
    A.addVariantToSelection(id)
    expect(doc().nodes[doc().nodes[btn].component!.set as string].children).toHaveLength(2) // unchanged
  })

  it('variantLabel survives a prop added later and a missing variant value', () => {
    const { btn, second, setId } = withSet()
    S().mutate(id, 'hand edit', (d) => {
      delete d.nodes[second].component!.variant // hand-edited doc: no values
    })
    expect(A.variantLabel(doc(), second)).toBe('Variant=Default')
    expect(A.setFrameOf(doc(), second)).toBe(setId)
    expect(A.setFrameOf(doc(), setId)).toBe(setId)
    expect(A.setFrameOf(doc(), btn)).toBe(setId)
    expect(A.setFrameOf(doc(), root())).toBeNull()
  })

  it('Assets: deleting every variant but one still lists the component once; deleting all drops it', () => {
    const { btn, second } = withSet()
    S().deleteNodes(id, [second])
    const items = A.assetGroups(doc()).flatMap((g) => g.items)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: btn, variants: 1 })
    S().deleteNodes(id, [btn])
    expect(A.assetGroups(doc())).toEqual([])
  })
})
