// What goes into a bundle: the chosen frames, what they use, and the specs of both. This is the safety
// whitelist of docs/factory/T58-plan.md section 11: only chosen top-level frames are walked, so other pages,
// unchosen frames and scratch layers are unreachable; hidden layers are dropped by `nodeSpec` and counted here;
// comments, thumbnails and every other document-level field are never read.
import type { CNode, Doc } from '../model/types'
import { nodeSpec, tokenUse, varsIn, type NodeSpec, type SpecOptions, type TokenUse } from '../model/devSpec'
import { modesOf } from '../model/modes'
import { isPageRoot, numericSize } from '../model/ops'
import { variantValues, variantsOf } from '../model/variants'
import { PathRegistry, slug } from './paths'
import type {
  AssetRecord,
  BreakpointSpec,
  ComponentSpec,
  DevNodeSpec,
  FontSource,
  FontSpec,
  HandoffOptions,
  ScreenSpec,
  StateBadge,
  TextStyleSpec
} from './types'

export interface Collected {
  screens: ScreenSpec[]
  components: ComponentSpec[]
  tokens: TokenUse[]
  textStyles: TextStyleSpec[]
  fonts: FontSpec[]
  assets: AssetRecord[]
  modes: string[]
  warnings: string[]
  skippedHidden: number
  nodes: number
  unmeasured: number
  paths: PathRegistry
}

/** Visible top-level frames of the document, in document order (pages in order, then their children). */
export function topLevelFrames(doc: Doc): string[] {
  const out: string[] = []
  for (const p of doc.pages) {
    for (const id of doc.nodes[p.rootId]?.children ?? []) {
      const n = doc.nodes[id]
      if (n && n.type === 'frame' && n.visible) out.push(id)
    }
  }
  return out
}

/** The frames to export: `requested`, or every visible top-level frame marked ready. Problems become warnings. */
export function selectFrames(doc: Doc, requested?: string[]): { ids: string[]; warnings: string[] } {
  const warnings: string[] = []
  const order = topLevelFrames(doc)
  const known = new Set(order)
  if (!requested) {
    const ids = order.filter((id) => doc.nodes[id].dev?.ready)
    if (!ids.length) warnings.push('No frame is marked ready for dev, so nothing was exported.')
    return { ids, warnings }
  }
  const want = new Set<string>()
  for (const id of requested) {
    const n = doc.nodes[id]
    if (!n) warnings.push(`Frame ${id} does not exist and was skipped.`)
    else if (!n.parent || !isPageRoot(doc, n.parent)) warnings.push(`"${n.name}" is not a top-level frame and was skipped.`)
    else if (n.type !== 'frame') warnings.push(`"${n.name}" is not a frame and was skipped.`)
    else if (!n.visible) warnings.push(`"${n.name}" is hidden and was skipped.`)
    else want.add(id)
  }
  const ids = order.filter((id) => want.has(id) && known.has(id))
  if (!ids.length) warnings.push('No frame was chosen, so nothing was exported.')
  return { ids, warnings }
}

/** Hidden layers below the given roots (each hidden subtree counted once), for the review counts. */
export function countHidden(doc: Doc, roots: string[]): number {
  let n = 0
  const walk = (id: string): void => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const k = doc.nodes[c]
      if (!k) continue
      if (!k.visible) n++
      else walk(c)
    }
  }
  roots.forEach(walk)
  return n
}

/** Dev notes are written for the developer: blank-line separated paragraphs become separate entries. */
export function notesOf(text: string | undefined): string[] | undefined {
  if (!text || !text.trim()) return undefined
  const parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

/** A NodeSpec with the developer-facing fields of `CNode.dev` merged in, recursively. */
export function withDev(doc: Doc, spec: NodeSpec): DevNodeSpec {
  const { children, tokens, box, ...rest } = spec
  // a size that was not measured and is not authored (Fit, Fill, auto) is `0` in NodeSpec: a developer would
  // copy it as a real size, so the axis is left out and `measured: false` says why
  const known: DevNodeSpec['box'] = { ...box }
  if (!box.measured) {
    if (box.width === 0 && spec.sizing.w.mode !== 'fixed') delete known.width
    if (box.height === 0 && spec.sizing.h.mode !== 'fixed') delete known.height
  }
  const out: DevNodeSpec = { ...rest, box: known, tokens: tokens.map((t) => t.name), children: children.map((c) => withDev(doc, c)) }
  const dev = doc.nodes[spec.id]?.dev
  if (dev) {
    const notes = notesOf(dev.notes)
    if (notes) out.notes = notes
    const a11y: NonNullable<DevNodeSpec['a11y']> = {}
    if (dev.role) a11y.role = dev.role
    if (dev.label) a11y.label = dev.label
    if (dev.tab !== undefined) a11y.tab = dev.tab
    if (Object.keys(a11y).length) out.a11y = a11y
    if (dev.states && Object.keys(dev.states).length) out.states = JSON.parse(JSON.stringify(dev.states))
    if (dev.needsDecision) out.needsDecision = dev.needsDecision
  }
  return out
}

export function walkSpec(root: DevNodeSpec, fn: (n: DevNodeSpec) => void): void {
  fn(root)
  for (const c of root.children) walkSpec(c, fn)
}

const GENERIC_FAMILIES = new Set(['system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont'])
const DEFAULT_STACK = 'system-ui, sans-serif'

const firstFamily = (stack: string): string => (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')

const defaultFontSource = (family: string): FontSource => (GENERIC_FAMILIES.has(family.toLowerCase()) ? 'system' : 'unknown')

const STATE_PROP_RE = /^(state|status)$/i
const STATE_VOCAB = ['hover', 'pressed', 'focus', 'disabled']
const INTERACTIVE_RE = /\b(button|btn|link|input|field|textbox|checkbox|radio|switch|toggle|tab|select|dropdown|menu item|chip)\b/i

const isTokenName = (s: string): boolean => /^--[\w-]+$/.test(s)

/** Everything a bundle needs, from the chosen frames. Pure; never mutates the document. */
export function collect(doc: Doc, options: HandoffOptions): Collected {
  const precision = options.precision ?? 2
  const warnings: string[] = []
  const sel = selectFrames(doc, options.frames)
  warnings.push(...sel.warnings)
  const specOpts: SpecOptions = { precision }
  if (options.measure) specOpts.measure = options.measure
  if (options.lineCount) specOpts.lineCount = options.lineCount
  if (options.mode !== undefined) specOpts.mode = options.mode

  const paths = new PathRegistry()
  for (const fixed of ['HANDOFF.md', 'CLAUDE.md', 'spec.json', 'spec.schema.json', 'fonts.md', '.handoff.json', 'tokens/tokens.css', 'tokens/tokens.json', 'tokens/tailwind.css']) paths.reserve(fixed)

  // ---- screens: tagged frames with the same screen name are one screen at several breakpoints
  type Group = { name: string; frames: string[] }
  const groups: Group[] = []
  const groupByName = new Map<string, Group>()
  for (const id of sel.ids) {
    const n = doc.nodes[id]
    const tag = n.dev?.screen
    if (tag) {
      const key = tag.name.trim().toLowerCase()
      let g = groupByName.get(key)
      if (!g) {
        g = { name: tag.name.trim(), frames: [] }
        groupByName.set(key, g)
        groups.push(g)
      }
      g.frames.push(id)
    } else groups.push({ name: n.name, frames: [id] })
  }

  const screens: ScreenSpec[] = []
  let skippedHidden = 0
  for (const g of groups) {
    const items: Array<{ id: string; bp: string; width?: number; height?: number; root: DevNodeSpec; ready?: { at: number } }> = []
    for (const id of g.frames) {
      const raw = nodeSpec(doc, id, specOpts)
      if (!raw) continue
      const root = withDev(doc, raw)
      const n = doc.nodes[id]
      const item: (typeof items)[number] = {
        id,
        bp: n.dev?.screen?.bp?.trim() || 'default',
        width: root.box.width ?? numericSize(n.style.width as string | number | undefined) ?? undefined,
        height: root.box.height,
        root
      }
      if (n.dev?.ready) item.ready = { at: n.dev.ready.at }
      items.push(item)
    }
    if (!items.length) continue
    // largest first; ties keep document order
    items.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    const sSlug = paths.take('screens', slug(g.name, 'screen'), '.md').replace(/^screens\//, '').replace(/\.md$/, '')
    const bps: BreakpointSpec[] = []
    const usedBp = new Set<string>()
    for (const it of items) {
      let bp = it.bp
      let i = 2
      while (usedBp.has(bp.toLowerCase())) bp = `${it.bp} ${i++}`
      usedBp.add(bp.toLowerCase())
      const single = items.length === 1 && bp === 'default'
      const png = paths.take('screens', single ? sSlug : `${sSlug}.${slug(bp, 'bp')}`, '.png')
      const b: BreakpointSpec = { bp, frameId: it.id, width: it.width, height: it.height, png, root: it.root }
      if (it.ready) b.ready = it.ready
      bps.push(b)
    }
    screens.push({ id: bps[0].frameId, name: g.name, slug: sSlug, breakpoints: bps })
  }
  skippedHidden += countHidden(doc, screens.flatMap((s) => s.breakpoints.map((b) => b.frameId)))

  // ---- components used by the screens, and by each other
  const compKey = (mainId: string): string | null => {
    const m = doc.nodes[mainId]
    if (!m?.component) return null
    const set = m.component.set && doc.nodes[m.component.set]?.componentSet ? m.component.set : null
    return set ?? mainId
  }
  const refsIn = (root: DevNodeSpec): string[] => {
    const out: string[] = []
    walkSpec(root, (n) => {
      if (n.component) {
        const k = compKey(n.component.ref)
        if (k) out.push(k)
      }
    })
    return out
  }
  const mainsOf = (key: string): CNode[] => {
    const set = doc.nodes[key]
    if (set?.componentSet) return variantsOf(doc, key).filter((m) => m.visible)
    return set?.component && set.visible ? [set] : []
  }
  const compOrder: string[] = []
  const compSpecs = new Map<string, ComponentSpec>()
  const missing = new Set<string>()
  const edges = new Map<string, Set<string>>()
  const queue: string[] = []
  const direct = new Map<string, Set<string>>() // screen id -> component keys
  for (const s of screens) {
    const set = new Set<string>()
    for (const b of s.breakpoints) refsIn(b.root).forEach((k) => set.add(k))
    direct.set(s.id, set)
    set.forEach((k) => queue.push(k))
  }
  while (queue.length) {
    const key = queue.shift() as string
    if (compSpecs.has(key) || missing.has(key)) continue
    const keyNode = doc.nodes[key]
    const mains = mainsOf(key)
    if (!keyNode || !mains.length) {
      warnings.push(`A component used by an exported frame (${key}) could not be found or is hidden; its instances are listed without a definition.`)
      missing.add(key)
      continue
    }
    const isSet = Boolean(keyNode.componentSet)
    const name = isSet ? keyNode.componentSet!.name : keyNode.component?.name || keyNode.name
    const props = isSet ? keyNode.componentSet!.props : keyNode.component?.props ?? []
    const variants = mains.map((m) => {
      const raw = nodeSpec(doc, m.id, specOpts)
      const root = withDev(doc, raw as NodeSpec)
      skippedHidden += countHidden(doc, [m.id])
      return { ref: m.id, name: m.component?.name || m.name, values: isSet ? variantValues(doc, m.id) : {}, root }
    })
    const out = new Set<string>()
    for (const v of variants) refsIn(v.root).forEach((k) => (k !== key ? out.add(k) : undefined))
    edges.set(key, out)
    out.forEach((k) => queue.push(k))
    const notes: string[] = []
    const described = new Set<string>()
    for (const n of [keyNode, ...mains]) {
      for (const t of notesOf(n.dev?.notes) ?? []) if (!notes.includes(t)) notes.push(t)
      for (const st of Object.keys(n.dev?.states ?? {})) described.add(st.toLowerCase())
    }
    const drawn: string[] = []
    for (const p of props) {
      if (p.type === 'variant' && STATE_PROP_RE.test(p.name.trim())) for (const o of p.options ?? []) drawn.push(o.toLowerCase())
    }
    const interactive = INTERACTIVE_RE.test(name)
    const states: ComponentSpec['states'] = []
    const seen = new Set<string>()
    const add = (state: string, badge: StateBadge): void => {
      if (seen.has(state)) return
      seen.add(state)
      states.push({ state, badge })
    }
    drawn.forEach((s) => add(s, 'drawn'))
    ;[...described].sort().forEach((s) => add(s, 'described'))
    if (interactive) STATE_VOCAB.filter((s) => !seen.has(s) && !(s === 'pressed' && seen.has('active'))).forEach((s) => add(s, 'missing'))
    const base = slug(name, 'component')
    const cSlug = paths.take('components', base, '.md').replace(/^components\//, '').replace(/\.md$/, '')
    compOrder.push(key)
    compSpecs.set(key, { ref: key, name, slug: cSlug, isSet, props: JSON.parse(JSON.stringify(props)), variants, usedBy: [], notes, states, interactive })
  }

  // used-by: a screen uses a component directly or through another component
  const reach = (from: Set<string>): Set<string> => {
    const seen = new Set<string>()
    const stack = [...from]
    while (stack.length) {
      const k = stack.pop() as string
      if (seen.has(k)) continue
      seen.add(k)
      edges.get(k)?.forEach((c) => stack.push(c))
    }
    return seen
  }
  const components = compOrder
    .map((k) => compSpecs.get(k) as ComponentSpec)
    .sort((a, b) => a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref))
  for (const s of screens) {
    for (const k of reach(direct.get(s.id) ?? new Set())) {
      const c = compSpecs.get(k)
      if (c && !c.usedBy.includes(s.id)) c.usedBy.push(s.id)
    }
  }
  for (const c of components) c.usedBy.sort()

  // ---- every emitted node: counts, text styles, fonts, tokens
  const all: DevNodeSpec[] = []
  for (const s of screens) for (const b of s.breakpoints) walkSpec(b.root, (n) => all.push(n))
  const nodes = all.length
  const inComponents: DevNodeSpec[] = []
  for (const c of components) for (const v of c.variants) walkSpec(v.root, (n) => inComponents.push(n))
  const emitted = [...all, ...inComponents]
  const unmeasured = all.filter((n) => !n.box.measured).length

  const styleIds = new Set<string>()
  for (const n of emitted) {
    const id = doc.nodes[n.id]?.textStyle
    if (id) styleIds.add(id)
  }
  const textStyles: TextStyleSpec[] = (doc.textStyles ?? [])
    .filter((t) => styleIds.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, style: JSON.parse(JSON.stringify(t.style)) as Record<string, string | number> }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

  // tokens: those named by emitted nodes, text styles and state rules, plus what they reference
  const wanted = new Set<string>()
  for (const n of emitted) {
    n.tokens.forEach((t) => wanted.add(t))
    for (const patch of Object.values(n.states ?? {})) for (const v of Object.values(patch)) varsIn(v as string | number).forEach((t) => wanted.add(t))
  }
  for (const t of textStyles) for (const v of Object.values(t.style)) varsIn(v).forEach((x) => wanted.add(x))
  const byName = new Map(doc.tokens.map((t) => [t.name, t]))
  const stack = [...wanted]
  while (stack.length) {
    const name = stack.pop() as string
    const t = byName.get(name)
    if (!t) continue
    for (const v of [t.value, ...Object.values(t.modes ?? {})]) {
      for (const r of varsIn(v)) {
        if (!wanted.has(r)) {
          wanted.add(r)
          stack.push(r)
        }
      }
    }
  }
  const tokens: TokenUse[] = []
  for (const name of [...wanted].sort()) {
    if (!isTokenName(name)) {
      warnings.push(`Token name "${name}" is not a CSS custom property and was left out.`)
      continue
    }
    const u = tokenUse(doc, name, precision)
    if (u) tokens.push(u)
    else warnings.push(`Token ${name} is used but not defined in the document.`)
  }

  const fontSource = options.fontSource ?? defaultFontSource
  const fontMap = new Map<string, { stack: string; weights: Set<string>; italic: boolean; n: number }>()
  for (const n of emitted) {
    if (n.type !== 'text' || !n.text) continue
    const stack = (n.text.fontFamily ?? '').trim() || DEFAULT_STACK
    const family = firstFamily(stack) || firstFamily(DEFAULT_STACK)
    const f = fontMap.get(family) ?? { stack, weights: new Set<string>(), italic: false, n: 0 }
    f.weights.add(String(n.text.fontWeight))
    if ((n.text.fontStyle ?? '') === 'italic' || (n.text.fontStyle ?? '') === 'oblique') f.italic = true
    f.n++
    fontMap.set(family, f)
  }
  const fonts: FontSpec[] = [...fontMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([family, f]) => ({
      family,
      weights: [...f.weights].map((w) => (/^\d+$/.test(w) ? Number(w) : w)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
      italic: f.italic,
      source: fontSource(family),
      stack: f.stack,
      usedBy: f.n
    }))

  const assets = [...(options.assets ?? [])].sort((a, b) => a.path.localeCompare(b.path))

  return {
    screens,
    components,
    tokens,
    textStyles,
    fonts,
    assets,
    modes: modesOf(doc),
    warnings,
    skippedHidden,
    nodes,
    unmeasured,
    paths
  }
}
