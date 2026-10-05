import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { STRUCTURE_MSG } from '../../model/components'
import * as C from './componentActions'

vi.mock('./toast', () => ({ toast: vi.fn() }))
import { toast } from './toast'

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId
const labels = (ids: string[]): string[] => C.componentMenu(id, ids).map((e) => ('label' in e ? e.label : '-'))

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
  vi.mocked(toast).mockClear()
})

function setup() {
  const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 100 } }, root())
  const title = S().createNode(id, { type: 'text', text: 'Title' }, card)
  const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
  return { card, title, stage }
}

describe('component actions', () => {
  it('Create component marks the selected frame, selects it and toasts', () => {
    const { card } = setup()
    S().select(id, [card])
    C.createComponentFromSelection(id)
    expect(doc().nodes[card].component).toEqual({ name: 'Card' })
    expect(S().editors[id].selection).toEqual([card])
    expect(toast).toHaveBeenCalledWith('Created component')
  })

  it('Create component wraps a non-frame selection', () => {
    const { title } = setup()
    S().select(id, [title])
    C.createComponentFromSelection(id)
    const parent = doc().nodes[title].parent as string
    expect(doc().nodes[parent].component).toBeDefined()
  })

  it('insertInstance puts an instance into the selected frame and selects it', () => {
    const { card, stage } = setup()
    S().select(id, [card])
    C.createComponentFromSelection(id)
    S().select(id, [stage])
    const inst = C.insertInstance(id, card)!
    expect(doc().nodes[inst].instance?.of).toBe(card)
    expect(doc().nodes[inst].parent).toBe(stage)
    expect(S().editors[id].selection).toEqual([inst])
    // with the main itself selected the instance goes on the page, never inside the main
    S().select(id, [card])
    const beside = C.insertInstance(id, card)!
    expect(doc().nodes[beside].parent).toBe(root())
    expect(doc().nodes[card].children).toHaveLength(1)
  })

  it('Detach, Reset overrides and Go to main work from the selection', () => {
    const { card, title, stage } = setup()
    S().select(id, [card])
    C.createComponentFromSelection(id)
    S().select(id, [stage])
    const inst = C.insertInstance(id, card)!
    const twin = doc().nodes[inst].children[0]
    S().updateStyles(id, [twin], { color: 'red' })
    expect(doc().nodes[inst].instance?.overrides?.[title]).toBeDefined()

    S().select(id, [twin])
    expect(labels([twin])).toEqual(['-', 'Go to main component', 'Reset all overrides', 'Detach instance'])
    S().select(id, [])
    C.goToMainOfSelection(id)
    S().select(id, [twin])
    C.goToMainOfSelection(id)
    expect(S().editors[id].selection).toEqual([card])

    S().select(id, [twin])
    C.resetOverridesOfSelection(id)
    expect(doc().nodes[inst].instance?.overrides).toBeUndefined()
    C.detachSelection(id)
    expect(doc().nodes[inst].instance).toBeUndefined()
    expect(S().editors[id].selection).toEqual([inst])
  })

  it('per-layer override state and reset', () => {
    const { card, title, stage } = setup()
    S().select(id, [card])
    C.createComponentFromSelection(id)
    const inst = C.insertInstance(id, card) ?? S().createInstance(id, card, stage)
    const twin = doc().nodes[inst].children[0]
    expect(C.isOverridden(doc(), twin)).toBe(false)
    S().updateStyles(id, [twin], { color: 'red' })
    expect(C.isOverridden(doc(), twin)).toBe(true)
    expect(C.isOverridden(doc(), title)).toBe(false) // the main's own layer is never "overridden"
    S().updateStyles(id, [inst], { backgroundColor: 'red' })
    expect(C.isOverridden(doc(), inst)).toBe(true) // the instance root counts too
    C.resetLayerOverride(id, twin)
    expect(C.isOverridden(doc(), twin)).toBe(false)
    expect(C.isOverridden(doc(), inst)).toBe(true) // other layers keep theirs
    C.resetLayerOverride(id, inst)
    expect(C.isOverridden(doc(), inst)).toBe(false)
    expect(doc().nodes[inst].instance?.overrides).toBeUndefined()
  })

  it('menu entries follow the selection kind', () => {
    const { card, title } = setup()
    expect(labels([card])).toContain('Create component')
    expect(labels([title])).toContain('Create component')
    S().select(id, [card])
    C.createComponentFromSelection(id)
    expect(labels([card])).toEqual(['-', 'Create component', 'Create instance'])
    expect(C.componentMenu(id, [card])[1]).toMatchObject({ disabled: true }) // already a component
    expect(C.componentMenu(id, [])).toEqual([])
  })

  it('guarded turns a refused edit into a toast', () => {
    const { card, stage } = setup()
    S().select(id, [card])
    C.createComponentFromSelection(id)
    const inst = S().createInstance(id, card, stage)
    const twin = doc().nodes[inst].children[0]
    expect(C.guarded(() => S().deleteNodes(id, [twin]))).toBeUndefined()
    expect(toast).toHaveBeenCalledWith(STRUCTURE_MSG)
  })
})
