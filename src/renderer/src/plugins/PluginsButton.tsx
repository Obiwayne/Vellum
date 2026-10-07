// Toolbar puzzle button: a menu of the enabled plugins, plus Manage plugins.
import { useRef, useState } from 'react'
import { ExternalLink, Puzzle } from 'lucide-react'
import { Button, Checkbox, IconButton, Menu, Modal, type MenuEntry } from '../ui'
import { useStore } from '../model/store'
import { PLUGINS } from './registry'
import { isPluginEnabled, setPluginPrefs } from './prefs'
import './plugins.css'

export function PluginsButton({ docId }: { docId: string }): JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null)
  const prefs = useStore((s) => s.prefs)
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)

  const enabled = PLUGINS.filter((p) => isPluginEnabled(prefs, p.id))
  const items: MenuEntry[] = [
    { type: 'heading', label: 'Plugins' },
    ...(enabled.length
      ? enabled.map((p): MenuEntry => ({ label: p.name, icon: p.icon, onSelect: () => setActive(p.id) }))
      : [{ label: 'No plugins turned on', disabled: true }]),
    { type: 'separator' },
    { label: 'Manage plugins…', onSelect: () => setManageOpen(true) }
  ]

  return (
    <>
      <IconButton
        ref={btn}
        size={32}
        icon={<Puzzle size={20} strokeWidth={1.5} />}
        label="Plugins"
        tooltipSide="right"
        active={menuOpen || active !== null}
        onClick={() => setMenuOpen((o) => !o)}
      />
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchor={btn.current} placement="right-start" items={items} minWidth={200} ignore={[btn.current]} />
      {PLUGINS.map((p) => (
        <p.Dialog key={p.id} docId={docId} open={active === p.id} onClose={() => setActive(null)} />
      ))}
      <Modal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="Plugins"
        width={440}
        footer={
          <Button variant="primary" onClick={() => setManageOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="pl-list">
          {PLUGINS.map((p) => (
            <div key={p.id} className="pl-row">
              <div className="pl-row__icon">{p.icon}</div>
              <div className="pl-row__text">
                <div className="pl-row__name">
                  {p.name}
                  {p.homepage && (
                    <button className="pl-link" title={p.homepage} onClick={() => window.canvasApi?.openExternal(p.homepage!)}>
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
                <div className="pl-row__desc">{p.description}</div>
              </div>
              <Checkbox checked={isPluginEnabled(prefs, p.id)} onChange={(on) => setPluginPrefs(p.id, { enabled: on })} />
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
