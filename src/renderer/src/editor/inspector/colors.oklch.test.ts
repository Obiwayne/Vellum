// T38: Selection colors understands oklch() literals and oklch tokens.
import { describe, expect, it } from 'vitest'
import { makeDoc, makeNode, insertNode } from '../../model/ops'
import { formatColor, parseColor } from '../../ui'
import { STARTER_THEME } from '../left/starterTheme'
import { collectColors, replaceColor } from './colors'

function setup(fills: string[]) {
  const doc = makeDoc('d', 'D')
  doc.tokens = STARTER_THEME.map((t) => ({ ...t }))
  const ids = fills.map((f) => {
    const n = makeNode(doc, { type: 'rect', style: { backgroundColor: f } })
    insertNode(doc, n, doc.pages[0].rootId)
    return n.id
  })
  return { doc, ids }
}

describe('Selection colors with oklch', () => {
  it('lists an oklch literal and a token that resolves to oklch, grouped by normalised colour', () => {
    const blue = STARTER_THEME.find((t) => t.name === '--color-blue-500')!
    const hex = formatColor(parseColor(blue.value)!)
    const { doc, ids } = setup([blue.value, 'var(--color-blue-500)', hex, '#ff0000'])
    const uses = collectColors(doc, ids)
    // the literal oklch and the hex of the same colour are one group; the token keeps its own entry
    expect(uses.find((u) => u.key === hex)?.count).toBe(2)
    expect(uses.find((u) => u.key === 'var(--color-blue-500)')?.count).toBe(1)
    expect(uses.find((u) => u.key === '#FF0000')?.count).toBe(1)
    expect(uses).toHaveLength(3)
  })

  it('replacing a colour replaces its oklch spelling too, and leaves other colours alone', () => {
    const blue = STARTER_THEME.find((t) => t.name === '--color-blue-500')!
    const hex = formatColor(parseColor(blue.value)!)
    const { doc, ids } = setup([blue.value, '#ff0000'])
    replaceColor(doc, ids, hex, 'var(--color-blue-500)')
    expect(doc.nodes[ids[0]].style.backgroundColor).toBe('var(--color-blue-500)')
    expect(doc.nodes[ids[1]].style.backgroundColor).toBe('#ff0000')
  })

  it('an oklch colour inside a gradient is found too', () => {
    const { doc, ids } = setup(['linear-gradient(oklch(0.628 0.2577 29.23), oklch(0.452 0.313 264.05))'])
    const keys = collectColors(doc, ids).map((u) => u.key).sort()
    expect(keys).toEqual(['#0000FF', '#FF0000'])
  })
})
