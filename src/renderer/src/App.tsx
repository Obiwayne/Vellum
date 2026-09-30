import { TitleBar } from './shell/TitleBar'
import { Dashboard } from './dashboard/Dashboard'
import { Editor } from './editor/Editor'
import { DASHBOARD, useStore } from './model/store'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const activeTab = useStore((s) => s.activeTab)
  const hasDoc = useStore((s) => Boolean(s.docs[s.activeTab]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar />
      <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {!ready ? null : activeTab === DASHBOARD || !hasDoc ? <Dashboard /> : <Editor key={activeTab} docId={activeTab} />}
      </main>
    </div>
  )
}
