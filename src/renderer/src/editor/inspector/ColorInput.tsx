import { useState, type ReactNode } from 'react'
import { ColorRow, Popover, parseColor, tokenRef } from '../../ui'
import { useStore } from '../../model/store'
import type { Token } from '../../model/types'

export function resolveTokenValue(tokens: Token[], name: string, depth = 0): string | undefined {
  const t = tokens.find((x) => x.name === name)
  if (!t) return undefined
  const ref = tokenRef(t.value)
  if (ref && depth < 8) return resolveTokenValue(tokens, ref, depth + 1)
  return t.value
}

/** ColorRow wired to the doc's colour tokens (token picker popover sets `var(--token)`). */
export function ColorInput({
  docId,
  value,
  onChange,
  trailing,
  showEyedropper = true,
  showToken = true
}: {
  docId: string
  value: string
  onChange: (color: string, opts: { live: boolean }) => void
  trailing?: ReactNode
  showEyedropper?: boolean
  showToken?: boolean
}): JSX.Element {
  const tokens = useStore((s) => s.docs[docId]?.tokens ?? [])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [q, setQ] = useState('')
  const colorTokens = tokens.filter((t) => parseColor(resolveTokenValue(tokens, t.name) ?? ''))
  const current = tokenRef(value)
  const shown = colorTokens.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <ColorRow
        value={value}
        onChange={onChange}
        showToken={showToken}
        showEyedropper={showEyedropper}
        resolveToken={(n) => resolveTokenValue(tokens, n)}
        onTokenClick={(el) => setAnchor((a) => (a ? null : el))}
        trailing={trailing}
      />
      <Popover open={Boolean(anchor)} onClose={() => setAnchor(null)} anchor={anchor} placement="left-start" offset={12}>
        <div className="insp-pop">
          <div className="insp-pop__head">Color tokens</div>
          {colorTokens.length > 8 && (
            <div className="c-field c-field--sm" style={{ marginBottom: 4 }}>
              <input
                className="c-field__input"
                placeholder="Search tokens"
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="insp-pop__list">
            {current && (
              <button
                type="button"
                className="insp-listitem insp-muted"
                onClick={() => {
                  onChange(resolveTokenValue(tokens, current) ?? '#000000', { live: false })
                  setAnchor(null)
                }}
              >
                Detach token
              </button>
            )}
            {shown.map((t) => (
              <button
                key={t.name}
                type="button"
                className={['insp-listitem', current === t.name && 'on'].filter(Boolean).join(' ')}
                onClick={() => {
                  onChange(`var(${t.name})`, { live: false })
                  setAnchor(null)
                }}
              >
                <span className="c-swatch">
                  <span style={{ background: resolveTokenValue(tokens, t.name) ?? 'transparent' }} />
                </span>
                {t.name.replace(/^--/, '')}
              </button>
            ))}
            {!colorTokens.length && (
              <div className="insp-muted" style={{ padding: '8px' }}>
                No colour tokens yet. Add them in the Theme tab.
              </div>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
