# Asset inventory — assign launch promo

No website capture was performed (no URL in the brief; the product is the local
`assign/` app). Assets are the app's own real imagery, staged by hand.

## Provided imagery

- `board-shot.jpg` — a real screenshot of the assign board. Use as the hero
  product visual: the "live board" moment and any pin/zoom on the Kanban.
- `hero-clouds.jpg` — the app's atmospheric hero plate (dark clouds). Use as a
  full-bleed ground behind the cold open and/or the finale, heavily darkened so
  type stays legible.

## Not available

- No logo file ships with the app; the assign mark is drawn in-app as an SVG
  (a white rounded square with three bars, the third one Iris `#847dff`). Recreate
  it as inline SVG — it is the real mark, not a substitute.
- No screen recording / footage. All motion is authored in HTML.
- No fonts ship as files; the brand faces are Inter (body/UI), Newsreader (serif
  display) and Roboto Mono (chrome). Load them via a local-first `@font-face`
  stack with system fallbacks so preview and render match offline.
