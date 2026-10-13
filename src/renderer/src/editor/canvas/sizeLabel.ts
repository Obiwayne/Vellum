// "Fit 120 × Fill 40": the size text of a layer, with the sizing rule in words (the size badge under a selection,
// and the size chip of a hovered layer in Dev Mode).
import type { CNode, WorldRect } from '../../model/types'

function dimLabel(v: string | number | undefined, measured: number): string {
  const m = Math.round(measured * 100) / 100
  const txt = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')
  if (v === undefined || v === 'fit-content' || v === 'auto' || v === 'max-content' || v === 'min-content') return `Fit ${txt}`
  if (v === '100%' || v === 'stretch') return `Fill ${txt}`
  return txt
}

export function sizeBadgeText(nodes: CNode[], rect: WorldRect): string {
  if (nodes.length === 1) {
    const n = nodes[0]
    return `${dimLabel(n.style.width, rect.width)} × ${dimLabel(n.style.height, rect.height)}`
  }
  return `${dimLabel(0, rect.width)} × ${dimLabel(0, rect.height)}`
}
