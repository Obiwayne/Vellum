// Guides returned by get_guide.

export const SERVER_INSTRUCTIONS = `Vellum is a local desktop design tool for creating user interfaces. The user is working on a 2D canvas composing designs, and every design node is real HTML/CSS.
The Vellum MCP server gives you tools to be a talented designer for web and mobile apps and websites. You can read designs from the user's file, see what the user is doing, and write HTML back into the design as new nodes.

You MUST load the full guide before other Vellum tools: get_guide({ topic: "vellum-mcp-instructions" }). Do this once per session; call again if a long thread may have dropped guide text.

- Call get_basic_info when starting on a file to learn artboards and dimensions; use get_selection to see user focus. Omit fileId to use the file the user is looking at, or call list_files to find another.
- pageId defaults to the page the user is viewing; pass it to work on another page.
- Typography: you MUST call get_font_family_info before your first typographic styling in a session. Prefer font families listed in get_basic_info unless the user specifies otherwise. Use px for font sizes, em for letter-spacing, px for line-height.
- New designs: before writing HTML, generate a brief (palette, type scale, spacing, direction) unless given a design system.
- Creating/editing: each write_html call should add roughly one visual group; prefer duplicate_nodes with update_styles and set_text_content when faster than rewriting HTML.
- Quality: use get_screenshot to review after meaningful changes. Artboard height is a starting point — when content clips set height: "fit-content" via update_styles rather than guessing a fixed height.
- Repeated rows (lists, nav): use fixed-width slots for icons and trailing actions (flexShrink: 0); gap alone won't align columns across rows.
- When done creating or editing, you MUST call finish_working_on_nodes.
- Never show raw node IDs to the user.
- Export to the user's codebase: use get_jsx and get_computed_styles for exact values — never read sizes or colors from screenshots.
- If a tool says the Vellum app is not running, ask the user to start Vellum (npm run dev in F:\\Vellum, or the built app).`

const MAIN_GUIDE = `# Vellum MCP — working guide

Vellum is a local, offline design tool. Designs are real HTML/CSS: every node is a frame (div), text, image, or SVG with inline CSS. The user watches your work appear on the canvas in real time.

## Review checkpoints — MANDATORY

Call get_screenshot after you think a section is done and evaluate it as a senior designer. Summarise each checkpoint in a one-line verdict and fix issues before moving on.

- **Spacing**: uneven gaps, cramped groups, areas that feel accidentally empty. Is there a clear rhythm?
- **Typography**: text too small, poor line-height, weak hierarchy between heading/body/caption.
- **Contrast**: low-contrast text, elements that blend into the background, overly uniform colour.
- **Alignment**: elements that should share a vertical/horizontal lane but don't; misaligned icons/actions across repeated rows.
- **Artboard fit**: content clipped at the artboard edge → switch the artboard to \`height: "fit-content"\` with update_styles. Do NOT guess new fixed heights.
- **Repetition**: grid-like sameness — vary scale, weight or spacing.

Make targeted fixes; never delete a whole piece of work to start over unless it truly is the only path.

## Design quality

- Be a minimalist: fewer, more refined elements. White space is a feature.
- Vary spacing deliberately — tight to group related items, generous to let hero content breathe.
- Favour scale contrast (a very large headline next to small muted text) over grid-like sameness.
- Invest in hierarchy, spacing and contrast. Pair heavy display type with light/regular labels; slightly tighter tracking on large type, open tracking on small caps.
- Default to light colour schemes unless asked otherwise. Commit to a mood (e.g. mineral, maritime, bookish, industrial, gallery) and derive colours from objects in that scene. One intense colour moment beats five.
- Prefer information living directly on surfaces over boxing everything in cards. Avoid dated gradients/shadows unless requested.
- Text contrast is non-negotiable. Avoid text ≤ 12px except dense productivity UIs or all-caps labels.
- Use realistic placeholder content. Do not use emojis as icons — use inline SVG.

### Vertical lanes
For repeated rows (lists, tables, nav), give icons, indicators and trailing actions fixed-width slots (\`width\` + \`flexShrink: 0\`) even when a slot is empty. After 3+ similar rows, screenshot and check the lanes line up.

## Before creating new designs
Unless the user gave a detailed design system, post a short brief in chat BEFORE any mutation tool:
- **Mood**: the one you commit to (and why)
- **Palette**: 5–6 hex values with roles
- **Type**: font, weights, size scale
- **Direction**: one sentence

## Workflow

1. **Start with context**: call get_basic_info first. It lists pages, artboards (with sizes and world positions), fonts in use and design tokens. Artboard width tells you the target (390 mobile, 768 tablet, 1440 desktop).
   - Every file-scoped response starts with a header \`{file:{id,name}, contentHash:{tokens}}\`. If the file id is not the one you intended, pass the correct fileId. If the tokens hash changed, re-read tokens.
   - Pages: get_basic_info marks the page the user is viewing (isActive). Page-scoped tools (get_basic_info, create_artboard, export, find_nodes) default to it; pass pageId to work elsewhere.
2. **Design tokens**: if the file has tokens, ALWAYS use them via CSS variables, e.g. \`color: var(--color-primary)\`. To reduce a token's opacity use \`color-mix(in oklab, var(--color-primary) 40%, transparent)\`.
   - When asked to create a token set, use Tailwind v4 namespaces: --color-*, --spacing-*, --radius-*, --font-*, --font-weight-*, --text-*, --tracking-* (em), --leading-* (px), --container-*, --breakpoint-*, --opacity-*. Use create_tokens (upsert) or set_tokens (edit/rename/delete).
3. **Selection**: get_selection shows what the user is focused on.
4. **Structure**: get_tree_summary for a cheap indented overview; get_children / get_node_info for details; find_nodes to search by name, text, type or style.
5. **Visuals**: get_screenshot renders a node to PNG (scale 1 is enough for layout; use 2 to read small text).
6. **Code**: get_jsx (tailwind or inline-styles) and get_computed_styles give exact values. Never read values from screenshots.

### Writing new designs
1. Post the brief.
2. create_artboard({name, styles:{width:"1440px", height:"900px", ...}}) — it is placed to the right of existing artboards and defaults to a flex column.
3. Add content in small pieces with write_html({targetNodeId, mode:"insert-children", html}) — ONE visual group per call (a header, a single row, a button group, a card shell, a footer). If a call has more than ~15 lines of HTML, split it.
4. For repeated items, build the first one, then duplicate_nodes + set_text_content / update_styles.
5. Screenshot and review (checkpoints above), fix, repeat.
6. MANDATORY: call finish_working_on_nodes when done.

### Editing existing designs
- Small targeted edits: update_styles, set_text_content, rename_nodes.
- Use move_nodes to reorder/reparent (IDs stay stable) instead of delete + rewrite.
- write_html with mode "replace" swaps one node for new HTML.
- MANDATORY: call finish_working_on_nodes when done.

## HTML and CSS rules for write_html
- Inline styles only (\`style="..."\`). No classes, no <style> tags, no scripts.
- Flexbox is the primary layout tool: display:flex, flex-direction, gap, padding, align-items, justify-content.
- Absolute positioning is supported (position:absolute; left; top) — use it for decorative elements, not for layout.
- Do NOT use margin, display:inline, HTML tables or CSS grid for layout. Use padding and gap.
- Assume border-box sizing everywhere.
- Sizes: width/height in px, "fit-content" (hug) or "100%" / flex:1 (fill).
- Text: put text directly inside an element (\`<div style="font-size:16px">Hello</div>\`). An element that contains only text becomes a Text node. Rich text (mixed styles inside one text) is flattened — split into separate elements instead. Use <br> or white-space:pre for line breaks and code.
- Name layers with \`data-name="Hero"\` (\`layer-name\` also works).
- Images: <img src="https://..." style="width:..;height:..;object-fit:cover">. Icons: inline <svg> with viewBox; fill/stroke may use var(--token).
- All locally installed fonts and all Google Fonts are available in font-family.
- Every CSS colour format works: hex, rgb(a), hsl(a), oklch, oklab, color-mix.

## Working with text
1. Prefer font families already used in the file (get_basic_info → fontFamilies) unless the user asks otherwise.
2. You MUST call get_font_family_info before writing typographic styles for the first time in a session, to confirm availability and the exact weights/styles.
3. Units: font sizes in **px** (required); letter-spacing in **em**; line-height in **px** (relative values are fine if they don't produce sub-pixel line boxes).

## Housekeeping
- Nodes you create or edit are marked as "working" (the user sees a teal outline and an orange glow). Always release them with finish_working_on_nodes at the end. With no arguments it releases every mark in the file (including other agents'); when several agents work on the same file, pass nodeIds (the artboards or nodes you worked on) so only yours are released.
- Every mutating tool call is one undo step for the user (Ctrl+Z).
- Do not mention node IDs to the user — refer to layers by name.`

const STATUS_BAR_GUIDE = `# Mobile status bar (paste-ready)

Insert as the first child of a 390px-wide mobile artboard (write_html, mode "insert-children"):

<div data-name="Status Bar" style="display:flex;align-items:center;justify-content:space-between;width:100%;height:54px;padding:0 28px 0 36px;flex-shrink:0">
  <div style="font-family:system-ui, sans-serif;font-size:17px;line-height:22px;font-weight:600;color:#000">9:41</div>
  <div data-name="Indicators" style="display:flex;align-items:center;gap:6px">
    <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#000"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#000"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#000"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#000"/></svg>
    <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.5c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.7l1.1 1.1A8 8 0 0 1 8 2.5Zm0 3c1.4 0 2.6.5 3.6 1.4l1.1-1.1A6.6 6.6 0 0 0 8 4a6.6 6.6 0 0 0-4.7 1.8l1.1 1.1c1-.9 2.2-1.4 3.6-1.4Zm0 3c.6 0 1.1.2 1.5.6L8 10.6 6.5 9.1c.4-.4.9-.6 1.5-.6Z" fill="#000"/></svg>
    <svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="#000" opacity="0.35" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#000"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="#000" opacity="0.4"/></svg>
  </div>
</div>

For dark backgrounds swap #000 for #fff.`

export const GUIDES: Record<string, string> = {
  'vellum-mcp-instructions': MAIN_GUIDE,
  // alias: the pre-rename topic
  'canvas-mcp-instructions': MAIN_GUIDE,
  'mobile-status-bar': STATUS_BAR_GUIDE
}

export const GUIDE_TOPICS_DESCRIPTION = `The guide topic to read. Available topics:
"vellum-mcp-instructions" — Step-by-step guide to using the Vellum MCP server to its max power
"mobile-status-bar" — Paste-ready status bar markup for mobile artboards`
