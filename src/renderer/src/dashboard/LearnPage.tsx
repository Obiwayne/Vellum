import { formatShortcut } from '../ui'
import { ConnectAgentBody } from './ConnectAgentModal'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['Move', 'V'],
      ['Pan', 'H'],
      ['Pan while held', 'Space'],
      ['Frame', 'F'],
      ['Rectangle', 'R'],
      ['Pen', 'P'],
      ['Text', 'T'],
      ['Comment', 'C'],
      ['Shaders', 'S'],
      ['Create image', 'Ctrl+Shift+I'],
      ['Create SVG', 'Ctrl+Shift+J'],
      ['Icons', 'Shift+I'],
      ['Show / hide comments', 'Shift+C']
    ]
  },
  {
    title: 'Zoom',
    items: [
      ['Zoom in', '+'],
      ['Zoom out', '-'],
      ['Zoom to 100%', 'Shift+0'],
      ['Zoom to fit', 'Shift+1'],
      ['Zoom to selection', 'Shift+2'],
      ['Zoom', 'Ctrl+Scroll'],
      ['Next / previous artboard', 'N / Shift+N']
    ]
  },
  {
    title: 'Editing',
    items: [
      ['Undo', 'Ctrl+Z'],
      ['Redo', 'Ctrl+Shift+Z'],
      ['Copy / Paste', 'Ctrl+C / Ctrl+V'],
      ['Copy as Tailwind', 'Alt+T'],
      ['Copy as React', 'Alt+R'],
      ['Duplicate', 'Ctrl+D'],
      ['Delete', 'Delete'],
      ['Wrap in flex', 'Shift+A'],
      ['Frame selection', 'Shift+F'],
      ['Bring to front / Send to back', '] / ['],
      ['Show / hide', 'Ctrl+Shift+H'],
      ['Lock / unlock', 'Ctrl+Shift+L'],
      ['Opacity 10% – 90% / 100%', '1 – 9 / 0'],
      ['Crop an image', 'Ctrl+Drag handle'],
      ['Collapse all layers', 'Alt+L'],
      ['Layers under the pointer', 'Ctrl+Right-click'],
      ['Select parent', 'Esc'],
      ['Select children', 'Enter']
    ]
  },
  {
    title: 'App',
    items: [
      ['New file', 'Ctrl+N'],
      ['Close tab', 'Ctrl+W'],
      ['Reopen closed tab', 'Ctrl+Shift+T'],
      ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
      ['Go to dashboard', 'Ctrl+Shift+D'],
      ['Toggle sidebar', 'Ctrl+\\'],
      ['Search files', 'Ctrl+F']
    ]
  }
]

export function LearnPage(): JSX.Element {
  return (
    <div className="db-learn">
      <p className="db-lead">Vellum designs are real HTML and CSS. Draw frames, add flex layouts, type text — and let Claude design alongside you through the MCP server.</p>
      <h2 className="db-h2">Keyboard shortcuts</h2>
      <div className="db-shortcuts">
        {GROUPS.map((g) => (
          <div key={g.title} className="db-shortcuts__group">
            <div className="db-shortcuts__title">{g.title}</div>
            {g.items.map(([label, keys]) => (
              <div key={label} className="db-shortcuts__row">
                <span>{label}</span>
                <span className="db-kbd">{keys.split(' / ').map((k) => (k === '+' ? k : formatShortcut(k, true))).join('  /  ')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <h2 className="db-h2">Connect Claude</h2>
      <div className="db-card-panel">
        <ConnectAgentBody />
      </div>
    </div>
  )
}
