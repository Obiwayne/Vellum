# Remote connector: use Vellum from claude.ai

The stdio MCP server (docs/MCP.md) works for agents on this PC. The remote connector puts the same tools on the web so
claude.ai (web, desktop app, phone) can design in the Vellum that is open on this PC.

```
claude.ai ──https──▶ tunnel (Tailscale Funnel / Cloudflare) ──▶ 127.0.0.1:29180 /mcp ──ws──▶ Vellum app (29170)
                                                                 admin page 127.0.0.1:29181 (never tunnelled)
```

## Run it

1. Open Vellum: Dashboard → **Settings** → **Connect to Claude** → turn on **Use Vellum from claude.ai**. The app starts
   the connector as a child process (its own Electron as Node) and keeps it running while the switch is on; it stops when
   Vellum quits. The switch is saved in `config.json` (`enabled`).
   Without the app UI: run `VellumRemote.cmd` (or `cd mcp && npm run build && npm run remote`) and keep its window open;
   Settings then shows it as started outside the app.
2. Fill in **Public address** in Settings (or on the admin page, http://127.0.0.1:29181). For Tailscale that's
   `name.tailnet.ts.net:8443`.
3. Start the tunnel, forwarding **only** port 29180:
   - Tailscale Funnel: `tailscale funnel --bg --https=8443 29180` (off: `tailscale funnel --https=8443 off`).
     Port 443 can be used by something else; Funnel also offers 8443 and 10000.
   - Cloudflare Tunnel: point a hostname at `http://127.0.0.1:29180`.
4. In claude.ai: Settings → Connectors → Add custom connector, URL `https://<public address>/mcp`.
5. Claude opens a sign-in page. In Settings (or on the admin page) press **New code** and type the code there.
6. The first time, the app waits for approval: press **Approve** in Settings. The sign-in page carries on by itself.

Settings → Connect to Claude also lists approved apps (Remove) and connections (Disconnect), and has the
**Connect your agent…** commands for agents on this PC.

The app talks to the connector through `/api/*` on the admin port with the `x-vellum-admin` header, whose secret is in
`admin-token` in the data folder (src/main/remote.ts).

## Files

`%APPDATA%\Vellum\remote\` (`VELLUM_REMOTE_DIR` overrides): `admin-token` (the app's secret for the admin API), `remote.json` (clients, approved apps, token hashes; no raw
tokens), `config.json` (the Settings switch, public address, tunnel type), `remote.log` (audit log, one JSON line per event).

| Env var | Default | Purpose |
|---|---|---|
| `VELLUM_REMOTE_PORT` | `29180` | Connector listener (the only port to tunnel) |
| `VELLUM_REMOTE_ADMIN_PORT` | `29181` | Admin page |
| `VELLUM_REMOTE_HOST` | from config.json | Public host, overrides the admin page setting |
| `VELLUM_REMOTE_TUNNEL` | from config.json | `tailscale` or `cloudflare`: which forwarded header carries the real client IP |
| `VELLUM_REMOTE_DIR` | `%APPDATA%\Vellum\remote` | Data folder |

`VELLUM_PORT` and `VELLUM_USER_DATA` work as for the stdio server (docs/MCP.md).

## Security

- **OAuth** (`mcp/src/remote/oauth.ts`): discovery at `/.well-known/oauth-protected-resource[/mcp]` and
  `/.well-known/oauth-authorization-server`; clients by CIMD or DCR (`/register`), redirect URIs limited to claude.ai's
  callback or loopback; PKCE S256 required; access tokens 1 h, refresh tokens 30 days and rotated (a reused refresh
  token revokes the connection). Only sha256 hashes are stored.
- **Login code**: 6 characters from the admin page, single use, 2 minutes, a new code kills the old one. 5 wrong codes
  in a minute lock sign-ins for 10 minutes.
- **App allow-list**: a correct code is not enough; a new app waits until you Approve it. Removing an app revokes its
  connections. Disconnect one connection or all from the admin page.
- **Host guard**: `/mcp` answers only to the public host or the loopback address (DNS rebinding).
- **Admin page**: own port, loopback Host only, refuses any proxy or tunnel header (a tunnel daemon connects from
  127.0.0.1 too), refuses cross-origin requests, and every POST carries a per-process CSRF token.
- **Tools**: every stdio tool except `export`, which writes files onto this PC. Design edits are not held for approval:
  they are undoable in Vellum, and holding each edit would make remote design unusable.
- **Rate limit**: 600 POSTs a minute. Request bodies up to 16 MB.

## Test

`cd mcp && npm run build && npm run test:remote`: the full sign-in (DCR, wrong code, waiting app, approve, token),
tools over HTTP (no `export`), a real call into the running app, revoke, and the admin page guards.
