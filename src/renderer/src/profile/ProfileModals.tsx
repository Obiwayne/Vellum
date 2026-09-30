// Edit profile (name, picture, password, recovery key) and Delete profile dialogs.
import { useEffect, useState } from 'react'
import type { ProfileInfo } from '@shared/api'
import { Button, Modal } from '../ui'
import { leaveAfterDelete, refreshProfiles, useCurrentProfile } from './profile'
import { ErrorText, FORGET_NOTE, Field, PicturePicker, RecoveryKeyPanel, TextInput } from './parts'

type PwMode = null | 'add' | 'change' | 'remove' | 'recovery'

export function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const profile = useCurrentProfile()
  if (!open || !profile) return null
  return <EditProfile profile={profile} onClose={onClose} />
}

function EditProfile({ profile, onClose }: { profile: ProfileInfo; onClose: () => void }): JSX.Element {
  const api = window.canvasApi!.profiles
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState<string | undefined>(profile.avatar)
  const [mode, setMode] = useState<PwMode>(null)
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [done, setDone] = useState('')

  useEffect(() => {
    setCurrent('')
    setPw('')
    setConfirm('')
    setError('')
  }, [mode])

  const dirty = name.trim() !== profile.name || avatar !== profile.avatar

  const saveBasics = async (): Promise<boolean> => {
    if (!dirty) return true
    if (!name.trim()) {
      setError('Enter a name')
      return false
    }
    const r = await api.update({ name: name.trim(), avatar: avatar ?? null })
    if (!r.ok) {
      setError(r.error)
      return false
    }
    await refreshProfiles()
    return true
  }

  const runPassword = async (): Promise<void> => {
    if (busy) return
    setError('')
    if ((mode === 'add' || mode === 'change') && !pw) return setError('Enter a new password')
    if ((mode === 'add' || mode === 'change') && pw !== confirm) return setError('The passwords don’t match')
    if (mode !== 'add' && !current) return setError('Enter your current password')
    setBusy(true)
    try {
      if (mode === 'add' || mode === 'change') {
        const r = await api.setPassword(mode === 'change' ? current : undefined, pw)
        if (!r.ok) return setError(r.error)
        if (r.recoveryKey) setRecoveryKey(r.recoveryKey)
        setDone(mode === 'add' ? 'Password added. Your files are now encrypted.' : 'Password changed.')
      } else if (mode === 'remove') {
        const r = await api.removePassword(current)
        if (!r.ok) return setError(r.error)
        setDone('Password removed. Your files are now stored as plain JSON.')
      } else if (mode === 'recovery') {
        const r = await api.newRecoveryKey(current)
        if (!r.ok) return setError(r.error)
        setRecoveryKey(r.recoveryKey)
        setDone('New recovery key created. The old one no longer works.')
      }
      setMode(null)
      await refreshProfiles()
    } finally {
      setBusy(false)
    }
  }

  if (recoveryKey)
    return (
      <Modal open bare onClose={() => undefined} width={440}>
        <div className="pf-modal-body">
          <RecoveryKeyPanel profileName={profile.name} recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} doneLabel="Done" />
        </div>
      </Modal>
    )

  const pwForm = mode && (
    <form
      className="pf-form pf-pwform"
      onSubmit={(e) => {
        e.preventDefault()
        void runPassword()
      }}
    >
      {mode !== 'add' && (
        <TextInput type="password" placeholder="Current password" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
      )}
      {(mode === 'add' || mode === 'change') && (
        <>
          <TextInput
            type="password"
            placeholder="New password"
            value={pw}
            autoFocus={mode === 'add'}
            onChange={(e) => setPw(e.target.value)}
          />
          <TextInput type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </>
      )}
      {mode === 'add' && <div className="pf-hint">Your files will be encrypted on disk. {FORGET_NOTE}</div>}
      {mode === 'remove' && (
        <div className="pf-hint">Your files will be decrypted and stored as plain JSON that anyone using this PC can read.</div>
      )}
      {mode === 'recovery' && <div className="pf-hint">A new recovery key replaces the old one.</div>}
      <div className="pf-row pf-row--end">
        <Button onClick={() => setMode(null)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className={mode === 'remove' ? 'db-danger-btn' : undefined} disabled={busy}>
          {busy
            ? 'Working…'
            : mode === 'add'
              ? 'Add password'
              : mode === 'change'
                ? 'Change password'
                : mode === 'remove'
                  ? 'Remove password'
                  : 'Create new key'}
        </Button>
      </div>
    </form>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit profile"
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void saveBasics().then((ok) => ok && onClose())
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="pf-modal-body">
        <PicturePicker name={name} color={profile.color} value={avatar} onChange={setAvatar} onError={setError} />
        <Field label="Name">
          <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="pf-section">
          <div className="pf-field__label">Password</div>
          <div className="pf-text">
            {profile.hasPassword
              ? 'This profile is protected. Its files are encrypted on disk.'
              : 'No password. Files are stored as plain JSON that anyone using this PC can read.'}
          </div>
          {!mode && (
            <div className="pf-row">
              {profile.hasPassword ? (
                <>
                  <Button size="sm" onClick={() => setMode('change')}>
                    Change password
                  </Button>
                  <Button size="sm" onClick={() => setMode('recovery')}>
                    New recovery key
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode('remove')}>
                    Remove password
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setMode('add')}>
                  Add password
                </Button>
              )}
            </div>
          )}
          {pwForm}
          {done && !mode && <div className="pf-done">{done}</div>}
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  )
}

export function DeleteProfileModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const profile = useCurrentProfile()
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setPassword('')
      setTyped('')
      setError('')
    }
  }, [open])
  if (!open || !profile) return null
  const canDelete = typed.trim() === profile.name && (!profile.hasPassword || password)
  const run = async (): Promise<void> => {
    if (!canDelete || busy) return
    setBusy(true)
    const r = await window.canvasApi!.profiles.remove(profile.id, password || undefined)
    if (r.ok) return leaveAfterDelete()
    setBusy(false)
    setError(r.error)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete profile?"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button className="db-danger-btn" disabled={!canDelete || busy} onClick={() => void run()}>
            {busy ? 'Deleting…' : 'Delete profile'}
          </Button>
        </>
      }
    >
      <form
        className="pf-modal-body"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="pf-text">“{profile.name}” and all of its files will be permanently deleted from this PC. This can’t be undone.</div>
        <Field
          label={
            <>
              Type <b>{profile.name}</b> to confirm
            </>
          }
        >
          <TextInput value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
        </Field>
        {profile.hasPassword && (
          <Field label="Password">
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
