// Which pixel densities an image can honestly be exported at. Never upscales.

export interface DensityPlan {
  /** densities that get a file, ascending: always [1] first; 2 and 3 only when the pixels exist */
  list: Array<1 | 2 | 3>
  /** natural pixels per layout pixel (min of both axes); below 1 the image is smaller than its box */
  maxDensity: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * `layout*` is the size the layer is drawn at (CSS px), `natural*` the pixels in the file. Unknown sizes
 * (0, NaN, negative) give `[1]` and `maxDensity` 1: the original is exported as is.
 */
export function densities(layoutW: number, layoutH: number, naturalW: number, naturalH: number): DensityPlan {
  const ok = [layoutW, layoutH, naturalW, naturalH].every((v) => Number.isFinite(v) && v > 0)
  if (!ok) return { list: [1], maxDensity: 1 }
  const max = Math.min(naturalW / layoutW, naturalH / layoutH)
  // a hair of tolerance: 1199.6 px of a 2x image for a 600 px box is still a 2x image
  const list: DensityPlan['list'] = [1]
  if (max >= 2 - 0.005) list.push(2)
  if (max >= 3 - 0.005) list.push(3)
  return { list, maxDensity: round2(max) }
}

/** Target pixel size of a density: layout size times the density, whole pixels. */
export const targetSize = (layoutW: number, layoutH: number, d: number): { width: number; height: number } => ({
  width: Math.max(1, Math.round(layoutW * d)),
  height: Math.max(1, Math.round(layoutH * d))
})
