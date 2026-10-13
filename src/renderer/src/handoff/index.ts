// Handoff bundle writer (T62 / H3): `buildHandoff(doc, options)` turns a document and options into a map of
// bundle-relative path -> text. Pure: no clock, no I/O, no store; the same input gives the same bytes.
// H4 adds the image/PNG bytes behind the paths listed here, H5 writes the map to disk through the main process.
import type { Doc } from '../model/types'
import { formatNumber } from '../model/devSpec'
import { collect, walkSpec } from './collect'
import { fontsMd, handoffMd, handoffState } from './handoffMd'
import { componentMarkdown, fractionalIn, screenMarkdown, type MarkdownContext } from './markdown'
import { assertSafePaths } from './paths'
import { buildSpec, jsonText, SPEC_SCHEMA } from './specJson'
import { tailwindCss, tokensCss, tokensJson } from './tokens'
import type { HandoffOptions, HandoffResult, HandoffSummary } from './types'

export type { AssetRecord, FontSource, HandoffOptions, HandoffResult, HandoffSpec, HandoffSummary } from './types'
export { SCHEMA_ID } from './types'
export { SPEC_SCHEMA } from './specJson'
export { selectFrames, topLevelFrames } from './collect'

export function buildHandoff(doc: Doc, options: HandoffOptions): HandoffResult {
  const c = collect(doc, options)
  const spec = buildSpec(doc, options, c)
  const files: Record<string, string> = {}

  const ctx: MarkdownContext = { rem: Boolean(options.rem), assets: c.assets, screens: c.screens, components: c.components }
  for (const s of c.screens) files[`screens/${s.slug}.md`] = screenMarkdown(s, ctx)
  for (const comp of c.components) files[`components/${comp.slug}.md`] = componentMarkdown(comp, ctx)
  files['tokens/tokens.css'] = tokensCss(doc, c.tokens)
  files['tokens/tokens.json'] = tokensJson(c.tokens, c.modes)
  files['tokens/tailwind.css'] = tailwindCss(c.tokens, c.modes)
  files['fonts.md'] = fontsMd(c)
  files['spec.json'] = jsonText(spec)
  files['spec.schema.json'] = jsonText(SPEC_SCHEMA)
  files['.handoff.json'] = handoffState(spec)

  let notes = 0
  let needsDecision = 0
  let fractional = 0
  let breakpoints = 0
  const contrastFails: string[] = []
  const noAlt: string[] = []
  const check = (n: Parameters<typeof walkSpec>[1] extends (x: infer T) => void ? T : never, where: string): void => {
    const add = (list: string[], text: string): void => void (list.includes(text) ? undefined : list.push(text))
    for (const r of n.contrast ?? []) if (!r.aa) add(contrastFails, `"${n.name}" in ${where} (${r.mode}) ${formatNumber(r.ratio)}:1`)
    if (n.type === 'image' && n.image?.alt === undefined) add(noAlt, `"${n.name}" in ${where}`)
  }
  for (const s of c.screens) {
    for (const b of s.breakpoints) {
      breakpoints++
      fractional += fractionalIn(b.root).length
      walkSpec(b.root, (n) => {
        notes += n.notes?.length ?? 0
        if (n.needsDecision) needsDecision++
        check(n, s.name)
      })
    }
  }
  for (const comp of c.components) {
    notes += comp.notes.length
    for (const v of comp.variants)
      walkSpec(v.root, (n) => {
        if (n.needsDecision) needsDecision++
        check(n, comp.name)
      })
  }
  const summary: HandoffSummary = {
    screens: c.screens.length,
    breakpoints,
    nodes: c.nodes,
    components: c.components.length,
    tokens: c.tokens.length,
    textStyles: c.textStyles.length,
    assets: c.assets.length,
    fonts: c.fonts.length,
    notes,
    needsDecision,
    fractional,
    skippedHidden: c.skippedHidden,
    unmeasured: c.unmeasured,
    contrastFailures: new Set(contrastFails.map((f) => f.replace(/ \([^)]*\) [\d.]+:1$/, ''))).size,
    imagesWithoutAlt: noAlt.length
  }

  const warnings = [...c.warnings, ...(options.warnings ?? [])]
  if (fractional) warnings.push(`${fractional} node${fractional === 1 ? ' has' : 's have'} a fractional size: build with the layout rule, not the number.`)
  const limited = (list: string[]): string => `${list.slice(0, 8).join('; ')}${list.length > 8 ? `; and ${list.length - 8} more` : ''}`
  if (contrastFails.length) warnings.push(`Text contrast below WCAG AA: ${limited(contrastFails)}.`)
  if (noAlt.length) warnings.push(`Images without alt text (set it, or an empty alt when decorative): ${limited(noAlt)}.`)
  for (const a of c.assets) if (!/^assets\//.test(a.path) && !/^screens\//.test(a.path)) warnings.push(`Asset path "${a.path}" is outside assets/ and screens/.`)

  const handoff = handoffMd(spec, { ...c, warnings }, summary, options, [...Object.keys(files), 'HANDOFF.md', 'CLAUDE.md'])
  files['HANDOFF.md'] = handoff
  files['CLAUDE.md'] = handoff

  // the planned PNG and asset paths are part of what the bundle will contain: they must be safe too
  assertSafePaths(new Set([...Object.keys(files), ...c.screens.flatMap((s) => s.breakpoints.map((b) => b.png)), ...c.assets.flatMap((a) => [a.path, ...(a.variants ?? []).map((v) => v.path)])]))

  const sorted: Record<string, string> = {}
  for (const k of Object.keys(files).sort()) sorted[k] = files[k]
  return { files: sorted, summary, warnings }
}
