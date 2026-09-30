// Editor left panel: header (file name + collapse), Design | Theme, Pages + Layers, Theme tokens.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PanelLeft } from 'lucide-react'
import { IconButton, Segmented, matchShortcut } from '../../ui'
import { getStore, useStore } from '../../model/store'
import { PagesSection } from './PagesSection'
import { LayersTree } from './LayersTree'
import { ThemePanel } from './ThemePanel'
import { InlineEdit } from './InlineEdit'
import { FooterLinks } from './WhatsNew'
import './left.css'

function FileGlyph(): JSX.Element {
  // two overlapping sheets
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="2" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="2" y="5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  )
}

const tabByDoc = new Map<string, 'design' | 'theme'>()

export function LeftPanel({ docId }: { docId: string }): JSX.Element {
  const name = useStore((s) => s.docs[docId]?.name ?? '')
  const collapsed = useStore((s) => Boolean(s.prefs.leftCollapsed))
  const [tab, setTabState] = useState<'design' | 'theme'>(() => tabByDoc.get(docId) ?? 'design')
  const [renaming, setRenaming] = useState(false)
  const setTab = (t: 'design' | 'theme'): void => {
    tabByDoc.set(docId, t)
    setTabState(t)
  }
  const setCollapsed = (v: boolean): void => getStore().setPref('leftCollapsed', v)

  // Ctrl+\ toggles the sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !matchShortcut(e, 'Ctrl+\\')) return
      e.preventDefault()
      getStore().setPref('leftCollapsed', !getStore().prefs.leftCollapsed)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (collapsed) {
    return (
      <div className="lp lp--collapsed">
        {createPortal(
          <div className="lp-restore">
            <IconButton icon={<PanelLeft size={16} />} label="Expand sidebar" shortcut="Ctrl+\" tooltipSide="right" onClick={() => setCollapsed(false)} />
          </div>,
          document.body
        )}
      </div>
    )
  }

  return (
    <div className="lp">
      <div className="lp-header">
        <span className="lp-header__icon">
          <FileGlyph />
        </span>
        {renaming ? (
          <InlineEdit
            className="lp-header__input"
            value={name}
            onCommit={(v) => {
              getStore().renameDoc(docId, v)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="lp-header__name lp-ellipsis" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {name}
          </span>
        )}
        <IconButton icon={<PanelLeft size={16} />} label="Collapse sidebar" shortcut="Ctrl+\" onClick={() => setCollapsed(true)} />
      </div>
      <div className="lp-tabs">
        <Segmented
          full
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Design' },
            { value: 'theme', label: 'Theme' }
          ]}
        />
      </div>
      {tab === 'design' ? (
        <div className="lp-design">
          <PagesSection docId={docId} />
          <div className="lp-hairline" />
          <LayersTree docId={docId} />
        </div>
      ) : (
        <ThemePanel docId={docId} />
      )}
      <FooterLinks />
    </div>
  )
}
