// Image bytes without decoding: data URL -> bytes, the real type and pixel size from the header, a content hash.
// Pure; runs in the renderer and in vitest. Anything that is not clearly an image is `unknown`.

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml'

export interface Sniffed {
  mime: ImageMime
  ext: 'png' | 'jpg' | 'gif' | 'webp' | 'svg'
  /** pixels (SVG: from width/height or viewBox, 0 when it has neither) */
  width: number
  height: number
  animated: boolean
}

const EXT: Record<ImageMime, Sniffed['ext']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/** `data:<mime>[;base64],<payload>` -> bytes and the declared type, or null for anything else. */
export function dataUrlToBytes(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),/i.exec(url.trim())
  if (!m) return null
  const payload = url.trim().slice(m[0].length)
  const base64 = /;base64/i.test(m[2])
  try {
    if (base64) {
      const bin = atob(payload.replace(/\s+/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { mime: m[1].toLowerCase(), bytes }
    }
    return { mime: m[1].toLowerCase(), bytes: new TextEncoder().encode(decodeURIComponent(payload)) }
  } catch {
    return null
  }
}

const be32 = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const be16 = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1]
const le16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8)
const le24 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n))

function pngInfo(b: Uint8Array): Sniffed | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
  const width = be32(b, 16)
  const height = be32(b, 20)
  if (!width || !height) return null
  // an animated PNG has an `acTL` chunk before the first `IDAT`
  let animated = false
  for (let i = 8; i + 8 <= b.length; ) {
    const len = be32(b, i)
    const type = ascii(b, i + 4, 4)
    if (type === 'acTL') {
      animated = true
      break
    }
    if (type === 'IDAT' || type === 'IEND') break
    i += 12 + len
  }
  return { mime: 'image/png', ext: 'png', width, height, animated }
}

function jpegInfo(b: Uint8Array): Sniffed | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    const len = be16(b, i + 2)
    // start-of-frame markers carry the size (not DHT 0xC4, JPG 0xC8, DAC 0xCC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = be16(b, i + 5)
      const width = be16(b, i + 7)
      return width && height ? { mime: 'image/jpeg', ext: 'jpg', width, height, animated: false } : null
    }
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function gifInfo(b: Uint8Array): Sniffed | null {
  if (b.length < 10) return null
  const width = le16(b, 6)
  const height = le16(b, 8)
  if (!width || !height) return null
  // more than one image descriptor (0x2C) after the header means frames; NETSCAPE2.0 marks a loop
  const animated = ascii(b, 0, b.length).includes('NETSCAPE2.0')
  return { mime: 'image/gif', ext: 'gif', width, height, animated }
}

function webpInfo(b: Uint8Array): Sniffed | null {
  if (b.length < 30) return null
  const kind = ascii(b, 12, 4)
  let width = 0
  let height = 0
  if (kind === 'VP8 ') {
    width = le16(b, 26) & 0x3fff
    height = le16(b, 28) & 0x3fff
  } else if (kind === 'VP8L') {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    width = (v & 0x3fff) + 1
    height = ((v >> 14) & 0x3fff) + 1
  } else if (kind === 'VP8X') {
    width = le24(b, 24) + 1
    height = le24(b, 27) + 1
  } else return null
  if (!width || !height) return null
  const animated = kind === 'VP8X' && (b[20] & 0x02) !== 0
  return { mime: 'image/webp', ext: 'webp', width, height, animated }
}

function svgInfo(b: Uint8Array): Sniffed | null {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096)).replace(/^﻿/, '').trimStart()
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype[^>]*>\s*)?<svg[\s>]/i.test(head)) return null
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? ''
  const attr = (n: string): string | undefined => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  const num = (v: string | undefined): number => (v && /^\s*[\d.]+(px)?\s*$/.test(v) ? parseFloat(v) : 0)
  let width = num(attr('width'))
  let height = num(attr('height'))
  if (!width || !height) {
    const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number)
    if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
      width = width || vb[2]
      height = height || vb[3]
    }
  }
  return { mime: 'image/svg+xml', ext: 'svg', width, height, animated: false }
}

/** The real type and size of an image from its bytes, or null when it is not a recognised image. */
export function sniff(bytes: Uint8Array): Sniffed | null {
  const b = bytes
  if (b.length < 8) return null
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return pngInfo(b)
  if (b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b)
  if (ascii(b, 0, 3) === 'GIF') return gifInfo(b)
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpInfo(b)
  return svgInfo(b)
}

export const extOf = (mime: ImageMime): Sniffed['ext'] => EXT[mime]

/** SHA-256 as lowercase hex (WebCrypto: browser, Electron and Node 20+). */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
}
