import type { CSSProperties } from 'react'

/**
 * Inherited defaults for canvas content (text defaults). line-height is `normal`, as in a
 * browser; text created with the Text tool gets an explicit 16px / 1.25 (ops.TEXT_DEFAULTS).
 * Shared by the canvas, the offscreen measurer (bridge/measure.ts) and thumbnails.
 */
export const CANVAS_CONTENT_DEFAULTS: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 'normal',
  color: '#000000',
  userSelect: 'none'
}
