import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { ColorRow, Popover, formatColor, parseColor, tokenRef } from '../../ui'
import { getStore, useStore } from '../../model/store'
import type { Doc, Token } from '../../model/types'
import { effectiveMode, tokenValueIn } from '../../model/modes'
import { normalizeName } from '../left/tokenUtils'

export function resolveTokenValue(tokens: Token[], name: string, depth = 0): string | undefined {
  const t = tokens.find((x) => x.name === name)
  if (!t) return undefined
  const ref = tokenRef(t.value)
  if (ref && depth < 8) return resolveTokenValue(tokens, ref, depth + 1)
  return t.value
}

/** Like resolveTokenValue, but with each token's value in a theme mode (null = base). */
export function resolveTokenInMode(doc: Doc, name: string, mode: string | null, depth = 0): string | undefined {
  const t = doc.tokens.find((x) => x.name === name)
  if (!t) return undefined
  const v = tokenValueIn(doc, t, mode)
  const ref = tokenRef(v)
  if (ref && depth < 8) return resolveTokenInMode(doc, ref, mode, depth + 1)
  return v
}

/** Colour styles (`--color-*` tokens) before other colour tokens; each keeps its order. */
export function colourStylesFirst(tokens: Token[]): Token[] {
  const isStyle = (t: Token): boolean => t.name.startsWith('--color-')
  return [...tokens.filter(isStyle), ...tokens.filter((t) => !isStyle(t))]
}

/** First free `--color-<n>` name. */
export function nextColorTokenName(tokens: Token[]): string {
  const names = new Set(tokens.map((t) => t.name))
  let i = 1
  while (names.has(`--color-${i}`)) i++
  return `--color-${i}`
}

/**
 * Turn a literal colour into a new colour token and point the field at it, as one undo step.
 * `apply` writes `var(--name)` wherever the colour came from. Returns an error message, or null.
 */
export function addColorToken(docId: string, rawName: string, color: string, apply: (ref: string) => void): string | null {
  const s = getStore()
  const tokens = s.docs[docId]?.tokens ?? []
  const name = normalizeName(rawName)
  const c = parseColor(color)
  if (!/^--[\w-]+$/.test(name)) return 'Invalid name'
  if (tokens.some((t) => t.name === name)) return 'Name already used'
  if (!c) return 'Not a colour'
  // base value only: in files with theme modes every mode starts on the same colour
  s.transact(docId, 'Add colour token', () => {
    // an oklch()/oklab() literal is kept as written: converting it to hex would silently change the colour
    const literal = color.trim()
    s.upsertTokens(docId, [{ name, value: /^okl(?:ch|ab)\(/i.test(literal) ? literal : formatColor(c) }])
    apply(`var(${name})`)
  })
  return null
}

/** ColorRow wired to the doc's colour tokens (token picker popover sets `var(--token)`, or makes one). */
export function ColorInput({
  docId,
  nodeId,
  value,
  onChange,
  trailing,
  showEyedropper = true,
  showToken = true
}: {
  docId: string
  /** layer the colour belongs to: "Detach" writes the colour in the theme mode in effect there */
  nodeId?: string
  value: string
  onChange: (color: string, opts: { live: boolean }) => void
  trailing?: ReactNode
  showEyedropper?: boolean
  showToken?: boolean
}): JSX.Element {
  const tokens = useStore((s) => s.docs[docId]?.tokens ?? [])
  const doc = useStore((s) => s.docs[docId])
  const mode = doc && nodeId ? effectiveMode(doc, nodeId) : null
  const valueOf = (name: string): string | undefined => (doc && mode ? resolveTokenInMode(doc, name, mode) : resolveTokenValue(tokens, name))
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [q, setQ] = useState('')
  /** draft name while creating a token from the literal colour (null = not naming) */
  const [naming, setNaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const colorTokens = colourStylesFirst(tokens.filter((t) => parseColor(resolveTokenValue(tokens, t.name) ?? '')))
  const current = tokenRef(value)
  const shown = colorTokens.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
  const canAdd = !current && Boolean(parseColor(value))
  const close = (): void => {
    setAnchor(null)
    setNaming(null)
    setError(null)
  }
  const create = (): void => {
    if (naming === null) return
    const err = addColorToken(docId, naming, value, (ref) => onChange(ref, { live: false }))
    if (err) setError(err)
    else close()
  }
  return (
    <>
      <ColorRow
        value={value}
        onChange={onChange}
        showToken={showToken}
        showEyedropper={showEyedropper}
        resolveToken={valueOf}
        onTokenClick={(el) => (anchor ? close() : setAnchor(el))}
        trailing={trailing}
      />
      <Popover open={Boolean(anchor)} onClose={close} anchor={anchor} placement="left-start" offset={12}>
        <div className="insp-pop">
          <div className="insp-pop__head">Colour styles</div>
          {canAdd &&
            (naming === null ? (
              <button type="button" className="insp-listitem" onClick={() => setNaming(nextColorTokenName(tokens))}>
                <Plus size={14} />
                Add as colour style
              </button>
            ) : (
              <div className="insp-newtoken">
                <div className={['c-field c-field--sm', error && 'insp-invalid'].filter(Boolean).join(' ')}>
                  <input
                    className="c-field__input c-field__input--mono"
                    value={naming}
                    autoFocus
                    spellCheck={false}
                    title={error ?? 'Token name'}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      setNaming(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') create()
                      if (e.key === 'Escape') setNaming(null)
                    }}
                  />
                </div>
                <button type="button" className="insp-newtoken__ok" onClick={create}>
                  Add
                </button>
              </div>
            ))}
          {error && <div className="insp-newtoken__error">{error}</div>}
          {colorTokens.length > 8 && (
            <div className="c-field c-field--sm" style={{ marginBottom: 4 }}>
              <input
                className="c-field__input"
                placeholder="Search styles"
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
                  // a circular alias still resolves to a var() reference: detach to black, never write a var() string
                  const literal = valueOf(current)
                  onChange(!literal || /^\s*var\(/.test(literal) ? '#000000' : literal, { live: false })
                  close()
                }}
              >
                Detach style
              </button>
            )}
            {shown.map((t) => (
              <button
                key={t.name}
                type="button"
                className={['insp-listitem', current === t.name && 'on'].filter(Boolean).join(' ')}
                onClick={() => {
                  onChange(`var(${t.name})`, { live: false })
                  close()
                }}
              >
                <span className="c-swatch">
                  <span style={{ background: valueOf(t.name) ?? 'transparent' }} />
                </span>
                {t.name.replace(/^--/, '')}
              </button>
            ))}
            {!colorTokens.length && (
              <div className="insp-muted" style={{ padding: '8px' }}>
                No colour styles yet. Add this colour as one, or add them in the Theme tab.
              </div>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
