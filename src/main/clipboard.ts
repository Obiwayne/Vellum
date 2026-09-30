// Reads images from the system clipboard for paste: a bitmap (screenshots, a browser's "Copy image")
// and image files copied in File Explorer (which the web clipboard API can't see).
// Electron 44's clipboard is MIME-based: copied files arrive as `text/uri-list` (file:/// URLs),
// bitmaps as `image/png`.
import { clipboard } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
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

async function blobText(b: unknown): Promise<string> {
  return b instanceof Blob ? b.text() : String(b ?? '')
}

async function fileItem(path: string): Promise<ClipboardMedia['files'][number] | null> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext !== '.svg' && !MIME[ext]) return null
    if ((await stat(path)).size > MAX_FILE_BYTES) return null
    if (ext === '.svg') return { name: basename(path, ext), svg: await readFile(path, 'utf8') }
    return { name: basename(path, ext), dataUrl: `data:${MIME[ext]};base64,${(await readFile(path)).toString('base64')}` }
  } catch (err) {
    console.warn('[clipboard] could not read', path, err)
    return null
  }
}

export async function readClipboardMedia(): Promise<ClipboardMedia> {
  const out: ClipboardMedia = { files: [] }
  let items: Electron.ClipboardItem[] = []
  try {
    items = await clipboard.read()
  } catch (err) {
    console.warn('[clipboard] read failed', err)
    return out
  }
  for (const item of items) {
    if (item.types.includes('text/uri-list')) {
      const list = await blobText(await item.getType('text/uri-list'))
      for (const line of list.split(/\r?\n/)) {
        const url = line.trim()
        if (!url.startsWith('file:')) continue
        const f = await fileItem(fileURLToPath(url))
        if (f) out.files.push(f)
      }
    }
    const imageType = item.types.find((t) => t.startsWith('image/') && t !== 'image/svg+xml')
    if (imageType && !out.image) {
      const blob = await item.getType(imageType)
      if (blob instanceof Blob && blob.size > 0) {
        out.image = `data:${blob.type || imageType};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
      }
    }
  }
  return out
}
