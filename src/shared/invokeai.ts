// InvokeAI plugin: the types shared by main and renderer, and the text-to-image graph sent to the
// server (POST /api/v1/queue/default/enqueue_batch). Pure: no runtime imports.

/** A main model as GET /api/v2/models/ lists it (the fields a graph's ModelIdentifierField needs). */
export interface InvokeModel {
  key: string
  hash: string
  name: string
  base: string
  type: string
}

export interface InvokeGenerateArgs {
  /** server root, e.g. http://127.0.0.1:9090 */
  url: string
  model: InvokeModel
  prompt: string
  negative?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  scheduler: string
  seed: number
}

export interface InvokeImage {
  /** PNG data URL */
  dataUrl: string
  imageName: string
  width: number
  height: number
  seed: number
}

export interface InvokeProgress {
  itemId: number
  status: 'pending' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'canceled'
}

export type InvokeResult<T> = ({ ok: true } & T) | { ok: false; error: string }

export interface InvokeAIApi {
  /** the server's version, or why it can't be reached */
  status(url: string): Promise<InvokeResult<{ version: string }>>
  /** main models the plugin can drive (SD 1.x, SD 2.x, SDXL) */
  models(url: string): Promise<InvokeResult<{ models: InvokeModel[] }>>
  /** queue a text-to-image run and wait for the picture */
  generate(args: InvokeGenerateArgs): Promise<InvokeResult<{ image: InvokeImage }>>
  cancel(url: string, itemId: number): Promise<void>
  onProgress(cb: (p: InvokeProgress) => void): () => void
}

/** Model bases the graph below supports. */
export const INVOKE_BASES = ['sd-1', 'sd-2', 'sdxl'] as const

export const INVOKE_SCHEDULERS = [
  { value: 'euler', label: 'Euler' },
  { value: 'euler_a', label: 'Euler Ancestral' },
  { value: 'dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'dpmpp_2m_k', label: 'DPM++ 2M Karras' },
  { value: 'dpmpp_2m_sde_k', label: 'DPM++ 2M SDE Karras' },
  { value: 'dpmpp_sde_k', label: 'DPM++ SDE Karras' },
  { value: 'heun', label: 'Heun' },
  { value: 'ddim', label: 'DDIM' },
  { value: 'unipc', label: 'UniPC' },
  { value: 'lcm', label: 'LCM' }
] as const

export const SEED_MAX = 4294967295

/** id of the node whose image is the result */
export const OUTPUT_NODE = 'vellum_l2i'

/** Normalise a user-typed server address: http(s) only, no credentials, no trailing slash. Null when invalid. */
export function normalizeInvokeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`
  try {
    const u = new URL(s)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

const edge = (from: string, fromField: string, to: string, toField: string): object => ({
  source: { node_id: from, field: fromField },
  destination: { node_id: to, field: toField }
})

const mult8 = (v: number): number => Math.max(64, Math.min(4096, Math.round(v / 8) * 8))

/** The text-to-image graph for an SD 1.x / SD 2.x / SDXL model. */
export function buildTextToImageGraph(a: Omit<InvokeGenerateArgs, 'url'>): { id: string; nodes: Record<string, object>; edges: object[] } {
  const width = mult8(a.width)
  const height = mult8(a.height)
  const model = { key: a.model.key, hash: a.model.hash, name: a.model.name, base: a.model.base, type: a.model.type }
  const sdxl = a.model.base === 'sdxl'
  const nodes: Record<string, object> = {}
  const edges: object[] = []
  const add = (id: string, type: string, fields: Record<string, unknown> = {}): void => {
    nodes[id] = { id, type, is_intermediate: true, use_cache: true, ...fields }
  }

  add('model', sdxl ? 'sdxl_model_loader' : 'main_model_loader', { model })
  if (sdxl) {
    const sizes = { original_width: width, original_height: height, target_width: width, target_height: height, crop_top: 0, crop_left: 0 }
    add('pos', 'sdxl_compel_prompt', { prompt: a.prompt, style: a.prompt, ...sizes })
    add('neg', 'sdxl_compel_prompt', { prompt: a.negative ?? '', style: a.negative ?? '', ...sizes })
    for (const c of ['pos', 'neg']) {
      edges.push(edge('model', 'clip', c, 'clip'), edge('model', 'clip2', c, 'clip2'))
    }
  } else {
    add('pos', 'compel', { prompt: a.prompt })
    add('neg', 'compel', { prompt: a.negative ?? '' })
    edges.push(edge('model', 'clip', 'pos', 'clip'), edge('model', 'clip', 'neg', 'clip'))
  }
  add('noise', 'noise', { seed: Math.max(0, Math.min(SEED_MAX, Math.floor(a.seed))), width, height, use_cpu: true })
  add('denoise', 'denoise_latents', {
    steps: Math.max(1, Math.min(150, Math.round(a.steps))),
    cfg_scale: Math.max(1, Math.min(30, a.cfgScale)),
    scheduler: a.scheduler,
    denoising_start: 0,
    denoising_end: 1
  })
  add(OUTPUT_NODE, 'l2i', { fp32: false, is_intermediate: false, use_cache: false })
  edges.push(
    edge('model', 'unet', 'denoise', 'unet'),
    edge('pos', 'conditioning', 'denoise', 'positive_conditioning'),
    edge('neg', 'conditioning', 'denoise', 'negative_conditioning'),
    edge('noise', 'noise', 'denoise', 'noise'),
    edge('denoise', 'latents', OUTPUT_NODE, 'latents'),
    edge('model', 'vae', OUTPUT_NODE, 'vae')
  )
  return { id: `vellum_t2i_${Date.now().toString(36)}`, nodes, edges }
}

/** The output image name in a finished queue item (session.results is keyed by prepared node ids). */
export function findOutputImage(item: unknown): string | null {
  const session = (item as { session?: { results?: Record<string, unknown>; source_prepared_mapping?: Record<string, string[]> } })?.session
  const results = session?.results ?? {}
  const imageOf = (r: unknown): string | null => {
    const name = (r as { image?: { image_name?: unknown } })?.image?.image_name
    return typeof name === 'string' && name ? name : null
  }
  for (const pid of session?.source_prepared_mapping?.[OUTPUT_NODE] ?? []) {
    const n = imageOf(results[pid])
    if (n) return n
  }
  // older servers / unexpected shapes: the only image result in the session
  for (const r of Object.values(results)) {
    const n = imageOf(r)
    if (n) return n
  }
  return null
}
