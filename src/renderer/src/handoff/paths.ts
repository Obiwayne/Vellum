// Safe bundle paths: names that come from layer names become file names only through here.
// Bundle paths are POSIX, relative, ASCII kebab-case, unique, and never escape the bundle.

import { isReservedName } from '@shared/bundlePaths'

const MAX_SLUG = 48
// combining marks left behind by NFKD, written as a range so the source stays ASCII
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')

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
  if (isReservedName(s)) s = `${s}-1`
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

export { unsafePath, assertSafePaths } from '@shared/bundlePaths'
