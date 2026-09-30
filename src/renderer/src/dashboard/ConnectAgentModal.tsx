import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, Modal } from '../ui'

export const MCP_COMMAND = 'claude mcp add vellum -- node F:/Vellum/mcp/dist/index.js'

const PROMPTS = [
  'Create a basic Hello World frame in Vellum',
  'Create 3 color tokens and make a swatch in Vellum',
  'Design a pricing card with three tiers in Vellum'
]

export function CopyLine({ text, mono = true }: { text: string; mono?: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={['db-copyline', mono && 'db-copyline--mono'].filter(Boolean).join(' ')}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title="Copy"
    >
      <span className="db-copyline__text">{text}</span>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

/** How to connect Claude Code to the Vellum MCP server. */
export function ConnectAgentBody(): JSX.Element {
  return (
    <div className="db-connect">
      <div className="db-connect__step">
        <span className="db-connect__num">1</span>
        <div>
          <div className="db-connect__title">Keep Vellum open</div>
          <div className="db-connect__text">The MCP server talks to this app over a local WebSocket (ws://127.0.0.1:29170).</div>
        </div>
      </div>
      <div className="db-connect__step">
        <span className="db-connect__num">2</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="db-connect__title">Add Vellum to Claude Code</div>
          <div className="db-connect__text">Run this once in a terminal:</div>
          <CopyLine text={MCP_COMMAND} />
        </div>
      </div>
      <div className="db-connect__step">
        <span className="db-connect__num">3</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="db-connect__title">Run your first prompt</div>
          <div className="db-connect__text">Try one of these in Claude to test the connection:</div>
          {PROMPTS.map((p) => (
            <CopyLine key={p} text={p} mono={false} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ConnectAgentModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect your agent"
      width={560}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ConnectAgentBody />
    </Modal>
  )
}
