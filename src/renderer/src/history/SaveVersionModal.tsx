// "Save to version history" dialog (File menu, Ctrl+Alt+S, + in the history viewer).
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '../ui'
import { useStore } from '../model/store'
import { toast } from '../editor/canvas/toast'
import { saveNamedVersion, useSaveVersionDialog } from './versions'
import './history.css'

export function SaveVersionModal(): JSX.Element {
  const docId = useSaveVersionDialog((s) => s.docId)
  const close = useSaveVersionDialog((s) => s.close)
  const docName = useStore((s) => (docId ? s.docs[docId]?.name : undefined))
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!docId) return
    setName('')
    setTimeout(() => input.current?.focus(), 0)
  }, [docId])

  const save = async (): Promise<void> => {
    if (!docId || saving) return
    setSaving(true)
    try {
      const v = await saveNamedVersion(docId, name)
      toast(v ? 'Version saved' : 'The version could not be saved')
      close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(docId && docName !== undefined)}
      onClose={close}
      title="Save to version history"
      width={420}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="hv-modal-body">
        <input
          ref={input}
          className="hv-save-field"
          placeholder="Version name (optional)"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void save()
          }}
        />
        <p className="hv-save-hint">
          Saves {docName ? `“${docName}”` : 'this file'} as it is now. Named versions are kept until you delete them.
        </p>
      </div>
    </Modal>
  )
}
