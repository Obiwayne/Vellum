// HANDOFF.md (also written as CLAUDE.md, byte for byte), fonts.md and .handoff.json.
// docs/factory/T58-plan.md section 3.2 is the template; only files that exist in this bundle are mentioned.
import type { Collected } from './collect'
import { walkSpec } from './collect'
import { STATE_SCHEMA_ID, type HandoffOptions, type HandoffSpec, type HandoffSummary } from './types'

export function handoffMd(spec: HandoffSpec, c: Collected, s: HandoffSummary, options: HandoffOptions, files: string[]): string {
  const has = (p: string): boolean => files.includes(p)
  const first = c.screens[0]
  const o: string[] = []
  o.push(`# ${spec.handoff.fileName} — handoff v${spec.handoff.version}`, '')
  o.push("> ## Andy's quick start")
  o.push('> 1. Drop this folder next to your repo (outside it is fine; nothing here runs).')
  o.push(`> 2. Tell Claude Code: "build ${first ? `screens/${first.slug}.md` : 'the screens in screens/'} from this handoff".`)
  o.push(`> 3. Verify the result against the PNGs in screens/. Handoff v${spec.handoff.version}, ${s.screens} screen${s.screens === 1 ? '' : 's'}.`, '')
  o.push(`Exported ${spec.handoff.exportedAt} from Vellum ${spec.handoff.vellum}. Schema \`${spec.schema}\`.`, '')

  o.push('## What is in here', '')
  o.push(`- ${s.screens} screen${s.screens === 1 ? '' : 's'} (${s.breakpoints} breakpoint${s.breakpoints === 1 ? '' : 's'}), ${s.nodes} layers, ${s.components} component${s.components === 1 ? '' : 's'}, ${s.tokens} token${s.tokens === 1 ? '' : 's'}, ${s.textStyles} text style${s.textStyles === 1 ? '' : 's'}, ${s.fonts} font famil${s.fonts === 1 ? 'y' : 'ies'}, ${s.assets} asset${s.assets === 1 ? '' : 's'}.`)
  o.push(`- Dev notes: ${s.notes}. Open decisions: ${s.needsDecision}.`)
  if (spec.modes.length) o.push(`- Theme modes: ${spec.modes.join(', ')} (the first is the base).`)
  o.push('')

  o.push('## Read order', '')
  const order = ['HANDOFF.md', 'tokens/tokens.css', 'tokens/tokens.json', 'tokens/tailwind.css', ...c.components.map((x) => `components/${x.slug}.md`), ...c.screens.map((x) => `screens/${x.slug}.md`), 'fonts.md', 'spec.json']
  o.push(...order.filter(has).map((p, i) => `${i + 1}. \`${p}\``), '')

  o.push('## Rules', '')
  o.push('1. **Stack-neutral.** Build with the project\'s framework. Map the tokens to the project\'s theme: the values in `tokens/` are the truth, the names are suggestions. Reuse existing components before creating new ones. Never hard-code a value that has a token.')
  o.push('2. **Layout intent first.** Each layer lists its rule (flex or grid, Fixed / Fit / Fill, min and max, constraints) before its numbers. Never turn intent into absolute pixel positions. The px values in `spec.json` are the design-time size.')
  o.push('3. **Verify.** Render each screen at the design width and compare with the PNG in `screens/`. Tolerance: layout within 0.5px, text on the same line breaks, colours exact. List what differs; do not tweak the design silently.')
  o.push('4. **Precision.** Values are measured and kept to 2 decimals with trailing zeros trimmed (`347.5`, never `348`). Fractional sizes are flagged: build with the rule, not the number.')
  o.push('5. **Ask or flag.** Anything marked `needs decision` or `dev note` goes into the PR description; do not guess.')
  if (has('CHANGES.md')) o.push('6. **Updates.** Read `CHANGES.md` first and rebuild only what it lists.')
  o.push('')

  if (s.needsDecision) {
    o.push('## Open decisions', '')
    for (const sc of c.screens) {
      for (const b of sc.breakpoints) {
        walkSpec(b.root, (n) => {
          if (n.needsDecision) o.push(`- ${sc.name}${b.bp === 'default' ? '' : ` (${b.bp})`} › ${n.name}: ${n.needsDecision}`)
        })
      }
    }
    for (const comp of c.components) {
      for (const v of comp.variants) {
        walkSpec(v.root, (n) => {
          if (n.needsDecision) o.push(`- Component ${comp.name} › ${n.name}: ${n.needsDecision}`)
        })
      }
    }
    o.push('')
  }

  const unspecified = c.components.filter((x) => x.interactive && x.states.some((st) => st.badge === 'missing'))
  if (unspecified.length) {
    o.push('## States not specified', '')
    o.push('These interactive components have no drawn or described hover, pressed, focus or disabled state. Use the project defaults and say so; do not invent a look.', '')
    for (const u of unspecified) o.push(`- ${u.name}: ${u.states.filter((st) => st.badge === 'missing').map((st) => st.state).join(', ')}`)
    o.push('')
  }

  if (c.warnings.length) {
    o.push('## Warnings', '', ...c.warnings.map((w) => `- ${w}`), '')
  }
  if (s.unmeasured) o.push(`> ${s.unmeasured} layer${s.unmeasured === 1 ? ' was' : 's were'} not measured: their sizes come from the authored style. Treat them as intent.`, '')
  if (options.rem) o.push('> Markdown values print rem beside px (base 16).', '')
  return o.join('\n').replace(/\n+$/, '\n')
}

export function fontsMd(c: Collected): string {
  const o: string[] = ['# Fonts', '']
  if (!c.fonts.length) {
    o.push('No text layers in the exported frames.')
    return o.join('\n') + '\n'
  }
  o.push('Font files are not part of this bundle. Install or load the families below, or substitute a licensed equivalent and say so.', '')
  o.push('| Family | Weights | Italic | Source | Used by | CSS stack |', '|---|---|---|---|---|---|')
  for (const f of c.fonts) o.push(`| ${f.family} | ${f.weights.join(', ')} | ${f.italic ? 'yes' : 'no'} | ${f.source} | ${f.usedBy} layer${f.usedBy === 1 ? '' : 's'} | \`${f.stack}\` |`)
  o.push('')
  for (const f of c.fonts) {
    if (f.source === 'google') o.push(`- **${f.family}**: Google Fonts (SIL OFL or Apache 2.0 depending on the family). Check https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`)
    else if (f.source === 'system') o.push(`- **${f.family}**: a system or generic family; the build environment decides the face.`)
    else if (f.source === 'local') o.push(`- **${f.family}**: installed on the designer's PC. It is not bundled and not redistributable: license it or substitute.`)
    else o.push(`- **${f.family}**: source unknown. Check its licence before shipping it.`)
  }
  return o.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// .handoff.json: what the next export diffs against (per-frame content hashes). Humans can ignore it.

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
    return `{${e.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** 64 bits of FNV-1a as 16 hex digits (two 32-bit lanes with different seeds). Not cryptographic: change detection only. */
export function contentHash(v: unknown): string {
  const s = stable(v)
  let a = 0x811c9dc5
  let b = 0x9e3779b1
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    a = Math.imul(a ^ ch, 0x01000193) >>> 0
    b = Math.imul(b ^ ch, 0x85ebca6b) >>> 0
    b = (b ^ (b >>> 13)) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export function handoffState(spec: HandoffSpec): string {
  const screens: Record<string, Record<string, string>> = {}
  for (const s of spec.screens) {
    const frames: Record<string, string> = {}
    for (const b of s.breakpoints) frames[b.frameId] = contentHash(b.root)
    screens[s.slug] = frames
  }
  const components: Record<string, string> = {}
  for (const c of spec.components) components[c.slug] = contentHash({ props: c.props, variants: c.variants, states: c.states, notes: c.notes })
  const state = {
    schema: STATE_SCHEMA_ID,
    version: spec.handoff.version,
    screens,
    components,
    tokens: contentHash(spec.tokens),
    textStyles: contentHash(spec.textStyles),
    assets: contentHash(spec.assets)
  }
  return JSON.stringify(state, null, 2) + '\n'
}
