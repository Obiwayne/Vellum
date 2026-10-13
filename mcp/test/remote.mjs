// Remote connector end to end: OAuth sign-in (DCR + PKCE, login code, app approval), /mcp with the token, the admin
// page's guards. Tool calls go to the running Vellum app when it is open (skipped otherwise).
// Usage: npm run build && node test/remote.mjs
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startConnector } from '../dist/remote/connector.js'
import { startAdmin } from '../dist/remote/admin.js'
import { bridge } from '../dist/server.js'

/** fetch() drops a custom Host header, so the rebinding checks use http.request. */
const withHost = (url, host) => withHostRes(url, host, 'POST').then((r) => r.status)
const withHostRes = (url, host, method = 'GET') =>
  new Promise((ok, fail) => {
    const req = request(url, { method, headers: { host } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', fail)
    req.end()
  })

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

const dir = mkdtempSync(join(tmpdir(), 'vellum-remote-'))
const connector = await startConnector({ dir, port: 0, pcName: 'test-pc' })
const admin = await startAdmin(connector, { port: 0, savePublic: () => {} })
const base = `http://127.0.0.1:${connector.port}`
const adminBase = `http://127.0.0.1:${admin.port}`
const redirect = 'http://127.0.0.1:5999/callback'

try {
  // discovery
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()
  check(prm.resource === `${base}/mcp` && prm.resource_name === 'Vellum', 'protected-resource metadata')
  const unauth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check(unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get('www-authenticate') ?? ''), '/mcp without a token is 401 with resource_metadata')
  check((await withHost(`${base}/mcp`, 'evil.example')) === 421, 'foreign Host refused (421)')

  // DCR
  const reg = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test client', redirect_uris: [redirect] }) })).json()
  check(typeof reg.client_id === 'string', 'client registered')
  const badReg = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) })
  check(badReg.status === 400, 'foreign redirect_uri refused')

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = { client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${base}/mcp` }
  const consent = await fetch(`${base}/authorize?${new URLSearchParams(params)}`)
  check(consent.status === 200 && (await consent.text()).includes('Connect to Vellum'), 'consent page')

  const submit = (code) => fetch(`${base}/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, code, decision: 'allow' }) })
  check((await submit('AAAAAA')).status === 401, 'wrong code refused')

  // the admin page issues the code (as the user would)
  const home = await (await fetch(adminBase)).text()
  const csrf = /name="csrf" value="([^"]+)"/.exec(home)[1]
  const post = (path, fields = {}, headers = {}) => fetch(`${adminBase}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ csrf, ...fields }) })
  check((await post('/code', { csrf: 'nope' })).status === 403, 'admin POST without the CSRF token refused')
  check((await fetch(adminBase, { headers: { 'tailscale-funnel-request': '?1' } })).status === 403, 'admin page refuses tunnelled requests')
  check((await withHost(adminBase, 'obi.example.ts.net')) === 421, 'admin page refuses a foreign Host')
  check((await post('/code', {}, { origin: 'https://evil.example' })).status === 403, 'admin page refuses cross-origin POSTs')
  const codePage = await (await post('/code')).text()
  const code = /class="code">([^<]+)</.exec(codePage)[1]
  check(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code), `login code issued (${code})`)

  // right code, but the app isn't approved yet: it waits
  const wait = await submit(code)
  const waitHtml = await wait.text()
  check(wait.status === 202 && waitHtml.includes('Waiting for approval'), 'unapproved app waits')
  const r = /authorize\/wait\?r=([^"]+)"/.exec(waitHtml)[1]
  const appId = connector.auth.apps().find((a) => a.status === 'waiting')?.id
  check((await post('/apps/approve', { id: appId })).status === 303, 'app approved on the admin page')
  const done = await fetch(`${base}/authorize/wait?r=${r}`, { redirect: 'manual' })
  const loc = new URL(done.headers.get('location'))
  check(done.status === 302 && loc.searchParams.get('state') === 'xyz' && loc.searchParams.get('code'), 'redirected back with an authorization code')

  const tok = await (
    await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier, resource: `${base}/mcp` }) })
  ).json()
  check(tok.access_token?.startsWith('vra_') && tok.refresh_token?.startsWith('vrr_'), 'tokens issued')

  // MCP over HTTP with the token
  const client = new Client({ name: 'remote-test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tok.access_token}` } } }))
  const tools = (await client.listTools()).tools.map((t) => t.name)
  check(tools.length > 40 && tools.includes('write_html') && tools.includes('get_screenshot'), `${tools.length} tools listed`)
  check(!tools.includes('export'), 'export is not offered remotely')
  const info = await client.callTool({ name: 'list_files', arguments: { limit: 3 } })
  if (info.isError && /not running/i.test(info.content[0]?.text ?? '')) console.log('skip tool call: Vellum app is not running')
  else check(!info.isError && info.content[0].text.includes('files'), 'list_files reaches the running Vellum app')
  await client.close()

  // revoke
  check((await post('/disconnect')).status === 303, 'disconnect all')
  const after = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  check(after.status === 401, 'revoked token refused')
  check(connector.recentAudit(50).some((e) => e.tool === 'list_files'), 'tool calls are in the audit log')

  // public address under a path (Funnel --set-path=/vellum strips the prefix): every URL handed out carries it
  connector.setPublic('https://Obi.Example.ts.net/vellum/mcp', 'tailscale')
  const pub = 'https://obi.example.ts.net/vellum'
  const u401 = await withHostRes(`${base}/mcp`, 'obi.example.ts.net', 'POST')
  check(u401.status === 401 && u401.headers['www-authenticate']?.includes(`${pub}/.well-known/oauth-protected-resource/mcp`), 'path prefix: 401 points at the prefixed metadata')
  const pprm = JSON.parse((await withHostRes(`${base}/.well-known/oauth-protected-resource/mcp`, 'obi.example.ts.net')).body)
  const pas = JSON.parse((await withHostRes(`${base}/.well-known/oauth-authorization-server`, 'obi.example.ts.net')).body)
  check(pprm.resource === `${pub}/mcp` && pprm.authorization_servers[0] === pub && pas.issuer === pub && pas.authorization_endpoint === `${pub}/authorize`, 'path prefix: metadata URLs carry it')
  const pconsent = await withHostRes(`${base}/authorize?${new URLSearchParams({ ...params, resource: `${pub}/mcp` })}`, 'obi.example.ts.net')
  check(pconsent.body.includes(`action="${pub}/authorize"`), 'path prefix: consent form posts to the prefixed URL')
} finally {
  bridge.close()
  await connector.close()
  await admin.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
