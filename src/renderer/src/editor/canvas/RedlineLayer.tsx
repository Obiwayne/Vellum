// Dev Mode redlines drawn above the canvas (T67 / H10). The overlay is screen space, so the numbers are placed
// with the camera and the lines and chips keep their size at every zoom.
import type { CSSProperties } from 'react'
import type { Camera } from '../../model/types'
import type { RedlineScene } from './redlineScene'

/** Redlines in screen space: 1px lines with end ticks and a label chip that keeps its size at any zoom. */
export function RedlineLayer({ scene, cam }: { scene: RedlineScene; cam: Camera }): JSX.Element {
  const sx = (x: number): number => x * cam.zoom + cam.x
  const sy = (y: number): number => y * cam.zoom + cam.y
  return (
    <div className="cv-redlines" data-testid="redlines">
      {scene.lines.map((l, i) => {
        const x1 = sx(l.from.x)
        const y1 = sy(l.from.y)
        const x2 = sx(l.to.x)
        const y2 = sy(l.to.y)
        const horizontal = l.axis === 'x'
        const body: CSSProperties = horizontal
          ? { left: Math.min(x1, x2), top: y1 - 0.5, width: Math.abs(x2 - x1), height: 1 }
          : { left: x1 - 0.5, top: Math.min(y1, y2), width: 1, height: Math.abs(y2 - y1) }
        const tick = (x: number, y: number, key: string): JSX.Element => (
          <div key={key} className="cv-redline-tick" style={horizontal ? { left: x - 0.5, top: y - 3, width: 1, height: 6 } : { left: x - 3, top: y - 0.5, width: 6, height: 1 }} />
        )
        return (
          <div key={i} className={'cv-redline cv-redline--' + l.kind} data-value={l.label}>
            <div className="cv-redline-body" style={body} />
            {tick(x1, y1, 'a')}
            {tick(x2, y2, 'b')}
            <div className="cv-redline-label" style={{ left: (x1 + x2) / 2, top: (y1 + y2) / 2 }}>
              {l.label}
            </div>
          </div>
        )
      })}
      {scene.skipped && scene.noteAt && (
        <div
          className="cv-redline-label cv-redline-label--note"
          style={{ left: sx(scene.noteAt.x + scene.noteAt.width / 2), top: sy(scene.noteAt.y + scene.noteAt.height / 2) }}
        >
          rotated
        </div>
      )}
    </div>
  )
}
