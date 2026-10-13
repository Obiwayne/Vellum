// Settings → Connect to Claude: agents on this PC (the Connect your agent commands) and the remote connector that lets
// claude.ai use Vellum through a tunnel (src/main/remote.ts, docs/REMOTE.md).
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, Checkbox, Select } from '../ui'
import type { RemoteAction, RemoteState, RemoteTunnel } from '@shared/remote'
import { ConnectAgentModal, CopyLine } from './ConnectAgentModal'

const TUNNELS = [
  { value: 'tailscale' as const, label: 'Tailscale Funnel' },
  { value: 'cloudflare' as const, label: 'Cloudflare Tunnel' }
]

const time = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')
const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ConnectClaudeSection(): JSX.Element {
  const api = window.canvasApi?.remote
  const [agentOpen, setAgentOpen] = useState(false)
  const [st, setSt] = useState<RemoteState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [code, setCode] = useState<{ display: string; expiresAt: string } | null>(null)
  const [host, setHost] = useState('')
  const [tunnel, setTunnel] = useState<RemoteTunnel>('tailscale')
  const [hostDirty, setHostDirty] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    if (!api) return
    const s = await api.state()
    setSt(s)
    if (!hostDirty) {
      setHost(s.publicHost ?? '')
      setTunnel(s.tunnel ?? 'tailscale')
    }
  }, [api, hostDirty])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!code) return
    const t = window.setTimeout(() => setCode(null), Math.max(0, Date.parse(code.expiresAt) - Date.now()))
    return () => window.clearTimeout(t)
  }, [code])

  // used, cancelled or replaced elsewhere: the connector no longer has a live code
  useEffect(() => {
    if (code && st?.running && !st.codeActiveUntil) setCode(null)
  }, [code, st])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const act = (a: RemoteAction): Promise<void> => run(() => api!.act(a))

  const url = st?.publicHost ? `https://${st.publicHost}/mcp` : null
  const waiting = st?.apps.filter((a) => a.status === 'waiting') ?? []
  const approved = st?.apps.filter((a) => a.status === 'approved') ?? []
  const on = Boolean(st?.enabled || st?.external)

  return (
    <>
      <div className="db-settings__heading">Connect to Claude</div>
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Agents on this PC</div>
          <div className="db-settings__hint">Claude Code, Codex, Cursor and other MCP clients running here.</div>
        </div>
        <Button onClick={() => setAgentOpen(true)}>Connect your agent…</Button>
        <ConnectAgentModal open={agentOpen} onClose={() => setAgentOpen(false)} />
      </div>

      {api && (
        <div className="db-settings__row">
          <div>
            <div className="db-settings__label">Use Vellum from claude.ai</div>
            <div className="db-settings__hint">
              Lets Claude on the web, the desktop app or your phone design in this Vellum while it's open, through a tunnel.
              {st?.external && ' Started outside the app (VellumRemote.cmd), so close that window to stop it.'}
            </div>
          </div>
          <Checkbox checked={on} onChange={(v) => void run(() => api.setEnabled(v))} />
        </div>
      )}

      {api && st && on && (
        <div className="db-remote">
          <div className="db-remote__status">
            <span className={`db-remote__dot${st.running ? (st.connected ? ' is-ok' : ' is-idle') : ' is-off'}`} />
            {!st.running
              ? st.error ?? 'Starting…'
              : st.connected
                ? `Connected · last call ${time(st.lastTunnelOkAt)}`
                : 'Running · no call through the tunnel in the last 15 minutes'}
          </div>
          {err && <div className="db-remote__err">{err}</div>}

          {st.running && (
            <>
              <div className="db-remote__block">
                <div className="db-settings__label">Connector URL</div>
                <div className="db-settings__hint">In claude.ai: Settings → Connectors → Add custom connector, and paste this.</div>
                {url ? <CopyLine text={url} /> : <div className="db-remote__warn">Set the public address below first.</div>}
              </div>

              <div className="db-remote__block">
                <div className="db-remote__line">
                  <div>
                    <div className="db-settings__label">Sign-in code</div>
                    <div className="db-settings__hint">
                      Claude's sign-in page asks for it. It works once and lasts 2 minutes.
                      {st.loginLockedUntil && <span className="db-remote__errtext"> Sign-ins are locked until {clock(st.loginLockedUntil)} after 5 wrong codes.</span>}
                    </div>
                  </div>
                  <Button disabled={busy} onClick={() => void run(async () => setCode(await api.act({ kind: 'code' })))}>
                    New code
                  </Button>
                </div>
                {code && (
                  <div className="db-remote__code">
                    <span className="db-remote__codetext">{code.display}</span>
                    <Button
                      size="sm"
                      icon={copied ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => {
                        void navigator.clipboard.writeText(code.display)
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1200)
                      }}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <span className="db-settings__hint">until {clock(code.expiresAt)}</span>
                    <Button variant="ghost" size="sm" onClick={() => void act({ kind: 'cancelCode' }).then(() => setCode(null))}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {waiting.map((a) => (
                <div key={a.id} className="db-remote__block db-remote__block--waiting">
                  <div className="db-remote__line">
                    <div>
                      <div className="db-settings__label">{a.name} wants to connect</div>
                      <div className="db-settings__hint">
                        It signed in with a correct code at {clock(a.requestedAt)}
                        {a.ip ? ` from ${a.ip}` : ''}. Approve it to finish the sign-in.
                      </div>
                    </div>
                    <div className="db-remote__btns">
                      <Button variant="primary" disabled={busy} onClick={() => void act({ kind: 'approve', id: a.id })}>
                        Approve
                      </Button>
                      <Button disabled={busy} onClick={() => void act({ kind: 'remove', id: a.id })}>
                        Deny
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="db-remote__block">
                <div className="db-settings__label">Approved apps</div>
                {approved.length === 0 && <div className="db-settings__hint">None yet. Add the connector in claude.ai and sign in.</div>}
                {approved.map((a) => (
                  <div key={a.id} className="db-remote__line db-remote__item">
                    <div>
                      <div>{a.name}</div>
                      <div className="db-settings__hint">
                        {a.connections} connection{a.connections === 1 ? '' : 's'}
                        {a.lastUsedAt ? ` · last used ${time(a.lastUsedAt)}` : ''}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ kind: 'remove', id: a.id })}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              {st.connections.length > 0 && (
                <div className="db-remote__block">
                  <div className="db-settings__label">Connections</div>
                  {st.connections.map((c) => (
                    <div key={c.id} className="db-remote__line db-remote__item">
                      <div>
                        <div>{c.clientName}</div>
                        <div className="db-settings__hint">
                          Since {time(c.createdAt)} · last used {time(c.lastUsedAt)}
                        </div>
                      </div>
                      <Button size="sm" disabled={busy} onClick={() => void act({ kind: 'disconnect', id: c.id })}>
                        Disconnect
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="db-remote__block">
            <div className="db-settings__label">Public address</div>
            <div className="db-settings__hint">The host your tunnel serves, for example name.tailnet.ts.net:8443. Tunnel only port {st.port ?? 29180}.</div>
            <div className="db-remote__line">
              <input
                className="db-input db-remote__host"
                value={host}
                spellCheck={false}
                placeholder="name.tailnet.ts.net:8443"
                onChange={(e) => {
                  setHost(e.target.value)
                  setHostDirty(true)
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <Select value={tunnel} options={TUNNELS} style={{ width: 160 }} onChange={(v) => (setTunnel(v), setHostDirty(true))} />
              <Button disabled={busy || !hostDirty} onClick={() => void act({ kind: 'public', host, tunnel }).then(() => setHostDirty(false))}>
                Save
              </Button>
            </div>
            {tunnel === 'tailscale' && <CopyLine text={`tailscale funnel --bg --https=8443 ${st.port ?? 29180}`} />}
          </div>
        </div>
      )}
    </>
  )
}
