import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/global.css'
import './ui'
import App from './App'
import { initPersistence } from './model/persist'
import { installBridge } from './bridge/handlers'
import { installAppShortcuts } from './shell/commands'

installAppShortcuts()
installBridge()
void initPersistence()

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
