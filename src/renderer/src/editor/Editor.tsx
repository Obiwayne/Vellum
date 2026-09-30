import { LeftPanel } from './left/LeftPanel'
import { Toolbar } from './toolbar/Toolbar'
import { CanvasView } from './canvas/CanvasView'
import { Inspector } from './inspector/Inspector'
import { useStore } from '../model/store'
import { leftWidth } from './left/LeftPanel'
import './editor.css'

/** Editor layout: left 240 (resizable, pref `leftWidth`) | toolbar 40 | canvas (flex) | inspector 280, 1px hairlines between. */
export function Editor({ docId }: { docId: string }): JSX.Element {
  const width = useStore((s) => leftWidth(s.prefs.leftWidth))
  return (
    <div className="ed" style={{ '--left-w': `${width}px` } as React.CSSProperties}>
      <aside className="ed-left">
        <LeftPanel docId={docId} />
      </aside>
      <div className="ed-toolbar">
        <Toolbar docId={docId} />
      </div>
      <div className="ed-canvas">
        <CanvasView docId={docId} />
      </div>
      <aside className="ed-inspector">
        <Inspector docId={docId} />
      </aside>
    </div>
  )
}
