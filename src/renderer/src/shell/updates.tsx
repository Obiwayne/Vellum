// Update prompts: a badge in the title bar while an update is waiting, a card when a new one arrives, and the update dialog
// (also Help → Check for Updates…). Two kinds of copy:
//  - a clone (git): "N changes available", a reminder again a day after "Later", "Update and restart" pulls and rebuilds;
//  - an installed build (installer): "Version X is available" with release notes, download progress, "Restart to update" once the
//    download is ready, a short message with Retry on errors. The card never blocks editing and can be dismissed for the session.
import { useState } from 'react'
import { create } from 'zustand'
import { ArrowDownToLine, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/api'
import { Button, IconButton, Modal } from '../ui'
import { flushNow } from '../model/persist'
import { useStore } from '../model/store'

const SNOOZE_KEY = 'vellum.update.snooze'
const SNOOZE_MS = 24 * 60 * 60 * 1000

/** The "Check for updates automatically" setting (Settings page); on unless switched off. */
export const AUTO_UPDATE_PREF = 'updates.auto'

interface UpdatesStore {
  status: UpdateStatus | null
  dialog: boolean
  /** installed builds: what the user closed the card for, for this session only (a new version or a new error shows it again) */
  dismissed: string | null
}

export const useUpdates = create<UpdatesStore>(() => ({ status: null, dialog: false, dismissed: null }))

const api = (): Window['canvasApi']['updates'] | undefined => window.canvasApi?.updates

export const autoCheckOn = (prefs: Record<string, unknown>): boolean => prefs[AUTO_UPDATE_PREF] !== false

export function initUpdates(): () => void {
  const a = api()
  if (!a) return () => undefined
  void a.status().then((status) => status && useUpdates.setState({ status }))
  // tell the main process the setting now and whenever it changes: it reads it before every timed check
  let last: boolean | undefined
  const push = (): void => {
    const on = autoCheckOn(useStore.getState().prefs)
    if (on !== last) {
      last = on
      void a.setAutoCheck?.(on)
    }
  }
  push()
  const off = useStore.subscribe(push)
  const offStatus = a.onStatus((status) => useUpdates.setState({ status }))
  return () => {
    off()
    offStatus()
  }
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

/** What the card is about, so closing it hides exactly that: a version, or one error. */
export const updateKey = (s: UpdateStatus): string => (s.state === 'error' ? `error:${s.message ?? ''}` : `version:${s.latest ?? ''}`)

/** The states an installed build's card shows. */
export const installedCardStates = ['available', 'downloading', 'ready', 'error'] as const

/** Title-bar badge: clones while an update waits or installs; installed builds once the download is ready to restart into. */
export function UpdateBadge(): JSX.Element | null {
  const status = useUpdates((s) => s.status)
  const installed = Boolean(status?.installed)
  const show = installed ? status?.state === 'ready' || status?.state === 'installing' : status?.state === 'available' || status?.state === 'installing'
  if (!status || !show) return null
  return (
    <button type="button" className="tb-update" onClick={() => openUpdates(false)} title={installed ? 'A new version of Vellum is ready to install' : 'A new version of Vellum is ready'}>
      <ArrowDownToLine size={13} strokeWidth={1.75} />
      {status.state === 'installing' ? 'Updating…' : installed ? 'Restart to update' : 'Update'}
    </button>
  )
}

/** Installed build: the card for an available, downloading, ready or failed update. */
function InstalledCard({ status }: { status: UpdateStatus }): JSX.Element | null {
  const dismissed = useUpdates((s) => s.dismissed)
  const [notes, setNotes] = useState(false)
  const key = updateKey(status)
  if (dismissed === key) return null
  const dismiss = (): void => useUpdates.setState({ dismissed: key })
  const version = status.latest ? `Version ${status.latest}` : 'A new version'
  const down = status.state === 'downloading'
  return (
    <div className="upd-card" role="status" data-update-card={status.state}>
      <div className="upd-card__head">
        <span className={['upd-card__dot', status.state === 'error' && 'upd-card__dot--error'].filter(Boolean).join(' ')} />
        <span className="upd-card__title">
          {status.state === 'ready' ? `${version} is ready to install` : status.state === 'error' ? "Couldn't check for updates" : `${version} is available`}
        </span>
        <IconButton icon={<X size={14} />} label="Dismiss" onClick={dismiss} />
      </div>
      {status.state === 'error' ? (
        <div className="upd-card__body">{status.message ?? 'Something went wrong.'}</div>
      ) : (
        <div className="upd-card__body">
          {status.state === 'ready' ? 'Restart Vellum to finish updating. Your files are saved first.' : down ? `Downloading… ${status.progress ?? 0}%` : 'Downloading in the background.'}
          {(down || status.state === 'available') && (
            <div className="upd-progress" role="progressbar" aria-valuenow={status.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="upd-progress__bar" style={{ width: `${status.progress ?? 0}%` }} />
            </div>
          )}
          {status.releaseNotes && (
            <>
              <button type="button" className="upd-card__notes-toggle" aria-expanded={notes} onClick={() => setNotes((n) => !n)}>
                {notes ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Release notes
              </button>
              {notes && <div className="upd-card__notes">{status.releaseNotes}</div>}
            </>
          )}
        </div>
      )}
      <div className="upd-card__actions">
        {status.state === 'ready' && (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Later
            </Button>
            <Button size="sm" variant="primary" onClick={() => void installNow()}>
              Restart to update
            </Button>
          </>
        )}
        {status.state === 'error' && (
          <Button size="sm" variant="primary" onClick={() => void api()?.check()}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

/** Reminder card, bottom right. */
export function UpdateReminder(): JSX.Element | null {
  const status = useUpdates((s) => s.status)
  const dialog = useUpdates((s) => s.dialog)
  const [, rerender] = useState(0)
  if (!status || dialog) return null
  if (status.installed) return (installedCardStates as readonly string[]).includes(status.state) ? <InstalledCard status={status} /> : null
  if (status.state !== 'available') return null
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
  if (!s) return 'Checking for updates…'
  if (s.installed) {
    switch (s.state) {
      case 'idle':
      case 'checking':
        return 'Checking for updates…'
      case 'up-to-date':
        return `You're on the latest version (${s.current}).`
      case 'available':
        return `Version ${s.latest ?? ''} is available. Downloading in the background…`.replace('Version  ', 'A new version ')
      case 'downloading':
        return `Version ${s.latest ?? ''} is downloading… ${s.progress ?? 0}%`.replace('Version  ', 'A new version ')
      case 'ready':
        return `Version ${s.latest ?? ''} is ready. Restart Vellum to install it.`.replace('Version  ', 'The new version ')
      case 'installing':
        return 'Restarting to update…'
      default:
        return s.message ?? 'Updates are not available in this copy.'
    }
  }
  if (s.state === 'idle' || s.state === 'checking') return 'Checking GitHub for updates…'
  if (s.state === 'up-to-date') return s.message ?? `You're on the latest version (${s.current}).`
  if (s.state === 'available') return `${plural(s.behind, 'change')} available. You're on ${s.current}, the latest is ${s.latest}.`
  return s.message ?? 'Updating…'
}

export function UpdateDialog(): JSX.Element {
  const open = useUpdates((s) => s.dialog)
  const s = useUpdates((st) => st.status)
  const close = (): void => useUpdates.setState({ dialog: false })
  const installed = Boolean(s?.installed)
  const installing = s?.state === 'installing'
  const busy = s?.state === 'checking' || (installed && s?.state === 'downloading')
  const canInstall = installed ? s?.state === 'ready' : s?.state === 'available' && !s.dirty.length && !s.message
  const installLabel = installed ? 'Restart to update' : 'Update and restart'
  const footer = (
    <>
      <Button onClick={() => void api()?.check()} disabled={installing || busy || (installed && s?.state === 'ready')}>
        {installed && s?.state === 'error' ? 'Retry' : 'Check again'}
      </Button>
      {canInstall ? (
        <Button variant="primary" onClick={() => void installNow()}>
          {installLabel}
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
        <p className={['upd-dialog__status', s?.state === 'error' && 'upd-dialog__status--error'].filter(Boolean).join(' ')}>{statusLine(s)}</p>
        {installed && s?.state === 'downloading' && (
          <div className="upd-progress" role="progressbar" aria-valuenow={s.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="upd-progress__bar" style={{ width: `${s.progress ?? 0}%` }} />
          </div>
        )}
        {installed && s?.releaseNotes && (s.state === 'available' || s.state === 'downloading' || s.state === 'ready') && (
          <>
            <div className="upd-dialog__heading">Release notes</div>
            <div className="upd-card__notes upd-dialog__notes">{s.releaseNotes}</div>
          </>
        )}
        {!installed && s?.state === 'available' && s.message && <p className="upd-dialog__warn">{s.message}</p>}
        {!installed && s?.state === 'available' && s.dirty.length > 0 && (
          <p className="upd-dialog__warn">
            These files were edited on this PC, so updating would overwrite them. Commit or undo the changes first:{' '}
            {s.dirty.slice(0, 5).join(', ')}
            {s.dirty.length > 5 ? ` and ${s.dirty.length - 5} more` : ''}
          </p>
        )}
        {s?.state === 'unsupported' && (
          <Button onClick={() => window.canvasApi?.openExternal('https://github.com/Obiwayne/Vellum')}>Open GitHub</Button>
        )}
        {!installed && (s?.state === 'available' || installing) && s.commits.length > 0 && (
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
