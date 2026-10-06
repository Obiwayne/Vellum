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
      ['Group', 'Ctrl+G'],
      ['Ungroup', 'Ctrl+Shift+G'],
      ['Frame selection', 'Shift+F'],
      ['Create component', 'Ctrl+Alt+K'],
      ['Detach instance', 'Ctrl+Alt+B'],
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
    title: 'Components',
    items: [
      ['Create component', 'Ctrl+Alt+K'],
      ['Detach instance', 'Ctrl+Alt+B'],
      ['Add variant', 'Right-click a component'],
      ['Switch an instance\'s variant', 'Inspector → Variant'],
      ['Add a boolean / text / swap property', 'Inspector of a component → Properties'],
      ['Bind a layer to a property', 'Inspector of the layer → Bind to property'],
      ['Place a component', 'Assets panel: click or drag'],
      ['Go to main component', 'Right-click an instance']
    ]
  },
  {
    title: 'Styles',
    items: [
      ['Create a text style', 'Select a text, then + in Theme → Styles (or + in the Text section)'],
      ['Apply a text style', 'Text section → style dropdown'],
      ['Edit a style everywhere', 'Theme → Styles → click the style'],
      ['Detach from a style', 'Change its typography, or the unlink button'],
      ['Create a colour style', 'Select a layer, then + under Colour styles'],
      ['Apply or detach a colour style', 'Colour field → token button']
    ]
  },
  {
    title: 'Text',
    items: [
      ['Bold', 'Ctrl+B'],
      ['Italic', 'Ctrl+I'],
      ['Underline', 'Ctrl+U'],
      ['Font size up / down', 'Ctrl+Shift+. / Ctrl+Shift+,'],
      ['Font weight up / down', 'Ctrl+Alt+. / Ctrl+Alt+,'],
      ['Letter spacing up / down', 'Alt+. / Alt+,'],
      ['Line height up / down', 'Alt+Shift+. / Alt+Shift+,']
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
