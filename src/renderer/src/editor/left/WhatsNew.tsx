import { useState } from 'react'
import { Button, Modal } from '../../ui'

export const APP_VERSION = '0.1.0'

const NOTES: { version: string; items: string[] }[] = [
  {
    version: APP_VERSION,
    items: [
      'First local release of Vellum.',
      'Design with real HTML/CSS: frames, flex layouts, text, rectangles, images and SVG.',
      'Pages, a layers tree with drag-and-drop, and theme tokens with a starter theme.',
      'MCP server so Claude can read and write your designs.'
    ]
  }
]

export function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What's new"
      width={420}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="lp-whatsnew">
        {NOTES.map((n) => (
          <div key={n.version}>
            <div className="lp-whatsnew__version">Vellum {n.version}</div>
            <ul>
              {n.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** "What's new • Feedback" footer used by the left panel and the dashboard sidebar. */
export function FooterLinks({ className }: { className?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={['lp-footer', className].filter(Boolean).join(' ')}>
      <button type="button" className="lp-footer__link" onClick={() => setOpen(true)}>
        What’s new
      </button>
      <span className="lp-footer__dot">•</span>
      <button type="button" className="lp-footer__link">
        Feedback
      </button>
      <WhatsNewModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
