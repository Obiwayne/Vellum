# Inspector (right panel, 280px)

Code: `src/renderer/src/editor/inspector/`. Every edit goes through store actions (`updateStyles`, `mutate`, `addFlex`, `wrapInFlex`, `removeFlex`, `setPageBackground`). Scrubs, sliders, colour drags and gradient-stop drags pass `{coalesce: 'insp:<control>:<ids>'}`, so a single drag is one undo step.

| File | Contents |
|---|---|
| `Inspector.tsx` | Picks sections: page (nothing selected), text (all selected nodes are text), or frame/rect/image/svg |
| `TopBar.tsx` | Avatar (the open profile's picture, or its initial on the profile colour), zoom menu, Share popover (Export `.vellum` JSON / Copy HTML) |
| `ConnectAgentModal.tsx` | "Connect your agent": agent list, commands and config snippets, bridge status, example prompts |
| `LayoutSection.tsx` | X/Y/rotation, W/H with Fixed/Fit/Fill, rotate/flip, Add flex / Wrap in flex, Absolute position, Clip content, size presets (`SIZE_PRESETS`) |
| `FlexSection.tsx` | 3×3 align grid, direction, wrap, gap, spacing menu, padding H/V or per side (`PaddingFields`, shared with Grid), remove, switch to grid |
| `GridSection.tsx` | Grid: columns/rows (a number = equal `minmax(0, 1fr)` tracks, or any template text), column/row gap, align in cell (`alignItems`/`justifyItems`), padding, fill columns first / dense (`gridAutoFlow`), clip, switch to flex. Grid item: column/row span (`gridColumn`/`gridRow: span N`) |
| `ConstraintsSection.tsx` | Constraints for positioned children of a frame: horizontal Left / Right / Left & right / Center / Scale, vertical Top / Bottom / Top & bottom / Center / Scale (`ops.setConstraint`, CSS in docs/CANVAS.md). W/H show a number for stretched/scaled sizes; Fixed/Fit/Fill drop that axis back to Left/Top |
| `ModeSection.tsx` | Theme mode for frames (`attrs['data-mode']`), shown when the file has theme modes |
| `BasicSections.tsx` | Radius (uniform or per corner), Blending (opacity, `mixBlendMode`, eye toggles `node.visible`), Image (Reset crop: removes `objectViewBox`/`objectPosition`, height back to the image's aspect) |
| `FillSection.tsx` + `fills.ts` | Stacked fills: solid, linear/radial gradient, image. The crosshair button on a gradient ("Edit on canvas") shows its handles on the canvas (see CANVAS.md) |
| `EffectSections.tsx` | Outline, Border (All or one side), Shadow / Inner shadow, Filters (slider + field per filter, presets in the + menu), Background blur (`backdropFilter`: blur + saturate), Guides/Video placeholders, Export |
| `SelectionColorsSection.tsx` + `colors.ts` | Selection colors: every distinct colour in the selection and its descendants (styles, gradients, shadows, borders, SVG `fill`/`stroke`/`stop-color`, `var(--token)` refs) with a use count; editing a row replaces it everywhere in one undo step |
| `OtherStylesSection.tsx` | Other styles: `property: value` rows for every style key no other section edits (`handledStyleKeys`), add (+ with a name field) / edit / remove |
| `TextSection.tsx` + `fonts.ts` | Font picker, weight, size, line height, letter spacing, align, vertical align, variable axes, Type details popover (OpenType features, add axis), Formatting popover, Underline, Stroke |
| `reorder.tsx` | Drag to reorder (grip per row) for Fill, Shadow, Inner shadow and Filters. A drop is one commit, so one undo step |
| `exporting.ts` | PNG, JPG, WebP, SVG, PDF and HTML export; the all-artboards PDF |
| `common.ts` | Mixed-value helper (`common`/`MIXED`), selection ctx, CSS parsers |

## CSS mapping
- **Fills:** the bottom solid fill goes to `backgroundColor`. Every other fill layer goes to `backgroundImage`, and a stacked solid becomes `linear-gradient(c, c)`. Image fills also set `backgroundSize`, `backgroundPosition: center` and `backgroundRepeat: no-repeat`. For text, the fill is `color`.
- **Radial gradients:** the shape/size and `at` position are kept as written (`radial-gradient(at 20% 25%, …)` stays that way). A new radial gradient is `radial-gradient(circle, …)`.
- **Fill eye toggle:** hiding a fill removes it from the CSS. It is remembered only for this session.
- **Rotation and flips:** rotation is the CSS `rotate: 'Ndeg'` property. Flips are `scale: '-1 1'`.
- **Radius and padding:** both are written as shorthands. Any longhands are removed.
- **Outline:** `outlineStyle`, `outlineWidth`, `outlineOffset`, `outlineColor`.
- **Border:** `border{,Top,Right,Bottom,Left}{Width,Style,Color}`. Hiding a border or outline sets its style to `none`.
- **Shadows:** `boxShadow` holds both shadow and inset shadow. Text uses `textShadow`.
- **Filters:** `filter`. Presets write ordinary filter lists. **Background blur:** `backdropFilter: blur(Npx) saturate(N%)` on frames and rectangles.
- **Grid:** `display:grid` + `gridTemplateColumns`/`gridTemplateRows`, `gap` (or `rowGap`/`columnGap` when they differ). "Add grid" (Layout section) makes two equal columns; children without a width get `width:100%`. Removing grid/flex also removes children's `gridColumn`/`gridRow`.
- **Text weight, line height and letter spacing:** `fontWeight` is a number (100–900). Line height is written in px, and "Auto" means `normal`. Letter spacing is shown as a % and written as em.
- **Text vertical align:** `display:flex; flexDirection:column; justifyContent`.
- **Formatting popover:**
  - Case: `textTransform`.
  - Wrap: "No wrap" is `whiteSpace:'pre'`; "Balance" and "Pretty" set `textWrap`.
  - Keep words: `wordBreak:'keep-all'`.
  - Truncation: `textOverflow: ellipsis` plus `-webkit-box` line clamp.
- **Type details popover (OpenType):**
  - Figures (lining/oldstyle), figure spacing (proportional/tabular), slashed zero and fractions share one `fontVariantNumeric`. Each control swaps only its own keyword, e.g. `oldstyle-nums tabular-nums slashed-zero`.
  - Ligatures off is `fontVariantLigatures: none`. Capitals is `fontVariantCaps` (small caps, all small caps).
  - Features is free text for `fontFeatureSettings`. `ss01, cv11 off` is normalised to `"ss01" 1, "cv11" 0`.
- **Variable axes:** `fontVariationSettings`, e.g. `"wdth" 87, "opsz" 32`. The Text section shows a slider and field for each axis of the font, plus any axis already set. `wght` is never written there, because the weight menu drives `fontWeight`. Axes come from:
  - Local fonts: the `fvar` table of the font file, read through `queryLocalFonts()` blobs.
  - Google fonts: a table in `fonts.ts` (`GOOGLE_VARIABLE`, e.g. Inter opsz 14–32, Roboto wdth 75–100). Those families are also loaded with their extra axes, because the css2 API pins axes that aren't requested.
  - Anything else (system aliases, Google fonts outside the table): "Add axis" in Type details adds a standard axis (wdth 25–200, opsz 6–144, slnt −90–0, ital 0–1) or a custom 4-letter tag.
  "−" on an axis row removes it from the CSS (back to the font default).
- **Reordering:** the fill, shadow and filter lists keep their CSS order: the top fill row is the top `backgroundImage` layer, the first shadow row is first in `boxShadow`, and filters apply top to bottom. Drop and inner shadows share `boxShadow`, so each section reorders its rows among the slots they already use.
- **Underline:** `textDecorationLine`, `textDecorationThickness`, `textUnderlineOffset`, `textDecorationColor`.
- **Stroke:** `WebkitTextStrokeWidth` and `WebkitTextStrokeColor`, with `paintOrder: 'stroke fill'`.
- **Selection colors:** literal colours are grouped by their `#RRGGBB(AA)` form (so `#fff`, `white` and `rgb(255,255,255)` are one row); `var(--x)` is its own row when the token resolves to a colour. Only style keys that can hold colours are scanned (`color`, `background*`, `border*`/`outline*` colours, `boxShadow`, `textShadow`, …), `url()` is skipped. Shown when a selected node has children, or the selection uses 2+ colours. Rows are keyed by position so a picker drag keeps its row; live drags coalesce (`insp:selcolors:<ids>`).
- **Other styles:** a key counts as handled only when its section applies to the node: text keys for text; fill, radius, outline, border, `boxShadow` for the rest; flex/grid keys and padding for flex/grid containers; `overflow` for frames and text; `backdropFilter` for frames and rects; `gridColumn`/`gridRow` inside a grid. Names are shown kebab-case; typed names accept `z-index`, `zIndex`, `-webkit-…` or `--custom` and are stored camelCase (`toCamel`). An empty value removes the key; plain numbers are stored as numbers (px unless unitless), as in HTML import.
- **Text styles (Text section):** `TextStyleRow.tsx` shows the style the selected text layer(s) follow (`None`, a name, or `Mixed`). Pick one from the dropdown (`None`, then the styles) to apply it (its typography is copied onto the layers and they follow later edits of the style); the unlink button detaches (values stay); the `+` button ("Create text style from selection", disabled unless exactly one text layer is selected) creates a style from the layer and shows a "Text style created" toast. A text style holds family, size, weight, style, line height, letter spacing, decoration and case, not colour or alignment. A manual change to one of those keys on a linked layer detaches it and shows a toast ("Detached from text style Body"); a colour or alignment change keeps the link. Pick, create, detach and the detach-on-edit are each one undo step. Inside a component instance the link is an override of the instance, the main is untouched. Management (rename, edit values, delete, how many layers follow) lives in the Styles view of the Theme tab (`LEFT_DASHBOARD.md`).
- **Colour styles in fields:** the popover lists `--color-*` tokens (colour styles) before other colour tokens. "Add as token" is labelled "Add as colour style" and "Detach token" is "Detach style"; Detach writes the colour in the theme mode in effect at the layer (`effectiveMode`), not the base value. Previously: the token popover of every `ColorInput` (Fill, Border, Shadow, Selection colors, …) offers "Add as token" for a literal colour: name it (default first free `--color-<n>`), and `addColorToken` upserts the token (base value only, no mode overrides) and writes `var(--name)` back through the field's `onChange`, in one `transact` step. For Selection colors that replaces the colour everywhere in the selection. **Known limit (fixed by T38):** the pickers list only tokens whose value `parseColor` can read (hex, rgb(a), hsl, named colours, `transparent`); `oklch()` values, which every colour of the starter theme uses, are not offered yet, so those styles cannot be picked from a field. They still work when applied another way (MCP `update_styles` with `var(--color-name)`), and Detach on one writes its `oklch()` literal.

## Notes
- **Fonts:** the font list uses `queryLocalFonts()`. If that is unavailable, it falls back to a curated list of Windows fonts. Google Fonts are fetched and registered through the `FontFace` API, because the renderer CSP blocks remote stylesheets. Loading happens when a font is picked, when it scrolls into view in the picker, and when a selected text uses it. Vellum content that uses a Google font on a fresh start only renders correctly after something loads the font. The canvas could call `loadGoogleFont` for the families in the doc.
- **Zoom menu:** it calls `editor/canvas/camera.ts`. Its toggles are stored as the prefs `canvas.*`, such as `canvas.pixelGrid`, `canvas.snapToPixel`, `canvas.invertZoom`, `canvas.scrollWheelZooms` and `canvas.layoutGuides`.
- **Export:** PNG, JPG and WebP go through `canvasApi.renderHtml` (the main process's hidden offscreen window), so the whole node renders at 1x, 2x or 3x at any zoom, even off screen. A new row is PNG 2x (then 3x, then 1x). JPG is flattened onto the artboard's fill (or the page background when the artboard has none); WebP keeps transparency. PDF goes through `canvasApi.renderPdf` (`webContents.printToPDF`): vector, text stays selectable, and the page is the node's size with no margins. SVG is HTML inside a `<foreignObject>`. HTML is a standalone document that includes the tokens. Files are saved through the browser download (Electron shows a save dialog). Export rows are held for the session only.
- **Connect modal status:** the status line counts any bridge request seen by the renderer as "connected".
- **Keyboard shortcuts:** Shift+A and Alt+C are shown as labels only. The shortcuts themselves belong to `editor/shortcuts.ts`.
