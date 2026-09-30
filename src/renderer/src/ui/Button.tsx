import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Tooltip, type TooltipSide } from './Tooltip'
import { formatShortcut } from './shortcut'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default = raised dark, primary = white (#F2F2F2), ghost = transparent */
  variant?: 'default' | 'primary' | 'ghost'
  size?: 'sm' | 'md'
  icon?: ReactNode
  /** muted trailing shortcut, e.g. 'Shift+A' → "Shift + A" */
  shortcut?: string
  full?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, shortcut, full, className, children, type = 'button', ...rest },
  ref
) {
  const cls = ['c-btn', `c-btn--${variant}`, size === 'sm' && 'c-btn--sm', full && 'c-btn--full', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon}
      {children}
      {shortcut && <span className="c-btn__shortcut">{formatShortcut(shortcut, true)}</span>}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  icon: ReactNode
  /** tooltip text (also aria-label) */
  label?: string
  shortcut?: string
  tooltipSide?: TooltipSide
  active?: boolean
  accent?: boolean
  /** square size in px (default 24) */
  size?: number
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, tooltipSide = 'bottom', active, accent, size = 24, className, style, type = 'button', ...rest },
  ref
) {
  const cls = ['c-iconbtn', active && 'c-iconbtn--active', accent && 'c-iconbtn--accent', className]
    .filter(Boolean)
    .join(' ')
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cls}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {icon}
    </button>
  )
  return label ? (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
})
