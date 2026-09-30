// Node export (PNG / JPG / WebP / SVG / HTML / PDF) for the inspector's Export section, and the
// multi-page PDF of every artboard on a page.
import { nodeToHtml } from '../../model/html'
import { tokensCssWithModes } from '../../model/modes'
import { worldRect } from '../../model/ops'
import { exportBackground, fontsFor, nodeToRenderHtml } from '../../bridge/tools-render'
import { fetchCss } from './fonts'
import type { Doc } from '../../model/types'

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'html' | 'pdf'

/** Formats rendered to a bitmap (these take a scale). */
export const RASTER_FORMATS: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['png', 'jpg', 'webp'])

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export'

function tokensCss(doc: Doc): string {
  return tokensCssWithModes(doc)
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const BASE_CSS = 'body{margin:0;font-family:system-ui,sans-serif;font-size:16px;line-height:20px;color:#000}'

export function htmlDocument(doc: Doc, id: string): string {
  const n = doc.nodes[id]
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${n?.name ?? 'Export'}</title>
<style>${BASE_CSS}${tokensCss(doc)}</style>
</head>
<body>
${nodeToHtml(doc, id, { asRoot: true })}
</body>
</html>
`
}

export function svgDocument(doc: Doc, id: string): string {
  const r = worldRect(doc, id)
  const w = Math.ceil(r?.width ?? 100)
  const h = Math.ceil(r?.height ?? 100)
  const html = nodeToHtml(doc, id, { asRoot: true })
  // foreignObject requires XHTML: make void tags self-closing
  const xhtml = html.replace(/<(img|br|hr|input|meta|link)([^>]*?)(?<!\/)>/g, '<$1$2 />')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<foreignObject x="0" y="0" width="${w}" height="${h}">
<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:system-ui,sans-serif;font-size:16px;line-height:20px;color:#000">
<style>${tokensCss(doc)}</style>
${xhtml}
</div>
</foreignObject>
</svg>
`
}

/**
 * A standalone document for the main process's offscreen renderer. One node sits in
 * `#__canvas_wrap` (what the rasteriser measures and captures); with `pages`, every node gets its
 * own `.__vellum_page` wrapper, which the PDF printer turns into one page each.
 */
async function renderDocument(doc: Doc, ids: string[], pages = false): Promise<string> {
  const fonts: string[] = []
  for (const f of new Set(ids.flatMap((id) => fontsFor(doc, id)))) {
    const name = f.replace(/^["']|["']$/g, '')
    if (name && !/^(system-ui|sans-serif|serif|monospace|-apple-system|ui-)/i.test(name)) {
      const css = await fetchCss(name)
      if (css) fonts.push(css)
    }
  }
  const wrap = (id: string, attr: string): string => {
    // nodes on screen keep their measured size (fill / stretched children resolve against it)
    const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null
    const wr = worldRect(doc, id)
    const size = el && wr ? ` style="width:${wr.width}px;height:${wr.height}px"` : ''
    return `<div ${attr}${size}>${nodeToRenderHtml(doc, id, true)}</div>`
  }
  const body = pages ? ids.map((id) => wrap(id, 'class="__vellum_page"')).join('\n') : wrap(ids[0], 'id="__canvas_wrap"')
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${fonts.join('\n')}
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:transparent}
${BASE_CSS}${tokensCss(doc)}#__canvas_wrap{display:inline-flex}.__vellum_page{display:flex;width:max-content}
#__canvas_wrap>*,.__vellum_page>*{flex-shrink:0}</style></head>
<body>${body}</body></html>`
}

function base64Blob(base64: string, type: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** PNG / JPG / WebP via the main process's offscreen renderer: whole node, any zoom, even off screen. */
async function captureImage(doc: Doc, id: string, scale: number, format: 'png' | 'jpg' | 'webp'): Promise<Blob | null> {
  const api = window.canvasApi
  if (!api?.renderHtml) return null
  const res = await api.renderHtml({
    html: await renderDocument(doc, [id]),
    scale,
    format: format === 'jpg' ? 'jpeg' : format,
    // JPG has no alpha: flatten onto the artboard (or page) background
    background: format === 'jpg' ? exportBackground(doc, id) : undefined
  })
  return base64Blob(res.base64, format === 'jpg' ? 'image/jpeg' : `image/${format}`)
}

/** PDF (vector, text stays text) with one page per node, each page the size of its node. */
async function capturePdf(doc: Doc, ids: string[]): Promise<Blob | null> {
  const api = window.canvasApi
  if (!api?.renderPdf || !ids.length) return null
  const res = await api.renderPdf({ html: await renderDocument(doc, ids, true) })
  return base64Blob(res.base64, 'application/pdf')
}

/** Every visible artboard on the page as one PDF, one page per artboard. Returns the page count. */
export async function exportArtboardsPdf(doc: Doc, pageId: string): Promise<number> {
  const page = doc.pages.find((p) => p.id === pageId)
  if (!page) return 0
  const ids = (doc.nodes[page.rootId]?.children ?? []).filter((id) => doc.nodes[id] && doc.nodes[id].visible !== false)
  const blob = await capturePdf(doc, ids)
  if (!blob) return 0
  downloadBlob(`${safe(doc.name)} - ${safe(page.name)}.pdf`, blob)
  return ids.length
}

export async function exportNode(
  doc: Doc,
  id: string,
  format: ExportFormat,
  scale = 1,
  opts: { clipboard?: boolean } = {}
): Promise<void> {
  const n = doc.nodes[id]
  if (!n) return
  const base = safe(n.name)
  if (format === 'html') {
    const s = htmlDocument(doc, id)
    if (opts.clipboard) await navigator.clipboard.writeText(s)
    else downloadBlob(`${base}.html`, new Blob([s], { type: 'text/html' }))
  } else if (format === 'svg') {
    const s = svgDocument(doc, id)
    if (opts.clipboard) await navigator.clipboard.writeText(s)
    else downloadBlob(`${base}.svg`, new Blob([s], { type: 'image/svg+xml' }))
  } else if (format === 'pdf') {
    const blob = await capturePdf(doc, [id])
    if (blob) downloadBlob(`${base}.pdf`, blob)
  } else {
    const blob = await captureImage(doc, id, scale, format)
    if (!blob) return
    // the clipboard only takes PNG images
    if (opts.clipboard && format === 'png') await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    else downloadBlob(`${base}${scale !== 1 ? `@${scale}x` : ''}.${format}`, blob)
  }
}
