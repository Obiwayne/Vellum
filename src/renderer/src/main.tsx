import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/global.css'
import './ui'
import App from './App'
import { startProfiles } from './profile/profile'
import { installBridge } from './bridge/handlers'
import { installAppShortcuts } from './shell/commands'
import { getStore } from './model/store'
import * as variants from './model/variants'

installAppShortcuts()
installBridge()
void startProfiles()

// Test hook for scripts/e2e-*.mjs: with localStorage `vellum.e2e` = 1 the store and the variant helpers are reachable from the page.
// (There is no UI for creating variants yet.) Off by default.
try {
  if (localStorage.getItem('vellum.e2e') === '1') (window as unknown as { __vellum?: unknown }).__vellum = { getStore, variants }
} catch {
  /* storage blocked: no hook */
}

// Dropping a file outside a drop target must not navigate the window to it.
for (const type of ['dragover', 'drop'] as const)
  window.addEventListener(type, (e) => {
    if (!e.defaultPrevented && e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
