// T73 test station: the checked-in sample bundle (docs/handoff-sample/) and the docs that describe it stay true.
// The sample is a real export (scripts/e2e-handoff.mjs); these checks read it as a developer would and check the
// claims the README and docs/HANDOFF.md make against the code, so a doc cannot drift silently.
import { describe, expect, it } from 'vitest'
import { SCHEMA_ID, SPEC_SCHEMA } from './index'
import { BREAKPOINT_WIDTHS } from '../model/dev'

const sample = import.meta.glob('../../../../docs/handoff-sample/**/*.{md,json,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const docs = import.meta.glob(['../../../../README.md', '../../../../docs/HANDOFF.md', '../../../../docs/INSPECTOR.md', '../../../../docs/MCP.md', '../../../../mcp/src/server.ts'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const file = (suffix: string): string => {
  const hit = Object.entries(sample).find(([p]) => p.endsWith(suffix))
  if (!hit) throw new Error(`missing in the sample: ${suffix}`)
  return hit[1].replace(/\r\n/g, '\n')
}
const doc = (suffix: string): string => {
  const hit = Object.entries(docs).find(([p]) => p.endsWith(suffix))
  if (!hit) throw new Error(`missing: ${suffix}`)
  return hit[1].replace(/\r\n/g, '\n')
}

describe('docs/handoff-sample', () => {
  const spec = JSON.parse(file('/spec.json')) as {
    schema: string
    handoff: { fileName: string; version: number }
    screens: Array<{ name: string; breakpoints: Array<{ bp: string; png: string; width: number; root: { name: string } }> }>
  }

  it('is a vellum.handoff/1 bundle of one screen with two breakpoints, widest first', () => {
    expect(spec.schema).toBe(SCHEMA_ID)
    expect(spec.screens).toHaveLength(1)
    const bps = spec.screens[0].breakpoints
    expect(bps.map((b) => b.bp)).toEqual(['Tablet', 'Mobile'])
    expect(bps[0].width).toBeGreaterThan(bps[1].width)
    expect(bps.map((b) => b.png)).toEqual(['screens/checkout.tablet.png', 'screens/checkout.mobile.png'])
  })

  it('ships the current schema, and CLAUDE.md is HANDOFF.md', () => {
    expect(JSON.parse(file('/spec.schema.json'))).toEqual(JSON.parse(JSON.stringify(SPEC_SCHEMA)))
    expect(file('/CLAUDE.md')).toBe(file('/HANDOFF.md'))
    expect(file('/HANDOFF.md')).toContain("Andy's quick start")
  })

  it('has no absolute paths, user folders, profile names or leak canaries', () => {
    const bad = /[A-Za-z]:\\|\/Users\/|\/home\/|AppData|Documents and Settings|CANARY|node_modules/i
    for (const [path, text] of Object.entries(sample)) expect(text, path).not.toMatch(bad)
    expect(spec.handoff.fileName).not.toMatch(/Tester|wayne|Obi/i)
  })

  it('names every file it points at: the PNG references are in the folder, nothing refers to a file that is not there', () => {
    const md = file('/screens/checkout.md')
    for (const b of spec.screens[0].breakpoints) expect(md).toContain(b.png)
    expect(file('/HANDOFF.md')).toMatch(/screens\/checkout\.md/)
    // no CHANGES.md in a first export, and nothing says to read one
    expect(Object.keys(sample).some((p) => p.endsWith('/CHANGES.md'))).toBe(false)
    expect(file('/HANDOFF.md')).not.toMatch(/Read `CHANGES\.md` first/)
  })

  it('markdown has the layout rule before the numbers, and a table of what changes at the narrow breakpoint', () => {
    const md = file('/screens/checkout.md')
    const lines = md.split('\n')
    lines.forEach((l, i) => {
      if (/^\s*- \*\*.* — .*\*\* `/.test(l)) expect(lines[i + 1], l).toMatch(/^\s+- size[ :]/)
    })
    expect(md).toMatch(/Mobile/)
    expect(md).toMatch(/changes|only here|not here|differs/i)
    expect(md).not.toMatch(/undefined|NaN/)
  })
})

describe('what the docs claim', () => {
  it('README tool count is the number of tools the MCP server registers', () => {
    const registered = (doc('/mcp/src/server.ts').match(/server\.registerTool\(/g) ?? []).length
    const claimed = /MCP server\*\* — (\d+) tools/.exec(doc('/README.md'))
    expect(claimed, 'README names a tool count').not.toBeNull()
    expect(Number(claimed![1])).toBe(registered)
  })

  it('both handoff tools are documented where the README and MCP.md say they are', () => {
    expect(doc('/README.md')).toMatch(/get_dev_spec.*export_handoff|export_handoff.*get_dev_spec/s)
    expect(doc('/docs/MCP.md')).toContain('| `get_dev_spec` |')
    expect(doc('/docs/MCP.md')).toContain('| `export_handoff` |')
    expect(doc('/mcp/src/server.ts')).toContain("'get_dev_spec'")
    expect(doc('/mcp/src/server.ts')).toContain("'export_handoff'")
  })

  it('INSPECTOR.md breakpoint widths are the ones the app uses', () => {
    const insp = doc('/docs/INSPECTOR.md')
    for (const [name, w] of Object.entries(BREAKPOINT_WIDTHS)) expect(insp, name).toContain(`${name} ${w}`)
  })

  it('HANDOFF.md points at files that exist in the repo', () => {
    const h = doc('/docs/HANDOFF.md')
    expect(h).toContain('docs/handoff-sample/')
    for (const rel of ['handoff-sample/', 'MCP.md', 'INSPECTOR.md']) expect(h).toContain(rel)
    // the tolerance it quotes is the one HANDOFF.md of the bundle states
    expect(h).toMatch(/0\.5 px/)
    expect(file('/HANDOFF.md')).toMatch(/0\.5px/)
  })
})
