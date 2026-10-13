# Checkout

- Screen id: `13-0` · file `screens/checkout.md`
- Marked ready for dev in handoff v3
- Breakpoints: Desktop 1280 × 800, Mobile 390 × 844

Each line below is: layout intent first (how the box behaves), then its size, then what it looks like. Build from the intent; the numbers are the design-time result.

## Desktop · 1280 × 800

Frame `13-0` · reference render `screens/checkout.desktop.png`

3 nodes have fractional sizes (e.g. 120.5 × 40); build with the rule, not the number.

- **Checkout Desktop** `13-0` — Column, gap 24, padding 16, width 1280, height 800
  - size: 1280px × 800px · artboard root
  - paint: fill #FFFFFFFF [--color-bg]
  - tokens: --color-bg, --space-4
  - **Title** `14-0` — Block, width fit, height fit
    - size: 120.5px × 40px · flow item 1
    - paint: text colour #111827FF [--color-text]
    - text: "Checkout" · Inter 32px weight 700 · line height 40px (1.25) · text style Heading/H1
    - tokens: --color-text
  - **Summary** `15-0` — Grid, gap 16, columns repeat(2, minmax(0, 1fr)), padding 16, width fill (max 640), height fit
    - size: 640px × 100.5px · flow item 2
    - **needs-decision:** What happens with more than 4 items?
    - **Item** `16-0` — Positioned children, width fill, height 52.5
      - size: 303.75px × 52.5px · flow item 1
      - paint: fill #F3F4F6FF; stroke 1px solid #E5E7EBFF
      - look: radius 6px
      - **Price** `17-0` — pinned left 0, top 0, width fit, height fit
        - size: 70px × 17px · at 8, 8 in parent
        - paint: text colour #111827FF [--color-text]
        - text: "EUR 24.00" · 14px weight 400 · line height 17px (1.2143)
        - tokens: --color-text
  - **Sale badge** `18-0` — pinned right 24, top 12, width 48, height 24
    - size: 48px × 24px · at 1208, 12 in parent
    - paint: fill #DC2626FF
  - **Buy button** `19-0` — Row, gap 8, padding 12 20 12 20, width fit, height fit
    - size: 116px × 44px · flow item 3
    - paint: fill oklch(0.55 0.2 260) (sRGB #1C69E3FF) [--color-primary]
    - look: radius 8px; shadow 0 1 2 0 #00000040
    - tokens: --color-primary
    - component: Button `4-0` (variant State=default; props Label="Pay EUR 24.00")
    - a11y: role button, label "Pay now", focus order 2
    - state hover: backgroundColor: var(--color-primary)
    - note: Disabled until the form is valid.
    - note: Show a spinner while the payment is pending.
    - **Label** `20-0` — Block, width fit, height fit
      - size: 76px × 20px · flow item 1
      - paint: text colour #FFFFFFFF
      - text: "Pay EUR 24.00" · Inter 16px weight 600 · line height 20px (1.25)
  - **Locked backdrop** `23-0` — pinned left 0, top 0, width 1280, height 800
    - size: 1280px × 800px · at 0, 0 in parent
    - paint: fill #F9FAFBFF
  - **Hero photo** `24-0` — Block, width 320, height 180
    - size: 320px × 180px · flow item 4
    - image: no alt text, fit cover

## Mobile · 390 × 844

Frame `25-0` · reference render `screens/checkout.mobile.png`

- **Checkout Mobile** `25-0` — Column, gap 16, padding 16, width 390, height 844
  - size: 390px × 844px · artboard root
  - paint: fill #FFFFFFFF [--color-bg]
  - tokens: --color-bg
  - **Title** `26-0` — Block, width fit, height fit
    - size: 120px × 30px · flow item 1
    - paint: text colour #111827FF [--color-text]
    - text: "Checkout" · Inter 24px weight 700 · line height 30px (1.25)
    - tokens: --color-text
  - **Buy button** `27-0` — Row, gap 8, padding 12 20 12 20, width fit, height fit
    - size: 116px × 44px · flow item 2
    - paint: fill oklch(0.55 0.2 260) (sRGB #1C69E3FF) [--color-primary]
    - look: radius 8px; shadow 0 1 2 0 #00000040
    - tokens: --color-primary
    - component: Button `4-0` (variant State=default)
    - **Label** `28-0` — Block, width fit, height fit
      - size: 76px × 20px · flow item 1
      - paint: text colour #FFFFFFFF
      - text: "Buy now" · Inter 16px weight 600 · line height 20px (1.25)
