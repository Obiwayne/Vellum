// New flex frames start at Fit height (T36): Add flex, Wrap in flex, and what must stay as it was.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'
import * as ops from './ops'

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId
const st = (n: string) => doc().nodes[n].style

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

/** A fixed 380x380 artboard with a text and a rect inside (absolutely placed by x/y). */
function fixedFrame(): { frame: string; text: string; rect: string } {
  const frame = S().createNode(id, { type: 'frame', name: 'Card' }, root())
  const text = S().createNode(id, { type: 'text', text: 'Hello', x: 20, y: 30 }, frame)
  const rect = S().createNode(id, { type: 'rect', x: 50, y: 90 }, frame)
  return { frame, text, rect }
}

describe('Add flex (store.addFlex / ops.addFlex)', () => {
  it('a fixed frame becomes Fit height; width and its other styles stay', () => {
    const { frame } = fixedFrame()
    expect(st(frame).height).toBe(380)
    S().addFlex(id, frame)
    expect(st(frame).height).toBe('fit-content')
    expect(st(frame).width).toBe(380) // a fixed-width card stays fixed-width
    expect(st(frame).backgroundColor).toBe('#FFFFFF')
    expect(st(frame)).toMatchObject({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 16, padding: '16px' })
  })

  it('one undo restores the fixed height and removes flex; redo re-applies', () => {
    const { frame } = fixedFrame()
    const before = JSON.stringify(doc().nodes[frame].style)
    S().addFlex(id, frame)
    S().undo(id)
    expect(JSON.stringify(doc().nodes[frame].style)).toBe(before)
    expect(st(frame).height).toBe(380)
    expect(st(frame).display).toBeUndefined()
    S().redo(id)
    expect(st(frame).height).toBe('fit-content')
  })

  it('children enter the flow: nothing keeps them absolute', () => {
    const { frame, text, rect } = fixedFrame()
    S().addFlex(id, frame)
    for (const c of [text, rect]) {
      expect(st(c).position).not.toBe('absolute')
      expect(ops.isFlowChild(doc(), c)).toBe(true)
    }
  })

  it('does nothing on a non-frame', () => {
    const { text } = fixedFrame()
    const before = JSON.stringify(doc().nodes[text])
    S().addFlex(id, text)
    expect(JSON.stringify(doc().nodes[text])).toBe(before)
  })
})

describe('Wrap in flex (store.wrapInFlex / ops.wrapInFlex)', () => {
  it('the wrapper is Fit width and Fit height, not sized from the selection bounds', () => {
    const { frame, text, rect } = fixedFrame()
    const w = S().wrapInFlex(id, [text, rect]) as string
    expect(doc().nodes[w].parent).toBe(frame)
    expect(st(w).width).toBe('fit-content')
    expect(st(w).height).toBe('fit-content')
    expect(st(w).display).toBe('flex')
    expect([...doc().nodes[w].children].sort()).toEqual([text, rect].sort())
    for (const c of [text, rect]) expect(st(c).position).not.toBe('absolute')
  })

  it('a single text gets a hugging wrapper too, and one undo removes it', () => {
    const { frame, text } = fixedFrame()
    const kids = [...doc().nodes[frame].children]
    const w = S().wrapInFlex(id, [text]) as string
    expect(st(w).width).toBe('fit-content')
    expect(st(w).height).toBe('fit-content')
    S().undo(id)
    expect(doc().nodes[w]).toBeUndefined()
    expect(doc().nodes[frame].children).toEqual(kids)
  })
})

describe('what stays as it was', () => {
  it('Add grid keeps its own settings', () => {
    const { frame } = fixedFrame()
    S().mutate(id, 'grid', (d) => ops.addGrid(d, frame))
    expect(st(frame)).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, padding: '16px' })
    expect(st(frame).width).toBe(380)
  })

  it('frames from the Frame tool, Group and Frame selection stay fixed-size', () => {
    expect(ops.defaultStyle('frame')).toMatchObject({ width: 380, height: 380 })
    const d = ops.makeDoc('d', 'x')
    const r = d.pages[0].rootId
    const a = ops.makeNode(d, { type: 'rect' })
    ops.insertNode(d, a, r)
    const rects = new Map([[a.id, { x: 0, y: 0, width: 100, height: 100 }]])
    for (const kind of ['Group', 'Frame'] as const) {
      const w = ops.wrapNodes(d, [a.id], kind, rects, { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0 }) as string
      expect(d.nodes[w].style.width).toBe(100)
      expect(d.nodes[w].style.height).toBe(100)
      expect(d.nodes[w].style.display).toBeUndefined()
      // put the rect back for the next round
      d.nodes[r].children = d.nodes[r].children.filter((c) => c !== w)
      d.nodes[a.id].parent = r
      d.nodes[r].children.push(a.id)
    }
  })
})
