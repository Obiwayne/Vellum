// The data of the bundle (`spec.json`): screens, components, tokens, text styles, fonts and assets, built from
// the scope with devSpec's `nodeSpec`. The markdown files render this same object, so the two never disagree.
import type { CNode, Doc } from '../types'
import { fractionalNodes, nodeSpec, type NodeSpec, type SpecOptions } from '../devSpec'
import { modesOf } from '../modes'
import { getTextStyle } from '../textStyles'
import { propDefsOf } from '../components'
import { variantValues } from '../variants'
import { familyName, GOOGLE_FONTS } from '../../editor/inspector/fonts'
import { PathRegistry, slug } from './paths'
import { tokenSpecs } from './tokens'
import { SCHEMA_ID, type AssetRecord, type ComponentSpec, type FontSpec, type Handoff, type HandoffNode, type HandoffOptions, type ScreenSpec, type TextStyleSpec } from './types'
import type { Scope } from './scope'

const sortedKeys = <T>(o: Record<string, T>): Record<string, T> => {
  const out: Record<string, T> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}

/** Fold the dev info of the document node into a NodeSpec (notes, a11y, states, open question, asset ids). */
function decorate(doc: Doc, s: NodeSpec, assetsByNode: Map<string, string[]>): HandoffNode {
  const { children, style, ...rest } = s
  const n: CNode | undefined = doc.nodes[s.id]
  const out: HandoffNode = {
    ...rest,
    style: { authored: sortedKeys(style.authored) as Record<string, string | number>, resolved: sortedKeys(style.resolved) },
    children: children.map((c) => decorate(doc, c, assetsByNode))
  }
  const dev = n?.dev
  if (dev?.notes) {
    const paras = dev.notes
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (paras.length) out.notes = paras
  }
  if (dev && (dev.role || dev.label || dev.tab !== undefined)) {
    out.a11y = {}
    if (dev.role) out.a11y.role = dev.role
    if (dev.label) out.a11y.label = dev.label
    if (dev.tab !== undefined) out.a11y.tab = dev.tab
  }
  if (s.image?.alt !== undefined) (out.a11y ??= {}).alt = s.image.alt
  if (dev?.states && Object.keys(dev.states).length) {
    const states: Record<string, Record<string, string | number | null | undefined>> = {}
    for (const k of Object.keys(dev.states).sort()) states[k] = sortedKeys(dev.states[k] as Record<string, string>)
    out.states = states
  }
  if (dev?.needsDecision) out.needsDecision = dev.needsDecision
  const a = assetsByNode.get(s.id)
  if (a?.length) out.assets = a
  return out
}

function walk(n: HandoffNode, fn: (n: HandoffNode) => void): void {
  fn(n)
  n.children.forEach((c) => walk(c, fn))
}

export interface BuiltSpec {
  handoff: Handoff
  /** fractional-size nodes per frame id */
  fractional: Map<string, Array<{ id: string; name: string; width: number; height: number }>>
  /** open questions with the screen they are on */
  needsDecision: Array<{ screen: string; node: string; id: string; text: string }>
  notes: number
  nodes: number
  unmeasured: number
}

const fontSource = (family: string): FontSpec['source'] => {
  if (GOOGLE_FONTS.some((g) => g.toLowerCase() === family.toLowerCase())) return 'google'
  return /^System /.test(family) ? 'system' : 'local'
}

/** Build the whole spec. Paths of the markdown files and reserved renders come from `reg`. */
export function buildSpec(doc: Doc, scope: Scope, opts: HandoffOptions, reg: PathRegistry): BuiltSpec {
  const precision = opts.precision ?? 2
  const so: SpecOptions = { measure: opts.measure, lineCount: opts.lineCount, mode: opts.mode, precision }
  const assetsByNode = new Map<string, string[]>()
  for (const a of opts.assets ?? []) for (const id of a.nodeIds) assetsByNode.set(id, [...(assetsByNode.get(id) ?? []), a.id].sort())

  const fractional = new Map<string, Array<{ id: string; name: string; width: number; height: number }>>()
  const needs: BuiltSpec['needsDecision'] = []
  let notes = 0
  let nodes = 0
  let unmeasured = 0
  const count = (root: HandoffNode, screenName: string, frameId?: string): void => {
    walk(root, (n) => {
      nodes++
      if (!n.box.measured) unmeasured++
      if (n.notes) notes += n.notes.length
      if (n.needsDecision) needs.push({ screen: screenName, node: n.name, id: n.id, text: n.needsDecision })
    })
    if (frameId) fractional.set(frameId, fractionalNodes(root as unknown as NodeSpec))
  }

  // ---- screens
  const screens: ScreenSpec[] = []
  for (const g of scope.screens) {
    const stem = slug(g.name, 'screen')
    const mdPath = reg.claim('screens', g.name, '.md', 'screen')
    const mdStem = mdPath.slice('screens/'.length, -'.md'.length)
    void stem
    const tagged = g.frames.length > 1 || g.frames.some((f) => f.bp)
    const bps = []
    for (const f of g.frames) {
      const spec = nodeSpec(doc, f.id, so)
      if (!spec) continue
      const root = decorate(doc, spec, assetsByNode)
      const bpName = f.bp ?? 'Default'
      const png = reg.claimStem('screens', tagged ? `${mdStem}.${slug(bpName, 'default')}` : mdStem, '.png')
      count(root, g.name, f.id)
      bps.push({ name: bpName, width: f.width, height: f.height, frameId: f.id, png, root })
    }
    if (!bps.length) continue
    const ready = doc.nodes[g.frames[0].id].dev?.ready
    const screen: ScreenSpec = { id: g.frames[0].id, name: g.name, slug: mdStem, doc: mdPath, breakpoints: bps }
    if (ready) screen.ready = { at: ready.at }
    screens.push(screen)
  }

  // ---- components, grouped by set
  const frameToScreen = new Map<string, string>()
  for (const s of screens) for (const b of s.breakpoints) frameToScreen.set(b.frameId, s.id)
  const groups = new Map<string, string[]>()
  for (const id of scope.mains) {
    const set = doc.nodes[id].component?.set
    const key = set && doc.nodes[set]?.componentSet ? set : id
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  const components: ComponentSpec[] = []
  const mainToComponent = new Map<string, string>()
  const order = [...groups.keys()].sort((a, b) => {
    const na = doc.nodes[a].componentSet?.name ?? doc.nodes[a].component?.name ?? doc.nodes[a].name
    const nb = doc.nodes[b].componentSet?.name ?? doc.nodes[b].component?.name ?? doc.nodes[b].name
    return na.localeCompare(nb, 'en') || a.localeCompare(b, 'en', { numeric: true })
  })
  for (const key of order) {
    const head = doc.nodes[key]
    const isSet = Boolean(head.componentSet)
    const name = head.componentSet?.name ?? head.component?.name ?? head.name
    const mdPath = reg.claim('components', name, '.md', 'component')
    const mains = isSet ? head.children.filter((c) => (groups.get(key) ?? []).includes(c)) : [key]
    const variants: ComponentSpec['variants'] = []
    for (const m of mains) {
      const spec = nodeSpec(doc, m, so)
      if (!spec) continue
      const root = decorate(doc, spec, assetsByNode)
      count(root, name)
      variants.push({ id: m, name: doc.nodes[m].name, values: isSet ? variantValues(doc, m) : {}, root })
      mainToComponent.set(m, key)
    }
    if (!variants.length) continue
    components.push({
      id: key,
      name,
      slug: mdPath.slice('components/'.length, -'.md'.length),
      doc: mdPath,
      set: isSet,
      props: propDefsOf(doc, mains[0]).map((p) => ({ ...p, ...(p.options ? { options: [...p.options] } : {}) })),
      variants,
      usedBy: []
    })
  }
  // used-by: screens that instantiate a variant, and components that nest another
  const usedBy = new Map<string, Set<string>>()
  const note = (compId: string | undefined, by: string): void => {
    if (compId && compId !== by) (usedBy.get(compId) ?? usedBy.set(compId, new Set()).get(compId)!).add(by)
  }
  for (const s of screens) for (const b of s.breakpoints) walk(b.root, (n) => note(mainToComponent.get(n.component?.ref ?? ''), s.id))
  for (const c of components) for (const v of c.variants) walk(v.root, (n) => n.id !== v.id && note(mainToComponent.get(n.component?.ref ?? ''), c.id))
  for (const c of components) c.usedBy = [...(usedBy.get(c.id) ?? [])].sort()

  // ---- text styles and fonts
  const textStyles: TextStyleSpec[] = scope.textStyleIds
    .map((id) => getTextStyle(doc, id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ id: s.id, name: s.name, style: sortedKeys(s.style) as Record<string, string | number> }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id))

  const fam = new Map<string, FontSpec>()
  const addFont = (n: HandoffNode): void => {
    const t = n.text
    if (!t?.fontFamily) return
    const family = familyName(t.fontFamily)
    const f = fam.get(family) ?? { family, css: t.fontFamily, weights: [], italic: false, source: fontSource(family), usedBy: 0 }
    f.usedBy++
    if (!f.weights.includes(t.fontWeight)) f.weights.push(t.fontWeight)
    if (t.fontStyle === 'italic') f.italic = true
    fam.set(family, f)
  }
  for (const s of screens) for (const b of s.breakpoints) walk(b.root, addFont)
  for (const c of components) for (const v of c.variants) walk(v.root, addFont)
  const fonts = [...fam.values()]
    .map((f) => ({ ...f, weights: [...f.weights].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))) }))
    .sort((a, b) => a.family.localeCompare(b.family, 'en'))

  const assets: AssetRecord[] = [...(opts.assets ?? [])].map((a) => ({ ...a, nodeIds: [...a.nodeIds].sort() })).sort((a, b) => a.path.localeCompare(b.path, 'en'))
  for (const a of assets) reg.reserve(a.path)

  const handoff: Handoff = {
    schema: SCHEMA_ID,
    handoff: { version: opts.version, exportedAt: opts.exportedAt, vellum: opts.vellum, fileId: doc.id, fileName: opts.projectLabel ?? doc.name },
    units: { length: 'px', remBase: 16, precision },
    modes: modesOf(doc),
    screens,
    components,
    tokens: tokenSpecs(doc, scope, precision),
    textStyles,
    fonts,
    assets
  }
  return { handoff, fractional, needsDecision: needs, notes, nodes, unmeasured }
}
