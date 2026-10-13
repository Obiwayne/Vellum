// spec.json and spec.schema.json (schema id `vellum.handoff/1`, docs/factory/T58-plan.md section 3.3).
import type { Doc } from '../model/types'
import { REM_BASE } from '../model/devSpec'
import type { Collected } from './collect'
import { SCHEMA_ID, type HandoffOptions, type HandoffSpec } from './types'

/** The document, as the bundle describes it: no thumbnail, comments, timestamps, folder or page data. */
export function buildSpec(doc: Doc, options: HandoffOptions, c: Collected): HandoffSpec {
  return {
    schema: SCHEMA_ID,
    handoff: {
      version: options.version,
      exportedAt: options.exportedAt,
      vellum: options.vellum,
      fileId: doc.id,
      fileName: (options.projectLabel ?? doc.name).trim() || 'Untitled'
    },
    units: { length: 'px', remBase: REM_BASE, precision: options.precision ?? 2 },
    modes: c.modes,
    screens: c.screens,
    components: c.components,
    tokens: c.tokens,
    textStyles: c.textStyles,
    assets: c.assets,
    fonts: c.fonts,
    ...(options.changes ? { changes: options.changes } : {})
  }
}

export const jsonText = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'

// ---------------------------------------------------------------------------------------------
// schema (JSON Schema, draft 2020-12 vocabulary; written by hand and checked against real output in tests)

type S = Record<string, unknown>
const str: S = { type: 'string' }
const num: S = { type: 'number' }
const int: S = { type: 'integer' }
const bool: S = { type: 'boolean' }
const arr = (items: S): S => ({ type: 'array', items })
const ref = (name: string): S => ({ $ref: `#/$defs/${name}` })
const obj = (properties: Record<string, S>, required: string[], extra = false): S => ({
  type: 'object',
  properties,
  required,
  additionalProperties: extra
})
const map = (values: S): S => ({ type: 'object', additionalProperties: values })
const strOrNum: S = { anyOf: [str, num] }

export const SPEC_SCHEMA: S = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_ID,
  title: 'Vellum handoff',
  ...obj(
    {
      schema: { const: SCHEMA_ID },
      handoff: obj(
        { version: int, exportedAt: str, vellum: str, fileId: str, fileName: str },
        ['version', 'exportedAt', 'vellum', 'fileId', 'fileName']
      ),
      units: obj({ length: { const: 'px' }, remBase: num, precision: int }, ['length', 'remBase', 'precision']),
      modes: arr(str),
      screens: arr(ref('Screen')),
      components: arr(ref('Component')),
      tokens: arr(ref('Token')),
      textStyles: arr(ref('TextStyle')),
      assets: arr(ref('Asset')),
      fonts: arr(ref('Font')),
      changes: ref('Changes')
    },
    ['schema', 'handoff', 'units', 'modes', 'screens', 'components', 'tokens', 'textStyles', 'assets', 'fonts']
  ),
  $defs: {
    Changes: obj(
      {
        previous: int,
        screens: arr(obj({ id: str, name: str, status: { enum: ['added', 'removed', 'changed', 'unchanged'] }, nodes: arr(ref('NodeChange')) }, ['id', 'name', 'status', 'nodes'])),
        components: arr(obj({ ref: str, name: str, status: { enum: ['added', 'removed', 'changed', 'unchanged'] }, nodes: arr(ref('NodeChange')) }, ['ref', 'name', 'status', 'nodes'])),
        tokens: arr(obj({ name: str, status: { enum: ['added', 'removed', 'changed'] }, text: str }, ['name', 'status', 'text'])),
        assets: arr(obj({ path: str, status: { enum: ['added', 'removed', 'changed'] } }, ['path', 'status'])),
        rebuild: arr(str),
        counts: obj({ added: int, removed: int, changed: int, unchanged: int }, ['added', 'removed', 'changed', 'unchanged'])
      },
      ['previous', 'screens', 'components', 'tokens', 'assets', 'rebuild', 'counts']
    ),
    NodeChange: obj(
      {
        id: str,
        path: str,
        kind: { enum: ['added', 'removed', 'changed'] },
        changes: arr(obj({ property: str, from: str, to: str }, ['property', 'from', 'to'])),
        descendants: int
      },
      ['id', 'path', 'kind', 'changes']
    ),
    Screen: obj({ id: str, name: str, slug: str, breakpoints: arr(ref('Breakpoint')) }, ['id', 'name', 'slug', 'breakpoints']),
    Delta: obj(
      {
        base: str,
        changes: arr(obj({ path: str, changes: arr(obj({ property: str, from: str, to: str }, ['property', 'from', 'to'])) }, ['path', 'changes'])),
        onlyHere: arr(str),
        notHere: arr(str),
        hiddenHere: arr(str),
        ambiguous: arr(str)
      },
      ['base', 'changes', 'onlyHere', 'notHere', 'hiddenHere', 'ambiguous']
    ),
    Breakpoint: obj(
      { bp: str, frameId: str, width: num, height: num, ready: obj({ at: int }, ['at']), png: str, delta: ref('Delta'), root: ref('Node') },
      ['bp', 'frameId', 'png', 'root']
    ),
    Component: obj(
      {
        ref: str,
        name: str,
        slug: str,
        isSet: bool,
        props: arr(ref('PropDef')),
        variants: arr(obj({ ref: str, name: str, values: map(str), root: ref('Node') }, ['ref', 'name', 'values', 'root'])),
        usedBy: arr(str),
        notes: arr(str),
        states: arr(obj({ state: str, badge: { enum: ['drawn', 'described', 'missing'] }, target: str, changes: arr(str) }, ['state', 'badge'])),
        interactive: bool
      },
      ['ref', 'name', 'slug', 'isSet', 'props', 'variants', 'usedBy', 'notes', 'states', 'interactive']
    ),
    PropDef: obj(
      { id: str, name: str, type: { enum: ['variant', 'boolean', 'text', 'swap'] }, default: { anyOf: [str, bool] }, options: arr(str) },
      ['id', 'name', 'type', 'default']
    ),
    Token: obj(
      {
        name: str,
        type: { enum: ['color', 'length', 'number', 'other'] },
        values: map(obj({ value: str, hex8: str }, ['value']))
      },
      ['name', 'type', 'values']
    ),
    TextStyle: obj({ id: str, name: str, style: map(strOrNum) }, ['id', 'name', 'style']),
    Asset: obj(
      {
        id: str,
        path: str,
        kind: { enum: ['image', 'icon', 'png'] },
        nodeIds: arr(str),
        layerName: str,
        mime: str,
        bytes: int,
        width: int,
        height: int,
        maxDensity: num,
        variants: arr(obj({ path: str, density: num, width: int, height: int }, ['path', 'density', 'width', 'height'])),
        source: { enum: ['data', 'external'] },
        url: str,
        sha256: str,
        recoloured: bool,
        was: str,
        multiColour: bool,
        animated: bool,
        missing: bool
      },
      ['id', 'path', 'kind', 'nodeIds']
    ),
    Font: obj(
      {
        family: str,
        weights: arr(strOrNum),
        italic: bool,
        source: { enum: ['google', 'local', 'system', 'unknown'] },
        stack: str,
        usedBy: int
      },
      ['family', 'weights', 'italic', 'source', 'stack', 'usedBy']
    ),
    Color: obj(
      { value: str, hex8: { anyOf: [str, { type: 'null' }] }, opacity: num, oklch: str, token: str },
      ['value', 'hex8', 'opacity']
    ),
    Paint: obj(
      {
        kind: { enum: ['fill', 'stroke', 'text'] },
        type: { enum: ['solid', 'gradient', 'image'] },
        color: ref('Color'),
        value: str,
        width: { anyOf: [num, arr(num)] },
        style: str
      },
      ['kind', 'type']
    ),
    Effect: obj(
      {
        kind: { enum: ['shadow', 'inner-shadow', 'blur', 'backdrop-blur'] },
        x: num,
        y: num,
        blur: num,
        spread: num,
        color: ref('Color')
      },
      ['kind', 'blur']
    ),
    Text: obj(
      {
        content: str,
        fontFamily: str,
        fontSize: num,
        fontWeight: strOrNum,
        fontStyle: str,
        lineHeightPx: { anyOf: [num, { type: 'null' }] },
        lineHeightRatio: { anyOf: [num, { type: 'null' }] },
        lineHeightSource: { enum: ['authored', 'measured', 'estimated', 'unknown'] },
        letterSpacingPx: num,
        letterSpacingEm: num,
        textAlign: str,
        textTransform: str,
        textDecoration: str,
        textStyle: str
      },
      ['content', 'fontSize', 'fontWeight', 'lineHeightPx', 'lineHeightRatio', 'lineHeightSource', 'letterSpacingPx', 'letterSpacingEm']
    ),
    SizeRule: {
      type: 'object',
      properties: {
        mode: { enum: ['fixed', 'fit', 'fill', 'percent'] },
        value: num,
        weight: num,
        min: num,
        max: num,
        aspect: num
      },
      required: ['mode']
    },
    Node: obj(
      {
        id: str,
        name: str,
        type: { enum: ['frame', 'rect', 'text', 'image', 'svg'] },
        tag: str,
        box: obj(
          { x: num, y: num, width: num, height: num, relTo: { enum: ['parent', 'artboard'] }, measured: bool },
          ['relTo', 'measured']
        ),
        artboardBox: obj({ x: num, y: num }, ['x', 'y']),
        flowIndex: int,
        sizing: obj({ w: ref('SizeRule'), h: ref('SizeRule') }, ['w', 'h']),
        layout: { type: 'object', required: ['kind', 'padding', 'summary'] },
        style: obj({ authored: map(strOrNum), resolved: map(str) }, ['authored', 'resolved']),
        rotation: num,
        opacity: num,
        radius: { anyOf: [num, str, arr(num)] },
        text: ref('Text'),
        paints: arr(ref('Paint')),
        effects: arr(ref('Effect')),
        tokens: arr(str),
        component: obj(
          { ref: str, name: str, variant: map(str), props: map({ anyOf: [str, bool] }), overrides: arr(str) },
          ['ref']
        ),
        image: obj({ alt: str, objectFit: str }, []),
        notes: arr(str),
        a11y: obj({ role: str, label: str, tab: int }, []),
        contrast: arr(obj({ mode: str, ratio: num, fg: str, bg: str, large: bool, aa: bool, aaa: bool }, ['mode', 'ratio', 'fg', 'bg', 'large', 'aa', 'aaa'])),
        contrastNote: str,
        states: map({ type: 'object' }),
        needsDecision: str,
        children: arr(ref('Node'))
      },
      ['id', 'name', 'type', 'box', 'sizing', 'layout', 'style', 'paints', 'effects', 'tokens', 'children']
    )
  }
}
