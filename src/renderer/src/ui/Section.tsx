import type { CSSProperties, ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton } from './Button'

export interface SectionProps {
  title: ReactNode
  /** muted title, no body (e.g. "Shadow +" before anything is added) */
  empty?: boolean
  /** shows a trailing '+' */
  onAdd?: () => void
  addLabel?: string
  /** shows a trailing '−' */
  onRemove?: () => void
  removeLabel?: string
  /** extra icon buttons placed before +/− (eye toggle, options, collapse…) */
  actions?: ReactNode
  /** click on the title (e.g. Layout ⌄ dropdown) */
  onTitleClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children?: ReactNode
  className?: string
}

/** Inspector section: 12px/500 title row, trailing icon slots, 1px hairline at the bottom. */
export function Section({
  title,
  empty,
  onAdd,
  addLabel = 'Add',
  onRemove,
  removeLabel = 'Remove',
  actions,
  onTitleClick,
  children,
  className
}: SectionProps): JSX.Element {
  const hasBody = !empty && children !== undefined && children !== null && children !== false
  return (
    <section
      className={['c-section', empty && 'c-section--empty', hasBody && 'c-section--has-body', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="c-section__head">
        {onTitleClick ? (
          <button type="button" className="c-section__title c-section__title--button" onClick={onTitleClick}>
            {title}
          </button>
        ) : (
          <div className="c-section__title">{title}</div>
        )}
        <div className="c-section__actions">
          {actions}
          {onRemove && <IconButton icon={<Minus size={16} />} label={removeLabel} onClick={onRemove} />}
          {onAdd && <IconButton icon={<Plus size={16} />} label={addLabel} onClick={onAdd} />}
        </div>
      </div>
      {hasBody && <div className="c-section__body">{children}</div>}
    </section>
  )
}

/** Horizontal row of controls inside a section (gap 8). */
export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <div className="c-row" style={style}>
      {children}
    </div>
  )
}
