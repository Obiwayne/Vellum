# Button

- Component id: `8-0` · set of 2 variants
- Used by: Checkout

## Properties

| Name | Type | Default | Options |
| --- | --- | --- | --- |
| State | variant | "default" | default, hover |
| Label | text | "Buy now" |  |

## States

Drawn = a variant exists; described = written down without a drawing; missing = not specified, use project defaults.

| State | Status | What changes |
| --- | --- | --- |
| default | drawn | base appearance |
| hover | drawn | backgroundColor: oklch(0.55 0.2 260) → #1D4ED8 |
| pressed | missing | — |
| focus-visible | missing | — |
| disabled | described | opacity: 0.5 |

## Variants

### State=default

- **State=default** `4-0` — Row, gap 8, padding 12 20 12 20, width fit, height fit
  - size: 116px × 44px · flow item 1
  - paint: fill oklch(0.55 0.2 260) (sRGB #1C69E3FF) [--color-primary]
  - look: radius 8px; shadow 0 1 2 0 #00000040
  - tokens: --color-primary
  - a11y: role button
  - state disabled: opacity: 0.5
  - **Label** `5-0` — Block, width fit, height fit
    - size: 76px × 20px · flow item 1
    - paint: text colour #FFFFFFFF
    - text: "Buy now" · Inter 16px weight 600 · line height 20px (1.25)

### State=hover

- **State=hover** `9-0` — Row, gap 8, padding 12 20 12 20, width fit, height fit
  - size: 116px × 44px · flow item 1
  - paint: fill #1D4ED8FF
  - look: radius 8px; shadow 0 1 2 0 #00000040
  - **Label** `10-0` — Block, width fit, height fit
    - size: 76px × 20px · flow item 1
    - paint: text colour #FFFFFFFF
    - text: "Buy now" · Inter 16px weight 600 · line height 20px (1.25)
