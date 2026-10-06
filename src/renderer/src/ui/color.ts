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

// ---- oklab / oklch (CSS Color 4). The canvas fallback below hands wide-gamut colours back as oklch() text, so they are
// parsed here, without a browser: the starter theme's whole palette is oklch.

/** A number, a percentage (of `pct`), or 'none' (0) from a CSS colour component. */
function component(t: string, pct: number): number | null {
  if (t.toLowerCase() === 'none') return 0
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(t)
  if (!m) return null
  return m[2] ? (parseFloat(m[1]) / 100) * pct : parseFloat(m[1])
}

/** A hue as degrees: plain number, deg, rad, grad or turn. */
function hue(t: string): number | null {
  if (t.toLowerCase() === 'none') return 0
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(t)
  if (!m) return null
  const v = parseFloat(m[1])
  const unit = (m[2] ?? 'deg').toLowerCase()
  return unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : unit === 'turn' ? v * 360 : v
}

const srgbEncode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** Linear-light sRGB (unclamped) of an OKLab colour. */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

const inGamut = (rgb: [number, number, number]): boolean => rgb.every((v) => v >= -0.0005 && v <= 1.0005)

/**
 * An OKLab / OKLCH colour as sRGB. A colour outside the sRGB gamut keeps its lightness and hue and loses chroma
 * until it fits (the CSS Color 4 approach), not a per-channel clip that would shift its hue.
 */
function oklchToRgba(L: number, C: number, h: number, a: number): RGBA {
  if (L >= 1) return { r: 255, g: 255, b: 255, a: clamp(a, 0, 1) } // CSS: lightness 100% and above is white, whatever the chroma
  if (L <= 0) return { r: 0, g: 0, b: 0, a: clamp(a, 0, 1) }
  const light = L
  const rad = (h * Math.PI) / 180
  let lin = oklabToLinear(light, C * Math.cos(rad), C * Math.sin(rad))
  if (!inGamut(lin)) {
    let lo = 0
    let hi = Math.max(C, 0)
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklabToLinear(light, mid * Math.cos(rad), mid * Math.sin(rad)))) lo = mid
      else hi = mid
    }
    lin = oklabToLinear(light, lo * Math.cos(rad), lo * Math.sin(rad))
  }
  const to8 = (v: number): number => Math.round(clamp(srgbEncode(clamp(v, 0, 1)), 0, 1) * 255)
  return { r: to8(lin[0]), g: to8(lin[1]), b: to8(lin[2]), a: clamp(a, 0, 1) }
}

/** oklch(L C h / alpha) and oklab(L a b / alpha); null when it is not one of those or malformed. */
function parseOklab(s: string): RGBA | null {
  const m = /^(oklch|oklab)\(\s*([^)]*?)\s*\)$/i.exec(s)
  if (!m) return null
  const [main, alphaPart, extra] = m[2].split('/').map((x) => x.trim())
  if (extra !== undefined || !main) return null
  const parts = main.split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 3) return null
  const alpha = alphaPart === undefined ? 1 : component(alphaPart, 1)
  const L = component(parts[0], 1)
  if (alpha === null || L === null) return null
  if (m[1].toLowerCase() === 'oklch') {
    const C = component(parts[1], 0.4)
    const H = hue(parts[2])
    return C === null || H === null ? null : oklchToRgba(L, Math.max(C, 0), H, alpha)
  }
  const A = component(parts[1], 0.4)
  const B = component(parts[2], 0.4)
  if (A === null || B === null) return null
  return oklchToRgba(L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI, alpha)
}

/** Parse any CSS colour (hex, rgb(), oklch()/oklab(), hsl(), named via the browser). Null if invalid. */
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
  const ok = parseOklab(s)
  if (ok) return ok
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
