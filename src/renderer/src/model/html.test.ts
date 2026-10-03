// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlToNodes, parseInlineStyle } from './html'
import { makeDoc } from './ops'

const parse = (html: string, topLevel = false) => {
  const doc = makeDoc('d', 'Test')
  const roots = htmlToNodes(html, doc, { topLevel })
  return { doc, roots, nodes: roots.map((id) => doc.nodes[id]) }
}

describe('parseInlineStyle', () => {
  it('camel-cases props, keeps units, turns px width/height and bare numbers into numbers', () => {
    const s = parseInlineStyle('background-color: red; width: 100px; opacity: 0.5; padding: 4px 8px')
    expect(s).toMatchObject({ backgroundColor: 'red', width: 100, opacity: 0.5, padding: '4px 8px' })
  })

  it('does not split on ; inside url() or quotes', () => {
    expect(parseInlineStyle('background: url("data:image/png;base64,AAA"); color: blue')).toMatchObject({ color: 'blue' })
  })
})

describe('htmlToNodes', () => {
  it('converts a text-only element to a text node', () => {
    const { nodes } = parse('<p>Hello  world</p>')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('text')
    expect(nodes[0].text).toBe('Hello world')
  })

  it('converts nested elements to a frame with children linked to it', () => {
    const { doc, nodes } = parse('<div style="display:flex"><span>A</span><img src="a.png" alt="Pic"></div>')
    const frame = nodes[0]
    expect(frame.type).toBe('frame')
    expect(frame.children).toHaveLength(2)
    const kids = frame.children.map((id) => doc.nodes[id])
    expect(kids.map((k) => k.type)).toEqual(['text', 'image'])
    expect(kids.every((k) => k.parent === frame.id)).toBe(true)
    expect(kids[1].name).toBe('Pic')
  })

  it('makes a block container with block children a flex column', () => {
    const { nodes } = parse('<div><div><h1>A</h1></div><div>B</div></div>')
    expect(nodes[0].style).toMatchObject({ display: 'flex', flexDirection: 'column' })
  })

  it('takes left/top as x/y for top-level roots', () => {
    const { nodes } = parse('<div style="position:absolute;left:40px;top:12px;width:200px">x</div>', true)
    expect(nodes[0]).toMatchObject({ x: 40, y: 12 })
    expect(nodes[0].style.left).toBeUndefined()
    expect(nodes[0].style.position).toBeUndefined()
  })

  it('keeps position:absolute children placed by x/y', () => {
    const { doc, nodes } = parse('<div><div style="position:absolute;left:5px;top:6px">a</div></div>')
    const kid = doc.nodes[nodes[0].children[0]]
    expect(kid).toMatchObject({ x: 5, y: 6 })
    expect(kid.style.position).toBe('absolute')
  })

  it('drops script/style tags and strips script from svg and links', () => {
    const { doc, roots } = parse(
      '<script>alert(1)</script><style>a{}</style><a href="javascript:alert(1)">x</a><svg viewBox="0 0 10 10"><script>bad()</script><circle r="2" onclick="x()"/></svg>'
    )
    const all = roots.map((id) => doc.nodes[id])
    expect(all.some((n) => n.type === 'svg')).toBe(true)
    const svg = all.find((n) => n.type === 'svg')!
    expect(svg.svg).not.toMatch(/script|onclick/i)
    expect(svg.svg).toContain('circle')
    const link = all.find((n) => n.type !== 'svg')!
    expect(JSON.stringify(link.attrs ?? {})).not.toContain('javascript:')
  })

  it('sizes an svg from its viewBox when width/height are missing', () => {
    const { nodes } = parse('<svg viewBox="0 0 30 20"><rect width="1" height="1"/></svg>')
    expect(nodes[0].style).toMatchObject({ width: 30, height: 20 })
  })
})
