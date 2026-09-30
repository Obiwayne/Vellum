// Update prompts: a badge in the title bar while an update is waiting, a reminder card when a new one
// arrives (again a day after "Later"), and the update dialog (also Help → Check for Updates…).
import { useState } from 'react'
import { create } from 'zustand'
import { ArrowDownToLine, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/api'
import { Button, IconButton, Modal } from '../ui'
import { flushNow } from '../model/persist'

const SNOOZE_KEY = 'vellum.update.snooze'
const SNOOZE_MS = 24 * 60 * 60 * 1000

interface UpdatesStore {
  status: UpdateStatus | null
  dialog: boolean
}

export const useUpdates = create<UpdatesStore>(() => ({ status: null, dialog: false }))

const api = (): Window['canvasApi']['updates'] | undefined => window.canvasApi?.updates

export function initUpdates(): () => void {
  const a = api()
  if (!a) return () => undefined
  void a.status().then((status) => status && useUpdates.setState({ status }))
  return a.onStatus((status) => useUpdates.setState({ status }))
}

export function openUpdates(recheck = true): void {
  useUpdates.setState({ dialog: true })
  if (recheck) void api()?.check()
}

function readSnooze(): { latest: string; until: number } | null {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null')
  } catch {
    return null
  }
}

function snooze(latest: string | undefined): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ latest, until: Date.now() + SNOOZE_MS }))
  } catch {
    // no storage: the reminder just comes back next launch
  }
}

async function installNow(): Promise<void> {
  // save open files now; the main process waits for the writes before it restarts
  flushNow()
  await api()?.install()
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Title-bar badge, shown while an update is waiting or installing. */
export function UpdateBadge(): JSX.Element | null {
  const status = useUpdates((s) => s.status)
  if (status?.state !== 'available' && status?.state !== 'installing') return null
  return (
    <button type="button" className="tb-update" onClick={() => openUpdates(false)} title="A new version of Vellum is ready">
      <ArrowDownToLine size={13} strokeWidth={1.75} />
      {status.state === 'installing' ? 'Updating…' : 'Update'}
    </button>
  )
}

/** Reminder card, bottom right. */
export function UpdateReminder(): JSX.Element | null {
  const status = useUpdates((s) => s.status)
  const dialog = useUpdates((s) => s.dialog)
  const [, rerender] = useState(0)
  if (status?.state !== 'available' || dialog) return null
  const snoozed = readSnooze()
  if (snoozed && snoozed.latest === status.latest && snoozed.until > Date.now()) return null
  const later = (): void => {
    snooze(status.latest)
    rerender((n) => n + 1)
  }
  return (
    <div className="upd-card" role="status">
      <div className="upd-card__head">
        <span className="upd-card__dot" />
        <span className="upd-card__title">Vellum update available</span>
        <IconButton icon={<X size={14} />} label="Remind me later" onClick={later} />
      </div>
      <div className="upd-card__body">
        {plural(status.behind, 'change')} since your version.
        {status.commits[0] && <span className="upd-card__latest">Latest: {status.commits[0].subject}</span>}
      </div>
      <div className="upd-card__actions">
        <Button size="sm" variant="ghost" onClick={later}>
          Later
        </Button>
        <Button size="sm" onClick={() => openUpdates(false)}>
          What's new
        </Button>
        <Button size="sm" variant="primary" onClick={() => void installNow()}>
          Update and restart
        </Button>
      </div>
    </div>
  )
}

function statusLine(s: UpdateStatus | null): string {
  if (!s || s.state === 'idle' || s.state === 'checking') return 'Checking GitHub for updates…'
  if (s.state === 'up-to-date') return s.message ?? `You're on the latest version (${s.current}).`
  if (s.state === 'available') return `${plural(s.behind, 'change')} available. You're on ${s.current}, the latest is ${s.latest}.`
  return s.message ?? 'Updating…'
}

export function UpdateDialog(): JSX.Element {
  const open = useUpdates((s) => s.dialog)
  const s = useUpdates((st) => st.status)
  const close = (): void => useUpdates.setState({ dialog: false })
  const installing = s?.state === 'installing'
  const canInstall = s?.state === 'available' && !s.dirty.length && !s.message
  const footer = (
    <>
      <Button onClick={() => void api()?.check()} disabled={installing || s?.state === 'checking'}>
        Check again
      </Button>
      {s?.state === 'available' ? (
        <Button variant="primary" disabled={!canInstall} onClick={() => void installNow()}>
          Update and restart
        </Button>
      ) : (
        <Button variant="primary" onClick={close} disabled={installing}>
          Done
        </Button>
      )}
    </>
  )
  return (
    <Modal open={open} onClose={() => !installing && close()} title="Updates" width={480} footer={footer}>
      <div className="upd-dialog">
        <p className={['upd-dialog__status', s?.state === 'error' && 'upd-dialog__status--error'].filter(Boolean).join(' ')}>
          {statusLine(s)}
        </p>
        {s?.state === 'available' && s.message && <p className="upd-dialog__warn">{s.message}</p>}
        {s?.state === 'available' && s.dirty.length > 0 && (
          <p className="upd-dialog__warn">
            These files were edited on this PC, so updating would overwrite them. Commit or undo the changes first:{' '}
            {s.dirty.slice(0, 5).join(', ')}
            {s.dirty.length > 5 ? ` and ${s.dirty.length - 5} more` : ''}
          </p>
        )}
        {s?.state === 'unsupported' && (
          <Button onClick={() => window.canvasApi?.openExternal('https://github.com/Obiwayne/Vellum')}>Open GitHub</Button>
        )}
        {(s?.state === 'available' || installing) && s.commits.length > 0 && (
          <>
            <div className="upd-dialog__heading">What's new</div>
            <ul className="upd-dialog__list">
              {s.commits.map((c) => (
                <li key={c.hash}>
                  <span className="upd-dialog__subject">{c.subject}</span>
                  <span className="upd-dialog__date">{new Date(c.date).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            {s.behind > s.commits.length && <div className="upd-dialog__more">and {s.behind - s.commits.length} earlier changes</div>}
          </>
        )}
      </div>
    </Modal>
  )
}
