// Colour utilities (sRGB). r,g,b 0-255, a 0-1, h 0-360, s/v/l 0-100.
export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}
export interface HSV {
  h: number
  s: number
  v: number
}
export interface HSL {
  h: number
  s: number
  l: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

let ctx: CanvasRenderingContext2D | null = null

/** Parse any CSS colour (hex, rgb(), hsl(), named, oklch via the browser). Null if invalid. */
export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input) return null
  const s = input.trim()
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s)
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: clamp(a, 0, 1) }
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (typeof document === 'undefined') return null
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#010203'
  ctx.fillStyle = s
  const out = String(ctx.fillStyle)
  if (out === '#010203' && s.toLowerCase() !== '#010203') return null
  return out.startsWith('#') || out.startsWith('rgb') ? parseColor(out) : null
}

const hex2 = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase()

/** 'RRGGBB' (no #). */
export const toHex6 = (c: RGBA): string => `${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

/** '#RRGGBB', or '#RRGGBBAA' when alpha < 1 — the format we store in node styles. */
export function formatColor(c: RGBA): string {
  const a = clamp(c.a, 0, 1)
  return a >= 1 ? `#${toHex6(c)}` : `#${toHex6(c)}${hex2(a * 255)}`
}

export function rgbToHsv({ r, g, b }: RGBA): HSV {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 }
}

export function hsvToRgb({ h, s, v }: HSV, a = 1): RGBA {
  const S = s / 100
  const V = v / 100
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return V - V * S * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255), a }
}

export function rgbToHsl({ r, g, b }: RGBA): HSL {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: HSL, a = 1): RGBA {
  const S = s / 100
  const L = l / 100
  const k = (n: number): number => (n + h / 30) % 12
  const A = S * Math.min(L, 1 - L)
  const f = (n: number): number => L - A * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a }
}

/** CSS rgba() string for rendering swatches. */
export const cssRgba = (c: RGBA): string => `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`

/** Extract the token name from 'var(--x)' / 'var(--x, fallback)'. */
export function tokenRef(value: string | number | undefined): string | null {
  if (typeof value !== 'string') return null
  const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim())
  return m ? m[1] : null
}
