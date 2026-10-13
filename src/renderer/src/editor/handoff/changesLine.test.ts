// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { changesLine } from './ExportHandoffDialog'

const counts = (over: Partial<Record<'added' | 'removed' | 'changed' | 'unchanged', number>> = {}) => ({ added: 0, removed: 0, changed: 0, unchanged: 0, ...over })

describe('the dialog\'s diff line', () => {
  it('says what CHANGES.md will say: counts, token and asset changes, the rebuild list', () => {
    expect(changesLine({ previous: 3, counts: counts({ changed: 1, added: 1, unchanged: 18 }), rebuild: ['Checkout', 'Settings'], tokens: 2, assets: 0 })).toBe(
      'Since v3: 1 changed, 1 added, 18 unchanged, 2 token changes. Rebuild: Checkout, Settings.'
    )
  })

  it('says so when nothing changed, and cuts a long rebuild list', () => {
    expect(changesLine({ previous: 1, counts: counts({ unchanged: 4 }), rebuild: [], tokens: 0, assets: 0 })).toBe('Since v1: 4 unchanged. Nothing to rebuild.')
    const long = ['A', 'B', 'C', 'D', 'E', 'F']
    expect(changesLine({ previous: 2, counts: counts({ changed: 6 }), rebuild: long, tokens: 0, assets: 1 })).toBe(
      'Since v2: 6 changed, 0 unchanged, 1 asset change. Rebuild: A, B, C, D and 2 more.'
    )
  })
})
