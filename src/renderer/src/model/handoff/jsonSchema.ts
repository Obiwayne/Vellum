// A small JSON Schema checker for tests: only the keywords spec.schema.json uses (type, enum, const, properties,
// required, additionalProperties, items, minItems, maxItems, anyOf, $ref into #/$defs). No dependency; used to
// prove that spec.json validates against spec.schema.json without shipping a validator.
type S = Record<string, unknown>

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

/** Errors as `path: message`; empty when valid. */
export function validate(schema: S, value: unknown, root: S = schema, path = '$'): string[] {
  const errs: string[] = []
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/$defs/', '')
    const target = (root.$defs as Record<string, S> | undefined)?.[name]
    return target ? validate(target, value, root, path) : [`${path}: unknown $ref ${schema.$ref}`]
  }
  if (Array.isArray(schema.anyOf)) {
    const all = (schema.anyOf as S[]).map((s) => validate(s, value, root, path))
    return all.some((e) => e.length === 0) ? [] : [`${path}: matches none of anyOf (${all.map((e) => e[0]).join(' | ')})`]
  }
  if ('const' in schema && schema.const !== value) errs.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`)
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
  if (types) {
    const t = typeOf(value)
    const ok = types.some((x) => x === t || (x === 'number' && t === 'integer'))
    if (!ok) return [...errs, `${path}: expected ${types.join('|')}, got ${t}`]
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errs.push(`${path}: too few items`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errs.push(`${path}: too many items`)
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items as S, v, root, `${path}[${i}]`)))
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const props = (schema.properties as Record<string, S> | undefined) ?? {}
    for (const r of (schema.required as string[] | undefined) ?? []) if (!(r in o) || o[r] === undefined) errs.push(`${path}: missing ${r}`)
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue
      if (k in props) errs.push(...validate(props[k], v, root, `${path}.${k}`))
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property ${k}`)
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties as S, v, root, `${path}.${k}`))
    }
  }
  return errs
}
