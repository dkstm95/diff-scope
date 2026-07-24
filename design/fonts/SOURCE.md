# Hope font sources

Hope embeds fixed WOFF2 files so every offline artifact has the same type.
Unsupported characters still fall back to the local sans-serif or monospace
font.

## Hope Sans

`HopeSansLight.woff2`, `HopeSansMedium.woff2`, and `HopeSansBold.woff2` are
full-glyph WOFF2 conversions of Gmarket Sans TTF Light, Medium, and Bold.

Source:

- https://corp.gmarket.com/fonts/
- archive: `GmarketSansTTF.zip`
- source SHA-256:
  - Light: `7e8e8c70349ed94acf3ea4c6962a56417fdfa0a8803bc6cf9dc36324d5656849`
  - Medium: `c6b9a2c10bfdb55975948ce191f9cf638955b5cfdc99149969add5b579262fc1`
  - Bold: `ff7c354dd1a324e4cecc1223c4f71e74fa81be7027e0c7f6324c475909cacefc`
- output SHA-256:
  - Light: `14dd7df3bf3259d9dde7f83012fabaf056589108217c55d500bbfcdd103b2b63`
  - Medium: `e359e7ab0b4a15a5b738e7e3c4e8dc53737b670aaacf20845aa6a8b7f6f36798`
  - Bold: `58707eccf7e493e0651ec25e1b3f104722e892256f87158c197204dd6876b552`

## Hope Code

`HopeCode.woff2` is a full WOFF2 conversion of D2Coding Regular 1.3.2.

Source:

- https://github.com/naver/d2codingfont
- release: `VER1.3.2`
- archive: `D2Coding-Ver1.3.2-20180524.zip`
- archive SHA-256:
  `0f1c9192eac7d56329dddc620f9f1666b707e9c8ed38fe1f988d0ae3e30b24e6`
- source file: `D2Coding/D2Coding-Ver1.3.2-20180524.ttf`
- source SHA-256:
  `8b1b23e5de4dff652fb0b938528150d2f531edfda281d3944618b655711aba84`
- output SHA-256:
  `4d3fa8ed66fedcb1787f200bd75637b816b09057fc06da0aa783e3b305a726d8`

## Build

Build tool: fontTools `4.62.1`.

Hope Sans:

```text
pyftsubset <source.ttf>
  --output-file=<output.woff2>
  --flavor=woff2
  --glyphs=*
  --layout-features=*
  --name-IDs=*
  --name-legacy
  --notdef-glyph
  --recommended-glyphs
```

Hope Code:

```text
fonttools ttLib.woff2 compress D2Coding-Ver1.3.2-20180524.ttf
  -o HopeCode.woff2
```

The WOFF2 files are modified versions. Hope presents them as `Hope Sans` and
`Hope Code`, not under the reserved Gmarket Sans or D2Coding names. See
`OFL-Gmarket.txt` and `OFL-D2Coding.txt`.
