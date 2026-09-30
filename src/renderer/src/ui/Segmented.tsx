import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export interface SegmentOption<T extends string> {
  value: T
  label?: ReactNode
  icon?: ReactNode
  /** tooltip */
  title?: string
  shortcut?: string
}

export interface SegmentedProps<T extends string> {
  value: T | null
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  full?: boolean
  className?: string
}

/** Pill segmented control (Design | Theme, direction toggles, alignment…). */
export function Segmented<T extends string>({ value, options, onChange, size = 'sm', full, className }: SegmentedProps<T>): JSX.Element {
  return (
    <div
      className={['c-seg', size === 'md' && 'c-seg--md', full && 'c-seg--full', className].filter(Boolean).join(' ')}
      role="tablist"
    >
      {options.map((o) => {
        const btn = (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={o.value === value}
            className={['c-seg__item', o.value === value && 'c-seg__item--active'].filter(Boolean).join(' ')}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        )
        return o.title ? (
          <Tooltip key={o.value} label={o.title} shortcut={o.shortcut}>
            {btn}
          </Tooltip>
        ) : (
          btn
        )
      })}
    </div>
  )
}
