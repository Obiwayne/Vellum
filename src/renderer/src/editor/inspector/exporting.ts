// Node export (PNG / SVG / HTML) for the inspector's Export section.
import { nodeToHtml } from '../../model/html'
import { worldRect } from '../../model/ops'
import { fontsFor, nodeToRenderHtml } from '../../bridge/tools-render'
import { fetchCss } from './fonts'
import type { Doc } from '../../model/types'

export type ExportFormat = 'png' | 'svg' | 'html'

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export'

function tokensCss(doc: Doc): string {
  if (!doc.tokens.length) return ''
  return `:root{${doc.tokens.map((t) => `${t.name}:${t.value}`).join(';')}}`
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

/** PNG via the main process's offscreen renderer: whole node, any zoom, even off screen. */
async function capturePng(doc: Doc, id: string, scale: number): Promise<Blob | null> {
  const api = window.canvasApi
  if (!api?.renderHtml) return null
  const fonts: string[] = []
  for (const f of fontsFor(doc, id)) {
    const name = f.replace(/^["']|["']$/g, '')
    if (name && !/^(system-ui|sans-serif|serif|monospace|-apple-system|ui-)/i.test(name)) {
      const css = await fetchCss(name)
      if (css) fonts.push(css)
    }
  }
  const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null
  const wr = worldRect(doc, id)
  const size = el && wr ? `width:${wr.width}px;height:${wr.height}px;` : ''
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>${fonts.join('\n')}
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:transparent}
${BASE_CSS}${tokensCss(doc)}#__wrap{display:inline-flex;${size}}#__wrap>*{flex-shrink:0}</style></head>
<body><div id="__wrap">${nodeToRenderHtml(doc, id, true)}</div></body></html>`
  const res = await api.renderHtml({ html, scale })
  const bin = atob(res.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
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
  } else {
    const blob = await capturePng(doc, id, scale)
    if (!blob) return
    if (opts.clipboard) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    else downloadBlob(`${base}${scale !== 1 ? `@${scale}x` : ''}.png`, blob)
  }
}
