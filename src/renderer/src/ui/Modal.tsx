import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './Button'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  width?: number
  height?: number
  footer?: ReactNode
  children: ReactNode
  /** hide the header entirely (render your own) */
  bare?: boolean
}

export function Modal({ open, onClose, title, width = 640, height, footer, children, bare }: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="c-modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="c-modal" style={{ width, height }} role="dialog" aria-modal="true">
        {!bare && (
          <div className="c-modal__header">
            <div className="c-modal__title">{title}</div>
            <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
          </div>
        )}
        <div className="c-modal__body">{children}</div>
        {footer && <div className="c-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
