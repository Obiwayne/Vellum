Real files saved by Vellum v0.1.0 (commit 1c0f58f, package.json version 0.1.0, doc format version 2, no profiles).

How they were made: the commit was exported with `git archive 1c0f58f` into a temp folder and built with `electron-vite
build`. The built app was started with `--user-data-dir=<temp>` and given its documents through its own MCP bridge
(create_file, create_tokens, create_artboard, write_html, create_page, update_styles). The app autosaved them, and
`files/*.json` and `index.json` are copied unchanged from that userData folder. The generator script depends on the old
build, so it is not in the repo; this paragraph is the recipe.

Contents: "Landing page" (2 pages, 4 tokens, flex column and row, text with and without a line height, an svg, an image,
a box shadow, unicode text), "Old sketch" (text with no line height) and the Scratchpad.

The layout is the pre-profile one: userData/files/*.json plus userData/index.json. v0.1.0 had no profiles (they came with
8768d00) and no comments: docs/MCP.md at 1c0f58f says "Vellum has no comments" for the comment tools, and its Doc type has
no comment field.

Location: model/fixtures/ (next to the model code the tests exercise), not test-fixtures/, as the task asked.
Made by: running the v0.1.0 app itself (not a script over its model code), so the bytes come from that commit.
