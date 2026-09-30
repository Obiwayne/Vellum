// Builds standalone HTML documents for a node (used for screenshots, PNG/SVG/HTML export).
// The renderer returns the node's markup (as the canvas renders it) plus tokens and fonts; we add
// Google Fonts links and a reset that mirrors the canvas, then the app's main process rasterises it
// in a hidden offscreen window (main:render_png).
import { googleCssUrl, googleFamiliesFor } from './fonts.js'

export interface RenderPayload {
  nodeId: string
  name: string
  /** node markup as rendered on the canvas (render mode, not export mode) */
  html: string
  /** clean export markup (nodeToHtml) */
  exportHtml: string
  tokensCss: string
  fontFamilies: string[]
  /** measured size on the canvas when available (keeps fill/flex children at their real size) */
  width: number | null
  height: number | null
  /** inherited text styles from ancestors + canvas defaults, as CSS text */
  inheritedCss: string
  pageBackground: string
}

const RESET = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
h1,h2,h3,h4,h5,h6,p,blockquote,figure,pre,ul,ol,li,dl,dd{margin:0;padding:0}
h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}
button,input,select,textarea{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;text-align:inherit}
a{color:inherit;text-decoration:inherit}
img,svg{display:block}
`

export async function buildDocument(p: RenderPayload, opts: { exportMode?: boolean } = {}): Promise<string> {
  const google = await googleFamiliesFor(p.fontFamilies)
  const cssUrl = googleCssUrl(google)
  const sized = p.width !== null && p.height !== null
  // The wrapper reproduces the canvas context: inherited text defaults, and — when we know the
  // measured size — a one-cell grid of exactly that size, so width:100% children resolve and
  // flow children without a width (grid cells, stretched flex items) keep their measured width.
  const wrap = sized
    ? `display:grid;grid-template-columns:${p.width}px;grid-template-rows:${p.height}px;width:${p.width}px;height:${p.height}px;`
    : 'display:inline-flex;'
  const body = opts.exportMode ? p.exportHtml : p.html
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(p.name)}</title>
${cssUrl ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n<link rel="stylesheet" href="${cssUrl}" />` : ''}
<style>${RESET}
${styleText(p.tokensCss)}
#__canvas_wrap{${wrap}align-items:flex-start;${styleText(p.inheritedCss)}}
#__canvas_wrap>*{flex-shrink:0}
</style>
</head>
<body>
<div id="__canvas_wrap">${body}</div>
</body>
</html>`
}

/** A standalone, human-friendly HTML export (no fixed wrapper, page background around it). */
export async function buildExportHtml(p: RenderPayload): Promise<string> {
  const google = await googleFamiliesFor(p.fontFamilies)
  const cssUrl = googleCssUrl(google)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.name)}</title>
${cssUrl ? `<link rel="stylesheet" href="${cssUrl}" />` : ''}
<style>${RESET}
${styleText(p.tokensCss)}
body{${styleText(p.inheritedCss)}}
</style>
</head>
<body>
${p.exportHtml}
</body>
</html>
`
}

/** SVG wrapper around the rendered HTML (foreignObject) — scalable, keeps text as text. */
export async function buildSvg(p: RenderPayload, width: number, height: number): Promise<string> {
  const google = await googleFamiliesFor(p.fontFamilies)
  const cssUrl = googleCssUrl(google)
  const xhtml = toXhtml(p.html)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;display:flex;align-items:flex-start;${escapeAttr(p.inheritedCss)}">
      <style>${xmlText(`${cssUrl ? `@import url('${cssUrl}');` : ''}${RESET}${p.tokensCss.replace(/:root/g, 'div')}`)}</style>
      ${xhtml}
    </div>
  </foreignObject>
</svg>
`
}

function toXhtml(html: string): string {
  // self-close void elements so the markup is valid XML
  return html.replace(/<(img|br|hr|input|meta|link)\b([^>]*?)\s*\/?>/gi, '<$1$2 />').replace(/&nbsp;/g, '&#160;')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/**
 * CSS from the design (token values, inherited text styles) placed inside an HTML <style> element:
 * a `<` could close the element (`</style><script>…`), so it becomes the CSS escape `\3c `.
 */
function styleText(css: string): string {
  return String(css ?? '').replace(/</g, '\\3c ')
}

/** Text content in XML (the SVG export): the XML parser turns the entities back into the original CSS. */
function xmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
