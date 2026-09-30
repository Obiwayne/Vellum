import { useRef } from 'react'

export interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  onChangeStart?: () => void
  onChangeEnd?: (value: number) => void
  /** show filled portion left of the thumb */
  fill?: boolean
  className?: string
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, onChangeStart, onChangeEnd, fill, className }: SliderProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const last = useRef(value)
  const pct = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0

  const update = (clientX: number): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left - 7) / Math.max(1, r.width - 14)))
    const v = Math.round((min + t * (max - min)) / step) * step
    if (v !== last.current) {
      last.current = v
      onChange(v)
    }
  }
  return (
    <div
      ref={ref}
      className={['c-slider', className].filter(Boolean).join(' ')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
        last.current = value
        onChangeStart?.()
        update(e.clientX)
      }}
      onPointerMove={(e) => {
        if (dragging.current) update(e.clientX)
      }}
      onPointerUp={() => {
        if (!dragging.current) return
        dragging.current = false
        onChangeEnd?.(last.current)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    >
      <div className="c-slider__track" />
      {fill && <div className="c-slider__fill" style={{ width: `${pct * 100}%` }} />}
      <div className="c-slider__thumb" style={{ left: `calc(7px + (100% - 14px) * ${pct})` }} />
    </div>
  )
}
