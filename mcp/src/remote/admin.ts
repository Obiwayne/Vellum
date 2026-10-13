// The admin page for the remote connector: http://127.0.0.1:29181, on its own port that is never tunnelled.
// New login code, approve or remove apps, disconnect connections, set the public address, see the audit log.
// Guards: loopback Host only, any proxy/tunnel header is refused (a tunnel daemon connects from 127.0.0.1 too),
// cross-origin requests are refused, and every POST carries a per-process CSRF token.
// /api/* is the same, as JSON, for the Vellum app's Settings → Connect to Claude: it needs the x-vellum-admin header
// with the secret from <remote dir>/admin-token (only this user can read it).
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { VELLUM_PORT } from '../bridge.js'
import type { Connector, Tunnel } from './connector.js'
import { HttpError } from './connector.js'
import { esc, sameToken } from './util.js'

export const DEFAULT_ADMIN_PORT = 29181
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via', 'tailscale-funnel-request', 'cf-connecting-ip', 'cf-ray']

function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 16 * 1024) {
        fail(new HttpError(413, 'Too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => ok(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))))
    req.on('error', fail)
  })
}

const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

export interface AdminOptions {
  port?: number
  /** Saves the public address so it survives a restart. */
  savePublic: (host: string | null, tunnel: Tunnel | null) => void
  log?: (line: string) => void
  /** Secret for /api/*; without one the API is off. */
  apiToken?: string
}

/** Everything the Settings section shows. */
export interface AdminState {
  status: ReturnType<Connector['status']>
  apps: ReturnType<Connector['auth']['apps']>
  connections: ReturnType<Connector['auth']['grants']>
  codeActiveUntil: string | null
  loginLockedUntil: string | null
  adminUrl: string
  audit: Record<string, unknown>[]
}

export async function startAdmin(connector: Connector, opts: AdminOptions): Promise<{ port: number; close(): Promise<void> }> {
  const csrf = randomBytes(24).toString('base64url')
  const auth = connector.auth

  const page = (res: ServerResponse, body: string, refresh: boolean) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer'
    })
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="5">' : ''}<title>Vellum remote access</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0e0f12;color:#e6e7ea;font:14px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 16px 60px}h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a8f9c;margin:28px 0 10px}
.brand{color:#ffb04a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.muted{color:#6b7080}.ok{color:#7ddc8a}.warn{color:#ffb04a}.err{color:#ff8a8a}
section{background:#16181d;border:1px solid #262a33;border-radius:12px;padding:16px;margin-bottom:12px}
.row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #20232b}.row:first-child{border-top:0}.grow{flex:1;min-width:0}
form{display:inline}button{padding:7px 14px;border-radius:8px;border:0;font:600 13px system-ui;background:#e8571e;color:#fff;cursor:pointer}
button.ghost{background:transparent;border:1px solid #333845;color:#b4b8c2}input,select{background:#0e0f12;color:#e6e7ea;border:1px solid #333845;border-radius:8px;padding:7px 10px;font:13px system-ui}
code{font:12px ui-monospace,monospace;background:#0e0f12;padding:2px 6px;border-radius:6px;word-break:break-all}.code{font:700 40px/1 ui-monospace,monospace;letter-spacing:.2em;margin:8px 0}
table{width:100%;border-collapse:collapse;font:12px ui-monospace,monospace}td{padding:3px 6px;border-top:1px solid #20232b;vertical-align:top;word-break:break-all}
</style></head><body><main><div class="brand">Vellum</div><h1>Remote access</h1>${body}</main></body></html>`)
  }

  const btn = (action: string, label: string, fields: Record<string, string> = {}, ghost = false) =>
    `<form method="post" action="/${action}"><input type="hidden" name="csrf" value="${csrf}">${Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
      .join('')}<button${ghost ? ' class="ghost"' : ''}>${esc(label)}</button></form>`

  const home = (res: ServerResponse) => {
    const s = connector.status()
    const apps = auth.apps()
    const grants = auth.grants()
    const url = s.publicHost ? `https://${s.publicHost}/mcp` : null
    const waiting = apps.filter((a) => a.status === 'waiting')
    const body = `
${waiting.length ? `<section><b class="warn">${waiting.length} app${waiting.length > 1 ? 's are' : ' is'} waiting for your approval</b> (see Apps below).</section>` : ''}
<section>
  <div class="row"><div class="grow">Connector URL for claude.ai<br>${url ? `<code>${esc(url)}</code>` : '<span class="warn">Not set: fill in the public address below</span>'}</div></div>
  <div class="row"><div class="grow">Status</div><div>${s.connected ? '<span class="ok">Connected</span>' : '<span class="muted">No call through the tunnel in the last 15 min</span>'}</div></div>
  <div class="row"><div class="grow">Last call through the tunnel</div><div>${time(s.lastTunnelOkAt)}</div></div>
  ${s.lastTunnelError ? `<div class="row"><div class="grow">Last refused tunnel request</div><div class="err">${s.lastTunnelError.status} ${esc(s.lastTunnelError.reason)} · ${time(s.lastTunnelError.at)}</div></div>` : ''}
  <div class="row"><div class="grow">Local endpoint</div><div><code>http://127.0.0.1:${s.port}/mcp</code></div></div>
  <div class="row"><div class="grow">Vellum app bridge</div><div><code>ws://127.0.0.1:${VELLUM_PORT}</code> <span class="muted">(Vellum must be open)</span></div></div>
</section>

<h2>Sign in</h2>
<section>
  <div class="row"><div class="grow">Claude's sign-in page asks for a code. Codes work once and last 2 minutes; 5 wrong codes lock sign-ins for 10 minutes.
  ${auth.locked() ? `<br><span class="err">Sign-ins are locked until ${time(auth.lockedUntilIso())}.</span>` : ''}
  ${auth.codeActiveUntil() ? `<br><span class="muted">A code is live until ${time(auth.codeActiveUntil())}.</span>` : ''}</div>
  <div>${btn('code', 'New code')} ${auth.codeActiveUntil() ? btn('code/cancel', 'Cancel code', {}, true) : ''}</div></div>
</section>

<h2>Apps</h2>
<section>${
      apps.length
        ? apps
            .map(
              (a) => `<div class="row"><div class="grow"><b>${esc(a.name)}</b> <span class="muted">${a.kind === 'cimd' ? esc(a.clientId) : 'registered client'}</span><br>
${a.status === 'waiting' ? `<span class="warn">Waiting since ${time(a.requestedAt)}${a.ip ? ` from ${esc(a.ip)}` : ''}</span>` : `<span class="muted">Approved ${time(a.approvedAt)} · ${a.connections} connection${a.connections === 1 ? '' : 's'}${a.lastUsedAt ? ` · last used ${time(a.lastUsedAt)}` : ''}</span>`}</div>
<div>${a.status === 'waiting' ? `${btn('apps/approve', 'Approve', { id: a.id })} ${btn('apps/remove', 'Deny', { id: a.id }, true)}` : btn('apps/remove', 'Remove', { id: a.id }, true)}</div></div>`
            )
            .join('')
        : '<span class="muted">No apps yet. Add the connector in claude.ai and sign in.</span>'
    }</section>

<h2>Connections</h2>
<section>${
      grants.length
        ? grants
            .map((g) => `<div class="row"><div class="grow"><b>${esc(g.clientName)}</b><br><span class="muted">Since ${time(g.createdAt)} · last used ${time(g.lastUsedAt)}</span></div><div>${btn('disconnect', 'Disconnect', { id: g.id }, true)}</div></div>`)
            .join('') + `<div class="row"><div class="grow"></div><div>${btn('disconnect', 'Disconnect all', {}, true)}</div></div>`
        : '<span class="muted">No connections.</span>'
    }</section>

<h2>Public address</h2>
<section><form method="post" action="/public"><input type="hidden" name="csrf" value="${csrf}">
  <div class="row"><div class="grow">Host the tunnel serves (e.g. <code>obi.example.ts.net:8443</code>)</div></div>
  <div class="row"><input name="host" value="${esc(s.publicHost ?? '')}" placeholder="name.tailnet.ts.net:8443" style="flex:1">
  <select name="tunnel"><option value="tailscale"${s.tunnel === 'tailscale' ? ' selected' : ''}>Tailscale Funnel</option><option value="cloudflare"${s.tunnel === 'cloudflare' ? ' selected' : ''}>Cloudflare Tunnel</option></select>
  <button>Save</button></div></form>
  <div class="row muted">Tailscale: <code>tailscale funnel --bg --https=8443 ${s.port}</code> · off: <code>tailscale funnel --https=8443 off</code>. Never tunnel port ${DEFAULT_ADMIN_PORT} (this page).</div>
</section>

<h2>Audit log</h2>
<section><table>${connector
      .recentAudit(25)
      .map((e) => {
        const { at, ...rest } = e
        return `<tr><td style="white-space:nowrap">${esc(time(String(at)))}</td><td>${esc(JSON.stringify(rest))}</td></tr>`
      })
      .join('')}</table></section>`
    page(res, body, true)
  }

  const api = async (req: IncomingMessage, res: ServerResponse, path: string, port: number) => {
    const given = req.headers['x-vellum-admin']
    if (!opts.apiToken || typeof given !== 'string' || !sameToken(given, opts.apiToken)) throw new HttpError(403, 'Admin token required')
    const json = (data: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (req.method === 'GET' && path === '/api/state') {
      const state: AdminState = {
        status: connector.status(),
        apps: auth.apps(),
        connections: auth.grants(),
        codeActiveUntil: auth.codeActiveUntil(),
        loginLockedUntil: auth.lockedUntilIso(),
        adminUrl: `http://127.0.0.1:${port}`,
        audit: connector.recentAudit(25)
      }
      return json(state)
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found')
    const f = await readForm(req)
    switch (path) {
      case '/api/code':
        return json(auth.issueCode())
      case '/api/code/cancel':
        return json({ ok: auth.cancelCode() })
      case '/api/apps/approve':
        return json({ ok: !!auth.approveApp(f.id ?? '') })
      case '/api/apps/remove':
        return json(auth.removeApp(f.id || ' '))
      case '/api/disconnect':
        return json({ revoked: auth.revoke(f.id || undefined) })
      case '/api/public': {
        const tunnel: Tunnel = f.tunnel === 'cloudflare' ? 'cloudflare' : 'tailscale'
        connector.setPublic(f.host ?? '', tunnel)
        opts.savePublic(connector.status().publicHost, tunnel)
        return json({ ok: true })
      }
    }
    throw new HttpError(404, 'Not found')
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, port: number) => {
    const host = String(req.headers.host ?? '').toLowerCase()
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) throw new HttpError(421, 'Unknown host')
    if (PROXY_HEADERS.some((h) => h in req.headers)) throw new HttpError(403, 'The admin page is local only')
    const origin = req.headers.origin
    if (origin && origin !== `http://${host}`) throw new HttpError(403, 'Cross-origin request refused')
    const path = new URL(req.url ?? '/', 'http://admin').pathname
    if (path.startsWith('/api/')) return api(req, res, path, port)
    if (req.method === 'GET' && path === '/') return home(res)
    if (req.method !== 'POST') throw new HttpError(404, 'Not found')
    const f = await readForm(req)
    if (!sameToken(f.csrf, csrf)) throw new HttpError(403, 'Stale page: reload it and try again')
    const back = () => {
      res.writeHead(303, { location: '/' })
      res.end()
    }
    switch (path) {
      case '/code': {
        const c = auth.issueCode()
        return page(
          res,
          `<section><p>Type this code on Claude's sign-in page:</p><div class="code">${esc(c.display)}</div><p class="muted">Works once, until ${time(c.expiresAt)}. It is shown only now.</p><p><a href="/" style="color:#ffb04a">Back</a></p></section>`,
          false
        )
      }
      case '/code/cancel':
        auth.cancelCode()
        return back()
      case '/apps/approve':
        auth.approveApp(f.id ?? '')
        return back()
      case '/apps/remove':
        auth.removeApp(f.id || '\0')
        return back()
      case '/disconnect':
        auth.revoke(f.id || undefined)
        return back()
      case '/public': {
        const tunnel: Tunnel = f.tunnel === 'cloudflare' ? 'cloudflare' : 'tailscale'
        connector.setPublic(f.host ?? '', tunnel)
        opts.savePublic(connector.status().publicHost, tunnel)
        return back()
      }
    }
    throw new HttpError(404, 'Not found')
  }

  const server: Server = createServer()
  const port = await new Promise<number>((ok, fail) => {
    server.once('error', fail)
    server.listen(opts.port ?? DEFAULT_ADMIN_PORT, '127.0.0.1', () => {
      server.off('error', fail)
      const a = server.address()
      ok(typeof a === 'object' && a ? a.port : (opts.port ?? DEFAULT_ADMIN_PORT))
    })
  })
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res, port).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500
      if (status === 500) opts.log?.(`admin error: ${e instanceof Error ? e.stack : e}`)
      if (res.headersSent) return void res.end()
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(e instanceof Error ? e.message : String(e))
    })
  })
  opts.log?.(`admin page on http://127.0.0.1:${port}`)
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r())
        server.closeAllConnections?.()
      })
  }
}
