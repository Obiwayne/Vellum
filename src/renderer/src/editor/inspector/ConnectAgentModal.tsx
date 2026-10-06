import { useEffect, useState, type ReactNode } from 'react'
import { Box, Check, Code2, Copy, Ellipsis, Hexagon, Plus, Minus, Sparkle } from 'lucide-react'
import { Button, IconButton, Modal } from '../../ui'
import { MCP_ENTRY } from '../../dashboard/ConnectAgentModal'
import { claudeCommand, codexCommand, codexToml, mcpServersJson, vscodeJson } from '@shared/mcpSnippets'

// ---- bridge activity (any MCP request reaching the renderer counts as "connected")
let lastBridgeRequest = 0
let bridgeWatch: (() => void) | null = null
export function watchBridgeActivity(): void {
  if (bridgeWatch || !window.canvasApi?.onBridgeRequest) return
  bridgeWatch = window.canvasApi.onBridgeRequest(() => {
    lastBridgeRequest = Date.now()
  })
}

interface Agent {
  id: string
  label: string
  icon: ReactNode
  command?: string
  configLabel: string
  config: string
}

const AGENTS: Agent[] = [
  {
    id: 'claude',
    label: 'Claude',
    icon: <Sparkle size={15} />,
    command: claudeCommand(MCP_ENTRY),
    configLabel: 'Or add it to Claude Desktop (claude_desktop_config.json):',
    config: mcpServersJson(MCP_ENTRY)
  },
  {
    id: 'codex',
    label: 'Codex',
    icon: <Hexagon size={15} />,
    command: codexCommand(MCP_ENTRY),
    configLabel: 'Or add it to ~/.codex/config.toml:',
    config: codexToml(MCP_ENTRY)
  },
  {
    id: 'cursor',
    label: 'Cursor',
    icon: <Box size={15} />,
    configLabel: 'Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in your project):',
    config: mcpServersJson(MCP_ENTRY)
  },
  {
    id: 'vscode',
    label: 'VS Code',
    icon: <Code2 size={15} />,
    configLabel: 'Add this to .vscode/mcp.json in your workspace:',
    config: vscodeJson(MCP_ENTRY)
  },
  {
    id: 'other',
    label: 'Other agents',
    icon: <Ellipsis size={15} />,
    configLabel: 'Most MCP clients accept a stdio server config like this:',
    config: mcpServersJson(MCP_ENTRY)
  }
]

const PROMPTS = [
  'Create a basic Hello World frame in Vellum',
  'Create 3 color tokens and make a swatch in Vellum',
  'Design a pricing card with three tiers in Vellum'
]

function CopyButton({ text }: { text: string }): JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      icon={done ? <Check size={14} /> : <Copy size={14} />}
      label={done ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    />
  )
}

function Code({ text }: { text: string }): JSX.Element {
  return (
    <div className="insp-code">
      <pre>{text}</pre>
      <CopyButton text={text} />
    </div>
  )
}

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="insp-step">
      <div className="insp-step__title">
        <span className={['insp-step__check', !done && 'insp-step__check--todo'].filter(Boolean).join(' ')}>
          {done && <Check size={12} strokeWidth={3} />}
        </span>
        {title}
      </div>
      {children && <div className="insp-step__body">{children}</div>}
    </div>
  )
}

function Status(): JSX.Element {
  const [port, setPort] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    void window.canvasApi?.bridgePort?.().then(setPort).catch(() => setPort(null))
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const ago = lastBridgeRequest ? Math.round((Date.now() - lastBridgeRequest) / 1000) : -1
  const connected = ago >= 0 && ago < 120
  return (
    <div className="insp-status">
      <i style={{ background: connected ? 'var(--agent-teal)' : 'var(--text-4)' }} />
      {connected
        ? `Agent connected — last request ${ago}s ago`
        : `Waiting for an agent… (bridge on ws://127.0.0.1:${port ?? '…'})`}
    </div>
  )
}

export function ConnectAgentModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [agentId, setAgentId] = useState('claude')
  const [manual, setManual] = useState(false)
  const agent = AGENTS.find((a) => a.id === agentId) ?? AGENTS[0]
  const connected = lastBridgeRequest > 0
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect your agent"
      width={700}
      footer={
        <>
          <Button
            variant="ghost"
            style={{ marginRight: 'auto' }}
            onClick={() => window.canvasApi?.openExternal?.('https://modelcontextprotocol.io/')}
          >
            Learn more
          </Button>
          <Button variant="primary" onClick={onClose} style={{ minWidth: 76 }}>
            Done
          </Button>
        </>
      }
    >
      <div className="insp-agent">
        <div className="insp-agent__list">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={['insp-agent__item', a.id === agentId && 'on'].filter(Boolean).join(' ')}
              onClick={() => setAgentId(a.id)}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
        <div className="insp-agent__main">
          <Step done title="Install Vellum" />
          <Step done={connected} title={`Connect to ${agent.id === 'other' ? 'your agent' : agent.label}`}>
            {agent.command ? (
              <div className="insp-card">
                <div style={{ fontWeight: 500 }}>Run this in a terminal to add Vellum to {agent.label}:</div>
                <Code text={agent.command} />
              </div>
            ) : (
              <div className="insp-card">
                <div style={{ fontWeight: 500 }}>{agent.configLabel}</div>
                <Code text={agent.config} />
              </div>
            )}
            {agent.command && (
              <div className="insp-card">
                <button
                  type="button"
                  style={{ display: 'flex', alignItems: 'center', fontWeight: 500, color: 'var(--text)' }}
                  onClick={() => setManual((m) => !m)}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>Or, install manually</span>
                  {manual ? <Minus size={14} /> : <Plus size={14} />}
                </button>
                {manual && (
                  <>
                    <div className="insp-muted">{agent.configLabel}</div>
                    <Code text={agent.config} />
                  </>
                )}
              </div>
            )}
            <Status />
          </Step>
          <Step done={false} title="Run your first prompt">
            <div className="insp-muted">
              Run one of these example prompts in {agent.id === 'other' ? 'your agent' : agent.label} to test the
              connection:
            </div>
            {PROMPTS.map((p) => (
              <PromptChip key={p} text={p} />
            ))}
          </Step>
        </div>
      </div>
    </Modal>
  )
}

function PromptChip({ text }: { text: string }): JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="insp-prompt"
      title="Copy prompt"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {text}
    </button>
  )
}
