// Safe, deterministic file names for the bundle. Layer and screen names are user text: they only ever reach a
// path through `slug`, and every finished path passes `assertSafePath` (T58 plan section 11).

const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)])
export const MAX_SLUG = 48
export const MAX_PATH = 160

/** kebab-case ASCII: [a-z0-9-], no leading/trailing dash, at most MAX_SLUG chars, never a Windows device name. */
export function slug(name: string, fallback = 'item'): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  const s = ascii || fallback
  return RESERVED.has(s) ? `${s}-file` : s
}

/** Hands out each path once: `a.md`, `a-2.md`, `a-3.md`. Comparison is case-insensitive (Windows). */
export class PathRegistry {
  private taken = new Set<string>()

  /** Reserve an exact path (e.g. `HANDOFF.md`); false when already taken. */
  reserve(path: string): boolean {
    const k = path.toLowerCase()
    if (this.taken.has(k)) return false
    this.taken.add(k)
    return true
  }

  /** `dir/stem.ext` for a stem that is already safe (`checkout.mobile`), with `-2` on the last part when taken. */
  claimStem(dir: string, stem: string, ext: string): string {
    for (let i = 1; ; i++) {
      const path = `${dir ? `${dir}/` : ''}${i === 1 ? stem : `${stem}-${i}`}${ext}`
      if (this.reserve(path)) return path
    }
  }

  /** `dir/slug(name).ext`, with a `-2` style suffix when the path is taken. */
  claim(dir: string, name: string, ext: string, fallback = 'item'): string {
    const base = slug(name, fallback)
    for (let i = 1; ; i++) {
      const stem = i === 1 ? base : `${base}-${i}`
      const path = `${dir ? `${dir}/` : ''}${stem}${ext}`
      if (this.reserve(path)) return path
    }
  }
}

/** Throws when a path could escape the bundle folder or is not portable. */
export function assertSafePath(path: string): void {
  const bad = (why: string): never => {
    throw new Error(`Unsafe bundle path "${path}": ${why}`)
  }
  if (!path || path.length > MAX_PATH) bad('empty or too long')
  if (path.startsWith('/')) bad('absolute')
  if (/^[a-zA-Z]:/.test(path)) bad('drive letter')
  if (path.includes('\\')) bad('backslash')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>:"|?*]/.test(path)) bad('control or reserved character')
  for (const seg of path.split('/')) {
    if (!seg || seg === '.' || seg === '..') bad('empty or relative segment')
    if (/[. ]$/.test(seg)) bad('segment ends with a dot or space')
    if (RESERVED.has(seg.split('.')[0].toLowerCase())) bad('Windows device name')
  }
}
