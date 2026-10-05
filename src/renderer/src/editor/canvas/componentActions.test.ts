import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { STRUCTURE_MSG } from '../../model/components'
import * as C from './componentActions'

vi.mock('./toast', () => ({ toast: vi.fn() }))
vi.mock('./selection', () => ({ containerAt: vi.fn() }))
import { toast } from './toast'
import { containerAt } from './selection'

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
    expect(labels([card])).toEqual(['-', 'Create component', 'Create instance', 'Add variant'])
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

describe('Assets panel', () => {
  function two() {
    const a = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 100 } }, root())
    const b = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 80, height: 30 } }, root())
    const page2 = S().addPage(id, 'Second')
    const c = S().createNode(id, { type: 'frame', name: 'Card small', style: { width: 100, height: 50 } }, doc().pages[1].rootId)
    for (const n of [a, b, c]) S().createComponent(id, [n])
    return { a, b, c, page2 }
  }

  it('lists the components of every page, grouped by page, with instance counts', () => {
    const { a, b, c } = two()
    S().createInstance(id, a, root())
    S().createInstance(id, a, root())
    const groups = C.assetGroups(doc())
    expect(groups.map((g) => g.page.name)).toEqual([doc().pages[0].name, 'Second'])
    expect(groups[0].items).toEqual([
      { id: a, name: 'Card', instances: 2, variants: 1 },
      { id: b, name: 'Button', instances: 0, variants: 1 }
    ])
    expect(groups[1].items).toEqual([{ id: c, name: 'Card small', instances: 0, variants: 1 }])
  })

  it('search is case-insensitive, matches across pages and drops empty pages', () => {
    const { a, c } = two()
    expect(C.assetGroups(doc(), 'CARD').flatMap((g) => g.items.map((i) => i.id))).toEqual([a, c])
    expect(C.assetGroups(doc(), '  small ').map((g) => g.page.name)).toEqual(['Second'])
    expect(C.assetGroups(doc(), 'nope')).toEqual([])
    expect(C.assetGroups(doc(), '')).toHaveLength(2)
  })

  it('a component inside an instance is not listed twice, and a doc without components lists nothing', () => {
    const { doc: fresh } = { doc: doc() }
    expect(C.assetGroups(fresh)).toEqual([])
    const { a } = two()
    const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
    S().createInstance(id, a, stage)
    expect(C.assetGroups(doc()).flatMap((g) => g.items).filter((i) => i.name === 'Card')).toHaveLength(1)
  })

  it('dropComponent places an instance in the frame under the pointer, centred on it', () => {
    const { a } = two()
    const stage = S().createNode(id, { type: 'frame', name: 'Stage', style: { width: 500, height: 500 } }, root())
    vi.mocked(containerAt).mockReturnValue(stage)
    const inst = C.dropComponent(id, a, 300, 200)!
    expect(doc().nodes[inst].instance?.of).toBe(a)
    expect(doc().nodes[inst].parent).toBe(stage)
    expect([doc().nodes[inst].x, doc().nodes[inst].y]).toEqual([300 - 100, 200 - 50])
    expect(S().editors[id].selection).toEqual([inst])
  })

  it('dropComponent never drops inside an instance: it lands beside it', () => {
    const { a } = two()
    const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
    const first = S().createInstance(id, a, stage)
    const inner = doc().nodes[first].children[0] ?? first
    vi.mocked(containerAt).mockReturnValue(first)
    const second = C.dropComponent(id, a, 10, 10)!
    expect(doc().nodes[second].parent).toBe(stage)
    expect(inner).toBeTruthy()
  })

  it('dropComponent refuses a cycle with a toast', () => {
    const { a } = two()
    vi.mocked(containerAt).mockReturnValue(a)
    expect(C.dropComponent(id, a, 5, 5)).toBeUndefined()
    expect(toast).toHaveBeenCalled()
  })

  it('exposes the drag type the canvas listens for', () => {
    expect(C.COMPONENT_DRAG_TYPE).toBe('application/x-vellum-component')
  })
})

describe('Assets panel: go to and rename', () => {
  it('goToComponent switches to the main\'s page and selects it', () => {
    const a = S().createNode(id, { type: 'frame', name: 'Card' }, root())
    S().createComponent(id, [a])
    const page2 = S().addPage(id, 'Second')
    S().setActivePage(id, page2)
    expect(S().editors[id].pageId).toBe(page2)
    expect(C.goToComponent(id, a)).toBe(true)
    expect(S().editors[id].pageId).toBe(doc().pages[0].id)
    expect(S().editors[id].selection).toEqual([a])
    expect(C.goToComponent(id, 'nope')).toBe(false)
    expect(C.goToComponent(id, doc().pages[0].rootId)).toBe(false) // not a component
  })

  it('renameComponent renames the component and its layer in one undo step, keeps a custom layer name', () => {
    const a = S().createNode(id, { type: 'frame', name: 'Card' }, root())
    S().createComponent(id, [a])
    const inst = S().createInstance(id, a, root())
    C.renameComponent(id, a, '  Panel ')
    expect(doc().nodes[a].component?.name).toBe('Panel')
    expect(doc().nodes[a].name).toBe('Panel')
    expect(C.assetGroups(doc())[0].items[0].name).toBe('Panel')
    expect(doc().nodes[inst].instance?.of).toBe(a)
    S().undo(id)
    expect(doc().nodes[a].component?.name).toBe('Card')
    expect(doc().nodes[a].name).toBe('Card')
    S().redo(id)
    S().renameNode(id, a, 'Custom layer')
    C.renameComponent(id, a, 'Tile')
    expect(doc().nodes[a].component?.name).toBe('Tile')
    expect(doc().nodes[a].name).toBe('Custom layer')
    C.renameComponent(id, a, '   ') // blank: ignored
    expect(doc().nodes[a].component?.name).toBe('Tile')
    C.renameComponent(id, 'nope', 'x')
  })
})
