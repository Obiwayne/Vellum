// Handoff bundle writer (T58 plan H3, T62): `buildHandoff(doc, options)` turns the chosen frames of a document
// into a map of bundle-relative path -> text. Pure: no filesystem, no DOM, no network, no clock; the measure
// callback, version and timestamp are supplied by the caller. Writing the map to disk is H5; PNGs and image
// bytes are H4 (their paths are reserved and listed in spec.json).
import type { Doc } from '../types'
import { PathRegistry, assertSafePath } from './paths'
import { resolveScope } from './scope'
import { buildSpec } from './spec'
import { SPEC_SCHEMA } from './schema'
import { tailwindCss, tokensCss, tokensJson } from './tokens'
import { componentMarkdown, screenMarkdown, type MdOptions } from './markdown'
import { fontsMarkdown, handoffMarkdown } from './handoffMd'
import { sha256 } from './hash'
import { STATE_SCHEMA_ID, type HandoffNode, type HandoffOptions, type HandoffResult, type HandoffSummary } from './types'

export * from './types'
export { assertSafePath, slug, PathRegistry } from './paths'
export { SPEC_SCHEMA } from './schema'
export { sha256 } from './hash'

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`
const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*[;,]/i

export class HandoffSafetyError extends Error {}

/** A final gate over the finished map: nothing may leave a path-escaping name, a data URL or the thumbnail. */
function assertSafe(doc: Doc, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    assertSafePath(path)
    if (DATA_URL.test(text)) throw new HandoffSafetyError(`${path} contains an embedded data URL`)
    if (doc.thumbnail && text.includes(doc.thumbnail)) throw new HandoffSafetyError(`${path} contains the file thumbnail`)
  }
}

function walkNodes(n: HandoffNode, fn: (n: HandoffNode) => void): void {
  fn(n)
  n.children.forEach((c) => walkNodes(c, fn))
}

/**
 * Build the bundle for `options.frames` (top-level frame ids). Deterministic: the same document and options
 * give the same bytes however the document's maps are ordered.
 */
export function buildHandoff(doc: Doc, options: HandoffOptions): HandoffResult {
  const scope = resolveScope(doc, options)
  const reg = new PathRegistry()
  for (const fixed of ['HANDOFF.md', 'CLAUDE.md', 'spec.json', 'spec.schema.json', 'fonts.md', '.handoff.json', 'tokens/tokens.css', 'tokens/tokens.json', 'tokens/tailwind.css', 'CHANGES.md']) reg.reserve(fixed)
  const built = buildSpec(doc, scope, options, reg)
  const spec = built.handoff
  const warnings = [...scope.warnings]
  if (built.unmeasured) warnings.push(`${built.unmeasured} node${built.unmeasured === 1 ? ' was' : 's were'} not measured: sizes marked "not measured" come from authored values only.`)

  const names = new Map<string, string>()
  for (const s of spec.screens) names.set(s.id, s.name)
  for (const c of spec.components) names.set(c.id, c.name)
  const propNames = new Map<string, string>()
  for (const c of spec.components) for (const p of c.props) propNames.set(p.id, p.name)
  const md: MdOptions = { rem: Boolean(options.rem), names, propNames, fractional: built.fractional }

  const files: Record<string, string> = {}
  files['spec.json'] = json(spec)
  files['spec.schema.json'] = json(SPEC_SCHEMA)
  for (const s of spec.screens) files[s.doc] = screenMarkdown(s, md)
  for (const c of spec.components) files[c.doc] = componentMarkdown(c, md)
  files['tokens/tokens.css'] = tokensCss(doc, scope)
  files['tokens/tokens.json'] = tokensJson(doc, spec.tokens)
  files['tokens/tailwind.css'] = tailwindCss(doc, scope)
  files['fonts.md'] = fontsMarkdown(spec)

  // fractional sizes per screen, images without alt
  const fractionalByScreen: Array<{ screen: string; count: number; example: string }> = []
  let fractional = 0
  let imagesWithoutAlt = 0
  for (const s of spec.screens) {
    let count = 0
    let example = ''
    for (const b of s.breakpoints) {
      const list = built.fractional.get(b.frameId) ?? []
      count += list.length
      if (!example && list[0]) example = `${list[0].width} × ${list[0].height}`
      walkNodes(b.root, (n) => {
        if (n.type === 'image' && n.a11y?.alt === undefined) imagesWithoutAlt++
      })
    }
    fractional += count
    if (count) fractionalByScreen.push({ screen: s.name, count, example })
  }

  const summary: HandoffSummary = {
    screens: spec.screens.length,
    breakpoints: spec.screens.reduce((n, s) => n + s.breakpoints.length, 0),
    nodes: built.nodes,
    components: spec.components.length,
    tokens: spec.tokens.length,
    textStyles: spec.textStyles.length,
    fonts: spec.fonts.length,
    notes: built.notes,
    skippedHidden: scope.skippedHidden,
    fractional,
    needsDecision: built.needsDecision.length,
    unmeasured: built.unmeasured
  }

  const handoffMd = handoffMarkdown({
    spec,
    summary,
    warnings,
    files: Object.keys(files),
    renders: Boolean(options.renders),
    rem: Boolean(options.rem),
    needsDecision: built.needsDecision,
    fractionalByScreen,
    imagesWithoutAlt
  })
  files['HANDOFF.md'] = handoffMd
  files['CLAUDE.md'] = handoffMd

  // state the next export diffs against (hashes only; no content)
  files['.handoff.json'] = json({
    schema: STATE_SCHEMA_ID,
    version: options.version,
    screens: spec.screens.map((s) => ({
      id: s.id,
      slug: s.slug,
      breakpoints: s.breakpoints.map((b) => ({ frameId: b.frameId, hash: sha256(JSON.stringify(b.root)) }))
    })),
    components: spec.components.map((c) => ({ id: c.id, hash: sha256(JSON.stringify(c.variants)) })),
    tokens: sha256(JSON.stringify(spec.tokens))
  })

  const sorted: Record<string, string> = {}
  for (const k of Object.keys(files).sort()) sorted[k] = files[k]
  assertSafe(doc, sorted)
  return { files: sorted, summary, warnings }
}
