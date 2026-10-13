// Safe bundle paths: names that come from layer names become file names only through here.
// Bundle paths are POSIX, relative, ASCII kebab-case, unique, and never escape the bundle.

const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
])
const MAX_SLUG = 48
// combining marks left behind by NFKD, written as a range so the source stays ASCII
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']')
const BAD_NAME_CHARS = /[<>:"|?*]/

/** kebab-case ASCII slug; never empty, never a Windows reserved device name. */
export function slug(text: string, fallback = 'untitled'): string {
  let s = String(text ?? '')
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/-+$/g, '')
  if (!s) s = fallback
  if (RESERVED.has(s)) s = `${s}-1`
  return s
}

/** Hands each path out once: a second request for the same path gets `-2`, `-3`... before the extension. */
export class PathRegistry {
  private used = new Set<string>()

  take(dir: string, base: string, ext: string): string {
    const head = dir ? `${dir}/` : ''
    let n = 1
    let name = base
    let path = `${head}${name}${ext}`
    while (this.used.has(path.toLowerCase())) {
      n++
      name = `${base}-${n}`
      path = `${head}${name}${ext}`
    }
    this.used.add(path.toLowerCase())
    return path
  }

  /** A fixed path (HANDOFF.md, spec.json...) claimed up front so a slug can never collide with it. */
  reserve(path: string): string {
    this.used.add(path.toLowerCase())
    return path
  }
}

/** Why a path may not be in a bundle, or null when it is fine. */
export function unsafePath(path: string): string | null {
  if (!path) return 'empty path'
  if (path.includes('\\')) return 'backslash'
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'absolute path'
  const parts = path.split('/')
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return 'dot or empty segment'
  if (BAD_NAME_CHARS.test(path) || CONTROL.test(path)) return 'character not allowed in a Windows file name'
  if (parts.some((p) => RESERVED.has(p.split('.')[0].toLowerCase()))) return 'reserved Windows device name'
  return null
}

/** Throws on the first unsafe or duplicate path of a finished file map. */
export function assertSafePaths(paths: Iterable<string>): void {
  const seen = new Set<string>()
  for (const p of paths) {
    const why = unsafePath(p)
    if (why) throw new Error(`Unsafe bundle path "${p}": ${why}`)
    const key = p.toLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate bundle path "${p}"`)
    seen.add(key)
  }
}
