# Inspector (right panel, 280px)

Code: `src/renderer/src/editor/inspector/`. Every edit goes through store actions (`updateStyles`, `mutate`, `addFlex`, `wrapInFlex`, `removeFlex`, `setPageBackground`). Scrubs, sliders, colour drags and gradient-stop drags pass `{coalesce: 'insp:<control>:<ids>'}`, so a single drag is one undo step.

| File | Contents |
|---|---|
| `Inspector.tsx` | Picks sections: page (nothing selected), text (all selected nodes are text), or frame/rect/image/svg |
| `TopBar.tsx` | Avatar (initial of `prefs.userName`, default "V"), zoom menu, Share popover (Export `.vellum` JSON / Copy HTML) |
| `ConnectAgentModal.tsx` | "Connect your agent": agent list, commands and config snippets, bridge status, example prompts |
| `LayoutSection.tsx` | X/Y/rotation, W/H with Fixed/Fit/Fill, rotate/flip, Add flex / Wrap in flex, Absolute position, Clip content, size presets (`SIZE_PRESETS`) |
| `FlexSection.tsx` | 3×3 align grid, direction, wrap, gap, spacing menu, padding H/V or per side, remove |
| `BasicSections.tsx` | Radius (uniform or per corner), Blending (opacity, `mixBlendMode`, eye toggles `node.visible`) |
| `FillSection.tsx` + `fills.ts` | Stacked fills: solid, linear/radial gradient, image |
| `EffectSections.tsx` | Outline, Border (All or one side), Shadow / Inner shadow, Filters, Guides/Video placeholders, Export |
| `TextSection.tsx` + `fonts.ts` | Font picker, weight, size, line height, letter spacing, align, vertical align, Formatting popover, Underline, Stroke |
| `exporting.ts` | PNG, SVG and HTML export |
| `common.ts` | Mixed-value helper (`common`/`MIXED`), selection ctx, CSS parsers |

## CSS mapping
- **Fills:** the bottom solid fill goes to `backgroundColor`. Every other fill layer goes to `backgroundImage`, and a stacked solid becomes `linear-gradient(c, c)`. Image fills also set `backgroundSize`, `backgroundPosition: center` and `backgroundRepeat: no-repeat`. For text, the fill is `color`.
- **Fill eye toggle:** hiding a fill removes it from the CSS. It is remembered only for this session.
- **Rotation and flips:** rotation is the CSS `rotate: 'Ndeg'` property. Flips are `scale: '-1 1'`.
- **Radius and padding:** both are written as shorthands. Any longhands are removed.
- **Outline:** `outlineStyle`, `outlineWidth`, `outlineOffset`, `outlineColor`.
- **Border:** `border{,Top,Right,Bottom,Left}{Width,Style,Color}`. Hiding a border or outline sets its style to `none`.
- **Shadows:** `boxShadow` holds both shadow and inset shadow. Text uses `textShadow`.
- **Filters:** `filter`.
- **Text weight, line height and letter spacing:** `fontWeight` is a number (100–900). Line height is written in px, and "Auto" means `normal`. Letter spacing is shown as a % and written as em.
- **Text vertical align:** `display:flex; flexDirection:column; justifyContent`.
- **Formatting popover:**
  - Case: `textTransform`.
  - Wrap: "No wrap" is `whiteSpace:'pre'`; "Balance" and "Pretty" set `textWrap`.
  - Keep words: `wordBreak:'keep-all'`.
  - Truncation: `textOverflow: ellipsis` plus `-webkit-box` line clamp.
- **Underline:** `textDecorationLine`, `textDecorationThickness`, `textUnderlineOffset`, `textDecorationColor`.
- **Stroke:** `WebkitTextStrokeWidth` and `WebkitTextStrokeColor`, with `paintOrder: 'stroke fill'`.

## Notes
- **Fonts:** the font list uses `queryLocalFonts()`. If that is unavailable, it falls back to a curated list of Windows fonts. Google Fonts are fetched and registered through the `FontFace` API, because the renderer CSP blocks remote stylesheets. Loading happens when a font is picked, when it scrolls into view in the picker, and when a selected text uses it. Vellum content that uses a Google font on a fresh start only renders correctly after something loads the font. The canvas could call `loadGoogleFont` for the families in the doc.
- **Zoom menu:** it calls `editor/canvas/camera.ts`. Its toggles are stored as the prefs `canvas.*`, such as `canvas.pixelGrid`, `canvas.snapToPixel`, `canvas.invertZoom`, `canvas.scrollWheelZooms` and `canvas.layoutGuides`.
- **Export:** PNG uses `canvasApi.capturePage` on the node's rect on screen, then resamples it to 1x, 2x or 3x. Only the visible part is captured. TODO: switch to an offscreen or bridge export when one exists. SVG is HTML inside a `<foreignObject>`. HTML is a standalone document that includes the tokens. Export rows are held for the session only.
- **Connect modal status:** the status line counts any bridge request seen by the renderer as "connected".
- **Keyboard shortcuts:** Shift+A and Alt+C are shown as labels only. The shortcuts themselves belong to `editor/shortcuts.ts`.
