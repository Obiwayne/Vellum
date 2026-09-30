import { useEffect, useRef, useState } from 'react'
import { Copy, File, LayoutGrid, Menu as MenuIcon, Minus, Plus, Square, X } from 'lucide-react'
import { Menu, type MenuEntry } from '../ui'
import { DASHBOARD, useStore } from '../model/store'
import { appMenu, commands } from './commands'
import './titlebar.css'

function WindowButtons(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const api = window.canvasApi
    if (!api) return
    void api.isMaximized().then(setMaximized)
    return api.onMaximizedChange(setMaximized)
  }, [])
  return (
    <div className="tb-winbtns">
      <button type="button" className="tb-winbtn" aria-label="Minimize" onClick={() => window.canvasApi?.minimize()}>
        <Minus size={16} strokeWidth={1.25} />
      </button>
      <button
        type="button"
        className="tb-winbtn"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => window.canvasApi?.toggleMaximize()}
      >
        {maximized ? <Copy size={13} strokeWidth={1.25} style={{ transform: 'scaleX(-1)' }} /> : <Square size={13} strokeWidth={1.25} />}
      </button>
      <button type="button" className="tb-winbtn tb-winbtn--close" aria-label="Close" onClick={() => window.canvasApi?.close()}>
        <X size={16} strokeWidth={1.25} />
      </button>
    </div>
  )
}

function DocTab({ id, active }: { id: string; active: boolean }): JSX.Element | null {
  const name = useStore((s) => s.docs[id]?.name)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTab)
  if (name === undefined) return null
  return (
    <div
      className={['tb-tab', active && 'tb-tab--active'].filter(Boolean).join(' ')}
      onPointerDown={(e) => {
        if (e.button === 0) setActiveTab(id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) closeTab(id)
      }}
      title={name}
    >
      <File size={14} strokeWidth={1.5} className="tb-tab__icon" />
      <span className="tb-tab__name">{name}</span>
      <button
        type="button"
        className="tb-tab__close"
        aria-label="Close tab"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => closeTab(id)}
      >
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  )
}

export function TitleBar(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const activeTab = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const menuBtn = useRef<HTMLButtonElement | null>(null)
  const [menu, setMenu] = useState<MenuEntry[] | null>(null)

  return (
    <header className="tb" onDoubleClick={(e) => e.target === e.currentTarget && window.canvasApi?.toggleMaximize()}>
      <button
        ref={menuBtn}
        type="button"
        className={['tb-menu', menu && 'tb-menu--open'].filter(Boolean).join(' ')}
        aria-label="Menu"
        onClick={() => setMenu((m) => (m ? null : appMenu()))}
      >
        <MenuIcon size={16} strokeWidth={1.5} />
      </button>
      <Menu open={Boolean(menu)} anchor={menuBtn.current} items={menu ?? []} onClose={() => setMenu(null)} offset={6} minWidth={116} />

      <nav className="tb-tabs" onDoubleClick={(e) => e.target === e.currentTarget && window.canvasApi?.toggleMaximize()}>
        <div
          className={['tb-tab', 'tb-tab--dashboard', activeTab === DASHBOARD && 'tb-tab--active'].filter(Boolean).join(' ')}
          onPointerDown={(e) => {
            if (e.button === 0) setActiveTab(DASHBOARD)
          }}
        >
          <LayoutGrid size={14} strokeWidth={1.5} className="tb-tab__icon" />
          <span className="tb-tab__name">Dashboard</span>
        </div>
        {tabs.length > 1 && <div className="tb-sep" />}
        {tabs
          .filter((t) => t !== DASHBOARD)
          .map((t) => (
            <DocTab key={t} id={t} active={t === activeTab} />
          ))}
        <button type="button" className="tb-new" aria-label="New file" title="New file" onClick={commands.newTab}>
          <Plus size={16} strokeWidth={1.5} />
        </button>
      </nav>
      <WindowButtons />
    </header>
  )
}
