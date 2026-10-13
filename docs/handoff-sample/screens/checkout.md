# Checkout

Screen `2-0`, 2 breakpoints. Build to the layout rules first; the numbers describe the design size.

Breakpoints, widest first: Tablet 720px, Mobile 360px. Suggestion: write the narrowest layout first and add `min-width` media queries for the wider ones (container queries if the parent is a component). Widths in between follow the layout rules.

## Tablet · 720px wide

Frame `2-0` · ready in handoff v1 · reference `screens/checkout.tablet.png`

> 11 nodes have fractional sizes (e.g. 105.55 × 32 for "Checkout"); build with the rule, not the number.

- **Frame — Column, gap 24, padding 32, width 720, height fit** `2-0`
  - size 720px × 371px; at 0, 0 in artboard
  - padding 32px 32px 32px 32px
  - fill #F8FAFCFF
  - **Frame — Row, width fill, height fit** `3-0`
    - size 656px × 32px; flow position 0
    - **Checkout — Block, width fit, height fit** `4-0` (text)
      - size 105.55px × 32px; flow position 0
      - text colour #0F172AFF
      - "Checkout" · system-ui,'Segoe UI',Arial,sans-serif, 24px, weight 700 · line height 32px (1.33) estimated
      - contrast: base 17.06:1 AAA (large text)
    - **Step 2 of 3 — Block, width fit, height fit** `5-0` (text)
      - size 66.47px × 19px; flow position 1
      - text colour #475569FF
      - "Step 2 of 3" · system-ui,'Segoe UI',Arial,sans-serif, 14px, weight 400 · line height 19px (1.36) estimated
      - contrast: base 7.24:1 AAA
  - **Frame — Column, gap 12, padding 20, width fill, height fit** `6-0`
    - size 656px × 178px; flow position 1
    - padding 20px 20px 20px 20px
    - fill #FFFFFFFF; stroke 1px solid #E2E8F0FF; radius 12px
    - **Frame — Row, width fill, height fit** `7-0`
      - size 614px × 21px; flow position 0
      - **Wireless keyboard — Block, width fit, height fit** `8-0` (text)
        - size 128.92px × 21px; flow position 0
        - text colour #0F172AFF
        - "Wireless keyboard" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
      - **$89.00 — Block, width fit, height fit** `9-0` (text)
        - size 46.59px × 21px; flow position 1
        - text colour #0F172AFF
        - "$89.00" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, width fill, height fit** `10-0`
      - size 614px × 21px; flow position 1
      - **USB-C cable — Block, width fit, height fit** `11-0` (text)
        - size 86.53px × 21px; flow position 0
        - text colour #0F172AFF
        - "USB-C cable" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
      - **$12.00 — Block, width fit, height fit** `12-0` (text)
        - size 46.59px × 21px; flow position 1
        - text colour #0F172AFF
        - "$12.00" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, width fill, height fit** `13-0`
      - size 614px × 21px; flow position 2
      - **Delivery — Block, width fit, height fit** `14-0` (text)
        - size 56.67px × 21px; flow position 0
        - text colour #0F172AFF
        - "Delivery" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
      - **$4.00 — Block, width fit, height fit** `15-0` (text)
        - size 37.97px × 21px; flow position 1
        - text colour #0F172AFF
        - "$4.00" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 400 · line height 21px (1.31) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, padding 12 0 0 0, width fill, height fit** `16-0`
      - size 614px × 37px; flow position 3
      - padding 12px 0px 0px 0px
      - stroke 1 0 0 0px solid #E2E8F0FF
      - **Total — Block, width fit, height fit** `17-0` (text)
        - size 41.75px × 24px; flow position 0
        - text colour #0F172AFF
        - "Total" · system-ui,'Segoe UI',Arial,sans-serif, 18px, weight 700 · line height 24px (1.33) estimated
        - contrast: base 17.85:1 AAA
      - **$105.00 — Block, width fit, height fit** `18-0` (text)
        - size 67px × 24px; flow position 1
        - text colour #0F172AFF
        - "$105.00" · system-ui,'Segoe UI',Arial,sans-serif, 18px, weight 700 · line height 24px (1.33) estimated
        - contrast: base 17.85:1 AAA
  - **Frame — Row, gap 16, width fill, height fit** `20-0`
    - size 656px × 49px; flow position 2
    - **Pay $105.00 — padding 14 28 14 28, width fit, height fit** `21-0` (text)
      - size 142.94px × 49px; flow position 0
      - padding 14px 28px 14px 28px
      - fill #2563EBFF; text colour #FFFFFFFF; radius 8px
      - "Pay $105.00" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 600 · line height 21px (1.31) estimated
      - contrast: base 5.17:1 AA
    - **Back to cart — padding 14 28 14 28, width fit, height fit** `22-0` (text)
      - size 142.02px × 49px; flow position 1
      - padding 14px 28px 14px 28px
      - fill #E2E8F0FF; text colour #0F172AFF; radius 8px
      - "Back to cart" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 600 · line height 21px (1.31) estimated
      - contrast: base 14.48:1 AAA

## Mobile · 360px wide

Frame `23-0` · ready in handoff v1 · reference `screens/checkout.mobile.png`

> 10 nodes have fractional sizes (e.g. 87.95 × 27 for "Checkout"); build with the rule, not the number.

Compared with Tablet (the base): 12 layers change, 2 only here, 2 not shown. Build the base, then apply these.

| Layer | What changes |
|---|---|
| (the frame) | layout: Column, gap 24, padding 32 → Column, gap 16, padding 20 |
| Frame › Checkout | font size: 24px → 20px; line height: 32px → 27px |
| Frame (2) | layout: Column, gap 12, padding 20 → Column, gap 10, padding 16 |
| Frame (2) › Frame › Wireless keyboard | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame › $89.00 | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame (2) › USB-C cable | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame (2) › $12.00 | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame (3) › Delivery | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame (3) › $4.00 | font size: 16px → 15px; line height: 21px → 20px |
| Frame (2) › Frame (4) | layout: Row, padding 12 0 0 0 → Row, padding 10 0 0 0 |
| Frame (2) › Frame (4) › Total | font size: 18px → 17px; line height: 24px → 22px |
| Frame (2) › Frame (4) › $105.00 | font size: 18px → 17px; line height: 24px → 22px |

Only at Mobile: Frame › 2 of 3; Pay $105.00

Not at Mobile (present at Tablet): Frame › Step 2 of 3; Frame (3)

> Layers with the same name were matched in order (Frame, Frame (2) › Frame); check them by eye.

- **Frame — Column, gap 16, padding 20, width 360, height fit** `23-0`
  - size 360px × 305px; at 0, 0 in artboard
  - padding 20px 20px 20px 20px
  - fill #F8FAFCFF
  - **Frame — Row, width fill, height fit** `24-0`
    - size 320px × 27px; flow position 0
    - **Checkout — Block, width fit, height fit** `25-0` (text)
      - size 87.95px × 27px; flow position 0
      - text colour #0F172AFF
      - "Checkout" · system-ui,'Segoe UI',Arial,sans-serif, 20px, weight 700 · line height 27px (1.35) estimated
      - contrast: base 17.06:1 AAA (large text)
    - **2 of 3 — Block, width fit, height fit** `26-0` (text)
      - size 32.83px × 17px; flow position 1
      - text colour #475569FF
      - "2 of 3" · system-ui,'Segoe UI',Arial,sans-serif, 13px, weight 400 · line height 17px (1.31) estimated
      - contrast: base 7.24:1 AAA
  - **Frame — Column, gap 10, padding 16, width fill, height fit** `27-0`
    - size 320px × 157px; flow position 1
    - padding 16px 16px 16px 16px
    - fill #FFFFFFFF; stroke 1px solid #E2E8F0FF; radius 12px
    - **Frame — Row, width fill, height fit** `28-0`
      - size 286px × 20px; flow position 0
      - **Wireless keyboard — Block, width fit, height fit** `29-0` (text)
        - size 120.88px × 20px; flow position 0
        - text colour #0F172AFF
        - "Wireless keyboard" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
      - **$89.00 — Block, width fit, height fit** `30-0` (text)
        - size 43.69px × 20px; flow position 1
        - text colour #0F172AFF
        - "$89.00" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, width fill, height fit** `31-0`
      - size 286px × 20px; flow position 1
      - **USB-C cable — Block, width fit, height fit** `32-0` (text)
        - size 81.13px × 20px; flow position 0
        - text colour #0F172AFF
        - "USB-C cable" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
      - **$12.00 — Block, width fit, height fit** `33-0` (text)
        - size 43.69px × 20px; flow position 1
        - text colour #0F172AFF
        - "$12.00" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, width fill, height fit** `34-0`
      - size 286px × 20px; flow position 2
      - **Delivery — Block, width fit, height fit** `35-0` (text)
        - size 53.14px × 20px; flow position 0
        - text colour #0F172AFF
        - "Delivery" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
      - **$4.00 — Block, width fit, height fit** `36-0` (text)
        - size 35.61px × 20px; flow position 1
        - text colour #0F172AFF
        - "$4.00" · system-ui,'Segoe UI',Arial,sans-serif, 15px, weight 400 · line height 20px (1.33) estimated
        - contrast: base 17.85:1 AAA
    - **Frame — Row, padding 10 0 0 0, width fill, height fit** `37-0`
      - size 286px × 33px; flow position 3
      - padding 10px 0px 0px 0px
      - stroke 1 0 0 0px solid #E2E8F0FF
      - **Total — Block, width fit, height fit** `38-0` (text)
        - size 39.42px × 22px; flow position 0
        - text colour #0F172AFF
        - "Total" · system-ui,'Segoe UI',Arial,sans-serif, 17px, weight 700 · line height 22px (1.29) estimated
        - contrast: base 17.85:1 AAA
      - **$105.00 — Block, width fit, height fit** `39-0` (text)
        - size 63.28px × 22px; flow position 1
        - text colour #0F172AFF
        - "$105.00" · system-ui,'Segoe UI',Arial,sans-serif, 17px, weight 700 · line height 22px (1.29) estimated
        - contrast: base 17.85:1 AAA
  - **Pay $105.00 — padding 14 20 14 20, width fit, height fit** `40-0` (text)
    - size 320px × 49px; flow position 2
    - padding 14px 20px 14px 20px
    - fill #2563EBFF; text colour #FFFFFFFF; radius 8px
    - "Pay $105.00" · system-ui,'Segoe UI',Arial,sans-serif, 16px, weight 600 · line height 21px (1.31) estimated · align center
    - contrast: base 5.17:1 AA
