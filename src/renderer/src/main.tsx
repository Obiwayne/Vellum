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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
