import { describe, expect, it } from 'vitest'
import { diffDocs, type DiffableDoc } from './docDiff'

const doc = (name: string): DiffableDoc => ({ name, pages: [{ id: 'p1', name: 'Page 1', rootId: 'r' }], nodes: {}, tokens: [] })

describe('diffDocs', () => {
  it('returns an empty diff when there is no earlier state', () => {
    const d = diffDocs(null, doc('A'))
    expect(d.added).toEqual([])
    expect(d.renamed).toBeUndefined()
  })

  it('reports a renamed doc', () => {
    expect(diffDocs(doc('A'), doc('B')).renamed).toEqual({ from: 'A', to: 'B' })
  })
})
