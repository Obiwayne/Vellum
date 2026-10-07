// InvokeAI plugin, main side: talks to a local InvokeAI server over its REST API. The renderer's CSP
// blocks arbitrary origins, so every request goes through here.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/api'
import {
  INVOKE_BASES,
  buildTextToImageGraph,
  findOutputImage,
  normalizeInvokeUrl,
  type InvokeGenerateArgs,
  type InvokeImage,
  type InvokeModel,
  type InvokeProgress,
  type InvokeResult
} from '@shared/invokeai'

const QUEUE = 'default'
const POLL_MS = 700
const RUN_TIMEOUT_MS = 15 * 60_000

class InvokeError extends Error {}

function baseUrl(raw: unknown): string {
  const url = normalizeInvokeUrl(raw)
  if (!url) throw new InvokeError('Enter a server address like http://127.0.0.1:9090')
  return url
}

async function call<T>(url: string, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError') throw new InvokeError(`InvokeAI at ${url} didn't answer in time`)
    throw new InvokeError(`Can't reach InvokeAI at ${url}. Is it running?`)
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown }
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body).slice(0, 300)
    } catch {
      /* not JSON */
    }
    throw new InvokeError(`InvokeAI answered ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as T
}

async function wrap<T>(fn: () => Promise<T>): Promise<InvokeResult<T>> {
  try {
    return { ok: true, ...(await fn()) }
  } catch (err) {
    return { ok: false, error: err instanceof InvokeError ? err.message : `InvokeAI plugin error: ${(err as Error)?.message ?? err}` }
  }
}

async function status(raw: unknown): Promise<{ version: string }> {
  const r = await call<{ version?: string }>(baseUrl(raw), '/api/v1/app/version', {}, 5_000)
  return { version: String(r.version ?? '?') }
}

async function models(raw: unknown): Promise<{ models: InvokeModel[] }> {
  const r = await call<{ models?: InvokeModel[] }>(baseUrl(raw), '/api/v2/models/?model_type=main')
  const list = (r.models ?? []).filter(
    (m) => m && typeof m.key === 'string' && (INVOKE_BASES as readonly string[]).includes(m.base)
  )
  return { models: list.map(({ key, hash, name, base, type }) => ({ key, hash, name, base, type })) }
}

function checkArgs(a: unknown): InvokeGenerateArgs {
  const g = a as InvokeGenerateArgs
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  if (!g || typeof g !== 'object') throw new InvokeError('Bad request')
  if (typeof g.prompt !== 'string' || !g.prompt.trim()) throw new InvokeError('Write a prompt first')
  if (!g.model || typeof g.model.key !== 'string') throw new InvokeError('Pick a model')
  if (!(INVOKE_BASES as readonly string[]).includes(g.model.base)) throw new InvokeError(`Models of type ${g.model.base} aren't supported yet`)
  if (![g.width, g.height, g.steps, g.cfgScale, g.seed].every(num)) throw new InvokeError('Bad generation settings')
  if (typeof g.scheduler !== 'string' || !/^[a-z0-9_]+$/.test(g.scheduler)) throw new InvokeError('Bad scheduler')
  return g
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function generate(a: unknown, progress: (p: InvokeProgress) => void): Promise<{ image: InvokeImage }> {
  const args = checkArgs(a)
  const url = baseUrl(args.url)
  const graph = buildTextToImageGraph(args)
  const enq = await call<{ item_ids?: number[] }>(url, `/api/v1/queue/${QUEUE}/enqueue_batch`, {
    method: 'POST',
    body: JSON.stringify({ batch: { graph, runs: 1, origin: 'vellum' }, prepend: false })
  })
  const itemId = enq.item_ids?.[0]
  if (typeof itemId !== 'number') throw new InvokeError('InvokeAI did not return a queue item (this InvokeAI version may be too old)')
  progress({ itemId, status: 'pending' })

  const started = Date.now()
  let last = ''
  for (;;) {
    const item = await call<{ status: InvokeProgress['status']; error_message?: string; error_type?: string }>(
      url,
      `/api/v1/queue/${QUEUE}/i/${itemId}`
    )
    if (item.status !== last) {
      last = item.status
      progress({ itemId, status: item.status })
    }
    if (item.status === 'completed') {
      const imageName = findOutputImage(item)
      if (!imageName) throw new InvokeError('The run finished without an image')
      const res = await fetch(`${url}/api/v1/images/i/${encodeURIComponent(imageName)}/full`, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new InvokeError(`Couldn't download the image (${res.status})`)
      const type = res.headers.get('content-type')?.split(';')[0] || 'image/png'
      const buf = Buffer.from(await res.arrayBuffer())
      const node = graph.nodes['noise'] as { width: number; height: number; seed: number }
      return {
        image: { dataUrl: `data:${type};base64,${buf.toString('base64')}`, imageName, width: node.width, height: node.height, seed: node.seed }
      }
    }
    if (item.status === 'failed') throw new InvokeError(`Generation failed: ${item.error_message || item.error_type || 'unknown error'}`)
    if (item.status === 'canceled') throw new InvokeError('Canceled')
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new InvokeError('Timed out waiting for InvokeAI')
    await sleep(POLL_MS)
  }
}

async function cancel(raw: unknown, itemId: unknown): Promise<void> {
  if (typeof itemId !== 'number' || !Number.isInteger(itemId)) return
  try {
    await call(baseUrl(raw), `/api/v1/queue/${QUEUE}/i/${itemId}/cancel`, { method: 'PUT' })
  } catch {
    /* already finished or gone */
  }
}

export function registerInvokeAIIpc(
  getWindow: () => BrowserWindow | null,
  trusted: (e: IpcMainInvokeEvent) => boolean
): void {
  const guard = (e: IpcMainInvokeEvent): void => {
    if (!trusted(e)) throw new Error('Not allowed')
  }
  ipcMain.handle(IPC.invokeStatus, (e, url: unknown) => (guard(e), wrap(() => status(url))))
  ipcMain.handle(IPC.invokeModels, (e, url: unknown) => (guard(e), wrap(() => models(url))))
  ipcMain.handle(IPC.invokeGenerate, (e, args: unknown) => {
    guard(e)
    return wrap(() =>
      generate(args, (p) => {
        const w = getWindow()
        if (w && !w.isDestroyed()) w.webContents.send(IPC.invokeProgress, p)
      })
    )
  })
  ipcMain.handle(IPC.invokeCancel, (e, url: unknown, itemId: unknown) => (guard(e), cancel(url, itemId)))
}
