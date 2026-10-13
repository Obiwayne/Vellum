// The public side of the remote connector: Streamable HTTP MCP at /mcp plus the OAuth routes, on a plain-HTTP
// listener bound to 127.0.0.1 (default :29180). A tunnel (Tailscale Funnel or Cloudflare Tunnel) terminates TLS and
// forwards only this port; the admin page (admin.ts) lives on its own port and is never tunnelled.
import { appendFileSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createVellumServer } from '../server.js'
import { OAuthError, RemoteAuth } from './oauth.js'

export const DEFAULT_REMOTE_PORT = 29180
/** Tools a remote client never gets: `export` writes files onto this PC's disk. */
export const REMOTE_SKIP: ReadonlySet<string> = new Set(['export'])
/** "Connected" on the admin page = a successful call through the tunnel in this window. */
export const CONNECTED_WINDOW_MS = 15 * 60_000
const RATE_PER_MIN = 600 // design work is chatty: a screen is dozens of calls
const MAX_BODY = 16 * 1024 * 1024 // write_html can carry big pages

export type Tunnel = 'cloudflare' | 'tailscale'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * The real client address of a request, for the audit log. Forwarded headers are trusted only when the request came
 * through the tunnel (its Host is the public hostname) and only the header that tunnel guarantees: Cloudflare's
 * CF-Connecting-IP, or Funnel's X-Forwarded-For together with its Tailscale-Funnel-Request marker.
 */
export function realClientIp(req: IncomingMessage, tunnel: Tunnel | null, viaTunnel: boolean): { ip: string; ipFrom: string } {
  const socket = req.socket.remoteAddress ?? '?'
  if (!viaTunnel) return { ip: socket, ipFrom: 'socket' }
  const one = (name: string) => {
    const v = req.headers[name]
    return typeof v === 'string' ? v.trim() : undefined
  }
  if (tunnel === 'cloudflare') {
    const v = one('cf-connecting-ip')
    if (v && isIP(v)) return { ip: v, ipFrom: 'cf-connecting-ip' }
  } else if (tunnel === 'tailscale' && one('tailscale-funnel-request') === '?1') {
    const v = one('x-forwarded-for')
    if (v && isIP(v)) return { ip: v, ipFrom: 'x-forwarded-for (funnel)' }
  }
  return { ip: socket, ipFrom: tunnel ? `socket (no ${tunnel} header)` : 'socket (tunnel type not set)' }
}

/**
 * "https://Obi.Example.ts.net:8443/mcp/" → "obi.example.ts.net:8443"; "" → null. Throws on anything else. A path is kept
 * ("name.ts.net/vellum") for a tunnel that mounts the connector under a path on a port another app serves (Funnel --set-path).
 */
export function normalizeHost(v: string | null | undefined): string | null {
  const host = (v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/mcp\/?$/, '')
    .replace(/\/+$/, '')
  if (!host) return null
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?(\/[a-z0-9._-]+)*$/.test(host)) throw new HttpError(400, `"${v}" is not a hostname`)
  return host.replace(/:443(?=\/|$)/, '')
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'Request body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
      } catch {
        fail(new HttpError(400, 'Body is not valid JSON'))
      }
    })
    req.on('error', fail)
  })
}

export interface ConnectorOptions {
  dir: string
  port?: number
  publicHost?: string | null
  tunnel?: Tunnel | null
  pcName?: string
  now?: () => Date
  log?: (line: string) => void
  onAppWaiting?: (info: { app: string; ip: string; ipFrom: string }) => void
  /** CIMD metadata fetch (test seam). */
  fetchMetadata?: (url: string) => Promise<unknown>
}

export interface ConnectorStatus {
  port: number
  publicHost: string | null
  tunnel: Tunnel | null
  connected: boolean
  lastTunnelOkAt: string | null
  lastTunnelError: { at: string; status: number; reason: string } | null
  lastLocalOkAt: string | null
}

export interface Connector {
  port: number
  auth: RemoteAuth
  status(): ConnectorStatus
  setPublic(host: string | null, tunnel: Tunnel | null): void
  /** Last `n` lines of the audit log, newest first. */
  recentAudit(n: number): Record<string, unknown>[]
  close(): Promise<void>
}

export async function startConnector(opts: ConnectorOptions): Promise<Connector> {
  const now = opts.now ?? (() => new Date())
  const log = opts.log ?? (() => {})
  const auditFile = join(opts.dir, 'remote.log')
  let publicHost = normalizeHost(opts.publicHost)
  let tunnelKind = opts.tunnel ?? null
  const hits: number[] = []
  const st = { lastTunnelOkAt: null as string | null, lastTunnelError: null as ConnectorStatus['lastTunnelError'], lastLocalOkAt: null as string | null }

  const audit = (entry: Record<string, unknown>) => {
    try {
      appendFileSync(auditFile, JSON.stringify({ at: now().toISOString(), ...entry }) + '\n')
    } catch (e) {
      log(`audit log: ${e instanceof Error ? e.message : e}`)
    }
  }
  const hostOf = (req: IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:443$/, '')
  // publicHost may carry a path prefix the tunnel strips: match the Host header against the host part only
  const viaTunnel = (req: IncomingMessage) => publicHost !== null && hostOf(req) === publicHost.split('/')[0]
  const ipOf = (req: IncomingMessage) => realClientIp(req, tunnelKind, viaTunnel(req))
  const auth = new RemoteAuth({ dir: opts.dir, pcName: opts.pcName ?? 'this PC', now, audit, ipOf, onAppWaiting: opts.onAppWaiting, fetchMetadata: opts.fetchMetadata })

  const handle = async (req: IncomingMessage, res: ServerResponse, port: number): Promise<void> => {
    const path = new URL(req.url ?? '/', 'http://remote').pathname.replace(/\/+$/, '')
    const host = hostOf(req)
    // DNS-rebinding guard: only the tunnel's hostname or this PC's own address.
    const local = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
    if (!viaTunnel(req) && !local.includes(host)) throw new HttpError(421, `Unknown host "${host}"`)
    const base = viaTunnel(req) ? `https://${publicHost}` : `http://${host}`
    if (req.method === 'POST') {
      const t = now().getTime()
      while (hits.length && t - hits[0] > 60_000) hits.shift()
      if (hits.length >= RATE_PER_MIN) throw new HttpError(429, 'Too many calls; wait a minute')
      hits.push(t)
    }
    if (await auth.handle(req, res, path, base)) return
    if (path !== '/mcp') throw new HttpError(404, 'Not found')
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1]
    const grant = token ? auth.verify(token, `${base}/mcp`) : null
    if (!grant) {
      res.setHeader('www-authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`)
      throw new HttpError(401, token ? 'Unknown, expired or revoked token' : 'Sign in first (OAuth)')
    }
    if (req.method !== 'POST') throw new HttpError(405, 'This server is stateless: POST only')

    const body = await readJson(req)
    const tunnel = viaTunnel(req)
    for (const msg of Array.isArray(body) ? body : [body]) {
      const m = msg as { method?: string; params?: { name?: string } } | null
      if (m?.method === 'tools/call') audit({ tool: m.params?.name, client: grant.clientName, via: tunnel ? 'tunnel' : 'local' })
    }
    const server = createVellumServer({ skip: REMOTE_SKIP })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    if (res.statusCode < 400) {
      if (tunnel) st.lastTunnelOkAt = now().toISOString()
      else st.lastLocalOkAt = now().toISOString()
    }
  }

  const server: Server = createServer()
  const port = await new Promise<number>((ok, fail) => {
    server.once('error', fail)
    server.listen(opts.port ?? DEFAULT_REMOTE_PORT, '127.0.0.1', () => {
      server.off('error', fail)
      const a = server.address()
      ok(typeof a === 'object' && a ? a.port : (opts.port ?? DEFAULT_REMOTE_PORT))
    })
  })
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    // every tunnel request except successful MCP calls (those are logged per tool), so a client that can't connect shows up
    if (viaTunnel(req))
      res.on('finish', () => {
        const path = (req.url ?? '').split('?')[0]
        if (!(path === '/mcp' && res.statusCode < 400)) audit({ request: `${req.method} ${path}`, status: res.statusCode, ua: String(req.headers['user-agent'] ?? '').slice(0, 80), ...ipOf(req) })
      })
    handle(req, res, port).catch((e) => {
      const status = e instanceof HttpError || e instanceof OAuthError ? e.status : 500
      if (status === 500) log(`error on ${req.method} ${req.url}: ${e instanceof Error ? e.stack : e}`)
      const reason = e instanceof Error ? e.message : String(e)
      if (viaTunnel(req)) st.lastTunnelError = { at: now().toISOString(), status, reason }
      if (status === 401 || status === 421 || status === 429) audit({ refused: status, reason, via: viaTunnel(req) ? 'tunnel' : 'local', ...ipOf(req) })
      if (res.headersSent) return void res.end()
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(e instanceof OAuthError ? { error: e.code, error_description: reason } : { error: reason }))
    })
  })
  log(`connector listening on http://127.0.0.1:${port}/mcp${publicHost ? ` (public: https://${publicHost}/mcp)` : ''}`)

  return {
    port,
    auth,
    status: () => ({
      port,
      publicHost,
      tunnel: tunnelKind,
      connected: st.lastTunnelOkAt !== null && now().getTime() - Date.parse(st.lastTunnelOkAt) < CONNECTED_WINDOW_MS,
      lastTunnelOkAt: st.lastTunnelOkAt,
      lastTunnelError: st.lastTunnelError,
      lastLocalOkAt: st.lastLocalOkAt
    }),
    setPublic(host, tunnel) {
      publicHost = normalizeHost(host)
      tunnelKind = tunnel
      audit({ event: 'public_host_set', publicHost, tunnel })
    },
    recentAudit(n) {
      try {
        return readFileSync(auditFile, 'utf8')
          .trim()
          .split('\n')
          .slice(-n)
          .reverse()
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      } catch {
        return []
      }
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r())
        server.closeAllConnections?.()
      })
  }
}
