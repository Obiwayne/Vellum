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

let localCache: string[] | null = null
/** Local font families via the Local Font Access API (null when unavailable / denied). */
export async function queryLocalFamilies(): Promise<string[] | null> {
  if (localCache) return localCache
  const q = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts
  if (!q) return null
  try {
    const fonts = await q()
    localCache = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
    return localCache.length ? localCache : null
  } catch (err) {
    console.warn('[inspector] queryLocalFonts unavailable:', err)
    return null
  }
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
  const urls = [
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
