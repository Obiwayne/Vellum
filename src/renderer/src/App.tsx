import { useEffect } from 'react'
import { TitleBar } from './shell/TitleBar'
import { UpdateDialog, UpdateReminder, initUpdates } from './shell/updates'
import { Dashboard } from './dashboard/Dashboard'
import { Editor } from './editor/Editor'
import { DASHBOARD, useStore } from './model/store'
import { ProfilePicker } from './profile/ProfilePicker'
import { useProfiles } from './profile/profile'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const activeTab = useStore((s) => s.activeTab)
  const hasDoc = useStore((s) => Boolean(s.docs[s.activeTab]))
  const profilesLoaded = useProfiles((s) => s.state !== null)
  const entered = useProfiles((s) => s.entered)
  const picker = !entered && profilesLoaded
  useEffect(() => initUpdates(), [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar />
      <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {picker ? <ProfilePicker /> : !ready || !entered ? null : activeTab === DASHBOARD || !hasDoc ? <Dashboard /> : <Editor key={activeTab} docId={activeTab} />}
      </main>
      <UpdateReminder />
      <UpdateDialog />
    </div>
  )
}
