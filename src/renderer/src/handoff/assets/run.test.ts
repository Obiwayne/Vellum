import { describe, expect, it } from 'vitest'
import { markMissing, planScreenPngs, runAssetJobs, type AssetEngine, type PngJob } from './run'
import type { ResizeJob } from './plan'

const job = (path: string): ResizeJob => ({ path, from: new Uint8Array([1, 2, 3]), mime: 'image/png', width: 10, height: 10, quality: 0.9 })

function engine(over: Partial<AssetEngine> = {}): AssetEngine & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async resize(j) {
      calls.push(`resize ${j.path}`)
      return new Uint8Array([9, 9])
    },
    async renderPng(id, scale) {
      calls.push(`png ${id}@${scale}`)
      return new Uint8Array([8])
    },
    ...over
  }
}

describe('runAssetJobs', () => {
  it('runs one job at a time in order and reports progress', async () => {
    const e = engine()
    const seen: string[] = []
    const pngs: PngJob[] = [{ path: 'screens/a.png', frameId: 'f1', scale: 1 }]
    const r = await runAssetJobs({ jobs: [job('assets/images/a@2x.png'), job('assets/images/b@2x.png')] }, pngs, e, { onProgress: (p) => seen.push(`${p.done}/${p.total}`) })
    expect(e.calls).toEqual(['resize assets/images/a@2x.png', 'resize assets/images/b@2x.png', 'png f1@1'])
    expect(Object.keys(r.files)).toEqual(['assets/images/a@2x.png', 'assets/images/b@2x.png', 'screens/a.png'])
    expect(seen).toEqual(['0/3', '1/3', '2/3', '3/3'])
    expect(r.warnings).toEqual([])
  })

  it('a failing job is a warning and a missing path, the rest still run', async () => {
    const e = engine({
      async resize(j) {
        if (j.path.includes('bad')) throw new Error('boom')
        return new Uint8Array([1])
      }
    })
    const r = await runAssetJobs({ jobs: [job('x/bad@2x.png'), job('x/ok@2x.png')] }, [], e)
    expect(Object.keys(r.files)).toEqual(['x/ok@2x.png'])
    expect(r.missing).toEqual(['x/bad@2x.png'])
    expect(r.warnings[0]).toContain('boom')
  })

  it('an empty result counts as a failure', async () => {
    const r = await runAssetJobs({ jobs: [job('x/a@2x.png')] }, [], engine({ resize: async () => new Uint8Array() }))
    expect(r.missing).toEqual(['x/a@2x.png'])
  })

  it('abort stops before the next job and says how many were not produced', async () => {
    const ctrl = new AbortController()
    const e = engine({
      async resize(j) {
        if (j.path.includes('first')) ctrl.abort()
        return new Uint8Array([1])
      }
    })
    const r = await runAssetJobs({ jobs: [job('first@2x.png'), job('second@2x.png'), job('third@2x.png')] }, [], e, { signal: ctrl.signal })
    expect(Object.keys(r.files)).toEqual(['first@2x.png'])
    expect(r.missing).toEqual(['second@2x.png', 'third@2x.png'])
    expect(r.warnings.join(' ')).toContain('cancelled')
  })
})

describe('planScreenPngs', () => {
  const spec = JSON.stringify({ screens: [{ breakpoints: [{ frameId: 'a', png: 'screens/home.desktop.png' }, { frameId: 'b', png: 'screens/home.mobile.png' }] }] })
  it('one png per breakpoint, and an @2x only on request', () => {
    expect(planScreenPngs(spec).map((j) => [j.path, j.scale])).toEqual([
      ['screens/home.desktop.png', 1],
      ['screens/home.mobile.png', 1]
    ])
    expect(planScreenPngs(spec, true).map((j) => j.path)).toEqual([
      'screens/home.desktop.png',
      'screens/home.desktop@2x.png',
      'screens/home.mobile.png',
      'screens/home.mobile@2x.png'
    ])
  })
})

describe('markMissing', () => {
  it('flags the record whose file is gone and drops variants that are missing', () => {
    const recs = [{ id: 'i', path: 'a.png', kind: 'image' as const, nodeIds: [], variants: [{ path: 'a@2x.png', density: 2, width: 2, height: 2 }] }]
    expect(markMissing(recs, ['a@2x.png'])[0].variants).toBeUndefined()
    expect(markMissing(recs, ['a.png'])[0].missing).toBe(true)
    expect(markMissing(recs, [])).toBe(recs)
  })
})
