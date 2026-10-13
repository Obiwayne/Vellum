// Markdown specs: screens/<slug>.md and components/<slug>.md. Per node the layout intent comes first (the rule),
// the measured numbers second, as docs/factory/T58-plan.md sections 4 and 10 ask.
import { formatNumber, isFractional, sizingText, toRem, type ColorSpec, type EffectSpec, type PaintSpec } from '../model/devSpec'
import type { AssetRecord, ComponentSpec, DevNodeSpec, ScreenSpec } from './types'

export interface MarkdownContext {
  rem: boolean
  assets: AssetRecord[]
  /** screens, to name a component's users */
  screens: ScreenSpec[]
  /** components, to name variant and prop ids */
  components: ComponentSpec[]
}

// Layer names, notes and text come from the document and may hold anything. Before they are printed they are
// folded to one line (no line breaks, control, line-separator or bidi characters), and anything that could start
// a block or embed something is escaped: a leading #, fence, quote or list marker, `[`, a backtick, `<`, and `|` in cells.
const BS = String.fromCharCode(92)
const CONTROL = new RegExp(
  '[' + [[0, 31], [127, 159], [173, 173], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + (a === b ? '' : '-' + String.fromCharCode(b))).join('') + ']+',
  'g'
)

/** Text for the middle of a line: folded to one line, with anything that embeds or opens a span escaped. */
export function flat(value: unknown): string {
  const t = String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  // `[` covers images (`![`) and links alike; a backtick would open a code span that swallows the rest of the line
  return t.split('[').join(BS + '[').split('`').join(BS + '`').split('<').join('&lt;')
}

/** One printable line of markdown-safe text, safe also at the start of a line (no heading, fence, quote or list). */
export function inline(value: unknown): string {
  const t = flat(value)
  return /^(#|```|~~~|>|[-+*] |[0-9]+[.)] )/.test(t) ? BS + t : t
}

/** Same, for a table cell. */
export const cell = (value: unknown): string => inline(value).split('|').join(BS + '|')

/** A bundle path printed inside backticks. */
export const pathText = (value: unknown): string => String(value ?? '').replace(/[^A-Za-z0-9_.@/-]/g, '_')

/** A generated id printed inside backticks: only id characters survive. */
export const idText = (value: unknown): string => String(value ?? '').replace(/[^A-Za-z0-9_.:-]/g, '_')

const px = (v: number, rem: boolean): string => `${formatNumber(v)}px${rem ? ` (${toRem(v)})` : ''}`

function color(c: ColorSpec | undefined): string {
  if (!c) return 'none'
  let s = flat(c.hex8 ?? c.value)
  if (c.oklch) s += ` (authored ${flat(c.oklch)})`
  if (c.token) s += ` ${flat(c.token)}`
  return s
}

function paint(p: PaintSpec): string {
  if (p.kind === 'stroke') {
    const w = Array.isArray(p.width) ? p.width.map((x) => formatNumber(x)).join(' ') : formatNumber(p.width ?? 0)
    return `stroke ${w}px ${inline(p.style ?? 'solid')} ${color(p.color)}`
  }
  const what = p.kind === 'text' ? 'text colour' : 'fill'
  if (p.type === 'solid') return `${what} ${color(p.color)}`
  return `${what} ${p.type} ${inline(p.value ?? '')}`.trim()
}

function effect(e: EffectSpec): string {
  if (e.kind === 'blur' || e.kind === 'backdrop-blur') return `${e.kind} ${formatNumber(e.blur)}px`
  return `${e.kind} ${formatNumber(e.x ?? 0)} ${formatNumber(e.y ?? 0)} blur ${formatNumber(e.blur)} spread ${formatNumber(e.spread ?? 0)} ${color(e.color)}`
}

function textLine(n: DevNodeSpec, rem: boolean): string | null {
  const t = n.text
  if (!t) return null
  const parts = [`"${inline(t.content.split('\n').join(' / '))}"`]
  const face = [t.fontFamily ? inline(t.fontFamily) : '', `${px(t.fontSize, rem)}`, `weight ${inline(t.fontWeight)}`].filter(Boolean).join(', ')
  parts.push(face)
  if (t.lineHeightPx !== null) parts.push(`line height ${px(t.lineHeightPx, false)}${t.lineHeightRatio !== null ? ` (${formatNumber(t.lineHeightRatio)})` : ''}${t.lineHeightSource !== 'authored' ? ` ${t.lineHeightSource}` : ''}`)
  if (t.letterSpacingPx) parts.push(`letter spacing ${formatNumber(t.letterSpacingPx)}px (${formatNumber(t.letterSpacingEm)}em)`)
  if (t.textAlign) parts.push(`align ${inline(t.textAlign)}`)
  if (t.textTransform) parts.push(inline(t.textTransform))
  if (t.textDecoration) parts.push(inline(t.textDecoration))
  if (t.fontStyle && t.fontStyle !== 'normal') parts.push(inline(t.fontStyle))
  if (t.textStyle) parts.push(`text style ${inline(t.textStyle)}`)
  return parts.join(' · ')
}

function nodeLines(n: DevNodeSpec, depth: number, ctx: MarkdownContext, out: string[]): void {
  const pad = '  '.repeat(depth)
  const sub = `${pad}  - `
  out.push(`${pad}- **${inline(n.name)} — ${inline(n.layout.summary)}, ${sizingText(n.sizing.w, n.sizing.h)}** \`${idText(n.id)}\`${n.type === 'frame' ? '' : ` (${n.type})`}`)
  const b = n.box
  const pos = b.x !== undefined && b.y !== undefined ? `; at ${formatNumber(b.x)}, ${formatNumber(b.y)} in ${b.relTo}` : n.flowIndex !== undefined ? `; flow position ${n.flowIndex}` : ''
  const known = b.width !== undefined && b.height !== undefined
  const size = known
    ? `size ${px(b.width as number, ctx.rem)} × ${px(b.height as number, ctx.rem)}`
    : b.width === undefined && b.height === undefined
      ? 'size: fit content (not measured)'
      : `size: ${b.width !== undefined ? `width ${px(b.width, ctx.rem)}` : `height ${px(b.height as number, ctx.rem)}`}, the other axis fits its content (not measured)`
  out.push(`${sub}${size}${pos}${b.measured || !known ? '' : ' (not measured: from the authored style)'}`)
  if (n.layout.padding.some((v) => v)) out.push(`${sub}padding ${n.layout.padding.map((v) => px(v, ctx.rem)).join(' ')}`)
  const look: string[] = []
  for (const p of n.paints) look.push(paint(p))
  if (n.radius !== undefined) look.push(`radius ${Array.isArray(n.radius) ? n.radius.map((r) => px(r, ctx.rem)).join(' ') : typeof n.radius === 'number' ? px(n.radius, ctx.rem) : inline(n.radius)}`)
  for (const e of n.effects) look.push(effect(e))
  if (n.opacity !== undefined) look.push(`opacity ${formatNumber(n.opacity)}`)
  if (n.rotation) look.push(`rotated ${formatNumber(n.rotation)}°`)
  if (look.length) out.push(`${sub}${look.join('; ')}`)
  const text = textLine(n, ctx.rem)
  if (text) out.push(`${sub}${text}`)
  if (n.image) out.push(`${sub}image${n.image.alt !== undefined ? ` alt "${inline(n.image.alt)}"` : ' (no alt text: decorative or missing, decide)'}${n.image.objectFit ? `, fit ${inline(n.image.objectFit)}` : ''}`)
  if (n.tokens.length) out.push(`${sub}tokens: ${n.tokens.map(inline).join(', ')}`)
  if (n.component) {
    const c = n.component
    const defs = ctx.components.find((d) => d.variants.some((x) => x.ref === c.ref))?.props ?? []
    const label = (id: string): string => inline(defs.find((d) => d.id === id)?.name ?? id)
    const v = c.variant ? ` (${Object.entries(c.variant).map(([k, x]) => `${label(k)}=${inline(x)}`).join(', ')})` : ''
    const p = c.props ? `, props ${Object.entries(c.props).map(([k, x]) => `${label(k)}=${inline(x)}`).join(', ')}` : ''
    const o = c.overrides ? `, overrides on ${c.overrides.length} layer${c.overrides.length === 1 ? '' : 's'}` : ''
    out.push(`${sub}component ${inline(c.name ?? c.ref)}${v}${p}${o}`)
  }
  if (n.contrast?.length) {
    const parts = n.contrast.map((r) => `${inline(r.mode)} ${formatNumber(r.ratio)}:1 ${r.aa ? (r.aaa ? 'AAA' : 'AA') : 'fails AA'}${r.large ? ' (large text)' : ''}`)
    out.push(`${sub}contrast: ${parts.join(' · ')}`)
  } else if (n.contrastNote) out.push(`${sub}contrast: not computed (${inline(n.contrastNote)})`)
  if (n.states) for (const [state, patch] of Object.entries(n.states)) out.push(`${sub}state ${inline(state)}: ${Object.entries(patch).map(([k, x]) => `${inline(k)}: ${inline(x)}`).join('; ')}`)
  if (n.a11y) out.push(`${sub}accessibility: ${Object.entries(n.a11y).map(([k, x]) => `${inline(k)} ${inline(x)}`).join(', ')}`)
  for (const note of n.notes ?? []) out.push(`${sub}dev note: ${inline(note)}`)
  if (n.needsDecision) out.push(`${sub}**needs decision:** ${inline(n.needsDecision)}`)
  for (const c of n.children) nodeLines(c, depth + 1, ctx, out)
}

function assetLines(ids: Set<string>, ctx: MarkdownContext): string[] {
  const used = ctx.assets.filter((a) => a.nodeIds.some((id) => ids.has(id)))
  if (!used.length) return []
  return ['', '### Assets', '', ...used.map((a) => `- ${a.path}${a.layerName ? ` (layer "${inline(a.layerName)}")` : ''}`)]
}

/** Layers of a screen whose measured size is fractional (build with the rule, not the number). */
export function fractionalIn(root: DevNodeSpec): Array<{ id: string; name: string; width: number; height: number }> {
  const out: Array<{ id: string; name: string; width: number; height: number }> = []
  const walk = (n: DevNodeSpec): void => {
    if ((n.box.width !== undefined && isFractional(n.box.width)) || (n.box.height !== undefined && isFractional(n.box.height))) out.push({ id: n.id, name: n.name, width: n.box.width ?? 0, height: n.box.height ?? 0 })
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

const idsOf = (root: DevNodeSpec): Set<string> => {
  const s = new Set<string>()
  const walk = (n: DevNodeSpec): void => {
    s.add(n.id)
    n.children.forEach(walk)
  }
  walk(root)
  return s
}

export function screenMarkdown(screen: ScreenSpec, ctx: MarkdownContext): string {
  const out: string[] = [`# ${inline(screen.name)}`, '']
  out.push(`Screen \`${idText(screen.id)}\`, ${screen.breakpoints.length} breakpoint${screen.breakpoints.length === 1 ? '' : 's'}. Build to the layout rules first; the numbers describe the design size.`, '')
  for (const bp of screen.breakpoints) {
    const heading = bp.bp === 'default' ? 'Layout' : inline(bp.bp)
    out.push(bp.width !== undefined ? `## ${heading} · ${px(bp.width, ctx.rem)} wide` : `## ${heading} · width fits its content (not measured)`, '')
    out.push(`Frame \`${idText(bp.frameId)}\`${bp.ready ? ` · ready in handoff v${bp.ready.at}` : ''} · reference \`${pathText(bp.png)}\``, '')
    const frac = fractionalIn(bp.root)
    if (frac.length) {
      const e = frac[0]
      out.push(`> ${frac.length} node${frac.length === 1 ? ' has' : 's have'} fractional sizes (e.g. ${formatNumber(e.width)} × ${formatNumber(e.height)} for "${inline(e.name)}"); build with the rule, not the number.`, '')
    }
    nodeLines(bp.root, 0, ctx, out)
    out.push(...assetLines(idsOf(bp.root), ctx))
    out.push('')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

export function componentMarkdown(c: ComponentSpec, ctx: MarkdownContext): string {
  const out: string[] = [`# ${inline(c.name)}`, '']
  const users = c.usedBy.map((id) => ctx.screens.find((s) => s.id === id)?.name ?? id)
  out.push(`${c.isSet ? 'Component set' : 'Component'} \`${idText(c.ref)}\`. Used by: ${users.length ? users.map(inline).join(', ') : 'no exported screen'}.`, '')
  for (const note of c.notes) out.push(`> Dev note: ${inline(note)}`, '')
  if (c.props.length) {
    out.push('## Properties', '', '| Property | Type | Default | Options |', '|---|---|---|---|')
    for (const p of c.props) out.push(`| ${cell(p.name)} | ${cell(p.type)} | ${cell(p.default)} | ${cell((p.options ?? []).join(', '))} |`)
    out.push('')
  }
  out.push('## Variants', '')
  for (const v of c.variants) {
    const vals = Object.entries(v.values).map(([k, x]) => `${inline(c.props.find((p) => p.id === k)?.name ?? k)}=${inline(x)}`)
    out.push(`### ${inline(v.name)}${vals.length ? ` (${vals.join(', ')})` : ''}`, '')
    nodeLines(v.root, 0, ctx, out)
    out.push('')
  }
  if (c.states.length || c.interactive) {
    out.push('## States', '', '| State | How it is specified | Maps to | What changes |', '|---|---|---|---|')
    for (const s of c.states) {
      const how = s.badge === 'drawn' ? 'drawn (a variant)' : s.badge === 'described' ? 'described (state rule on the component)' : 'missing: not specified, use the project default'
      out.push(`| ${cell(s.state)} | ${how} | ${cell(s.target ?? '')} | ${cell((s.changes ?? []).join('; '))} |`)
    }
    if (!c.states.length) out.push('| (none) | states not specified; use the project defaults | | |')
    out.push('')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

