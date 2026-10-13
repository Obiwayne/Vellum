// HANDOFF.md (also written as CLAUDE.md, byte for byte) and fonts.md. The text follows T58 plan section 3.2:
// the quick-start box first, then a fixed template filled with the facts of this bundle. It only names files
// that exist in the bundle.
import type { Handoff, HandoffSummary } from './types'
import { textStylesMarkdown } from './markdown'

const inline = (s: string): string => s.replace(/\s+/g, ' ').replace(/[`|]/g, "'").trim()

export interface HandoffMdInput {
  spec: Handoff
  summary: HandoffSummary
  warnings: string[]
  /** paths in the finished bundle (without HANDOFF.md/CLAUDE.md themselves) */
  files: string[]
  renders: boolean
  rem: boolean
  needsDecision: Array<{ screen: string; node: string; id: string; text: string }>
  fractionalByScreen: Array<{ screen: string; count: number; example: string }>
  imagesWithoutAlt: number
}

export function handoffMarkdown(i: HandoffMdInput): string {
  const { spec, summary } = i
  const has = (p: string): boolean => i.files.includes(p)
  const first = spec.screens[0]
  const label = inline(spec.handoff.fileName)
  const L: string[] = []

  L.push("> ## Andy's quick start")
  L.push('> 1. Drop this folder next to your repo (outside it is fine; nothing here runs).')
  L.push(`> 2. Tell Claude Code: "build ${first ? first.doc : 'screens/<screen>.md'} from this handoff".`)
  L.push(
    i.renders
      ? `> 3. Verify the result against the PNGs in screens/. Handoff v${spec.handoff.version}, ${summary.screens} screen${summary.screens === 1 ? '' : 's'}.`
      : `> 3. Verify the result against the numbers and layout rules in screens/. Handoff v${spec.handoff.version}, ${summary.screens} screen${summary.screens === 1 ? '' : 's'}.`
  )
  L.push('')
  L.push(`# ${label} — design handoff v${spec.handoff.version}`, '')
  L.push(
    `Exported ${spec.handoff.exportedAt} with Vellum ${inline(spec.handoff.vellum)}. ` +
      `${summary.screens} screen${summary.screens === 1 ? '' : 's'} (${summary.breakpoints} breakpoint${summary.breakpoints === 1 ? '' : 's'}), ` +
      `${summary.components} component${summary.components === 1 ? '' : 's'}, ${summary.tokens} token${summary.tokens === 1 ? '' : 's'}, ${summary.nodes} nodes.`
  )
  L.push('', '## How to build from this bundle', '')
  L.push('1. **Read order.** This file, then:')
  const order: string[] = []
  if (has('tokens/tokens.css')) order.push('`tokens/` (`tokens.css` is the truth; `tokens.json` is the same data in the W3C design-token format; `tailwind.css` is a Tailwind v4 `@theme` block)')
  if (spec.components.length) order.push('`components/*.md` (definitions, variants, properties and states)')
  if (spec.screens.length) order.push('`screens/*.md` (one per screen)')
  if (has('fonts.md')) order.push('`fonts.md` (families, weights, licences)')
  order.push('`spec.json` for exact data (`spec.schema.json` describes it)')
  order.forEach((o, n) => L.push(`   ${n + 1}. ${o}`))
  L.push(
    '2. **Stack-neutral rules.** Build with the project\'s own framework and conventions. Map tokens to the project\'s theme (the values in `tokens.css` are the truth, the names are suggestions). Reuse existing components before creating new ones. Never hard-code a value that has a token.'
  )
  L.push(
    '3. **Layout rules.** Honour the layout intent on every node (flex or grid, gap, padding, Fixed / Fit / Fill, min and max, pinned edges). Never convert intent into absolute pixel positions. The px values describe the size at design time; for a box that can grow, the rule wins.'
  )
  L.push(
    i.renders
      ? '4. **Verify.** Render each screen at its design width and compare with the PNG in `screens/`. Tolerance: ±0.5px for layout (values are written with up to 2 decimals, trailing zeros trimmed), text on the same line breaks, colours exact. List what differs; do not tweak the design silently.'
      : '4. **Verify.** Render each screen at its design width and compare sizes and positions with `screens/*.md`. Tolerance: ±0.5px for layout (values are written with up to 2 decimals, trailing zeros trimmed), text on the same line breaks, colours exact. This bundle has no reference renders. List what differs; do not tweak the design silently.'
  )
  L.push('5. **Ask or flag.** Anything marked `needs-decision` or `note` goes into the PR description; do not invent an answer.')
  L.push(
    has('CHANGES.md')
      ? '6. **Updating.** Read `CHANGES.md` first and rebuild only what it lists.'
      : '6. **Updating.** This is the first handoff of this file; a later bundle will list what changed.'
  )
  if (i.rem) L.push('', 'Lengths are shown in px with rem beside them (base 16).')

  L.push('', '## Screens', '')
  for (const s of spec.screens) {
    L.push(`- [${inline(s.name)}](${s.doc}) — ${s.breakpoints.map((b) => `${inline(b.name)} ${b.width}px`).join(', ')}${s.ready ? ` · ready in v${s.ready.at}` : ''}`)
  }
  if (!spec.screens.length) L.push('- none')
  if (spec.components.length) {
    L.push('', '## Components', '')
    for (const c of spec.components) L.push(`- [${inline(c.name)}](${c.doc}) — ${c.set ? `${c.variants.length} variants` : 'single'}`)
  }
  const ts = textStylesMarkdown(spec.textStyles)
  if (ts.length) L.push('', ...ts)

  if (i.fractionalByScreen.length) {
    L.push('', '## Notes on sizing', '')
    for (const f of i.fractionalByScreen) L.push(`- ${inline(f.screen)}: ${f.count} node${f.count === 1 ? ' has' : 's have'} fractional sizes (e.g. ${f.example}); build with the rule, not the number.`)
  }
  if (i.needsDecision.length) {
    L.push('', '## Open questions (needs-decision)', '')
    for (const q of i.needsDecision) L.push(`- ${inline(q.screen)} › ${inline(q.node)} \`${q.id}\`: ${inline(q.text)}`)
  }
  const warn = [...i.warnings]
  if (i.imagesWithoutAlt) warn.push(`${i.imagesWithoutAlt} image${i.imagesWithoutAlt === 1 ? ' has' : 's have'} no alt text; treat as decorative only if the design says so.`)
  if (warn.length) {
    L.push('', '## Warnings', '')
    for (const w of warn) L.push(`- ${inline(w)}`)
  }
  return `${L.join('\n')}\n`
}

const LICENCE: Record<string, string> = {
  google: 'Google Font: SIL OFL or Apache 2.0 depending on the family; check https://fonts.google.com/specimen/<Name>. Not bundled.',
  local: 'Installed on the designer\'s PC, not bundled and not redistributable: license it or choose a substitute.',
  system: 'System font stack: nothing to install.'
}

export function fontsMarkdown(spec: Handoff): string {
  const L = ['# Fonts', '', 'Families, weights and styles actually used by the exported screens. Font files are not included.', '']
  if (!spec.fonts.length) L.push('No text is used by the exported frames.')
  else {
    L.push('| Family | Weights | Italic | Source | Used by | Licence |', '| --- | --- | --- | --- | --- | --- |')
    for (const f of spec.fonts) {
      L.push(`| ${inline(f.family)} | ${f.weights.join(', ')} | ${f.italic ? 'yes' : 'no'} | ${f.source} | ${f.usedBy} text node${f.usedBy === 1 ? '' : 's'} | ${LICENCE[f.source].replace('<Name>', encodeURIComponent(f.family))} |`)
    }
    L.push('', '## CSS stacks', '')
    for (const f of spec.fonts) L.push(`- ${inline(f.family)}: \`${inline(f.css)}\``)
  }
  return `${L.join('\n')}\n`
}
