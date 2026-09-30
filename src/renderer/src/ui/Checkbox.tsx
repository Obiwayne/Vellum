import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { formatShortcut } from './shortcut'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  shortcut?: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, shortcut, disabled, className }: CheckboxProps): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={['c-check', checked && 'c-check--on', className].filter(Boolean).join(' ')}
      style={disabled ? { opacity: 0.5 } : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="c-check__box">{checked && <Check size={12} strokeWidth={2.5} />}</span>
      {label && <span>{label}</span>}
      {shortcut && <span className="c-check__shortcut">{formatShortcut(shortcut, true)}</span>}
    </button>
  )
}
