// CHANGES.md: what to rebuild after a new hand-off (docs/factory/T58-plan.md section 9). Rebuild list first, then per
// changed screen and component the layers that differ as `layer path: property: old → new`, then tokens and assets.
// Every name and value from the document goes through `inline`.
import type { ChangeSet, NodeChange } from './diff'
import { inline } from './markdown'

const q = (s: string): string => inline(s)

function nodeLines(n: NodeChange, out: string[]): void {
  if (n.kind === 'added') {
    out.push(`- ${q(n.path)}: **added**${n.descendants ? ` (with ${n.descendants} layer${n.descendants === 1 ? '' : 's'} inside)` : ''}`)
    return
  }
  if (n.kind === 'removed') {
    out.push(`- ${q(n.path)}: **removed**${n.descendants ? ` (with ${n.descendants} layer${n.descendants === 1 ? '' : 's'} inside)` : ''}`)
    return
  }
  out.push(`- ${q(n.path)}`)
  for (const c of n.changes) out.push(`  - ${q(c.property)}: ${q(c.from)} → ${q(c.to)}`)
}

export function changesMd(c: ChangeSet, version: number): string {
  const o: string[] = [`# Changes since handoff v${c.previous}`, '', `This is handoff v${version}. Rebuild only what is listed; leave the rest as it is.`, '']
  const rebuild = c.rebuild.length ? c.rebuild.map(q).join(', ') : 'nothing'
  o.push(`**Rebuild only these:** ${rebuild}.`, '')
  const same = [...c.screens.filter((s) => s.status === 'unchanged').map((s) => s.name), ...c.components.filter((x) => x.status === 'unchanged').map((x) => `${x.name} (component)`)]
  o.push(`**Unchanged:** ${same.length ? same.map(q).join(', ') : 'none'}.`, '')
  const gone = [...c.screens.filter((s) => s.status === 'removed').map((s) => s.name), ...c.components.filter((x) => x.status === 'removed').map((x) => `${x.name} (component)`)]
  if (gone.length) o.push(`**Removed:** ${gone.map(q).join(', ')}. Delete them from the build.`, '')

  const screens = c.screens.filter((s) => s.status === 'added' || s.status === 'changed')
  if (screens.length) {
    o.push('## Screens', '')
    for (const s of screens) {
      o.push(`### ${q(s.name)}: ${s.status}`, '')
      if (s.status === 'added') o.push('New screen: build it from its spec.', '')
      else {
        for (const n of s.nodes) nodeLines(n, o)
        o.push('')
      }
    }
  }
  const comps = c.components.filter((x) => x.status === 'added' || x.status === 'changed')
  if (comps.length) {
    o.push('## Components', '')
    for (const x of comps) {
      o.push(`### ${q(x.name)}: ${x.status}`, '')
      if (x.status === 'added') o.push('New component: build it from its spec.', '')
      else {
        for (const n of x.nodes) nodeLines(n, o)
        o.push('')
      }
    }
  }
  if (c.tokens.length) {
    o.push('## Tokens', '')
    for (const t of c.tokens) o.push(`- ${t.status}: ${q(t.text)}`)
    o.push('')
  }
  if (c.assets.length) {
    o.push('## Assets', '')
    for (const a of c.assets) o.push(`- ${a.status}: ${q(a.path)}`)
    o.push('')
  }
  if (!screens.length && !comps.length && !c.tokens.length && !c.assets.length && !gone.length) {
    o.push('Nothing changed. Export again only to refresh the renders.', '')
  }
  return o.join('\n').replace(/\n+$/, '\n')
}
