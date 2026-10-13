// SVG icons for the bundle: sanitise, optimise with svgo (fixed config, so output is stable) and turn a single
// paint colour into `currentColor` so the icon follows the text colour. Pure: markup in, markup out.
import { optimize } from 'svgo'
import { sanitizeSvgMarkup } from '../../model/sanitize'

export interface IconResult {
  svg: string
  /** the single colour was replaced by `currentColor` */
  recoloured: boolean
  /** the colour that was replaced */
  was?: string
  /** more than one paint colour (or a gradient/pattern): left as drawn */
  multiColour: boolean
}

/** Root attributes of an `svg` node that matter for how it draws; everything else is dropped. */
const ROOT_ATTRS = ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'preserveAspectRatio']

const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A complete `<svg>` document from a node's inner markup and root attributes. `size` is the layout box, for a missing viewBox. */
export function iconDocument(inner: string, attrs: Record<string, string> | undefined, size?: { width: number; height: number }): string {
  const parts = ['xmlns="http://www.w3.org/2000/svg"']
  const a = attrs ?? {}
  let viewBox = a.viewBox
  if (!viewBox && size && size.width > 0 && size.height > 0) viewBox = `0 0 ${size.width} ${size.height}`
  if (viewBox) parts.push(`viewBox="${esc(viewBox)}"`)
  for (const k of ROOT_ATTRS) if (k !== 'viewBox' && a[k] !== undefined && a[k] !== '') parts.push(`${k}="${esc(a[k])}"`)
  return `<svg ${parts.join(' ')}>${sanitizeSvgMarkup(inner)}</svg>`
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000' }

/** Lower-case comparable form of a colour: #rgb expands, known names map to hex, everything else is trimmed. */
function norm(c: string): string {
  const v = c.trim().toLowerCase()
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
  return NAMED[v] ?? v
}

const NO_PAINT = new Set(['none', 'transparent', 'currentcolor', 'inherit'])

/** Every paint value of fill / stroke (attributes and inline style), normalised. Gradients and patterns stay `url(...)`. */
export function paintColours(svg: string): string[] {
  const out: string[] = []
  for (const m of svg.matchAll(/\s(?:fill|stroke)\s*=\s*"([^"]*)"/gi)) out.push(norm(m[1]))
  for (const m of svg.matchAll(/(?:^|[;\s"'])(?:fill|stroke)\s*:\s*([^;"'}]+)/gi)) out.push(norm(m[1]))
  return out
}

/** The single paint colour of an icon, `null` when it has none or more than one (or a gradient). */
export function monochrome(svg: string): { colour: string } | { colour: null; multi: boolean } {
  if (/<style[\s>]/i.test(svg)) return { colour: null, multi: true }
  const all = paintColours(svg)
  if (all.some((c) => /^url\(/.test(c))) return { colour: null, multi: true }
  const paints = [...new Set(all.filter((c) => c && !NO_PAINT.has(c)))]
  if (paints.length === 1) return { colour: paints[0] }
  return { colour: null, multi: paints.length > 1 }
}

/** Why optimised output is not safe to write, or null. Last line of defence after sanitising. */
export function unsafeSvg(svg: string): string | null {
  if (/<\s*(script|foreignobject|iframe|object|embed)\b/i.test(svg)) return 'active element'
  if (/\son[a-z]+\s*=/i.test(svg)) return 'event handler'
  if (/javascript:|vbscript:/i.test(svg)) return 'script URL'
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:text)/i.test(svg)) return 'external reference'
  if (/url\(\s*["']?\s*(?:https?:|\/\/)/i.test(svg)) return 'external url()'
  return null
}

/** Recolour: every fill / stroke that is `colour` becomes `currentColor`. */
function recolour(svg: string, colour: string): string {
  const swap = (v: string): string => (norm(v) === colour ? 'currentColor' : v)
  return svg
    .replace(/(\s(?:fill|stroke)\s*=\s*")([^"]*)(")/gi, (_m, a: string, v: string, z: string) => a + swap(v) + z)
    .replace(/((?:^|[;\s"'])(?:fill|stroke)\s*:\s*)([^;"'}]+)/gi, (_m, a: string, v: string) => a + swap(v))
}

/** Sanitised, optimised and (when single-colour) recoloured SVG text, or null when the result is not safe. */
export function optimiseSvg(markup: string): IconResult | null {
  let data: string
  try {
    data = optimize(markup, {
      multipass: true,
      plugins: [
        'preset-default',
        'removeScripts',
        'removeDimensions',
        'convertStyleToAttrs',
        { name: 'prefixIds', params: { prefix: 'i', delim: '-' } }
      ]
    }).data
  } catch {
    return null
  }
  if (unsafeSvg(data)) return null
  const mono = monochrome(data)
  if (mono.colour) return { svg: recolour(data, mono.colour), recoloured: true, was: mono.colour, multiColour: false }
  return { svg: data, recoloured: false, multiColour: 'multi' in mono && mono.multi }
}
