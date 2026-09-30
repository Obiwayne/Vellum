// Font catalogue for the Fonts popover: system aliases, local fonts (queryLocalFonts), curated
// Windows fonts and Google Fonts (loaded on demand through the FontFace API — the renderer CSP
// blocks remote stylesheets/fonts, so we fetch the CSS + font binaries and register them ourselves).

export interface FontEntry {
  name: string
  /** CSS font-family value */
  css: string
  source: 'system' | 'local' | 'google'
}

export const SYSTEM_FONTS: FontEntry[] = [
  { name: 'System Sans-Serif', css: 'system-ui, sans-serif', source: 'system' },
  { name: 'System Serif', css: 'ui-serif, serif', source: 'system' },
  { name: 'System Monospace', css: 'ui-monospace, monospace', source: 'system' }
]

const WINDOWS_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Cascadia Mono',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
  'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free', 'Leelawadee UI', 'Lucida Console',
  'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft Sans Serif', 'Microsoft YaHei', 'MV Boli', 'Nirmala UI',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Variable', 'SimSun', 'Sitka Text',
  'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic'
]

export const GOOGLE_FONTS = [
  'Anton', 'Archivo', 'Barlow', 'Bebas Neue', 'Bricolage Grotesque', 'Caveat', 'Cormorant Garamond', 'Crimson Pro',
  'DM Mono', 'DM Sans', 'DM Serif Display', 'EB Garamond', 'Figtree', 'Fira Code', 'Geist', 'IBM Plex Mono',
  'IBM Plex Sans', 'IBM Plex Serif', 'Instrument Sans', 'Instrument Serif', 'Inter', 'JetBrains Mono', 'Karla',
  'Lato', 'Libre Baskerville', 'Lora', 'Manrope', 'Merriweather', 'Montserrat', 'Noto Sans', 'Nunito',
  'Open Sans', 'Oswald', 'Outfit', 'Pacifico', 'Playfair Display', 'Plus Jakarta Sans', 'Poppins', 'PT Sans',
  'Raleway', 'Roboto', 'Roboto Mono', 'Rubik', 'Source Sans 3', 'Space Grotesk', 'Space Mono', 'Syne',
  'Work Sans'
]

export const cssFamily = (name: string): string => (/[^\w-]/.test(name) ? `"${name}"` : name)

/** Display name for a font-family CSS value. */
export function familyName(css: string | number | undefined): string {
  const v = String(css ?? 'system-ui, sans-serif').trim()
  const sys = SYSTEM_FONTS.find((f) => f.css === v)
  if (sys) return sys.name
  const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (first === 'system-ui' || first === 'sans-serif' || first === '-apple-system') return 'System Sans-Serif'
  if (first === 'ui-serif' || first === 'serif') return 'System Serif'
  if (first === 'ui-monospace' || first === 'monospace') return 'System Monospace'
  return first
}

interface LocalFontData {
  family: string
  blob: () => Promise<Blob>
}
let localData: Promise<LocalFontData[] | null> | null = null
/** Raw faces from the Local Font Access API (null when unavailable / denied). */
function queryLocalData(): Promise<LocalFontData[] | null> {
  if (localData) return localData
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts
  if (!q) return Promise.resolve(null)
  localData = q().catch((err) => {
    console.warn('[inspector] queryLocalFonts unavailable:', err)
    localData = null
    return null
  })
  return localData
}

let localCache: string[] | null = null
/** Local font families via the Local Font Access API (null when unavailable / denied). */
export async function queryLocalFamilies(): Promise<string[] | null> {
  if (localCache) return localCache
  const fonts = await queryLocalData()
  if (!fonts) return null
  localCache = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  return localCache.length ? localCache : null
}

export function buildCatalogue(local: string[] | null): FontEntry[] {
  const map = new Map<string, FontEntry>()
  const locals = local ?? WINDOWS_FONTS
  for (const n of locals) map.set(n.toLowerCase(), { name: n, css: cssFamily(n), source: 'local' })
  for (const n of GOOGLE_FONTS)
    if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), { name: n, css: cssFamily(n), source: 'google' })
  const rest = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  return [...SYSTEM_FONTS, ...rest]
}

// ------------------------------------------------------------------------------------------ Google
const loaded = new Map<string, Promise<boolean>>()
export const isGoogleFont = (name: string): boolean => GOOGLE_FONTS.some((g) => g.toLowerCase() === name.toLowerCase())

export async function fetchCss(name: string): Promise<string | null> {
  const fam = encodeURIComponent(name).replace(/%20/g, '+')
  const va = GOOGLE_VARIABLE[name.toLowerCase()]
  const urls = [
    // families with extra axes (wdth, opsz) are requested with them, or the API pins them to default
    ...(va ? googleAxisUrls(fam, va) : []),
    `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,100..900;1,100..900&display=swap`,
    `https://fonts.googleapis.com/css2?family=${fam}:wght@100..900&display=swap`,
    `https://fonts.googleapis.com/css2?family=${fam}:wght@400;700&display=swap`,
    `https://fonts.googleapis.com/css2?family=${fam}&display=swap`
  ]
  for (const u of urls) {
    try {
      const r = await fetch(u)
      if (r.ok) return await r.text()
    } catch {
      /* offline */
    }
  }
  return null
}

/** Load a Google font (latin subset, all available weights). Resolves true when registered. */
export function loadGoogleFont(name: string): Promise<boolean> {
  const key = name.toLowerCase()
  const existing = loaded.get(key)
  if (existing) return existing
  const p = (async () => {
    const css = await fetchCss(name)
    if (!css) return false
    const blocks = css.split('@font-face').slice(1)
    // prefer latin blocks (preceded by a /* latin */ comment); fall back to all
    const chunks = css.split(/\/\*\s*([\w-]+)\s*\*\//)
    const latin: string[] = []
    for (let i = 1; i < chunks.length; i += 2) if (chunks[i] === 'latin') latin.push(chunks[i + 1])
    const use = latin.length ? latin : blocks
    let ok = false
    await Promise.all(
      use.map(async (b) => {
        const url = /url\(([^)]+)\)/.exec(b)?.[1]
        if (!url) return
        const weight = /font-weight:\s*([^;]+);/.exec(b)?.[1]?.trim() ?? '400'
        const style = /font-style:\s*([^;]+);/.exec(b)?.[1]?.trim() ?? 'normal'
        const range = /unicode-range:\s*([^;]+);/.exec(b)?.[1]?.trim()
        try {
          const buf = await (await fetch(url.replace(/["']/g, ''))).arrayBuffer()
          const face = new FontFace(name, buf, { weight, style, ...(range ? { unicodeRange: range } : {}) })
          await face.load()
          document.fonts.add(face)
          ok = true
        } catch (err) {
          console.warn('[inspector] font load failed', name, err)
        }
      })
    )
    return ok
  })()
  loaded.set(key, p)
  return p
}

// ------------------------------------------------------------------------------------------ Variable axes
export interface FontAxis {
  tag: string
  min: number
  max: number
  def: number
}

/** Registered axes with their usual ranges, for fonts whose own axes can't be read. */
export const STANDARD_AXES: Record<string, FontAxis & { label: string; step: number }> = {
  wght: { tag: 'wght', label: 'Weight', min: 100, max: 900, def: 400, step: 1 },
  wdth: { tag: 'wdth', label: 'Width', min: 25, max: 200, def: 100, step: 1 },
  opsz: { tag: 'opsz', label: 'Optical size', min: 6, max: 144, def: 14, step: 1 },
  slnt: { tag: 'slnt', label: 'Slant', min: -90, max: 0, def: 0, step: 1 },
  ital: { tag: 'ital', label: 'Italic', min: 0, max: 1, def: 0, step: 1 }
}
export const axisLabel = (tag: string): string => STANDARD_AXES[tag]?.label ?? tag

/**
 * Axes of the curated Google fonts that have more than wght (and ital). The css2 API only serves
 * the axes that are asked for, so these drive both the request and the inspector's sliders.
 * Ranges match Google Fonts metadata (Inter also matches the bundled @fontsource-variable/inter).
 */
const GOOGLE_VARIABLE: Record<string, { ital: boolean; axes: FontAxis[] }> = {
  inter: { ital: true, axes: [{ tag: 'opsz', min: 14, max: 32, def: 14 }, { tag: 'wght', min: 100, max: 900, def: 400 }] },
  roboto: { ital: true, axes: [{ tag: 'wdth', min: 75, max: 100, def: 100 }, { tag: 'wght', min: 100, max: 900, def: 400 }] },
  'open sans': { ital: true, axes: [{ tag: 'wdth', min: 75, max: 100, def: 100 }, { tag: 'wght', min: 300, max: 800, def: 400 }] },
  'noto sans': { ital: true, axes: [{ tag: 'wdth', min: 62.5, max: 100, def: 100 }, { tag: 'wght', min: 100, max: 900, def: 400 }] },
  'dm sans': { ital: true, axes: [{ tag: 'opsz', min: 9, max: 40, def: 14 }, { tag: 'wght', min: 100, max: 1000, def: 400 }] },
  archivo: { ital: true, axes: [{ tag: 'wdth', min: 62, max: 125, def: 100 }, { tag: 'wght', min: 100, max: 900, def: 400 }] },
  'instrument sans': { ital: true, axes: [{ tag: 'wdth', min: 75, max: 100, def: 100 }, { tag: 'wght', min: 400, max: 700, def: 400 }] },
  'ibm plex sans': { ital: true, axes: [{ tag: 'wdth', min: 85, max: 100, def: 100 }, { tag: 'wght', min: 100, max: 700, def: 400 }] },
  'bricolage grotesque': {
    ital: false,
    axes: [{ tag: 'opsz', min: 12, max: 96, def: 14 }, { tag: 'wdth', min: 75, max: 100, def: 100 }, { tag: 'wght', min: 200, max: 800, def: 400 }]
  },
  merriweather: {
    ital: true,
    axes: [{ tag: 'opsz', min: 18, max: 144, def: 18 }, { tag: 'wdth', min: 87, max: 112, def: 100 }, { tag: 'wght', min: 300, max: 900, def: 400 }]
  }
}

/** css2 URLs asking for every axis (tags sorted as the API requires: ital, then a–z). */
function googleAxisUrls(fam: string, va: { ital: boolean; axes: FontAxis[] }): string[] {
  const axes = [...va.axes].sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const tags = axes.map((a) => a.tag).join(',')
  const ranges = axes.map((a) => `${a.min}..${a.max}`).join(',')
  const upright = `https://fonts.googleapis.com/css2?family=${fam}:${tags}@${ranges}&display=swap`
  return va.ital ? [`https://fonts.googleapis.com/css2?family=${fam}:ital,${tags}@0,${ranges};1,${ranges}&display=swap`, upright] : [upright]
}

/** Axes from an OpenType `fvar` table: [] for a static font, null when the file can't be read. */
export function parseFvar(buf: ArrayBuffer): FontAxis[] | null {
  try {
    const v = new DataView(buf)
    const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    const fixed = (o: number): number => Math.round((v.getInt32(o) / 65536) * 100) / 100
    // a collection (.ttc): read the first font
    const base = tag(0) === 'ttcf' ? v.getUint32(12) : 0
    const count = v.getUint16(base + 4)
    for (let i = 0; i < count; i++) {
      const rec = base + 12 + i * 16
      if (tag(rec) !== 'fvar') continue
      const t = v.getUint32(rec + 8)
      const first = t + v.getUint16(t + 4)
      const n = v.getUint16(t + 8)
      const size = v.getUint16(t + 10)
      const axes: FontAxis[] = []
      for (let a = 0; a < n; a++) {
        const o = first + a * size
        if (v.getUint16(o + 16) & 1) continue // hidden axis
        axes.push({ tag: tag(o), min: fixed(o + 4), def: fixed(o + 8), max: fixed(o + 12) })
      }
      return axes
    }
    return []
  } catch {
    return null
  }
}

const axesCache = new Map<string, Promise<FontAxis[] | null>>()
/**
 * Variation axes of a family: read from the local font file (`fvar`), or the table above for Google
 * fonts. Null when unknown (system aliases, Google fonts outside the table, no local font access).
 */
export function fontAxes(name: string): Promise<FontAxis[] | null> {
  const key = name.toLowerCase()
  const hit = axesCache.get(key)
  if (hit) return hit
  const p = (async (): Promise<FontAxis[] | null> => {
    if (SYSTEM_FONTS.some((f) => f.name === name)) return null
    const local = (await queryLocalData())?.find((f) => f.family.toLowerCase() === key)
    if (local) {
      try {
        return parseFvar(await (await local.blob()).arrayBuffer())
      } catch (err) {
        console.warn('[inspector] could not read font file', name, err)
      }
    }
    return GOOGLE_VARIABLE[key]?.axes ?? null
  })()
  axesCache.set(key, p)
  // unknown may just mean local font access wasn't ready yet: ask again next time
  void p.then((a) => a === null && axesCache.delete(key))
  return p
}

/** `"wdth" 87, "opsz" 32` ⇄ [{tag, value}] */
export interface AxisValue {
  tag: string
  value: number
}
export function parseVariation(v: string | number | undefined): AxisValue[] {
  const out: AxisValue[] = []
  const re = /["'](.{4})["']\s+(-?\d*\.?\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(v ?? '')))) out.push({ tag: m[1], value: parseFloat(m[2]) })
  return out
}
export const formatVariation = (list: AxisValue[]): string | null =>
  list.length ? list.map((a) => `"${a.tag}" ${Math.round(a.value * 100) / 100}`).join(', ') : null
