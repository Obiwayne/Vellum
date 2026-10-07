// Built-in plugins. Each one is a tool opened from the puzzle button in the toolbar; it can be turned
// off in Manage plugins. Settings live in prefs.plugins[id] (index.json of the profile).
import type { ComponentType, ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { InvokeAIDialog } from './invokeai/InvokeAIDialog'

export interface PluginProps {
  docId: string
  open: boolean
  onClose: () => void
}

export interface PluginDef {
  id: string
  name: string
  description: string
  icon: ReactNode
  /** project page, shown in Manage plugins */
  homepage?: string
  /** the plugin's window */
  Dialog: ComponentType<PluginProps>
}

export const PLUGINS: PluginDef[] = [
  {
    id: 'invokeai',
    name: 'InvokeAI',
    description: 'Generate images with a local InvokeAI server and place them on the canvas.',
    icon: <Sparkles size={16} strokeWidth={1.5} />,
    homepage: 'https://github.com/invoke-ai/InvokeAI',
    Dialog: InvokeAIDialog
  }
]
