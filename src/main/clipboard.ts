// Reads images from the system clipboard for paste: a bitmap (screenshots, a browser's "Copy image")
// and image files copied in File Explorer (which the web clipboard API can't see).
// Electron 44's clipboard is MIME-based: copied files arrive as `text/uri-list` (file:/// URLs),
// bitmaps as `image/png`.
//
// The uri-list is untrusted (any app, or a web page's copy handler, can put one there), so a file is
// only read when it is a local, regular (non-symlink) image file on a drive-letter path, within the
// size cap. UNC / device paths (\\server\share, \\?\, \\.\) are never touched: opening them would
// make Windows connect to a remote SMB host and could leak the user's NTLM credentials.
import { clipboard } from 'electron'
import { lstat, open } from 'fs/promises'
import { basename, extname, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import type { ClipboardMedia } from '@shared/api'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_FILES = 50

async function blobText(b: unknown): Promise<string> {
  return b instanceof Blob ? b.text() : String(b ?? '')
}

/** A file:// URL to a local path, or null for anything remote, device-like or malformed. */
export function localPathFromFileUrl(url: string): string | null {
  let path: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'file:') return null
    if (u.hostname && u.hostname.toLowerCase() !== 'localhost') return null // file://server/share → UNC
    path = fileURLToPath(u)
  } catch {
    return null
  }
  if (path.includes('\0')) return null
  if (/^[\\/]{2}/.test(path)) return null // UNC, \\?\ and \\.\ device paths
  if (process.platform === 'win32' ? !/^[A-Za-z]:\\/.test(path) : !isAbsolute(path)) return null
  return path
}

async function fileItem(path: string, budget: { bytes: number }): Promise<ClipboardMedia['files'][number] | null> {
  const ext = extname(path).toLowerCase()
  if (ext !== '.svg' && !MIME[ext]) return null
  try {
    // lstat: a symlink is not followed (it could point at a network share or a device)
    const st = await lstat(path)
    if (!st.isFile() || st.size > MAX_FILE_BYTES || st.size > budget.bytes) return null
    const fh = await open(path, 'r')
    let data: Buffer
    try {
      // re-check on the handle (the file may have changed since lstat) and never read past the cap
      const size = (await fh.stat()).size
      if (size > MAX_FILE_BYTES || size > budget.bytes) return null
      data = Buffer.alloc(size)
      const { bytesRead } = await fh.read(data, 0, size, 0)
      data = data.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
    budget.bytes -= data.length
    if (ext === '.svg') return { name: basename(path, ext), svg: data.toString('utf8') }
    return { name: basename(path, ext), dataUrl: `data:${MIME[ext]};base64,${data.toString('base64')}` }
  } catch (err) {
    console.warn('[clipboard] could not read a copied file:', (err as NodeJS.ErrnoException).code ?? String(err))
    return null
  }
}

export async function readClipboardMedia(): Promise<ClipboardMedia> {
  const out: ClipboardMedia = { files: [] }
  const budget = { bytes: MAX_TOTAL_BYTES }
  let items: Electron.ClipboardItem[] = []
  try {
    items = await clipboard.read()
  } catch (err) {
    console.warn('[clipboard] read failed', err)
    return out
  }
  for (const item of items) {
    try {
      if (item.types.includes('text/uri-list')) {
        const list = await blobText(await item.getType('text/uri-list'))
        for (const line of list.split(/\r?\n/)) {
          if (out.files.length >= MAX_FILES) break
          const url = line.trim()
          if (!url.startsWith('file:')) continue
          const path = localPathFromFileUrl(url)
          if (!path) continue
          const f = await fileItem(path, budget)
          if (f) out.files.push(f)
        }
      }
      const imageType = item.types.find((t) => t.startsWith('image/') && t !== 'image/svg+xml')
      if (imageType && !out.image) {
        const blob = await item.getType(imageType)
        if (blob instanceof Blob && blob.size > 0 && blob.size <= MAX_FILE_BYTES) {
          const type = [blob.type, imageType].find((t) => /^image\/[a-z0-9.+-]+$/i.test(t) && t !== 'image/svg+xml')
          if (type) out.image = `data:${type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
        }
      }
    } catch (err) {
      console.warn('[clipboard] skipped an item:', err instanceof Error ? err.message : err)
    }
  }
  return out
}
