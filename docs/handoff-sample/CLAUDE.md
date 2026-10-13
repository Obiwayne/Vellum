# Scratchpad — handoff v1

> ## Andy's quick start
> 1. Drop this folder next to your repo (outside it is fine; nothing here runs).
> 2. Tell Claude Code: "build screens/checkout.md from this handoff".
> 3. Verify the result against the PNGs in screens/. Handoff v1, 1 screen.

Exported 2026-10-13T19:02:33.061Z from Vellum 1.0.0. Schema `vellum.handoff/1`.

## What is in here

- 1 screen (2 breakpoints), 38 layers, 0 components, 0 tokens, 0 text styles, 1 font family, 0 assets.
- Dev notes: 0. Open decisions: 0.

## Read order

1. `HANDOFF.md`
2. `tokens/tokens.css`
3. `tokens/tokens.json`
4. `tokens/tailwind.css`
5. `screens/checkout.md`
6. `fonts.md`
7. `spec.json`

## Rules

1. **Stack-neutral.** Build with the project's framework. Map the tokens to the project's theme: the values in `tokens/` are the truth, the names are suggestions. Reuse existing components before creating new ones. Never hard-code a value that has a token.
2. **Layout intent first.** Each layer lists its rule (flex or grid, Fixed / Fit / Fill, min and max, constraints) before its numbers. Never turn intent into absolute pixel positions. The px values in `spec.json` are the design-time size.
3. **Verify.** Render each screen at the design width and compare with the PNG in `screens/`. Tolerance: layout within 0.5px, text on the same line breaks, colours exact. List what differs; do not tweak the design silently.
4. **Precision.** Values are measured and kept to 2 decimals with trailing zeros trimmed (`347.5`, never `348`). Fractional sizes are flagged: build with the rule, not the number.
5. **Ask or flag.** Anything marked `needs decision` or `dev note` goes into the PR description; do not guess.

## Warnings

- 21 nodes have a fractional size: build with the layout rule, not the number.
