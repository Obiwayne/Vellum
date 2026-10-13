> ## Andy's quick start
> 1. Drop this folder next to your repo (outside it is fine; nothing here runs).
> 2. Tell Claude Code: "build screens/checkout.md from this handoff".
> 3. Verify the result against the PNGs in screens/. Handoff v3, 1 screen.

# Acme Checkout — design handoff v3

Exported 2026-01-02T03:04:05.000Z with Vellum 1.0.0. 1 screen (2 breakpoints), 1 component, 5 tokens, 18 nodes.

## How to build from this bundle

1. **Read order.** This file, then:
   1. `tokens/` (`tokens.css` is the truth; `tokens.json` is the same data in the W3C design-token format; `tailwind.css` is a Tailwind v4 `@theme` block)
   2. `components/*.md` (definitions, variants, properties and states)
   3. `screens/*.md` (one per screen)
   4. `fonts.md` (families, weights, licences)
   5. `spec.json` for exact data (`spec.schema.json` describes it)
2. **Stack-neutral rules.** Build with the project's own framework and conventions. Map tokens to the project's theme (the values in `tokens.css` are the truth, the names are suggestions). Reuse existing components before creating new ones. Never hard-code a value that has a token.
3. **Layout rules.** Honour the layout intent on every node (flex or grid, gap, padding, Fixed / Fit / Fill, min and max, pinned edges). Never convert intent into absolute pixel positions. The px values describe the size at design time; for a box that can grow, the rule wins.
4. **Verify.** Render each screen at its design width and compare with the PNG in `screens/`. Tolerance: ±0.5px for layout (values are written with up to 2 decimals, trailing zeros trimmed), text on the same line breaks, colours exact. List what differs; do not tweak the design silently.
5. **Ask or flag.** Anything marked `needs-decision` or `note` goes into the PR description; do not invent an answer.
6. **Updating.** This is the first handoff of this file; a later bundle will list what changed.

## Screens

- [Checkout](screens/checkout.md) — Desktop 1280px, Mobile 390px · ready in v3

## Components

- [Button](components/button.md) — 2 variants

## Text styles

- **Heading/H1**: fontFamily Inter, fontSize 32, fontWeight 700, lineHeight 1.25

## Notes on sizing

- Checkout: 3 nodes have fractional sizes (e.g. 120.5 × 40); build with the rule, not the number.

## Open questions (needs-decision)

- Checkout › Summary `15-0`: What happens with more than 4 items?

## Warnings

- Pulls in Button from page "Page 1" (components used by the chosen frames).
- 1 image has no alt text; treat as decorative only if the design says so.
