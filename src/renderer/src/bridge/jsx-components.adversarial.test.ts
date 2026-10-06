// @vitest-environment jsdom
// Test-station checks for get_jsx with components (M2 criterion): props, definitions, nesting, odd names, and that
// every output parses as JSX (the TypeScript parser, a declared dev dependency).
import ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import './tools-read'
import './tools-write'
import './tools-components'
import './tools-render'

const S = getStore
let fileId: string
const doc = () => S().docs[fileId]
const root = (): string => doc().pages[0].rootId
const call = async (tool: string, args: Record<string, unknown> = {}): Promise<any> => ((await handlers[tool]({ fileId, ...args })) as { body: any }).body
const FORMATS = ['inline-styles', 'tailwind'] as const
const jsx = async (nodeId: string, format: string): Promise<string> => (await call('get_jsx', { nodeId, format })) as string
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0

/** Throws with the parser's message when `code` is not valid JSX. */
function parses(code: string): void {
  const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'out.tsx', compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 } })
  const errors = (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
  if (errors.length) throw new Error(`not valid JSX: ${errors.join('; ')} -- ${code}`)
}

describe('the parse helper', () => {
  it('accepts valid JSX and rejects broken JSX', () => {
    expect(() => parses('const a = (<div x={1} />)')).not.toThrow()
    expect(() => parses('const a = (<div x={1}>)')).toThrow(/not valid JSX/)
  })
})

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('T', { open: true })
})

interface Btn {
  frame: string
  lg: string
  label: string
  icon: string
  lgLabel: string
  lgIcon: string
  sizeProp: string
}

/** Button set: Size = md (default) / lg, Label text prop, Show icon boolean prop; both variants bound. */
async function buttonSet(name = 'Button'): Promise<Btn> {
  const frame = S().createNode(fileId, { type: 'frame', name, style: { width: 120, height: 40, display: 'flex', gap: 8, backgroundColor: '#1F4FD8' } }, root())
  const label = S().createNode(fileId, { type: 'text', text: 'Click', style: { color: '#ffffff' } }, frame)
  const icon = S().createNode(fileId, { type: 'rect', name: 'Icon', style: { width: 16, height: 16 } }, frame)
  await call('create_component', { nodeIds: [frame] })
  const v = await call('create_variant', { componentId: frame })
  let sizeProp = ''
  S().mutate(fileId, 'options', (d) => {
    const p = d.nodes[v.componentSetId].componentSet!.props[0]
    sizeProp = p.id
    p.name = 'Size'
    p.options = ['md', 'lg']
    p.default = 'md'
    d.nodes[frame].component!.variant = { [p.id]: 'md' }
    d.nodes[v.variantId].component!.variant = { [p.id]: 'lg' }
    d.nodes[v.variantId].style.height = 56
  })
  await call('add_component_prop', { componentId: frame, name: 'Label', type: 'text', defaultValue: 'Click' })
  await call('add_component_prop', { componentId: frame, name: 'Show icon', type: 'boolean' })
  const kids = doc().nodes[v.variantId].children.map((c) => doc().nodes[c])
  const lgLabel = kids.find((n) => n.type === 'text')!.id
  const lgIcon = kids.find((n) => n.name === 'Icon')!.id
  for (const [t, i] of [[label, icon], [lgLabel, lgIcon]]) {
    await call('bind_component_prop', { nodeId: t, aspect: 'text', property: 'Label' })
    await call('bind_component_prop', { nodeId: i, aspect: 'visible', property: 'Show icon' })
  }
  return { frame, lg: v.variantId, label, icon, lgLabel, lgIcon, sizeProp }
}

async function instance(main: string, props: Record<string, string | boolean> = {}, parent?: string): Promise<string> {
  const id = (await call('create_instance', { componentId: main, ...(parent ? { parentId: parent } : {}) })).instanceId as string
  if (Object.keys(props).length) await call('set_instance_props', { nodeId: id, props })
  return id
}

function wrapper(): string {
  return S().createNode(fileId, { type: 'frame', name: 'Page', style: { width: 400, height: 300, display: 'flex', flexDirection: 'column' } }, root())
}

describe('Button set with two instances', () => {
  it('each usage shows its own props; one definition for the set; output parses (both formats)', async () => {
    const b = await buttonSet()
    const page = wrapper()
    const i1 = await instance(b.lg, { Label: 'Buy', 'Show icon': false }, page)
    const i2 = await instance(b.frame, { Label: 'Cancel' }, page)
    for (const format of FORMATS) {
      const out = await jsx(page, format)
      parses(out)
      expect(count(out, /function Button\(/g)).toBe(1)
      expect(out).toContain('<Button size="lg" label="Buy" showIcon={false} />')
      expect(out).toContain('<Button label="Cancel" />') // default variant: size omitted, icon stays on
      // usage order follows the document
      expect(out.indexOf('label="Buy"')).toBeLessThan(out.indexOf('label="Cancel"'))
      // the definition carries the defaults and both variant branches
      expect(out).toContain('function Button({ size = "md", label = "Click", showIcon = true })')
      expect(count(out, /return \(/g)).toBe(2)
      expect(out).toContain('if (size === "lg")')
    }
    expect(i1 && i2).toBeTruthy()
  })

  it('the instance on its own, the main, a variant main and the set frame', async () => {
    const b = await buttonSet()
    const inst = await instance(b.lg, { Label: 'Buy' })
    const setId = doc().nodes[b.frame].component!.set as string
    for (const format of FORMATS) {
      for (const id of [b.frame, b.lg, setId]) {
        const out = await jsx(id, format)
        parses(out)
        expect(out).toMatch(/^function Button\(/)
        expect(count(out, /function Button\(/g)).toBe(1)
        expect(out).not.toContain('<Button') // definition only, no usage
      }
      const alone = await jsx(inst, format)
      parses(alone)
      expect(alone).toContain('<Button size="lg" label="Buy" />')
    }
  })

  it('a bound layer that is hidden by default still renders behind its condition', async () => {
    const b = await buttonSet()
    await call('set_instance_props', { nodeId: await instance(b.frame), props: { 'Show icon': true } })
    S().mutate(fileId, 'default off', (d) => {
      const set = d.nodes[doc().nodes[b.frame].component!.set as string]
      set.componentSet!.props.find((p) => p.name === 'Show icon')!.default = false
      d.nodes[b.icon].visible = false
    })
    for (const format of FORMATS) {
      const out = await jsx(b.frame, format)
      parses(out)
      expect(out).toContain('showIcon = false')
      expect(out).toContain('{showIcon && (')
    }
  })
})

describe('nested instances', () => {
  async function card(): Promise<{ b: Btn; card: string; inCard: string }> {
    const b = await buttonSet()
    const card = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 300, height: 100, display: 'flex' } }, root())
    S().createNode(fileId, { type: 'text', text: 'Title' }, card)
    await call('create_component', { nodeIds: [card] })
    const inCard = await instance(b.lg, { Label: 'Go' }, card)
    return { b, card, inCard }
  }

  it('the outer instance exports Card usage, both definitions, and Card uses Button inside', async () => {
    const { card: cardId } = await card()
    const outer = await instance(cardId)
    for (const format of FORMATS) {
      const out = await jsx(outer, format)
      parses(out)
      expect(count(out, /function Button\(/g)).toBe(1)
      expect(count(out, /function Card\(/g)).toBe(1)
      expect(out).toContain('<Card />')
      // the nested instance is a usage inside Card's definition, not inlined markup
      const cardDef = out.slice(out.indexOf('function Card('), out.indexOf('function Card(') + out.slice(out.indexOf('function Card(')).search(/\n}\n/))
      expect(cardDef).toContain('<Button size="lg" label="Go" />')
    }
  })

  it('get_jsx on Card itself defines Card and Button (the one it uses) and has no usages at top level', async () => {
    const { card: cardId } = await card()
    for (const format of FORMATS) {
      const out = await jsx(cardId, format)
      parses(out)
      expect(out).toMatch(/^function (Card|Button)\(/)
      expect(count(out, /^function /gm)).toBe(2)
    }
  })
})

describe('overrides that are not properties', () => {
  it('are ignored: the same output with or without them, in both formats', async () => {
    const b = await buttonSet()
    const inst = await instance(b.frame, { Label: 'Buy' })
    const before = await Promise.all(FORMATS.map((f) => jsx(inst, f)))
    const twin = doc().nodes[inst].children.map((c) => doc().nodes[c]).find((n) => n.type === 'text')!
    await call('update_styles', { updates: [{ nodeIds: [twin.id], styles: { color: 'red', fontSize: '30px' } }] })
    const after = await Promise.all(FORMATS.map((f) => jsx(inst, f)))
    expect(after).toEqual(before)
    for (const out of after) parses(out)
    // editing the bound text itself edits the property (it is not an override), so it shows up as the Label prop
    await call('set_text_content', { updates: [{ nodeId: twin.id, textContent: 'Edited in place' }] })
    const edited = await Promise.all(FORMATS.map((f) => jsx(inst, f)))
    for (const out of edited) {
      parses(out)
      expect(out).toContain('<Button label="Edited in place" />')
    }
    // the documented way out for real overrides: detach, then it exports as plain markup with the edit
    await call('detach_instance', { nodeId: inst })
    expect(await jsx(inst, 'inline-styles')).toContain('Edited in place')
  })
})

describe('detached instances', () => {
  it('a style override travels with the instance once it is detached: plain markup, no component definition', async () => {
    const b = await buttonSet()
    const inst = await instance(b.frame, { Label: 'Buy' })
    const twin = doc().nodes[inst].children.map((c) => doc().nodes[c]).find((n) => n.type === 'text')!
    await call('update_styles', { updates: [{ nodeIds: [twin.id], styles: { fontSize: '30px' } }] })
    await call('detach_instance', { nodeId: inst })
    const plain = await jsx(inst, 'inline-styles')
    parses(plain)
    expect(plain).toContain('30')
    expect(plain).not.toContain('function Button')
  })
})

describe('odd names and values', () => {
  it('quotes, newlines and braces in values; names with spaces, digits and clashes', async () => {
    const b = await buttonSet('3d button!')
    expect((await jsx(b.frame, 'inline-styles')).startsWith('function C3dButton(')).toBe(true)
    await call('add_component_prop', { componentId: b.frame, name: 'show-icon', type: 'boolean' }) // clashes with "Show icon" -> showIcon
    await call('add_component_prop', { componentId: b.frame, name: '3D mode', type: 'text', defaultValue: 'a "quoted" \\ value' })
    const inst = await instance(b.frame, { Label: 'He said "hi"\nnew {line}', '3D mode': 'x"y' })
    for (const format of FORMATS) {
      const out = await jsx(inst, format)
      parses(out)
      const params = out.slice(out.indexOf('function C3dButton({') + 20, out.indexOf('}) {'))
      const idents = [...params.matchAll(/(\w+) =/g)].map((m) => m[1])
      expect(new Set(idents).size).toBe(idents.length) // unique identifiers
      expect(idents).toContain('showIcon')
      expect(idents.some((i) => /^[0-9]/.test(i))).toBe(false)
      expect(out).toMatch(/label=\{"He said \\"hi\\"\\nnew \{line\}"\}/) // JSON-escaped when a plain attribute string cannot hold it
    }
  })

  it('two different components with the same name get distinct definitions', async () => {
    const a = await buttonSet('Button')
    const c = S().createNode(fileId, { type: 'frame', name: 'Button', style: { width: 50, height: 50 } }, root())
    await call('create_component', { nodeIds: [c] })
    const page = wrapper()
    await instance(a.frame, {}, page)
    await instance(c, {}, page)
    for (const format of FORMATS) {
      const out = await jsx(page, format)
      parses(out)
      expect(out).toContain('function Button(')
      expect(out).toContain('function Button2(')
      expect(out).toContain('<Button />')
      expect(out).toContain('<Button2 />')
    }
  })

  it('a swap property: usage passes the component, the definition renders it', async () => {
    const b = await buttonSet()
    const star = S().createNode(fileId, { type: 'frame', name: 'Star', style: { width: 24, height: 24 } }, root())
    const heart = S().createNode(fileId, { type: 'frame', name: 'Heart', style: { width: 24, height: 24 } }, root())
    await call('create_component', { nodeIds: [star] })
    await call('create_component', { nodeIds: [heart] })
    const card = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root())
    await call('create_component', { nodeIds: [card] })
    const slot = await instance(star, {}, card)
    await call('add_component_prop', { componentId: card, name: 'Icon', type: 'swap', defaultValue: star })
    await call('bind_component_prop', { nodeId: slot, aspect: 'swap', property: 'Icon' })
    const inst = await instance(card, { Icon: heart })
    for (const format of FORMATS) {
      const out = await jsx(inst, format)
      parses(out)
      expect(out).toContain('<Card Icon={Heart} />')
      expect(out).toContain('function Card({ Icon = Star })')
      expect(out).toContain('<Icon />')
      expect(count(out, /function Heart\(/g)).toBe(1)
      expect(count(out, /function Star\(/g)).toBe(1)
    }
    expect(b.frame).toBeTruthy()
  })
})

describe('plain nodes are unchanged', () => {
  it('a node without components exports the old shape and parses', async () => {
    const f = S().createNode(fileId, { type: 'frame', name: 'Plain', style: { width: 10, height: 10 } }, root())
    S().createNode(fileId, { type: 'text', text: 'hi {there}' }, f)
    for (const format of FORMATS) {
      const out = await jsx(f, format)
      expect(out.startsWith('(\n')).toBe(true)
      expect(out).not.toContain('function ')
      parses(out)
    }
  })
})
