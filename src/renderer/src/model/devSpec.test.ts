import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import * as comp from './components'
import type { CNode, Doc, WorldRect } from './types'
import {
  fractionalNodes,
  formatNumber,
  intentLine,
  isFractional,
  layoutIntent,
  nodeSpec,
  round,
  sizeRule,
  substituteVars,
  tokenUse,
  toRem,
  type NodeSpec
} from './devSpec'

function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, node, parent)
    return node
  }
  return { doc, root, add }
}

const rects = (m: Record<string, [number, number, number, number]>) => (id: string): WorldRect | null => {
  const r = m[id]
  return r ? { x: r[0], y: r[1], width: r[2], height: r[3] } : null
}

describe('round / format', () => {
  it('keeps up to 2 decimals and never rounds to integers silently', () => {
    expect(round(347.5)).toBe(347.5)
    expect(round(347.504)).toBe(347.5)
    expect(round(347.506)).toBe(347.51)
    expect(round(1.005)).toBe(1.01)
    expect(round(0.1 + 0.2)).toBe(0.3)
    expect(round(-0.001)).toBe(0)
    expect(Object.is(round(-0.001), -0)).toBe(false)
    expect(round(12)).toBe(12)
    expect(round(NaN)).toBe(0)
  })
  it('formats without trailing zeros', () => {
    expect(formatNumber(347.5)).toBe('347.5')
    expect(formatNumber(12)).toBe('12')
    expect(formatNumber(12.0)).toBe('12')
  })
  it('honours a different precision and rem conversion', () => {
    expect(round(1.23456, 3)).toBe(1.235)
    expect(round(1.23456, 0)).toBe(1)
    expect(toRem(24)).toBe('1.5rem')
    expect(toRem(20, 10)).toBe('2rem')
  })
  it('detects fractional sizes', () => {
    expect(isFractional(347.5)).toBe(true)
    expect(isFractional(100)).toBe(false)
    expect(isFractional(100.001)).toBe(false)
  })
})

describe('sizing rules', () => {
  it('fixed, fit, percent and fill in a flex parent', () => {
    const { doc, root, add } = setup()
    const row = add({ type: 'frame', style: { display: 'flex', flexDirection: 'row', width: 400, height: 'fit-content' } }, root)
    const fixed = add({ type: 'rect', style: { width: 120, height: '48px' } }, row.id)
    const fit = add({ type: 'frame', style: { width: 'fit-content', height: 'auto' } }, row.id)
    const fill = add({ type: 'frame', style: { width: '100%', height: 10 } }, row.id)
    const pct = add({ type: 'frame', style: { width: '50%', height: 10, position: 'absolute' } }, row.id)
    expect(sizeRule(doc, fixed.id, 'w')).toEqual({ mode: 'fixed', value: 120 })
    expect(sizeRule(doc, fixed.id, 'h')).toEqual({ mode: 'fixed', value: 48 })
    expect(sizeRule(doc, fit.id, 'w')).toEqual({ mode: 'fit' })
    expect(sizeRule(doc, fill.id, 'w')).toEqual({ mode: 'fill' })
    expect(sizeRule(doc, pct.id, 'w')).toEqual({ mode: 'percent', value: 50 })
    expect(sizeRule(doc, row.id, 'h')).toEqual({ mode: 'fit' })
  })

  it('flex-grow on the main axis is fill with its weight; on the cross axis it is not', () => {
    const { doc, root, add } = setup()
    const col = add({ type: 'frame', style: { display: 'flex', flexDirection: 'column', alignItems: 'start', width: 200, height: 300 } }, root)
    const grow = add({ type: 'frame', style: { width: 50, flexGrow: 2 } }, col.id)
    const shorthand = add({ type: 'frame', style: { flex: '1 1 0%' } }, col.id)
    expect(sizeRule(doc, grow.id, 'h')).toEqual({ mode: 'fill', weight: 2 })
    expect(sizeRule(doc, shorthand.id, 'h')).toEqual({ mode: 'fill' })
    expect(sizeRule(doc, grow.id, 'w')).toEqual({ mode: 'fixed', value: 50 })
  })

  it('cross-axis stretch fills; align-items start does not', () => {
    const { doc, root, add } = setup()
    const stretch = add({ type: 'frame', style: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: 100, height: 100 } }, root)
    const a = add({ type: 'frame', style: { height: 10 } }, stretch.id)
    const start = add({ type: 'frame', style: { display: 'flex', flexDirection: 'column', alignItems: 'start', width: 100, height: 100 } }, root)
    const b = add({ type: 'frame', style: { height: 10 } }, start.id)
    expect(sizeRule(doc, a.id, 'w')).toEqual({ mode: 'fill' })
    expect(sizeRule(doc, b.id, 'w')).toEqual({ mode: 'fit' })
  })

  it('min / max / aspect ride along', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: '100%', maxWidth: 480, minWidth: '120px', height: 'fit-content', aspectRatio: '16 / 9' } }, root)
    const grid = add({ type: 'frame', style: { display: 'grid' } }, root)
    const cell = add({ type: 'frame', style: { width: '100%', maxWidth: 480, minWidth: '120px' } }, grid.id)
    expect(sizeRule(doc, cell.id, 'w')).toEqual({ mode: 'fill', min: 120, max: 480 })
    expect(sizeRule(doc, f.id, 'h')).toEqual({ mode: 'fit', aspect: 1.7778 })
    // no flow parent: 100% is a percentage, not Fill
    expect(sizeRule(doc, f.id, 'w')).toEqual({ mode: 'percent', value: 100, min: 120, max: 480, aspect: 1.7778 })
  })

  it('Left & right and Scale constraints stretch the box', () => {
    const { doc, root, add } = setup()
    const parent = add({ type: 'frame', style: { width: 400, height: 300 } }, root)
    const both = add({ type: 'rect', x: 10, y: 20, style: { right: 30, width: 'auto', height: 40 } }, parent.id)
    const scale = add({ type: 'rect', x: 0, y: 0, style: { left: '10%', width: '50%', top: '0%', height: '20%' } }, parent.id)
    expect(sizeRule(doc, both.id, 'w')).toEqual({ mode: 'fill' })
    expect(sizeRule(doc, scale.id, 'w')).toEqual({ mode: 'percent', value: 50 })
    expect(sizeRule(doc, scale.id, 'h')).toEqual({ mode: 'percent', value: 20 })
  })
})

describe('layout intent', () => {
  it('flex: direction, gap, padding, align, wrap, summary line', () => {
    const { doc, root, add } = setup()
    const card = add(
      { type: 'frame', name: 'Card', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '16px', alignItems: 'start', width: '100%', maxWidth: 480, height: 'fit-content', flexWrap: 'wrap' } },
      root
    )
    const parent = add({ type: 'frame', style: { display: 'flex' } }, root)
    ops.reparent(doc, card.id, parent.id)
    const li = layoutIntent(doc, card.id)
    expect(li).toMatchObject({ kind: 'flex', direction: 'column', wrap: true, gap: 12, align: 'start', padding: [16, 16, 16, 16], overflow: 'visible' })
    expect(li.summary).toBe('Column, gap 12, wraps, padding 16')
    const spec = nodeSpec(doc, card.id)!
    expect(intentLine(spec)).toBe('Card — Column, gap 12, wraps, padding 16, width fill (max 480), height fit')
  })

  it('padding shorthand with 2, 3 and 4 values and side overrides', () => {
    const { doc, root, add } = setup()
    const a = add({ type: 'frame', style: { padding: '8px 16px' } }, root)
    const b = add({ type: 'frame', style: { padding: '1px 2px 3px' } }, root)
    const c = add({ type: 'frame', style: { padding: '1px 2px 3px 4px', paddingLeft: 9 } }, root)
    expect(layoutIntent(doc, a.id).padding).toEqual([8, 16, 8, 16])
    expect(layoutIntent(doc, b.id).padding).toEqual([1, 2, 3, 2])
    expect(layoutIntent(doc, c.id).padding).toEqual([1, 2, 3, 9])
  })

  it('separate row and column gaps', () => {
    const { doc, root, add } = setup()
    const a = add({ type: 'frame', style: { display: 'flex', gap: '8px 24px' } }, root)
    const li = layoutIntent(doc, a.id)
    expect(li.gap).toBeUndefined()
    expect(li).toMatchObject({ rowGap: 8, columnGap: 24 })
  })

  it('grid: tracks and a cell', () => {
    const { doc, root, add } = setup()
    const g = add({ type: 'frame', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, padding: '16px', gridAutoFlow: 'row' } }, root)
    const item = add({ type: 'frame', style: { gridColumn: 'span 2', width: '100%' } }, g.id)
    expect(layoutIntent(doc, g.id)).toMatchObject({ kind: 'grid', columns: 'repeat(2, minmax(0, 1fr))', gap: 16, autoFlow: 'row' })
    expect(layoutIntent(doc, item.id).cell).toEqual({ column: 'span 2' })
    expect(sizeRule(doc, item.id, 'w')).toEqual({ mode: 'fill' })
  })

  it('constraints print as pinned distances', () => {
    const { doc, root, add } = setup()
    const frame = add({ type: 'frame', style: { width: 400, height: 300 } }, root)
    const pinned = add({ type: 'rect', x: 0, y: 16, style: { left: 'auto', right: 24, width: 40, height: 40 } }, frame.id)
    const li = layoutIntent(doc, pinned.id)
    expect(li.constraints).toEqual({ h: 'right', v: 'top' })
    expect(li.offsets).toEqual({ right: 24, top: 16 })
    expect(li.summary).toBe('pinned right 24, top 16')
    const centred = add({ type: 'rect', x: 0, y: 0, style: { left: 'calc(50% - 20px)', width: 40, height: 40 } }, frame.id)
    expect(layoutIntent(doc, centred.id).constraints?.h).toBe('center')
    expect(layoutIntent(doc, centred.id).centerOffset).toEqual({ x: -20 })
    const plain = add({ type: 'rect', x: 5, y: 6, style: { width: 1, height: 1 } }, frame.id)
    expect(layoutIntent(doc, plain.id).offsets).toEqual({ left: 5, top: 6 })
  })

  it('overflow, position and z-index', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { overflow: 'hidden', position: 'relative', zIndex: 3 } }, root)
    expect(layoutIntent(doc, f.id)).toMatchObject({ overflow: 'clip', position: 'relative', zIndex: 3 })
    const s = add({ type: 'frame', style: { overflow: 'auto' } }, root)
    expect(layoutIntent(doc, s.id).overflow).toBe('scroll')
  })
})

describe('nodeSpec: box and precision', () => {
  function tree() {
    const { doc, root, add } = setup()
    const board = add({ type: 'frame', name: 'Screen', style: { width: 400, height: 300 } }, root)
    board.x = 100
    board.y = 50
    const row = add({ type: 'frame', name: 'Row', style: { display: 'flex', width: 'fit-content', height: 'fit-content', padding: 8 } }, board.id)
    row.x = 10
    row.y = 20
    const a = add({ type: 'frame', name: 'A', style: { width: 347.5, height: 52 } }, row.id)
    const b = add({ type: 'text', name: 'B', text: 'Hi', style: { fontSize: 16 } }, row.id)
    return { doc, board, row, a, b }
  }

  it('reports parent- and artboard-relative boxes, flow children carry an index instead of x/y', () => {
    const { doc, board, row, a, b } = tree()
    const measure = rects({
      [board.id]: [100, 50, 400, 300],
      [row.id]: [110, 70, 363.5, 68],
      [a.id]: [118, 78, 347.5, 52],
      [b.id]: [465.5, 78, 8, 20]
    })
    const spec = nodeSpec(doc, board.id, { measure })!
    expect(spec.box).toEqual({ x: 0, y: 0, width: 400, height: 300, relTo: 'artboard', measured: true })
    const r = spec.children[0]
    expect(r.box).toEqual({ x: 10, y: 20, width: 363.5, height: 68, relTo: 'parent', measured: true })
    expect(r.artboardBox).toEqual({ x: 10, y: 20 })
    const [ca, cb] = r.children
    expect(ca.box.x).toBeUndefined()
    expect(ca.box.width).toBe(347.5)
    expect(ca.flowIndex).toBe(0)
    expect(cb.flowIndex).toBe(1)
    expect(ca.artboardBox).toEqual({ x: 18, y: 28 })
  })

  it('lists fractional sizes', () => {
    const { doc, board, row, a, b } = tree()
    const measure = rects({ [board.id]: [0, 0, 400, 300], [row.id]: [0, 0, 363.5, 68], [a.id]: [0, 0, 347.5, 52], [b.id]: [0, 0, 8, 20] })
    const frac = fractionalNodes(nodeSpec(doc, board.id, { measure })!)
    expect(frac.map((f) => f.name).sort()).toEqual(['A', 'Row'])
    expect(frac.find((f) => f.name === 'A')).toMatchObject({ width: 347.5, height: 52 })
  })

  it('trims measured values to 2 decimals', () => {
    const { doc, board } = tree()
    const spec = nodeSpec(doc, board.id, { measure: rects({ [board.id]: [0, 0, 400.0049, 300.126] }) })!
    expect(spec.box.width).toBe(400)
    expect(spec.box.height).toBe(300.13)
  })

  it('falls back to authored sizes and model positions without a measure', () => {
    const { doc, board } = tree()
    const spec = nodeSpec(doc, board.id)!
    expect(spec.box).toMatchObject({ width: 400, height: 300, measured: false })
    expect(spec.children[0].box).toMatchObject({ x: 10, y: 20, measured: false })
    expect(spec.children[0].children[0].box.width).toBe(347.5)
  })

  it('subtracts the parent border so x/y are in the padding box', () => {
    const { doc, root, add } = setup()
    const p = add({ type: 'frame', style: { width: 100, height: 100, borderWidth: 4 } }, root)
    const c = add({ type: 'rect', x: 6, y: 6, style: { width: 10, height: 10 } }, p.id)
    const spec = nodeSpec(doc, p.id, { measure: rects({ [p.id]: [0, 0, 100, 100], [c.id]: [10, 10, 10, 10] }) })!
    expect(spec.children[0].box).toMatchObject({ x: 6, y: 6 })
  })

  it('never emits hidden layers; locked state is not in the spec; depth limits the tree', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { display: 'flex', width: 100, height: 100 } }, root)
    const shown = add({ type: 'rect', name: 'shown', style: { width: 1, height: 1 } }, f.id)
    add({ type: 'rect', name: 'secret', style: { width: 1, height: 1 } }, f.id).visible = false
    const locked = add({ type: 'rect', name: 'kept', style: { width: 1, height: 1 } }, f.id)
    locked.locked = true
    const spec = nodeSpec(doc, f.id)!
    expect(spec.children.map((c) => c.name)).toEqual(['shown', 'kept'])
    expect(JSON.stringify(spec)).not.toMatch(/secret|locked/)
    expect(spec.children[1].flowIndex).toBe(1)
    expect(nodeSpec(doc, f.id, { depth: 0 })!.children).toEqual([])
    doc.nodes[f.id].visible = false
    expect(nodeSpec(doc, f.id)).toBeNull()
    expect(nodeSpec(doc, 'nope')).toBeNull()
    expect(shown.id).toBeTruthy()
  })

  it('rotation is flagged and the box stays the measured bounds', () => {
    const { doc, root, add } = setup()
    const r = add({ type: 'rect', style: { width: 100, height: 20, rotate: '45deg' } }, root)
    const spec = nodeSpec(doc, r.id, { measure: rects({ [r.id]: [0, 0, 84.85, 84.85] }) })!
    expect(spec.rotation).toBe(45)
    expect(spec.box.width).toBe(84.85)
  })
})

describe('tokens, modes and colour', () => {
  function themed() {
    const { doc, root, add } = setup()
    doc.modes = ['Light', 'Dark']
    doc.tokens = [
      { name: '--color-primary', value: '#2563EB', modes: { Dark: '#60A5FA' } },
      { name: '--color-brand', value: 'oklch(0.6 0.2 250)' },
      { name: '--alias', value: 'var(--color-primary)', modes: { Dark: '#FFFFFF' } },
      { name: '--space-4', value: '16px' },
      { name: '--ratio', value: '1.5' }
    ]
    return { doc, root, add }
  }

  it('token uses carry each mode with hex8, nested tokens resolved', () => {
    const { doc } = themed()
    expect(tokenUse(doc, '--color-primary')).toEqual({
      name: '--color-primary',
      type: 'color',
      values: { Light: { value: '#2563EB', hex8: '#2563EBFF' }, Dark: { value: '#60A5FA', hex8: '#60A5FAFF' } }
    })
    expect(tokenUse(doc, '--alias')!.values).toEqual({
      Light: { value: '#2563EB', hex8: '#2563EBFF' },
      Dark: { value: '#FFFFFF', hex8: '#FFFFFFFF' }
    })
    expect(tokenUse(doc, '--space-4')).toMatchObject({ type: 'length' })
    expect(tokenUse(doc, '--ratio')).toMatchObject({ type: 'number' })
    expect(tokenUse(doc, '--missing')).toBeNull()
  })

  it('a document without modes has a single `base` value', () => {
    const { doc } = setup()
    doc.tokens = [{ name: '--c', value: '#ff0000' }]
    expect(tokenUse(doc, '--c')!.values).toEqual({ base: { value: '#ff0000', hex8: '#FF0000FF' } })
  })

  it('authored keeps var(), resolved uses the mode in effect', () => {
    const { doc, root, add } = themed()
    const light = add({ type: 'frame', style: { width: 10, height: 10, backgroundColor: 'var(--color-primary)', padding: 'var(--space-4)' } }, root)
    const dark = add({ type: 'frame', attrs: { 'data-mode': 'Dark' }, style: { width: 10, height: 10, backgroundColor: 'var(--color-primary)' } }, root)
    const inner = add({ type: 'rect', style: { width: 1, height: 1, backgroundColor: 'var(--color-primary)' } }, dark.id)
    const ls = nodeSpec(doc, light.id)!
    expect(ls.style.authored.backgroundColor).toBe('var(--color-primary)')
    expect(ls.style.resolved.backgroundColor).toBe('#2563EB')
    expect(ls.style.resolved.padding).toBe('16px')
    expect(ls.layout.padding).toEqual([16, 16, 16, 16])
    expect(ls.paints[0]).toMatchObject({ kind: 'fill', type: 'solid', color: { value: '#2563EB', hex8: '#2563EBFF', opacity: 1, token: '--color-primary' } })
    expect(ls.tokens.map((t) => t.name)).toEqual(['--color-primary', '--space-4'])
    const is = nodeSpec(doc, inner.id)!
    expect(is.style.resolved.backgroundColor).toBe('#60A5FA')
    expect(is.paints[0].color?.hex8).toBe('#60A5FAFF')
    // the caller can force a mode
    expect(nodeSpec(doc, inner.id, { mode: 'Light' })!.style.resolved.backgroundColor).toBe('#2563EB')
  })

  it('oklch is kept as authored with an sRGB fallback; alpha becomes opacity', () => {
    const { doc, root, add } = themed()
    const r = add({ type: 'rect', style: { width: 1, height: 1, backgroundColor: 'var(--color-brand)', borderColor: '#00000080', borderWidth: 2, borderStyle: 'solid' } }, root)
    const s = nodeSpec(doc, r.id)!
    const fill = s.paints.find((p) => p.kind === 'fill')!
    expect(fill.color?.oklch).toBe('oklch(0.6 0.2 250)')
    expect(fill.color?.hex8).toMatch(/^#[0-9A-F]{6}FF$/)
    expect(fill.color?.token).toBe('--color-brand')
    const stroke = s.paints.find((p) => p.kind === 'stroke')!
    expect(stroke).toMatchObject({ width: 2, style: 'solid' })
    expect(stroke.color?.hex8).toBe('#00000080')
    expect(stroke.color?.opacity).toBeCloseTo(0.502, 3)
  })

  it('substituteVars uses fallbacks and leaves unknown tokens', () => {
    const { doc } = themed()
    expect(substituteVars(doc, 'var(--nope, 12px)', null)).toBe('12px')
    expect(substituteVars(doc, 'var(--nope)', null)).toBe('var(--nope)')
    expect(substituteVars(doc, '1px solid var(--color-primary)', 'Dark')).toBe('1px solid #60A5FA')
  })

  it('a token cycle terminates', () => {
    const { doc } = setup()
    doc.tokens = [{ name: '--a', value: 'var(--b)' }, { name: '--b', value: 'var(--a)' }]
    expect(() => substituteVars(doc, 'var(--a)', null)).not.toThrow()
  })
})

describe('text, effects and gradients', () => {
  it('text: inherited typography, ratio and px line height, letter spacing in px and em', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 200, height: 100, fontFamily: 'Inter', color: '#111111', fontSize: 20, letterSpacing: '0.05em', lineHeight: '1.5' } }, root)
    const t = add({ type: 'text', text: 'Hello', style: { fontWeight: 600 } }, f.id)
    const spec = nodeSpec(doc, t.id)!
    expect(spec.text).toMatchObject({
      content: 'Hello',
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: 600,
      lineHeightPx: 30,
      lineHeightRatio: 1.5,
      lineHeightSource: 'authored',
      letterSpacingPx: 1,
      letterSpacingEm: 0.05
    })
    expect(spec.paints).toEqual([{ kind: 'text', type: 'solid', color: { value: '#111111', hex8: '#111111FF', opacity: 1 } }])
    const px = add({ type: 'text', text: 'a', style: { fontSize: 16, lineHeight: '20px', letterSpacing: '1px' } }, root)
    expect(nodeSpec(doc, px.id)!.text).toMatchObject({ lineHeightPx: 20, lineHeightRatio: 1.25, letterSpacingPx: 1, letterSpacingEm: 0.0625 })
  })

  it('line-height normal is resolved from the measured line box', () => {
    const { doc, root, add } = setup()
    const t = add({ type: 'text', text: 'one', style: { fontSize: 16, lineHeight: 'normal' } }, root)
    const m = nodeSpec(doc, t.id, { measure: rects({ [t.id]: [0, 0, 30, 19.36] }) })!
    expect(m.text).toMatchObject({ lineHeightPx: 19.36, lineHeightRatio: 1.21, lineHeightSource: 'estimated' })
    const t2 = add({ type: 'text', text: 'a\nb', style: { fontSize: 16, lineHeight: 'normal' } }, root)
    const m2 = nodeSpec(doc, t2.id, { measure: rects({ [t2.id]: [0, 0, 30, 38.72] }), lineCount: () => 2 })!
    expect(m2.text).toMatchObject({ lineHeightPx: 19.36, lineHeightSource: 'measured' })
    expect(nodeSpec(doc, t.id)!.text).toMatchObject({ lineHeightPx: null, lineHeightRatio: null, lineHeightSource: 'unknown' })
  })

  it('text style name and rem-sized font', () => {
    const { doc, root, add } = setup()
    doc.textStyles = [{ id: 's1', name: 'Heading/H1', style: { fontSize: 32 } }]
    const t = add({ type: 'text', text: 'T', style: { fontSize: '2rem', fontWeight: 'bold' } }, root)
    t.textStyle = 's1'
    expect(nodeSpec(doc, t.id)!.text).toMatchObject({ fontSize: 32, fontWeight: 700, textStyle: 'Heading/H1' })
  })

  it('shadows, blur, gradients, radius and opacity', () => {
    const { doc, root, add } = setup()
    const r = add(
      {
        type: 'rect',
        style: {
          width: 10,
          height: 10,
          boxShadow: '0px 4px 12px 0px rgba(0,0,0,0.25), inset 0 1px 0 #ffffff',
          filter: 'blur(4px)',
          backdropFilter: 'blur(8px)',
          backgroundImage: 'linear-gradient(90deg, #000, #fff)',
          borderRadius: '8px 8px 0 0',
          opacity: 0.5
        }
      },
      root
    )
    const s = nodeSpec(doc, r.id)!
    expect(s.effects).toMatchObject([
      { kind: 'shadow', x: 0, y: 4, blur: 12, spread: 0 },
      { kind: 'inner-shadow', x: 0, y: 1, blur: 0 },
      { kind: 'blur', blur: 4 },
      { kind: 'backdrop-blur', blur: 8 }
    ])
    expect(s.effects[0].color?.hex8).toBe('#00000040')
    expect(s.paints[0]).toMatchObject({ kind: 'fill', type: 'gradient', value: 'linear-gradient(90deg, #000, #fff)' })
    expect(s.radius).toEqual([8, 8, 0, 0])
    expect(s.opacity).toBe(0.5)
  })

  it('image fills do not copy data URLs', () => {
    const { doc, root, add } = setup()
    const r = add({ type: 'rect', style: { width: 1, height: 1, backgroundImage: 'url(data:image/png;base64,AAAA)' } }, root)
    expect(nodeSpec(doc, r.id)!.paints[0]).toEqual({ kind: 'fill', type: 'image', value: 'data-url' })
    const img = add({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Logo' }, style: { width: 1, height: 1, objectFit: 'cover' } }, root)
    const s = nodeSpec(doc, img.id)!
    expect(s.image).toEqual({ alt: 'Logo', objectFit: 'cover' })
    expect(JSON.stringify(s)).not.toContain('AAAA')
  })
})

describe('components', () => {
  it('instances reference the main with variant, props and override keys', () => {
    const { doc, root, add } = setup()
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 100 } }, root)
    add({ type: 'text', text: 'Title', style: {} }, card.id)
    comp.createComponent(doc, card.id)
    const inst = comp.createInstance(doc, card.id, root)
    doc.nodes[inst].instance!.props = { Label: 'Buy' }
    const spec = nodeSpec(doc, inst)!
    expect(spec.component).toEqual({ ref: card.id, name: 'Card', props: { Label: 'Buy' } })
    expect(spec.children[0].text?.content).toBe('Title')
    expect(nodeSpec(doc, card.id)!.component).toBeUndefined()
  })
})

describe('determinism and shape', () => {
  it('is pure: same input, same JSON; the doc is untouched', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { display: 'flex', gap: 8, width: 100, height: 'fit-content' } }, root)
    add({ type: 'rect', style: { width: 10, height: 10, backgroundColor: '#fff' } }, f.id)
    const before = JSON.stringify(doc)
    const a = JSON.stringify(nodeSpec(doc, f.id))
    const b = JSON.stringify(nodeSpec(doc, f.id))
    expect(a).toBe(b)
    expect(JSON.stringify(doc)).toBe(before)
    const spec: NodeSpec = JSON.parse(a)
    expect(Object.keys(spec).sort()).toEqual(
      ['box', 'children', 'effects', 'id', 'layout', 'name', 'paints', 'sizing', 'style', 'tokens', 'type'].sort()
    )
  })

  it('works on a doc loaded without nodes of the kind it never uses', () => {
    const doc: Doc = ops.makeDoc('x', 'X')
    expect(nodeSpec(doc, doc.pages[0].rootId)).not.toBeNull()
  })
})
