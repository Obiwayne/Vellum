// "Restore unsaved changes?" after a crash (naming the design once in the text), and a note when a damaged file was read from its backup.
import { Button, Modal } from '../ui'
import { discardRecovery, dismissNotices, postponeRecovery, restoreRecovery, useRecovery } from '../model/recovery'

export function RecoveryPrompt(): JSX.Element | null {
  const items = useRecovery((s) => s.items)
  const notices = useRecovery((s) => s.notices)
  if (!items.length && !notices.length) return null
  const item = items[0]
  const name = item?.doc.name || 'Untitled'
  return (
    <Modal
      open
      onClose={() => (item ? postponeRecovery() : dismissNotices())}
      width={460}
      title={item ? 'Restore unsaved changes?' : 'Restored from backup'}
      footer={
        item ? (
          <>
            <Button data-recovery="discard" onClick={() => discardRecovery(item.doc.id)}>
              Discard
            </Button>
            <Button data-recovery="restore" variant="primary" onClick={() => restoreRecovery(item.doc.id)}>
              Restore
            </Button>
          </>
        ) : (
          <Button data-recovery="ok" variant="primary" onClick={dismissNotices}>
            OK
          </Button>
        )
      }
    >
      <div data-recovery-prompt style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {notices.map((n) => (
          <p key={n} style={{ margin: 0 }} data-recovery-notice>
            {n}
          </p>
        ))}
        {item && (
          <p style={{ margin: 0 }}>
            Vellum closed before your last changes to <strong style={{ color: 'var(--text)' }}>{name}</strong> were saved. Restore them?
            {items.length > 1 ? ` (${items.length - 1} more after this one)` : ''}
          </p>
        )}
      </div>
    </Modal>
  )
}
