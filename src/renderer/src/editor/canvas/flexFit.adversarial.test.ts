// @vitest-environment jsdom
// Test-station checks for T36 (new flex frames start at Fit height) through the editor action Shift+A and the inspector path.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import * as ops from '../../model/ops'
import * as A from './actions'

vi.mock('./toast', () => ({ toast: vi.fn() }))

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId
const st = (n: string) => doc().nodes[n].style

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

function card(name = 'Card'): { frame: string; text: string } {
  const frame = S().createNode(id, { type: 'frame', name }, root())
  const text = S().createNode(id, { type: 'text', text: 'Hello' }, frame)
  return { frame, text }
}

describe('Shift+A (wrapOrAddFlex)', () => {
  it('one fixed frame: Add flex -> Fit height, selection stays on the frame, one undo', () => {
    const { frame } = card()
    S().select(id, [frame])
    A.wrapOrAddFlex(id)
    expect(st(frame).height).toBe('fit-content')
    expect(st(frame).width).toBe(380)
    expect(S().editors[id].selection).toEqual([frame])
    S().undo(id)
    expect(st(frame).height).toBe(380)
    expect(st(frame).display).toBeUndefined()
  })

  it('a text: wraps it in a hugging flex frame and selects the wrapper; one undo', () => {
    const { frame, text } = card()
    S().select(id, [text])
    A.wrapOrAddFlex(id)
    const w = doc().nodes[text].parent as string
    expect(w).not.toBe(frame)
    expect(st(w)).toMatchObject({ display: 'flex', width: 'fit-content', height: 'fit-content' })
    expect(S().editors[id].selection).toEqual([w])
    S().undo(id)
    expect(doc().nodes[text].parent).toBe(frame)
  })

  it('a frame that is already flex gets wrapped (a hugging wrapper), not re-flexed', () => {
    const { frame } = card()
    S().select(id, [frame])
    A.wrapOrAddFlex(id) // now flex
    A.wrapOrAddFlex(id) // second Shift+A wraps it
    const w = doc().nodes[frame].parent as string
    expect(w).not.toBe(root())
    expect(st(w)).toMatchObject({ display: 'flex', width: 'fit-content', height: 'fit-content' })
    expect(st(frame).height).toBe('fit-content')
  })

  it('several selected siblings: one wrapper holds all, hugging; row when spread horizontally', () => {
    const { frame } = card()
    const a = S().createNode(id, { type: 'rect', x: 0, y: 0 }, frame)
    const b = S().createNode(id, { type: 'rect', x: 300, y: 5 }, frame)
    S().select(id, [a, b])
    A.wrapOrAddFlex(id)
    const w = doc().nodes[a].parent as string
    expect(doc().nodes[b].parent).toBe(w)
    expect(st(w).width).toBe('fit-content')
    expect(st(w).height).toBe('fit-content')
  })
})

describe('inspector path (Add flex button on several frames)', () => {
  it('every frame becomes Fit height in ONE undo step', () => {
    const a = card('A').frame
    const b = card('B').frame
    S().transact(id, 'Add flex', () => [a, b].forEach((f) => S().addFlex(id, f)))
    expect(st(a).height).toBe('fit-content')
    expect(st(b).height).toBe('fit-content')
    S().undo(id)
    expect(st(a).height).toBe(380)
    expect(st(b).height).toBe(380)
  })
})

describe('edge cases', () => {
  it('a child with position:absolute keeps it (as today); the frame still hugs the flow children', () => {
    const { frame } = card()
    const pinned = S().createNode(id, { type: 'rect', style: { position: 'absolute' } }, frame)
    S().addFlex(id, frame)
    expect(st(pinned).position).toBe('absolute')
    expect(ops.isFlowChild(doc(), pinned)).toBe(false)
    expect(st(frame).height).toBe('fit-content')
  })

  it('a frame with a min/max height keeps them (Fit height is height only)', () => {
    const { frame } = card()
    S().updateStyles(id, [frame], { minHeight: 200, maxHeight: 500 })
    S().addFlex(id, frame)
    expect(st(frame)).toMatchObject({ minHeight: 200, maxHeight: 500, height: 'fit-content' })
  })

  it('Add flex on a grid frame switches it to flex and keeps Fit height; Add grid on a flex frame keeps Fit height', () => {
    const { frame } = card()
    S().mutate(id, 'grid', (d) => ops.addGrid(d, frame))
    expect(st(frame).height).toBe('fit-content') // grid already hugs (unchanged by this task)
    S().switchLayout(id, frame, 'flex')
    expect(st(frame)).toMatchObject({ display: 'flex', height: 'fit-content' })
  })

  it('Add flex on a main: an existing instance keeps its own box (by design) but gets the flex content; a new instance starts at Fit height', () => {
    const { frame } = card()
    S().createComponent(id, [frame])
    const old = S().createInstance(id, frame, root())
    S().addFlex(id, frame)
    expect(st(frame).height).toBe('fit-content')
    expect(st(old).display).toBe('flex') // synced from the main
    expect(st(old).height).toBe(380) // the instance root keeps its own size (docs/COMPONENTS.md)
    const fresh = S().createInstance(id, frame, root())
    expect(st(fresh).height).toBe('fit-content') // created from the main's current box
  })

  it('Add flex on an INSTANCE root becomes a per-instance override and is undone in one step', () => {
    const { frame } = card()
    S().createComponent(id, [frame])
    const inst = S().createInstance(id, frame, root())
    const before = JSON.stringify(doc().nodes[inst].style)
    S().addFlex(id, inst)
    expect(st(inst).display).toBe('flex')
    S().undo(id)
    expect(JSON.stringify(doc().nodes[inst].style)).toBe(before)
  })

  it('wrapping a node that sits in a flex parent keeps its slot and does not pin the wrapper', () => {
    const outer = S().createNode(id, { type: 'frame', name: 'Row', style: { display: 'flex', flexDirection: 'row', width: 400, height: 'fit-content' } }, root())
    const a = S().createNode(id, { type: 'rect' }, outer)
    const b = S().createNode(id, { type: 'rect' }, outer)
    S().select(id, [b])
    A.wrapOrAddFlex(id)
    const w = doc().nodes[b].parent as string
    expect(doc().nodes[outer].children).toEqual([a, w])
    expect(st(w).position).not.toBe('absolute')
    expect(st(w).height).toBe('fit-content')
  })
})
