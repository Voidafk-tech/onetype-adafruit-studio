# Logo

- `logo-source.webp`: the original full-colour logo.
- In use: **the original gradient**, cut out of its navy background with edges cleaned. The site uses:
  - `dist/studio/assets/logo-on-light.png` and `logo-on-dark.png` (the same image; the gradient works on both)
  - `dist/studio/assets/mark.png` / `favicon.png` for the browser-tab icon
- `logo-options.html`, `logo-cerulean.html` and `logo-cerulean-both.html` are the recolour previews explored before returning to the original.
- `tools/recolor.swift` cuts the logo from its background and repaints it while keeping the fold shading. To rebuild from a higher-resolution original:

```sh
swiftc -O design/tools/recolor.swift -o /tmp/recolor
/tmp/recolor design/logo-source.webp dist/studio/assets/logo-on-dark.png original - - -
cp dist/studio/assets/logo-on-dark.png dist/studio/assets/logo-on-light.png
/tmp/recolor design/logo-source.webp dist/studio/assets/mark.png original - - - mark
# Recoloured version used earlier (Cerulean blue, #2A52BE):
# /tmp/recolor design/logo-source.webp out.png "#1b3580" "#6f8fe0" "#2a52be" "#2a52be"
```

The sparkle removal and mark/wordmark split use pixel positions for the 1052×322 source. Adjust `markEnd` and the sparkle box if the source size changes.
