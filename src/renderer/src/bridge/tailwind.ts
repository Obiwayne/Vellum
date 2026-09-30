// Style → Tailwind v4 classes for get_jsx({format:'tailwind'}). Anything without a clean utility
// becomes an arbitrary value/property class, so the output is always complete.
import { cssValue, toKebab } from '../model/html'
import type { Style } from '../model/types'

const arb = (v: string): string => v.trim().replace(/\s+/g, '_')

/** 16px → "4" on the v4 spacing scale (multiples of 2px), else "[16px]". */
function spacing(v: string | number): string {
  const s = typeof v === 'number' ? `${v}px` : v.trim()
  const m = /^(-?\d*\.?\d+)px$/.exec(s)
  if (m) {
    const n = parseFloat(m[1])
    if (n === 0) return '0'
    if (n === 1) return 'px'
    if (n > 0 && Number.isInteger(n / 2)) return String(n / 4)
  }
  const t = tokenRef(s, '--spacing-')
  if (t) return t
  return `[${arb(s)}]`
}

/** var(--color-primary) → "primary" for the given namespace; any other var → "(--x)". */
function tokenRef(v: string, ns: string): string | null {
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim())
  if (!m) return null
  if (m[1].startsWith(ns)) return m[1].slice(ns.length)
  return `(${m[1]})`
}

function color(prefix: string, v: string): string {
  const s = v.trim()
  const t = tokenRef(s, '--color-')
  if (t) return `${prefix}-${t}`
  const lower = s.toLowerCase()
  if (lower === '#fff' || lower === '#ffffff' || lower === 'white') return `${prefix}-white`
  if (lower === '#000' || lower === '#000000' || lower === 'black') return `${prefix}-black`
  if (lower === 'transparent') return `${prefix}-transparent`
  if (lower === 'currentcolor') return `${prefix}-current`
  return `${prefix}-[${arb(s)}]`
}

const FONT_SIZES: Record<number, string> = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl' }
const WEIGHTS: Record<number, string> = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' }
const RADII: Record<number, string> = { 2: 'xs', 4: 'sm', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl', 32: '4xl' }
const ALIGN: Record<string, string> = { 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', stretch: 'stretch', baseline: 'baseline' }
const JUSTIFY: Record<string, string> = { ...ALIGN, 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', normal: 'normal' }

function px(v: string | number): number | null {
  if (typeof v === 'number') return v
  const m = /^(-?\d*\.?\d+)px$/.exec(v.trim())
  return m ? parseFloat(m[1]) : null
}

function size(prefix: string, v: string | number): string {
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '100%') return `${prefix}-full`
    if (s === 'fit-content') return `${prefix}-fit`
    if (s === 'auto') return `${prefix}-auto`
    if (s === 'min-content') return `${prefix}-min`
    if (s === 'max-content') return `${prefix}-max`
    if (s === '100vw' && prefix === 'w') return 'w-screen'
    if (s === '100vh' && prefix === 'h') return 'h-screen'
    const t = tokenRef(s, '--container-')
    if (t) return `${prefix}-${t}`
  }
  return `${prefix}-${spacing(v)}`
}

function boxShorthand(prefix: string, v: string | number): string[] {
  const parts = typeof v === 'number' ? [`${v}px`] : v.trim().split(/\s+/)
  if (parts.length === 1) return [`${prefix}-${spacing(parts[0])}`]
  const [t, r = t, b = t, l = r] = parts
  if (t === b && r === l) return [`${prefix}y-${spacing(t)}`, `${prefix}x-${spacing(r)}`]
  return [`${prefix}t-${spacing(t)}`, `${prefix}r-${spacing(r)}`, `${prefix}b-${spacing(b)}`, `${prefix}l-${spacing(l)}`]
}

function neg(prefix: string, v: string | number): string {
  const n = px(v)
  if (n !== null && n < 0) return `-${prefix}-${spacing(-n)}`
  return `${prefix}-${spacing(v)}`
}

export function styleToTailwind(style: Style): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(style)) {
    if (v === '' || v === undefined || v === null) continue
    const s = typeof v === 'string' ? v.trim() : v
    const str = String(s)
    switch (k) {
      case 'display':
        out.push(str === 'none' ? 'hidden' : str)
        continue
      case 'flexDirection':
        out.push({ row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' }[str] ?? `[flex-direction:${arb(str)}]`)
        continue
      case 'flexWrap':
        out.push(str === 'wrap' ? 'flex-wrap' : str === 'nowrap' ? 'flex-nowrap' : 'flex-wrap-reverse')
        continue
      case 'alignItems':
        out.push(ALIGN[str] ? `items-${ALIGN[str]}` : `[align-items:${arb(str)}]`)
        continue
      case 'alignSelf':
        out.push(ALIGN[str] ? `self-${ALIGN[str]}` : str === 'auto' ? 'self-auto' : `[align-self:${arb(str)}]`)
        continue
      case 'justifyContent':
        out.push(JUSTIFY[str] ? `justify-${JUSTIFY[str]}` : `[justify-content:${arb(str)}]`)
        continue
      case 'alignContent':
        out.push(JUSTIFY[str] ? `content-${JUSTIFY[str]}` : `[align-content:${arb(str)}]`)
        continue
      case 'gap':
        out.push(`gap-${spacing(s)}`)
        continue
      case 'rowGap':
        out.push(`gap-y-${spacing(s)}`)
        continue
      case 'columnGap':
        out.push(`gap-x-${spacing(s)}`)
        continue
      case 'padding':
        out.push(...boxShorthand('p', s))
        continue
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft':
        out.push(`p${k[7].toLowerCase()}-${spacing(s)}`)
        continue
      case 'margin':
        out.push(...boxShorthand('m', s))
        continue
      case 'width':
        out.push(size('w', s))
        continue
      case 'height':
        out.push(size('h', s))
        continue
      case 'minWidth':
        out.push(size('min-w', s))
        continue
      case 'maxWidth':
        out.push(size('max-w', s))
        continue
      case 'minHeight':
        out.push(size('min-h', s))
        continue
      case 'maxHeight':
        out.push(size('max-h', s))
        continue
      case 'flex':
        out.push(str === '1' || str === '1 1 0%' ? 'flex-1' : str === 'none' ? 'flex-none' : str === 'auto' ? 'flex-auto' : `flex-[${arb(str)}]`)
        continue
      case 'flexGrow':
        out.push(str === '1' ? 'grow' : str === '0' ? 'grow-0' : `grow-[${str}]`)
        continue
      case 'flexShrink':
        out.push(str === '1' ? 'shrink' : str === '0' ? 'shrink-0' : `shrink-[${str}]`)
        continue
      case 'flexBasis':
        out.push(size('basis', s))
        continue
      case 'position':
        out.push(str)
        continue
      case 'left':
      case 'top':
      case 'right':
      case 'bottom':
        out.push(neg(k, s))
        continue
      case 'inset':
        out.push(neg('inset', s))
        continue
      case 'zIndex':
        out.push(`z-[${str}]`)
        continue
      case 'overflow':
      case 'overflowX':
      case 'overflowY':
        out.push(`${k === 'overflow' ? 'overflow' : k === 'overflowX' ? 'overflow-x' : 'overflow-y'}-${str}`)
        continue
      case 'boxSizing':
        if (str !== 'border-box') out.push('box-content')
        continue
      case 'backgroundColor':
        out.push(color('bg', str))
        continue
      case 'background':
      case 'backgroundImage':
        out.push(/^(#|rgb|hsl|oklch|oklab|var\()/.test(str) && !str.includes('gradient') ? color('bg', str) : `bg-[${arb(str)}]`)
        continue
      case 'color':
        out.push(color('text', str))
        continue
      case 'fontFamily': {
        const t = tokenRef(str, '--font-')
        out.push(t ? `font-${t}` : `font-[${arb(str.replace(/"/g, "'"))}]`)
        continue
      }
      case 'fontSize': {
        const n = px(s)
        const t = tokenRef(str, '--text-')
        out.push(t ? `text-${t}` : n !== null && FONT_SIZES[n] ? `text-${FONT_SIZES[n]}` : `text-[${arb(cssValue(k, s))}]`)
        continue
      }
      case 'fontWeight': {
        const t = tokenRef(str, '--font-weight-')
        out.push(t ? `font-${t}` : WEIGHTS[Number(str)] ? `font-${WEIGHTS[Number(str)]}` : `font-[${arb(str)}]`)
        continue
      }
      case 'fontStyle':
        out.push(str === 'italic' ? 'italic' : 'not-italic')
        continue
      case 'lineHeight': {
        const t = tokenRef(str, '--leading-')
        if (t) out.push(`leading-${t}`)
        else if (typeof s === 'number') out.push(`leading-[${s}]`)
        else out.push(`leading-${spacing(s)}`)
        continue
      }
      case 'letterSpacing': {
        const t = tokenRef(str, '--tracking-')
        out.push(t ? `tracking-${t}` : `tracking-[${arb(cssValue(k, s))}]`)
        continue
      }
      case 'textAlign':
        out.push(`text-${str}`)
        continue
      case 'textTransform':
        out.push(str === 'none' ? 'normal-case' : str === 'capitalize' ? 'capitalize' : str)
        continue
      case 'textDecoration':
      case 'textDecorationLine':
        out.push(str === 'none' ? 'no-underline' : str === 'line-through' ? 'line-through' : str === 'underline' ? 'underline' : `[text-decoration:${arb(str)}]`)
        continue
      case 'whiteSpace':
        out.push(`whitespace-${str}`)
        continue
      case 'borderRadius': {
        const n = px(s)
        const t = tokenRef(str, '--radius-')
        out.push(t ? `rounded-${t}` : n !== null && n >= 9999 ? 'rounded-full' : n !== null && RADII[n] ? `rounded-${RADII[n]}` : n === 0 ? 'rounded-none' : `rounded-[${arb(cssValue(k, s))}]`)
        continue
      }
      case 'opacity': {
        const n = Number(str)
        out.push(!Number.isNaN(n) && Number.isInteger(n * 100) ? `opacity-${Math.round(n * 100)}` : `opacity-[${arb(str)}]`)
        continue
      }
      case 'objectFit':
        out.push(`object-${str}`)
        continue
      case 'cursor':
        out.push(`cursor-${str}`)
        continue
      default:
        out.push(`[${toKebab(k)}:${arb(cssValue(k, s))}]`)
    }
  }
  return out
}
