// Building blocks shared by the profile picker, Edit profile and Delete profile.
import { forwardRef, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Camera, Check, Copy, Download, Lock, User } from 'lucide-react'
import type { ProfileInfo } from '@shared/api'
import { Button, Checkbox } from '../ui'
import { imageFileToAvatar } from './profile'
import './profile.css'

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

interface AvatarProps {
  name: string
  avatar?: string
  color?: string
  size?: number
  className?: string
  title?: string
}

/** Round picture, or the first letter of the name on the profile colour. */
export function Avatar({ name, avatar, color = '#455A64', size = 24, className, title }: AvatarProps): JSX.Element {
  const style: CSSProperties = { width: size, height: size }
  if (avatar)
    return (
      <img
        className={['pf-avatar', className].filter(Boolean).join(' ')}
        style={style}
        src={avatar}
        alt=""
        title={title}
        draggable={false}
      />
    )
  return (
    <span
      className={['pf-avatar', 'pf-avatar--initial', className].filter(Boolean).join(' ')}
      style={{ ...style, background: color, fontSize: Math.max(10, Math.round(size * 0.44)) }}
      title={title}
    >
      {name.trim() ? initialOf(name) : <User size={Math.round(size * 0.5)} />}
    </span>
  )
}

export function ProfileAvatar({
  profile,
  size,
  className,
  title
}: {
  profile: ProfileInfo
  size?: number
  className?: string
  title?: string
}): JSX.Element {
  return <Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={size} className={className} title={title} />
}

/** Circle preview with "Choose picture" / "Remove". */
export function PicturePicker({
  name,
  color,
  value,
  onChange,
  onError
}: {
  name: string
  color: string
  value?: string
  onChange: (dataUrl: string | undefined) => void
  onError: (msg: string) => void
}): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null)
  const pick = (): void => input.current?.click()
  return (
    <div className="pf-picture">
      <button type="button" className="pf-picture__circle" onClick={pick} aria-label="Choose picture">
        <Avatar name={name} avatar={value} color={color} size={72} />
        <span className="pf-picture__cam">
          <Camera size={14} />
        </span>
      </button>
      <div className="pf-picture__actions">
        <Button size="sm" onClick={pick}>
          {value ? 'Change picture' : 'Choose picture'}
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            Remove
          </Button>
        )}
        <div className="pf-hint">Optional. Cropped to a square.</div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          imageFileToAvatar(f).then(onChange, (err: Error) => onError(err.message))
        }}
      />
    </div>
  )
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }): JSX.Element {
  return (
    <label className="pf-field">
      <span className="pf-field__label">{label}</span>
      {children}
      {hint && <span className="pf-hint">{hint}</span>}
    </label>
  )
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(props, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      autoComplete="off"
      {...props}
      className={['pf-input', props.className].filter(Boolean).join(' ')}
      onKeyDown={(e) => {
        e.stopPropagation()
        props.onKeyDown?.(e)
      }}
    />
  )
})

export const FORGET_NOTE = 'If you forget it and lose the recovery key, your files can’t be recovered.'

export function ErrorText({ children }: { children?: ReactNode }): JSX.Element | null {
  return children ? <div className="pf-error">{children}</div> : null
}

/** Shows a fresh recovery key once, with Copy / Save as .txt and an "I've saved it" confirmation. */
export function RecoveryKeyPanel({
  profileName,
  recoveryKey,
  onDone,
  doneLabel = 'Continue'
}: {
  profileName: string
  recoveryKey: string
  onDone: () => void
  doneLabel?: string
}): JSX.Element {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState('')
  return (
    <div className="pf-recovery">
      <div className="pf-recovery__icon">
        <Lock size={18} />
      </div>
      <div className="pf-title">Save your recovery key</div>
      <p className="pf-text">
        If you forget your password, this key is the only way to open “{profileName}”. It is shown only now. Keep it somewhere safe and
        private — anyone with it can open the profile.
      </p>
      <div className="pf-recovery__key" onCopy={(e) => e.stopPropagation()}>
        {recoveryKey}
      </div>
      <div className="pf-row">
        <Button
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => {
            void navigator.clipboard.writeText(recoveryKey).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          icon={<Download size={14} />}
          onClick={() => {
            void window.canvasApi?.profiles.saveRecoveryKey(profileName, recoveryKey).then((r) => {
              if (r.ok && r.path) setNote(`Saved as ${r.path.split(/[\\/]/).pop()}`)
              else if (!r.ok) setNote(r.error)
            })
          }}
        >
          Save as .txt
        </Button>
      </div>
      {note && <div className="pf-hint pf-recovery__note">{note}</div>}
      <div className="pf-recovery__confirm">
        <Checkbox checked={saved} onChange={setSaved} label="I’ve saved my recovery key" />
      </div>
      <Button variant="primary" full disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
