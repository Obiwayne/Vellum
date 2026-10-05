// get_jsx for components: an instance becomes component usage (`<Button size="lg" label="Buy" />`) and every
// main it uses becomes a definition above it (`function Button({ size = "md", label = "Click" }) { ... }`).
// Variant values and the instance's property values are the props; bound text/visibility/swap layers read them.
// Per-layer overrides that are not properties, and the instance's own size/position, are NOT exported (documented
// in docs/MCP.md): detach_instance first to export an overridden instance as plain markup.
import { descendants } from '../model/ops'
import { propDefsOf } from '../model/components'
import { pickMain, setOf, variantsOf, variantValues } from '../model/variants'
import type { JsxFormat, JsxHooks } from '../model/html'
import { nodeToJsx } from '../model/html'
import type { CNode, Doc, PropDef } from '../model/types'
import { nodeToTailwindJsx } from './tools-render'

const pascal = (s: string): string => {
  const w = s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const out = w.map((x) => x[0].toUpperCase() + x.slice(1)).join('')
  return /^[A-Za-z]/.test(out) ? out : `C${out}`
}
const camel = (s: string): string => {
  const p = pascal(s)
  return p[0].toLowerCase() + p.slice(1)
}

interface Def {
  key: string
  name: string
  mains: CNode[]
  props: { def: PropDef; ident: string }[]
}

class Exporter {
  private defs = new Map<string, Def>()
  private names = new Set<string>()
  private queue: string[] = []

  constructor(
    private doc: Doc,
    private format: JsxFormat
  ) {}

  /** The definition key of a main: its set frame, or itself. */
  keyOf(mainId: string): string {
    return setOf(this.doc, mainId) ?? mainId
  }

  def(mainId: string): Def {
    const key = this.keyOf(mainId)
    let d = this.defs.get(key)
    if (d) return d
    const set = this.doc.nodes[key]?.componentSet
    const main = this.doc.nodes[mainId]
    let name = pascal(set?.name ?? main.component?.name ?? main.name)
    for (let i = 2; this.names.has(name); i++) name = `${pascal(set?.name ?? main.component?.name ?? main.name)}${i}`
    this.names.add(name)
    const mains = set ? variantsOf(this.doc, key) : [main]
    const used = new Set<string>()
    const props = propDefsOf(this.doc, mainId).map((def) => {
      let ident = def.type === 'swap' ? pascal(def.name) : camel(def.name)
      for (let i = 2; used.has(ident); i++) ident = `${ident}${i}`
      used.add(ident)
      return { def, ident }
    })
    d = { key, name, mains, props }
    this.defs.set(key, d)
    this.queue.push(key)
    return d
  }

  private lit(v: string | boolean): string {
    return typeof v === 'boolean' ? `{${v}}` : /["\\\n]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`
  }

  /** `<Button size="lg" label="Buy" />`: non-default variant values and property values the instance sets. */
  usage(inst: CNode, indent: string, swapIdent?: string): string {
    const of = inst.instance?.of as string
    const d = this.def(of)
    const attrs: string[] = []
    const values = { ...variantValues(this.doc, of) }
    for (const { def, ident } of d.props) {
      if (def.type === 'variant') {
        if (values[def.id] !== undefined && values[def.id] !== String(def.default)) attrs.push(`${ident}=${this.lit(values[def.id])}`)
        continue
      }
      const v = inst.instance?.props?.[def.id]
      if (v === undefined) continue
      if (def.type === 'swap') attrs.push(`${ident}={${this.def(v as string).name}}`)
      else attrs.push(`${ident}=${this.lit(v)}`)
    }
    return `${indent}<${swapIdent ?? d.name}${attrs.length ? ' ' + attrs.join(' ') : ''} />`
  }

  private hooksFor(main: CNode, d: Def): JsxHooks {
    const identOf = (id: string | undefined, type: PropDef['type']): string | undefined => d.props.find((p) => p.def.id === id && p.def.type === type)?.ident
    return {
      replace: (n, indent) => {
        if (n.id === main.id || !n.instance) return null
        const swap = identOf(n.bind?.swap, 'swap')
        return this.usage(n, indent, swap)
      },
      text: (n) => {
        const id = identOf(n.bind?.text, 'text')
        return id ? `{${id}}` : null
      },
      when: (n) => identOf(n.bind?.visible, 'boolean') ?? null
    }
  }

  private render(id: string, hooks: JsxHooks, indent: string): string {
    return this.format === 'tailwind' ? nodeToTailwindJsx(this.doc, id, indent, true, hooks) : nodeToJsx(this.doc, id, 'inline-styles', indent, true, hooks)
  }

  /** JSX of a subtree with instances as usages; also registers the definitions it needs. */
  body(id: string): string {
    const n = this.doc.nodes[id]
    const hooks: JsxHooks = { replace: (c, indent) => (c.instance ? this.usage(c, indent) : null) }
    return this.render(n.id, hooks, '    ')
  }

  private source(d: Def): string {
    const params = d.props.map(({ def, ident }) => {
      if (def.type === 'swap') return `${ident} = ${this.def(def.default as string).name}`
      return `${ident} = ${JSON.stringify(def.default)}`
    })
    const vprops = d.props.filter((p) => p.def.type === 'variant')
    const header = `function ${d.name}(${params.length ? `{ ${params.join(', ')} }` : ''}) {`
    const defaults = d.mains.length > 1 ? pickMain(this.doc, d.key, {}) : d.mains[0].id
    const ordered = [...d.mains.filter((m) => m.id !== defaults), ...d.mains.filter((m) => m.id === defaults)]
    const returns = ordered.map((m, i) => {
      const last = i === ordered.length - 1
      const jsx = this.render(m.id, this.hooksFor(m, d), last ? '    ' : '      ')
      if (last) return `  return (\n${jsx}\n  )`
      const values = variantValues(this.doc, m.id)
      const cond = vprops.map((p) => `${p.ident} === ${JSON.stringify(values[p.def.id])}`).join(' && ') || 'false'
      return `  if (${cond}) {\n    return (\n${jsx}\n    )\n  }`
    })
    return `${header}\n${returns.join('\n')}\n}`
  }

  /** Every definition registered so far (closing over the ones they use), in discovery order. */
  definitions(): string[] {
    const out: string[] = []
    for (let i = 0; i < this.queue.length; i++) out.push(this.source(this.defs.get(this.queue[i]) as Def))
    return out
  }
}

/** True when the subtree has instances or is itself a main / component set (so the component export applies). */
function involvesComponents(doc: Doc, id: string): boolean {
  return [id, ...descendants(doc, id)].some((i) => doc.nodes[i]?.instance || doc.nodes[i]?.component || doc.nodes[i]?.componentSet)
}

/**
 * get_jsx output with components: definitions first, then the expression. A main (or a variant main, or the set
 * frame) outputs its definition only. Null when the subtree has no components (the caller uses the plain export).
 */
export function jsxWithComponents(doc: Doc, id: string, format: JsxFormat): string | null {
  if (!involvesComponents(doc, id)) return null
  const n = doc.nodes[id]
  const ex = new Exporter(doc, format)
  const isDefinition = Boolean(n.component || n.componentSet)
  let expression = ''
  if (n.component) ex.def(id)
  else if (n.componentSet) ex.def(variantsOf(doc, id)[0]?.id ?? id)
  else expression = `(\n${ex.body(id)}\n  )`
  // definitions of mains found while walking the subtree (instances anywhere below)
  if (!isDefinition) for (const d of descendants(doc, id)) if (doc.nodes[d]?.instance) ex.def(doc.nodes[d].instance?.of as string)
  const defs = ex.definitions()
  return [...defs, ...(expression ? [expression] : [])].join('\n\n')
}
