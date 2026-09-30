// Startup screen: pick a profile (unlocking protected ones), recover with the recovery key, or
// create a new profile. The first profile created takes over files from before profiles existed.
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Lock, Plus } from 'lucide-react'
import type { ProfileInfo } from '@shared/api'
import { Button } from '../ui'
import { enterProfile, refreshProfiles, useProfiles } from './profile'
import { Avatar, ErrorText, FORGET_NOTE, Field, PicturePicker, ProfileAvatar, RecoveryKeyPanel, TextInput } from './parts'

type Step =
  | { kind: 'list' }
  | { kind: 'unlock'; profile: ProfileInfo }
  | { kind: 'recover'; profile: ProfileInfo }
  | { kind: 'recover-new'; profile: ProfileInfo; recoveryKey: string }
  | { kind: 'create' }
  | { kind: 'recovery-key'; name: string; recoveryKey: string; migrated: number }

const NEXT_COLORS = ['#6E56CF', '#3E63DD', '#0090FF', '#12A594', '#30A46C', '#E5484D', '#F76B15', '#D6409F', '#8E4EC6', '#455A64']

export function ProfilePicker(): JSX.Element | null {
  const state = useProfiles((s) => s.state)
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const profiles = state?.profiles ?? []

  // no profiles yet → straight to "create"
  useEffect(() => {
    if (state && state.profiles.length === 0 && step.kind === 'list') setStep({ kind: 'create' })
  }, [state, step.kind])

  if (!state) return null
  const back = profiles.length ? (): void => setStep({ kind: 'list' }) : undefined

  return (
    <div className="pf-screen">
      <div className="pf-center">
        {step.kind === 'list' && (
          <>
            <div className="pf-heading">Who’s designing?</div>
            <div className="pf-sub">Choose your profile.</div>
            <div className="pf-tiles">
              {[...profiles]
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="pf-tile"
                    onClick={() => {
                      if (p.hasPassword) setStep({ kind: 'unlock', profile: p })
                      else
                        void window.canvasApi?.profiles.open(p.id).then((r) => {
                          if (r.ok) void enterProfile()
                        })
                    }}
                  >
                    <ProfileAvatar profile={p} size={72} />
                    <span className="pf-tile__name">
                      <span className="pf-ellipsis">{p.name}</span>
                      {p.hasPassword && <Lock size={12} className="pf-tile__lock" />}
                    </span>
                  </button>
                ))}
              <button type="button" className="pf-tile" onClick={() => setStep({ kind: 'create' })}>
                <span className="pf-tile__add">
                  <Plus size={24} />
                </span>
                <span className="pf-tile__name pf-tile__name--muted">Add profile</span>
              </button>
            </div>
          </>
        )}

        {step.kind === 'unlock' && (
          <Unlock
            profile={step.profile}
            onBack={() => setStep({ kind: 'list' })}
            onForgot={() => setStep({ kind: 'recover', profile: step.profile })}
          />
        )}

        {step.kind === 'recover' && (
          <Recover
            profile={step.profile}
            onBack={() => setStep({ kind: 'unlock', profile: step.profile })}
            onValid={(key) => setStep({ kind: 'recover-new', profile: step.profile, recoveryKey: key })}
          />
        )}

        {step.kind === 'recover-new' && (
          <RecoverNewPassword
            profile={step.profile}
            recoveryKey={step.recoveryKey}
            onBack={() => setStep({ kind: 'recover', profile: step.profile })}
          />
        )}

        {step.kind === 'create' && (
          <Create
            first={profiles.length === 0}
            legacyCount={state.legacyFileCount}
            color={NEXT_COLORS[profiles.length % NEXT_COLORS.length]}
            onBack={back}
            onCreated={(name, recoveryKey, migrated) => {
              if (recoveryKey) setStep({ kind: 'recovery-key', name, recoveryKey, migrated })
              else void enterProfile()
            }}
          />
        )}

        {step.kind === 'recovery-key' && (
          <div className="pf-card">
            <RecoveryKeyPanel
              profileName={step.name}
              recoveryKey={step.recoveryKey}
              onDone={() => void enterProfile()}
              doneLabel="Open Vellum"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="pf-back" onClick={onClick}>
      <ArrowLeft size={14} /> Back
    </button>
  )
}

function useAutofocus(): React.RefObject<HTMLInputElement> {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

function Unlock({ profile, onBack, onForgot }: { profile: ProfileInfo; onBack: () => void; onForgot: () => void }): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useAutofocus()
  const submit = async (): Promise<void> => {
    if (!password || busy) return
    setBusy(true)
    setError('')
    const r = await window.canvasApi!.profiles.open(profile.id, password)
    if (r.ok) return enterProfile()
    setBusy(false)
    setError(r.error)
    setPassword('')
    setTimeout(() => input.current?.focus(), 0)
  }
  return (
    <div className="pf-card pf-card--narrow">
      <BackLink onClick={onBack} />
      <div className="pf-who">
        <ProfileAvatar profile={profile} size={72} />
        <div className="pf-title">{profile.name}</div>
      </div>
      <form
        className="pf-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextInput
          ref={input}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" full disabled={!password || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
      <button type="button" className="pf-link" onClick={onForgot}>
        Forgot password? Use recovery key
      </button>
    </div>
  )
}

function Recover({ profile, onBack, onValid }: { profile: ProfileInfo; onBack: () => void; onValid: (key: string) => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useAutofocus()
  const submit = async (): Promise<void> => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await window.canvasApi!.profiles.recover(profile.id, key)
    setBusy(false)
    if (r.ok) onValid(key)
    else setError(r.error)
  }
  return (
    <div className="pf-card pf-card--narrow">
      <BackLink onClick={onBack} />
      <div className="pf-who">
        <ProfileAvatar profile={profile} size={48} />
        <div className="pf-title">Use your recovery key</div>
        <div className="pf-text pf-text--center">Enter the recovery key you saved when you set the password for “{profile.name}”.</div>
      </div>
      <form
        className="pf-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextInput
          ref={input}
          className="pf-input--mono"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" full disabled={!key.trim() || busy}>
          Continue
        </Button>
      </form>
    </div>
  )
}

function RecoverNewPassword({
  profile,
  recoveryKey,
  onBack
}: {
  profile: ProfileInfo
  recoveryKey: string
  onBack: () => void
}): JSX.Element {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useAutofocus()
  const submit = async (): Promise<void> => {
    if (busy) return
    if (!pw) return setError('Enter a new password')
    if (pw !== confirm) return setError('The passwords don’t match')
    setBusy(true)
    setError('')
    const r = await window.canvasApi!.profiles.recover(profile.id, recoveryKey, pw)
    if (r.ok) return enterProfile()
    setBusy(false)
    setError(r.error)
  }
  return (
    <div className="pf-card pf-card--narrow">
      <BackLink onClick={onBack} />
      <div className="pf-who">
        <ProfileAvatar profile={profile} size={48} />
        <div className="pf-title">Set a new password</div>
        <div className="pf-text pf-text--center">Your recovery key keeps working with the new password.</div>
      </div>
      <form
        className="pf-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextInput ref={input} type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <TextInput type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? 'Opening…' : 'Save and open'}
        </Button>
      </form>
    </div>
  )
}

function Create({
  first,
  legacyCount,
  color,
  onBack,
  onCreated
}: {
  first: boolean
  legacyCount: number
  color: string
  onBack?: () => void
  onCreated: (name: string, recoveryKey: string | undefined, migrated: number) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | undefined>()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useAutofocus()
  const submit = async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) return setError('Enter a name')
    if (pw !== confirm) return setError('The passwords don’t match')
    setBusy(true)
    setError('')
    const r = await window.canvasApi!.profiles.create({ name: name.trim(), avatar, password: pw || undefined })
    if (!r.ok) {
      setBusy(false)
      setError(r.error)
      void refreshProfiles()
      return
    }
    await refreshProfiles()
    onCreated(name.trim(), r.recoveryKey, r.migrated)
  }
  return (
    <div className="pf-card">
      {onBack && <BackLink onClick={onBack} />}
      <div className="pf-title">{first ? 'Create your profile' : 'Add a profile'}</div>
      <div className="pf-text">
        {first
          ? 'Profiles keep each person’s files separate on this PC. No account, nothing leaves your computer.'
          : 'Each profile has its own files. No account, nothing leaves your computer.'}
      </div>
      <form
        className="pf-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <PicturePicker name={name} color={color} value={avatar} onChange={setAvatar} onError={setError} />
        <Field label="Name">
          <TextInput ref={input} placeholder="Your name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label={
            <>
              Password <span className="pf-optional">optional</span>
            </>
          }
          hint={<>With a password your files are encrypted on disk. {FORGET_NOTE}</>}
        >
          <TextInput type="password" placeholder="No password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {pw && <TextInput type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {legacyCount > 0 && (
          <div className="pf-note">
            Your existing files will move into this profile ({legacyCount} {legacyCount === 1 ? 'file' : 'files'}).
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? (legacyCount > 0 ? 'Moving your files…' : 'Creating…') : 'Create profile'}
        </Button>
      </form>
    </div>
  )
}

export { Avatar }
