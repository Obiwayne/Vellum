import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Menu, type MenuEntry } from './Menu'

export interface SelectOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
}
/** An option, or 'separator' to draw a hairline between groups. */
export type SelectEntry<T extends string> = SelectOption<T> | 'separator'

export interface SelectProps<T extends string> {
  value: T | null
  options: SelectEntry<T>[]
  onChange: (value: T) => void
  placeholder?: string
  /** leading icon inside the control */
  icon?: ReactNode
  size?: 'sm' | 'md'
  variant?: 'field' | 'ghost'
  /** display override for the current value */
  renderValue?: (opt: SelectOption<T> | undefined) => ReactNode
  className?: string
  style?: CSSProperties
  menuMinWidth?: number
  disabled?: boolean
}

/** Field-looking dropdown button that opens a Menu with a check next to the current value. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  icon,
  size = 'md',
  variant = 'field',
  renderValue,
  className,
  style,
  menuMinWidth,
  disabled
}: SelectProps<T>): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o): o is SelectOption<T> => o !== 'separator' && o.value === value)
  const items: MenuEntry[] = options.map((o) =>
    o === 'separator'
      ? { type: 'separator' }
      : {
          label: o.label,
          icon: o.icon,
          shortcut: o.shortcut,
          disabled: o.disabled,
          checked: o.value === value,
          onSelect: () => onChange(o.value)
        }
  )
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={['c-select', size === 'sm' && 'c-select--sm', variant === 'ghost' && 'c-select--ghost', className]
          .filter(Boolean)
          .join(' ')}
        style={style}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <span className="c-select__icon">{icon}</span>}
        <span className={['c-select__value', !current && 'c-select__value--placeholder'].filter(Boolean).join(' ')}>
          {renderValue ? renderValue(current) : current?.label ?? placeholder ?? ''}
        </span>
        <span className="c-select__chevron">
          <ChevronDown size={14} />
        </span>
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        items={items}
        minWidth={Math.max(menuMinWidth ?? 0, ref.current?.offsetWidth ?? 0)}
      />
    </>
  )
}
