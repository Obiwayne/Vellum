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

const px = (v: number, rem: boolean): string => `${formatNumber(v)}px${rem ? ` (${toRem(v)})` : ''}`

function color(c: ColorSpec | undefined): string {
  if (!c) return 'none'
  let s = c.hex8 ?? c.value
  if (c.oklch) s += ` (authored ${c.oklch})`
  if (c.token) s += ` ${c.token}`
  return s
}

function paint(p: PaintSpec): string {
  if (p.kind === 'stroke') {
    const w = Array.isArray(p.width) ? p.width.map((x) => formatNumber(x)).join(' ') : formatNumber(p.width ?? 0)
    return `stroke ${w}px ${p.style ?? 'solid'} ${color(p.color)}`
  }
  const what = p.kind === 'text' ? 'text colour' : 'fill'
  if (p.type === 'solid') return `${what} ${color(p.color)}`
  return `${what} ${p.type} ${p.value ?? ''}`.trim()
}

function effect(e: EffectSpec): string {
  if (e.kind === 'blur' || e.kind === 'backdrop-blur') return `${e.kind} ${formatNumber(e.blur)}px`
  return `${e.kind} ${formatNumber(e.x ?? 0)} ${formatNumber(e.y ?? 0)} blur ${formatNumber(e.blur)} spread ${formatNumber(e.spread ?? 0)} ${color(e.color)}`
}

function textLine(n: DevNodeSpec, rem: boolean): string | null {
  const t = n.text
  if (!t) return null
  const parts = [`"${t.content.replace(/\n/g, ' / ')}"`]
  const face = [t.fontFamily, `${px(t.fontSize, rem)}`, `weight ${t.fontWeight}`].filter(Boolean).join(', ')
  parts.push(face)
  if (t.lineHeightPx !== null) parts.push(`line height ${px(t.lineHeightPx, false)}${t.lineHeightRatio !== null ? ` (${formatNumber(t.lineHeightRatio)})` : ''}${t.lineHeightSource !== 'authored' ? ` ${t.lineHeightSource}` : ''}`)
  if (t.letterSpacingPx) parts.push(`letter spacing ${formatNumber(t.letterSpacingPx)}px (${formatNumber(t.letterSpacingEm)}em)`)
  if (t.textAlign) parts.push(`align ${t.textAlign}`)
  if (t.textTransform) parts.push(t.textTransform)
  if (t.textDecoration) parts.push(t.textDecoration)
  if (t.fontStyle && t.fontStyle !== 'normal') parts.push(t.fontStyle)
  if (t.textStyle) parts.push(`text style ${t.textStyle}`)
  return parts.join(' · ')
}

function nodeLines(n: DevNodeSpec, depth: number, ctx: MarkdownContext, out: string[]): void {
  const pad = '  '.repeat(depth)
  const sub = `${pad}  - `
  out.push(`${pad}- **${n.name} — ${n.layout.summary}, ${sizingText(n.sizing.w, n.sizing.h)}** \`${n.id}\`${n.type === 'frame' ? '' : ` (${n.type})`}`)
  const b = n.box
  const pos = b.x !== undefined && b.y !== undefined ? `; at ${formatNumber(b.x)}, ${formatNumber(b.y)} in ${b.relTo}` : n.flowIndex !== undefined ? `; flow position ${n.flowIndex}` : ''
  out.push(`${sub}size ${px(b.width, ctx.rem)} × ${px(b.height, ctx.rem)}${pos}${b.measured ? '' : ' (not measured: from the authored style)'}`)
  if (n.layout.padding.some((v) => v)) out.push(`${sub}padding ${n.layout.padding.map((v) => px(v, ctx.rem)).join(' ')}`)
  const look: string[] = []
  for (const p of n.paints) look.push(paint(p))
  if (n.radius !== undefined) look.push(`radius ${Array.isArray(n.radius) ? n.radius.map((r) => px(r, ctx.rem)).join(' ') : typeof n.radius === 'number' ? px(n.radius, ctx.rem) : n.radius}`)
  for (const e of n.effects) look.push(effect(e))
  if (n.opacity !== undefined) look.push(`opacity ${formatNumber(n.opacity)}`)
  if (n.rotation) look.push(`rotated ${formatNumber(n.rotation)}°`)
  if (look.length) out.push(`${sub}${look.join('; ')}`)
  const text = textLine(n, ctx.rem)
  if (text) out.push(`${sub}${text}`)
  if (n.image) out.push(`${sub}image${n.image.alt !== undefined ? ` alt "${n.image.alt}"` : ' (no alt text: decorative or missing, decide)'}${n.image.objectFit ? `, fit ${n.image.objectFit}` : ''}`)
  if (n.tokens.length) out.push(`${sub}tokens: ${n.tokens.join(', ')}`)
  if (n.component) {
    const c = n.component
    const defs = ctx.components.find((d) => d.variants.some((x) => x.ref === c.ref))?.props ?? []
    const label = (id: string): string => defs.find((d) => d.id === id)?.name ?? id
    const v = c.variant ? ` (${Object.entries(c.variant).map(([k, x]) => `${label(k)}=${x}`).join(', ')})` : ''
    const p = c.props ? `, props ${Object.entries(c.props).map(([k, x]) => `${label(k)}=${String(x)}`).join(', ')}` : ''
    const o = c.overrides ? `, overrides on ${c.overrides.length} layer${c.overrides.length === 1 ? '' : 's'}` : ''
    out.push(`${sub}component ${c.name ?? c.ref}${v}${p}${o}`)
  }
  if (n.states) for (const [state, patch] of Object.entries(n.states)) out.push(`${sub}state ${state}: ${Object.entries(patch).map(([k, x]) => `${k}: ${String(x)}`).join('; ')}`)
  if (n.a11y) out.push(`${sub}accessibility: ${Object.entries(n.a11y).map(([k, x]) => `${k} ${String(x)}`).join(', ')}`)
  for (const note of n.notes ?? []) out.push(`${sub}dev note: ${note.replace(/\n/g, ' ')}`)
  if (n.needsDecision) out.push(`${sub}**needs decision:** ${n.needsDecision}`)
  for (const c of n.children) nodeLines(c, depth + 1, ctx, out)
}

function assetLines(ids: Set<string>, ctx: MarkdownContext): string[] {
  const used = ctx.assets.filter((a) => a.nodeIds.some((id) => ids.has(id)))
  if (!used.length) return []
  return ['', '### Assets', '', ...used.map((a) => `- ${a.path}${a.layerName ? ` (layer "${a.layerName}")` : ''}`)]
}

/** Layers of a screen whose measured size is fractional (build with the rule, not the number). */
export function fractionalIn(root: DevNodeSpec): Array<{ id: string; name: string; width: number; height: number }> {
  const out: Array<{ id: string; name: string; width: number; height: number }> = []
  const walk = (n: DevNodeSpec): void => {
    if (isFractional(n.box.width) || isFractional(n.box.height)) out.push({ id: n.id, name: n.name, width: n.box.width, height: n.box.height })
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
  const out: string[] = [`# ${screen.name}`, '']
  out.push(`Screen \`${screen.id}\`, ${screen.breakpoints.length} breakpoint${screen.breakpoints.length === 1 ? '' : 's'}. Build to the layout rules first; the numbers describe the design size.`, '')
  for (const bp of screen.breakpoints) {
    const heading = bp.bp === 'default' ? 'Layout' : bp.bp
    out.push(`## ${heading} · ${px(bp.width, ctx.rem)} wide`, '')
    out.push(`Frame \`${bp.frameId}\`${bp.ready ? ` · ready in handoff v${bp.ready.at}` : ''} · reference \`${bp.png}\``, '')
    const frac = fractionalIn(bp.root)
    if (frac.length) {
      const e = frac[0]
      out.push(`> ${frac.length} node${frac.length === 1 ? ' has' : 's have'} fractional sizes (e.g. ${formatNumber(e.width)} × ${formatNumber(e.height)} for "${e.name}"); build with the rule, not the number.`, '')
    }
    nodeLines(bp.root, 0, ctx, out)
    out.push(...assetLines(idsOf(bp.root), ctx))
    out.push('')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

export function componentMarkdown(c: ComponentSpec, ctx: MarkdownContext): string {
  const out: string[] = [`# ${c.name}`, '']
  const users = c.usedBy.map((id) => ctx.screens.find((s) => s.id === id)?.name ?? id)
  out.push(`${c.isSet ? 'Component set' : 'Component'} \`${c.ref}\`. Used by: ${users.length ? users.join(', ') : 'no exported screen'}.`, '')
  for (const note of c.notes) out.push(`> Dev note: ${note.replace(/\n/g, ' ')}`, '')
  if (c.props.length) {
    out.push('## Properties', '', '| Property | Type | Default | Options |', '|---|---|---|---|')
    for (const p of c.props) out.push(`| ${p.name} | ${p.type} | ${String(p.default)} | ${(p.options ?? []).join(', ')} |`)
    out.push('')
  }
  out.push('## Variants', '')
  for (const v of c.variants) {
    const vals = Object.entries(v.values).map(([k, x]) => `${c.props.find((p) => p.id === k)?.name ?? k}=${x}`)
    out.push(`### ${v.name}${vals.length ? ` (${vals.join(', ')})` : ''}`, '')
    nodeLines(v.root, 0, ctx, out)
    out.push('')
  }
  if (c.states.length || c.interactive) {
    out.push('## States', '', '| State | How it is specified |', '|---|---|')
    for (const s of c.states) out.push(`| ${s.state} | ${s.badge === 'drawn' ? 'drawn (a variant)' : s.badge === 'described' ? 'described (state rule on the component)' : 'missing: not specified, use the project default'} |`)
    if (!c.states.length) out.push('| (none) | states not specified; use the project defaults |')
    out.push('')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

