// Small helpers shared by the remote connector files.
import { createHash, timingSafeEqual } from 'node:crypto'
import { chmodSync, renameSync, writeFileSync } from 'node:fs'

export const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Constant-time string compare (false for a missing value). */
export function sameToken(a: string | undefined | null, b: string): boolean {
  if (typeof a !== 'string') return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Atomic write, readable by this user only. */
export function writePrivate(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    /* Windows: %APPDATA% ACLs already limit it to the user */
  }
  renameSync(tmp, file)
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
