// InvokeAI plugin window: connect to a local InvokeAI server, write a prompt, and place the generated
// image on the canvas. The requests run in the main process (src/main/plugins/invokeai.ts).
import { useCallback, useEffect, useState } from 'react'
import { Dices, RefreshCw } from 'lucide-react'
import { Button, Field, IconButton, Modal, Segmented, Select } from '../../ui'
import { INVOKE_SCHEDULERS, SEED_MAX, type InvokeModel, type InvokeProgress } from '@shared/invokeai'
import { insertMedia } from '../../editor/canvas/actions'
import { toast } from '../../editor/canvas/toast'
import { setPluginPrefs, usePluginPrefs } from '../prefs'
import type { PluginProps } from '../registry'

interface Settings {
  url?: string
  modelKey?: string
  prompt?: string
  negative?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  scheduler?: string
  seed?: number
  randomSeed?: boolean
}

export const DEFAULT_INVOKE_URL = 'http://127.0.0.1:9090'

const ASPECTS = [
  { value: '1:1', w: 1, h: 1 },
  { value: '4:3', w: 4, h: 3 },
  { value: '3:4', w: 3, h: 4 },
  { value: '16:9', w: 16, h: 9 },
  { value: '9:16', w: 9, h: 16 }
] as const

/** Width × height for an aspect ratio at the model's native pixel count (512² for SD 1/2, 1024² for SDXL). */
function sizeFor(aspect: (typeof ASPECTS)[number], base: string): { width: number; height: number } {
  const side = base === 'sdxl' ? 1024 : 512
  const k = Math.sqrt((side * side) / (aspect.w * aspect.h))
  return { width: Math.round((aspect.w * k) / 64) * 64, height: Math.round((aspect.h * k) / 64) * 64 }
}

const BASE_LABEL: Record<string, string> = { 'sd-1': 'SD 1.x', 'sd-2': 'SD 2.x', sdxl: 'SDXL' }

const STATUS_LABEL: Record<InvokeProgress['status'], string> = {
  pending: 'Queued…',
  waiting: 'Waiting…',
  in_progress: 'Generating…',
  completed: 'Downloading…',
  failed: 'Failed',
  canceled: 'Canceled'
}

type Conn = { state: 'idle' | 'checking' } | { state: 'ok'; version: string } | { state: 'error'; error: string }

const api = (): Window['canvasApi']['invokeai'] | undefined => window.canvasApi?.invokeai

export function InvokeAIDialog({ docId, open, onClose }: PluginProps): JSX.Element {
  const saved = usePluginPrefs<Settings>('invokeai')
  const url = saved.url ?? DEFAULT_INVOKE_URL
  const [urlDraft, setUrlDraft] = useState(url)
  const [conn, setConn] = useState<Conn>({ state: 'idle' })
  const [models, setModels] = useState<InvokeModel[]>([])
  const [prompt, setPrompt] = useState(saved.prompt ?? '')
  const [negative, setNegative] = useState(saved.negative ?? '')
  const [run, setRun] = useState<{ itemId?: number; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const model = models.find((m) => m.key === saved.modelKey) ?? models[0]
  const width = saved.width ?? (model?.base === 'sdxl' ? 1024 : 512)
  const height = saved.height ?? (model?.base === 'sdxl' ? 1024 : 512)
  const steps = saved.steps ?? 30
  const cfgScale = saved.cfgScale ?? 7
  const scheduler = saved.scheduler ?? 'dpmpp_2m_k'
  const randomSeed = saved.randomSeed ?? true
  const seed = saved.seed ?? 0
  const set = (patch: Settings): void => setPluginPrefs('invokeai', patch as Record<string, unknown>)

  const connect = useCallback(async (target: string) => {
    const a = api()
    if (!a) return
    setConn({ state: 'checking' })
    const st = await a.status(target)
    if (!st.ok) {
      setConn({ state: 'error', error: st.error })
      setModels([])
      return
    }
    const ms = await a.models(target)
    if (!ms.ok) {
      setConn({ state: 'error', error: ms.error })
      return
    }
    setModels(ms.models)
    setConn({ state: 'ok', version: st.version })
  }, [])

  useEffect(() => {
    if (!open) return
    setUrlDraft(url)
    setError(null)
    if (conn.state !== 'ok' && conn.state !== 'checking') void connect(url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(
    () =>
      api()?.onProgress((p) => setRun((r) => (r && (r.itemId === undefined || r.itemId === p.itemId) ? { itemId: p.itemId, status: STATUS_LABEL[p.status] } : r))),
    []
  )

  const applyUrl = (): void => {
    const next = urlDraft.trim() || DEFAULT_INVOKE_URL
    set({ url: next })
    void connect(next)
  }

  const pickModel = (key: string): void => {
    const m = models.find((x) => x.key === key)
    if (!m) return
    const was = model?.base
    // switching between SD and SDXL: move to the new model's native size, keeping the aspect ratio
    if (was !== m.base && (was === 'sdxl') !== (m.base === 'sdxl')) {
      const k = m.base === 'sdxl' ? 2 : 0.5
      set({ modelKey: key, width: Math.round((width * k) / 8) * 8, height: Math.round((height * k) / 8) * 8 })
    } else set({ modelKey: key })
  }

  const aspect = ASPECTS.find((a) => {
    const s = sizeFor(a, model?.base ?? 'sd-1')
    return s.width === width && s.height === height
  })?.value

  const generate = async (): Promise<void> => {
    const a = api()
    if (!a || !model || !prompt.trim() || run) return
    const useSeed = randomSeed ? Math.floor(Math.random() * SEED_MAX) : seed
    set({ prompt, negative, seed: useSeed })
    setError(null)
    setRun({ status: 'Sending…' })
    const r = await a.generate({ url, model, prompt, negative, width, height, steps, cfgScale, scheduler, seed: useSeed })
    setRun(null)
    if (!r.ok) {
      if (r.error !== 'Canceled') setError(r.error)
      return
    }
    const name = prompt.trim().replace(/\s+/g, ' ').slice(0, 40) || 'InvokeAI image'
    await insertMedia(docId, [{ name, src: r.image.dataUrl }])
    toast(`Image added (seed ${r.image.seed})`)
    onClose()
  }

  const cancel = (): void => {
    if (run?.itemId !== undefined) void api()?.cancel(url, run.itemId)
  }

  const ready = conn.state === 'ok' && !!model && !!prompt.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="InvokeAI"
      width={480}
      footer={
        <>
          <div className="ia-footnote">{run ? run.status : error ? <span className="ia-error" title={error}>{error}</span> : null}</div>
          {run ? (
            <Button onClick={cancel} disabled={run.itemId === undefined}>
              Stop
            </Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
          <Button variant="primary" onClick={() => void generate()} disabled={!ready || !!run}>
            Generate
          </Button>
        </>
      }
    >
      <div className="ia">
        <div className="ia-row">
          <span className={`ia-dot ia-dot--${conn.state}`} />
          <input
            className="ia-input"
            value={urlDraft}
            spellCheck={false}
            placeholder={DEFAULT_INVOKE_URL}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => urlDraft.trim() !== url && applyUrl()}
            onKeyDown={(e) => e.key === 'Enter' && applyUrl()}
          />
          <IconButton icon={<RefreshCw size={14} />} label="Reconnect" size={28} onClick={applyUrl} disabled={conn.state === 'checking'} />
        </div>
        <div className="ia-status">
          {conn.state === 'checking' && 'Connecting…'}
          {conn.state === 'ok' && `Connected to InvokeAI ${conn.version}`}
          {conn.state === 'error' && (
            <>
              {conn.error}{' '}
              <button className="ia-link" onClick={() => window.canvasApi?.openExternal('https://invoke-ai.github.io/InvokeAI/installation/quick_start/')}>
                Install InvokeAI
              </button>
            </>
          )}
        </div>

        {conn.state === 'ok' && !models.length && (
          <div className="ia-status">No SD 1.x, SD 2.x or SDXL models installed. Add one in InvokeAI's Model Manager.</div>
        )}

        <label className="ia-label">Model</label>
        <Select
          value={model?.key ?? null}
          placeholder={conn.state === 'ok' ? 'No models' : 'Not connected'}
          disabled={!models.length}
          options={models.map((m) => ({ value: m.key, label: `${m.name} · ${BASE_LABEL[m.base] ?? m.base}` }))}
          onChange={pickModel}
          menuMinWidth={320}
        />

        <label className="ia-label">Prompt</label>
        <textarea
          className="ia-text"
          rows={4}
          autoFocus
          placeholder="A misty pine forest at dawn, soft light, 35mm photo"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void generate()
            }
          }}
        />
        <label className="ia-label">Negative prompt</label>
        <textarea className="ia-text" rows={2} placeholder="blurry, low quality" value={negative} onChange={(e) => setNegative(e.target.value)} />

        <label className="ia-label">Size</label>
        <div className="ia-row">
          <Segmented
            value={aspect ?? null}
            options={ASPECTS.map((a) => ({ value: a.value, label: a.value }))}
            onChange={(v) => set(sizeFor(ASPECTS.find((a) => a.value === v)!, model?.base ?? 'sd-1'))}
          />
          <Field label="W" value={width} min={64} max={4096} step={8} onChange={(v) => typeof v === 'number' && set({ width: Math.round(v / 8) * 8 })} style={{ width: 76 }} />
          <Field label="H" value={height} min={64} max={4096} step={8} onChange={(v) => typeof v === 'number' && set({ height: Math.round(v / 8) * 8 })} style={{ width: 76 }} />
        </div>

        <div className="ia-grid">
          <div>
            <label className="ia-label">Steps</label>
            <Field value={steps} min={1} max={150} onChange={(v) => typeof v === 'number' && set({ steps: Math.round(v) })} />
          </div>
          <div>
            <label className="ia-label">CFG scale</label>
            <Field value={cfgScale} min={1} max={30} step={0.5} precision={1} onChange={(v) => typeof v === 'number' && set({ cfgScale: v })} />
          </div>
          <div>
            <label className="ia-label">Scheduler</label>
            <Select value={scheduler} options={INVOKE_SCHEDULERS.map((s) => ({ value: s.value, label: s.label }))} onChange={(v) => set({ scheduler: v })} />
          </div>
          <div>
            <label className="ia-label">Seed</label>
            <div className="ia-row">
              <Field
                value={randomSeed ? 'Random' : seed}
                keywords={['Random']}
                min={0}
                max={SEED_MAX}
                onChange={(v) => (typeof v === 'number' ? set({ seed: Math.round(v), randomSeed: false }) : set({ randomSeed: true }))}
              />
              <IconButton
                icon={<Dices size={14} />}
                label={randomSeed ? 'Keep the last seed' : 'Random seed each time'}
                active={randomSeed}
                size={28}
                onClick={() => set({ randomSeed: !randomSeed })}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
