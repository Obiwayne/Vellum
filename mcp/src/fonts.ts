// Font lookup for get_font_family_info: locally installed fonts (Windows registry + GDI+ family
// list via PowerShell) and Google Fonts (metadata fetched from fonts.google.com, cached on disk).
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface FontFace {
  style: string
  weight: number
  isItalic: boolean
  axes?: Record<string, { tag: string; min: number; max: number }>
}

const CACHE_DIR = join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'Vellum')
const GOOGLE_CACHE = join(CACHE_DIR, 'google-fonts-metadata.json')
const GOOGLE_TTL_MS = 7 * 24 * 3600 * 1000

const WEIGHT_NAMES: [RegExp, number, string][] = [
  [/\b(thin|hairline)\b/i, 100, 'Thin'],
  [/\b(extra[\s-]?light|ultra[\s-]?light)\b/i, 200, 'ExtraLight'],
  [/\b(semi[\s-]?light|demi[\s-]?light)\b/i, 350, 'SemiLight'],
  [/\blight\b/i, 300, 'Light'],
  [/\b(semi[\s-]?bold|demi[\s-]?bold)\b/i, 600, 'SemiBold'],
  [/\b(extra[\s-]?bold|ultra[\s-]?bold)\b/i, 800, 'ExtraBold'],
  [/\bbold\b/i, 700, 'Bold'],
  [/\b(black|heavy)\b/i, 900, 'Black'],
  [/\bmedium\b/i, 500, 'Medium']
]

const STYLE_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black'
}

const GENERIC = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont'
])

// ---------------------------------------------------------------------------------------------
// local fonts

interface LocalFonts {
  /** lower-case family → display family */
  families: Map<string, string>
  /** lower-case family → faces */
  faces: Map<string, FontFace[]>
}

let localPromise: Promise<LocalFonts> | null = null

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 30_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

function parseStyle(rest: string): { style: string; weight: number; isItalic: boolean } {
  const isItalic = /\b(italic|oblique)\b/i.test(rest)
  let weight = 400
  let name = 'Regular'
  for (const [re, w, n] of WEIGHT_NAMES) {
    if (re.test(rest)) {
      weight = w
      name = n
      break
    }
  }
  const style = isItalic ? (weight === 400 ? 'Italic' : `${name} Italic`) : name
  return { style, weight, isItalic }
}

async function loadLocal(): Promise<LocalFonts> {
  const families = new Map<string, string>()
  const faces = new Map<string, FontFace[]>()
  if (process.platform !== 'win32') return { families, faces }
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$names = @()',
    'foreach ($k in @("HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")) { if (Test-Path $k) { $names += (Get-Item $k).GetValueNames() } }',
    'Add-Type -AssemblyName System.Drawing',
    '$fams = @((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name })',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '@{ names = $names; families = $fams } | ConvertTo-Json -Compress'
  ].join('; ')
  try {
    const out = await runPowerShell(script)
    const data = JSON.parse(out.trim()) as { names?: string[]; families?: string[] }
    for (const f of data.families ?? []) families.set(f.toLowerCase(), f)
    const famList = [...families.values()].sort((a, b) => b.length - a.length)
    for (const raw of data.names ?? []) {
      const clean = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
      for (const full of clean.split(/\s+&\s+/)) {
        const fam = famList.find((f) => full.toLowerCase() === f.toLowerCase() || full.toLowerCase().startsWith(f.toLowerCase() + ' '))
        const family = fam ?? full
        const rest = full.slice(family.length).trim()
        const key = family.toLowerCase()
        if (!families.has(key)) families.set(key, family)
        const face = parseStyle(rest)
        const list = faces.get(key) ?? []
        if (!list.some((x) => x.style === face.style)) list.push(face)
        faces.set(key, list)
      }
    }
  } catch {
    // PowerShell unavailable: local lookup just reports nothing
  }
  return { families, faces }
}

function local(): Promise<LocalFonts> {
  localPromise ??= loadLocal()
  return localPromise
}

// ---------------------------------------------------------------------------------------------
// Google Fonts

interface GoogleFamily {
  family: string
  category?: string
  fonts: Record<string, unknown>
  axes?: { tag: string; min: number; max: number }[]
}

let googlePromise: Promise<Map<string, GoogleFamily>> | null = null

async function fetchGoogle(): Promise<string | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 10_000)
    const res = await fetch('https://fonts.google.com/metadata/fonts', { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function loadGoogle(): Promise<Map<string, GoogleFamily>> {
  let text: string | null = null
  let fresh = false
  try {
    const s = await stat(GOOGLE_CACHE)
    text = await readFile(GOOGLE_CACHE, 'utf8')
    fresh = Date.now() - s.mtimeMs < GOOGLE_TTL_MS
  } catch {
    /* no cache */
  }
  if (!text || !fresh) {
    const fetched = await fetchGoogle()
    if (fetched) {
      text = fetched
      try {
        await mkdir(CACHE_DIR, { recursive: true })
        await writeFile(GOOGLE_CACHE, fetched)
      } catch {
        /* cache is best-effort */
      }
    }
  }
  const map = new Map<string, GoogleFamily>()
  if (!text) return map
  try {
    const json = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as { familyMetadataList?: GoogleFamily[] }
    for (const f of json.familyMetadataList ?? []) map.set(f.family.toLowerCase(), f)
  } catch {
    /* corrupt cache */
  }
  return map
}

export function googleFonts(): Promise<Map<string, GoogleFamily>> {
  googlePromise ??= loadGoogle()
  return googlePromise
}

function googleFaces(f: GoogleFamily): FontFace[] {
  const axes = f.axes?.length ? Object.fromEntries(f.axes.map((a) => [a.tag, { tag: a.tag, min: a.min, max: a.max }])) : undefined
  const faces: FontFace[] = Object.keys(f.fonts).map((k) => {
    const isItalic = k.endsWith('i')
    const weight = parseInt(k, 10) || 400
    const base = STYLE_NAMES[weight] ?? String(weight)
    return {
      style: isItalic ? (weight === 400 ? 'Italic' : `${base} Italic`) : base,
      weight,
      isItalic,
      ...(axes ? { axes } : {})
    }
  })
  return faces.sort((a, b) => Number(a.isItalic) - Number(b.isItalic) || a.weight - b.weight)
}

// ---------------------------------------------------------------------------------------------

export async function fontFamilyInfo(names: string[]): Promise<Record<string, unknown>> {
  const [loc, goog] = await Promise.all([local(), googleFonts()])
  const fontsPerFamily: Record<string, FontFace[]> = {}
  const sources: Record<string, string[]> = {}
  const notFound: string[] = []
  for (const raw of names) {
    const name = raw.trim().replace(/^["']|["']$/g, '')
    const key = name.toLowerCase()
    if (GENERIC.has(key)) {
      fontsPerFamily[name] = [100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((w) => [
        { style: STYLE_NAMES[w], weight: w, isItalic: false },
        { style: w === 400 ? 'Italic' : `${STYLE_NAMES[w]} Italic`, weight: w, isItalic: true }
      ])
      sources[name] = ['css-generic']
      continue
    }
    const src: string[] = []
    let faces: FontFace[] = []
    if (loc.families.has(key)) {
      src.push('local')
      faces = [...(loc.faces.get(key) ?? [{ style: 'Regular', weight: 400, isItalic: false }])].sort(
        (a, b) => Number(a.isItalic) - Number(b.isItalic) || a.weight - b.weight
      )
    }
    const g = goog.get(key)
    if (g) {
      src.push('google')
      // Google metadata is more precise (weights/axes); prefer it
      faces = googleFaces(g)
    }
    if (!src.length) {
      notFound.push(name)
      continue
    }
    fontsPerFamily[loc.families.get(key) ?? g?.family ?? name] = faces
    sources[loc.families.get(key) ?? g?.family ?? name] = src
  }
  const out: Record<string, unknown> = { fontsPerFamily, sources }
  if (notFound.length) {
    out.notFound = notFound
    out.hint = 'These families are not installed locally and are not on Google Fonts. Pick another family.'
  }
  return out
}

/** Families (from a list of CSS font-family values) that should be loaded from Google Fonts. */
export async function googleFamiliesFor(fontFamilies: string[]): Promise<{ family: string; weights: string[] }[]> {
  const goog = await googleFonts()
  const loc = await local()
  const out = new Map<string, { family: string; weights: string[] }>()
  for (const value of fontFamilies) {
    for (const part of value.split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '')
      const key = name.toLowerCase()
      if (!name || GENERIC.has(key) || name.startsWith('var(')) continue
      const g = goog.get(key)
      if (!g || out.has(key)) continue
      if (loc.families.has(key)) continue // installed locally: Chromium uses it directly
      out.set(key, { family: g.family, weights: Object.keys(g.fonts) })
    }
  }
  return [...out.values()]
}

/** A Google Fonts css2 URL covering every weight/italic of the given families. */
export function googleCssUrl(families: { family: string; weights: string[] }[]): string | null {
  if (!families.length) return null
  const parts = families.map(({ family, weights }) => {
    const tuples = weights
      .map((w) => ({ ital: w.endsWith('i') ? 1 : 0, wght: parseInt(w, 10) || 400 }))
      .sort((a, b) => a.ital - b.ital || a.wght - b.wght)
      .map((t) => `${t.ital},${t.wght}`)
    const uniq = [...new Set(tuples)]
    return `family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${uniq.join(';')}`
  })
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=block`
}

/** Warm caches in the background so the first get_font_family_info call is fast. */
export function prefetchFonts(): void {
  void local()
  void googleFonts()
}
