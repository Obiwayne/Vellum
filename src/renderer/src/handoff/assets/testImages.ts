// Tiny image files built from headers, for tests: enough bytes to be sniffed and hashed, not decodable pictures.
const u8 = (...n: number[]): Uint8Array => Uint8Array.from(n)
const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const cat = (...parts: Array<number[] | Uint8Array>): Uint8Array => Uint8Array.from(parts.flatMap((p) => [...p]))

export function png(width: number, height: number, opts: { animated?: boolean; salt?: number } = {}): Uint8Array {
  const ihdr = cat(be32(width), be32(height), [8, 6, 0, 0, 0])
  const chunk = (type: string, data: number[] | Uint8Array): number[] => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
  return cat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', ihdr),
    opts.animated ? chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]) : [],
    chunk('IDAT', [opts.salt ?? 0, 1, 2, 3]),
    chunk('IEND', [])
  )
}

export function jpeg(width: number, height: number, salt = 0): Uint8Array {
  return cat(
    [0xff, 0xd8],
    [0xff, 0xe0, 0, 4, salt, 0], // APP0 with a 2 byte payload
    [0xff, 0xc0, 0, 11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 1, 1, 0x11, 0],
    [0xff, 0xd9]
  )
}

export function gif(width: number, height: number, animated = false): Uint8Array {
  return cat(ascii('GIF89a'), [width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0], animated ? ascii('!\xff\x0bNETSCAPE2.0') : [], [0x3b])
}

export function webp(width: number, height: number): Uint8Array {
  const w = width - 1
  const h = height - 1
  const vp8x = [0x08, 0, 0, 0, w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255]
  return cat(ascii('RIFF'), [0x1a, 0, 0, 0], ascii('WEBP'), ascii('VP8X'), [10, 0, 0, 0], vp8x)
}

export const svgText = (w = 24, h = 24): Uint8Array => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f00"/></svg>`)

export function dataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}

export { u8 }
