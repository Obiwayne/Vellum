// Colour styles in colour fields: listing order and Detach resolving in the theme mode at the layer.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { colourStylesFirst, resolveTokenInMode, resolveTokenValue } from './ColorInput'

const S = getStore
let id: string

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
})

describe('colourStylesFirst', () => {
  it('puts --color-* tokens before other colour tokens, keeping order', () => {
    const t = (name: string) => ({ name, value: '#000000' })
    const out = colourStylesFirst([t('--bg'), t('--color-b'), t('--accent'), t('--color-a')])
    expect(out.map((x) => x.name)).toEqual(['--color-b', '--color-a', '--bg', '--accent'])
  })
})

describe('resolveTokenInMode', () => {
  it('detach value follows the mode in effect, falling back to base', () => {
    S().addMode(id, 'Dark')
    S().upsertTokens(id, [
      { name: '--color-ink', value: '#111111', modes: { Dark: '#eeeeee' } },
      { name: '--color-alias', value: 'var(--color-ink)' },
      { name: '--color-flat', value: '#abcdef' }
    ])
    const doc = S().docs[id]
    expect(resolveTokenInMode(doc, '--color-ink', null)).toBe('#111111')
    expect(resolveTokenInMode(doc, '--color-ink', 'Light')).toBe('#111111')
    expect(resolveTokenInMode(doc, '--color-ink', 'Dark')).toBe('#eeeeee')
    expect(resolveTokenInMode(doc, '--color-alias', 'Dark')).toBe('#eeeeee')
    expect(resolveTokenInMode(doc, '--color-flat', 'Dark')).toBe('#abcdef')
    expect(resolveTokenInMode(doc, '--missing', 'Dark')).toBeUndefined()
    expect(resolveTokenValue(doc.tokens, '--color-ink')).toBe('#111111')
  })
})
