# Vellum bugs found while building MayhemDeck

## [ds-agent] write_html: text without explicit line-height gets a fixed `lineHeight: 20px`
- **FIXED** — canvas content now inherits `line-height: normal` (only Text-tool text gets 16/20); older docs are migrated on load (doc.version 2) so existing text keeps its explicit 20px.
- Tool: write_html (insert-children), e.g. `<div style="font-size:26px;font-weight:600">1880 × 980</div>` with no line-height.
- Expected (CSS): `line-height: normal` (~1.33 × font-size for Segoe UI), so a 26px/40px text is ~35/53px tall.
- Actual: get_computed_styles shows `lineHeight: "20px"` on every such Text node regardless of font size; node height = 20, so large text overflows its box and overlaps siblings below (e.g. 40px "#7C5CFF" sat on top of the caption under it).
- Workaround: always set an explicit px `line-height` on text > 15px (fixed with update_styles).

## [ds-agent] get_screenshot: artboards taller than ~4096px come back downscaled with browser scrollbars baked in
- **FIXED** — offscreen renderer hides scrollbars and captures in 2048px tiles that are stitched; get_screenshot is only clamped to the MCP image limit (8000px/side, ~5MB).
- Tool: get_screenshot({nodeId:<1440×~5000 artboard>, scale:1}).
- Expected: full node rendered (or a clear error / tiled output), no UI chrome.
- Actual: image is 1305×4096 (downscaled to fit 4096 height) and shows a vertical + horizontal scrollbar along the right/bottom edges; the right edge of the artboard is covered by the scrollbar. Screenshots of child sections render with a transparent background (fine), so workaround = screenshot sections individually.

## write_html: frame without `display` does not size to wrapped text (shell agent)
- **FIXED** — block containers are imported as flex columns (stretch), or wrapping baseline rows when all children are inline-level (root cause: the conversion edited a copy of the style).
- Tool: write_html (insert-children) on file hNTr3_YXd6KI, page p-3-0 (Dashboard test-event card on "MainWindow — live activity").
- Args: a wrapper `<div style="padding:4px 0 12px"><div style="font-size:12.5px;line-height:17px">Fires your events exactly as a real viewer would, without going LIVE.</div></div>` inside a flex-column card 350px wide; also `<div style="flex:1;padding-left:17px"><div>Coffee · 1 coin</div></div>` inside a 36px flex row.
- Expected (browser): block wrapper grows to fit the 2-line wrapped text; the next sibling ("Viewer name") sits below it. In the row, the text is vertically centred like any other flex child.
- Actual: the wrapper keeps a one-line height, so the second line of text overlaps the "Viewer name" label; in the row the text sits ~10px low. get_computed_styles shows only `padding` + `position:relative` (no display).
- Workaround: always give wrapper frames `display:flex` (+ `flex-direction:column` / `align-items:center`).

## write_html: `position:absolute; left; top` dropped from inline styles (shell agent)
- **FIXED** — only roots written into a page root are treated as artboards; other absolute roots keep position and left/top → x/y.
- Tool: write_html (insert-children) into an artboard (flex row) on p-3-0, html `<div layer-name="Shutdown overlay" style="position:absolute;left:0px;top:0px;width:100%;height:100%;display:flex;...;background:color-mix(...)">…</div>`.
- Expected: the node is absolutely positioned over the artboard's other child (full-window cover), as the guide says absolute positioning is supported.
- Actual: get_computed_styles shows width/height/display/background but NO position/left/top; the node becomes a flex item, squashing the sibling "Window" frame to half width.
- Workaround: after write_html, update_styles `{position:"absolute", left:"0px", top:"0px"}` on the node — that works.

## write_html: absolute element with only `right` gets `left:0` added (right ignored)
- **FIXED** — a missing left/top on absolute elements is stored as `auto`, so right/bottom anchoring renders as in a browser (moves detach it to x/y).
- Tool: write_html (Components page, "Surfaces & feedback" > Scrollbar demo)
- Args: `<div style="position:absolute;right:0;top:0;width:9px;height:160px">` inside a `position:relative` 240px frame
- Expected: element pinned to the right edge (as in browser CSS).
- Actual: stored styles become `{position:absolute, right:0, left:0, top:0, ...}` (get_computed_styles / get_jsx), so it renders at the left edge.
- Workaround: compute `left` explicitly (left:229px).

## [components-B] write_html: block (no `display`) parent turns its in-flow children into `position:absolute; left:0; top:0` and collapses to 0 height
- **FIXED** — same root cause as the `display`-less frame bug above.
- Tool: write_html (insert-children) on p-2-0, "Components / Game tile & hero" > Game hero.
- Args: `<div style="width:1320px;border-radius:10px;background-image:...;overflow:hidden"><div style="display:flex;gap:24px;padding:22px">…cover + text…</div></div>` (also reproduced with the inner div given `position:relative`).
- Expected (browser): the parent is a block that grows to its child's height (~220px); `position:relative` stays in flow.
- Actual: get_jsx shows the parent with `position:"relative"` added and the child rewritten to `position:"absolute", left:0, top:0`; the parent's fit-content height becomes 0, so the whole hero is invisible (overflow hidden). Same root cause makes a `padding:3px;border:2px;width:fit-content` wrapper around a 249px tile collapse to ~6×6px.
- Workaround: give every container `display:flex` (+ flex-direction).

## [components-B] get_node_info: fit-content nodes report `height:null`, `x/y/worldX/worldY:null`
- **FIXED** — nodes off the visible page are measured from a hidden offscreen render of their artboard (bridge/measure.ts).
- Tool: get_node_info({nodeId:"722-0"}) (a 249×~183 tile with height fit-content inside a flex column).
- Expected: the laid-out size/position (computed width/height/x/y).
- Actual: `height:null, x:null, y:null, worldX:null, worldY:null`; get_tree_summary likewise prints `?×?`. There is no way to read a hugging node's rendered size except by measuring a screenshot.
- Workaround: measure from get_screenshot.

## [content agent] write_html / set_text_content: backslashes in text are treated as escape sequences
- **FIXED** — Vellum stores text literally: write_html and set_text_content never interpret backslash escapes, only real newline characters in the (decoded) string break lines, and `&nbsp;`/entities are decoded by the HTML parser as in a browser. The mangling seen here happened before the call reached Vellum: the build script had the path in a JS string literal (`'C:\nonexistent\TikFinity.exe'` written with single backslashes), so JavaScript turned `\n` into a newline and dropped the other backslashes. Regression checks (regress.mjs §7) pin the literal behaviour.
- Tools: write_html (insert-children) and set_text_content on file hNTr3_YXd6KI, page p-4-0 (Settings: "TikFinity program" path, About data folder).
- Args: text `C:\nonexistent\TikFinity.exe` and `C:\Users\someone\AppData\Roaming\ExampleApp` (single literal backslashes in the JSON string values, i.e. `"C:\nonexistent\TikFinity.exe"` in the args file).
- Expected (browser): the backslashes are literal characters; text reads `C:\nonexistent\TikFinity.exe`.
- Actual: `\n` becomes a newline and other backslashes vanish: stored textContent `C:\n onexistentTikFinity.exe` / `C:UserssomeoneAppDataRoamingExampleApp` (get_node_info). Same result through set_text_content.
- Workaround: in write_html use the entity `&#92;` for each backslash; in set_text_content double every backslash (`C:\\nonexistent` in the JSON) — the stored text then has single backslashes.

## [setup-dialogs agent] write_html: an element whose only content is `&nbsp;` (or empty) becomes a 0×0 Frame, not a one-line Text
- **FIXED** — the importer no longer uses `String.trim` (which strips U+00A0): an `&nbsp;`-only element is a Text node containing the nbsp, one line tall. An empty element that only sets typography (font-*, color, line-height, text-*) and no box styles (background, border, height, display…) becomes an empty Text node; empty text keeps one line of height on the canvas (`min-height: 1lh`, not reported as a node style) so it stays visible and set_text_content works on it later. Empty spacers and dots stay Frames.
- Tool: write_html (insert-children) on p-5-0, e.g. `<div style="display:flex;flex-direction:column;width:100px"><div style="font-size:11.5px;line-height:15px">&nbsp;</div><div style="font-size:11.5px;line-height:15px">x</div></div>`.
- Expected (browser): the `&nbsp;` div is a text line 15px tall, so the second line sits at y=15 (used as a blank "note" line in the StreamRecap stat tiles to keep the compare line at the bottom).
- Actual: tree shows `Frame "Frame" 100×0` for the `&nbsp;` div and the parent is 15px tall; the following line moves up. Likewise an empty text div (`<div style="font-family:...;font-size:13px"></div>`, e.g. an empty TextBox value) becomes a Frame, so set_text_content on it later fails with "Node is a frame, not a Text node".
- Workaround: use a fixed-height spacer frame (`<div style="height:15px;flex-shrink:0"></div>`) instead of a `&nbsp;` line; to fill an empty text box later, replace the box with write_html mode "replace".

## [multi-agent] finish_working_on_nodes clears other agents' working marks
- **FIXED** — `finish_working_on_nodes` takes an optional `nodeIds`: only those nodes (and the artboards they are in) are released and the result lists `released`/`remaining`. With no arguments it still releases every mark in the file. The guide tells agents to pass `nodeIds` when several agents share a file. Regression checks: regress.mjs §9.
- Tool: finish_working_on_nodes() called by one agent while another agent was still writing into a different artboard of hNTr3_YXd6KI.
- Expected: only the caller's artboards lose the teal outline.
- Actual: every working mark in the file was cleared.
