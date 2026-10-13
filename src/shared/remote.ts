// Settings → Connect to Claude: the remote connector (mcp/src/remote, docs/REMOTE.md) as the app sees it.
// The main process starts it as a child process and talks to its admin API; see src/main/remote.ts.

export type RemoteTunnel = 'tailscale' | 'cloudflare'

export interface RemoteApp {
  id: string
  clientId: string
  name: string
  kind: 'dcr' | 'cimd'
  status: 'waiting' | 'approved'
  requestedAt: string
  approvedAt?: string
  ip?: string
  connections: number
  lastUsedAt?: string
}

export interface RemoteConnection {
  id: string
  clientName: string
  createdAt: string
  lastUsedAt: string
}

export interface RemoteState {
  /** The Settings switch (saved in <userData>/remote/config.json). */
  enabled: boolean
  /** The connector answers on its admin port (started by this app, or by VellumRemote.cmd). */
  running: boolean
  /** Started outside the app (VellumRemote.cmd): the switch can't stop it. */
  external: boolean
  /** Why it isn't running (start failed, crashed, the build is missing). */
  error: string | null
  port: number | null
  publicHost: string | null
  tunnel: RemoteTunnel | null
  /** A call came through the tunnel in the last 15 minutes. */
  connected: boolean
  lastTunnelOkAt: string | null
  lastTunnelError: { at: string; status: number; reason: string } | null
  apps: RemoteApp[]
  connections: RemoteConnection[]
  codeActiveUntil: string | null
  loginLockedUntil: string | null
  adminUrl: string | null
  audit: Record<string, unknown>[]
}

export type RemoteAction =
  | { kind: 'code' }
  | { kind: 'cancelCode' }
  | { kind: 'approve'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'disconnect'; id?: string }
  | { kind: 'public'; host: string; tunnel: RemoteTunnel }

export interface RemoteApi {
  state(): Promise<RemoteState>
  setEnabled(on: boolean): Promise<RemoteState>
  /** `code` returns the new login code ({ display, expiresAt }); the rest return null. */
  act(action: RemoteAction): Promise<{ display: string; expiresAt: string } | null>
}
