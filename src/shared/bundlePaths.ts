// What a path inside an exported hand-off bundle may look like. Shared by the renderer (which plans the bundle) and
// the main process (which writes it and checks again before touching the disk).

const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
])
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']')
const BAD_NAME_CHARS = /[<>:"|?*]/
const BACKSLASH = String.fromCharCode(92)

export const isReservedName = (lowerCaseBase: string): boolean => RESERVED.has(lowerCaseBase)

/** Why a path may not be in a bundle, or null when it is fine. */
export function unsafePath(path: string): string | null {
  if (!path) return 'empty path'
  if (path.includes(BACKSLASH)) return 'backslash'
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'absolute path'
  const parts = path.split('/')
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return 'dot or empty segment'
  if (BAD_NAME_CHARS.test(path) || CONTROL.test(path)) return 'character not allowed in a Windows file name'
  if (parts.some((p) => RESERVED.has(p.split('.')[0].toLowerCase()))) return 'reserved Windows device name'
  if (parts.some((p) => p.endsWith(' ') || p.endsWith('.'))) return 'name ends with a space or a dot'
  return null
}

/** Throws on the first unsafe or duplicate (case-insensitive) path. */
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
