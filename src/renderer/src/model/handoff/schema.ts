// JSON Schema (draft 2020-12) of spec.json, `vellum.handoff/1`. Written by hand next to the types so a reader
// without Vellum can validate a bundle; a test fails when a field of NodeSpec or Handoff is missing here
// (every object below is closed with additionalProperties:false).
import { SCHEMA_ID } from './types'

type S = Record<string, unknown>

const str: S = { type: 'string' }
const num: S = { type: 'number' }
const int: S = { type: 'integer' }
const bool: S = { type: 'boolean' }
const arr = (items: S): S => ({ type: 'array', items })
const ref = (name: string): S => ({ $ref: `#/$defs/${name}` })
const obj = (properties: Record<string, S>, required: string[] = []): S => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})
const map = (values: S): S => ({ type: 'object', additionalProperties: values })
const enm = (...v: string[]): S => ({ enum: v })
const nullable = (s: S): S => ({ anyOf: [s, { type: 'null' }] })
const strOrNum: S = { type: ['string', 'number'] }

const sizeRule: S = {
  type: 'object',
  properties: {
    mode: enm('fixed', 'fit', 'fill', 'percent'),
    value: num,
    weight: num,
    min: num,
    max: num,
    aspect: num
  },
  required: ['mode'],
  additionalProperties: false
}

const color: S = obj(
  { value: str, hex8: nullable(str), opacity: num, oklch: str, token: str },
  ['value', 'hex8', 'opacity']
)

const tokenValue = obj({ value: str, hex8: str }, ['value'])
const tokenUse = obj({ name: str, type: enm('color', 'length', 'number', 'other'), values: map(tokenValue) }, ['name', 'type', 'values'])

const node: S = obj(
  {
    id: str,
    name: str,
    type: enm('frame', 'rect', 'text', 'image', 'svg'),
    tag: str,
    box: obj({ x: num, y: num, width: num, height: num, relTo: enm('parent', 'artboard'), measured: bool }, ['width', 'height', 'relTo', 'measured']),
    artboardBox: obj({ x: num, y: num }, ['x', 'y']),
    flowIndex: int,
    sizing: obj({ w: ref('sizeRule'), h: ref('sizeRule') }, ['w', 'h']),
    layout: ref('layout'),
    style: obj({ authored: map({ type: ['string', 'number'] }), resolved: map(str) }, ['authored', 'resolved']),
    rotation: num,
    opacity: num,
    radius: { anyOf: [num, str, { type: 'array', items: num, minItems: 4, maxItems: 4 }] },
    text: ref('text'),
    paints: arr(ref('paint')),
    effects: arr(ref('effect')),
    tokens: arr(tokenUse),
    component: obj(
      { ref: str, name: str, variant: map(str), props: map({ type: ['string', 'boolean'] }), overrides: arr(str) },
      ['ref']
    ),
    image: obj({ alt: str, objectFit: str }),
    notes: arr(str),
    a11y: obj({ role: str, label: str, tab: int, alt: str }),
    states: map({ type: 'object', additionalProperties: { type: ['string', 'number', 'null'] } }),
    needsDecision: str,
    assets: arr(str),
    children: arr(ref('node'))
  },
  ['id', 'name', 'type', 'box', 'sizing', 'layout', 'style', 'paints', 'effects', 'tokens', 'children']
)

const defs: Record<string, S> = {
  sizeRule,
  layout: obj(
    {
      kind: enm('flex', 'grid', 'block', 'positioned'),
      direction: enm('row', 'column'),
      wrap: bool,
      gap: num,
      rowGap: num,
      columnGap: num,
      align: str,
      justify: str,
      padding: { type: 'array', items: num, minItems: 4, maxItems: 4 },
      columns: str,
      rows: str,
      autoFlow: str,
      cell: obj({ column: str, row: str, align: str }),
      constraints: obj(
        { h: enm('left', 'right', 'left-right', 'center', 'scale'), v: enm('top', 'bottom', 'top-bottom', 'center', 'scale') },
        ['h', 'v']
      ),
      offsets: obj({ left: num, right: num, top: num, bottom: num }),
      centerOffset: obj({ x: num, y: num }),
      position: enm('absolute', 'fixed', 'relative'),
      zIndex: num,
      overflow: enm('visible', 'clip', 'scroll'),
      summary: str
    },
    ['kind', 'padding', 'summary']
  ),
  text: obj(
    {
      content: str,
      fontFamily: str,
      fontSize: num,
      fontWeight: strOrNum,
      fontStyle: str,
      lineHeightPx: nullable(num),
      lineHeightRatio: nullable(num),
      lineHeightSource: enm('authored', 'measured', 'estimated', 'unknown'),
      letterSpacingPx: num,
      letterSpacingEm: num,
      textAlign: str,
      textTransform: str,
      textDecoration: str,
      textStyle: str
    },
    ['content', 'fontSize', 'fontWeight', 'lineHeightPx', 'lineHeightRatio', 'lineHeightSource', 'letterSpacingPx', 'letterSpacingEm']
  ),
  paint: obj(
    {
      kind: enm('fill', 'stroke', 'text'),
      type: enm('solid', 'gradient', 'image'),
      color,
      value: str,
      width: { anyOf: [num, { type: 'array', items: num, minItems: 4, maxItems: 4 }] },
      style: str
    },
    ['kind', 'type']
  ),
  effect: obj(
    { kind: enm('shadow', 'inner-shadow', 'blur', 'backdrop-blur'), x: num, y: num, blur: num, spread: num, color },
    ['kind', 'blur']
  ),
  node,
  breakpoint: obj(
    { name: str, width: num, height: num, frameId: str, png: str, root: ref('node') },
    ['name', 'width', 'height', 'frameId', 'png', 'root']
  ),
  screen: obj(
    { id: str, name: str, slug: str, doc: str, ready: obj({ at: int }, ['at']), breakpoints: arr(ref('breakpoint')) },
    ['id', 'name', 'slug', 'doc', 'breakpoints']
  ),
  propDef: obj(
    { id: str, name: str, type: enm('variant', 'boolean', 'text', 'swap'), default: { type: ['string', 'boolean'] }, options: arr(str) },
    ['id', 'name', 'type', 'default']
  ),
  component: obj(
    {
      id: str,
      name: str,
      slug: str,
      doc: str,
      set: bool,
      props: arr(ref('propDef')),
      variants: arr(obj({ id: str, name: str, values: map(str), root: ref('node') }, ['id', 'name', 'values', 'root'])),
      usedBy: arr(str)
    },
    ['id', 'name', 'slug', 'doc', 'set', 'props', 'variants', 'usedBy']
  ),
  token: obj({ name: str, type: enm('color', 'length', 'number', 'other'), values: map(tokenValue), usage: int }, ['name', 'type', 'values', 'usage']),
  textStyle: obj({ id: str, name: str, style: map({ type: ['string', 'number'] }) }, ['id', 'name', 'style']),
  font: obj(
    { family: str, css: str, weights: arr(strOrNum), italic: bool, source: enm('google', 'local', 'system'), usedBy: int },
    ['family', 'css', 'weights', 'italic', 'source', 'usedBy']
  ),
  asset: obj(
    { id: str, path: str, kind: enm('image', 'icon'), nodeIds: arr(str), bytes: int, sha256: str },
    ['id', 'path', 'kind', 'nodeIds']
  )
}

export const SPEC_SCHEMA: S = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vellum.app/schemas/handoff-1.json',
  title: 'Vellum handoff spec',
  ...obj(
    {
      schema: { const: SCHEMA_ID },
      handoff: obj({ version: int, exportedAt: str, vellum: str, fileId: str, fileName: str }, ['version', 'exportedAt', 'vellum', 'fileId', 'fileName']),
      units: obj({ length: { const: 'px' }, remBase: num, precision: int }, ['length', 'remBase', 'precision']),
      modes: arr(str),
      screens: arr(ref('screen')),
      components: arr(ref('component')),
      tokens: arr(ref('token')),
      textStyles: arr(ref('textStyle')),
      fonts: arr(ref('font')),
      assets: arr(ref('asset'))
    },
    ['schema', 'handoff', 'units', 'modes', 'screens', 'components', 'tokens', 'textStyles', 'fonts', 'assets']
  ),
  $defs: defs
}
